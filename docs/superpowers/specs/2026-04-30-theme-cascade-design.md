# 主题切换 cascade 设计 v2.1 · 镜像 reveal cascade（glass） + chrome breathing crossfade（非 glass）

> 日期 2026-04-30 · Scope: Evalyst copilot UI · 替代同名 v1 方案（View Transitions API），后者在用户体感验证后被放弃
>
> **前情**：
> - v0.5.3 deferred 的 R→L cascade（`2026-04-29-copilot-material-reveal-design.md` §18.4）
> - v0.5.4 v1：View Transitions API（归档在 `archive/theme-view-transitions` 分支 + PR #12 closed）
> - v0.5.4 v2（本 spec）：element-level CSS transition——但精简到**镜像 reveal cascade** 机制 + 非 glass 元素补一条短而宽容的 breathing crossfade
>
> **v2 → v2.1 的修订**：v2 一开始打算"只 override transition-delay"的极保守姿态。讨论后认识到：v0.5.3 的真实失败原因是**scope 太大（`*` 全选择器）**和 **`disableTransitionOnChange` 吞 transition**，**不是 element-level 路线本身**。reveal cascade 用同样的机制（完整 shorthand override + delay var）已在产稳定跑。所以 glass 直接镜像 reveal cascade，不绕弯。非 glass 元素（body/sidebar/panel 的 bg）补一条简单 breathing crossfade 让整体有呼吸感。

## 1. 目标

切主题（light ⇌ dark ⇌ system）时，让**每个 glass card UI 元素自己**按 R→L 的顺序依次变色——不是某一条"扫描线"在刷页面，而是每张卡自己翻色。

- **Copilot 关**：所有 glass card 同时（0 delay）走原生 `transition` 淡入新主题色；body / aside / main 同步 320ms crossfade——视觉上是一次全屏统一 crossfade，~320ms 内完成
- **Copilot 开**：每张 glass card 按 x 位置算 R→L 错峰 delay；stagger 窗口 0-1400ms；chrome（body/aside/main）同时走 320ms 无 stagger 到位——背景先 settle，前景 card R→L ripple 视觉上类似 reveal cascade "每张卡自己翻面"
- **绝对禁止**：cleanup 闪烁（v0.5.3 的第一坑）

## 2. 非目标

- ❌ View Transitions API —— v0.5.4 第一次尝试已被用户放弃（归档在 `archive/theme-view-transitions` 分支）
- ❌ 从主题按钮位置径向扩散 —— 用户反馈"关态不需要扩散"
- ❌ 可见的"扫描线"或 wipe overlay —— 用户反馈"不需要那条线"
- ❌ snapshot 合成层的 blit 动画 —— 用户要的是 real DOM 元素自己变色
- ❌ 给每张卡片 `view-transition-name` —— 同理
- ❌ 主题按钮 ripple / 按下反馈动画
- ❌ 初次加载时主题应用的动画 —— 只动"用户主动切换"这一路径
- ❌ OS 偏好 system dark 自动触发时的动画 —— 被动变化直接 snap
- ❌ 快速连续切换的中断合并 —— 下一次切换直接覆盖上一次的未完成 cascade

## 3. 决策

按决策顺序列。

