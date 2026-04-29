# Copilot Material Reveal · 一次性唤起波纹设计

> 日期 2026-04-29 · Scope: Evalyst copilot UI · 继 edge glow 整条 DROP 后的新方案

## 1. 目标

用户按 `⌘K` / 点击 toggle 打开 copilot 时，在整个主内容区（非 sidebar、非 copilot panel 自身）铺一次性的 **高光扫过 + 玻璃化 cascade**：

- 从屏幕右边缘起、向左扫过一道高光带，700 ms 内出屏
- 沿途触发 `[data-glass-variant]` 元素依次从扁平 → 玻璃（"波至即亮"）
- 850 ms 内整套结束，overlay 卸载，屏幕处于稳定玻璃态

效果语义："AI 像一阵波纹一样扫过工作区，把被拂过的 UI 点化成玻璃态"。

## 2. 非目标

- ❌ WebGL / SVG feDisplacement —— 上一轮 edge glow WebGL 已整条 DROP，这次走 CSS
- ❌ 从 toggle 按钮做径向扩散 —— 定死线性带 R→L
- ❌ 关闭 copilot 时的出场动画 —— 关闭无动效，panel 收 width 0 + 立即去 `data-copilot-open`
- ❌ 每张卡单独的 clip-path 渐显 —— cascade 只靠 transition-delay 错峰，不做真正的遮罩
- ❌ 彩色光谱 —— accent (sky blue) 主导，不上紫/琥珀
- ❌ 首次页面 load 恢复 `open=true` 时触发 —— 刷新不放动效
- ❌ 中断重入的复杂合并逻辑（850 ms 内连续 open/close/open）—— 清 + 重起即可

## 3. 决策

按决策顺序列，每条都有具体取值和理由。

| # | 决策 | 最终取值 | 理由 |
|---|---|---|---|
| 1 | 渲染路线 | CSS/SVG 扫光 | edge glow WebGL 刚 DROP；一次性 <1s 用 CSS 足够 |
| 2 | 时序同步 | 波纹先起动，`data-copilot-open` 立即置位，但 glass 的 `transition` 靠 `--reveal-delay` 错峰 | 视觉上波至即亮，因果感强 |
| 3 | 波纹形状 | 线性垂直带，R→L | 匹配"panel 在右，AI 从 panel 拂来"的物理 metaphor |
| 4 | 色彩 | accent 主导（sky blue，`var(--copilot-accent)`） | 和现有 glow-overlay 色呼应，不上光谱避免"彩虹故障"观感 |
| 5 | 关闭行为 | 无动画 | 用户决策：唤醒有仪式，告别干净利落 |
| 6 | 复播策略 | 每次 `open: false → true` 都放 | 最简单无隐藏状态，`⌘K` 频繁开关的疲劳问题暂观察 |
| 7 | Cascade 驱动 | JS 一次性 pass 计算每个 `[data-glass-variant]` 的 `--reveal-delay`，CSS 读 var 错峰 transition | 纯 CSS 不能读元素位置；JS 一次 pass 开销 <5ms/次 |
| 8 | Reveal CSS override 作用域 | `html[data-copilot-revealing="true"] [data-glass-variant]` 高优先级 transition 段，reveal 完成后清 | 不污染 `shell.tsx` 默认 320 ms 平时 transition |
| 9 | 色彩混合 | `mix-blend-mode: overlay` + accent/18% 透明度 | 光让底色上扬而非盖白；overlay 在 iOS Safari 浅灰底上稳定 |

## 4. 时间轴（单次 reveal 全过程）

以 ⌘K 开面板的时刻为 `t = 0`。

| t (ms) | 事件 |
|---|---|
| 0 | `setOpen(true)` → store 的 `lastOpenedAt = performance.now()` |
| 0 | store effect 同步写 `html.dataset.copilotOpen = "true"`（和现在一样） |
| 0 | `<MaterialRevealOverlay>` 看到 `lastOpenedAt` 变化 + `prefers-reduced-motion !== reduce` + 非首次 mount → 进入 reveal 流程 |
| 0 | `useLayoutEffect`：遍历 `document.querySelectorAll('[data-glass-variant]')`，按位置算 `--reveal-delay` 写到每个元素；设 `html.dataset.copilotRevealing = "true"` |
| 0 | 渲染 `<div class="copilot-reveal-wave">` 和 `<div class="copilot-reveal-tail">`，CSS `animation` 自动启动 |
| 0–700 | 波纹从 `background-position-x: 100vw` 扫到 `-30vw`，`cubic-bezier(0.25, 0.1, 0.25, 1)` |
| 80–780 | 尾浪层同轨迹、延后 80 ms |
| 0–~584 | 每个卡片按 `--reveal-delay` 陆续进入 glass transition（最右 0ms 起；屏中线约 292ms 起；最左约 584ms 起） |
| ~280–~864 | 每张卡的 280 ms glass transition 在各自 delay 起点后完成 |
| 850 | `setTimeout` 清理：`querySelectorAll('[data-glass-variant]')` 删除 `--reveal-delay` inline 属性；清 `data-copilot-revealing`；unmount overlay |

