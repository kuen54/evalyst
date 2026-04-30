# 主题切换 cascade 设计 v2 · Element-level transition + delay stagger

> 日期 2026-04-30 · Scope: Evalyst copilot UI · 替代同名 v1 方案（View Transitions API），后者在用户体感验证后被放弃
>
> **前情**：
> - v0.5.3 deferred 的 R→L cascade（`2026-04-29-copilot-material-reveal-design.md` §18.4）
> - v0.5.4 第一次尝试：View Transitions API（现归档在 `archive/theme-view-transitions` 分支 + PR #12 closed）
> - v0.5.4 第二次尝试：本 spec。用 element-level CSS transition + 错峰 delay，复用 reveal cascade 的机制

## 1. 目标

切主题（light ⇌ dark ⇌ system）时，让**每个 glass card UI 元素自己**按 R→L 的顺序依次变色——不是某一条"扫描线"在刷页面，而是每张卡自己翻色。

- **Copilot 关**：所有 glass card 同时（0 delay）走原生 `transition` 淡入新主题色——视觉上是一次全屏柔和 crossfade，~320ms 内完成
- **Copilot 开**：每张 glass card 按 x 位置算 R→L 错峰 delay；stagger 窗口 ~1000-1500ms；视觉上类似 reveal cascade "每张卡自己翻面"
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
| 1 | 整体路线 | Element-level `transition-delay` stagger | 用户要"每个 UI 自己变"；唯一能做到的路线 |
| 2 | 触发元素 | `[data-glass-variant]`（和 reveal cascade 同） | 已有统一标记；覆盖所有主内容区的 glass card |
| 3 | Delay 公式 | 本地 `(startVw - cx) / 100 * 1000`，clamp [0, 1000] | 不复用 `computeRevealDelay`（它有 750ms offset + 2000ms clamp，主题 cascade 的 offset 和 clamp 都不同） |
| 4 | Copilot 关态 `startVw` | `100`（屏右） | Delay 全部 ≥ 0，最右卡片 0ms，最左卡片 ~850ms |
| 5 | Copilot 关态特殊化 | 不写 delay（全 0）= 所有卡同时 transition | 用户反馈关态"不需要 cascade 效果"；简单 crossfade |
| 6 | Copilot 开态 `startVw` | `100 - panelVw`（panel 左边缘） | 和 reveal cascade 完全一致 |
| 7 | CSS override | **只 override `transition-delay`，不动 property / duration / easing** | v0.5.3 的 cleanup flicker 根源是 transition-property 栈变化；这次只动 delay 避开 |
| 8 | Delay 上限 | 1000ms（开态最左卡）| 短于 reveal cascade 的 2000ms——主题切换是频繁操作，不应过长 |
| 9 | Transition duration | 不改——用元素自身 inline `transition: ... 320ms ease` | 减少一层复杂度；320ms 对主题色切换足够 |
| 10 | `disableTransitionOnChange` | **从 `<ThemeProvider>` 移除** | 它会在 class 切换时注入 `<style>* { transition: none !important }` 约 1 帧 → 所有元素 transition 被吞，cascade 跑不起来。初次加载 flash 由 next-themes 的 inline `<script>` 注入保护（和 disableTransitionOnChange 正交） |
| 11 | Class 切换机制 | 复用已有的 `applyThemeClass(next)`（v0.5.4 v1 遗产） | 同步 DOM 改动；比 next-themes `setTheme` 早一个 tick |
| 12 | Cascade flag | `html.dataset.themeCascading = "true"` | 激活 CSS override；和 reveal cascade 的 `data-copilot-revealing` 不同命名空间 |
| 13 | CSS var 名 | `--theme-cascade-delay`（不是 `--reveal-delay`） | 两个 cascade 正交，避免同元素被 reveal 和 theme 同时 cascade 时串味 |
| 14 | Cleanup 时机 | `setTimeout 1500ms`（max delay 1000 + duration 320 + 180ms 余量）| 确保所有 transition 已结束，cleanup 对 in-flight 元素无影响 |
| 15 | `prefers-reduced-motion: reduce` | 跳过 cascade，直接 `setTheme`（snap） | 标准 a11y 降级 |
| 16 | 连续快速切换 | 后一次 cycleTheme 直接覆盖前一次 —— JS 写新 delay + 新 flag，之前的 setTimeout cleanup 照跑但只清不存在的 key，幂等 | 简单；不加 abort/debounce |

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
| ~300 | 屏中线 cards 开始 transition（假设 startVw 约 67, cx 33 → delay ~500ms，300ms 在算 delay 区间内开始还没到） |
| ~500 | 屏中线 cards 开始 transition |
| ~1000 | 最左卡 delay max 约 1000ms（实际按 clamp）开始 transition |
| 1320 | 最左卡 transition 结束（1000 delay + 320 duration）|
| 1500 | Cleanup 清所有 `--theme-cascade-delay` + `data-theme-cascading` flag |

