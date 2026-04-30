# 主题切换 cascade 设计 · View Transitions API

> 日期 2026-04-30 · Scope: Evalyst copilot UI · 在 v0.5.3 defer 的"主题切换 R→L cascade"之后重做
>
> **前情**：v0.5.3 尝试过「元素级 transition + 错峰 delay」模拟主题切换 cascade，多轮 tuning 后仍有两个不可调和的问题（cleanup 闪烁 + paint 风暴），整体 revert，deferred 到本版本。spec `2026-04-29-copilot-material-reveal-design.md` §18.4 有记录。本方案从机制上换路径。

## 1. 目标

切主题时（light ⇌ dark ⇌ system），整个视图以动画过渡到新主题态，替代现状"`.dark` class toggle 瞬间 snap"的生硬观感：

- **copilot 关**：从主题按钮位置径向扩散 700ms，新主题"墨点般"从按钮位置蔓延覆盖整屏
- **copilot 开**：中间主内容区（`<main>`）R→L wipe 700ms（和打开 copilot 的 reveal cascade 方向一致）；sidebar + copilot panel 做 200ms 快速交叉淡入
- **fallback**：浏览器不支持 View Transitions / `prefers-reduced-motion: reduce` → 走现状 snap，不产生任何副作用

**核心硬约束**：不能有闪烁。v0.5.3 的失败根源（cleanup 时 `transition-property` 栈撤销补帧 + 100+ 元素同时 transition 引起 paint 风暴）必须从机制上绕开，而不是调参压制。

## 2. 非目标

- ❌ 动每个 `[data-glass-variant]` 元素的 transition（v0.5.3 走过这条路，不通）
- ❌ 主题按钮之外的切换路径做动画（system 偏好 OS 自动切换时直接 snap，属于极少数场景）
- ❌ 浏览器不支持时的 polyfill（fallback 到现状已经 acceptable）
- ❌ 关闭 copilot 过程中切主题的特殊处理（独立两个操作，互不影响）
- ❌ 主题切换过程中的中断重入复杂合并（`startViewTransition` 自动 skip 上次未完成 transition）
- ❌ 切主题连带动 `--copilot-panel-width` 等 copilot 状态（主题和 copilot 正交）

## 3. 决策

| # | 决策 | 最终取值 | 理由 |
|---|---|---|---|
| 1 | 渲染路线 | **View Transitions API**（`document.startViewTransition`） | 浏览器原生合成层 blit，不走元素级 transition，规避 v0.5.3 的两个 root cause |
| 2 | 过渡模式 | old 保持 opacity 1 不动；new 在上层通过 clip-path 逐步覆盖 | 符合"新主题蔓延覆盖旧主题"的直觉；old 淡出会产生双主题并存的中间帧，观感差 |
| 3 | copilot 关形状 | radial from button | 用户交互驱动，origin 和操作点绑定，读作"墨点从按钮扩散" |
| 4 | copilot 开形状 | main R→L wipe + chrome 200ms crossfade | 和 reveal cascade 同方向；chrome 区域（sidebar + panel）用户注意力不在那里，快速淡入即可 |
| 5 | 时长 | 700ms | 和 reveal wave（1250ms）区分——主题切换是频繁操作，应比开面板轻；700ms 够看清方向感、不拖沓 |
| 6 | Easing | `cubic-bezier(0.25, 0.1, 0.25, 1)` (= CSS `ease`) wipe；`cubic-bezier(0.4, 0, 0.2, 1)` (MD3 standard) radial | Wipe 匹配 reveal wave 曲线保持语言一致；radial 用更圆润的曲线让扩散边缘不锐利 |
| 7 | Fallback | 不支持 API 或 `prefers-reduced-motion: reduce` → 直接 `setTheme`，走现状 snap | 零副作用 fallback，不引入新的兼容风险 |
| 8 | Origin 坐标传递 | JS 写 `html.style['--theme-origin-x/y']`，CSS keyframe 读 var | 动态 origin 只能走 var；`!important` 不需要（没有竞争规则） |
| 9 | Theme class 同步 | 在 `startViewTransition` callback 里**同步** `html.classList.toggle('dark', ...)`，再调 `setTheme`（走 next-themes 状态/localStorage） | `startViewTransition` 在 callback 返回后立即取新快照；`next-themes` 的 className 应用走 useEffect 异步，快照取不到新态 → 旧快照 == 新快照 → 无动画。手动同步 toggle class 绕开 |
| 10 | `main` 命名 | `<main style={{viewTransitionName: "main-content"}}>` 常驻，不随 copilot 开/关切换 | 动态 add/remove `view-transition-name` 会影响"元素身份"判定；常驻最稳 |
| 11 | 测试策略 | 纯函数 `applyThemeClass` 加单测；View Transitions 本身不加 e2e | Playwright 对 View Transition 的时序不稳定，e2e 反而 flaky |

