# Glass UI 系统（4 primitive + 3 semantic）

> 本 doc 解释 Copilot 打开态下的 7 档玻璃约定（4 primitive + 3 semantic）+ tinted 名额规则 + 轻量 alpha 配方 + 可访问性降级。Copilot 子系统的工具协议 / 交互见 [`../copilot.md`](../copilot.md)；项目整体架构见 [`../architecture.md`](../architecture.md)。Spec 全文：`docs/superpowers/archive/2026-Q2/specs/2026-04-28-copilot-glass-system-design.md`；实施计划：`docs/superpowers/archive/2026-Q2/plans/2026-04-28-copilot-glass-system.md`。

Copilot 打开时，**主内容区**统一切换到"玻璃梯度"视觉语言（关闭时恢复 shadcn 扁平）。设计参考 Apple HIG Materials + Liquid Glass + MD3 elevation。

## 7 档梯度（4 primitive + 3 semantic）

**Primitive（材质 + 高度 + 基础配色）**：

| 档 | blur | bg opacity (亮) | 典型角色 |
|---|---|---|---|
| **thin** | 16px | 8% | 数据密集行级卡 / 表格单元格 |
| **regular** | 28px | 35% | 页面主外壳 + 内容卡（默认档） |
| **thick** | 40px | 55% | 浮层（Dialog / Select content / 自建 popover） |
| **tinted** | 28px | 35% + accent 22% | primary CTA / segmented selected / active tab |

> Sticky 顶/底结构条（compare header / StickySaveBar 等）之前是 9 档玻璃的 chrome-up / chrome-down 两档，R2 #T3 因各只 1 个调用点 inline 进 `src/copilot/components/sticky-chrome.tsx` —— 用 `<GlassStickyHeader>` / `<GlassStickyFooter>` 而非 `useGlassStyle("...")`。

**Semantic（Regular 材质 + 语义 border + 语义 ambient shadow）**：

| 档 | 语义色 (oklch) | 典型角色 |
|---|---|---|
| **success** | emerald-500 `oklch(0.696 0.17 162.48)` | 正向状态卡（Scoring Collapsible 等） |
| **warning** | amber-500 `oklch(0.769 0.188 70.08)` | 提示 / 引导 banner（AgentHintBanner 等） |
| **danger** | red-500 `oklch(0.637 0.237 25.33)` | 错误 / 警告卡（FailedPanel 等） |

Semantic 档的 border 色 class（如 `border-emerald-200/60`）要**保留在 className 上**，作为 copilot 关闭态（shadcn 扁平）下的 border fallback——inline `borderColor` 只在 copilot 开时生效。

组件 `GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted` / `GlassCard` / `GlassCardThin` / `GlassSuccess` / `GlassWarning` / `GlassDanger` 从 `@/copilot/components/shell` 导出。`GlassStickyHeader` / `GlassStickyFooter` 从 `@/copilot/components/sticky-chrome` 导出。`GlassSegmentedItem` 从 `@/copilot/components/glass-segmented` 导出。非 JSX 场景用 `useGlassStyle(variant)` hook 取 `CSSProperties`。

## `--copilot-accent` 而非 `--primary`

项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 基本 = 灰）。`bg-primary/10` 做激活染色出来灰扁不像"亮"。`--copilot-accent: oklch(0.76 0.16 225)` (sky blue, 与 glow 主色呼应) 才是 Tinted 和激活态的正确色。**动 copilot 玻璃 / segmented / primary CTA 染色时都用 copilot-accent，不要 primary。**

## Segmented 选中态

**`<GlassSegmentedItem>` (`src/copilot/components/glass-segmented.tsx`)** 是 segmented control / active tab / nav item 的统一组件。通过 `render` prop 支持 `<button>` / `<Link>` / `<a>` 等任意底层 element：

```tsx
<GlassSegmentedItem active={isActive} className="p-3 text-left" render={<button type="button" onClick={...} />}>
  ...
</GlassSegmentedItem>
```

- copilot 关 → 回退 shadcn 扁平（`border-foreground bg-accent/70` / 普通 border）
- copilot 开 → active 走 Tinted 配方 + accent 发光边 + accent ambient shadow（"发光"而非"染色"）；inactive 走 Thin 配方

`src/lib/segmented.ts` 的 `segmentedItem(active)` helper 只处理 copilot 关闭态的 class（给 `sidebar.tsx` / `copilot/session-list.tsx` 这种"永远不走玻璃"的位置用）。**新 segmented 调用点请一律用 `<GlassSegmentedItem>`**，不要再手写 `useGlassStyle("thin/tinted")` + `data-glass-variant` 三件套。

## 玻璃作用域（**重要**）

**只有页面中间内容区玻璃化**。以下明确**不走玻璃，保持 shadcn 扁平**：

- **Sidebar** —— 左侧主导航。`bg-muted/20` 实底
- **Copilot panel 自身 + 内部**（session-list / chat-view 按钮 / textarea）—— 右侧 copilot 区
- **Toast / Sonner** —— HIG 明确 toast 不玻璃
- **Textarea / Input / Code 内部** —— 阅读密集

**例外**：带语义色的状态卡（Scoring / FailedPanel）和通知 banner（AgentHintBanner）通过 `GlassSuccess` / `GlassDanger` / `GlassWarning` **走玻璃 + 语义 border + 语义 ambient shadow**，而不是扁平 —— 这是 2026-05 统一的规则（原"amber banner 不玻璃"约定已废除）。copilot 关闭时 fallback 到 class 级 `border-amber-200 bg-amber-50/50` 等 shadcn 扁平。

