# Audit R2 Follow-up Plan

> Trigger: Phase 1/2/3 execution 期间累计 13 项 plan-外问题
> Baseline: v0.13.0 (`b26c6a9`)
> Target: v0.13.x patch（3 PR / ~1.5 人天）
> Source: 三轮 phase 反馈记录（见 §plan-外原始反馈，本文档底）
> Reference: [`docs/code-review-round-2.md`](../../code-review-round-2.md)

## Background

R2 三阶段（Phase 1 域核心补测 / Phase 2 速胜 cleanup / Phase 3 Glass primitive 切边）全部 merged 并 tag 到 v0.13.0，但 subagent 二次 review + 实际开发期间累计**13 项 plan-外**发现，分散在 3 个反馈记录里。

直接放 audit r3 的问题：
1. 其中 **A1（CI 撒谎）** 是 verification 信号塌陷——每个后续 PR 的"全绿"claim 都建立在已坏的基础上，越往后越难分清"真绿 vs 假绿"
2. **A2（ConfirmDialog Context scope）** 是 Phase 3 自身新引入的 regression，不修等于 Phase 3 没真完成
3. **A3 + B 类**是已经在域内、冷启动成本高于动手成本的 cleanup

C 类（4 项）需要独立 spec / 系统性思考，自然进 r3 backlog。

## 分类裁决

| 类 | 行动 | 项数 | 投入 |
|---|---|---|---|
| **A** 必修 | r2 follow-up 收（本文档 PR-1/2/3） | 3 | ~1 人天 |
| **B** 顺手 cleanup | 与 A3 合并 PR-3 batch 收 | 8 | ~0.5 人天 |
| **C** 真 follow-up / 设计观察 | 进 r3 backlog（本文档 §C 类） | 4 | r3 处理 |

## Phase 顺序 + rationale

```
Phase 1 — 修 CI 信号（必须先做） ──────── 0.5 人天
   PR-1  fix/r2-e2e-real-failures        A1

Phase 2 — 修视觉 regression ─────────── 0.5 人天
   PR-2  fix/r2-confirm-context-nesting  A2

Phase 3 — Cleanup batch（最后） ──────── 0.5 人天
   PR-3  chore/r2-followup-cleanup        A3 + B1-B8
```

**为什么这个顺序**：

- **PR-1 必须最先**——CI 当前在撒谎（3 个 e2e 长期红但 verify+e2e job 都报绿）。后续 PR-2/PR-3 的"全绿"信号建立在 PR-1 之上才有意义。先修 PR-2/PR-3 等于在沙地上盖楼，下一轮 audit 又得验"上轮的绿是不是真绿"
- **PR-2 早于 PR-3**——A2 是 Phase 3 新引入的 visual regression，scope 单一（layout.tsx Provider 嵌套顺序），先修能让 Phase 3 真正交付完整。PR-3 是 cleanup，没行为风险，放最后
- **PR-3 batch 收 9 项**——单独发 9 个 PR 是过度仪式；同主题的 doc-drift / dead code / pin revert 一锅炖，commit message 分层标清就够

跨 Phase 严格按顺序；每个 PR 独立 review + merge。

## PR-1：fix/r2-e2e-real-failures

