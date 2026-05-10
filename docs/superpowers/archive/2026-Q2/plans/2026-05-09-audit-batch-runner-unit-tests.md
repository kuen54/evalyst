# Plan · #7 batch-runner.run 单测（Phase B）

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase B · #7
> Branch: `test/batch-runner-unit` · 工作量 1.5d · 单 PR · **源文件仅一处 type-only 改动**

## Goal

给 `BatchRunner.run` 的状态机（resume / taskIds 子集 / stop / progress 累加 / concurrency / per-currency cost）盖一层兜底单测，为 Phase E（`#9` 文件锁重构）提供回归网。源文件本期**仅加一个 `export` 关键字**，无行为变化。

## 当前代码定位

- `src/lib/batch-runner.ts:23-202` — `startBatch` 单例守护 + `BatchRunner.run` 主循环 + per-task pipeline
- `src/lib/batch-runner.ts:231-333` — `executeTask` 含 success / parse_error / image-save error / generic error 四分支
- `globalThis.__activeRunners`（`:20-21`）单例 Map：每实验最多一个 runner；测试前必须显式清
- **Approved export exception**：`src/lib/batch-runner.ts:44` 把 `class BatchRunner` 改 `export class BatchRunner`——type-only 可见性变更，无运行时影响。R4 的禁区是"不做行为重构"，导出 class for testability 不在线后。PR description 单独标注"export for test visibility, no behavior change"

## 1. Test cases（6 个）

1. **resume + 部分 failed** — fixture：12 task；progress.json `completed=[t1..t10]`，`results.jsonl` 含 `t9 status:'parse_error'`。`run(resume=true)` 期望：`pendingTasks` = `[t9, t11, t12]`（t9 重试 + t11/t12 新跑），mock `callLlm` 全 success 返 fakeResponse；终态 `progress.completed_tasks=12`、`failed_tasks=0`、`appendResult` 调 3 次
2. **taskIds 子集** — fixture：8 task 全 completed；`run(resume=true, taskIds=['t3','t5'])` 期望：仅 t3/t5 重跑（mock `callLlm` for t3/t5 全 success），其余保留 completed；`appendResult` 调 2 次；`completed_task_ids` 仍含 8 个
3. **中途 stop** — fixture：6 task；`callLlm` mock 第一次 resolve 后调 `runner.stop()`；剩余 in-flight 跑完，未启动的丢。期望：`finalStatus='paused'`，`updateExperiment` 末次入参 `status:'paused'`
4. **progress 三路径累加** — fixture：3 task，`callLlm` 返 `{usage:{prompt_tokens:10, completion_tokens:20}}`。期望终态 `total_input_tokens=30`、`total_output_tokens=60`、`total_cost_by_currency.USD` = 3 × ((10×in + 20×out) / 1e6)；`writeProgress` **精确调 5 次**（1 init :138 + 3 per-task :177 + 1 final :214）
5. **concurrency 上限** — fixture：6 task，`concurrency=2`；callLlm mock 走 deferred Promise + 计数器（sketch 见 §2 末尾）；测里逐个 `releases.shift()()` 释放，断言 peak `≤ 2`
6. **cost per-currency 累加** — fixture：4 task，2 个用 USD pricing model、2 个用 CNY pricing model（通过 `findPricing` mock 按 task 索引切币种）。期望 `total_cost_by_currency = { USD: <sum2>, CNY: <sum2> }` 双键各 close-to 期望值

每 case 三段式：**arrange** fixture + mocks → **act** `await new BatchRunner(cfg, conc).run(...)` 直调（绕过 `startBatch` 单例）→ **assert** 末态 progress / appendResult 入参 / updateExperiment 末次入参

## 2. Mock 策略（核心）

