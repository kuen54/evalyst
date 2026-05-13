"use client"

import { Suspense, useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useT } from "@/lib/i18n/provider"
import { formatCost, formatCostMap, formatTokens } from "@/lib/format"
import type { ExperimentConfig } from "@/lib/types"
import type { GenericResultRecord, TaskSchema, Display } from "@/lib/schema/types"
import { rowLabel } from "@/lib/compare-helpers"
import { pickView } from "@/components/results/registry"
import { GlassRegular, GlassThin } from "@/components/glass/shell"
import { GlassStickyHeader } from "@/components/glass/sticky-chrome"
import { useGlassStyle } from "@/components/glass/shell"
import { useCopilotOpen } from "@/components/glass/copilot-context"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"
import { PreviewCard } from "@base-ui/react/preview-card"

function formatLatency(ms: number | undefined): string {
  if (!ms) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 两个 schema 是否能一起对比：相同 compare_group（fallback 到 id） */
function sameCompareGroup(a: TaskSchema | undefined, b: TaskSchema | undefined): boolean {
  if (!a || !b) return false
  return (a.compare_group ?? a.id) === (b.compare_group ?? b.id)
}

/** 把 input_refs 拼成稳定 key（用于行对齐，不分 schema） */
function stableRefKey(refs: Record<string, string | number>): string {
  return Object.keys(refs).sort().map(k => `${k}=${refs[k]}`).join("|")
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="px-6 py-4 text-sm text-muted-foreground">…</div>}>
      <ComparePageInner />
    </Suspense>
  )
}