> **Errata (诊断后, 2026-05-11)**：实测推翻 plan 写时的两个前提：
>
> 1. **CI 没撒谎**：`.github/workflows/ci.yml` e2e step 是 `run: npm run test:e2e`，无 `continue-on-error`、无错误吞噬。最近 30 次 `gh run list --workflow CI` 全 success，无 retry 痕迹。
> 2. **3 个 e2e 中只 1 条真 fail**：
>    - `e2e/experiment-seed.spec.ts:106`（integer seed flow）—— **本机 + CI 全绿**。`2c03636 fix(test): self-provision LLM fixture` + `f743810 fix(test): cast through unknown` 早已修过
>    - `e2e/experiment-seed.spec.ts:126`（empty seed key omission）—— 同上，已绿
>    - `e2e/audit-cleanup-coverage.spec.ts:298`（Cmd+K toggle）—— **本机 macOS 1/3 flake，CI Ubuntu 一直绿**。根因：测试只等 `<aside data-copilot-panel>` attached（SSR HTML 立即满足），但 ⌘K 监听器在 `<CopilotStoreProvider>` 的 `useEffect` 里注册（hydration 后才跑）。慢机 race 触发
>
> Plan 写时未实跑 / 未读 CI 日志，前提 stale。
>
> **重新框定 PR-1（实际执行 scope）**：
> - 修 1 真 flake（`audit-cleanup-coverage.spec.ts:298`）+ 同隐患 2 处（`copilot-v2.spec.ts:45/54` / `copilot-v25.spec.ts:134`，grep 后发现）—— 在 ⌘K press 之前等 `getByRole("button", { name: /打开 Copilot|Open Copilot/i })` 可见，确保 `mounted=true`、listener 已注册
> - **不**改 src/ prod 代码（`useEffect` 注册顺序合理；race 是测试侧问题）
> - **不**动 experiment-seed 两条（已绿；CI 30 次没复现，加防御就是 cargo cult）
> - **CI 严化**：`playwright.config.ts` `retries: process.env.CI ? 1 : 0` → `retries: 0`。retries=1 是给未诊断 flake 留逃生口，与 Phase 1 主旨"严化 CI"矛盾。Cmd+K 修干净后立刻拆门
> - **CI workflow 不动**：已严
>
> Branch / commit / 受影响文件按重新框定的更新（见下文，原条目仅作历史参照）。

> **Supplement (诊断后续, 2026-05-11 by Phase 2 session)**：PR-1 Errata 写
> "experiment-seed.spec.ts:106 本机 + CI 全绿" 判断基于低频单跑（workers=1，不带
> `--repeat-each`）。Phase 2 在 retries=0 + `--repeat-each=3` 下复现 ~8% flake
> （12 次跑 1 次 fail，模式：`clickRun()` 后 `waitForURL(/\/experiments\/exp_seed_test/)`
> 5s timeout）。
>
> 根因未诊断；猜测 dev server Next.js standalone `/experiments/new` 首次访问编译
> 可能 >5s + waitForURL 阈值偏紧。**与 PR-2 (`fix/r2-confirm-context-nesting`)
> 改动无因果关系**——experiments-new 走 `window.confirm`，不经 React `useConfirm` /
> ConfirmProvider 嵌套路径，物理上证伪。
>
> **Methodology lesson**：任何 pre-existing 测试标"已绿"前必须 `--repeat-each` ≥ 5
> stress-test。30 次 CI 全绿 ≠ 无 flake——CI Ubuntu workers=1 + 单 spec 触发
> 条件有限，慢路径低概率撞不到。
>
> **Action**：进 r3 backlog（见 [`docs/superpowers/plans/_index.md`](_index.md)
> §r3 backlog candidates）。**不在 PR-2 scope**——不能在"修 Provider 嵌套"PR
> 里塞别 spec 的 timeout 调整或 cold-compile workaround，审计边界比 cargo-cult
> raise timeout 更值得守。

---

**当前状态（plan 原写法，已被上方 Errata 推翻，保留追溯）**：3 个 e2e spec 在 `main` 上长期红，但 CI 的 verify + e2e job 都报绿——CI 配置 fail-on-error 松了。

- `e2e/experiment-seed.spec.ts:106` —— integer seed flow
- `e2e/experiment-seed.spec.ts:126` —— empty seed key omission
- `e2e/audit-cleanup-coverage.spec.ts:298` —— Cmd+K toggle

