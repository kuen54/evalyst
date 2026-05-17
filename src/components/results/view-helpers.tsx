"use client"

import React, { type CSSProperties } from "react"
import { Badge } from "@/components/ui/badge"
import { useImageLightbox } from "@/components/ui/image-lightbox"
import type { GenericResultRecord } from "@/lib/schema/types"

type GlassVariant = "thin" | "regular" | "thick" | "tinted"

/** 从 result 里按点分路径取值：'output.answer' / 'input_preview.qa.question' / 'input_refs.qa' */
export function readField(result: GenericResultRecord, path: string): unknown {
  const parts = path.split(".")
  if (parts.length === 0) return undefined
  const head = parts[0]
  let cur: unknown
  switch (head) {
    case "output":
      cur = result.output
      break
    case "input_refs":
      cur = result.input_refs
      break
    case "input_preview":
      // input_preview 是扁平字典，key 形如 'qa.question'。path 'input_preview.qa.question' 需取剩下两段合成 key
      return result.input_preview[parts.slice(1).join(".")]
    case "status":
      return result.status
    case "latency_ms":
      return result.latency_ms
    case "model":
      return result.model
    case "error":
      return result.error
    default:
      return undefined
  }
  for (let i = 1; i < parts.length; i++) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[parts[i]!]
  }
  return cur
}

function formatValue(v: unknown, maxLength?: number): string {
  if (v == null) return "-"
  let s: string
  if (typeof v === "string") s = v
  else if (typeof v === "number" || typeof v === "boolean") s = String(v)
  else s = JSON.stringify(v)
  if (maxLength && s.length > maxLength) s = s.slice(0, maxLength) + "..."
  return s
}

/** 渲染一个字段值为 React 节点，按 type 决定展示方式 */
export function renderField(value: unknown, type: string | undefined, maxLength?: number): React.ReactNode {
  if (value == null || value === "") return <span className="text-muted-foreground">-</span>
  switch (type) {
    case "image":
      // image_url_list → array of strings
      if (Array.isArray(value)) {
        const urls = value.filter((v): v is string => typeof v === "string" && v.length > 0)
        if (urls.length === 0) return <span className="text-muted-foreground">-</span>
        return (
          <div className="flex flex-wrap gap-1.5">
            {urls.map((u, i) => (
              <div key={i} className="w-24 h-24 shrink-0 overflow-hidden rounded border">
                <ClickableImage src={u} />
              </div>
            ))}
          </div>
        )
      }
      // image_url → single string (http(s) URL, data URL, or absolute /api/... URL)
      if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:") || value.startsWith("/api/"))) {
        return <ClickableImage src={value} />
      }
      // legacy: any other string falls through to muted text
      return <span className="text-muted-foreground">{formatValue(value, maxLength)}</span>
    case "badge":
      if (Array.isArray(value)) {
        const items = value.filter(v => v != null && v !== "")
        if (items.length === 0) return <span className="text-muted-foreground">-</span>
        return (
          <div className="flex flex-wrap gap-1 min-w-0">
            {items.map((v, i) => (
              <Badge key={i} variant="secondary" className="text-xs max-w-full">{formatValue(v, maxLength)}</Badge>
            ))}
          </div>
        )
      }
      return <Badge variant="secondary" className="text-xs max-w-full">{formatValue(value, maxLength)}</Badge>
    case "json":
      return <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    case "text":
    default:
      return <span className="text-sm">{formatValue(value, maxLength)}</span>
  }
}

function ClickableImage({ src, alt = "" }: { src: string; alt?: string }) {
  const { openLightbox } = useImageLightbox()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onClick={(e) => { e.stopPropagation(); openLightbox(src, alt) }}
      className="w-full h-full object-contain cursor-zoom-in rounded"
    />
  )
}

/** 暴露给用户 JSX display 的 helpers 对象。
 *
 * 传 `copilotGlass` 时会把 copilot 状态 + 4 档玻璃样式暴露给用户 JSX 源码，
 * 用户可以用 `helpers.glassStyle("regular")` 取 CSSProperties，配合原有 `bg-card` 等 class
 * 做 "copilot 关闭实底 / copilot 打开玻璃" 的切换。 */
export function makeHelpers(copilotGlass?: {
  open: boolean
  styles: Record<GlassVariant, CSSProperties>
}) {
  const open = copilotGlass?.open ?? false
  const styles = copilotGlass?.styles
  return {
    readField,
    formatValue,
    renderField,
    Badge,
    /** copilot 是否打开，供 JSX 源码判断是否要叠玻璃 style */
    copilotOpen: open,
    /** 取出指定档的玻璃 CSSProperties；copilot 关闭时返回 undefined，由调用方决定是否应用 */
    glassStyle: (variant: GlassVariant = "regular"): CSSProperties | undefined => {
      if (!open) return undefined
      return styles?.[variant]
    },
    /** 用于 data-glass-variant 属性；copilot 关闭时返回 undefined */
    glassAttr: (variant: GlassVariant = "regular"): string | undefined => {
      return open ? variant : undefined
    },
  }
}