function ComparePageInner() {
  const t = useT()
  const copilotOpen = useCopilotOpen()
  const searchParams = useSearchParams()
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [schemaFilter, setSchemaFilter] = useState<string | undefined>(undefined)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  /** 已经按 query string 自动选过一次了——避免后续 experiments fetch 触发重置。 */
  const [autoSelectedFromQuery, setAutoSelectedFromQuery] = useState(false)
  const [compareData, setCompareData] = useState<Record<string, {
    experiment_id: string
    experiment_name: string
    model: string
    schema_id: string
    results: GenericResultRecord[]
  }>>({})

  useEffect(() => {
    fetch("/api/compare").then(r => r.json()).then(setExperiments).catch(() => {})
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
    fetch("/api/displays").then(r => r.json()).then(setDisplays)
  }, [])

  // 从 query string 自动预选 ids（首次 experiments 拉到后执行一次，之后不重复）。
  useEffect(() => {
    if (autoSelectedFromQuery) return
    if (experiments.length === 0) return
    const idsParam = searchParams.get("ids")
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from query; see docs/conventions/react19-hydration.md */
    if (!idsParam) {
      setAutoSelectedFromQuery(true)
      return
    }
    const requestedIds = idsParam.split(",").filter(Boolean)
    const validIds = requestedIds.filter(id => experiments.some(e => e.id === id))
    if (validIds.length > 0) {
      setSelectedIds(validIds)
    }
    setAutoSelectedFromQuery(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [experiments, searchParams, autoSelectedFromQuery])

  const schemaById = useMemo(() => Object.fromEntries(schemas.map(s => [s.id, s])), [schemas])

  const filteredExperiments = useMemo(() => {
    if (!schemaFilter) return experiments
    return experiments.filter(e => e.schema_id === schemaFilter)
  }, [experiments, schemaFilter])

  const selectedSchema = useMemo(() => {
    if (selectedIds.length === 0) return null
    const first = experiments.find(e => e.id === selectedIds[0])
    return schemaById[first?.schema_id ?? ""] ?? null
  }, [selectedIds, experiments, schemaById])

  useEffect(() => {
    if (selectedIds.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dep change; see docs/conventions/react19-hydration.md
      setCompareData({})
      return
    }
    const qs = `ids=${selectedIds.join(",")}`
    fetch(`/api/compare?${qs}`).then(r => r.json()).then(setCompareData).catch(() => {})
  }, [selectedIds])

  const toggleExperiment = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length > 0) {
        const existing = experiments.find(e => e.id === prev[0])
        const adding = experiments.find(e => e.id === id)
        if (!sameCompareGroup(schemaById[existing?.schema_id ?? ""], schemaById[adding?.schema_id ?? ""])) return prev
      }
      return [...prev, id]
    })
  }

  const selectedExperiments = useMemo(
    () => selectedIds.map(id => experiments.find(e => e.id === id)).filter((e): e is ExperimentConfig => !!e),
    [selectedIds, experiments],
  )

  useRegisterPageContext(() => ({
    route_type: 'compare',
    path: '/compare',
    search_params: { ids: selectedIds.join(',') },
    summary: {
      experiment_ids: selectedIds,
      experiments: selectedExperiments.map(e => ({
        id: e.id,
        name: e.name,
        status: e.status,
        success: e.run_stats?.completed_tasks ?? 0,
        failed: e.run_stats?.failed_tasks ?? 0,
      })),
      align_key: 'input_refs',
      schema_id: selectedSchema?.id ?? null,
      schema_filter: schemaFilter ?? null,
    },
    timestamp: new Date().toISOString(),
  }), [selectedIds, selectedExperiments, selectedSchema, schemaFilter])

  return (
    <div className="px-6 py-4 h-full">
      <GlassRegular className="h-full overflow-hidden">
        <div
          className="grid h-full transition-[grid-template-columns] duration-200"
          style={{ gridTemplateColumns: leftCollapsed ? "28px 1fr" : "280px 1fr" }}
        >
        <div className="overflow-hidden border-r min-h-0">
          {leftCollapsed ? (
            <button
              onClick={() => setLeftCollapsed(false)}
              title={t("compare.expand_panel")}
              className="w-full h-full flex flex-col items-center justify-start gap-2 py-3 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3l4 4-4 4" />
              </svg>
              <span
                className="text-sm tracking-wider"
                style={{ writingMode: "vertical-rl" }}
              >
                {t("compare.select_prompt_short")}
              </span>
            </button>
          ) : (
            <div className="h-full overflow-auto p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{t("compare.title")}</h2>
                <button
                  onClick={() => setLeftCollapsed(true)}
                  title={t("compare.collapse_panel")}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3l-4 4 4 4" />
                  </svg>
                </button>
              </div>
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{t("compare.select_prompt")}</h3>
                <div className="space-y-3">
                  <Select value={schemaFilter} onValueChange={v => { setSchemaFilter(v ?? undefined); setSelectedIds([]) }}>
                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder={t("compare.all_schemas")} /></SelectTrigger>
                    <SelectContent>
                      {schemas.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {schemaFilter && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      onClick={() => { setSchemaFilter(undefined); setSelectedIds([]) }}
                    >{t("compare.clear_filter")}</button>
                  )}

                  <Separator />

                  <div className="space-y-2 max-h-80 overflow-auto">
                    {filteredExperiments.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t("compare.no_completed")}</p>
                    )}
                    {filteredExperiments.map(exp => {
                      const expSchema = schemaById[exp.schema_id ?? ""]
                      const firstSchema = selectedIds.length > 0 ? schemaById[experiments.find(e => e.id === selectedIds[0])?.schema_id ?? ""] : null
                      const disabled = !!firstSchema && !selectedIds.includes(exp.id) && !sameCompareGroup(firstSchema, expSchema)
                      return (
                        <label key={exp.id} className={`flex items-start gap-2 text-sm p-2 rounded hover:bg-muted/50 cursor-pointer ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
                          <Checkbox
                            checked={selectedIds.includes(exp.id)}
                            onCheckedChange={() => toggleExperiment(exp.id)}
                            disabled={disabled}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium">{exp.name}</div>
                            <div className="flex gap-1 mt-0.5">
                              {expSchema && <Badge variant="outline" className="text-xs">{expSchema.label}</Badge>}
                              <Badge variant="secondary" className="text-xs">{exp.model}</Badge>
                            </div>
                            {exp.run_stats && (
                              <span className="text-xs text-muted-foreground">{t("compare.results_count", { n: exp.run_stats.completed_tasks })}</span>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`overflow-auto min-w-0 px-6 pb-6 transition-[padding] duration-300 ${copilotOpen ? "pt-6" : "pt-0"}`}>
          {selectedIds.length < 2 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {t("compare.pick_hint")}
            </div>
          ) : selectedSchema ? (
            <CompareView
              experiments={experiments}
              selectedIds={selectedIds}
              compareData={compareData}
              schema={selectedSchema}
              displays={displays}
              t={t}
            />
          ) : null}
        </div>
      </div>
      </GlassRegular>
    </div>
  )
}

function PromptInfoIcon({ prompt, t }: { prompt: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const copilotOpen = useCopilotOpen()
  const glassStyle = useGlassStyle("thick")
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={120}
        closeDelay={120}
        render={<span />}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-default shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 11.5v-.5" />
          <path d="M8 9.5c0-1.5 2-1.5 2-3a2 2 0 1 0-4 0" />
        </svg>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={12} className="z-[10000]">
          <PreviewCard.Popup
            className="w-[480px] max-h-[60vh] overflow-auto bg-popover border border-border rounded-lg shadow-lg p-4"
            style={copilotOpen ? { ...glassStyle } : undefined}
            data-glass-variant={copilotOpen ? "thick" : undefined}
          >
            <div className="text-xs font-medium text-muted-foreground mb-2">{t("compare.prompt_template")}</div>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground font-mono">{prompt}</pre>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

function CompareView({ experiments, selectedIds, compareData, schema, displays, t }: {
  experiments: ExperimentConfig[]
  selectedIds: string[]
  compareData: Record<string, { experiment_id: string; experiment_name: string; model: string; schema_id: string; results: GenericResultRecord[] }>
  schema: TaskSchema
  displays: Display[]
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  const display = displays.find(d => d.id === schema.display_id)
  const view = pickView(schema, display)
  const CellComp = view.Cell

  const rows = useMemo(() => {
    const keyMap = new Map<string, { label: string; sortKey: string; cells: Record<string, GenericResultRecord> }>()

    for (const expId of selectedIds) {
      const data = compareData[expId]
      if (!data) continue

      for (const r of data.results) {
        const key = stableRefKey(r.input_refs)
        if (!keyMap.has(key)) {
          keyMap.set(key, {
            label: rowLabel(r.input_refs, r.input_preview, schema),
            sortKey: key,
            cells: {},
          })
        }
        keyMap.get(key)!.cells[expId] = r
      }
    }

    return Array.from(keyMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }, [selectedIds, compareData, schema])

  const expHeaders = selectedIds.map(id => {
    const exp = experiments.find(e => e.id === id)
    return {
      id,
      name: exp?.name ?? id,
      model: exp?.model ?? "",
      prompt: exp?.prompt_template ?? "",
      total_cost_by_currency: exp?.run_stats?.total_cost_by_currency,
      total_input_tokens: exp?.run_stats?.total_input_tokens,
      total_output_tokens: exp?.run_stats?.total_output_tokens,
    }
  })

  // 输入列宽度按内容自适应，cap 在 220px（短行标签时列很窄；长行被截到 220 + ellipsis）。
  // 实验列保持 minmax(220px, 1fr)，保证每列至少 220px 同时均分剩余空间。
  // 外层一个大 grid，header + 每条 row 都用 subgrid 继承列宽 —— 否则各自 grid 的 fit-content
  // 各算一次会错位。
  const colTemplate = `fit-content(220px) repeat(${selectedIds.length}, minmax(220px, 1fr))`

  return (
    <div className="grid gap-y-3" style={{ gridTemplateColumns: colTemplate }}>
      <GlassStickyHeader
        className="col-span-full grid gap-3"
        style={{ gridTemplateColumns: "subgrid" }}
      >
        <div className="text-sm font-medium text-muted-foreground self-end">{t("compare.input_col")}</div>
        {expHeaders.map(h => (
          <div key={h.id} className="text-sm font-medium min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate">{h.name}</span>
              <PromptInfoIcon prompt={h.prompt} t={t} />
            </div>
            <div className="text-xs text-muted-foreground font-normal truncate">
              {h.model}
              {((h.total_cost_by_currency && Object.keys(h.total_cost_by_currency).length > 0) || h.total_input_tokens != null) && (
                <>
                  {" · "}
                  {h.total_input_tokens != null && <>{formatTokens(h.total_input_tokens)}/{formatTokens(h.total_output_tokens)} tok</>}
                  {h.total_cost_by_currency && Object.keys(h.total_cost_by_currency).length > 0 && (
                    <span className="font-medium text-foreground ml-1.5">{formatCostMap(h.total_cost_by_currency)}</span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </GlassStickyHeader>

      {rows.length === 0 && (
        <div className="col-span-full text-center text-muted-foreground py-8">{t("compare.no_match")}</div>
      )}

      {rows.map((row, i) => (
        <div
          key={i}
          className="col-span-full grid gap-3 items-start"
          style={{ gridTemplateColumns: "subgrid" }}
        >
          <div className="text-sm pt-2 min-w-0">
            <div className="font-medium text-xs leading-relaxed break-words">{row.label}</div>
          </div>

          {selectedIds.map(expId => {
            const result = row.cells[expId]
            if (!result) return <div key={expId} className="text-xs text-muted-foreground p-2">-</div>
            return (
              <GlassThin
                key={expId}
                className={`p-3 rounded-lg border ${result.status !== "success" ? "border-red-500/40 bg-red-500/10" : ""}`}
                data-copilot-context="task_result"
                data-copilot-context-id={result.task_id}
                data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id })}
                data-copilot-context-summary={row.label}
              >
                {result.status === "success" ? (
                  <CellComp result={result} schema={schema} />
                ) : (
                  <p className="text-xs text-red-500">{result.status}: {result.error?.slice(0, 80)}</p>
                )}
                <div className="text-xs text-muted-foreground mt-1 flex gap-1.5">
                  <span>{formatLatency(result.latency_ms)}</span>
                  {result.input_tokens != null && (
                    <span>· {formatTokens(result.input_tokens)}/{formatTokens(result.output_tokens)} tok</span>
                  )}
                  {result.cost_value != null && (
                    <span className="font-medium text-foreground">· {formatCost(result.cost_value, result.cost_currency)}</span>
                  )}
                </div>
              </GlassThin>
            )
          })}
        </div>
      ))}
    </div>
  )
}
