# Copilot Glass System · 设计规范

**Date**: 2026-04-28
**Status**: Design approved, ready for implementation plan
**Scope**: Evalyst copilot 模式下的 UI 视觉语言统一

---

## 1 · Context

### 当前问题

Copilot 模式开启后，UI 在不同页面表现不一致：
- `/` dashboard 的实验卡保持纯白 `bg-card`
- `/experiments/new` 整个表单是一大片半透明玻璃
- `/compare` 外壳半透 + sticky 表头玻璃 + 内格白卡，**三层材质错位**
- `/settings/*` 外壳半透，但 RelationDiagram 的 tab 按钮自带色块

**根因**：代码里两个壳组件（shadcn `<Card>` 固定实底 vs 自研 `<CopilotShell>` 跟随 copilot 状态切玻璃）混用，**没有设计原则规定哪里用哪个**。

### 方向选择

候选三条：
- A · 全实底（copilot 仅靠光晕 + Panel 玻璃）
- B · 分层玻璃（内容实底 + Chrome 玻璃） — 贴近 Apple Liquid Glass 最新定位
- C · 全玻璃梯度

**决定：走 C 路线**。理由：copilot 是模式切换（非组件 toggle），需要和非 copilot 模式有显著视觉区别；C 也最能突出背景光晕。

### 与官方规范的关系

诚实说明：C 路线 = **有意识地偏离 Apple Liquid Glass（iOS 26/macOS Tahoe）2025 年的最新共识**。Liquid Glass 明确把玻璃收窄到 "navigation & controls 层"，内容层不做玻璃；MD3 surfaceContainer 系统 tonal overlay 各级差只 2–3%，人眼几乎察觉不到，本质也是"内容近似实底"。

**我们偏离是因为产品目标**（copilot 模式需要仪式感）> 贴近规范。代价意识：正文阅读密集区会比 B 路线更弱，所以保留若干"绝对不玻璃"的禁忌元素。

---

## 2 · 核心理念

> **copilot 模式 = 完整的设计语言切换，不是单个组件 toggle**

- **关闭态**：走 shadcn 标准实底语言（Card + ring），不动
- **开启态**：整个 UI 切换到"玻璃梯度系统" —— 三档材质 + 一档 tinted 变体

两套语言不混。切换通过 `html[data-copilot-open="true"]` hook + 组件订阅 `useCopilotStore().open` inline style 实现（规避 Tailwind v4 / LightningCSS 的 CSS 选择器特异性问题，已在 PR-2.5 验证）。

---

## 3 · 玻璃梯度系统（4 档）

| 档 | blur | bg opacity | tint | 内阴影 | 外阴影 | 角色 |
|---|---|---|---|---|---|---|
| **Thin** | 16px | 8% | — | 无 | 无 | sticky 条带 / 数据单元格 / results 行级卡 |
| **Regular** | 28px | 35% | — | 顶部 1px 白高光 | `0 20px 50px -20px` 柔落影 | 页面主外壳 + 内容卡（同级同档）|
| **Thick** | 40px | 55% | — | 顶部+底部双高光 | `0 30px 60px -15px` 明显落影 | 浮层（dialog / select content / custom popover）|
| **Tinted** | 28px | 35% | `color-mix(in oklab, var(--copilot-accent) 22%, transparent)` 叠 | 顶部白高光 + accent 内光圈 + accent ambient | primary CTA / active tab / segmented selected |

**关于 `--copilot-accent`（2026-04-28 修订加入）**：
```css
:root { --copilot-accent: oklch(0.76 0.16 225); } /* sky blue */
.dark { --copilot-accent: oklch(0.62 0.14 225); }
```
项目原 `--primary` 是 `oklch(0.25 0.015 55)`（暗褐色、色度 0.015 ≈ 灰），直接用 `bg-primary/10` 做激活染色永远灰扁。新增这个 sky-blue accent 专用于"发光"信号，和 glow 主色呼应。Tinted 变体改用 `var(--copilot-accent)` 而非 `var(--primary)`。

### 硬性约束

