"use client"

import { CardContent, CardHeader } from "@/components/ui/card"
import { GlassCardThin } from "@/copilot/components/shell"
import { Badge } from "@/components/ui/badge"
import type { ResultViewProps, CellViewProps } from "./types"

/** 通用 JSON 展示 — 推断兜底 */
export function JsonDefaultResults({ results }: ResultViewProps) {
  return (
    <div className="space-y-3">
      {results.map(r => (
        <GlassCardThin key={r.task_id} className={`${r.status !== "success" ? "border-red-500/40" : ""}`}>
          <CardHeader className="py-2 px-4">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="outline" className="font-mono">{r.task_id}</Badge>
              {Object.entries(r.input_preview).slice(0, 5).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="font-normal">
                  {k}={String(v ?? "").slice(0, 30)}
                </Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            {r.status === "success" ? (
              <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/50 p-2 rounded max-h-80 overflow-auto">
                {JSON.stringify(r.output, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-red-500">{r.status}: {r.error?.slice(0, 200)}</p>
            )}
          </CardContent>
        </GlassCardThin>
      ))}
    </div>
  )
}

/** compare cell */
export function JsonDefaultCell({ result }: CellViewProps) {
  if (!result.output) return null
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">
      {JSON.stringify(result.output, null, 2)}
    </pre>
  )
}
