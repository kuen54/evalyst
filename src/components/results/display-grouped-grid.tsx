"use client"

import { useMemo, useState } from "react"
import { CardHeader } from "@/components/ui/card"
import { GlassThin } from "@/components/copilot/shell"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import type { Display } from "@/lib/schema/types"
import type { ResultViewProps, CellViewProps } from "./types"
import { readField, renderField } from "./view-helpers"

/**
 * grouped_grid mode：按 primary_group 分外层组，secondary_group 在组内展开成列。
 */
export function DisplayGroupedGrid({ results, display }: ResultViewProps & { display: Display }) {
  const t = useT()
  const cfg = display.grouped_grid!
  const primaryField = cfg.primary_group.field
  const secondaryField = cfg.secondary_group.field

  const [search, setSearch] = useState("")

  // 分组：按 primary 分桶
  const grouped = useMemo(() => {
    const map = new Map<string, { primary_value: unknown; header: Record<string, unknown>; rows: typeof results }>()
    for (const r of results) {
      const pv = readField(r, primaryField)
      const key = pv == null ? "__null__" : String(pv)
      if (!map.has(key)) {
        const header: Record<string, unknown> = {}
        for (const hf of cfg.header_fields ?? []) {
          header[hf] = readField(r, hf)
        }
        map.set(key, { primary_value: pv, header, rows: [] })
      }
      map.get(key)!.rows.push(r)
    }
    return Array.from(map.entries()).sort((a, b) => {
      const [aKey] = a
      const [bKey] = b
      const an = Number(aKey)
      const bn = Number(bKey)
      if (!isNaN(an) && !isNaN(bn)) return an - bn
      return aKey.localeCompare(bKey)
    })
  }, [results, primaryField, cfg.header_fields])

  const filtered = useMemo(() => {
    return grouped.filter(([, data]) => {
      if (search) {
        const hit = Object.values(data.header).some(v => typeof v === "string" && v.includes(search))
        if (!hit) return false
      }
      return true
    })
  }, [grouped, search])

  const orderedSecondaryValues: Array<string | number> = cfg.secondary_group.order
    ?? Array.from(
      (() => {
        const set = new Set<string | number>()
        for (const r of results) {
          const v = readField(r, secondaryField)
          if (v != null && (typeof v === "string" || typeof v === "number")) {
            // 忽略 fallback group 的值
            if (cfg.fallback_group && readField(r, cfg.fallback_group.field) === cfg.fallback_group.value) continue
            set.add(v)
          }
        }
        return set
      })(),
    )

  const secondaryLabel = (v: string | number) => cfg.secondary_group.value_labels?.[String(v)] ?? String(v)

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <Input placeholder={t("results.search_placeholder")} value={search} onChange={e => setSearch(e.target.value)} className="w-40 h-8 text-xs" />
      </div>

      <div className="space-y-3">
        {filtered.map(([key, data]) => {
          const rowsMap = new Map<string, typeof data.rows[0]>()
          for (const r of data.rows) {
            const sv = readField(r, secondaryField)
            rowsMap.set(String(sv), r)
          }
          const fallbackRow = cfg.fallback_group
            ? data.rows.find(r => readField(r, cfg.fallback_group!.field) === cfg.fallback_group!.value)
            : undefined

          return (
            <GroupCard
              key={key}
              headerFields={cfg.header_fields ?? []}
              sampleRow={data.rows[0]}
              secondaryValues={orderedSecondaryValues}
              secondaryLabel={secondaryLabel}
              rowsMap={rowsMap}
              fallbackRow={fallbackRow}
              fallbackLabel={cfg.fallback_group?.label}
              cellColumns={cfg.cell_columns}
            />
          )
        })}
      </div>
    </div>
  )
}

function GroupCard({
  headerFields,
  sampleRow,
  secondaryValues,
  secondaryLabel,
  rowsMap,
  fallbackRow,
  fallbackLabel,
  cellColumns,
}: {
  headerFields: string[]
  sampleRow: import("@/lib/schema/types").GenericResultRecord
  secondaryValues: Array<string | number>
  secondaryLabel: (v: string | number) => string
  rowsMap: Map<string, import("@/lib/schema/types").GenericResultRecord>
  fallbackRow: import("@/lib/schema/types").GenericResultRecord | undefined
  fallbackLabel: string | undefined
  cellColumns: Array<{ field: string; type?: string; max_length?: number }>
}) {
  const t = useT()
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left cursor-pointer">
        <GlassThin className="hover:bg-muted/50 transition-colors flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
              {headerFields.map((hf, i) => {
                const v = readField(sampleRow, hf)
                if (v == null || v === "") return null
                return (
                  <span key={hf} className={i === 0 ? "font-medium text-sm" : ""}>
                    {i === 0 ? String(v) : <Badge variant="outline" className="text-xs">{String(v)}</Badge>}
                  </span>
                )
              })}
            </div>
          </CardHeader>
        </GlassThin>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-2 mb-4">
          <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: `repeat(${secondaryValues.length}, 1fr)` }}>
            {secondaryValues.map(v => (
              <div key={String(v)} className="text-[11px] text-center text-muted-foreground font-medium">
                {secondaryLabel(v)}
              </div>
            ))}
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${secondaryValues.length}, 1fr)` }}>
            {secondaryValues.map(v => {
              const r = rowsMap.get(String(v))
              if (!r) return <div key={String(v)} className="text-xs text-muted-foreground p-2 text-center">-</div>
              if (r.status !== "success") {
                return (
                  <GlassThin key={String(v)} className="p-2 border-red-200 bg-red-50 flex flex-col gap-4 overflow-hidden rounded-xl border text-sm text-card-foreground ring-1 ring-foreground/10">
                    <p className="text-xs text-red-500">{r.status}: {r.error?.slice(0, 40)}</p>
                  </GlassThin>
                )
              }
              return (
                <GlassThin key={String(v)} className="p-2 space-y-1 flex flex-col gap-4 overflow-hidden rounded-xl border bg-card text-sm text-card-foreground ring-1 ring-foreground/10">
                  {cellColumns.map(c => (
                    <div key={c.field}>{renderField(readField(r, c.field), c.type, c.max_length)}</div>
                  ))}
                </GlassThin>
              )
            })}
          </div>

          {fallbackRow && (
            <div className="mt-3">
              <GlassThin className={`p-2 flex flex-col gap-4 overflow-hidden rounded-xl border bg-card text-sm text-card-foreground ring-1 ring-foreground/10 ${fallbackRow.status !== "success" ? "border-red-200 bg-red-50" : "bg-muted/30"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">{fallbackLabel ?? t("results.fallback_group")}</Badge>
                  {fallbackRow.status === "success"
                    ? cellColumns.map(c => (
                        <span key={c.field} className="text-xs">
                          {renderField(readField(fallbackRow, c.field), c.type, c.max_length)}
                        </span>
                      ))
                    : <span className="text-xs text-red-500">{fallbackRow.status}: {fallbackRow.error?.slice(0, 50)}</span>
                  }
                </div>
              </GlassThin>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** compare cell：只展示 cell_columns 第一行 */
export function DisplayGroupedGridCell({ result, display }: CellViewProps & { display: Display }) {
  if (!display.grouped_grid) return null
  return (
    <div className="space-y-1">
      {display.grouped_grid.cell_columns.slice(0, 3).map(c => (
        <div key={c.field}>{renderField(readField(result, c.field), c.type, c.max_length)}</div>
      ))}
    </div>
  )
}
