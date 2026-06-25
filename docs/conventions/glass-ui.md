# Glass UI 系统（4 primitive + 3 semantic）

> 本 doc 解释 Copilot 打开态下的 7 档玻璃约定（4 primitive + 3 semantic）+ tinted 名额规则 + 轻量 alpha 配方 + 可访问性降级。Copilot 子系统的工具协议 / 交互见 [`../copilot.md`](../copilot.md)；项目整体架构见 [`../architecture.md`](../architecture.md)。Spec 全文：`docs/superpowers/archive/2026-Q2/specs/2026-04-28-copilot-glass-system-design.md`；实施计划：`docs/superpowers/archive/2026-Q2/plans/2026-04-28-copilot-glass-system.md`。

Copilot 打开时，**主内容区**统一切换到"玻璃梯度"视觉语言（关闭时恢复 shadcn 扁平）。设计参考 Apple HIG Materials + Liquid Glass + MD3 elevation。

## 7 档梯度（4 primitive + 3 semantic）

**Primitive（材质 + 高度 + 基础配色）**：

| 档 | blur | bg fill 亮 / 暗 | 典型角色 |
|---|---|---|---|
| **thin** | 14px | 6% / 3% | 数据密集行级卡 / 表格单元格 |
| **regular** | 20px | 20% / 11% | 页面主外壳 + 内容卡（默认档） |
| **thick** | 28px | 30% / 19% | 浮层（Dialog / Select content / 自建 popover） |
| **tinted** | 20px | accent 13% / 9% 透底 | primary CTA / segmented selected / active tab（对齐 GlassSegmentedItem active 发光带） |

> **bg fill 是 mode-aware `light-dark(亮%, 暗%)`**：每档 `backgroundColor` 用纯 inline `light-dark()` 表达式 —— `layout.tsx` 的 `<ThemeProvider>` 没传 `enableColorScheme`，next-themes 默认 `true` → 把 `color-scheme: light|dark` 写到 `<html>`，`light-dark()` 因此按当前主题解析正确分支，**零 globals.css 改动、不需要 `.dark`-keyed CSS-var fallback**。两档不是同一个值的明暗复制，而是 mode-tuned：
> - **亮模式 = clean white frost，克制**（`var(--card)`）：thin 6% / regular 系 20% / thick 30% / tinted(accent) 13% / sticky 26% / hero 27% / semantic 20%。
> - **暗模式 = 更透**（`var(--card)`）：thin 3% / regular 系 11% / thick 19% / tinted(accent) 9% / sticky 17% / hero 23%。
>
> **WHY**：近白 LIGHT 底上，透明白 fill 要么读成奶白（太高）要么消失（太低），所以亮模式用 clean restrained 白霜；DARK 底 + ambient glow 下更透让 glow 透出来。**两条都试过且都已 REVERTED**：「中性灰 tint」把 glow 搅浑、「multiply-glow 染色衬底」过饱和 / 伤可读性。glow / 背景维持 baseline 的 calm pastel，`globals.css` 与 main 一致**不动**。
>
> Sticky 顶/底结构条（compare header / StickySaveBar 等）之前是 9 档玻璃的 chrome-up / chrome-down 两档，各只 1 个调用点 inline 进 `src/components/glass/sticky-chrome.tsx` —— 用 `<GlassStickyHeader>` / `<GlassStickyFooter>` 而非 `useGlassStyle("...")`。Sticky 条 bg light 26% / dark 17%（两分支都比 regular 高一档，悬在滚动内容上方要有材质区隔），blur 20 + brightness(1.06) contrast(1.05)。
>
> hero（一页一个的加重外壳，`GlassHero`，不进 7 档 union）：blur 36（全系最重的 blur，单页一个外壳成本可忽略）+ bg light 27% / dark 23%（两分支都比 regular 实一档）+ brightness(1.10) contrast(1.03)。

