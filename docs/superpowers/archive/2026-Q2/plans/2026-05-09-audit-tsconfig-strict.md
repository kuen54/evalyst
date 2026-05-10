# Plan · Phase D · #4 tsconfig 严格化

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase D
> **execution gate**：必须等 Phase C 全部合 main 才开工。execution 启动前重跑 §1 baseline。

## 1. Pre-flight baseline

**Plan-write 时刻（2026-05-09，C 未合）**：noUnchecked **330** / noImplicitReturns **1** (image-lightbox.tsx:39，**非** validateProp，已被 union 穷举) / eopt **115** / 三条全开 **447**。

**Execution 启动时（2026-05-10，C 已全合 main + tag v0.11.0）**：

| flag | errors | Δ vs plan-write |
|---|---|---|
| `noUncheckedIndexedAccess` | **330** | ±0 |
| `noImplicitReturns` | **1** | ±0（仍 image-lightbox.tsx:39） |
| `exactOptionalPropertyTypes` | **118** | **+3**（很可能 #8 seed PR 加 `seed?: number` 触发） |
| 三条全开 | **450** | **+3** |

top-5 文件（三条全开）：use-chat-stream.ts (51) · tool-loop-detector.ts (25) · llm-config.migrate.test.ts (19) · anthropic-cache-control.test.ts (18) · llm-stream.ts (17)。**结论**：C 合后 strict baseline **未下降**——Tier 3 删的 unused exports 不在 strict 触发集中；Copilot 主体文件未动。

## 2. R5 分裂策略（按 post-C baseline 决）

450 >> 80 阈值 → **维持 spec §Phase D 兜底路径，2 PR 拆分**：

| PR | branch | 启用 flag | 估错误 |
|---|---|---|---|
| PR-1 | `refactor/tsconfig-strict` | `noUncheckedIndexedAccess` + `noImplicitReturns` | 331 |
| PR-2 | `refactor/tsconfig-strict-eopt` | `exactOptionalPropertyTypes`（PR-1 合后 rebase） | 118 |

**单文件二次分裂判定（post-C 实测）**：use-chat-stream.ts = 51，≥ 50 阈值 → 单文件单 commit；< 80 → **不**二次分裂为子 PR。其余文件均 < 50。

PR-1 内部 commit 节奏：(a) `noImplicitReturns` 单 1 commit（image-lightbox.tsx + validateProp/applyTransforms exhaustive default）；(b) `noUncheckedIndexedAccess` **按文件分组 commit**——top-5 各 1 commit 覆盖 **47+25+19+18+14 = 123/330 ≈ 37%**（PR-1 头 6 commit 拿下 ~124/331 ≈ 37%），其余 ≤5 errors 文件合并 1-2 commits。

## 3. Fix patterns（5 类典型违例 + 默认手法）

**a. noUncheckedIndexedAccess — `arr[i]` / `combo[alias][idField]` 返 `T | undefined`**
```ts
// before: const rec = records[i]
// after:  const rec = records[i]; if (!rec) continue
```
默认 guard + early continue（`schema/engine.ts:105,320` 这类）。仅 invariant 显式（`Array.from({length:n}).map((_,i)=>arr[i])` 等）用 `arr[i]!` + 一行注释说明为何安全。

**b. Map.get() returns undefined**
```ts
const tool = toolByName.get(name)
if (!tool) throw new Error(`unknown tool: ${name}`)
```
`copilot/tools/registry.ts` / `tool-loop-detector.ts` 是重灾区。

**c. noImplicitReturns missing default**
```ts
default: { const _: never = prop.type; throw new Error(`unknown: ${_}`) }
```
基线只有 image-lightbox.tsx:39 1 处。**额外义务**：grep `switch (.*\.(type|kind|op))` 全过一遍，对所有 union-discriminator switch 主动加 exhaustive default（防御未来加 case 漏返回）。重点查 `validate.ts:39` `validateProp` / `transform.ts` `applyTransforms`。

**d. exactOptionalPropertyTypes — `field?: T` vs `field: T \| undefined`**
```ts
// before: { foo: maybeUndef, bar: 1 }
// after:  { ...(maybeUndef !== undefined ? { foo: maybeUndef } : {}), bar: 1 }
```
所有显式传 `undefined` 的 prop 改 conditional spread。**PR-2 专门处理；PR-1 不动 eopt 相关**。

