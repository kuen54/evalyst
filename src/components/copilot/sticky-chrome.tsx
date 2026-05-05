"use client"

import type { CSSProperties, ReactNode } from "react"
import { useGlassStyle } from "./shell"
import { useCopilotStore } from "./store"

type StickyChromeProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">

/**
 * Sticky 顶部结构条：位于滚动容器的最上方，向下投影表达"悬浮在内容之上"。
 * 内置 sticky top-0 z-10 + rounded-xl + px-4 py-3。
 * copilot 关闭时回落为 shadcn 扁平（bg-background border-b）；开启时 inline 玻璃 style 接管。
 */
export function GlassStickyHeader({ children, className = "", style, ...rest }: StickyChromeProps) {
  const glass = useGlassStyle("chrome-up")
  const { open } = useCopilotStore()
  const fallback = open ? "" : "bg-background border-b"
  return (
    <div
      data-glass-variant="chrome-up"
      className={`sticky top-0 z-10 rounded-xl px-4 py-3 ${fallback} ${className}`}
      style={{ ...glass, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * Sticky 底部结构条：位于滚动容器的最下方，向上投影表达"悬浮在内容之上"。
 * 内置 sticky bottom-0 z-10 + rounded-xl + px-4 py-3。
 * copilot 关闭时回落为 shadcn 扁平（bg-background border-t）；开启时 inline 玻璃 style 接管。
 */
export function GlassStickyFooter({ children, className = "", style, ...rest }: StickyChromeProps) {
  const glass = useGlassStyle("chrome-down")
  const { open } = useCopilotStore()
  const fallback = open ? "" : "bg-background border-t"
  return (
    <div
      data-glass-variant="chrome-down"
      className={`sticky bottom-0 z-10 rounded-xl px-4 py-3 ${fallback} ${className}`}
      style={{ ...glass, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}
