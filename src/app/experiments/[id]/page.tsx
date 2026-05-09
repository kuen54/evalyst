"use client"

import { useEffect, useState, useCallback, use, useMemo, memo, startTransition } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import type { ExperimentConfig, ProgressState } from "@/lib/types"
import type { GenericResultRecord, TaskSchema, Display, Rubric, Annotation } from "@/lib/schema/types"
import { pickView } from "@/components/results/registry"
import { RubricAnnotator } from "@/components/results/rubric-annotator"
import type { RubricAggregate } from "@/lib/annotation-store"
import { useT } from "@/lib/i18n/provider"
import { formatCostMap, formatTokens } from "@/lib/format"
import { aggregateResults } from "@/lib/results-aggregate"
import { GlassRegular, GlassCard, GlassSuccess, GlassDanger } from "@/components/copilot/shell"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"

export default function ExperimentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useT()
  const [experiment, setExperiment] = useState<ExperimentConfig | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [results, setResults] = useState<GenericResultRecord[]>([])
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [rubric, setRubric] = useState<Rubric | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [aggregate, setAggregate] = useState<RubricAggregate | null>(null)
  const [scoringOpen, setScoringOpen] = useState(true)

  const fetchExperiment = useCallback(async (): Promise<ExperimentConfig | null> => {
    const exp = await fetch(`/api/experiments/${id}`).then(r => r.json()).catch(() => null)
    if (exp) setExperiment(exp)
    return exp
  }, [id])

  const fetchProgress = useCallback(() => {
    fetch(`/api/experiments/${id}/run`).then(r => {
      if (r.ok) return r.json()
      return null
    }).then(data => { if (data) setProgress(data) })
  }, [id])

  const fetchResults = useCallback(() => {
    fetch(`/api/experiments/${id}/results`).then(r => r.json()).then(setResults)
  }, [id])

  const fetchAnnotations = useCallback((rubricId: string) => {
    fetch(`/api/experiments/${id}/annotations?rubric_id=${rubricId}`)
      .then(r => r.json())
      .then((data: { annotations: Annotation[]; aggregate: RubricAggregate | null }) => {
        setAnnotations(data.annotations || [])
        setAggregate(data.aggregate)
      })
      .catch(() => { /* ignore */ })
  }, [id])

  useEffect(() => {
    fetchExperiment()
    fetchProgress()
    fetchResults()
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
    fetch("/api/displays").then(r => r.json()).then(setDisplays)
  }, [fetchExperiment, fetchProgress, fetchResults])

  // 有 rubric_id 时拉 rubric + annotations
  useEffect(() => {
    if (!experiment?.rubric_id) {
      setRubric(null); setAnnotations([]); setAggregate(null)
      return
    }
    fetch(`/api/rubrics/${experiment.rubric_id}`).then(r => r.ok ? r.json() : null).then(setRubric)
    fetchAnnotations(experiment.rubric_id)
  }, [experiment?.rubric_id, fetchAnnotations])

  useEffect(() => {
    if (experiment?.status !== "running") return
    let lastKey = `${experiment.run_stats?.completed_tasks ?? 0}:${experiment.run_stats?.failed_tasks ?? 0}`
    const interval = setInterval(async () => {
      const exp = await fetchExperiment()
      fetchProgress()
      if (!exp) return
      const key = `${exp.run_stats?.completed_tasks ?? 0}:${exp.run_stats?.failed_tasks ?? 0}`
      if (key !== lastKey) {
        fetchResults()
        lastKey = key
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [experiment?.status, fetchExperiment, fetchProgress, fetchResults])

  const handleRun = useCallback(async (resume = false, taskIds?: string[]) => {
    await fetch(`/api/experiments/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume, task_ids: taskIds }),
    })
    fetchExperiment()
    fetchProgress()
  }, [id, fetchExperiment, fetchProgress])

  const handleRetryTask = useCallback(async (taskId: string) => {
    await handleRun(true, [taskId])
  }, [handleRun])

  const handleStop = useCallback(async () => {
    await fetch(`/api/experiments/${id}/stop`, { method: "POST" })
    fetchExperiment()
    fetchProgress()
  }, [id, fetchExperiment, fetchProgress])

  // 按 task_id 索引最新 annotation（evaluator=human）
  const annotationByTask = useMemo(() => {
    const m = new Map<string, Annotation>()
    for (const a of annotations) {
      if (a.evaluator !== "human") continue
      const prev = m.get(a.task_id)
      if (!prev || a.timestamp > prev.timestamp) m.set(a.task_id, a)
    }
    return m
  }, [annotations])

  const statsAgg = useMemo(() => {
    const stats = experiment?.run_stats || progress
    if (stats && (stats.total_input_tokens != null || stats.total_cost_by_currency != null)) {
      return {
        total_input_tokens: stats.total_input_tokens,
        total_output_tokens: stats.total_output_tokens,
        total_cost_by_currency: stats.total_cost_by_currency ?? {},
        has_token_data: stats.total_input_tokens != null,
        has_cost_data: stats.total_cost_by_currency != null && Object.keys(stats.total_cost_by_currency).length > 0,
      }
    }
    return aggregateResults(results)
  }, [experiment?.run_stats, progress, results])

  useRegisterPageContext(() => ({
    route_type: 'experiment_detail',
    path: `/experiments/${id}`,
    summary: experiment ? {
      id: experiment.id,
      name: experiment.name,
      status: experiment.status,
      created_at: experiment.created_at,
      schema_id: experiment.schema_id,
      model: experiment.model,
      progress: {
        total: experiment.run_stats?.total_tasks ?? 0,
        success: experiment.run_stats?.completed_tasks ?? 0,
        failed: experiment.run_stats?.failed_tasks ?? 0,
        pending: (experiment.run_stats?.total_tasks ?? 0) - (experiment.run_stats?.completed_tasks ?? 0) - (experiment.run_stats?.failed_tasks ?? 0),
      },
      cost_by_currency: experiment.run_stats?.total_cost_by_currency ?? {},
      rubric_id: experiment.rubric_id ?? null,
    } : {},
    timestamp: new Date().toISOString(),
  }), [experiment, id])

  const viewBundle = useMemo(() => {
    if (!experiment) return null
    const schema = schemas.find(s => s.id === experiment.schema_id)
    const effectiveDisplayId = experiment.display_id ?? schema?.display_id
    const display = displays.find(d => d.id === effectiveDisplayId)
    const view = pickView(schema, display)
    return { schema, display, view, ViewComp: view.component }
  }, [experiment, schemas, displays])

  // 把 ViewComp 的 JSX 节点 memo 住：Collapsible 之类状态 toggle 时 experiment/schemas/displays/results 都没变，
  // React 拿缓存的 element 引用直接复用，跳过 104 个 result item 的 diff（层级下的虚拟 DOM 树可能是 2K+ 节点）。
  const resultsNode = useMemo(() => {
    if (!viewBundle || !viewBundle.schema || results.length === 0) return null
    const { ViewComp, schema } = viewBundle
    return <ViewComp results={results} schema={schema} />
  }, [viewBundle, results])

  if (!experiment) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>

  const schema = viewBundle?.schema

  const stats = experiment.run_stats || progress
  const progressPct = stats && stats.total_tasks > 0
    ? Math.round((stats.completed_tasks / stats.total_tasks) * 100) : 0

  return (
    <div className="px-6 py-4">
      <GlassRegular className="p-6">
        <div className="flex items-baseline gap-3 mb-6">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-xs">&larr; {t("common.back")}</Link>
          <h2 className="text-lg font-semibold tracking-tight">{experiment.name}</h2>
          {schema && <Badge variant="outline" className="text-[11px]">{schema.label}</Badge>}
          {rubric && <Badge variant="outline" className="text-[11px]">✅ {rubric.name}</Badge>}
        </div>

      <Collapsible open={configOpen} onOpenChange={(v) => startTransition(() => setConfigOpen(v))}>
        <CollapsibleTrigger className="mb-2 text-muted-foreground text-sm hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-accent">
          {configOpen ? "▾" : "▸"} {t("experiment.detail.config_title")} &middot; {experiment.model} / t={experiment.temperature}
        </CollapsibleTrigger>
        <CollapsibleContent style={{ contain: "layout paint" }}>
          <GlassCard className="mb-4">
            <CardContent className="pt-4">
              <ExperimentPromptPreview
                template={experiment.prompt_template}
                notes={experiment.notes}
                notesLabel={t("experiment.detail.notes")}
              />
            </CardContent>
          </GlassCard>
        </CollapsibleContent>
      </Collapsible>

      <GlassRegular
        className="mb-6 px-4 py-3 text-sm text-card-foreground overflow-hidden"
        data-copilot-context="experiment"
        data-copilot-context-id={experiment.id}
        data-copilot-context-summary={`${experiment.name} · ${experiment.model}`}
      >
        <div className="flex items-center gap-3">
          <Badge variant={experiment.status === "running" ? "default" : "secondary"}>
            {t(`dashboard.status_${experiment.status}`)}
          </Badge>
          {stats && (
            <span className="text-sm text-muted-foreground">
              {stats.completed_tasks}/{stats.total_tasks} {t("experiment.completed_word")}
              {stats.failed_tasks > 0 && <span className="text-red-500"> · {t("dashboard.failed_count", { n: stats.failed_tasks })}</span>}
              {statsAgg.has_token_data && (
                <span> · {t("experiment.tokens_io", {
                  input: formatTokens(statsAgg.total_input_tokens),
                  output: formatTokens(statsAgg.total_output_tokens),
                })}</span>
              )}
              {statsAgg.has_cost_data && (
                <span> · <span className="font-medium text-foreground">{formatCostMap(statsAgg.total_cost_by_currency)}</span></span>
              )}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            {(experiment.status === "draft" || experiment.status === "failed") && (
              <Button size="sm" variant="tinted" onClick={() => handleRun(false)}>{t("experiment.run_btn")}</Button>
            )}
            {experiment.status === "paused" && (
              <Button size="sm" variant="tinted" onClick={() => handleRun(true)}>{t("experiment.resume_btn")}</Button>
            )}
            {experiment.status === "running" && (
              <Button size="sm" variant="outline" onClick={handleStop}>{t("experiment.pause_btn")}</Button>
            )}
            {experiment.status === "completed" && stats && stats.failed_tasks > 0 && (
              <Button size="sm" variant="outline" onClick={() => handleRun(true)}>{t("experiment.retry_btn")}</Button>
            )}
          </div>
        </div>
        {experiment.status === "running" && stats && stats.total_tasks > 0 && (
          <Progress value={progressPct} className="h-1.5 mt-2.5" />
        )}
      </GlassRegular>

      {rubric && aggregate && (
        <Collapsible open={scoringOpen} onOpenChange={(v) => startTransition(() => setScoringOpen(v))} style={{ contain: "layout paint" }}>
          <GlassSuccess
            className="mb-6 border-emerald-200/60"
            data-copilot-context="rubric_stats"
            data-copilot-context-id={experiment.id}
            data-copilot-context-extra={JSON.stringify({ rubric_id: rubric.id })}
            data-copilot-context-summary={`${rubric.name} 评分统计`}
          >
            <CardContent className="pt-4">
              <CollapsibleTrigger className="w-full text-left">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{scoringOpen ? "▾" : "▸"}</span>
                  <span className="font-medium">{t("experiment.detail.scoring_title")}</span>
                  <Badge variant="outline" className="text-[11px]">{rubric.name}</Badge>
                  <span className="text-muted-foreground">
                    {t("experiment.detail.scoring_coverage", {
                      annotated: aggregate.annotated_tasks,
                      total: results.length || aggregate.total_tasks,
                    })}
                  </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 flex flex-wrap gap-4">
                  {aggregate.criteria.map(c => (
                    <div key={c.key} className="min-w-[180px] space-y-0.5">
                      <div className="text-xs font-medium">{c.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.type === "pass_fail" && c.count > 0 && (
                          <>
                            {t("experiment.detail.scoring_pass_rate", { rate: ((c.pass_rate ?? 0) * 100).toFixed(0) })}
                            <span className="ml-1 font-mono">({c.pass}/{c.count})</span>
                          </>
                        )}
                        {(c.type === "likert_1_5" || c.type === "score_0_100") && c.count > 0 && (
                          <>
                            {t("experiment.detail.scoring_avg", { avg: (c.avg ?? 0).toFixed(2) })}
                            <span className="ml-1 font-mono">({c.min}-{c.max}, n={c.count})</span>
                          </>
                        )}
                        {c.count === 0 && <span>{t("experiment.detail.scoring_no_data")}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Per-result annotator table */}
                {results.length > 0 && (
                  <div className="mt-4 border-t pt-3 space-y-1">
                    <div className="text-[11px] text-muted-foreground mb-2">{t("experiment.detail.scoring_table_hint")}</div>
                    <div className="max-h-96 overflow-auto divide-y divide-border/60">
                      {results.map(r => {
                        const preview = summarizeResult(r)
                        const existing = annotationByTask.get(r.task_id)
                        return (
                          <div
                            key={r.task_id}
                            className="flex items-start gap-3 py-1.5 text-xs"
                            data-copilot-context="task_result"
                            data-copilot-context-id={r.task_id}
                            data-copilot-context-extra={JSON.stringify({ experiment_id: experiment.id })}
                            data-copilot-context-summary={preview}
                          >
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-20 truncate" title={r.task_id}>{r.task_id}</span>
                            <span className="flex-1 min-w-0 text-muted-foreground truncate">{preview}</span>
                            <RubricAnnotator
                              experimentId={id}
                              taskId={r.task_id}
                              rubric={rubric}
                              existing={existing}
                              onSaved={() => fetchAnnotations(rubric.id)}
                              triggerClassName="shrink-0"
                              result={r}
                              schema={schema}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </CardContent>
          </GlassSuccess>
        </Collapsible>
      )}

      {experiment.rubric_id && !rubric && (
        <div className="mb-6 p-3 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800">
          {t("experiment.detail.rubric_not_found", { id: experiment.rubric_id })}
        </div>
      )}

      <FailedPanel
        results={results}
        onRetryTask={handleRetryTask}
        running={experiment.status === "running"}
        t={t}
      />

      {results.length > 0 && (
        <>
          <Separator className="mb-4" />
          <h3 className="text-sm font-medium text-muted-foreground mb-4">{t("experiment.detail.results_title")} ({results.length})</h3>
          {resultsNode}
        </>
      )}
      </GlassRegular>
    </div>
  )
}

function summarizeResult(r: GenericResultRecord): string {
  if (r.status !== "success") return `[${r.status}] ${(r.error ?? "").slice(0, 80)}`
  const out = r.output ?? {}
  const parts: string[] = []
  for (const [k, v] of Object.entries(out)) {
    if (parts.join(" · ").length > 120) break
    if (v == null) continue
    if (typeof v === "object") continue
    parts.push(`${k}=${String(v).slice(0, 30)}`)
  }
  return parts.join(" · ") || "(empty)"
}

const ExperimentPromptPreview = memo(function ExperimentPromptPreview({
  template,
  notes,
  notesLabel,
}: { template: string; notes?: string; notesLabel: string }) {
  return (
    <>
      <pre className="text-xs font-mono whitespace-pre-wrap max-h-80 overflow-auto">{template}</pre>
      {notes && (
        <p className="text-sm text-muted-foreground mt-2">{notesLabel}: {notes}</p>
      )}
    </>
  )
})

function FailedPanelImpl({ results, onRetryTask, running, t }: {
  results: GenericResultRecord[]
  onRetryTask: (taskId: string) => void
  running: boolean
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  const failed = useMemo(() => results.filter(r => r.status !== "success"), [results])
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<Set<string>>(new Set())

  if (failed.length === 0) return null

  const retry = async (taskId: string) => {
    setBusy(prev => new Set(prev).add(taskId))
    await onRetryTask(taskId)
    // 不 unset — 一旦启动 running，父组件会重新拉 results，成功的会从 failed 列表消失
    setTimeout(() => setBusy(prev => { const n = new Set(prev); n.delete(taskId); return n }), 3000)
  }

  return (
    <Collapsible open={open} onOpenChange={(v) => startTransition(() => setOpen(v))} style={{ contain: "layout paint" }}>
      <GlassDanger className="mb-6 border-red-200/60">
        <CardContent className="pt-4">
          <CollapsibleTrigger className="w-full text-left">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
              <span className="font-medium text-red-600 dark:text-red-400">
                {t("experiment.detail.failed_title", { n: failed.length })}
              </span>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-1 max-h-72 overflow-auto divide-y divide-border/60">
              {failed.map(r => (
                <div key={r.task_id} className="flex items-start gap-3 py-2 text-xs">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-20 truncate" title={r.task_id}>{r.task_id}</span>
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive mr-1">{r.status}</Badge>
                    <span className="text-muted-foreground break-all">{(r.error ?? "").slice(0, 200)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={e => { e.stopPropagation(); retry(r.task_id) }}
                    disabled={running || busy.has(r.task_id)}
                    className="shrink-0 h-6 text-[10px] px-2"
                    title={t("experiment.detail.retry_task_title")}
                  >
                    ↻ {busy.has(r.task_id) ? t("experiment.detail.retrying") : t("experiment.detail.retry_task_btn")}
                  </Button>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </CardContent>
      </GlassDanger>
    </Collapsible>
  )
}

const FailedPanel = memo(FailedPanelImpl)
