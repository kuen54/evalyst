"use client"

import { useMemo, useState } from "react"
import { Card, CardHeader } from "@/components/ui/card"
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

/**
 * 3 维展示：按 dim[0] 分组，组内 dim[1]×dim[2] 网格。
 */
export function TripleGridResults({ results, schema }: ResultViewProps) {
  const t = useT()
  const dims = dimensionsOf(schema)
  const outputFields = useMemo(() => getOutputFields(schema.output_schema), [schema.output_schema])

  if (dims.length < 3) {
    return <div className="text-xs text-muted-foreground py-4">{t("results.need_3_dims")}</div>
  }

  const [primaryDim, rowDim, colDim] = dims
  const groups = useMemo(() => groupByDimension(results, primaryDim), [results, primaryDim])
  const rowValues = useMemo(() => collectDimensionValues(results, rowDim), [results, rowDim])
  const colValues = useMemo(() => collectDimensionValues(results, colDim), [results, colDim])

  return (
    <div className="space-y-3">
      {Array.from(groups.entries())
        .sort((a, b) => cmpDimKey(a[0], b[0]))
        .map(([groupValue, rows]) => (
          <GridGroup
            key={String(groupValue)}
            groupValue={groupValue}
            primaryDim={primaryDim}
            rowDim={rowDim}
            colDim={colDim}
            rows={rows}
            rowValues={rowValues}
            colValues={colValues}
            outputFields={outputFields}
            t={t}
          />
        ))}
    </div>
  )
}

function GridGroup({ groupValue, primaryDim, rowDim, colDim, rows, rowValues, colValues, outputFields, t }: {
  groupValue: string | number | null
  primaryDim: import("@/lib/schema/types").DisplayDimension
  rowDim: import("@/lib/schema/types").DisplayDimension
  colDim: import("@/lib/schema/types").DisplayDimension
  rows: import("@/lib/schema/types").GenericResultRecord[]
  rowValues: Array<string | number>
  colValues: Array<string | number>
  outputFields: ReturnType<typeof getOutputFields>
  t: TFn
}) {
  const [open, setOpen] = useState(true)

  // 构造 (rowV, colV) → row
  const cellMap = new Map<string, import("@/lib/schema/types").GenericResultRecord>()
  for (const r of rows) {
    const rv = readDimensionValue(r, rowDim)
    const cv = readDimensionValue(r, colDim)
    cellMap.set(`${rv}|${cv}`, r)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left cursor-pointer">
        <Card className="hover:bg-muted/50 transition-colors">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
              <span className="text-xs text-muted-foreground">{primaryDim.label}:</span>
              <span className="font-medium text-sm">{labelFor(primaryDim, groupValue)}</span>
              <span className="text-xs text-muted-foreground ml-auto">{t("results.n_rows", { n: rows.length })}</span>
            </div>
          </CardHeader>
        </Card>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-2 mb-4 overflow-x-auto">
          {/* Header row */}
          <div
            className="grid gap-2 mb-1"
            style={{ gridTemplateColumns: `100px repeat(${colValues.length}, 1fr)` }}
          >
            <div className="text-[11px] text-muted-foreground text-center">{colDim.label} →</div>
            {colValues.map(cv => (
              <div key={String(cv)} className="text-[11px] text-center text-muted-foreground font-medium">
                {labelFor(colDim, cv)}
              </div>
            ))}
          </div>
          {/* Body rows */}
          {rowValues.map(rv => (
            <div
              key={String(rv)}
              className="grid gap-2 mt-1 items-start"
              style={{ gridTemplateColumns: `100px repeat(${colValues.length}, 1fr)` }}
            >
              <div className="text-[11px] text-muted-foreground pt-2">
                {labelFor(rowDim, rv)}
              </div>
              {colValues.map(cv => {
                const r = cellMap.get(`${rv}|${cv}`)
                if (!r) return <div key={String(cv)} className="text-xs text-muted-foreground p-2 text-center">-</div>
                return (
                  <Card key={String(cv)} className={`p-2 ${r.status !== "success" ? "border-red-200 bg-red-50" : ""}`}>
                    {r.status === "success" && r.output ? (
                      <>
                        {outputFields.map(f => {
                          const val = readField(r, `output.${f.name}`)
                          const type = inferFieldRenderType(f, val)
                          return (
                            <div key={f.name} className="text-xs leading-relaxed">
                              {renderField(val, type, 100)}
                            </div>
                          )
                        })}
                        {(r.input_tokens != null || r.cost_value != null) && (
                          <div className="text-[10px] text-muted-foreground pt-0.5 flex gap-1">
                            {r.input_tokens != null && (
                              <span>{formatTokens(r.input_tokens)}/{formatTokens(r.output_tokens)}t</span>
                            )}
                            {r.cost_value != null && (
                              <span className="font-medium text-foreground">{formatCost(r.cost_value, r.cost_currency)}</span>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-red-500">{r.status}: {r.error?.slice(0, 40)}</p>
                    )}
                  </Card>
                )
              })}
            </div>
          ))}
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

export function TripleGridCell({ result, schema }: CellViewProps) {
  const outputFields = getOutputFields(schema.output_schema).slice(0, 3)
  if (result.status !== "success" || !result.output) return null
  return (
    <div className="space-y-1">
      {outputFields.map(f => {
        const val = (result.output as Record<string, unknown>)[f.name]
        const type = inferFieldRenderType(f, val)
        return <div key={f.name}>{renderField(val, type)}</div>
      })}
    </div>
  )
}