| # | 决策 | 最终取值 | 理由 |
|---|---|---|---|
| 1 | 整体路线 | Element-level CSS transition + stagger（glass） + 独立 breathing crossfade（非 glass chrome） | 用户要"每个 UI 自己变"；镜像 reveal cascade 的机制（已在产验证） |
| 2 | Glass 元素选择器 | `[data-glass-variant]`（和 reveal cascade 同） | 已有统一标记；覆盖所有主内容区的 glass card |
| 3 | Glass CSS override 形式 | **完整 transition shorthand**（background-color, backdrop-filter, border-color, box-shadow, background-image × 5 props × var delay），**和 reveal cascade 同构** | v0.5.3 失败根因是 `*` 全选 + `disableTransitionOnChange` 吞，不是 shorthand override 本身。reveal cascade 用的就是 shorthand override 且稳定在产。不再玩"只 override delay"这种过保守姿态 |
| 4 | Glass duration | 320ms（与 glass 平时 inline transition 一致） | 主题切换是色值插值，320ms 足够；与 reveal 的 280ms 稍异以区分语境 |
| 5 | Glass delay 公式 | 本地 `(startVw - cx) / 100 * 1400`，clamp [0, 1400] | 不复用 `computeRevealDelay`（它有 750ms offset 等待 wave）；主题 cascade 没有 wave，stagger 窗口 0-1400ms |
| 6 | Copilot 关态 glass 行为 | 不写 delay（全 0）= 所有 glass card 同步 320ms crossfade | 用户反馈关态"不需要 R→L cascade"；simple crossfade |
| 7 | Copilot 开态 `startVw` | `100 - panelVw`（panel 左边缘）| 和 reveal cascade 完全一致 |
| 8 | **非 glass chrome 元素**（body / sidebar `aside` / copilot panel / main 的 bg 和 border） | 补一条 `transition: background-color 320ms ease-out, border-color 320ms ease-out`；**无 stagger**，全场同步渐变；仅在 `html[data-theme-cascading="true"]` scope 生效 | 首轮 smoke 时曾用 500ms "breathing" 差节奏，用户反馈刺眼；改为与 glass 同 320ms baseline 统一更干净 |
| 9 | 非 glass 覆盖范围 | 仅 `body`, `aside`（sidebar + copilot panel 共用 `<aside>`）, `main`；不用 `*` | `*` = v0.5.3 paint 风暴根因。手写 4-5 个 selector 覆盖用户感知最强的大块背景即可 |
| 10 | `disableTransitionOnChange` | **从 `<ThemeProvider>` 移除** | class 切换时注入 `<style>* { transition: none !important }` 约 1 帧 → cascade 跑不起来。初次加载 flash 由 next-themes inline `<script>`（正交机制）保护 |
| 11 | Class 切换机制 | 复用 `applyThemeClass(next)`（v0.5.4 v1 遗产保留） | 同步 DOM 改动；早于 next-themes 的 useEffect |
| 12 | Cascade flag | `html.dataset.themeCascading = "true"` | 激活 CSS override；和 reveal cascade 的 `data-copilot-revealing` 不同命名空间 |
| 13 | CSS var 名 | `--theme-cascade-delay` | 两个 cascade 正交，避免同元素被 reveal 和 theme 同时 cascade 时串味 |
| 14 | Cleanup 时机 | `setTimeout 2000ms`（max delay 1400 + duration 320 + 280ms 余量）| 确保所有 transition 已结束 cleanup 对 in-flight 无影响 |
| 15 | `prefers-reduced-motion: reduce` | 跳过 stagger，直接 `applyThemeClass`。允许非 glass 的 500ms breathing 照跑（reduced-motion 只是"减少运动"不是"禁 transition"），或统一 snap—— **选 snap 更稳** | a11y 安全优先 |
| 16 | 连续快速切换 | `cascadeTimeoutRef` 在前一次 cycle 残留时 clearTimeout；新 cycle 覆盖 delay + flag；cleanup 幂等 | 简单；不加 abort |

## 4. 时间轴

### 4.1 Copilot 关态

用户点击主题按钮 = `t = 0`：

| t (ms) | 事件 |
|---|---|
| 0 | `cycleTheme()` 同步执行 |
| 0 | `prefers-reduced-motion` check，不触发 → 继续 |
| 0 | **不写 delay**（关态）|
| 0 | `html.dataset.themeCascading = "true"` |
| 0 | `applyThemeClass(next)` —— 同步 toggle `.dark` class |
| 0 | `setTheme(next)` —— next-themes 更状态 + localStorage |
| 1 | 所有 `[data-glass-variant]` 因 inline `transition: bg-color 320ms ease, ...` + delay 0 同步起跑，transition 新主题色 |
| 320 | 所有 card transition 结束 |
| 1500 | `setTimeout` cleanup：`delete html.dataset.themeCascading`（本 scope 下无 delay 要清）|

### 4.2 Copilot 开态