**目标**：
1. 三个 spec 各自跑一遍 + 看实际错——是真 bug 还是 dev server flake / 测试本身写错？
2. 真 bug → 修；测试本身错 → 改测；环境性 flake → 标 `.skip` + TODO + 开 issue
3. **CI 配置改 strict**：让 e2e job 真 fail-on-error，确保以后 e2e 红 → CI 红

**验收**：
- `npm run test:e2e` 退出码 0（真过）或 0（带 .skip 标记）——但**不能**绿掉 broken test
- CI workflow `.github/workflows/ci.yml` 的 e2e step 看一眼，确保 `continue-on-error` 没开
- PR description 列每个测试的判断（真 bug / 测试错 / flake .skip）和处理方式

**受影响文件（重新框定）**：
- `e2e/audit-cleanup-coverage.spec.ts`（Cmd+K toggle 加 hydration wait）
- `e2e/copilot-v2.spec.ts`（同隐患，grep 命中）
- `e2e/copilot-v25.spec.ts`（同隐患，grep 命中）
- `playwright.config.ts`（`retries: 0`）
- ~~`.github/workflows/ci.yml`~~ —— 已严，不动

**Branch / commit（重新框定）**：
- branch: `fix/e2e-copilot-cmdk-hydration-race`（语义更准）
- commit a: `fix(e2e): wait for copilot mount before Meta+k to fix hydration race`
- commit b: `chore(ci): set playwright retries to 0 to surface real flake`
- commit c: `docs(plan): r2-followup PR-1 errata — plan stale on 2 of 3 e2e`
- PR description 顶部 `## Plan deviation` 段引用本 Errata

**优先级**：major——本 follow-up 起点，CI 严化的"先决条件"。

---

**受影响文件（plan 原写法，保留追溯）**：
- `e2e/experiment-seed.spec.ts`
- `e2e/audit-cleanup-coverage.spec.ts`
- `.github/workflows/ci.yml`（如发现 fail-on-error 松）
- 真 bug 修复涉及的 src/ 文件（依诊断结果）

**Branch / commit（plan 原写法，保留追溯）**：
- `fix/r2-e2e-real-failures`
- Commit message：`fix(e2e): close 3 pre-existing failures + tighten CI fail-on-error`
- PR description 4 段（改了什么 / 为什么 / 怎么验证 / 向后兼容风险）

**优先级（plan 原写法，保留追溯）**：**blocker**——不修则 PR-2/PR-3 的 CI 信号不可信。

## PR-2：fix/r2-confirm-context-nesting

**当前状态**：`src/app/layout.tsx:80-81` 的 Provider 嵌套顺序错——

```tsx
<ConfirmProvider>           // ← outer
  <CopilotStoreProvider>    // ← inner
    {children}
  </CopilotStoreProvider>
</ConfirmProvider>
```

`ConfirmDialog` mount 时调 `useCopilotOpen()` 会拿到 `createContext` 的 default `{ open: false, width: 0 }`，**copilot 开态下 ConfirmDialog 拿不到 thick glass**（视觉 regression）。

Pre-existing 但 Phase 3 切 Glass primitive 后才暴露——之前 NOOP_STORE 在同位置返 `open=false`，行为等价掩盖了 bug。Phase 3 PR 的 subagent 两次 flag 过这条但未在 plan scope，没改。

**目标**：
1. 调换 Provider 嵌套顺序：`<CopilotStoreProvider>` 包 `<ConfirmProvider>`
2. 加一条 e2e 验证：copilot 开态下打开任一 ConfirmDialog（如删除实验），断言 dialog 元素拿到 `data-glass-variant="thick"`

**验收**：
- 手动验证：打开 copilot panel → 触发任意 ConfirmDialog → dialog 玻璃感正确
- 新加的 e2e spec 通过
- `tsc --noEmit && npm test` 全绿

**受影响文件**：
- `src/app/layout.tsx`（Provider 嵌套换序）
- `e2e/confirm-glass.spec.ts`（新 spec，~30 行）