## 4. 时间轴

以用户点击主题按钮的时刻为 `t = 0`。

### 4.1 copilot 关闭 + 不支持 / reduced-motion

| t (ms) | 事件 |
|---|---|
| 0 | `cycleTheme()` 调用 |
| 0 | feature detect：`prefersReduce || !document.startViewTransition` |
| 0 | 直接 `setTheme(next)`，next-themes snap 主题 |
| ~10 | UI 进入新主题态，无动画 |

### 4.2 copilot 关闭 + 支持 API

| t (ms) | 事件 |
|---|---|
| 0 | `cycleTheme()` 调用 |
| 0 | 读 `themeBtnRef.current.getBoundingClientRect()`，算 `(cx, cy)` |
| 0 | 写 `html.style['--theme-origin-x'] = '${cx}px'`、`[--theme-origin-y] = '${cy}px'` |
| 0 | `document.startViewTransition(cb)` |
| 0 | 浏览器取 old snapshot |
| 0 | cb: `applyThemeClass(next)` 同步 toggle `.dark` class |
| 0 | cb: `setTheme(next)` 更 next-themes state + localStorage |
| ~1 | cb 返回，浏览器取 new snapshot |
| 0–700 | `::view-transition-new(root)` `clip-path: circle()` 从 `0` 到 `150vmax`，origin 锁在按钮位置 |
| 0–700 | `::view-transition-old(root)` `animation: none, opacity: 1`——保持原状不动 |
| 700 | 动画结束，pseudo-element 卸载，real DOM 接管（已是新主题态） |

### 4.3 copilot 打开 + 支持 API

| t (ms) | 事件 |
|---|---|
| 0 | 同 4.2 前 3 步 |
| 0 | cb 返回后，浏览器取 new snapshot——**关键**：`<main>` 有 `view-transition-name: main-content`，和 root 被**独立**快照 |
| 0–700 | `::view-transition-new(main-content)` clip-path R→L wipe（`inset(0 0 0 100%)` → `inset(0 0 0 0)`） |
| 0–700 | `::view-transition-old(main-content)` `opacity: 1` 保持 |
| 0–200 | `::view-transition-new(root)` opacity 0→1 （chrome 区：sidebar + copilot panel + 其他 fixed overlays） |
| 0–200 | `::view-transition-old(root)` opacity 1→0 |
| 700 | 动画结束，pseudo 卸载 |

**注**：copilot 开时 origin 仍按规则写入（sidebar 不可见 / 收起时按钮在折叠态位置），但 radial 动画在这种 scope 下不会 match（selector 是 `html:not([data-copilot-open="true"])`），写入无副作用。

## 5. 组件与文件

**新增（2 个）**：

- `src/lib/theme/apply.ts` — `applyThemeClass(next: "light" | "dark" | "system")` 纯函数，直接操作 `document.documentElement.classList`，镜像 next-themes 的内部逻辑，只负责同步切 class（不动 localStorage / state）
- `src/lib/theme/__tests__/apply.test.ts` — 3 case 单测（dark / light / system with prefersDark mock）

**编辑（3 个）**：

- `src/components/sidebar.tsx` — 加 `themeBtnRef`；`cycleTheme` 重构为 view-transitions 感知版本
- `src/app/layout.tsx` — `<main>` 加 `style={{ viewTransitionName: "main-content" }}`
- `src/app/globals.css` — 文末追加"Theme switch · View Transitions" section：4 keyframes + `::view-transition-*` 规则 + a11y 降级

**不动（明确）**：