| t (ms) | 事件 |
|---|---|
| 0 | `cycleTheme()` 同步执行 |
| 0 | 读 `html.style.--copilot-panel-width` 算 `panelVw`（已由 store 维护） |
| 0 | 遍历 `[data-glass-variant]`，按 `computeRevealDelay(cx, 100 - panelVw)` 写 `--theme-cascade-delay` 到各元素 inline style |
| 0 | `html.dataset.themeCascading = "true"` |
| 0 | `applyThemeClass(next)` |
| 0 | `setTheme(next)` |
| ~1 | 最右卡（cx 约 100 - panelVw）delay 0，开始 transition |
| ~320 | 最右卡 transition 结束 + chrome（body/aside/main）同步完成 320ms crossfade |
| ~500 | 屏中线 cards 开始 transition（假设 startVw 约 67, cx 33 → delay ~475ms）|
| ~1400 | 最左卡 delay max 1400ms 开始 transition |
| 1720 | 最左卡 transition 结束（1400 delay + 320 duration）|
| 2000 | Cleanup 清所有 `--theme-cascade-delay` + `data-theme-cascading` flag |

## 5. 组件与文件

**新增**：
- `src/lib/theme/cascade.ts` —— `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()` 纯副作用函数
- `src/lib/theme/__tests__/cascade.test.ts` —— 延迟分配逻辑 + CSS var 写入单测

**改**：
- `src/components/sidebar.tsx` —— `cycleTheme` 重构：调 `applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 2000)`
- `src/app/layout.tsx` —— `<ThemeProvider>` 删 `disableTransitionOnChange` prop
- `src/app/globals.css` —— 文末追加 Theme switch cascade section：1 条 CSS override rule + 1 条 reduced-motion 降级

**不新增 React 组件**：cascade 逻辑都在 JS 助手 + CSS，不需要独立 `<ThemeCascadeOverlay>` 组件。

**复用（不动）**：
- `src/lib/theme/apply.ts` 的 `applyThemeClass(next)` —— v1 遗产，保留
- `src/components/copilot/store.tsx` 的 `--copilot-panel-width` 维护 —— v0.5.3 已有
- `src/components/copilot/material-reveal-overlay.tsx` —— 完全不动（reveal cascade 和 theme cascade 互不干扰）

## 6. 核心算法

### 6.1 `applyThemeCascade`

```ts
/**
 * 同步写 --theme-cascade-delay 到每个 [data-glass-variant]；激活 cascade CSS override flag。
 *
 * 必须在 applyThemeClass 之前同步调用——否则 transition 已经按 inline 的 0 delay 起跑了，
 * 后写的 delay 对 in-flight transition 不生效。
 *
 * @param copilotOpen - 决定是否做 stagger（关态 = 不 stagger，全 0 同步 crossfade）
 * @param panelPx - copilot panel 当前像素宽度（copilotOpen=false 时无关紧要）
 */
export function applyThemeCascade(copilotOpen: boolean, panelPx: number): void {
  if (typeof document === "undefined") return
  const prefersReduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // a11y：不写 delay、不设 flag。调用方仍 applyThemeClass → 所有元素走 inline
  // transition 0 delay 同步 crossfade，符合"reduced-motion 下减少运动"预期。
  if (prefersReduce) return

  if (copilotOpen) {
    const vw = window.innerWidth
    if (vw > 0) {
      const panelVw = panelPx > 0 ? (panelPx / vw) * 100 : 0
      const startVw = 100 - panelVw
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => {
          const rect = el.getBoundingClientRect()
          const cx = ((rect.left + rect.width / 2) / vw) * 100
          // stagger window 0-1400ms：0 = 最右卡立刻起跑，1400ms = 最左卡最晚起跑
          const delay = Math.max(0, Math.min(1400, ((startVw - cx) / 100) * 1400))
          el.style.setProperty("--theme-cascade-delay", `${delay}ms`)
        })
    }
  }
  // copilot 关态：不写 delay（全 0 = 所有元素同步 crossfade）

  document.documentElement.dataset.themeCascading = "true"
}

export function clearThemeCascade(): void {
  if (typeof document === "undefined") return
  document
    .querySelectorAll<HTMLElement>("[data-glass-variant]")
    .forEach(el => el.style.removeProperty("--theme-cascade-delay"))
  delete document.documentElement.dataset.themeCascading
}
```

### 6.2 `cycleTheme`