**blur（mode-agnostic）**：thin 14 / regular 20 / thick 28 / sticky 20 / hero 36 / tinted 20。沿系统演进从初始的 16 / 28 / 40 降下来 —— blur = paint 成本，**只降不升**（再降会杀掉玻璃质感）；数据密集 thin 一页数百张更要守。

**luminance（backdrop-filter）**：regular `brightness(1.08) contrast(1.04)` · thick `brightness(1.12) contrast(1.05)` · thin `brightness(1.07)` · hero `brightness(1.10) contrast(1.03)` · sticky `brightness(1.06) contrast(1.05)`；saturate 1.25–1.35。这是色矩阵 compositor-only 操作（不开新 paint buffer，近乎免费），补上 saturate 之外的「透亮」杠杆。**暗模式 legibility 钳制**：`brightness()` 会把已近白的渐变核进一步推白、压扁浅灰 muted text 的 ΔL —— 所以 regular/semantic brightness 收在 **1.08**（不顶满 1.10）、sticky 收在 **1.06**，改让 `contrast` 担可读性主力。thick 不受钳制（正文是近白 card-foreground，headroom 足）。

**统一标尺（Track A premium-edge）**：切边语言是**方向性 rim** —— 左上提亮 + 右下压暗的内描，模拟玻璃斜切边吃光（光源默认左上，与 copilot-glow 四角光呼应）。final 态 rim 是 **hairline feathered** 软细线：`RIM_THIN` / `RIM_REGULAR` / `RIM_THICK` 用 **1px（thick 2px）BLURRED inset**（modest α 的左上高光 + 白顶线 + 一道极淡白底落地线）。**右下黑切边层在大档全部 DROP**（regular / thick / tinted / semantic / sticky 去掉最弱的 `inset -1px -1px ... oklch(0 0 0 / α)`，避免读成生硬「贴纸轮廓」）；**只有 thin 保留**它自己的右下暗 inset —— 数据密集档无白底落地线，需第三条 offset 闭合 corner。仍是 1-2px feather 模糊内描，**不**回 0-blur 锐利。border alpha：thin 45% / regular 50% / thick 60% / semantic 55%。
**thick 独占**（few-hero，数据密集档不挂以免亮底列表把色边读成 bug）：色散 `FRINGE`（左缘暖红 `oklch(0.62 0.21 25)` / 右缘冷蓝 `oklch(0.66 0.17 255)` 1px 内描）+ 内折光 `INNER_GLOW`（顶部柔和内高光，补薄 fill 的「内部有厚度」线索，是内部柔光不是边描）+ 镜面 `SWEEP`（静态 `linear-gradient(135deg)` backgroundImage）。
**CALM 近白 baseline glow 下卡片靠什么 distinct**：fill 薄 + 边薄后，distinctness 几乎全靠三件套 ——「左上高光细线 + 1px border（regular 50% / thin 45% / thick 60% / sticky 50%）+ 外 drop-shadow（regular `0 20px 50px -20px /0.22`、thick `0 30px 60px -15px`，投影是近白底上卡片浮起的主载体）」。右下黑层本就是最弱的一层、暗模式 `--card` 近黑时隐形，去掉无损。硬不变量：**fringe + 扫光只挂 thick**（数据密集档不读色边/扫光）。

**instant-blur transition（开场转折修复）**：`baseTransition`（`shell.tsx` + `sticky-chrome.tsx` 两处）**不列 `backdrop-filter`** —— 只过渡 background-color / border-color / box-shadow / background-image 四条。根因：`backdrop-filter: none→blur()` **不可插值**，会在过渡末尾整体 snap，而 `background-color` 平滑淡入 —— 两条不同步会让亮模式 copilot 打开时出现「先透亮、后『啪』结霜」两段转折。把 `backdrop-filter` 从 transition 删掉后 blur 瞬时生效：从 t=0 就在，但此刻盖在仍不透明的卡面上**看不见**，随 fill 淡出被平滑揭示 → frost 与透亮同时到达。**关键约束**：closed 态仍只返回 `{ transition }`、**绝不加任何 backdrop-filter（连 `blur(0)` 都不加）** —— 300 行数据密集页 closed-state 零 backdrop 成本（`blur(0)` 也会让每个 closed 卡开 backdrop paint buffer，回归 perf）。

