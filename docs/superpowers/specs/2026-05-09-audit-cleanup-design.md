# Audit Cleanup 2026-05-09 Design

## Context

`docs/code-review-2026-05-09.md` 给出 11 条 finding（5 Tier1 + 5 Tier2 + 1 Tier3 cleanup batch），总工作量 ~12 人天。本 spec 把审视报告的"修复清单"和"执行顺序"两节落成施工蓝图：每项 scope / 验收 / 文件清单 / PR 拆分，及"哪些不修 + 理由"的决策日志。

执行按 Phase 排（A→F），不按 Tier 序号。Phase 内可并行，跨 Phase 严格顺序。

## Goals

1. **关 blocker**——RCE / key 明文 / no-auth / Cartesian OOM / SSRF
2. **画 Copilot 边界**——物理切目录 + README 顶部声明 9k vs 18k LOC 划分
3. **补类型补测试**——tsconfig 严格化、`batch-runner.run` 单测
4. **清债**——manifest 早抽象、unused exports、knip 噪音、Dockerfile root 一并打包
5. **文档收敛**——CLAUDE.md / AGENTS.md 重复 60% → 一份索引 + 主题文件；CHANGELOG 不动

**强约束**：保持四件套用户可见行为不变。`#1` auth gate 默认放开 localhost、`#3` cap=100k 不打扰小用户、`#8` seed 是加法。其它纯 internal。

## Non-Goals（决策日志）

| 不修 | 为什么 |
|---|---|
| Glass UI 9 档简化 | 视觉系统没坏；DHH "认知开销"成立但不阻塞功能；CLAUDE.md 已收敛 tinted 名额规则 |
| Manifest 11 个 unused interface 的早抽象**重做** | 删除不解锁能力 → 仅打包进 Tier 3 cleanup（删，不重构） |
| `appendFileSync` results.jsonl 不走 writeAtomic | 单实例 Docker compose OK，未来多实例再说 |
| 88/96 tsx `"use client"` | RSC 学习曲线 vs perf 收益模糊 |
| CHANGELOG 95KB 不拆 | 95KB / 24 tag ≈ 4KB / tag 合理；archeology 才付一次成本 |
| `migrate*InMemory` vs `llm-config` 写时迁移策略不一 | Linus 视角"in-memory 永远不损坏数据是对的"，未来再统一 |
| `applyTransforms` `js` 的 try/catch swallow | `js` op 在 #1 直接删，问题随之消失 |
| Cost retry 重算（"历史不追溯"轻微矛盾） | 实际 retry 用当时 pricing 才合理 |

## Phase 顺序 + rationale

```
Phase A — 止血                      1.5d   #1 + #6
Phase B — 安全网                    1.5d   #7
Phase C — 速胜                      1.5d   #3 + #8 + Tier3
Phase D — 类型补网                  1.5d   #4
Phase E — 结构性重构                4d     #2 → #10 → #9
Phase F — 文档收尾                  2d     #5
                                    ────
                                    12d
```

- 安全 blocker 不能等 → A 最早；#1 + #6 同属"输入面"，搭车修
- 重构前先有 batch-runner 单测兜底 → B 早于 E
- tsconfig 严格化在 Copilot 切目录之前——切边大量改 import，类型严格立刻抓回归 → D 早于 E
- `#10` 物理上属 Copilot 重构域，跟 `#2` 同 Phase
- `#9` 等 `#2` 边界画清后再改
- 文档放最后：任何代码改动都让 docs drift → F 最末

## Per-Item Scope

### Phase A · 止血

**#1 RCE / key 明文 / no-auth gate（1d，独立 PR `fix/auth-gate-rce`）**

- 删 `js` op：`schema/transform.ts:70-78` switch 分支 + `TransformStep` 联合 + `TransformChainEditor` 选项 + i18n key `transform.op.js.*`（已 grep 确认 `data/schemas/*.json` + `src/lib/seeds/` 0 命中）
- mask api_key：`GET /api/llm-config` 把每条 model 的 `api_key` 改成 `sk-***xxx`（保末 4），PUT 仍接受明文写入不变
- 加 `src/middleware.ts`：默认放行 `localhost` / `127.0.0.1` / `::1` + Sec-Fetch-Site `same-origin`/`none`；`process.env.EVALYST_ALLOW_ORIGIN` 追加白名单；`/api/skills/[name]` 公开放行（agent-driven 设计需要）
- 文件：`schema/transform.ts` · `schema/types.ts` · `template-builder/transform-chain-editor.tsx` · `i18n/{zh,en}.ts` · `app/api/llm-config/route.ts` · 新增 `src/middleware.ts` · 新增 `e2e/auth-gate.spec.ts` · `README.md`
- 验收：`grep "op":"js"` 0 命中 / api_key GET 返 mask / 跨源 origin 403 / 同源放行 / `.claude/skills/evalyst` agent 流程不破 / tsc + test + e2e 全绿
- 风险：origin 白名单破坏 SSE / 用户 LAN IP 访问 / 用户改过的 schema 含 `js` op；详见 plan