**Branch / commit**：
- `fix/r2-confirm-context-nesting`
- Commit message：`fix(layout): wrap ConfirmProvider inside CopilotStoreProvider for thick glass`
- PR description 引用 round-2 报告 §第 4 步 Phase 3 反馈 #1

**优先级**：major——Phase 3 自身的 regression。

---

**Execution notes (2026-05-11)**：实施按 plan 走，无偏离。

- **诊断 (Step 1)** 三项检查均干净：(a) ConfirmProvider 自渲染输出里仅 `<Dialog>` 一个 `useCopilotOpen` 消费者；(b) `useConfirm` 6 caller 全在 `{children}` 子树（5 settings 页 + confirm-dialog 自身），CopilotStoreProvider 自渲染部分不调；(c) layout.tsx 没有别的 Provider 同模式 bug——ConfirmProvider 是唯一一个 render 内挂 Copilot consumer 的 Provider，ImageLightboxProvider / Toaster 等都已在 CopilotStoreProvider 内层。
- **改动 (Step 3)** `src/app/layout.tsx` 79-99：`CopilotStoreProvider` 包 `ConfirmProvider`，ImageLightboxProvider 保持在 ConfirmProvider 内（相对位置不动）。
- **新 e2e (Step 4)** `e2e/confirm-glass.spec.ts`：跳到 `/settings/datasets`，hydration gate 等 toggle 按钮可见，A. copilot 关态点删除断 dialog 无 `data-glass-variant` 属性；B. `Meta+K` 开 panel 等 `aria-hidden="false"`，再点删除断 dialog `data-glass-variant="thick"`。
- **稳定性**：retries=0 下 `--repeat-each=10` 全绿。
- **关态 attribute 断言细节**（接受 plan 没写到的）：dialog.tsx:65 `data-glass-variant={copilotOpen ? "thick" : undefined}` 让 React 在关态下不渲染 attribute，因此关态断言必须 `not.toHaveAttribute("data-glass-variant", /.+/)` 而非 `toHaveAttribute(name, undefined)`（后者实际是"attribute 存在且任意值"，假阳性）。
- **Step 5 副作用发现**：跑全 e2e 时 `experiment-seed.spec.ts:106` 在 retries=0 下 ~8% flake——pre-existing、与本 PR 改动无因果（experiment-new 走 `window.confirm`，不经 ConfirmProvider 路径）。已 supplement 到 §PR-1 Errata + 进 r3 backlog（[`_index.md` §r3 backlog candidates](_index.md)）。
- **Step 6 五件套**：`tsc --noEmit` 0 错 / `npm test` 806/806 / `npm run knip` 干净。

## PR-3：chore/r2-followup-cleanup

**当前状态**：9 项零散 cleanup，单独 PR 是过度仪式，凑一个批量。

| sub | 出处 | 改动 |
|---|---|---|
| **a** | Phase 2 #1（A3） | `package.json`：`next` `eslint-config-next` 从 `^16.2.6` 改回 pinned `16.2.6`（lockfile 不动） |
| **b** | Phase 1 #1（B1） | `src/lib/rubric-store.ts:15` 删 dead code 2 行（`if (!fs.existsSync(rubricsDir())) return []`——上面 `ensureDir` 已建过 dir，100% 不可达） |
| **c** | Phase 1 #4（B2） | `package.json` 的 vitest 调用加 `--coverage.reporter=text-summary,json-summary`，避免 100% 覆盖文件被折叠误导 |
| **d** | Phase 1 #6（B3） | Copilot session 客户端 stale localStorage session id 清理（`/api/copilot/sessions/{id}` 404 polling）—— 在 store init 处加 sessionId 存在性 probe |
| **e** | Phase 2 #3a（B4） | `e2e/auth-gate.spec.ts` JSDoc 删 "introduced in fix/auth-gate-rce" 措辞 |
| **f** | Phase 2 #3b（B5） | `src/middleware.ts` JSDoc line 14：把 "curl/agents 是 'none'" 改为准确措辞——curl 实际走 `Sec-Fetch-Site === undefined`（header 缺失），不是 `'none'` |
| **g** | Phase 2 #3c（B6） | `README.md` 部署须知 加一句"PaaS 部署（K8s / Cloud Run / Fly.io）：服务仍绑 localhost，让 PaaS router 做 auth 终结" |
| **h** | Phase 3 #2（B7） | `src/copilot/components/shell.tsx:137` JSDoc "9 档（6 primitive + 3 semantic）" → "7 档（4 primitive + 3 semantic）"，反映 chrome-up/chrome-down 已 inline |
| **i** | Phase 3 衍生（B8） | grep 全库 `9 档` 引用：`grep -rn "9 档" src docs` 一次性同步到"7 档"（除 `docs/superpowers/archive/` 历史 plan 不动——不重写历史） |