**e. JSON.parse / fs.readFileSync 返 unknown**
```ts
const raw = JSON.parse(text) as Record<string, unknown>
if (typeof raw.id !== 'string') throw ...
```
narrow 后再用，禁 `as any`。

**Cast 策略**：prod 全 narrow（guard / type predicate；`as unknown as T` 仅当运行时已验证）；测试允许 `as unknown as T` 跳 mock 摩擦（如 `vi.fn() as unknown as typeof callLlm`），但**两边都禁 `as any`**（项目当前 0 个）。测试改 >20 处走 R6 独立 commit。

## 4. validateProp 主动加 exhaustive default

`src/lib/schema/validate.ts:39` 末尾 + `src/lib/schema/transform.ts` `applyTransforms` switch 末尾各加：
```ts
default: { const _: never = prop.type as never; throw new Error(`unknown JsonFieldType: ${String(_)}`) }
```
即使 noImplicitReturns 当前不触发（union 已穷举），加 default 是防御未来扩 `JsonFieldType` 漏 case 的网。和 PR-1 noImplicitReturns commit 合并提交。

## 5. 验收（每 PR）

- `npx tsc --noEmit` 0 errors
- `npm test` 全绿（strict 后 `vi.fn` 推断变严，mock 可能要修；如测试改 >20 处独立 commit `refactor/tsconfig-strict-tests`，参 R6）
- `npm run build` 全绿
- `npm run lint` 不超过当前 baseline（plan-write 时 27 problems = 23 errors + 4 warnings；execution 启动前重跑取当时数）。Tier 3 尚未把 `continue-on-error → fail`，本 phase 不拿绝对零做硬验收，但**新增** strict-fix 不得引入新 lint 违例
- PR-2 启动前 rebase main（吃 PR-1）

## 6. 风险

- **R5（已触发）**：baseline 447 >> 80，**确定**走 2 PR 分裂；execution 时若 PR-1 单文件 errors ≥50 再做文件级 commit 拆
- **R6（中）**：strict 后 vitest mock 类型也得修；如测试改 >20 处独立 commit `refactor/tsconfig-strict-tests`
- **R7（低）**：`exactOptionalPropertyTypes` 可能影响 `next.config.ts` / `.next/types/**` / `.next/dev/types/**` 自动生成类型；这三条路径已在 `tsconfig.json` `include` 内，但走 Next codegen 修不动。**Mitigation**：先看 errors 是否集中在这些路径——若是，PR-2 在 `tsconfig.json` 加 `"exclude": [".next/dev/types/**", ".next/types/**"]`（dev/build 时 Next 自己跑 type-check，不靠我们 tsc 兜底）；若仍不通过，**仅 eopt 这一条**延后到 Next 17 升级时合并。PR-1 不受影响
- **R8（低）**：execution 启动时再跑 baseline 可能与 plan 写时不一致——以 execution 当下数为准，重 §2 决策

## 7. 边界 / 禁区

- **Cross-phase 锁（强约束）**：D 的 PR-1 + PR-2 **必须先于** Phase E `refactor/copilot-boundary` 合 main。理由 = spec §Phase D Stop condition：E 的 Copilot 大量 `git mv` + import 路径 rewrite 必须在 strict baseline 之上跑，否则切边后再开 strict 会让搬走的文件二次改类型；如 PR-2 卡 R7 延后到 Next 17，**则只 PR-1 必须先于 E**，且 spec §Phase D 风险段同步更新
- 修 strict 违例**不引入新功能 / 新抽象** —— 只做最小 narrow / guard
- `as any` 仍禁区（prod + 测试均禁，项目当前 0 个）；`as unknown as T` 能 type guard 替代就替代（参 §3 cast 策略）
- 不动 batch-runner.ts 行为（Phase B export exception 是孤例）
- 不动 Copilot 文件**结构**（切边是 Phase E）；但 Copilot 文件**内部** strict fix 可以做
- 单文件 strict 后报 ≥50 errors 时，**该文件单独 commit**；其他文件 ≤5 errors 可一 commit 多文件
- 发现某 fix 涉及行为修改而非纯类型 narrow → **停下问用户**（典型陷阱：guard early-continue 可能改变 silent skip 语义）
- 不自合 PR；CHANGELOG `[Unreleased]` 加：
  - `refactor(tsconfig): enable noUncheckedIndexedAccess + noImplicitReturns (#4)`
  - `refactor(tsconfig): enable exactOptionalPropertyTypes (#4 follow-up)`