## 5. 组件与文件

**新增**：
- `src/lib/theme/cascade.ts` —— `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()` 纯副作用函数
- `src/lib/theme/__tests__/cascade.test.ts` —— 延迟分配逻辑 + CSS var 写入单测

**改**：
- `src/components/sidebar.tsx` —— `cycleTheme` 重构：调 `applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 1500)`
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
          const delay = Math.max(0, Math.min(1000, ((startVw - cx) / 100) * 1000))
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

  setTimeout(clearThemeCascade, 1500)
}
```

注意：`applyThemeClass` → `setTheme` 顺序不变；`applyThemeCascade` **必须在这两者之前**（决策 16）。

### 6.3 CSS override

在 `globals.css` 文末加：

```css
/* ---------------- Theme switch cascade ---------------- */

/* 只 override transition-delay，不动 transition-property / duration / easing。
   Inline 的 transition（来自 useGlassStyle）保留，cascade 只是"让每张卡晚一点起跑"。
   v0.5.3 的 cleanup flicker 根源是 transition-property 栈变化；这里严格避免。 */
html[data-theme-cascading="true"] [data-glass-variant] {
  transition-delay: var(--theme-cascade-delay, 0ms) !important;
}

@media (prefers-reduced-motion: reduce) {
  html[data-theme-cascading="true"] [data-glass-variant] {
    transition-delay: 0ms !important;
  }
}
```

**注意**：`!important` 必须——inline style 的 `transition` shorthand 里也隐含了 transition-delay: 0，没有 `!important` override 不赢。

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
| Override | **full transition shorthand**（改 property + duration + delay） | **只改 delay** |
| Offset | 750ms（wait for wave）+ stagger | 无 offset，直接 stagger 0-1000ms |
| Max delay | 2000ms | 1000ms |
| Cleanup delay | 2400ms | 1500ms |
| 允许同时触发 | 不强制；极小概率交叠 | 同 |

两个 CSS override rule 在同一个 `[data-glass-variant]` 元素上会同时 match 吗？可以。但：
- Reveal cascade 改 transition shorthand
- Theme cascade 只改 transition-delay
- 两个规则 specificity 相等（都是一个 attr selector + 一个 attr selector），后声明者赢

我们把 theme cascade 规则写在 reveal cascade 规则**之后**，theme cascade 的 delay override 会赢——但 property/duration 仍来自 reveal cascade。视觉上 = "按 reveal 的 transition-property 走，但 delay 用主题的"——合理。

但这种 race 极小概率（用户在 copilot 开启过渡中立刻切主题），不是主 path。

## 11. 相对 v0.5.4 v1 + v0.5.3 两次尝试的定位

| # | 尝试 | 方案 | 结果 |
|---|---|---|---|
| 1 | v0.5.3 尝试 | Element-level transition + stagger + `transition-property` override | **失败**：cleanup flicker（property 栈撤销补帧）+ paint 风暴 |
| 2 | v0.5.4 v1 | View Transitions API + clip-path wipe/radial | **被放弃**：视觉是"扫描线"，不是用户要的"每元素自己变" |
| 3 | v0.5.4 v2（本 spec）| Element-level transition + stagger + **只** `transition-delay` override | —— 按本 spec 实现 |

v2 的关键差异：**严格不碰 transition-property**。这从机制上避开了 v0.5.3 的 flicker 根源——property 栈不变，cleanup 不触发 reconcile 帧。paint 压力虽然仍在（~100 元素 staggered 内 transition），但分布在 1.3s 窗口里，每秒有效 paint 数 ~70-80，现代 GPU 压力可控。

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
