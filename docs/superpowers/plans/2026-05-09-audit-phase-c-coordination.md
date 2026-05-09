# Plan · Phase C 协调（#3 + #8 + Tier 3）

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase C
> 三个独立 PR，按本协调文件排序依次走

## 1. 推荐执行顺序

**`fix/cartesian-cap` (#3) → `feat/experiment-seed` (#8) → `chore/audit-cleanup` (Tier 3)**

Rationale：
- #3 / #8 是"加功能"，先做让 baseline 更完整；Tier 3 最后含 CI lint `continue-on-error → fail`，放最后 #3 / #8 不必先修历史 warning。
- #3 改交互（estimate 路径 + confirm dialog），diff 大、rebase 风险高，**先合**。
- #8 加字段纯增量，rebase #3 trivial。
- Tier 3 删 / 改最杂，放最后吃前两个的 rebase 成本最低。
- 备选 A（Tier 3 先 + lint 改造单拆 PR 最末）和备选 B（任意顺序 + rebase）都 OK，但默认走主推顺序。

## 2. 冲突点 + mitigation

- `src/app/experiments/new/page.tsx` 同被 #3 (confirm dialog) + #8 (seed 字段) 改 → **#3 先合，#8 `git rebase main` 解；纯字段加，rebase trivial**。
- `src/lib/i18n/{zh,en}.ts` 同上 → 加 key 不互覆盖，rebase 自动合。
- `src/lib/types.ts:5` Tier 3 删 11 项 unused re-export ↔ #8 加 `ExperimentConfig.seed?: number`：不同位置不冲突。**Tier 3 改前必须 grep 验证 #8 没新依赖任何被删 re-export**。
- Tier 3 删 `src/lib/copilot/manifest.ts` unused interface → 不影响 #3 / #8。
- Tier 3 改 CI lint `continue-on-error → fail` → 此 PR **合后**所有后续 PR 必须 zero warning；放最末，前置 PR 不受影响。

## 3. 每项 PR 名 + 验收

- **`fix/cartesian-cap`**：`estimateTaskCount(3 alias × 1k records) < 10ms` / 100k 抛 `TOO_MANY_TASKS` / 5001 task 表单弹 confirm dialog / `schema/__tests__/cartesian-cap.test.ts` 通过 / tsc + test + build 全绿。
- **`feat/experiment-seed`**：OpenAI body 透传 `seed`（不是 silent drop）/ Anthropic warn+drop / UI 表单字段 "Seed (optional)" / `lib/__tests__/llm-client-seed.test.ts` 通过 / e2e smoke 不退化。
- **`chore/audit-cleanup`**：knip 0 unused（worktrees ignored）/ `npm run lint` 0 warning / tsc + test + build 全绿 / git diff 仅限 spec §Tier 3 列出的 10 项。

## 4. Phase C 完工总验收

3 PR 全合 → 建议 tag `v0.11.0 — security blockers (Phase A) + cartesian cap + seed + cleanup`，CHANGELOG `[Unreleased]` 整理为 v0.11.0 section（参 AGENTS.md §CHANGELOG 规范）。

## 5. 风险

- **R1（中）**：Tier 3 改 `continue-on-error → fail` 后历史 warning 暴露 → 开工前先 `npm run lint` 看数量；> 50 立即停下问用户，可能要再拆 `chore/lint-fix` 单 PR，不默默修一晚上。
- **R2（低）**：#3 confirm 阈值 5000 是 spec 拍脑袋数；UX 没研究，先用，CHANGELOG 备注"阈值待真实使用调"。
- **R3（中）**：#8 OpenAI seed 透传——并非所有 OpenAI 兼容 gateway 接受 `seed`（DeepSeek / 沿海机房有差异），失败时让 LLM 报 400 直接进 result.error，**不做** silent drop（Anthropic 才 silent drop）。`lib/__tests__/llm-client-seed.test.ts` 必须覆盖"OpenAI 透传"和"Anthropic warn+drop" 两条分支。

## 6. 边界 / 禁区（实施提醒）

- 3 项**独立 PR**，不打包成 megaPR
- Tier 3 不动 `batch-runner.ts`（Phase B export exception 是孤例）
- Tier 3 不碰 Copilot 文件（除 `manifest.ts` 删 unused interface）—— 切边是 Phase E
- 实施中发现 spec / 本 plan 有错 → 直接说 + 更新 doc，不硬塞代码
- 每 PR 本地验证 `npx tsc --noEmit && npm test && npm run build`，UI 改动加 `npm run test:e2e`
- **不自合 PR**，每个 push 后等用户 review