```tsx
// src/components/sidebar.tsx 片段
import { applyThemeClass, type ResolvableTheme } from "@/lib/theme/apply"
import { applyThemeCascade, clearThemeCascade } from "@/lib/theme/cascade"
import { useCopilotStore } from "@/components/copilot/store"

const { open: copilotOpen, width: copilotWidth } = useCopilotStore()

const cycleTheme = () => {
  let next: ResolvableTheme
  if (theme === "light") next = "dark"
  else if (theme === "dark") next = "system"
  else next = "light"

  applyThemeCascade(copilotOpen, copilotOpen ? copilotWidth : 0)
  applyThemeClass(next)
  setTheme(next)

  setTimeout(clearThemeCascade, 2000)
}
```

注意：`applyThemeClass` → `setTheme` 顺序不变；`applyThemeCascade` **必须在这两者之前**（决策 16）。

### 6.3 CSS override（两部分）

在 `globals.css` 文末加：

```css
/* ---------------- Theme switch cascade ---------------- */

/* 1. Glass elements：镜像 reveal cascade 结构——完整 transition shorthand + delay var。
      reveal cascade 用同样的形式稳定在产，验证了"shorthand override with !important"安全。 */
html[data-theme-cascading="true"] [data-glass-variant] {
  transition:
    background-color 320ms ease-out var(--theme-cascade-delay, 0ms),
    backdrop-filter  320ms ease-out var(--theme-cascade-delay, 0ms),
    border-color     320ms ease-out var(--theme-cascade-delay, 0ms),
    box-shadow       320ms ease-out var(--theme-cascade-delay, 0ms),
    background-image 320ms ease-out var(--theme-cascade-delay, 0ms)
    !important;
}

/* 2. Chrome elements（非 glass）：和 glass baseline 同 320ms，无 stagger。
      只覆盖最显眼的大块背景 / 边框——body、两个 aside（sidebar + copilot panel）、main。
      关态：chrome + glass 都 320ms 无 delay → 整屏一次性 crossfade，无节奏差。
      开态：chrome 320ms（背景先 settle），glass 320ms + 0-1400ms stagger → R→L ripple 在干净背景上可见。
      不覆盖 text / icon / 小按钮，避免 v0.5.3 的 `*` paint 风暴。 */
html[data-theme-cascading="true"] body,
html[data-theme-cascading="true"] aside,
html[data-theme-cascading="true"] main {
  transition: background-color 320ms ease-out, border-color 320ms ease-out !important;
}

@media (prefers-reduced-motion: reduce) {
  html[data-theme-cascading="true"] [data-glass-variant],
  html[data-theme-cascading="true"] body,
  html[data-theme-cascading="true"] aside,
  html[data-theme-cascading="true"] main {
    transition: none !important;
  }
}
```

**注意**：
- `!important` 必须——要覆盖 glass card 的 inline `transition` shorthand（author 级）
- Chrome 规则用 transition 简写替换（不是只动 delay），因为 body/aside 原本无 transition，这是**从无到有**添加
- Reduced-motion 下把所有 transition 都砍掉，用户直接 snap——比"减到 0 duration 保留 transition"更安全

## 7. `<ThemeProvider>` 变动

```tsx
// src/app/layout.tsx（片段）
// before:
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>

// after:
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
```

只删掉 `disableTransitionOnChange` prop。

**Q: 初次加载还会 flash 吗？**

A: 不会。next-themes 的防 flash 机制是两套：
1. **初次加载**：组件树挂载前，`ThemeProvider` 内部往 `<head>` 注入一段 inline `<script>`，同步从 localStorage 读 theme 并 apply `.dark` class 到 `<html>`——早于任何 CSS 解析。**这和 `disableTransitionOnChange` 正交**，删后者不影响前者
2. **运行时切换**：`disableTransitionOnChange` 注入临时 `<style>* { transition: none }`——这是我们要删的。删了之后运行时切换会触发 transition，这正是本 spec 的主体机制

删 `disableTransitionOnChange` 的唯一代价：某些很少见的、不走 `cycleTheme` 路径的 theme 变化（OS system 偏好切换时 next-themes 的 media query listener 触发）也会带 transition——这种路径不值得 snap，带 transition 可以接受。

## 8. 边界 / 异常

