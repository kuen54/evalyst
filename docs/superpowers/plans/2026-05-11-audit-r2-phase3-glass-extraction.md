# Audit R2 · Phase 3 · Glass Primitive 切边 (#R2-A)

> Master spec [`../specs/2026-05-10-audit-r2-design.md`](../specs/2026-05-10-audit-r2-design.md) §Phase 3。把 Glass UI primitive 从 `src/copilot/components/` 搬到 `src/components/glass/`，切在 import 方向而非路径上。

## 设计决策 · Minimal Context（确认采用）

**调研事实**（不是猜测）：

- `src/copilot/components/{shell,sticky-chrome,glass-segmented}.tsx` 三件套**只读 store 的 `open` 字段**（shell:142 / sticky-chrome:39,60 / glass-segmented 间接）
- 域 UI 6 处 `useCopilotStore` 调用：5 处只取 `open`（`ui/button.tsx` / `ui/dialog.tsx` / `ui/select.tsx` / `results/display-jsx.tsx` ×2 hooks / `app/compare/page.tsx` ×2 hooks）；1 处取 `open + width`（`components/sidebar.tsx`，给 theme cascade 用）
- 内部 test：`src/copilot/components/__tests__/shell.test.ts` 只调 pure 函数 `getGlassStyleForVariant`，无 store 依赖
- 域内独立 `GlassVariant` 类型在 `src/components/results/view-helpers.tsx:8`（4 变体），无跨文件 import——不动

**采纳方案 (option c)**：单 context struct、**两 hook 分拆**。

```ts
// src/components/glass/copilot-context.tsx（新）
const CopilotShellContext = createContext<{ open: boolean; width: number }>({ open: false, width: 0 })
export const CopilotShellProvider = CopilotShellContext.Provider
export function useCopilotOpen() { return useContext(CopilotShellContext).open }            // 5 处
export function useCopilotPanelWidth() { return useContext(CopilotShellContext).width }     // sidebar 1 处
```

理由（取舍非 bikeshed）：

- **消费者按需**：5 个只取 `open` 的站点不应看到 `width`——读它们的人不必想"为什么这里有 width，我用了吗？"
- **特殊情况收编**：sidebar 不是"例外"，是不同 hook 的合法消费者（Linus "no special cases" 满足）
- **未来抗压**：Glass 真需要 Copilot 别状态时加 `useCopilotXxx()` 第三 hook 是干净增量；扩 struct 是 grow-into-store 滑坡

Provider 单一 `{ open, width }`，两 hook 拆 selector，re-render 同单 hook（同 context 同时变更）。`store.tsx` 在现有 `<CopilotCtx.Provider>` 内层包 `<CopilotShellProvider value={shellState}>`（`useMemo` deps `[open, width]`）。createContext 默认值代替 `NOOP_STORE` 兜底。`width` 进 minimal context 是因 sidebar 是唯一需 `width` 的 domain UI（theme cascade 起点公式），收编进新接口比留 useCopilotStore 例外干净——验收硬指标 `useCopilotStore in domain UI == 0` 也只能这么过。

## Baseline Grep（PR 2 验证基线，已存 `/tmp/r2a-baseline.txt`）

```
$ grep -rln "@/copilot/components/\(shell\|sticky-chrome\|glass-segmented\)" src/components src/app/{settings,page.tsx,layout.tsx,experiments,compare} | wc -l
31    # 4 shadcn ui + 18 components/* + 9 app pages
$ grep -rln "@/copilot/components" src/components src/app | wc -l
39    # 31 + 6 useCopilotStore + 2 真 Copilot 触点（panel/store/use-page-context 等）
```

## PR 1 · introduce-new （~0.75d，branch `refactor/r2a-glass-introduce`）

**Scope**：

1. 新文件 4 个：`src/components/glass/copilot-context.tsx` / `shell.tsx` / `sticky-chrome.tsx` / `glass-segmented.tsx`。从老文件搬过来，`useCopilotStore` 替换为 `useCopilotOpen`。
2. `src/copilot/components/store.tsx` `useMemo` 内多算 `shellState = { open, width }`，外层 `<CopilotShellProvider value={shellState}>` 包住既有 Provider 内的 children。
3. 老 `src/copilot/components/{shell,sticky-chrome,glass-segmented}.tsx` 改成 re-export shim：单行 `export * from "@/components/glass/{...}"`。**40+ 现有 import 路径不变仍工作**。
4. Test 跟搬：`src/copilot/components/__tests__/shell.test.ts` → `src/components/glass/__tests__/shell.test.ts`（import 改 `../shell`）。
5. **PR 1 不动 sidebar.tsx**——它仍 `useCopilotStore`（通过 NOOP/真 Provider 路径都还活）；sidebar 切换到 `useCopilotPanelWidth` 在 PR 2 的 bulk migrate 一起做，不分两次动。

