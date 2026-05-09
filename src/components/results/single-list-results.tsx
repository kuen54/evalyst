"use client"

import { useMemo } from "react"
import { GlassCardThin } from "@/components/copilot/shell"
import { Badge } from "@/components/ui/badge"
import type { ResultViewProps, CellViewProps } from "./types"
import { dimensionsOf, readDimensionValue, labelFor } from "./dimension-helpers"
import { readField, renderField } from "./view-helpers"
import { getOutputFields, inferFieldRenderType } from "./output-structure"
import { formatCost, formatTokens } from "@/lib/format"

/** 1 维（或 0 维）展示：每条 result 一行；维度值作为 header */
export function SingleListResults({ results, schema }: ResultViewProps) {
  const dims = dimensionsOf(schema)
  const outputFields = useMemo(() => getOutputFields(schema.output_schema), [schema.output_schema])

  return (
    <div className="space-y-2">
      {results.map(r => (
        <GlassCardThin
          key={r.task_id}
          className={`${r.status !== "success" ? "border-red-500/40" : ""}`}
          data-copilot-context="task_result"
          data-copilot-context-id={r.task_id}
          data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id })}
        >
          <div className="p-3 space-y-2">
            {/* Header: 所有维度值用 " · " 连接 */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {dims.length > 0 ? (
                dims.map((dim, i) => {
                  const v = readDimensionValue(r, dim)
                  return (
                    <span key={i} className="flex items-center gap-1">
                      {dim.label && <span className="text-xs text-muted-foreground">{dim.label}:</span>}
                      <Badge variant="outline" className="text-xs">{labelFor(dim, v)}</Badge>
                    </span>
                  )
                })
              ) : (
                <Badge variant="outline" className="text-xs font-mono">{r.task_id}</Badge>
              )}
              <div className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span>{r.latency_ms}ms</span>
                {(r.input_tokens != null || r.output_tokens != null) && (
                  <span>· {formatTokens(r.input_tokens)}/{formatTokens(r.output_tokens)} tok</span>
                )}
                {r.cost_value != null && (
                  <span className="font-medium text-foreground">· {formatCost(r.cost_value, r.cost_currency)}</span>
                )}
              </div>
            </div>

            {/* Output fields */}
            {r.status === "success" && r.output ? (
              <div className="space-y-1">
                {outputFields.map(f => {
                  const val = readField(r, `output.${f.name}`)
                  const renderType = inferFieldRenderType(f, val)
                  return (
                    <div
                      key={f.name}
                      className="flex gap-2 text-sm items-baseline"
                      data-copilot-context="task_field"
                      data-copilot-context-id={`${r.task_id}#${f.name}`}
                      data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
                      data-copilot-context-summary={`${f.name}`}
                    >
                      <span className="text-xs text-muted-foreground min-w-[60px]">{f.name}:</span>
                      <div className="flex-1 min-w-0">{renderField(val, renderType, renderType === "text" ? 500 : undefined)}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs text-red-500">{r.status}: {r.error?.slice(0, 200)}</div>
            )}
          </div>
        </GlassCardThin>
      ))}
    </div>
  )
}

/** compare cell 简化展示：只展示 output 前 3 个字段 */
export function SingleListCell({ result, schema }: CellViewProps) {
  const outputFields = getOutputFields(schema.output_schema).slice(0, 3)
  if (result.status !== "success" || !result.output) return null
  return (
    <div className="space-y-1">
      {outputFields.map(f => {
        const val = (result.output as Record<string, unknown>)[f.name]
        const type = inferFieldRenderType(f, val)
        return (
          <div
            key={f.name}
            data-copilot-context="task_field"
            data-copilot-context-id={`${result.task_id}#${f.name}`}
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
            data-copilot-context-summary={`${f.name} · ${String(val ?? "").slice(0, 24)}`}
          >
            {renderField(val, type)}
          </div>
        )
      })}
    </div>
  )
}