**byte-lock 测试**：`src/components/glass/__tests__/` 三个测试对每档 fill 同时断言**亮 %** 与**暗 %**、锁 filter 字面量、锁 hairline「右下暗只 thin 保留」断言 + fringe/扫光只挂 thick：`shell.test.ts`（per-tier bg + tinted accent% + Track A premium edge）、`sticky-chrome.test.ts`（sticky bg / blur / rim inset）、`glass-lens.test.ts`（hero blur 36 + bg）。a11y：`[data-glass-variant]` selector 已 zero 掉 `backdrop-filter` / `background-image` / `box-shadow`（`prefers-reduced-transparency` / `prefers-contrast:more` / `forced-colors`），brightness / contrast 与 rim 在降级态被一并剥掉，**无需改 globals.css**。

**perf**：GPU 60fps、0 stalls（blur 沿演进降低并 hold、无新 backdrop 成本；`light-dark()` + box-shadow 都是 compositor-cheap）。相对 baseline（main @ 293769d）的净变化：mode-aware `light-dark()` fills（亮 clean-frost / 暗更透）、降低的 blur、hairline 边、instant-blur transition 修复。glow 不动。

**嵌套去重**（perf）：`[data-glass-variant]` 嵌套时内层自动失去 backdrop-filter（`globals.css` 一条 `!important` 规则；thick / sticky-up / sticky-down 例外）——嵌套层的 backdrop 本来就是外层糊过的，再 blur 是乘法级 paint 成本。regular 嵌 regular 时内层 bg 降一档防不透明度叠闷（该 dedup 在 `globals.css`，独立于 per-tier fill 数字）。写嵌套玻璃时不需要（也不应该）手动绕过。

**Semantic（Regular 材质 + 语义 border + 语义 ambient shadow）**：

| 档 | 语义色 (oklch) | 典型角色 |
|---|---|---|
| **success** | emerald-500 `oklch(0.696 0.17 162.48)` | 正向状态卡（Scoring Collapsible 等） |
| **warning** | amber-500 `oklch(0.769 0.188 70.08)` | 提示 / 引导 banner（AgentHintBanner 等） |
| **danger** | red-500 `oklch(0.637 0.237 25.33)` | 错误 / 警告卡（FailedPanel 等） |

Semantic 档的 border 色 class（如 `border-emerald-200/60`）要**保留在 className 上**，作为 copilot 关闭态（shadcn 扁平）下的 border fallback——inline `borderColor` 只在 copilot 开时生效。

组件 `GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted` / `GlassCard` / `GlassCardThin` / `GlassSuccess` / `GlassWarning` / `GlassDanger` 从 `@/components/glass/shell` 导出。`GlassStickyHeader` / `GlassStickyFooter` 从 `@/components/glass/sticky-chrome` 导出。`GlassSegmentedItem` 从 `@/components/glass/glass-segmented` 导出。非 JSX 场景用 `useGlassStyle(variant)` hook 取 `CSSProperties`。

## `--copilot-accent` 而非 `--primary`

项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 基本 = 灰）。`bg-primary/10` 做激活染色出来灰扁不像"亮"。`--copilot-accent: oklch(0.76 0.16 225)` (sky blue, 与 glow 主色呼应) 才是 Tinted 和激活态的正确色。**动 copilot 玻璃 / segmented / primary CTA 染色时都用 copilot-accent，不要 primary。**

## Segmented 选中态