**#6 SSRF 图片 URL allowlist（0.5d，独立 PR `fix/image-url-ssrf`）**

- `src/lib/image-store.ts` `saveImagesForTask` 写盘前过滤：accept `data:image/*` + `https://`；reject `file://` / 私网段 (10/8、172.16/12、192.168/16、127/8、169.254/16、`::1`、`fe80::/10`)
- 文件：`src/lib/image-store.ts` + 新增 `__tests__/image-store-ssrf.test.ts`
- 验收：8 边界单测全过 / 拒绝时 task.error 写明 / 不静默吞

---

### Phase B · 安全网

**#7 batch-runner.run 单测（1.5d，PR `test/batch-runner-unit`）**

- mock `callLlm` + `appendResult` + 文件 IO，覆盖 6 case：resume + 部分 failed / taskIds 子集 / 中途 stop / progress 三路径累加 / concurrency 上限 / cost per-currency 累加
- 新增 `src/lib/__tests__/batch-runner.test.ts` ~250 行
- 验收：CCN 21 函数覆盖率 ≥ 70% / 测跑 < 1s（全 mock）

---

### Phase C · 速胜

**#3 Cartesian hard cap + estimate 不物化（0.5d，PR `fix/cartesian-cap`）**

- `generateTasks(schema, fv, db, opts?: { maxTasks=100_000 })`，每 push 前检查 length，超抛 `TOO_MANY_TASKS`
- 新增 `estimateTaskCount` 纯函数，不物化 array；`/api/estimate` 改调它
- UI `experiments/new`：estimate > 5000 弹 confirm dialog
- 文件：`schema/engine.ts` · `app/api/estimate/route.ts` · `experiments/new/page.tsx` · `i18n/{zh,en}.ts` · 新增 `schema/__tests__/cartesian-cap.test.ts`
- 验收：3 alias × 1000 records estimate < 10ms / 100k 超阈抛错 / 5001 task 弹 confirm

**#8 ExperimentConfig.seed（0.5d，PR `feat/experiment-seed`）**

- `types.ts` `ExperimentConfig.seed?: number`；`llm-client.ts` OpenAI 透传、Anthropic warn+drop；`experiments/new` 表单加 "Seed (optional)"
- 文件：`lib/types.ts` · `lib/llm-client.ts` · `experiments/new/page.tsx` · `i18n/{zh,en}.ts` · 新增 `lib/__tests__/llm-client-seed.test.ts`

**Tier 3 cleanup batch（0.5d，PR `chore/audit-cleanup`）**

10 项打包：knip ignore worktrees / `.gitignore` worktrees / Dockerfile `USER node` + `npm prune` / `src/lib/types.ts` 删 11 项 unused re-export / `src/lib/copilot/manifest.ts` 删 11 unused interface / display-form-modes ⇄ display-form-page 循环依赖修 / CI lint `continue-on-error` 改 fail / `extractImageRefsFromOutput` 9 参数拆 / README 加 ".next 缓存" 注 / 清其余 16 unused exports + 38 unused types。验收：knip / lint / tsc 全清零。

---

### Phase D · 类型补网

**#4 tsconfig 严格化（1.5d，PR `refactor/tsconfig-strict`）**

- 开 `noUncheckedIndexedAccess` / `noImplicitReturns` / `exactOptionalPropertyTypes`
- `validate.ts:14` `validateProp` 末尾加 `default: { const _: never = prop.type; throw ... }` exhaustive
- 修 tsc 报出来的所有 errors（**审视估 30-50 处，实际可能 100+**）
- 验收：tsc / test / build 全绿
- **风险 R5（很可能触发）**：errors > 100 → 拆成 `refactor/tsconfig-strict-eopt` 把 `exactOptionalPropertyTypes` 推到独立 PR；先开两条不卡 Phase D。每开一条先 `tsc --noEmit | wc -l` 估错误数，超 80 当场 reschedule
- **Stop condition**：拆出来的 strict PR **必须留在 Phase D 内完成**（即合入 main 后才进 Phase E），不推到 Phase F 之后——否则 Phase E #2 Copilot 重构带着一半 strict 的代码改 import，`exactOptionalPropertyTypes` 后开会发现新搬的文件也得再改一遍

---

### Phase E · 结构性重构

**#2 Copilot 物理切边（2d，PR `refactor/copilot-boundary`）**

