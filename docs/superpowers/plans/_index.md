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
- Phase F #5 audit-doc-split （**当前**） · `../plans/2026-05-09-audit-doc-split.md`

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

## 索引说明

- 当前 active plan 在 `plans/` 根（与 _index.md 同级），完成后移到 `archive/<period>/plans/`
- 跨多 plan 的 master spec（如 audit-cleanup）所有 phase plans 完成后才移到 archive
- 历史 plan 即使涉及未完成的子项也直接归档；新 PR 接力时再开新 plan
- `archive/<period>/` 命名约定：`<YYYY-Qn>` 季度切（2026-Q2 指 2026 年 4-6 月）；下季度新增 `archive/2026-Q3/`