**验收**：
- `npm run knip` 干净（exit 0）
- `tsc --noEmit && npm test` 全绿
- `npm run test:e2e` 全绿（PR-1 修完后真信号）
- Build size 不增（baseline 51 MB）
- `grep -rn "9 档" src docs --exclude-dir=archive` 0 命中

**受影响文件**：~9-12 个，零行为变更，doc + dead code + dep pin 为主

**Branch / commit**：
- `chore/r2-followup-cleanup`
- Commit message：单 commit 即可，body 列 9 项 sub-bullet。Subject：`chore(r2): batch follow-up — pin revert + dead code + doc drift`

**优先级**：minor——一个 PR 收尾。

---

**Execution notes (2026-05-11)**：实施按 plan 走，无核心偏离。两点应该追溯：

- **Commit 粒度从 8 → 10**：plan 写"8 commits"，实施落 10。两个新增 commit 都是 plan 没料到的副效应：
  - `c71dde1 chore(copilot): de-export SessionProbeResult` —— sub d 完成后 knip 抓到 `SessionProbeResult` unused exported type；本来 export 是为了让 caller 类型化，但 store.tsx 用 string-literal narrow 不需要导入 type。de-export 即清。
  - `1f857fd chore(deps): sync package-lock.json after next pin revert` —— plan 写"lockfile 不动"是 stale 假设。`npm install` 会把 package-lock.json 顶部 mirror 段（package.json 的 range string 镜像）同步过来；resolved versions / integrity hashes 这些**真**的 dep tree 状态不变。需要 commit 这个 2-line cosmetic sync，否则下一个跑 `npm install` 的 dev 会看到 dirty working tree。
- **Sub i 三层 grep 验收（2026-05-11 与用户落定）**：plan 字面写"`grep -rn "9 档" src docs --exclude-dir=archive` 0 命中"——实施时发现"非 archive 但仍是历史"的命中（review reports / CHANGELOG / specs / past-tense `之前作为...` 注释）很多。与用户对齐"history vs contract"边界，verifier 改为三层口径：(a) Layer 1 contract grep `src/components/glass + src/copilot/components + CLAUDE.md` 排除 `之前` = 0 hit；(b) Layer 2 archive grep 改前后一致 = 3；(c) Layer 3 history grep（review reports / CHANGELOG / specs / active plans / past-tense code）改前后基本一致（PR-3 entry 自身在 CHANGELOG.md 引用 "9 档" 触发 +2，可接受）。
- **Sub d 三态 `SessionProbeResult` 设计选择**：plan 没写实现形态。propose 三态（exists | not_found | unknown）而非 boolean，避免 5xx/network transient 错误清掉 LS 把用户最近 session 指针抹掉。不算 plan deviation——属 AGENTS.md §5 (b) "量化 plan 声明却未具象化的契约"；commit body + CHANGELOG Implementation notes 段都说明了。
- **新发现的 r3 candidate**：(1) **e2e cold-compile flake 扩大**——原 r3 #1 只 `experiment-seed:106` 一条，PR-3 全 suite 实测下扩到 4 条（`experiment-seed:106/:126` + `audit-cleanup-coverage:41/:160`）。共同特征：单 spec 重跑 5/5 全过、全 suite cold compile 时首次 hit 对应路由的 spec 超时。已加进 [`_index.md` §r3 backlog candidates](_index.md)。(2) **npm save-prefix=^ 风险**：sub a pin 后未来 `npm install next` 会重新加 caret，已加进 r3 candidate "考虑 .npmrc save-exact=true"。