**注**：glass cascade 理论最后完成时刻 = 584 + 280 = 864 ms，但 overlay 850 ms 清理时，最左卡可能还差 14 ms 未跑完。这 14 ms 从 `[data-copilot-revealing]` override 回落到 `shell.tsx` 默认 320 ms 普通 transition —— 两条 transition 连续切换的视觉差异在 14 ms 内肉眼不可见。如后续发现残留感，把 cleanup 延到 900 ms。

## 5. 组件与文件

**新增（1 个）**：

- `src/components/copilot/material-reveal-overlay.tsx` —— 全屏 overlay 组件 + cascade 计算

**编辑（3 个）**：

- `src/components/copilot/store.tsx` —— 加 `lastOpenedAt: number`，在 `setOpen` 和 `toggleOpen` 检测 rising edge 时写入
- `src/app/globals.css` —— 加 `@keyframes copilot-reveal-wave`、`.copilot-reveal-wave`、`.copilot-reveal-tail`、`html[data-copilot-revealing="true"] [data-glass-variant]` override、a11y 降级段
- `src/app/layout.tsx` —— 挂 `<MaterialRevealOverlay />`（放在现有 `<GlowOverlay />` 之后、`<CopilotPanel />` 之前）

**不动（明确）**：

- `src/components/copilot/shell.tsx` —— 默认 320 ms 普通 transition 保留原样，reveal 期间被 `data-copilot-revealing` 段接管，结束后自动回落
- `src/components/copilot/glow-overlay.tsx` —— 背景漂移光斑不变
- `src/components/copilot/panel.tsx` —— 无 width transition 的注释保留（width 过渡与 glow blur 合成每帧 21 MB 的限制仍在）

## 6. 核心算法：`computeRevealDelay`

纯函数，吃元素水平中心和视口宽度，吐延迟 ms：

```typescript
/**
 * 计算某卡片受 wave 驱动的 glass transition 启动延迟。
 *
 * 波纹中心从 x=100vw 起，700ms 线性扫到 x=-20vw（覆盖 120vw 距离）。
 * 返回：wave 中心到达卡片中心的时刻（ms），夹在 [0, 600] 区间。
 *
 * @param centerXvw  卡片水平中心位置（vw 单位，0 = 左边缘，100 = 右边缘）
 * @returns ms
 */
export function computeRevealDelay(centerXvw: number): number {
  const fromVw = 100
  const totalVwTraveled = 120      // 100 → -20
  const durationMs = 700
  const raw = ((fromVw - centerXvw) / totalVwTraveled) * durationMs
  return Math.max(0, Math.min(600, raw))
}
```

调用侧：

```typescript
const vw = window.innerWidth
if (vw <= 0) return  // 极端情况，跳过 cascade，只播波纹
const elems = document.querySelectorAll<HTMLElement>('[data-glass-variant]')
elems.forEach(el => {
  const rect = el.getBoundingClientRect()
  const centerXvw = ((rect.left + rect.width / 2) / vw) * 100
  el.style.setProperty('--reveal-delay', `${computeRevealDelay(centerXvw)}ms`)
})
```

## 7. CSS 全文

添加到 `src/app/globals.css` 文件末尾（在现有最后一条 `prefers-reduced-motion` 段落之后）：

