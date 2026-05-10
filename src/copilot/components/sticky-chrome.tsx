"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotStore } from "./store"

type StickyChromeProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">

const baseTransition =
  "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

const SHADOW_UP =
  "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 -1px 0 oklch(1 0 0 / 0.08), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 8px 24px -12px oklch(0 0 0 / 0.22), 0 2px 6px -2px oklch(0 0 0 / 0.08)"

const SHADOW_DOWN =
  "inset 0 -1px 0 oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.08), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 -8px 24px -12px oklch(0 0 0 / 0.22), 0 -2px 6px -2px oklch(0 0 0 / 0.08)"

function stickyChromeStyle(direction: "up" | "down", open: boolean): CSSProperties {
  if (!open) return { transition: baseTransition }
  return {
    backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
    backdropFilter: "blur(28px) saturate(1.25)",
    WebkitBackdropFilter: "blur(28px) saturate(1.25)",
    borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
    boxShadow: direction === "up" ? SHADOW_UP : SHADOW_DOWN,
    transition: baseTransition,
  }
}

/**
 * Sticky 顶部结构条：位于滚动容器的最上方。
 * copilot 开：Regular 玻璃 + 顶部切边高光 + 向下投影 + rounded-xl。
 * copilot 关：回退 shadcn 扁平——`bg-card border-b`，颜色与外层卡面齐平、只靠 border 划分。
 */
export function GlassStickyHeader({ children, className = "", style, ...rest }: StickyChromeProps) {
  const { open } = useCopilotStore()
  const glass = stickyChromeStyle("up", open)
  const stateClass = open ? "rounded-xl" : "bg-card border-b"
  return (
    <div
      data-glass-variant="sticky-up"
      className={`sticky top-0 z-10 px-4 py-3 ${stateClass} ${className}`}
      style={{ ...glass, ...style }}
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
  const { open } = useCopilotStore()
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
