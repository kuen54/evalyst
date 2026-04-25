"use client"

import React from "react"
import { Badge } from "@/components/ui/badge"
import type { GenericResultRecord } from "@/lib/schema/types"

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
    cur = (cur as Record<string, unknown>)[parts[i]]
  }
  return cur
}

export function formatValue(v: unknown, maxLength?: number): string {
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
      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={value} alt="" className="w-full h-full object-contain" />
      }
      return <span className="text-muted-foreground">{formatValue(value, maxLength)}</span>
    case "badge":
      return <Badge variant="secondary" className="text-xs">{formatValue(value, maxLength)}</Badge>
    case "json":
      return <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    case "text":
    default:
      return <span className="text-sm">{formatValue(value, maxLength)}</span>
  }
}

/** 暴露给用户 JSX display 的 helpers 对象 */
export function makeHelpers() {
  return {
    readField,
    formatValue,
    renderField,
    Badge,
  }
}
