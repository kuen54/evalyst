"use client"

import { useMemo, useState } from "react"
import { CardHeader } from "@/components/ui/card"
import { GlassThin, GlassCardThin } from "@/components/glass/shell"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { ResultViewProps, CellViewProps } from "./types"
import {
  dimensionsOf,
  readDimensionValue,
  labelFor,
  collectDimensionValues,
  groupByDimension,
} from "./dimension-helpers"
import { readField, renderField } from "./view-helpers"
import { getOutputFields, inferFieldRenderType } from "./output-structure"
import { formatCost, formatTokens } from "@/lib/format"
import { ResultScoringSection } from "./result-rubric-slot"

/**
 * 2 维展示：按 dim[0] 分组，每组下按 dim[1] 列出所有 result。
 */
export function DualListResults({ results, schema, experimentId, rubric, annotationByTask, onAnnotationSaved }: ResultViewProps) {
  const t = useT()
  const dims = dimensionsOf(schema)
  const outputFields = useMemo(() => getOutputFields(schema.output_schema), [schema.output_schema])

  // Hoist hooks above the early return to satisfy react-hooks/rules-of-hooks;
  // useMemo bodies short-circuit when their dim is undefined.
  const primaryDim = dims[0]
  const secondaryDim = dims[1]
  const groups = useMemo(
    () => (primaryDim ? groupByDimension(results, primaryDim) : null),
    [results, primaryDim],
  )
  const secondaryValues: Array<string | number> = useMemo(
    () => (secondaryDim ? collectDimensionValues(results, secondaryDim) : []),
    [results, secondaryDim],
  )

  if (!primaryDim || !secondaryDim || !groups) {
    return <div className="text-xs text-muted-foreground py-4">{t("results.need_2_dims")}</div>
  }

  return (
    <div className="space-y-3">
      {Array.from(groups.entries())
        .sort((a, b) => cmpDimKey(a[0], b[0]))
        .map(([groupValue, rows]) => (
          <GroupRow
            key={String(groupValue)}
            groupValue={groupValue}
            primaryDim={primaryDim}
            secondaryDim={secondaryDim}
            rows={rows}
            secondaryValues={secondaryValues}
            outputFields={outputFields}
            schema={schema}
            t={t}
            {...(experimentId !== undefined ? { experimentId } : {})}
            {...(rubric !== undefined ? { rubric } : {})}
            {...(annotationByTask !== undefined ? { annotationByTask } : {})}
            {...(onAnnotationSaved !== undefined ? { onAnnotationSaved } : {})}
          />
        ))}
    </div>
  )
}