**`<GlassSegmentedItem>` (`src/components/glass/glass-segmented.tsx`)** 是 segmented control / active tab / nav item 的统一组件。通过 `render` prop 支持 `<button>` / `<Link>` / `<a>` 等任意底层 element：

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

`src/app/globals.css` 尾部 4 条媒介查询降级：
- `prefers-reduced-transparency: reduce` → 全部玻璃降为实底 `var(--card)`
- `prefers-contrast: more` → 实心 + 更强描边
- `prefers-reduced-motion: reduce` → 关 press-squish / hover-lift / scroll-edge 动画
- `forced-colors: active`（Windows High Contrast）→ 玻璃全退场，`Canvas` 底 + `CanvasText` 描边，glow / reveal wave 隐藏

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

## Track B · refraction lens（**portal-only**，**Chromium-only**）

Track A 是纯 box-shadow/background-image 的边缘光学（零 filter 成本、跨浏览器一致）。Track B 在它**之上**叠真正的 `feDisplacementMap` backdrop 折射 —— `backdrop-filter: url(#…)` 是 Blink 私有扩展，**物理上只有 Chromium 能渲染**，Safari/Firefox 会整条丢掉。所以 Track B 永远是「锦上添花」：探测失败/降级时落回今天的 thick blur 玻璃，绝不破图。

折射有**两种用法**：

**(a) thick portal 折射**（`useLensFilter("thick")` + 强度 26/23/20 的 `#evalyst-glass-refraction` lens map）—— **Dialog content + compare 详情 popover**（开时才 mount、关时 unmount，一次一个、有界）。但浮层有暗 scrim + 重 blur(40) + 背后内容低对比 → 折射**几乎看不见**（实测 on/off 像素几乎一致）。保留为基础设施，不是视觉主角。

**(b) 液态玻璃 BAR（视觉主角，真能看见）**：`<GlassStickyHeader lens>`（`useClearLens()` + **低 blur(6)** + turbulence 全域 warp `#evalyst-glass-lens-strong`）。关键：**低 blur + 让锐利内容从 bar 底下滚过**——results 列表的文字行滚过 sticky bar 时可见地涟漪折射。这是 calm 数据工具里折射唯一真正读得出的地方（折射要弯**高频锐利**内容才看得见；glow 是平滑色块、弯不出东西；重 blur 会把折射抹掉）。当前用在 `/experiments/[id]` 的「结果(N)」表头条。
- **为什么 bar 能可见又便宜**：薄 bar 重 warp 面积 ≈ 全页的 6%；idle（不滚）static → 60fps 零成本；滚动时 bar re-warp 实测对 p50 ~零影响（30fps 是 results 行未虚拟化的 pre-existing 成本，不是 bar）。

> **为什么不挂全页 / Select**（实测后撤掉，见 `e2e/glass-track-b-copilot-perf.spec.ts`）：
> - **全页 `GlassHero` 折射**：Chromium 无法缓存 viewport 尺寸的 backdrop 折射，每个合成帧重栅整屏 —— 300 行 + 200 条 copilot 历史下 idle 都掉到 ~15fps。所以 `GlassHero` 改成**纯加重 blur 外壳**（blur 40 + thick rim，无 url()、无 fringe/扫光），折射撤掉。
> - **`Select` dropdown**：base-ui Select 关闭仍挂载 → 常驻一个 url() 节点；且 `SelectContent` 被 copilot 面板的模型选择器复用，挂折射会违反「copilot 面板永远扁平」。所以 Select **撤掉折射、保留原有 thick blur**。
> - 对比验证：小 portal 折射对 idle **零成本**（开折射 Dialog 时 idle p50 16.7ms、delta −0.7ms）。