- 相邻档之间 **blur 差 ≥12px + opacity 差 ≥15%**（人眼阈值）
- 同档内样式必须完全一致（任一参数 drift 视为 bug）
- 最多同屏出现 3 档（Tinted 视为 Regular 变体，不单独计档）
- **同一视觉层级必须同档**（例：所有页面主外壳 = Regular，没有例外）
- 玻璃**不可 DOM 嵌套同档**（Regular 套 Regular → 浑浊），必须差一档（Regular 套 Thin，或 Regular 套 Thick 浮层）；**网格中相邻的同级元素不算嵌套**（dashboard 多个 Regular 卡片并排合法）

### 色彩基底

- 所有档背景都基于 `color-mix(in oklab, var(--card) <N>%, transparent)`
- border 必须 `color-mix(in oklab, var(--border) 50%, transparent)`，禁实色（否则跳出玻璃系统像贴纸）
- Dark mode 下 bg opacity 降一档（Thin 0%、Regular 25%、Thick 40%），靠 blur 柔化而非 opacity 阻挡

---

## 4 · 组件 → 档位映射表

### 页面壳

| 页面 / 元素 | 档 |
|---|---|
| `/` dashboard 单个 ExperimentCard | **Regular** |
| `/experiments/new` 整个表单外壳 | **Regular** |
| `/compare` 外壳 | **Regular** |
| `/compare` sticky 表头 | **Thin** |
| `/compare` 每个结果格（cell Card） | **Thin** ← **降档**，避开"数据表格单元格玻璃数字漂移"禁忌 |
| `/settings` layout 外壳 | **Regular** |
| `/settings` 子列表卡（datasets/templates/rubrics list cards） | **Regular** |
| `/settings` 子详情页 `/[id]` 内 Card | **Regular** |
| `/settings` 内 form sub-section cards（template/dataset/rubric/display form） | **Regular** |
| ModelCard（LLM 模型卡） | **Regular** |
| `/experiments/[id]` 外壳 | **Regular** |
| `/experiments/[id]` 内嵌 Progress / Scoring / Failed Panel | **Regular** |
| Results 行级 Card（single-list / dual-list / triple-grid / display-grouped-grid / display-jsx / bubble-auto / json-default） | **Thin** ← 数据密集稳定性 |
| Sticky Save Bar | **Thin** + `copilot-scroll-edge-top` |
| **Sidebar** | **实底不玻璃**（user 2026-04-28 decision：左侧导航走非 copilot 扁平规范）|
| **Copilot Panel 自身** | **实底不玻璃**（同上：右侧 copilot 区走非 copilot 扁平规范）|

### 浮层（中间内容区触发）

| 元素 | 档 |
|---|---|
| Dialog content | **Thick** |
| Select content | **Thick** |
| 自建 Popover divs（compare PromptInfoIcon / SessionList 在 panel 外的使用 etc.） | **Thick** |
| Toast / Sonner | **实底不玻璃**（禁忌） |
| Agent hint banner（amber 色通知） | **实底不玻璃**（semantic 色码信号）|

### 交互强调

| 元素 | 档 |
|---|---|
| Primary CTA 按钮（「保存并运行」、experiments/new 的 Run 等，仅主内容区） | **Tinted**（只在 copilot 开时生效）|
| Segmented control 选中（schema selector、display mode、relation-diagram tab） | **Tinted**（只在 copilot 开时生效）|
| **Sidebar nav active** | 永远 shadcn `bg-accent/70 border-foreground`（`segmentedItem(_, false)` 硬编）|
| **Session list active（panel 内）** | 永远 shadcn `bg-accent/70`（同上）|
| Secondary / outline 按钮 | 保持 shadcn 原样（content-over-material） |

**设计 token**：统一走 `src/lib/segmented.ts` 的 `segmentedItem(active, copilotOpen)`：
- copilot 关：shadcn 原样（`border-foreground bg-accent/70`），不用玻璃/发光
- copilot 开：accent 浅染 + 顶部白高光 + accent 光圈 + accent ambient shadow → "发光"

### 禁忌 · 绝对不玻璃