| 模块 | 替换 | 备注 |
|---|---|---|
| `@/lib/llm-client` | `callLlm` 返完整 `LlmResponse`（content/usage/latency_ms） | 接口形态保真；可按 task index 切结果；不打 endpoint |
| `@/lib/store` | in-memory store：`appendResult` push 到内存数组，`readResults` 返回前按 `task_id` Map last-wins **dedupe**（对齐真实 `store.ts:140-142` 语义，否则 case 1 resume 会双拿 t9 fail+success）；`writeProgress`/`updateExperiment` 覆盖式写内存对象，`getProgress` 同源反读 | 不写真盘 |
| `@/lib/llm-config` | `getLlmConfig` 返 fixture LlmConfig（USD + CNY 各一条 pricing） | 让 `findPricing` 实调 |
| `@/lib/datasets`（getDataset）| 返 in-memory `{ records, def }` fixture | 让 `generateTasks` 走真笛卡尔 / id 拼接 |
| `@/lib/schema`（getSchema）| 返最小 fixture schema：`inputs:[{alias:'q', dataset_id:'ds'}]`、`output_schema` 单字段 | 不引磁盘 schema |
| `@/lib/image-store` | `saveImagesForTask`/`assignImagePathsToOutput` no-op | image 路径走 #6 单测，这里不重复 |
| `@/lib/result-parser` | `parseResponse` mock 成 `{ success:true, data:{...} }` 或可控失败 | 让 case 4 的 success 路径稳定 |
| `generateTasks` / `buildMessages` / `buildInputRefs` / `buildInputPreview` | **实调** | 让 cartesian / filter / id 走真路径 |

mock 全部 vi.mock factory 写法（顶层 hoisted），避免 module-level 缓存 race。

**Case 5 deferred sketch**：
```ts
let active = 0, peak = 0
const releases: Array<() => void> = []
mockCallLlm.mockImplementation(async () => {
  active++; peak = Math.max(peak, active)
  await new Promise<void>(r => releases.push(() => { active--; r() }))
  return fakeResponse
})
// act: 在 microtask 边界逐个 releases.shift()?.() 释放，await runner.run；最后 expect(peak).toBeLessThanOrEqual(2)
```

## 3. 隔离策略

- `beforeEach`：`delete (globalThis as any).__activeRunners`；`mkdtempSync` + `chdir` 到 tmp（参考 `annotation-aggregate.test.ts:12-21`）
- `afterEach`：`chdir` 回 origCwd；`rmSync(tmp, {recursive:true})`；`vi.clearAllMocks`
- **不**用 `vi.useFakeTimers`——batch-runner 内无 setTimeout，timer mock 反而造假
- `appendResult` mock 内追加到 testStore.results；后续 `readResults` 从同源读，确保 resume 路径自洽

## 4. 覆盖率目标

- vitest `--coverage`（v8 provider，`vitest.config.ts` 已默认或一行加 `coverage: { provider: 'v8' }`）
- `BatchRunner.run` line + branch ≥ 70%
- `BatchRunner.executeTask` line ≥ 60%（含 image / parse_error 分支）
- 总 case ≤ 7 file，运行 < 1s（全 mock，无 fsync）

## 5. 风险预案

- **R1 单例 race**：`globalThis.__activeRunners` 跨测残留 → `beforeEach` 显式 `delete`
- **R2 模块缓存**：vi.mock 顶层 hoist 写错位置导致 import 拿到真实现 → 全部 mock 写在 import 上方 + factory 形态；先跑 1 个 case 看 mock 是否生效再补全
- **R3 总时长**：fs 慢路径 → mock store 不落盘；callLlm `Promise.resolve` 立即 resolve（case 5 用 deferred Promise 显式控并发）
- **R4 source drift**：除已批准的 `export class BatchRunner`（§当前代码定位末条），不再动 src。若发现其他 testability 断点（如 inFlight 不可观察），优先**改测试侧**（并发计数器拦 callLlm），不再扩 src 改动面

## 6. 验收 checklist

- [ ] 6 cases 全 pass
- [ ] 测跑 < 1s（`time npm test -- batch-runner` 验证）
- [ ] 覆盖率达标（`npm test -- --coverage batch-runner` 输出贴 PR description）
- [ ] `npx tsc --noEmit && npm test && npm run build` 全绿
- [ ] `git diff --name-only main...HEAD` 仅 `src/lib/__tests__/batch-runner.test.ts` + `src/lib/batch-runner.ts`（仅 `export` 关键字一处 diff，`git diff src/lib/batch-runner.ts` 应只见 `+export class` / `-class`）+ `CHANGELOG.md`
