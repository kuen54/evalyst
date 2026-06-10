"use client"

import { cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from "react"
import { useGlassStyle } from "./shell"
import { useCopilotOpen } from "./copilot-context"
import { segmentedItem } from "@/lib/segmented"

type RenderElement = ReactElement<{
  className?: string
  style?: CSSProperties
  children?: ReactNode
  [key: string]: unknown
}>

type GlassSegmentedItemProps = {
  active: boolean
  children: ReactNode
  /**
   * 底层要渲染的 element。支持 `<button />`, `<Link href />`, `<a />` 等。
   * 默认 `<button type="button" />`。通过 cloneElement 注入 className / style / data-glass-variant。
   */
  render?: RenderElement
  className?: string
  style?: CSSProperties
}

/**
 * 统一 segmented control / active tab / nav 单元视觉。
 *
 * - copilot 关：走 shadcn 扁平（老 accent / border）
 * - copilot 开：thin（非 active） / tinted（active）+ accent 发光边
 *
 * 用法：
 * ```tsx
 * <GlassSegmentedItem
 *   active={isActive}
 *   className="p-3 text-left"
 *   render={<button type="button" onClick={...} />}
 * >
 *   <div>Title</div>
 *   <div className="text-xs">...desc</div>
 * </GlassSegmentedItem>
 *
 * <GlassSegmentedItem
 *   active={isActive}
 *   className="p-4 text-center cursor-pointer"
 *   render={<Link href={href} />}
 * >
 *   {children}
 * </GlassSegmentedItem>
 * ```
 */
export function GlassSegmentedItem({
  active,
  children,
  render,
  className = "",
  style,
}: GlassSegmentedItemProps) {
  const tintedStyle = useGlassStyle("tinted")
  const thinStyle = useGlassStyle("thin")
  const open = useCopilotOpen()

  const stateClass = segmentedStateClass(active, open)
  const mergedClassName = `rounded-md border transition-colors ${stateClass} ${className}`
  const mergedStyle: CSSProperties | undefined = open
    ? { ...(active ? tintedStyle : thinStyle), ...style }
    : style
  const dataVariant = open ? (active ? "tinted" : "thin") : undefined

  const target: RenderElement =
    render && isValidElement(render)
      ? render
      : (<button type="button" /> as unknown as RenderElement)

  const existingProps = target.props
  const existingClassName = typeof existingProps.className === "string" ? existingProps.className : ""
  const existingStyle = existingProps.style as CSSProperties | undefined

  const styleToApply = mergedStyle ? { ...existingStyle, ...mergedStyle } : existingStyle
  return cloneElement(target, {
    className: `${mergedClassName} ${existingClassName}`.trim(),
    ...(styleToApply !== undefined ? { style: styleToApply } : {}),
    ...(dataVariant !== undefined ? { "data-glass-variant": dataVariant } : {}),
    children,
  })
}

/**
 * Segmented state className（border / bg / hover）。
 * copilot 关闭走 shadcn 扁平（委托给 segmentedItem helper）；开启走 copilot-accent 发光。
 */
function segmentedStateClass(active: boolean, copilotOpen: boolean): string {
  if (!copilotOpen) return segmentedItem(active)
  if (active) {
    return [
      "text-foreground",
      "bg-[color:color-mix(in_oklab,var(--copilot-accent)_14%,transparent)]",
      "border-[color:color-mix(in_oklab,var(--copilot-accent)_55%,transparent)]",
      "shadow-[inset_0_1px_0_oklch(1_0_0_/_0.6),_inset_0_-1px_0_oklch(1_0_0_/_0.1),_0_0_0_1px_color-mix(in_oklab,var(--copilot-accent)_25%,transparent),_0_3px_10px_-2px_color-mix(in_oklab,var(--copilot-accent)_40%,transparent)]",
    ].join(" ")
  }
  return "border-border bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground hover:border-foreground/20"
}