- ❌ Textarea / Input / Code 内部（阅读密集）
- ❌ Disabled 状态按钮（复用 shadcn disabled 样式）
- ❌ Toast / Snackbar / amber notice banner（semantic 信号 > 装饰）
- ❌ Compare 内格"降到 Thin"是底线
- ❌ **Sidebar**（左侧主导航）—— 走非 copilot 扁平规范
- ❌ **Copilot panel 自身 + 内部**（session-list / chat-view 按钮 / textarea）—— 走非 copilot 扁平规范
- ❌ ScrollArea viewport 内部（如果内容是正文）

---

## 5 · 交互态

### Press squish（签名反馈）

按下玻璃元素：
- `transform: scale(0.98)`
- blur 减 4px
- 添加内阴影 `inset 0 2px 8px color-mix(in oklab, black 10%, transparent)`
- 持续 150ms，ease-out

应用：Regular / Thick / Tinted 玻璃面的按钮、卡片（不应用于 Thin，Thin 太薄按下看不出）

### Hover lift（桌面必做）

鼠标 hover 玻璃元素：
- blur 增 2–4px
- bg opacity + 3%
- specular 高光（白色 inset 1px 0 0）亮度 +4%
- 持续 200ms，ease

应用：卡片、tab、primary CTA

### Scroll edge effect

sticky 表头 / 吸底条下方必须有 **8–24px mask gradient** 软边：

```css
mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
```

应用：compare sticky 表头、任何 sticky chrome

### Focus ring

键盘可达的玻璃元素 focus：
- `outline: 2px solid var(--ring)`
- `outline-offset: 2px`
- Increase Contrast 下加粗到 3px

---

## 6 · 可访问性

### 媒介查询降级（HIG 硬性要求）

```css
@media (prefers-reduced-transparency: reduce) {
  /* 所有玻璃组件降到 shadcn 实底 Card 等价样式 */
  /* backdrop-filter: none */
  /* background: var(--card) */
  /* border: 1px solid var(--border) */
}

@media (prefers-contrast: more) {
  /* 玻璃换实心 + 更强描边 + 文字对比度拉满 */
}

@media (prefers-reduced-motion: reduce) {
  /* 关 press squish / hover lift / scroll edge transition */
  /* 关 glow spawn / mask-enter pop 动画 */
}
```

### 光晕区玻璃加厚（follow-up，本轮不做）

copilot panel 附近光晕密集区的玻璃元素（如 compare 外壳右侧、settings 外壳靠右部分）理论上需要加 5% opacity 避免文字对比度不足。**本轮首先保证 WCAG AA 基线在"平均光晕"下达标**；光晕最极端区域的文字污染问题作为 visual QA 后 follow-up 处理，避免违反"同档内样式必须完全一致"硬约束。

### WCAG AA 对比度自检

- 所有 primary text（`--foreground`）在 Thin 玻璃最薄处 + 光晕最亮处必须 ≥ 4.5:1
- 所有 secondary text（`--muted-foreground`）同条件 ≥ 3:1（大号文本）
- 实施期手动测 4 处最极端场景（compare 内格 + 明亮光晕 / dashboard 卡 + 明亮光晕 / copilot panel 内 chat 文字 / primary CTA 文字）

---

## 7 · Concentricity（可选升级）

嵌套容器圆角 **父 = 子 + padding**。

例：Regular 外壳 `rounded-xl`（12px）+ 内部 padding 16px + 内部 Thin 卡 → 内卡应 `rounded-[0]` 或比父小 16px。

**可选**：本 spec 下首轮实施**不统一**所有嵌套圆角（影响面过大），只在 copilot panel 自身和 Dialog content 确保同心；其它作为 follow-up polish。

---

## 8 · 实施影响面

### 新增

- `src/components/copilot/shell.tsx` 扩展：从当前 2 档（shell/surface）改到 4 档导出
  - `<GlassThin>` / `<GlassRegular>` / `<GlassThick>` / `<GlassTinted>`
  - 保留 `useGlassStyle(variant)` hook 供非组件场景使用
- `src/app/globals.css`：加 3 条 prefers-* 媒介查询降级块 + press-squish / hover-lift / scroll-edge keyframes

### 改造

