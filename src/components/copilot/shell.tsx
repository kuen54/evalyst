"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotStore } from "./store"

/**
 * Copilot 打开时的液态玻璃样式：半透+ backdrop-blur + 内高光 + 浮层阴影。
 * 关闭时是空对象（让外部 className 的 bg-card / bg-background 原样工作）。
 *
 * 为什么不走 CSS 选择器：Tailwind v4 / LightningCSS 会把我们写的自由规则塞回 `@layer base` 并吃掉 `!important`
 * 和 `backdrop-filter` 声明，utilities 层的 `bg-card` / `bg-background` 稳赢 → 壳永远不透。
 * 所以一律用 inline style。
 */
export function useGlassStyle(variant: "shell" | "surface" = "shell"): CSSProperties {
  const { open } = useCopilotStore()
  if (!open) {
    return {
      transition:
        "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease",
    }
  }
  if (variant === "shell") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 40%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 -1px 0 oklch(1 0 0 / 0.1), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 20px 50px -20px oklch(0 0 0 / 0.22), 0 4px 12px -6px oklch(0 0 0 / 0.08)",
      transition:
        "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease",
    }
  }
  // 'surface' —— 给 sticky header / footer 用：完全透明，彻底融入宿主壳的玻璃层，
  // 没有独立色块。仅保 backdrop-filter 处理下面的内容（避免 sticky 时滚动内容从下面穿过显得杂乱）。
  return {
    backgroundColor: "transparent",
    backdropFilter: "blur(16px) saturate(1.2)",
    WebkitBackdropFilter: "blur(16px) saturate(1.2)",
    transition:
      "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease",
  }
}

/**
 * Copilot 模式下 UI 的外壳。
 * 默认就是 `rounded-xl border bg-card p-6`；copilot 打开时切到液态玻璃。
 */
export function CopilotShell({
  children,
  className = "",
  style,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "main"
}) {
  const glass = useGlassStyle("shell")
  return (
    <Tag className={`rounded-xl border bg-card ${className}`} style={{ ...glass, ...style }}>
      {children}
    </Tag>
  )
}

/**
 * 半透 surface —— 给 sticky 表头 / 吸底操作条 / 任何想被背景光晕渗透的 UI 用。
 * 默认底色走 className 传入的 bg-*（idle 态透明度 1）；copilot 打开时 inline style 覆盖成玻璃。
 */
export function GlassSurface({
  children,
  className = "",
  style,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "header"
}) {
  const glass = useGlassStyle("surface")
  return (
    <Tag className={className} style={{ ...glass, ...style }}>
      {children}
    </Tag>
  )
}