- `src/app/layout.tsx` 的 `<ThemeProvider disableTransitionOnChange>` — 保留。View Transitions 不依赖 CSS transitions，`disableTransitionOnChange` 和本方案完全正交
- next-themes — 保留原接口，不 bypass
- Reveal cascade（`html[data-copilot-revealing="true"]` override + `applyRevealCascade` JS）— 完全独立，主题切换不触发，reveal 不触发主题切换

## 6. 核心：`applyThemeClass`

```ts
// src/lib/theme/apply.ts
export type ResolvableTheme = "light" | "dark" | "system"

/**
 * 同步把 .dark class 应用到 document.documentElement。
 * 镜像 next-themes 内部的 class 应用逻辑；给 View Transition callback 在
 * 快照之间**同步**改 DOM 用。next-themes 本身的 setTheme 走 useEffect 异步，
 * 快照之间来不及改；必须这里手动同步做。
 *
 * 调用方负责 setTheme 更状态/localStorage——这个函数只管 class。
 */
export function applyThemeClass(next: ResolvableTheme): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (next === "dark") {
    root.classList.add("dark")
    return
  }
  if (next === "light") {
    root.classList.remove("dark")
    return
  }
  // system
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  root.classList.toggle("dark", prefersDark)
}
```

### 6.1 单测

```ts
// src/lib/theme/__tests__/apply.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyThemeClass } from "../apply"

describe("applyThemeClass", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
  })

  it("adds .dark when next=dark", () => {
    applyThemeClass("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("removes .dark when next=light", () => {
    document.documentElement.classList.add("dark")
    applyThemeClass("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("follows prefers-color-scheme when next=system (dark)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("follows prefers-color-scheme when next=system (light)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    document.documentElement.classList.add("dark")
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
```

## 7. `cycleTheme` 重构

```tsx
// src/components/sidebar.tsx（片段）
import { applyThemeClass, type ResolvableTheme } from "@/lib/theme/apply"

const themeBtnRef = useRef<HTMLButtonElement>(null)

const cycleTheme = useCallback(() => {
  let next: ResolvableTheme
  if (theme === "light") next = "dark"
  else if (theme === "dark") next = "system"
  else next = "light"

  const prefersReduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // Fallback: 不支持 API 或 a11y 要求 reduced motion → 现状 snap
  const docWithVT = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => unknown
  }
  if (prefersReduce || !docWithVT.startViewTransition) {
    setTheme(next)
    return
  }

  // 写 origin 坐标给 radial keyframe 用（copilot 关时生效）
  const rect = themeBtnRef.current?.getBoundingClientRect()
  if (rect) {
    document.documentElement.style.setProperty(
      "--theme-origin-x",
      `${rect.left + rect.width / 2}px`
    )
    document.documentElement.style.setProperty(
      "--theme-origin-y",
      `${rect.top + rect.height / 2}px`
    )
  }

  docWithVT.startViewTransition(() => {
    // 同步改 DOM，让新快照能抓到新主题态（next-themes 的 useEffect 异步来不及）
    applyThemeClass(next)
    // next-themes 更状态 + localStorage；它的 useEffect 之后再 apply 同值 class, no-op
    setTheme(next)
  })
}, [theme, setTheme])
```

主题按钮的 JSX 加 `ref={themeBtnRef}`。

## 8. CSS（追加到 `globals.css` 文末）

```css
/* ---------------- Theme switch · View Transitions ---------------- */

/* main 常驻命名：和 root 独立快照。copilot 开时 main 做 R→L wipe、root 做 chrome fade；
   copilot 关时 root 做 radial 扩散，main 跟随 root（selector 没命中 main-content 规则）。
   注：main-content 未被 scoped rule 选中时，走 UA 默认 cross-fade——在 copilot 关场景下
   这是 main 的行为；但用户关 copilot 时 main 占满全屏，UA 默认 fade 被 main 自己的 clip
   cover 住看不出差异。 */
main {
  view-transition-name: main-content;
}

/* old 统一不动——给 new 叠上来做"覆盖式"入场留底 */
::view-transition-old(root),
::view-transition-old(main-content) {
  animation: none !important;
  opacity: 1;
}

/* copilot 关：root 径向扩散 */
html:not([data-copilot-open="true"]) ::view-transition-new(root) {
  animation: theme-radial-expand 700ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

/* copilot 开：main R→L wipe（700ms）；root（chrome 区）快速 fade（200ms）*/
html[data-copilot-open="true"] ::view-transition-new(main-content) {
  animation: theme-wipe-rl 700ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
html[data-copilot-open="true"] ::view-transition-new(root) {
  animation: theme-fade-in 200ms ease-out both;
}

@keyframes theme-radial-expand {
  from {
    clip-path: circle(0 at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%));
  }
  to {
    clip-path: circle(150vmax at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%));
  }
}

@keyframes theme-wipe-rl {
  from { clip-path: inset(0 0 0 100%); }
  to   { clip-path: inset(0 0 0 0); }
}

@keyframes theme-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-new(root),
  ::view-transition-new(main-content) {
    animation: none !important;
  }
}
```