| 文件 | 变动 |
|---|---|
| `src/app/page.tsx` dashboard | ExperimentCard 外层从 shadcn `<Card>` 换 `<GlassRegular>`，去掉 `bg-card` + `ring` |
| `src/app/experiments/new/page.tsx` | `<CopilotShell>` 改名 `<GlassRegular>`；primary CTA 按钮加 Tinted 变体 |
| `src/app/compare/page.tsx` | 外壳 `<GlassRegular>`；sticky 表头 `<GlassThin>`（替换 GlassSurface）；内格 `<GlassThin>` 而非 shadcn Card |
| `src/app/settings/layout.tsx` | `<CopilotShell>` 改 `<GlassRegular>` |
| `src/app/settings/datasets/page.tsx` / `templates/page.tsx` / `rubrics/page.tsx` | list card 从 `<Card>` 换 `<GlassRegular>` |
| `src/app/experiments/[id]/page.tsx` | 外壳 + 内嵌 Card 全 `<GlassRegular>` |
| `src/components/sidebar.tsx` | 挂 `<GlassThin>` 背景（copilot 开启时生效） |
| `src/components/ui/sticky-save-bar.tsx` | 从 `<GlassSurface>` 切 `<GlassThin>` + scroll-edge mask |
| `src/components/copilot/panel.tsx` | 从自建背景切 `<GlassThick>` |
| `src/components/ui/dialog.tsx` / `popover.tsx` / `dropdown-menu.tsx` | content 层覆盖 `bg-popover` 走 `<GlassThick>`（仅 copilot 开启时） |
| `src/components/settings/relation-diagram.tsx` | active tab 挂 Tinted 样式 |
| primary CTA 按钮们 | 加 `variant="tinted"`（shadcn Button 加一个 variant） |

### 不改

- shadcn 交互原子（Button / Input / Select / Checkbox / Slider / Separator / Badge / Progress / Textarea / Tabs / Label / Collapsible）—— 保留原样
- 所有 textarea / input 内部填充 —— 保持实底
- toast / sonner —— 保持实底
- 数据本身（状态点、badge 色块、progress 条）—— 保持实色

---

## 9 · 测试

### 手动走查

开 / 关 copilot，各遍历：
- `/` dashboard（空态 + 非空态）
- `/experiments/new` 完整表单
- `/compare` 选 2 个实验对比
- `/settings/*` 四个 tab
- `/experiments/[id]` 带 rubric + 不带 rubric 两种
- Dialog / Popover / DropdownMenu 各弹一次

### 可访问性三态

DevTools Emulate：
- `prefers-reduced-transparency: reduce` → 全降级实底，功能无损
- `prefers-contrast: more` → 实心 + 描边，对比度达标
- `prefers-reduced-motion: reduce` → 无动画，静态可用

### 自动化

- 现有 151 vitest 不受影响（纯函数）
- e2e smoke 保持绿（9 case）
- 新增：暂不加 visual regression（视觉工具成本高）

---

## 10 · 范围外

- Concentricity 全系统统一（仅 panel / dialog 对齐）
- 原生 specular / refraction 效果（CSS backdrop-filter 能力不足，接受简化版）
- 暗色模式微调（作为 follow-up，先保证亮色达标）
- 为 shadcn Card 组件本身加 variant props（走外包而非侵入 shadcn 源码）
- 动效节能（低端设备 backdrop-filter 降级）—— 未来版本处理
- 4 档之上再加档（UltraThin / Chrome / ExtraThick）—— 本期不做，首轮看 3+1 够不够

---

## 11 · 决策记录

- **4 档（Thin/Regular/Thick + Tinted）是压扁的**。HIG 5 档 + Liquid Glass 2+1 + MD3 5 级 —— 我们选 3+1 是实用取舍（Web 场景下区分 >3 档人眼识别率下降 + 实施复杂度上升）。首轮验证后按需增减档。
- **同级同档规则优先于按角色分档**。用户明确 "页面最外层组件必须同厚度"，我们把 dashboard 卡（原倾向 Thick）也归 Regular。代价是 dashboard 卡的"数据岛感"偏弱。
- **光晕强度保持**（不加强不减弱）。首轮先看玻璃系统本身效果，光晕后续独立调。
- **Compare 内格降 Thin 而非维持 Regular**。触发原因是 Liquid Glass 明确禁忌"数据表格单元格玻璃"。数据稳定性 > 视觉统一。

