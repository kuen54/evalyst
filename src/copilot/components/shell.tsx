"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotStore } from "./store"

type GlassVariant =
  | "thin"
  | "regular"
  | "thick"
  | "tinted"
  | "chrome-up"
  | "chrome-down"
  | "success"
  | "warning"
  | "danger"

const baseTransition =
  "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

/**
 * Pure function to compute glass style for a given variant and open state.
 *
 * Copilot 玻璃梯度系统 9 档（6 primitive + 3 semantic）：
 *
 * Primitive:
 * - thin        — chrome / sticky / 数据单元格（blur 16, bg transparent）
 * - regular     — 页面主外壳 + 内容卡（blur 28, bg 35% card）
 * - thick       — 浮层 / copilot panel / dialog（blur 40, bg 55% card, 更重阴影）
 * - tinted      — primary CTA / active tab（blur 28, bg 35% card + accent 染色）
 * - chrome-up   — sticky 顶部结构条（Regular 材质 + 顶部切边高光 + 向下投影）
 * - chrome-down — sticky 底部结构条（Regular 材质 + 底部切边高光 + 向上投影）
 *
 * Semantic（Regular 材质 + 语义 border + 弱 ambient 色光）：
 * - success — 正向状态卡（emerald 边）
 * - warning — 提示 / 引导 banner（amber 边）
 * - danger  — 错误 / 警告卡（red 边）
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
    // 对齐 GlassSegmentedItem active 的"发光带"视觉：单层 accent 14% 透底 +
    // accent 55% 边 + accent ambient 外光 + 顶部白切边高光。文字色由调用方
    // 走 `text-foreground`（Button 通过 data-[copilot-tinted=on]:text-foreground
    // 覆盖默认的 text-primary-foreground 实现自适应）。
    return {
      backgroundColor: "color-mix(in oklab, var(--copilot-accent) 14%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, var(--copilot-accent) 55%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.7), inset 0 0 0 1px color-mix(in oklab, var(--copilot-accent) 25%, transparent), 0 3px 10px -2px color-mix(in oklab, var(--copilot-accent) 40%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.22)",
      transition: baseTransition,
    }
  }

  if (variant === "chrome-up") {
    // Sticky 顶部结构条：Regular 材质 + 方向性阴影（顶部切边高光 + 向下投影悬浮感）
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 -1px 0 oklch(1 0 0 / 0.08), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 8px 24px -12px oklch(0 0 0 / 0.22), 0 2px 6px -2px oklch(0 0 0 / 0.08)",
      transition: baseTransition,
    }
  }

  if (variant === "chrome-down") {
    // Sticky 底部结构条：Regular 材质 + 方向性阴影（底部切边高光 + 向上投影悬浮感）
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
      boxShadow:
        "inset 0 -1px 0 oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.08), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 -8px 24px -12px oklch(0 0 0 / 0.22), 0 -2px 6px -2px oklch(0 0 0 / 0.08)",
      transition: baseTransition,
    }
  }

  if (variant === "success") {
    // Regular 材质 + emerald-500 border + 弱 emerald ambient shadow
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.696 0.17 162.48) 50%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 4px 14px -4px color-mix(in oklab, oklch(0.696 0.17 162.48) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)",
      transition: baseTransition,
    }
  }

  if (variant === "warning") {
    // Regular 材质 + amber-500 border + 弱 amber ambient shadow
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.769 0.188 70.08) 55%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 4px 14px -4px color-mix(in oklab, oklch(0.769 0.188 70.08) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)",
      transition: baseTransition,
    }
  }

  if (variant === "danger") {
    // Regular 材质 + red-500 border + 弱 red ambient shadow
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.637 0.237 25.33) 50%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 4px 14px -4px color-mix(in oklab, oklch(0.637 0.237 25.33) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)",
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
 * Copilot 玻璃梯度系统 9 档（6 primitive + 3 semantic）。详见 getGlassStyleForVariant 顶注释。
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

/**
 * Card-style glass：shadcn `<Card>` 的默认样式 + Regular 玻璃。
 * 等价于 shadcn Card 在 copilot 关闭态。给 "单卡 / 列表卡 / 详情内嵌卡 / 表单段落卡" 用。
 * 页面级主外壳（experiments/new、settings layout 等）仍用 `<GlassRegular>` 免得被 py-4 / gap-4 带偏。
 */
const SHADCN_CARD_DEFAULTS =
  "rounded-xl border bg-card flex flex-col gap-4 py-4 text-sm text-card-foreground overflow-hidden"

export const GlassCard = makeGlass("regular", SHADCN_CARD_DEFAULTS)
/** Card-style glass 的 Thin 档。给数据密集场景（results 行级卡、表格单元格）用 —— blur 小 / bg opacity 低，数字稳定不漂移。 */
export const GlassCardThin = makeGlass("thin", SHADCN_CARD_DEFAULTS)

/**
 * Semantic card-style glass：Regular 材质 + 语义 border + 弱语义 ambient shadow。
 * 覆盖"状态/情绪"类场景。copilot 关闭态继续走 bg-card 实色（className 里带 border-<color>-200 可选）。
 */
export const GlassSuccess = makeGlass("success", SHADCN_CARD_DEFAULTS)
export const GlassWarning = makeGlass("warning", SHADCN_CARD_DEFAULTS)
export const GlassDanger = makeGlass("danger", SHADCN_CARD_DEFAULTS)
