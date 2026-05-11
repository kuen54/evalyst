# Superpowers archive · 历史 plan / spec 索引

`docs/superpowers/` 下的根目录在 Phase F (#5) 之后只保留：

- `plans/_index.md` —— 本文件
- `plans/<active>.md` —— 当前正在执行的 plan（无则空）
- `archive/2026-Q2/` —— 2026-Q2 全部历史 plan / spec / findings

下面按**主题**而非纯时间倒序索引。每行：`[plan](path) ／ [spec](path) — 一句话概括`。

---

## audit-cleanup（2026-05-01 ～ 2026-05-09 · master spec 一份多 phase）

整体审视 + 多阶段修复。Master spec 跨 Phase A-F：

- [Master spec](../archive/2026-Q2/specs/2026-05-09-audit-cleanup-design.md) · 跨 Phase A-F 的 13 项修复 + 跨 PR 依赖图 + tag 建议
- [Master plan (m1-m5 historic)](../archive/2026-Q2/plans/2026-05-01-audit-cleanup-m1-m5.md)
- [code-review report (audit input)](../../code-review-2026-05-09.md) · 起点的审视报告（含 §Errata E1-E5）

Phase 内单项 plan：

- Phase A 止血 #1 [audit-auth-gate-rce](../archive/2026-Q2/plans/2026-05-09-audit-auth-gate-rce.md) · /api/copilot 鉴权门 + RCE 防护
- Phase B 安全网 #7 [audit-batch-runner-unit-tests](../archive/2026-Q2/plans/2026-05-09-audit-batch-runner-unit-tests.md) · batch-runner 单测覆盖
- Phase C 速胜 #8 [audit-phase-c-coordination](../archive/2026-Q2/plans/2026-05-09-audit-phase-c-coordination.md) · Tier 3 batch coordination
- Phase D 类型补网 #4 [audit-tsconfig-strict](../archive/2026-Q2/plans/2026-05-09-audit-tsconfig-strict.md) · strict + exactOptionalPropertyTypes
- Phase E 结构性重构 #2 [audit-copilot-boundary](../archive/2026-Q2/plans/2026-05-09-audit-copilot-boundary.md) · src/copilot/ 子树物理边界
- Phase E #10 [audit-tool-metadata-split](../archive/2026-Q2/plans/2026-05-09-audit-tool-metadata-split.md) · tool metadata 拆 client/server 镜像
- Phase E #9 [audit-batch-runner-file-lock](../archive/2026-Q2/plans/2026-05-09-audit-batch-runner-file-lock.md) · in-memory singleton → 文件锁
- Phase F #5 [audit-doc-split](../archive/2026-Q2/plans/2026-05-09-audit-doc-split.md) · CLAUDE/AGENTS 拆主题 doc + 历史 plan 归档（v0.13.0 收官）

**R2 main (2026-05-10 ～ 2026-05-11 · master spec 一份多 phase)** —— round 2 审视报告 5 项 fix 的执行：

- [Master spec](../archive/2026-Q2/specs/2026-05-10-audit-r2-design.md) · Phase 1/2/3 排序 + 决策日志（哪些不修 + 理由）
- [code-review-round-2 report (audit input)](../../code-review-round-2.md) · round 2 起点的审视报告
- Phase 1 #D [audit-r2-domain-tests](../archive/2026-Q2/plans/2026-05-10-audit-r2-domain-tests.md) · 域核心 4 个 0% 模块单测（datasets / displays / result-parser / rubric-store；ship 在 v0.13.1）
- Phase 2 [audit-r2-phase2-quick-wins](../archive/2026-Q2/plans/2026-05-10-audit-r2-phase2-quick-wins.md) · #C + #B + Tier 3 三批速胜（ship 在 v0.13.2）
- Phase 3 #A [audit-r2-phase3-glass-extraction](../archive/2026-Q2/plans/2026-05-11-audit-r2-phase3-glass-extraction.md) · Glass primitive 切边到 `src/components/glass/`（ship 在 v0.14.0）

**R2 follow-up (2026-05-11)** —— audit r2 主轮 ship 后 14-15 人天累计 13 项 plan-外问题的 patch 收尾：

- [audit-r2-followup plan](../archive/2026-Q2/plans/2026-05-11-audit-r2-followup.md) · 三步走 (PR-1 CI 严化 / PR-2 ConfirmDialog Provider 嵌套 / PR-3 8-item cleanup batch)。Tag v0.14.1 + v0.14.2。详见 plan 顶 Status 表。

Findings：

- [hardcode-audit](../archive/2026-Q2/findings/2026-05-09-hardcode-audit.md) · cwd / model / 写死路径全审

## Copilot 子系统

按版本演进（v1 → v2 → v2.5）：

- [copilot-pr3-tool-calling plan](../archive/2026-Q2/plans/2026-04-28-copilot-pr3-tool-calling.md) ／ [spec](../archive/2026-Q2/specs/2026-04-28-copilot-pr3-tool-calling-design.md) · v1 工具调用闭环（v0.4.0 ship）
- [copilot-context-tool-v2 plan](../archive/2026-Q2/plans/2026-05-03-copilot-context-tool-v2.md) ／ [spec](../archive/2026-Q2/specs/2026-05-03-copilot-context-tool-v2-design.md) · v2 metadata-first 架构 + progressive disclosure（v0.7.0 ship）
- [copilot-page-context-ambient-border plan](../archive/2026-Q2/plans/2026-04-28-copilot-page-context-ambient-border.md) ／ [spec](../archive/2026-Q2/specs/2026-04-28-copilot-page-context-ambient-border-design.md) · 页面 context 漂移光斑边框
- [copilot-v25-m1-context-collapse plan](../archive/2026-Q2/plans/2026-05-07-copilot-v25-m1-context-collapse.md) ／ [v25 followups spec](../archive/2026-Q2/specs/2026-05-07-copilot-v25-context-followups-design.md) · v2.5 context 折叠
- [copilot-v25-p0-ccb-hermes-openclaw-adoption plan](../archive/2026-Q2/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md) ／ [spec](../archive/2026-Q2/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md) · CCB / Hermes / OpenClaw 适配
- [copilot-image-vision plan](../archive/2026-Q2/plans/2026-05-09-copilot-image-vision.md) ／ [spec](../archive/2026-Q2/specs/2026-05-09-copilot-image-vision-design.md) · 图像理解 vision-gate
- [tool-result-content-array finding](../archive/2026-Q2/findings/2026-05-09-tool-result-content-array.md) · OpenAI tool_result content array 探查

## Glass UI / 视觉系统

- [copilot-glass-system plan](../archive/2026-Q2/plans/2026-04-28-copilot-glass-system.md) ／ [spec](../archive/2026-Q2/specs/2026-04-28-copilot-glass-system-design.md) · 9 档玻璃梯度系统
- [copilot-material-reveal plan](../archive/2026-Q2/plans/2026-04-29-copilot-material-reveal.md) ／ [spec](../archive/2026-Q2/specs/2026-04-29-copilot-material-reveal-design.md) · Material reveal cascade
- [theme-cascade plan](../archive/2026-Q2/plans/2026-04-30-theme-cascade.md) ／ [spec](../archive/2026-Q2/specs/2026-04-30-theme-cascade-design.md) · Copilot 模式主题层叠

## 评测能力

- [image-generation-eval plan](../archive/2026-Q2/plans/2026-05-08-image-generation-eval.md) ／ [spec](../archive/2026-Q2/specs/2026-05-08-image-generation-eval-design.md) · 图像生成评测路径

---

## r3 backlog candidates

下一轮 audit (r3) 需诊断/修复，**不**在 r2 follow-up scope 内。每条配出处链接，给下一轮起手即可看清来龙去脉。

- [x] **`experiment-seed.spec.ts:106` retries=0 下 ~8% 本机 flake**（诊断 + 修） — 闭环于 PR #__ (`fix/r3-e2e-cold-compile-flake`)。
- [x] **e2e cold-compile flake 范围扩大**（统一诊断 + 修）—— 同上 PR 闭环。诊断揭示**三 root cause**：(a) `/experiments/[id]` / `/settings/displays/new` / `/settings/templates/new` 并发 cold compile 4.999 s 贴 5 s spec timeout；(b) multi-worker browser context 在 macOS 抢 CPU/IO（实测 workers=2 反而 33% flake，workers=1 100%）；(c) **brief 没预期的第三层** — `experiment-seed.spec.ts:106/126` 的 `clickRun` 早于 `/api/schemas` (real backend ~292 ms) + `/api/llm-config` (mocked ~50 ms) mock fulfill，导致 handleSubmit 在 `schema`/`selectedModel` undefined 时 early-return（schema 是静默 return，model 是 alert + return），navigation 永不发生。修法：globalSetup prewarm + cap local workers=1 + 两条 spec click 前 `await Promise.all([waitForResponse(schemas), waitForResponse(llm-config)])`。详见 CHANGELOG `[Unreleased]` Fixed 段。
- [x] **方法论补丁**：standing rule 加一条"标 pre-existing test '已绿' 前必须 `--repeat-each` ≥ 5 stress-test"——闭环于 PR #__ (`docs/r3-methodology-batch`)，落到 AGENTS.md §6。
- [x] **npm save-prefix=^ 自动 caret 风险**（评估 + 决策）—— PR-3 sub a 给 `next` + `eslint-config-next` 改回 pinned `16.2.6`，但 npm 默认 save-prefix=^ 仍生效。考虑加 `.npmrc save-exact=true` 永久禁 caret（影响所有依赖；trade-off 是新增 dep 默认 pinned 不再"接受 minor"）；或继续靠 review 拦截。**决策（2026-05-11，闭环于 PR #__ `docs/r3-methodology-batch`）：方向 B · 不加 `.npmrc`。** 理由：
  1. **行业信号混合**：抽 4 个对照 TS 项目——`vercel/next.js` 用 `save-exact=true`（已发布框架，CI 可重现性极敏感）；`shadcn-ui/ui` `.npmrc` 仅 `auto-install-peers + link-workspace-packages` 无 save-exact；`TanStack/query` `.npmrc` 仅 `provenance=true`；`vitejs/vite` 根本无 `.npmrc`（默认 caret）。3/4 工具/库级项目跳过 save-exact；evalyst 跟它们而非 Next.js 框架级。
  2. **scale 适配**：evalyst 直接 dep 仅 18 个，单作者每 PR 都自审。review 通道高带宽、PR-3 实例已成功拦下 caret 漂移；无 process 缺口需 `.npmrc` 兜底。
  3. **caret 默认有正向价值**：`lucide-react` / `nanoid` / `@babel/standalone` 等小 dep 的 patch / minor 自动跟随是 npm 生态主流惯例。Save-exact 全局生效会把"所有新增 dep 默认接受 minor"这个上游标准也禁掉，over-correct。
  4. **Next.js 是个例外**：未来若再有 dep 出现 minor breaking（类似 Next.js 16.2 → 16.3），按 PR-3 同样模式逐 dep 在 `package.json` 显式 pin（不依赖 `.npmrc`）。
- [x] **"patch + 兼容 minor" plan 撰写约定**（出处：r2-followup §C #3 / code-review-round-3 §第 4 步 #7）—— 闭环于 PR #__ (`docs/r3-methodology-batch`)，落到 AGENTS.md §6。cleanup plan 写 dep 升级 scope 时不再用 "patch-only"，改用 "patch + 兼容 minor" 或拆 PR。

---

## 索引说明

- 当前 active plan 在 `plans/` 根（与 _index.md 同级），完成后移到 `archive/<period>/plans/`
- 跨多 plan 的 master spec（如 audit-cleanup）所有 phase plans 完成后才移到 archive
- 历史 plan 即使涉及未完成的子项也直接归档；新 PR 接力时再开新 plan
- `archive/<period>/` 命名约定：`<YYYY-Qn>` 季度切（2026-Q2 指 2026 年 4-6 月）；下季度新增 `archive/2026-Q3/`