---

## 12 · 首轮验证后的调整（2026-04-28）

**调整 A · 引入 `--copilot-accent` token**
- 项目 `--primary` 是 `oklch(0.25 0.015 55)`（暗褐色、色度 0.015），用于 Tinted 或 segmented 选中的染色太灰扁
- 新增 `--copilot-accent: oklch(0.76 0.16 225)` (sky blue)，与 glow 主色呼应
- Tinted 变体 + segmentedItem 的"发光"态都改用 copilot-accent，不走 primary
- 决策理由：让"激活态"真正看起来"变亮"而非"染灰"

**调整 B · glow 合并 idle/busy 色度**
- 原本 idle 和 busy (streaming) 用不同 filter saturate/brightness，初始偏灰、点击后变深
- 改为打开 copilot 就一直用 active 色度（`saturate(1.2) brightness(1.08)`）+ color-mix 百分比 +10-14%
- busy 仅动画速度更快（3s/4s）不再换色
- 决策理由：用户不应在同一模式下看到两种色调

**调整 C · 选中态 design token `segmentedItem(active, copilotOpen)`**
- 新建 `src/lib/segmented.ts` 统一 segmented / tab / nav 的 active 样式
- copilot 关：回退老 shadcn（`border-foreground bg-accent/70`），不上染色/发光
- copilot 开：accent 浅染 + 顶部白高光 + accent 光圈 + accent ambient shadow → "发光"
- 5 个调用点：experiments/new schema selector、display-form mode selector、relation-diagram tab、sidebar nav（硬编 false）、session-list active（硬编 false）
- 决策理由：非 copilot 模式不该看到 copilot 专属视觉语言

**调整 D · Sidebar + Copilot panel 退出玻璃系统**
- 用户明确要求"只有页面中间部分应用 copilot 玻璃，最左侧导航 + 最右侧 copilot 都走非 copilot 扁平规范"
- `sidebar.tsx`：撤销 `GlassThin` inline style 和 active nav 的 tinted
- `copilot/panel.tsx`：撤销 `GlassThick` inline style
- `copilot/session-list.tsx`：撤销所有 glass 应用，active 态用 `segmentedItem(_, false)`
- `copilot/chat-view.tsx`：两个 send/edit-resend 按钮从 `variant="tinted"` 改回默认
- 决策理由：copilot 模式是"中间区域变玻璃"，不是"整屏变玻璃"。左右两侧是 chrome，保持 shadcn 扁平稳定

**调整 E · JSX display 兼容 copilot 态**
- `view-helpers.tsx` 的 `makeHelpers({ open, styles })` 扩展：暴露 `helpers.glassStyle(variant)` 和 `helpers.glassAttr(variant)`
- `results/display-jsx.tsx` 在渲染器组件内调用 4 档 `useGlassStyle` 传给 helpers
- `data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`：外层 div 加 `style: glassStyle('regular')` + `data-glass-variant: glassAttr('regular')`
  - copilot 关 → `glassStyle()` 返回 undefined，走 `bg-card` 实底
  - copilot 开 → inline style 覆盖，自动玻璃化
- 文档给后续写自定义 JSX display 的人：解构 helpers 时带 `glassStyle, glassAttr`，外层主卡 div 里叠上，剩下都和以前一样写
- 决策理由：用户自建 display 也是"主内容区"，不能强制他们只能走 built-in renderer 才享玻璃

**补充 · 剩余扁平 Card 全迁移**
- `model-card.tsx`（LLM 模型卡）→ GlassRegular
- `experiments/[id]/page.tsx` L170 那行漏的 `rounded-lg border bg-card` div → GlassRegular
- `settings/templates/[id]` + `settings/datasets/[id]` 内 Card → GlassRegular
- 4 个 form pages（template / dataset / rubric / display）内部段落 Card → GlassRegular
- 7 个 results renderer 的行级 Card → GlassThin（数据密，Thin 最低扰动）
- `agent-hint-banner`（amber 通知）→ 不迁，保实底（semantic 色码信号 > 装饰）