```css
/* ---------------- Copilot Material Reveal ---------------- */

/* !important 必须：shell.tsx useGlassStyle 把 transition 作为 inline style（author 级），
   外部规则没有 !important 则落败。`!important` 挂在 shorthand 末尾即覆盖整个 transition 声明。 */
html[data-copilot-revealing="true"] [data-glass-variant] {
  transition:
    background-color 280ms ease-out var(--reveal-delay, 0ms),
    backdrop-filter  280ms ease-out var(--reveal-delay, 0ms),
    border-color     280ms ease-out var(--reveal-delay, 0ms),
    box-shadow       280ms ease-out var(--reveal-delay, 0ms),
    background-image 280ms ease-out var(--reveal-delay, 0ms)
    !important;
}

.copilot-reveal-wave,
.copilot-reveal-tail {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  mix-blend-mode: overlay;
  will-change: background-position;
  contain: layout style paint;
}

.copilot-reveal-wave {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--copilot-accent), transparent 82%) 35%,
    color-mix(in oklab, white, transparent 60%) 50%,
    color-mix(in oklab, var(--copilot-accent), transparent 82%) 65%,
    transparent 100%
  );
  background-size: max(360px, 22vw) 100%;
  background-repeat: no-repeat;
  animation: copilot-reveal-wave 700ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

.copilot-reveal-tail {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--copilot-accent), transparent 92%) 50%,
    transparent 100%
  );
  background-size: 40vw 100%;
  background-repeat: no-repeat;
  opacity: 0.7;
  animation: copilot-reveal-wave 700ms cubic-bezier(0.25, 0.1, 0.25, 1) 80ms forwards;
}

@keyframes copilot-reveal-wave {
  from { background-position-x: 100vw; }
  to   { background-position-x: -30vw; }
}

@media (prefers-reduced-motion: reduce) {
  .copilot-reveal-wave,
  .copilot-reveal-tail {
    animation: none;
    display: none;
  }
  html[data-copilot-revealing="true"] [data-glass-variant] {
    transition:
      background-color 200ms ease,
      backdrop-filter  200ms ease,
      border-color     200ms ease,
      box-shadow       200ms ease,
      background-image 200ms ease
      !important;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .copilot-reveal-wave,
  .copilot-reveal-tail {
    display: none;
  }
}
```

## 8. `<MaterialRevealOverlay>` 组件契约

```tsx
"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

export function computeRevealDelay(centerXvw: number): number { /* §6 */ }

export function MaterialRevealOverlay() {
  const { lastOpenedAt } = useCopilotStore()
  const [active, setActive] = useState(false)
  const firstMountRef = useRef(true)

  useLayoutEffect(() => {
    // 首次 mount（刷新页面恢复 open=true）不触发
    if (firstMountRef.current) { firstMountRef.current = false; return }
    if (lastOpenedAt === 0) return

    // a11y: reduced motion 跳过 overlay 本身；但仍需 revealing flag 走加速 transition
    const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // 计算每卡 delay，写 inline var
    const vw = window.innerWidth
    const elems = document.querySelectorAll<HTMLElement>('[data-glass-variant]')
    if (vw > 0 && !prefersReduce) {
      elems.forEach(el => {
        const rect = el.getBoundingClientRect()
        const centerXvw = ((rect.left + rect.width / 2) / vw) * 100
        el.style.setProperty("--reveal-delay", `${computeRevealDelay(centerXvw)}ms`)
      })
    }

    document.documentElement.dataset.copilotRevealing = "true"
    setActive(true)

    const cleanupDelay = prefersReduce ? 220 : 850

    /**
     * 清理函数：重新 querySelectorAll 一次（不用捕获的 elems），
     * 因为 DOM 可能在 850ms 内变化（路由切换 / 卡新挂载）。
     * 对没有 --reveal-delay 的元素调 removeProperty 是 no-op。
     */
    const cleanup = () => {
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => el.style.removeProperty("--reveal-delay"))
      delete document.documentElement.dataset.copilotRevealing
      setActive(false)
    }

    const timer = setTimeout(cleanup, cleanupDelay)

    // 组件 unmount / lastOpenedAt 再次变化（850ms 内二次开）时，先跑 cleanup 再进下一轮
    return () => {
      clearTimeout(timer)
      cleanup()
    }
  }, [lastOpenedAt])

  if (!active) return null
  return (
    <>
      <div className="copilot-reveal-wave" aria-hidden />
      <div className="copilot-reveal-tail" aria-hidden />
    </>
  )
}
```

## 9. store.tsx 变更

在 `CopilotStore` 接口加一个字段：

```typescript
interface CopilotStore {
  // ... 现有字段
  /** rising edge 时间戳，给 MaterialRevealOverlay 订阅。0 = 从未开过。 */
  lastOpenedAt: number
}
```