function GroupRow({ groupValue, primaryDim, secondaryDim, rows, secondaryValues, outputFields, schema, t, experimentId, rubric, annotationByTask, onAnnotationSaved }: {
  groupValue: string | number | null
  primaryDim: import("@/lib/schema/types").DisplayDimension
  secondaryDim: import("@/lib/schema/types").DisplayDimension
  rows: import("@/lib/schema/types").GenericResultRecord[]
  secondaryValues: Array<string | number>
  outputFields: ReturnType<typeof getOutputFields>
  schema: import("@/lib/schema/types").TaskSchema
  t: TFn
  experimentId?: string
  rubric?: import("@/lib/schema/types").Rubric | null
  annotationByTask?: Map<string, import("@/lib/schema/types").Annotation>
  onAnnotationSaved?: () => void
}) {
  const [open, setOpen] = useState(true)

  // 构造 secondary value → row 的 map
  const byValue = new Map<string, import("@/lib/schema/types").GenericResultRecord>()
  for (const r of rows) {
    const v = readDimensionValue(r, secondaryDim)
    byValue.set(String(v), r)
  }

  // 组头额外字段：读第一行的 input_preview / input_refs
  const sample = rows[0]
  const headerFields = primaryDim.header_fields ?? []

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left cursor-pointer">
        <GlassCardThin className="hover:bg-muted/50 transition-colors">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
              <span className="text-xs text-muted-foreground">{primaryDim.label}:</span>
              <span className="font-medium text-sm">{labelFor(primaryDim, groupValue)}</span>
              {headerFields.map(hf => {
                const v = sample ? readField(sample, hf.field) : undefined
                if (v == null || v === "") return null
                return (
                  <span key={hf.field} className="text-xs text-muted-foreground">
                    · {hf.label ? `${hf.label}: ` : ""}
                    <span className="text-foreground">{String(v)}</span>
                  </span>
                )
              })}
              <span className="text-xs text-muted-foreground ml-auto">{t("results.n_rows", { n: rows.length })}</span>
            </div>
          </CardHeader>
        </GlassCardThin>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-2 mb-4 space-y-2">
          {secondaryValues.map(sv => {
            const r = byValue.get(String(sv))
            return (
              <div key={String(sv)} className="flex gap-3 items-start">
                <div className="w-24 shrink-0 pt-2">
                  <Badge variant="outline" className="text-[11px]">
                    {labelFor(secondaryDim, sv)}
                  </Badge>
                </div>
                <GlassThin
                  className={`flex-1 p-2 flex flex-col gap-1.5 overflow-hidden rounded-lg border bg-card text-sm text-card-foreground ${r && r.status !== "success" ? "border-red-500/40 bg-red-500/10" : ""}`}
                  {...(r
                    ? {
                        "data-copilot-context": "task_result",
                        "data-copilot-context-id": r.task_id,
                        "data-copilot-context-extra": JSON.stringify({ experiment_id: r.experiment_id }),
                        "data-copilot-context-summary":
                          r.status === "success"
                            ? `${labelFor(secondaryDim, sv)} 结果`
                            : `[${r.status}] ${(r.error ?? "").slice(0, 40)}`,
                      }
                    : {})}
                >
                  {r ? (
                    r.status === "success" ? (
                      <div className="space-y-1">
                        {outputFields.map(f => {
                          const val = readField(r, `output.${f.name}`)
                          const type = inferFieldRenderType(f, val)
                          return (
                            <div
                              key={f.name}
                              className="flex gap-2 text-sm items-baseline"
                              data-copilot-context="task_field"
                              data-copilot-context-id={`${r.task_id}#${f.name}`}
                              data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
                              data-copilot-context-summary={`${labelFor(secondaryDim, sv)} · ${f.name}`}
                            >
                              {outputFields.length > 1 && (
                                <span className="text-[11px] text-muted-foreground min-w-[50px]">{f.name}:</span>
                              )}
                              <div className="flex-1 min-w-0">{renderField(val, type)}</div>
                            </div>
                          )
                        })}
                        {(r.input_tokens != null || r.cost_value != null) && (
                          <div className="text-[10px] text-muted-foreground flex gap-1.5 pt-0.5">
                            {r.input_tokens != null && (
                              <span>{formatTokens(r.input_tokens)}/{formatTokens(r.output_tokens)} tok</span>
                            )}
                            {r.cost_value != null && (
                              <span className="font-medium text-foreground">· {formatCost(r.cost_value, r.cost_currency)}</span>
                            )}
                          </div>
                        )}
                        <ResultScoringSection
                          result={r}
                          schema={schema}
                          {...(experimentId !== undefined ? { experimentId } : {})}
                          {...(rubric !== undefined ? { rubric } : {})}
                          {...(annotationByTask !== undefined ? { annotationByTask } : {})}
                          {...(onAnnotationSaved !== undefined ? { onAnnotationSaved } : {})}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-red-500">{r.status}: {r.error?.slice(0, 80)}</p>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </GlassThin>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function cmpDimKey(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const an = Number(a)
  const bn = Number(b)
  if (!isNaN(an) && !isNaN(bn)) return an - bn
  return String(a).localeCompare(String(b))
}

/** compare cell */
export function DualListCell({ result, schema }: CellViewProps) {
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