| 场景 | 处理 |
|---|---|
| 无 `[data-glass-variant]` 元素（首次渲染） | 遍历空集合，仅写 flag，所有背景色直接 snap（整屏 bg 也会跟着新主题变，但无 card 元素 transition） |
| Panel 未开但 `copilotOpen === true`（race） | 读 `copilotWidth`（store）；panel 本身还没 render DOM 不影响——cascade 按 store 里记录的宽度算 |
| Cleanup 在下一次 cycle 之后才跑（连续快速点击） | 每次 cycle 都写新 delay；旧 setTimeout 晚 1500ms 跑 `clearThemeCascade` 会误清新 delay。**Fix**：用 `setTimeout` 的 ref 存取 + 前次 cycle 时 `clearTimeout`。见 §9 实现细节 |
| Cascade 进行中用户刷新页面 | SSR/hydrate 不受影响；flag 和 delay 都是 session state，刷新丢掉没事 |
| `next-themes` useEffect 和我们手动 `applyThemeClass` 竞争 | next-themes 看到 class 已对，no-op（v0.5.4 v1 就这样运行无问题） |
| 用户通过 OS 偏好切 system dark → light | next-themes media listener 触发 → 直接 class swap；我们的 cycleTheme 不触发，无 cascade flag；inline transition 按 0 delay 起跑，所有卡片同步 crossfade 320ms。可接受 |
| Cascade 没写完就又点击切主题 | 下次 cycle 写新 delay（覆盖），transition-property 不变，in-flight transition 会被新 class value 重定向到新目标色；视觉上是"切换中途改方向"。可以接受；不加防抖 |
| 元素在 cascade 中途被 unmount（例如切页） | 无影响——元素消失，transition 跟着消失 |

## 9. 实现细节

### 9.1 setTimeout ref + 前次 cycle 时 clearTimeout

```tsx
const cascadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const cycleTheme = () => {
  // ...

  if (cascadeTimeoutRef.current) {
    clearTimeout(cascadeTimeoutRef.current)
  }

  applyThemeCascade(copilotOpen, copilotOpen ? copilotWidth : 0)
  applyThemeClass(next)
  setTheme(next)

  cascadeTimeoutRef.current = setTimeout(() => {
    clearThemeCascade()
    cascadeTimeoutRef.current = null
  }, 1500)
}
```

### 9.2 冷启动防止 flag 残留

如果 cascade 正在跑时页面刷新（dev HMR），flag 残留在 DOM —— 但 SSR 重生成，刷新后 DOM 是新的，无残留。生产环境也不会遇到。

### 9.3 `will-change` 是否需要

Glass card 数量约 ~100 个同时 transition 在 `background-color` 上。modern GPU 基本无压力（色值 interpolation，非布局 / shadow / filter 变化）。**先不加 will-change**，实测卡顿再加。

## 10. 和 reveal cascade 的关系

| 维度 | Reveal cascade | Theme cascade |
|---|---|---|
| 触发 | `store.setOpen` rising edge | 用户点击主题按钮 |
| 生效范围 | `[data-glass-variant]` 元素 | 同 |
| CSS var | `--reveal-delay` | `--theme-cascade-delay` |
| Flag | `data-copilot-revealing` | `data-theme-cascading` |
| Override | **full transition shorthand**（改 property + duration + delay） | 同 |
| Offset | 750ms（wait for wave）+ stagger | 无 offset，直接 stagger 0-1400ms |
| Max delay | 2000ms | 1400ms |
| Cleanup delay | 2400ms | 2000ms |
| 允许同时触发 | 不强制；极小概率交叠 | 同 |

两个 CSS override rule 在同一个 `[data-glass-variant]` 元素上会同时 match 吗？可以。Reveal 用 `data-copilot-revealing` 选择器、theme 用 `data-theme-cascading` 选择器，同 specificity，后声明者赢。把 theme cascade 规则写在 reveal cascade 规则**之后**，theme 赢。实际发生时：theme 的完整 shorthand 覆盖 reveal 的完整 shorthand，视觉上走主题的节奏——可接受。

但这种 race 极小概率（用户在 copilot 开启过渡中立刻切主题），不是主 path。

## 11. 相对 v0.5.4 v1 + v0.5.3 两次尝试的定位