**验收**：
- `npx tsc --noEmit && npm test && npm run knip && npm run test:e2e` 全绿
- 手动 ⌘K 在 dashboard / `/settings/templates` / `/experiments/[id]` 三页切玻璃态视觉无回归
- `useCopilotOpen` 和 `useCopilotPanelWidth` 两个 export 都在 `src/components/glass/copilot-context.tsx`，PR 1 sidebar.tsx 文件修改 = 0
- CHANGELOG `[Unreleased]` 加 `### Refactor`：`提取 Glass primitive 到 src/components/glass/ + 引入 useCopilotOpen / useCopilotPanelWidth 最小接口 (#R2-A PR 1/3)`

## PR 2 · migrate-imports （~0.5d，branch `refactor/r2a-glass-migrate-imports`）

**Scope**（纯路径 / 名替换、不动行为）：

1. 31 个 baseline 站点：`@/copilot/components/{shell,sticky-chrome,glass-segmented}` → `@/components/glass/{shell,sticky-chrome,glass-segmented}`。
2. 6 处 `useCopilotStore` 切换：
   - `ui/button.tsx` / `ui/dialog.tsx` / `ui/select.tsx` / `results/display-jsx.tsx` / `app/compare/page.tsx` → `import { useCopilotOpen } from "@/components/glass/copilot-context"`，`const copilotOpen = useCopilotOpen()`
   - `components/sidebar.tsx` → `import { useCopilotOpen, useCopilotPanelWidth } from "@/components/glass/copilot-context"`，`const copilotOpen = useCopilotOpen()` + `const copilotWidth = useCopilotPanelWidth()`
3. 可写脚本辅助（sed），逐文件 git diff 复核。

**验收硬指标**：

```
grep -rln "@/copilot/components/\(shell\|sticky-chrome\|glass-segmented\)" src/components src/app | wc -l   # → 0
grep -rln "useCopilotStore" src/{components,app/settings,app/page.tsx,app/layout.tsx,app/experiments,app/compare} | wc -l   # → 0
```

`npx tsc --noEmit && npm test && npm run knip && npm run test:e2e` 全绿；手动 ⌘K 同 PR 1 三页视觉无回归。CHANGELOG 加 `迁移 31 站点 + 6 useCopilotStore 引用到 src/components/glass (#R2-A PR 2/3)`。

## PR 3 · delete-shims （~0.25d，branch `refactor/r2a-glass-delete-shims`）

**Scope**：删 `src/copilot/components/{shell.tsx, sticky-chrome.tsx, glass-segmented.tsx}` 三个 re-export shim。

**验收硬指标**：

```
grep -rln "@/copilot/components" src/components src/app | wc -l   # ≤ 5
   # 剩下应为：app/layout.tsx (panel/store/inspector/...) + compare/page.tsx 等用 use-page-context 的真 Copilot 触点
```

`npx tsc --noEmit && npm test && npm run knip && npm run test:e2e` 全绿；视觉同前。再跑一次 `npx vitest run --coverage`，验域 `lib/` stmts ≥ 75%（Phase 1 baseline 不退）。CHANGELOG 加 `删除 Copilot 子树下 Glass primitive shim (#R2-A PR 3/3) — 完成 Phase 3 #R2-A`。

## 不在 scope（严禁顺手做）

- `src/copilot/components/use-page-context.ts` 留 copilot 子树（真 Copilot 集成）
- `panel.tsx` / `chat-view.tsx` / `tool-call-card.tsx` 等业务组件不动
- Glass primitive 视觉/动画/参数零变更（纯结构）
- `CopilotStore` shape 不改，只外层加 `CopilotShellProvider`
- `view-helpers.tsx` 的独立 `GlassVariant` 类型不动
- 决策日志列的"不修"项（applyTransforms / validateJson / use-client / `as unknown as`）一概不碰

## 工作流

3 PR **严格串行**，上一个 merge 才开下一个。每 PR 跑 5 件套（`tsc --noEmit && npm test && npm run knip && npm run test:e2e`）+ 手动 ⌘K 视觉。PR description 4 段（改了什么 / 为什么 / 怎么验证 / 兼容风险）。**作者不自合**——3 PR 全 merge + 实测稳定后由用户打 v0.14 收官 tag。