## 决策日志：r2 follow-up 不做的项 → r3 backlog

| 项 | 出处 | 为什么不在本轮 |
|---|---|---|
| `parseResponse` 签名收到 `Pick<TaskSchema, ...>` | Phase 1 #2 | Plan-外 refactor。值得做但需要系统性看"项目里还有几处函数吃 `TaskSchema` 但只用 1-2 字段" → r3 spec |
| `/api/datasets` 错误消息 vs lib 内部消息不一致（"Must be a non-empty string" vs "required string"） | Phase 1 #5 | 需先追：是 i18n 翻译层、API route 重写、还是真有两套 validate 路径？追之前不能动 → r3 调查 |
| Plan 写"patch-only"实际跨 minor 的 process drift | Phase 2 #2 | 元教训。下次写 cleanup plan 时改成"patch + 兼容 minor"——属于 spec 撰写约定，写进 AGENTS.md 或 CLAUDE.md "Plan 撰写约定" 一节即可，r3 顺带 |
| `view-helpers.tsx` 独立 GlassVariant 4 变体副本 | Phase 3 #3 | Plan 明确"不动"——给 JSX display helpers 用，不应耦合 semantic colors。强行修反引入新分歧 |
| `NOOP_STORE` 留底 + `createContext` default `width: 0` vs sidebar 420 | Phase 3 #4-#5 | 设计观察。`if (open)` 守卫无伤；NOOP 是测试 / 独立场景兜底。无紧迫修复理由 |

C 类不进 follow-up 的原因统一：**它们是新工作不是 follow-up**。每条都需要独立判断和 spec，混进 cleanup PR 会模糊 scope，未来追溯不知道为什么改的。

## Tag 计划

3 个 PR 全 merge 之后：

```bash
git checkout main && git pull
git tag -a v0.13.1 -m "v0.13.1 · R2 follow-up — CI integrity + Confirm context fix + 9-item cleanup" <merge-commit-sha>
git push origin v0.13.1
```

CHANGELOG `[Unreleased]` 段促进到 `[0.13.1] — YYYY-MM-DD · R2 follow-up`。

GitHub Release 用 CHANGELOG 对应段做 notes。

## 工作流约定

- 严格按 PR-1 → PR-2 → PR-3 顺序，每个独立 merge 之后再开下一个
- 每个 PR description 4 段（改了什么 / 为什么 / 怎么验证 / 向后兼容风险）
- 每个 PR 引用本文档对应小节
- 不要自己 merge，让用户审完再合
- 本 follow-up plan 完成后归档到 `docs/superpowers/archive/2026-Q2/plans/`

## Plan-外原始反馈索引（追溯用）

- Phase 1 反馈：rubric-store dead code / parseResponse 签名 / 3 e2e 真 fail / vitest reporter 折叠 / API-lib 错误消息 / Copilot session 404 噪音
- Phase 2 反馈：npm install caret 副作用 / patch-only-vs-minor / e2e/auth-gate JSDoc / middleware JSDoc / shell.tsx chrome 措辞 / README PaaS / 历史 plan grep / e2e 3 fail（重） / bootCleanupDone / npm audit 待 next 升 / knip ETARGET / 跨 major dep
- Phase 3 反馈：ConfirmDialog Context scope / shell.tsx 9 档 stale / view-helpers GlassVariant 副本 / NOOP_STORE / createContext default width / experiment-seed flake（重）/ load-order flake