中间内容区触发的**浮层**（Dialog / Select content / compare 的 PromptInfoIcon / custom popover divs）保留 Thick 玻璃，因为它们视觉上是"在中间渲染的浮层"。

## JSX display 兼容

用户自建的 JSX display（`display.mode === "jsx"`）源码里如果写死了 `bg-card`，copilot 打开也是实底。解决方式：`makeHelpers({ open, styles })` 暴露 `helpers.glassStyle(variant)` + `helpers.glassAttr(variant)`，用户源码按 pattern 应用：

```js
const { readField, Badge, glassStyle, glassAttr } = helpers;
React.createElement('div', {
  className: 'border rounded-lg p-3 bg-card',     // copilot 关走实底
  style: glassStyle('regular'),                    // copilot 开走玻璃（关时 undefined）
  'data-glass-variant': glassAttr('regular'),      // 供 a11y 媒介查询选择器用
}, children)
```

已改好参照：`data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`。新建 JSX display 必须带这个 pattern。

## 可访问性

`src/app/globals.css` 尾部 3 条媒介查询降级：
- `prefers-reduced-transparency: reduce` → 全部玻璃降为实底 `var(--card)`
- `prefers-contrast: more` → 实心 + 更强描边
- `prefers-reduced-motion: reduce` → 关 press-squish / hover-lift / scroll-edge 动画

玻璃组件必须挂 `data-glass-variant` 属性才能被这三条规则选中降级。`makeGlass` 工厂自动挂。手写 inline glass style 时记得带 `data-glass-variant={copilotOpen ? "regular" : undefined}`。

## 主 CTA 约定（**一页一个 tinted 名额**）

页面上承担**主动作**（"开始 / 保存 / 创建 / 运行"）的 CTA 用 `<Button variant="tinted">`，让用户一眼看到"这里点"。**严格规则：一个页面同时只能有一个 tinted 主 CTA**，不然"主"的信号稀释。具体裁定：

**占名额的位置**：
- `<Button variant="tinted">`
- `<GlassSegmentedItem>` 里当前 active 的那一项（玻璃 active tinted，属于"tab 级视觉主角"）

**不占名额的位置**：
- Sidebar 导航 active 项 —— `segmentedItem(active)` 硬编 shadcn 扁平，永不 tinted
- Copilot panel 内部的任何高亮 —— 永远扁平

**裁定表（现状 2026-05-06 PR 3 后）**：

| 页面 | 名额占用 | 主 CTA |
|---|---|---|
| `/` dashboard | 无 | 顶栏"新建实验" tinted；空态同文案 **outline**（避免两个 tinted） |
| `/experiments/new` | 无 | "开始实验" tinted；"保存为草稿" outline |
| `/experiments/[id]` | 无 | Run / Resume 互斥显示 tinted；Pause / Retry outline |
| `/compare` | 无 | 无主 CTA |
| `/settings/**`（layout 带 RelationDiagram） | ✅ RelationDiagram 当前 tab tinted | 顶栏"新建"保持 `default`；StickySaveBar 保存保持 `default`；详情页"编辑"保持 `default` —— 全部**不加 tinted** |

**互斥显示的按钮可共享名额**（如 Run / Resume / Pause / Retry 按 experiment.status 互斥渲染，同时只出现一个，共用一个 tinted 名额不算违反）。

**新加按钮的决策流**：
1. 这是"主动作"吗？否 → `default` / `outline` / `ghost`
2. 是主动作。看所在页的名额状态（先查 RelationDiagram tab / 既有 tinted）
   - 已有 → **保持 default**（让名额归首个占位者）
   - 没有 → `tinted`

## 轻量 tinted 表面（badge / inline 状态行 / 错误小格 / 软提示）

不占据 7 档玻璃档位，但仍需要在 dark mode 表现正常。**统一走 alpha 配方**，不要写 `bg-{color}-50` / `border-{color}-200`：

```
✅ bg-{color}-500/10  border-{color}-500/30–40  text-{color}-700 dark:text-{color}-300
❌ bg-{color}-50      border-{color}-200        text-{color}-700              # dark 模式刺眼，无 dark: 兜底
```

为什么 alpha 配方在两边都对：`/{X}` 透明度叠在 `bg-card` 之上，亮模式 card 是白 → 看到淡彩；暗模式 card 是深灰 → 看到柔和深彩。文字色 `text-X-700`/`dark:text-X-300` 一对足够保对比度。

**适用范围**：
- Schema 徽章池（`src/app/page.tsx` SCHEMA_COLOR_POOL）
- Results 4 件套里 `r.status !== "success"` 的错误格（`dual-list-results` / `triple-grid-results` / `display-grouped-grid` / `display-table` / `display-jsx`）
- Compare 错误格 / JSON paste 校验提示 / Template 表单粘贴预览
- 凡是「带语义色但不需要整张 GlassDanger/GlassWarning/GlassSuccess 卡」的小区域

**不适用**：
- 状态指示点（如 dashboard `bg-green-500` / `bg-amber-500`）—— 500 tier 是中饱和，亮暗都 OK
- 整张状态卡 / 整段 banner —— 走 `<GlassSuccess>` / `<GlassWarning>` / `<GlassDanger>`
- copilot tool-call-card 的 confirm/denied 框 —— 已经走 alpha 配方