| # | 尝试 | 方案 | 结果 |
|---|---|---|---|
| 1 | v0.5.3 | Element-level + stagger + shorthand override + **`*` 选择器**（全页） + 遇到 `disableTransitionOnChange` 吞 transition | **失败**：cleanup flicker（property 栈 widespread 撤销）+ paint 风暴（`*` 扫全页） |
| 2 | v0.5.4 v1 | `document.startViewTransition` + clip-path wipe/radial | **被放弃**：视觉是"扫描线"，不是用户要的"每元素自己变" |
| 3 | v0.5.4 v2.1（本 spec）| **镜像 reveal cascade** 做 glass（shorthand override + delay var，scope `[data-glass-variant]`） + 非 glass chrome 和 glass baseline 同 320ms crossfade（body/aside/main，无 stagger） + 删 `disableTransitionOnChange` | 按本 spec 实现 |

v2.1 相对 v0.5.3 的关键修正：
1. **Scope 收窄**：`*` → `[data-glass-variant]`（glass，~30-50 元素）+ 手写 4 个 chrome selector；不再扫全页
2. **`disableTransitionOnChange` 移除**：这是 v0.5.3 的另一个根因——即使 override 写得对，transition 也被 next-themes 吞
3. **Chrome 和 glass 同 320ms baseline**：首轮 v2 设计过"breathing" 差节奏（chrome 500ms），首轮 smoke 后反馈刺眼，统一 320ms 更干净（开态 chrome 先 settle，glass 独立做 R→L stagger，层次反而更清）

## 12. 测试

### 12.1 单测

`src/lib/theme/__tests__/cascade.test.ts`：

- `applyThemeCascade(false, 0)`：不写 delay；设 flag
- `applyThemeCascade(true, 420)`：按 panel 宽度算 startVw；给 mock 元素写合理 delay
- `applyThemeCascade(..., ..)` with `prefers-reduced-motion: reduce`：既不写 delay 也不设 flag（也可以选"设 flag 但不写 delay"——决策 17）
- `clearThemeCascade()`：清 delay + 清 flag

### 12.2 手动 smoke checklist

Chrome + Safari：

| Copilot 状态 | 切换 | 期望 |
|---|---|---|
| 关 | light → dark | 所有 card 同步 320ms crossfade |
| 关 | dark → system (= light) | 同 |
| 关 | 点很快连续 3 次 | 每次都正常，无残留 flicker |
| 开 | light → dark | 右边 card 先变色，R→L 依次翻面，约 1.3s 内完成 |
| 开 | dark → system | 同 |
| 开 | 切换后立刻关 copilot | Cleanup 时无 in-flight transition（1500ms 后）→ 无闪 |
| 任一 | `prefers-reduced-motion: reduce` | 直接 snap，无 cascade |

### 12.3 Playwright 探针

断言：
- 切主题后 `document.getAnimations()` 不含有 `-ua-view-transition-*`（本 spec 不用 View Transitions）
- `[data-glass-variant]` 元素在 cascade 期间有 `transition-delay > 0`（copilot 开态）
- Cleanup 时（1500ms 后）所有 `--theme-cascade-delay` 清除

## 13. Fallback

- **`prefers-reduced-motion: reduce`**：跳过 stagger，`applyThemeClass` 仍 toggle class，所有元素以 0 delay 转场（不 snap——保留 320ms transition 以免突兀）
- **`[data-glass-variant]` 空**：无副作用，`setTheme` 继续切；body 和其他非 glass 元素的颜色会 instant 变（没有 transition），glass 卡不存在就没得 transition
- **SSR**：`cycleTheme` 只在 client 侧调用，SSR 渲染不涉及
- **旧浏览器**：CSS `transition` 和 CSS var 是 baseline 功能，所有目标浏览器都支持

## 14. Spec 外（未来迭代）

- 从主题按钮发出 ripple 装饰（用户明确不要）
- Theme cascade 结合 per-glass-card filter 动画（如 brightness pulse）—— 先上本 spec 的基础版
- stagger 期间渐变背景色（整屏 bg 也 cascade）—— 目前 body bg 是 instant snap
- Dark → Light 的色相过渡走感知均匀空间（oklch 路径）—— 默认 transition 用 sRGB，看起来可能有中间灰黄；若需要升级 `color-interpolation` 介入