- `src/lib/copilot/` + `src/components/copilot/` + `src/app/api/copilot/` 全部归到 `src/copilot/{lib,components,api}` 下（仍单 src，不是 monorepo package）
- `tsconfig.json` paths 加 `@/copilot/*`；`src/lib/types.ts` 不再 re-export Copilot type
- README + AGENTS.md 顶部声明"评测核心 ≈ 9k LOC，Copilot ≈ 18k LOC，可独立理解"
- `docs/superpowers/` plan/spec 重命名：领域核心相关挪 `docs/specs/`，剩余 prefix `copilot-`
- 提交策略：commit 1 纯 `git mv`（diff = renames）；commit 2 import 路径 rewrite——便于 review
- Glass UI css var (`--copilot-accent`) 留 `globals.css`；`<GlassCard>` 等仍从 `src/copilot/components/` import（耦合点声明在 README）
- 验收：tsc / test / e2e 全绿；git history 保留；README 评测/Copilot 章节分离

**#10 metadata-client mirror 拆掉（1d，PR `refactor/copilot-tool-metadata-split`）**

- 每 tool 拆为 `tools/{name}.metadata.ts`（client-safe schema + metadata）+ `tools/{name}.server.ts`（call + fs/path）
- `registry.ts` 拼装时按需导入；删 `metadata-client.ts` + `metadata-client-sync.test.ts`
- 加新 tool 从 6 处变 3 处（metadata + server + registry）
- 验收：8 工具拆完，metadata.ts 无 server-only import；client bundle 不再 include `fs` polyfill (webpack analyze 验证)

**#9 globalThis __activeRunners → 文件锁（1d，PR `refactor/batch-runner-file-lock`）**

- `data/results/{exp_id}/.runner.lock` 写 PID + 启动时间 + node version；`/run` 启动检查；stale lock（PID 不存在 / > 1h）自动清；dev mode 启动清所有
- 文件：`src/lib/batch-runner.ts` + 新增 `__tests__/batch-runner-lock.test.ts`
- 验收：4 case 单测（拿锁 / 已锁 / stale 清 / dev 启动清）；HMR 不再卡 stuck experiment；`next start -w 4` 不冲突

---

### Phase F · 文档收尾

**#5 文档分裂 + 砍冗余（2d，PR `docs/audit-cleanup-doc-split`）**

- AGENTS.md 收到 ≤ 5KB（开发流程 + 命令速查 + AI 约定）
- CLAUDE.md 拆 3 份：`docs/architecture.md` + `docs/copilot.md` + `docs/conventions/glass-ui.md`；CLAUDE.md 自身 ≤ 8KB 索引 + **附原 spec 反直觉 3 条强约束摘要**（激活色用 `--copilot-accent` / sidebar 不玻璃 / JSX helpers API），不让 agent 一定要点开链接
- README 删 "Copilot 规划中"
- `docs/superpowers/plans/` 历史挪 `archive/2026-Q2/`，根目录留 `_index.md`
- CHANGELOG 不动
- 验收：CLAUDE ≤ 8KB / AGENTS ≤ 5KB / README 不再说"规划中" / 主观验收：读 CLAUDE.md + AGENTS.md，无段落级 60%+ 重复（grep 探针辅助：`git grep "9 档" docs/ CLAUDE.md AGENTS.md` 应只 1 处、`git grep "writeAtomic" docs/ CLAUDE.md AGENTS.md` 应只 1 处）

## 跨 PR 依赖

```
Phase A: #1 ─┬─ 独立
Phase A: #6 ─┘
Phase B: #7
Phase C: #3 / #8 / Tier3 ── 三个独立
Phase D: #4
Phase E: #2 ──→ #10 ──→ #9
Phase F: #5
```

`#10` 依赖 `#2`（先归位再拆 tools 文件）；`#9` 依赖 `#2`（path 稳定后改 lock）；`#5` 依赖 `#2 / #10 / #9`（文档要写最终结构）。

## 工作流约定

- 此 master spec ~200 行（已守住）
- **>1d 项配 lightweight plan ≤ 100 行**：#1 / #2 / #4 / #5 / #7 / #9 / #10（共 7 份）
- **<1d 项不写 plan**：#3 / #6 / #8 / Tier3
- 每项一个 PR，branch 命名按 AGENTS.md（`fix/*` / `refactor/*` / `chore/*` / `docs/*` / `test/*` / `feat/*`）
- **不自己 merge**——push 后等用户 review
- CHANGELOG `[Unreleased]` 段每完成一项追加草稿，合 tag 时整合
- 跨 Phase 严格顺序；Phase 内可并行

## Tag 建议

- A→C 完成后 tag `v0.11.0 — security blocker fixes + cartesian cap`（用户可见行为提升）
- **Phase D 完成后 tag `v0.12.0-rc1 — tsconfig strict baseline`**——给 Phase E 的 Copilot 大重构一个 fallback 回滚点，避免 #2/#10/#9 翻车一起退掉 #4 的 1.5d 工作
- E→F 全部完成后 tag `v0.12.0 — copilot boundary + doc split`

中间 #4 若爆 100+ errors 触发 reschedule（拆 PR），更新此 spec §Phase D 风险段并提示用户。