`setOpen` 内：

```typescript
const setOpen = useCallback((v: boolean) => {
  setOpenState(prev => {
    if (v && !prev) setLastOpenedAt(performance.now())   // rising edge
    return v
  })
  try { localStorage.setItem(LS_OPEN, v ? "1" : "0") } catch {}
  if (!v) setInspectorActive(false)
}, [])
```

`toggleOpen` 同理检测 `prev === false && next === true`。

`NOOP_STORE` 补 `lastOpenedAt: 0`。

## 10. `layout.tsx` 挂载

在 `<CopilotStoreProvider>` 子树内、与其他 copilot overlay 同级处挂 `<MaterialRevealOverlay />`（例如 `<GlowOverlay />` 相邻位置）。具体行位置以实际 layout.tsx 现状为准。

## 11. A11y

- **`prefers-reduced-motion: reduce`**：
  - `.copilot-reveal-wave / .copilot-reveal-tail` 不渲染
  - cascade override 生效但把 280ms 改成 200ms、去掉 `--reveal-delay` 错峰 → 全屏玻璃 200ms 内均匀完成
  - 效果 = 一次 200ms 纯玻璃 fade-in，无波纹
- **`prefers-reduced-transparency: reduce`**：
  - 波纹 overlay 不渲染
  - 玻璃本身被现有 §349-358 的段落降级为 `background-color: var(--card)` + 无 blur
  - reveal cascade 在实底色上仍然 280ms 完成颜色过渡，观感是"底色慢慢淡入"
- **`prefers-contrast: more`**：沿用现有 §360-368 段落，reveal 不额外处理（本身已在高对比模式下没有玻璃）

## 12. 测试

**单测（vitest）**：

- `src/components/copilot/__tests__/material-reveal-overlay.test.ts`
  - `computeRevealDelay(100)` → 0
  - `computeRevealDelay(50)` ≈ 292
  - `computeRevealDelay(0)` ≈ 583
  - `computeRevealDelay(-20)` → 700 → 夹到 600
  - `computeRevealDelay(120)` → -117 → 夹到 0
- 不跑 DOM / animation timing 测试

**e2e smoke**：不扩。现有 9 case 覆盖路由 no-crash 即可。

**人工验证**：
- `npm run dev`，在 dashboard（多卡并排）、experiment detail（多类型卡混合）、compare（两张大 card 并排）三个页面分别：
  1. 开关 ⌘K 各 5 次，观察波纹顺畅、cascade 次序、清理干净（无 `--reveal-delay` 残留 in DevTools）
  2. DevTools Performance tab 录制一次 open，确认主线程无长任务（预期 < 16 ms/frame）
  3. DevTools Settings 勾上 `prefers-reduced-motion: reduce`，验证波纹不出现且 cascade 变短
  4. DevTools `prefers-reduced-transparency: reduce`，验证 overlay 不出现且 UI 仍正确降级

## 13. 风险 + 未决

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | `mix-blend-mode: overlay` 在 iOS Safari 暗色页面（如某些 modal 深色背景）失真 | 观感偏淡 | 项目默认亮色；暗色主题用户测试一遍 |
| 2 | 850 ms 内频繁 ⌘K 切换导致 `setTimeout` 堆叠 | cascade 属性可能提前清，波纹被切 | overlay 组件在 effect cleanup 强制 `removeProperty` + `clearTimeout` |
| 3 | 单页 `[data-glass-variant]` 超过 100 个（超长列表） | 遍历 5-10 ms | 当前页面最多 ~30 个，不缓解 |
| 4 | 用户自建 JSX display 若新增 `data-glass-variant` 节点没按惯例设（漏设或错设） | 该节点不受 cascade 驱动，走默认 320ms | 既有 shell helpers API 足够，不额外约束 |

## 14. 回滚

三文件 + 一文件改动，风险面明确：

- 回滚 = 删 `material-reveal-overlay.tsx`、删 globals.css 末尾段、删 store 里 `lastOpenedAt`、删 layout.tsx 那一行 mount
- 不影响现有 glass 系统、glow-overlay、panel、context 机制、工具调用

## 15. 后续（显式不做）

- 沿波纹轨迹发射 sparkle 光点：不做
- 每次 reveal 随机 accent hue shift：不做
- 不同页面根据内容密度调参（wave 速度/高度）：不做
- AB 实验 on/off：不做
