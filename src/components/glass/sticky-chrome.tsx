"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotOpen } from "./copilot-context"
import { useClearLens } from "./glass-lens"

type StickyChromeProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">

// backdrop-filter is DELIBERATELY excluded from this transition: it does NOT interpolate
// none→blur() so it snaps in late, after background-color fades — light mode opens with a visible
// 「先透亮、后结霜」two-stage 转折. Excluding it applies the blur instantly (invisible over the still-
// opaque bar, revealed smoothly as the fill fades) → frost + transparency arrive together. Closed
// state still returns { transition } only with NO backdrop-filter → zero backdrop cost.
const baseTransition =
  "background-color 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

// Track A premium-edge：rim 用统一的左上光源（左上亮 / 右下暗 + 底缘淡白线）。
// up / down 两条的 inset 部分完全相同——只有「外投影方向」不同（up 向下投 `0 8px` / down 向上投 `0 -8px`），
// 靠投影方向而非光源方向区分顶/底，避免单条 bar 出现与全局光源矛盾的反向高光。sticky few-hero，只加 rim，不挂色散/扫光。
// HAIRLINE：mirror shell.tsx RIM_REGULAR —— feather 1px spread、modest bevel α（左上 0.42 / 顶线 0.22 /
// 底白落地线 0.1）+ 不挂右下黑切边层。airier fill 下右下黑层最容易把边读「重」，去掉后 sticky 只剩「左上高光 +
// 底缘白落地线」的 barely-there 细描；这条 bar 的独立性主要靠它独有的「方向 drop-shadow」（up 向下投 /
// down 向上投）+ 高一档的 fill 区隔，而非 4 角 bevel。
const STICKY_RIM =
  "inset 1px 1px 1px oklch(1 0 0 / 0.42), inset 0 1px 1px oklch(1 0 0 / 0.22), inset 0 -1px 1px oklch(1 0 0 / 0.1)"

const SHADOW_UP = `${STICKY_RIM}, 0 8px 24px -12px oklch(0 0 0 / 0.22), 0 2px 6px -2px oklch(0 0 0 / 0.08)`

const SHADOW_DOWN = `${STICKY_RIM}, 0 -8px 24px -12px oklch(0 0 0 / 0.22), 0 -2px 6px -2px oklch(0 0 0 / 0.08)`

export function stickyChromeStyle(direction: "up" | "down", open: boolean): CSSProperties {
  if (!open) return { transition: baseTransition }
  return {
    // mode-aware fill via light-dark()：sticky 条悬在滚动内容上方，材质要和滚过的 regular 卡读出区别，
    // 否则只剩方向阴影一个差异 —— 两分支都比 regular 高一档：亮 26%（> regular light 20%）/ 暗 17%（> regular dark 11%）。
    // blur 20（mode-agnostic）。luminance 旋钮按暗模式 legibility 钳制——brightness 收在 1.06（不到 regular 的
    // 1.08，因 sticky 底下是不断变化的滚动亮底），让 contrast(1.05) 把浅色 label 与亮底拉开（brightness 会把已亮的底推白、压扁对比）。
    backgroundColor:
      "light-dark(color-mix(in oklab, var(--card) 26%, transparent), color-mix(in oklab, var(--card) 17%, transparent))",
    backdropFilter: "blur(20px) saturate(1.3) brightness(1.06) contrast(1.05)",
    WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.06) contrast(1.05)",
    borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
    boxShadow: direction === "up" ? SHADOW_UP : SHADOW_DOWN,
    transition: baseTransition,
  }
}

/**
 * Sticky 顶部结构条：位于滚动容器的最上方。
 * copilot 开：Regular 玻璃 + 顶部切边高光 + 向下投影 + rounded-xl。
 * copilot 关：回退 shadcn 扁平——`bg-card border-b`，颜色与外层卡面齐平、只靠 border 划分。
 *
 * `lens`（Track B · opt-in）：把这条 bar 升级成「液态玻璃」—— 低 blur(6) + feDisplacementMap 折射，
 * 让滚过 bar 底下的内容（result rows / compare grid）可见地涟漪折射。仅 Chromium + 探测通过 + 无 a11y/
 * inspector 时生效（useClearLens 否则返回 {}，bar 退回正常 blur(22)）。sticky-up 被 nested-blur strip
 * 豁免，嵌在 GlassHero 里也保留自己的 backdrop-filter。bar 很薄 → 滚动重 warp 面积小，成本可控。
 */
export function GlassStickyHeader({ children, className = "", style, lens = false, ...rest }: StickyChromeProps & { lens?: boolean }) {
  const open = useCopilotOpen()
  const glass = stickyChromeStyle("up", open)
  const clearLens = useClearLens() // {} unless lens-eligible AND refraction live
  const stateClass = open ? "rounded-xl" : "bg-card border-b"
  return (
    <div
      data-glass-variant="sticky-up"
      className={`sticky top-0 z-10 px-4 py-3 ${stateClass} ${className}`}
      style={{ ...glass, ...(lens ? clearLens : {}), ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * Sticky 底部结构条：位于滚动容器的最下方。
 * copilot 开：Regular 玻璃 + 底部切边高光 + 向上投影 + rounded-xl。
 * copilot 关：回退 shadcn 扁平——`bg-card border-t`，颜色与外层卡面齐平、只靠 border 划分。
 */
export function GlassStickyFooter({ children, className = "", style, ...rest }: StickyChromeProps) {
  const open = useCopilotOpen()
  const glass = stickyChromeStyle("down", open)
  const stateClass = open ? "rounded-xl" : "bg-card border-t"
  return (
    <div
      data-glass-variant="sticky-down"
      className={`sticky bottom-0 z-10 px-4 py-3 ${stateClass} ${className}`}
      style={{ ...glass, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}