**关键文件**：
- 原语 `src/components/glass/glass-lens.tsx` —— `useLensFilter('thick')`（THE 共享 hook，Dialog/compare popover 用）、`useLensGloballyLive`（写 `html[data-glass-refraction=on]` 标记 + 驱动 defs mount）、纯函数 `computeLensFilter` / `computeRefractionAllowed`
- 探测 `src/components/glass/glass-lens-probe.ts` —— 离屏 `feDisplacementMap` 像素回读 **＋ Blink-family 闸（`navigator.userAgentData` 仅 Blink 有）**。WebKit 支持 canvas `filter:url()` 但不支持 `backdrop-filter:url()`，单靠回读会在 Safari false-positive；闸住才安全。module-singleton memo，SSR-guard，偏 false-negative（宁可少 wow 也不破图）。
- `<filter>` defs `src/components/glass/glass-refraction-defs.tsx` —— 单条 `#evalyst-glass-refraction`，挂在 `store.tsx` 的 provider 子树，仅 live 时 mount
- baked 位移图 `src/components/glass/glass-lens-map.generated.ts`（产物）+ 生成器 `scripts/gen-glass-lens-map.ts`（`npm run gen:glass-map`，`--check` 做 CI 漂移守卫）
- `GlassHero`（**无折射**的加重 blur 外壳）在 `shell.tsx`（`getGlassHeroStyle` 纯函数 + `useGlassHeroStyle`），给 `/experiments/[id]` 与 `/compare` 一页一个外壳用

**位移图必须 baked 静态**：生成器仅用 `node:zlib` 手搓 PNG（SDF 圆角矩形 rim + 四象限镜像），运行时只 import data-URI 字符串。**绝不**在 mount 时跑 canvas 重建 —— 那会破坏 idle-static-glow / inspector blur-yank / material-reveal 契约（filter buffer 必须静止）。改了生成器参数务必 `npm run gen:glass-map` 重生 + 提交（CI 的 `--check` 会卡字节漂移）。

**a11y / inspector gating 在组件内（load-bearing）**：实测发现 —— `prefers-reduced-transparency` 下 **portal 上的 inline `url()` backdrop-filter 无法被 stylesheet `backdrop-filter: none !important` 剥掉**（box-shadow 能剥，这是不对称）。所以 Track B 的防线必须在组件：`useLensFilter` 内部（`useRefractionAllowed`）订阅四条 a11y 查询（reduced-transparency / reduced-motion / contrast / forced-colors）+ copilot inspector 的 body class，任一命中就**根本不 emit `url()`**（返回 `{}`，spread 到 thick recipe 是 no-op）。CSS 的 `!important` 只是 belt-and-suspenders，**永远不要**指望它去剥 portal 上的 inline url()。没有 CSS url() 注入通道（hero 撤掉折射后 `--glass-hero-filter` 一并删了）。

**fallback ladder**：copilot 关 → flat shadcn；非 Blink / 探测失败 / 嵌入式 webview → 今天的 thick blur 玻璃（逐字节相同，`computeLensFilter` 返回 `{}` 的 spread 是 no-op，单测断言）；reduced-transparency/contrast/forced-colors → 实底；reduced-motion → 今天的静态 blur 玻璃；inspector → blur-yank。`-webkit-backdrop-filter` **永远是 blur 字面量**（Safari 读 -webkit，一旦拿到 url() 会整条丢 backdrop-filter）。

**永不碰清单**：
- 全页 page shell / `GlassHero` —— 折射全屏太贵（idle ~15fps）；hero 只走加重 blur
- `Select` dropdown —— 关闭仍挂载（常驻节点）+ 被 copilot 面板复用（须扁平）；保留 thick blur，不挂折射
- tinted Run/Resume CTA —— nested-blur strip 会把嵌套 url() 清零，且是「一页一个 tinted」名额
- copilot 开关（position:fixed，perf-decreed）/ copilot 面板内部（永远扁平）
- 所有数据密集 thin/regular 档（`GlassThin` / `GlassCardThin` / results 列表）—— `feDisplacementMap` 是 backdrop-blur 的 3–8 倍成本，只给「开了才在」的小 portal；`useLensFilter` 类型只收 `'thick'` 就是这个守卫