## 9. `layout.tsx` 改动

`<main>` 加 inline style：

```tsx
<main
  className="flex-1 h-screen flex flex-col overflow-hidden relative"
  style={{ viewTransitionName: "main-content" } as React.CSSProperties}
>
```

或者挂 `data-main-root` 属性 + CSS 规则。选 inline style 更显式、少一跳。

**注**：`viewTransitionName` 在 React 19 的 `CSSProperties` 类型中已内置；如旧版 TS 抱怨可 `as React.CSSProperties` 或补 `viewTransitionName?: string`。

## 10. `<main>` 身份和 `GlowOverlay` / `MaterialRevealOverlay`

`<main>` 内有：
- `<GlowOverlay />` — 背景漂移光斑（fixed position），被 main 的 `view-transition-name` 包进 main-content 快照
- `<MaterialRevealOverlay />` — reveal wave overlay（仅在 copilot open 瞬间渲染），主题切换时 99% 情况不在场
- `<div>{children}</div>` — 页面内容

三者都进 main 快照。这里唯一要小心的是 `GlowOverlay` 在 main 快照期间依然在动（快照取完之后浏览器开始 blit），但对观感无影响：new snapshot 也是实时 render，两张快照之间 old 和 new 的 glow 位置微差，在 clip-path 的裁切下看不出来。

`<CopilotPanel>`、`<InspectorOverlay>`、`<ContextMask>`、`<TextSelector>`、`<TextSelectionMask>`、`<Toaster>`、`<Sidebar>` 都在 main 之外，归 root 快照。copilot 开时他们跟 root 走 200ms 快速 fade——用户视觉重心在 main 的 R→L wipe 上，chrome 区快速淡入符合信息 hierarchy。

## 11. 边界 / 异常

| 场景 | 处理 |
|---|---|
| 主题按钮快速连点 | `startViewTransition` 自动 skip 前一次未完成 transition（spec 行为），无需额外处理 |
| OS 层切 system 主题（用户没点按钮） | next-themes 的 media query listener 直接更状态，不走 `cycleTheme`，snap 切换。可接受（非交互路径） |
| `themeBtnRef.current` 为 null（unmount / sidebar 未渲染完） | `getBoundingClientRect()` skip，不写 origin var，用 default `50% 50%`（屏幕中心扩散） |
| copilot 打开过程中 + 主题切换同时发生 | 两个 transition 独立：reveal cascade 用 `html[data-copilot-revealing]` + 元素级 transition 驱动 glass；theme 用 view-transition pseudo 驱动 bg 色。两套机制不冲突。概率极低的场景 |
| 浏览器不支持 `document.startViewTransition` | 走 fallback 分支直接 `setTheme`，等同现状 |
| `prefers-reduced-motion: reduce` | 同上 fallback |
| `prefers-contrast: more` / `prefers-reduced-transparency: reduce` | 不额外处理；这些 a11y 偏好和主题动画正交（玻璃降级不等于要 snap 主题） |
| Firefox 旧版 | Firefox 127（2024-06）支持 View Transitions。更老版本落 fallback snap，无副作用 |
| 不支持 `clip-path: circle()` / `inset()` | 同上 fallback（极其罕见） |

## 12. 验证

### 单测

`src/lib/theme/__tests__/apply.test.ts` — 4 case（dark / light / system-prefers-dark / system-prefers-light）。vitest 直接 run。

### 手动 checklist

Chrome 最新 + Safari 最新各跑一遍，每种 copilot 状态 × 4 切换：

