"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotStore } from "./store"

export type GlassVariant = "thin" | "regular" | "thick" | "tinted"

const baseTransition =
  "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

/**
 * Pure function to compute glass style for a given variant and open state.
 *
 * Copilot 玻璃梯度系统 4 档：
 * - thin     — chrome / sticky / 数据单元格（blur 16, bg transparent）
 * - regular  — 页面主外壳 + 内容卡（blur 28, bg 35% card）
 * - thick    — 浮层 / copilot panel / dialog（blur 40, bg 55% card, 更重阴影）
 * - tinted   — primary CTA / active tab（blur 28, bg 35% card + primary 染色）
 *
 * copilot 关闭时返回 transition-only style，让外部 className 的 bg-card/bg-background 原样工作。
 */
export function getGlassStyleForVariant(
  variant: GlassVariant = "regular",
  open: boolean
): CSSProperties {
  if (!open) {
    return { transition: baseTransition }
  }

  if (variant === "thin") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 8%, transparent)",
      backdropFilter: "blur(16px) saturate(1.2)",
      WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
      transition: baseTransition,
    }
  }

  if (variant === "thick") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 55%, transparent)",
      backdropFilter: "blur(40px) saturate(1.3)",
      WebkitBackdropFilter: "blur(40px) saturate(1.3)",
      borderColor: "color-mix(in oklab, var(--border) 60%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.7), inset 0 -1px 0 oklch(1 0 0 / 0.15), inset 0 0 0 1px oklch(1 0 0 / 0.12), 0 30px 60px -15px oklch(0 0 0 / 0.32), 0 6px 16px -8px oklch(0 0 0 / 0.12)",
      transition: baseTransition,
    }
  }

  if (variant === "tinted") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 30%, transparent)",
      backgroundImage:
        "linear-gradient(color-mix(in oklab, var(--copilot-accent) 22%, transparent), color-mix(in oklab, var(--copilot-accent) 22%, transparent))",
      backdropFilter: "blur(28px) saturate(1.3)",
      WebkitBackdropFilter: "blur(28px) saturate(1.3)",
      borderColor: "color-mix(in oklab, var(--copilot-accent) 50%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.7), inset 0 0 0 1px color-mix(in oklab, var(--copilot-accent) 20%, transparent), 0 3px 12px -4px color-mix(in oklab, var(--copilot-accent) 30%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.22)",
      transition: baseTransition,
    }
  }

  // regular (default)
  return {
    backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
    backdropFilter: "blur(28px) saturate(1.25)",
    WebkitBackdropFilter: "blur(28px) saturate(1.25)",
    borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
    boxShadow:
      "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 -1px 0 oklch(1 0 0 / 0.1), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 20px 50px -20px oklch(0 0 0 / 0.22), 0 4px 12px -6px oklch(0 0 0 / 0.08)",
    transition: baseTransition,
  }
}

/**
 * Copilot 玻璃梯度系统 4 档：
 * - thin     — chrome / sticky / 数据单元格（blur 16, bg transparent）
 * - regular  — 页面主外壳 + 内容卡（blur 28, bg 35% card）
 * - thick    — 浮层 / copilot panel / dialog（blur 40, bg 55% card, 更重阴影）
 * - tinted   — primary CTA / active tab（blur 28, bg 35% card + primary 染色）
 *
 * copilot 关闭时返回 transition-only style，让外部 className 的 bg-card/bg-background 原样工作。
 */
export function useGlassStyle(variant: GlassVariant = "regular"): CSSProperties {
  const { open } = useCopilotStore()
  return getGlassStyleForVariant(variant, open)
}

type GlassProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "main" | "header" | "article" | "aside" | "nav"
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "style" | "children">

function makeGlass(variant: GlassVariant, defaultClass: string) {
  return function Glass({ children, className = "", style, as: Tag = "div", ...rest }: GlassProps) {
    const glass = useGlassStyle(variant)
    return (
      <Tag
        data-glass-variant={variant}
        className={`${defaultClass} ${className}`}
        style={{ ...glass, ...style }}
        {...rest}
      >
        {children}
      </Tag>
    )
  }
}

export const GlassThin = makeGlass("thin", "")
export const GlassRegular = makeGlass("regular", "rounded-xl border bg-card")
export const GlassThick = makeGlass("thick", "rounded-xl border bg-card")
export const GlassTinted = makeGlass("tinted", "rounded-xl border bg-card")
