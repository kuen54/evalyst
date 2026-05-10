# Plan · Phase E · #9 globalThis __activeRunners → 文件锁

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase E #9
> **execution gate**：必须等 #2（`refactor/copilot-boundary`）合 main 才开工——本 PR 不动 Copilot 子树，但 spec §跨 PR 依赖锁顺序 #2 → #10 → #9（path 稳定后再改 lock，避免 rebase 冲突）。
> Branch: `refactor/batch-runner-file-lock` · 估 1d

## 1. 当前状态

`src/lib/batch-runner.ts` lines 17–42：`globalThis.__activeRunners` 挂一个 module-level singleton Map，`startBatch` / `stopBatch` 通过它派发 abort。注释 line :17 说"挂 globalThis 避免 HMR 清空"——表象修复；真问题是模块级 singleton 跨多 worker / 重启 / 进程崩溃**永远丢活实验状态**。`activeRunners` 只在 `batch-runner.ts` 内部消费，公开 API 仅 `startBatch` / `stopBatch`（grep 验过），本 PR 替换底层不破坏 API 契约。

## 2. 目标设计

锁文件 `data/results/{exp_id}/.runner.lock`：

```ts
interface RunnerLock { pid: number; started_at: string; last_heartbeat: string; node_version: string }
```

`startBatch(config, ...)` 改为：
1. 读锁；不存在 → 用 `writeAtomic` 写锁、跑
2. 存在 → `process.kill(pid, 0)` 探活：
   - ESRCH → stale，重置锁、跑
   - 存活 + `last_heartbeat` 在 1h 内 → 抛 `"Experiment is already running"`（保持原 message，UI 已识别）
   - 存活 + `last_heartbeat > 1h` → 视作 hang，stale 重置（防进程持有锁但实际卡死）
3. dev 模式（`NODE_ENV !== 'production'`）首次 `startBatch` 跑 `clearStaleLocksOnBoot()` 扫 `data/results/*/.runner.lock` 全删（HMR 反复重启常态；module-level `bootCleanupDone` flag 防多次跑）

`BatchRunner.run()` 主循环既有的每 ~30s `writeProgress` 同步 touch 锁更新 `last_heartbeat`（让长跑实验持续 refresh）。

`stopBatch(experimentId)`：内存里 module-local `Map<string, BatchRunner>` 仍存在（**不再挂 globalThis**），用于 same-process abort 派发；锁文件做 cross-process 协调。`run()` finally 删锁 + Map。**公开签名 + 返回值不变**。

## 3. Commit 节奏

- commit 1：新增 `src/lib/batch-runner-lock.ts`（acquire / release / touch heartbeat / clearStaleLocksOnBoot helpers），独立纯函数，不接入主流程
- commit 2：`batch-runner.ts` 切到 lock + 删 `globalForRunners` + 内存 Map 改 module-local
- commit 3：单测 `src/lib/__tests__/batch-runner-lock.test.ts` 4 case

## 4. 单测（4 case）

惰性 `process.cwd()`（与现有 `llm-config.ts` 模式一致）方便 chdir 到 tmp；`process.kill(pid, 0)` 用 `vi.spyOn(process, 'kill')` mock。

1. **拿锁成功**：空目录 → `acquireLock(expId)` 返 ok，文件含 pid + started_at + last_heartbeat + node_version
2. **已锁拒绝**：先 acquire；mock kill 返存活 + last_heartbeat in 1h → 第二次 acquire 抛 "Experiment is already running"
3. **stale 自动清**：写锁含 fake pid 999999 → mock kill 抛 ESRCH → acquire 重置锁、返 ok
4. **dev boot 清残留**：`NODE_ENV=development`；写 3 个不同 expId 的锁 → `clearStaleLocksOnBoot()` 后目录全空

## 5. 验收

- `npx tsc --noEmit && npm test && npm run build` 全绿
- 4 case 全绿（`npm test -- batch-runner-lock`）
- `grep -n "globalThis\\|__activeRunners\\|globalForRunners" src/lib/batch-runner.ts` 返 0 行
- 手测：`npm run dev` 跑实验、Ctrl-C kill、重起 → 不报 "already running"（之前卡死直到删 `.next/cache`）
- 手测：`next start -w 4` 双 `/run` 同 expId → 一跑一拒（之前两个都跑出 race）
- CHANGELOG `[Unreleased]` 加 `refactor(batch-runner): file lock replaces globalThis singleton (#9)`

## 6. 风险

- **R1（中）· `process.kill(0)` 跨 OS**：darwin / linux 正确；Windows errno 不同。Mitigation：项目目标平台 mac + linux Docker，未声明 Windows 支持，darwin 测试足够
- **R2（中）· 长跑实验误判 stale**：`last_heartbeat` 字段 + 主循环 `writeProgress` 同步 touch 已 mitigate；若 BatchRunner.run 主循环 hang（不再 touch heartbeat）超 1h，确认是真 hang，stale 清是正确语义
- **R3（低）· 锁文件 TOCTOU race**：read-empty → write 抢锁的窗口 <10ms。`writeAtomic` (tmp + rename) 保单次写 atomic；TOCTOU 真触发结果是两 runner 都跑——比 silent 卡死好。flock 跨 OS 复杂，YAGNI
- **R4（低）· dev boot cleanup 误清**：HMR 重载时 boot cleanup 清掉正跑 runner 锁——dev 场景 HMR 本来就让正跑 runner 失活（模块卸载内存 Map 清空），锁清不清效果一样；prod 跳过此 hook

## 7. 边界 / 禁区

- 不动 `BatchRunner.run()` 主循环（除 finally 添删锁 + 主循环 touch heartbeat 外不动）
- 不动 `startBatch` / `stopBatch` 公开签名 + 返回值
- 不引入分布式锁库（redis / etcd）——文件锁满足 same-machine 多 worker
- 不动 `/api/experiments/[id]/run|stop/route.ts` 调用方 / `appendResult` / `writeProgress` / `getProgress`
- 不动 Copilot 子树（与 #2 / #10 物理隔离）
- 实施中发现 lock 设计需要扩展到 stop / pause / 状态机层，**停下问用户**——不在本 PR 扩
- 不自合 PR；push 后等用户 review
