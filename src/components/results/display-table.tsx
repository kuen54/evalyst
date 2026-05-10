"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import type { Display } from "@/lib/schema/types"
import type { ResultViewProps, CellViewProps } from "./types"
import { readField, renderField } from "./view-helpers"

/** table mode: 一行一条 result，列由 display.table.columns 定义 */
export function DisplayTable({ results, display }: ResultViewProps & { display: Display }) {
  const t = useT()
  const cfg = display.table!
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return results.filter(r => {
      if (search) {
        const hit = cfg.columns.some(c => {
          const v = readField(r, c.field)
          if (typeof v === "string") return v.includes(search)
          return false
        })
        if (!hit) return false
      }
      return true
    })
  }, [results, cfg.columns, search])

  const colTemplate = cfg.columns.map(c => c.width ?? "1fr").join(" ")

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <Input placeholder={t("results.search_placeholder")} value={search} onChange={e => setSearch(e.target.value)} className="w-48 h-8 text-xs" />
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {results.length}</span>
      </div>

      {/* Header */}
      <div className="grid gap-2 py-2 px-3 border-b text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: colTemplate }}>
        {cfg.columns.map(c => <div key={c.field}>{c.label}</div>)}
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {filtered.map(r => (
          <div
            key={r.task_id}
            className={`grid gap-2 py-2 px-3 items-start ${r.status !== "success" ? "bg-red-500/10" : ""}`}
            style={{ gridTemplateColumns: colTemplate }}
          >
            {cfg.columns.map(c => (
              <div key={c.field} className="min-w-0 overflow-hidden">
                {r.status === "success"
                  ? renderField(readField(r, c.field), c.type, c.max_length)
                  : c.field === cfg.columns[0]!.field
                    ? <Badge variant="destructive" className="text-[10px]">{r.status}</Badge>
                    : <span className="text-xs text-muted-foreground">-</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** compare cell: 第一列作为摘要 */
export function DisplayTableCell({ result, display }: CellViewProps & { display: Display }) {
  if (!display.table) return null
  return (
    <div className="space-y-1">
      {display.table.columns.slice(0, 3).map(c => {
        const v = readField(result, c.field)
        return (
          <div key={c.field} className="text-sm">
            {renderField(v, c.type, c.max_length)}
          </div>
        )
      })}
    </div>
  )
}