| copilot 状态 | 操作 | 期望 |
|---|---|---|
| 关 | 当前 light → 点按钮 → dark | 700ms radial 扩散从按钮位置（sidebar 底部）铺满屏 |
| 关 | dark → system（OS 暗色） | 700ms radial，视觉上几乎无变化（dark→dark） |
| 关 | system → light | 700ms radial 扩散 |
| 开 | light → dark | main 区 R→L wipe 700ms；sidebar + panel 200ms 淡入；glow 无闪 |
| 开 | dark → system | 同上（视觉变化可能小） |
| 开 | system → light | 同上 |
| 开 | 打开 DevTools Rendering tab 看 Layers | main 和 root 各有独立快照层，无额外 paint |
| 任意 | 设 `prefers-reduced-motion: reduce` → 切主题 | snap 切换，无动画 |
| Firefox 126 或关 View Transitions flag | 任意切主题 | snap（fallback 生效） |

### **不做**

- E2E Playwright：View Transitions 涉及浏览器合成层时序，自动化断言不稳定，flaky 风险高
- `prefers-contrast` / `prefers-reduced-transparency` 主题动画路径：a11y 降级分支在 globals.css 已有，不在本 scope 调整

## 13. 相对 v0.5.3 失败的关键差异

| 维度 | v0.5.3 尝试（失败） | 本方案（View Transitions） |
|---|---|---|
| 动画驱动位置 | 每个 `[data-glass-variant]` 元素的 CSS `transition` | 浏览器 compositor 的快照 blit |
| 触发元素数 | ~100（glass cards + descendants via `*` rule） | 2（old + new snapshot）|
| Paint 压力 | 所有元素同步 repaint 触发 paint 风暴 | 单次快照 raster，后续 blit 走 GPU 层 |
| 清理时机 | `data-theme-cascading` 撤销 → `transition-property` 栈变化 → 补帧闪烁 | 动画结束 pseudo 自动卸载，real DOM 接管，无 state 切换 |
| CSS var 动态性 | `--card` / `--bg` 等几十个 var 同时变值，传播路径深 | 快照冻结了视觉，值变化对动画不可见 |
| 和 `disableTransitionOnChange` 关系 | 冲突（方案依赖 element transition，但 `next-themes` 短暂禁掉 transition） | 正交（不依赖 element transition） |
| Fallback | 无（要么全 cascade 要么 snap，无法优雅降级） | 天然 fallback（检测 API 后直接 snap） |

**结论**：v0.5.3 是"用不合适的工具强行干一件事"。View Transitions 是浏览器为这个场景专门设计的 API，直接从机制层消解 root cause，不是调参压制。

## 14. 决策记录

| # | 决策 | 最终 |
|---|---|---|
| 1 | 整体路线 | View Transitions API |
| 2 | old snapshot 行为 | 保持 opacity: 1 不动，new 叠上来覆盖 |
| 3 | copilot 关 · 形状 | radial from button |
| 4 | copilot 开 · main 形状 | R→L wipe |
| 5 | copilot 开 · chrome 形状 | 200ms opacity crossfade |
| 6 | 主时长 | 700ms |
| 7 | Origin 传递 | CSS var `--theme-origin-x/y`，JS 写 html style |
| 8 | `.dark` class 同步 | callback 里手动 `applyThemeClass`，再 `setTheme` |
| 9 | `view-transition-name: main-content` 时机 | 常驻（不随 copilot 切换） |
| 10 | Fallback | 不支持 / reduced-motion → `setTheme` snap |
| 11 | E2E 测试 | 不加（Playwright 对 View Transitions flaky） |
| 12 | `disableTransitionOnChange` | 保留 |
| 13 | 单测 | `applyThemeClass` 4 case |

## 15. 未来扩展（不在本 scope）

- **主题按钮 ripple**：按下按钮时先发一个小涟漪动画再触发主题切换，让 origin 和扩散视觉更连贯。可以 defer，当前径向扩散已经点题
- **`view-transition-class` 属性**：Chrome 125+ 支持，可以给多个元素一个 class 共享动画规则。目前只有 `main-content` 一个命名，没必要
- **SPA 路由切换也走 View Transitions**：Next.js 16 的 `unstable_ViewTransition` 可能支持。另一个议题，和主题切换无关
- **`@starting-style`**：新 CSS 特性，声明元素首次渲染时的起始样式，可能简化 reveal cascade 的架构。独立探索
