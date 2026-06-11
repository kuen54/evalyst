"use client"

import { useEffect, useState, useCallback, use, useMemo, memo, startTransition } from "react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import type { ExperimentConfig, ProgressState } from "@/lib/types"
import type { GenericResultRecord, TaskSchema, Display, Rubric, Annotation } from "@/lib/schema/types"
import { pickView } from "@/components/results/registry"
import type { RubricAggregate } from "@/lib/annotation-store"
import { useT } from "@/lib/i18n/provider"
import { aggregateResults } from "@/lib/results-aggregate"
import { findComparableExperiments, buildCompareHref } from "@/lib/compare-helpers"
import { GlassRegular, GlassCard, GlassSuccess, GlassDanger } from "@/components/glass/shell"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"
import { computeStatusInfo } from "@/lib/experiment-status"
import { ExperimentStatusBadge } from "@/components/experiment-status-badge"

export default function ExperimentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useT()
  const [experiment, setExperiment] = useState<ExperimentConfig | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [results, setResults] = useState<GenericResultRecord[]>([])
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [allExperiments, setAllExperiments] = useState<ExperimentConfig[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [rubric, setRubric] = useState<Rubric | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [aggregate, setAggregate] = useState<RubricAggregate | null>(null)
  const [scoringOpen, setScoringOpen] = useState(true)

  const fetchExperiment = useCallback(async (): Promise<ExperimentConfig | null> => {
    const exp = await fetch(`/api/experiments/${id}`).then(r => r.json()).catch(() => null)
    // 内容没变就复用旧引用（config json 很小，stringify 可忽略）：轮询期间依赖
    // experiment 对象的 memo（statsAgg / comparableExperiments / page context）不再每秒失效。
    if (exp) setExperiment(prev => (prev && JSON.stringify(prev) === JSON.stringify(exp) ? prev : exp))
    return exp
  }, [id])

  const fetchProgress = useCallback(() => {
    fetch(`/api/experiments/${id}/run`).then(r => {
      if (r.ok) return r.json()
      return null
    }).then(data => { if (data) setProgress(data) })
  }, [id])

  const fetchResults = useCallback(() => {
    fetch(`/api/experiments/${id}/results`).then(r => r.json()).then((incoming: GenericResultRecord[]) => {
      // 服务端每次返回全新对象（HTTP→JSON）。运行中轮询时若整张 setResults 全新数组，
      // 104 行全部丢引用 → ViewComp 行级 memo 全失效。这里按 task_id 合并：内容未变
      // （同 timestamp + 同 status）的行复用旧引用，只有真变的行才换新对象；整体没变就
      // 返回旧数组（resultsNode useMemo 直接跳过）。
      if (!Array.isArray(incoming)) return
      setResults(prev => {
        const prevByTask = new Map(prev.map(r => [r.task_id, r]))
        let changed = incoming.length !== prev.length
        const merged = incoming.map(rec => {
          const old = prevByTask.get(rec.task_id)
          if (old && old.timestamp === rec.timestamp && old.status === rec.status) return old
          changed = true
          return rec
        })
        return changed ? merged : prev
      })
    })
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch helpers seed initial state; see docs/conventions/react19-hydration.md
    fetchExperiment()
    fetchProgress()
    fetchResults()
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
    fetch("/api/displays").then(r => r.json()).then(setDisplays)
    // 拉所有 completed/paused experiments，用于"对比"按钮 same-compare-group 计数 + 跳转
    fetch("/api/compare").then(r => r.json()).then((list: ExperimentConfig[]) => {
      if (Array.isArray(list)) setAllExperiments(list)
    }).catch(() => { /* ignore */ })
  }, [fetchExperiment, fetchProgress, fetchResults])

  // 有 rubric_id 时拉 rubric + annotations
  useEffect(() => {
    if (!experiment?.rubric_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dep change; see docs/conventions/react19-hydration.md
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run_stats are polled inside the interval, not deps
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

  // 按 task_id 索引最新 annotation：human > llm 优先级（人工覆盖 LLM baseline），同档取 timestamp 最新。
  // 同时 surface 给结果卡片的 RubricAnnotator existing —— 人 review LLM 分数 / 修正 / 直接保存即可。
  const annotationByTask = useMemo(() => {
    const m = new Map<string, Annotation>()
    for (const a of annotations) {
      const prev = m.get(a.task_id)
      if (!prev) { m.set(a.task_id, a); continue }
      const prevIsHuman = prev.evaluator === "human"
      const curIsHuman = a.evaluator === "human"
      if (curIsHuman && !prevIsHuman) { m.set(a.task_id, a); continue }
      if (!curIsHuman && prevIsHuman) continue
      if (a.timestamp > prev.timestamp) m.set(a.task_id, a)
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

  /** 同 compare_group 的其他 completed/paused experiments，用于"对比"按钮预选。 */
  const comparableExperiments = useMemo(() => {
    if (!experiment) return []
    return findComparableExperiments(experiment, schemas, allExperiments)
  }, [experiment, schemas, allExperiments])

  const compareHref = useMemo(() => {
    if (!experiment) return null
    return buildCompareHref(experiment, comparableExperiments)
  }, [experiment, comparableExperiments])

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

  // 依赖窄化到实际读取的两个字段：运行中 1s 轮询每次 setExperiment 都换引用，
  // 若依赖整个 experiment 对象，viewBundle → resultsNode 每秒重算，自定义 display
  // 的 ViewComp 还会换组件标识导致整树 remount。schema_id / display_id 跨轮询恒定。
  const expSchemaId = experiment?.schema_id
  const expDisplayId = experiment?.display_id
  const hasExperiment = experiment !== null
  const viewBundle = useMemo(() => {
    if (!hasExperiment) return null
    const schema = schemas.find(s => s.id === expSchemaId)
    const effectiveDisplayId = expDisplayId ?? schema?.display_id
    const display = displays.find(d => d.id === effectiveDisplayId)
    const view = pickView(schema, display)
    return { schema, display, view, ViewComp: view.component }
  }, [hasExperiment, expSchemaId, expDisplayId, schemas, displays])

  // 把 ViewComp 的 JSX 节点 memo 住：Collapsible 之类状态 toggle 时 experiment/schemas/displays/results 都没变，
  // React 拿缓存的 element 引用直接复用，跳过 104 个 result item 的 diff（层级下的虚拟 DOM 树可能是 2K+ 节点）。
  const resultsNode = useMemo(() => {
    if (!viewBundle || !viewBundle.schema || results.length === 0) return null
    const { ViewComp, schema } = viewBundle
    const onAnnotationSaved = rubric ? () => fetchAnnotations(rubric.id) : undefined
    return (
      <ViewComp
        results={results}
        schema={schema}
        experimentId={id}
        rubric={rubric}
        annotationByTask={annotationByTask}
        {...(onAnnotationSaved ? { onAnnotationSaved } : {})}
      />
    )
  }, [viewBundle, results, id, rubric, annotationByTask, fetchAnnotations])

  if (!experiment) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>

  const schema = viewBundle?.schema

  const stats = experiment.run_stats || progress
  const progressPct = stats && stats.total_tasks > 0
    ? Math.round((stats.completed_tasks / stats.total_tasks) * 100) : 0
  // Sample experiments / 旧数据可能缺 run_stats —— 从 results.jsonl 兜底，让状态胶囊 hover 也能出详情
  const progressInfo: ProgressInfo | null = stats
    ? { completed: stats.completed_tasks, total: stats.total_tasks, failed: stats.failed_tasks }
    : results.length > 0
      ? (() => {
          const failed = results.filter(r => r.status !== "success").length
          return { completed: results.length - failed, total: results.length, failed }
        })()
      : null
  const statusInfo = computeStatusInfo({
    experimentStatus: experiment.status,
    failedCount: progressInfo?.failed ?? 0,
    hasRubric: !!rubric,
    annotatedCount: aggregate?.annotated_tasks ?? 0,
    evalTotal: (aggregate?.total_tasks || results.length),
    t,
  })

  return (
    <div className="px-6 py-4">
      <GlassRegular
        className="p-6"
        data-copilot-context="experiment"
        data-copilot-context-id={experiment.id}
        data-copilot-context-summary={`${experiment.name} · ${experiment.model}`}
      >
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-xs shrink-0">&larr; {t("common.back")}</Link>
          <h2 className="text-lg font-semibold tracking-tight min-w-0 truncate">{experiment.name}</h2>
          {schema && <Badge variant="outline" className="text-[11px] shrink-0">{schema.label}</Badge>}
          <ExperimentStatusBadge
            statusInfo={statusInfo}
            progressInfo={progressInfo}
            statsAgg={statsAgg}
            rubric={rubric}
            t={t}
          />
          <div className="flex gap-2 shrink-0">
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
            {compareHref ? (
              <Link href={compareHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("experiment.compare_btn", { n: comparableExperiments.length })}
              </Link>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled
                title={t("experiment.compare_btn_empty_tooltip")}
              >
                {t("experiment.compare_btn_label_empty")}
              </Button>
            )}
          </div>
        </div>
        {experiment.status === "running" && stats && stats.total_tasks > 0 && (
          <Progress value={progressPct} className="h-1.5 mb-4" />
        )}

      <Collapsible open={configOpen} onOpenChange={(v) => startTransition(() => setConfigOpen(v))}>
        <CollapsibleTrigger className="mb-2 text-muted-foreground text-sm hover:text-foreground transition-colors cursor-pointer px-2 py-1 rounded hover:bg-accent">
          {configOpen ? "▾" : "▸"} {t("experiment.detail.config_title")} &middot; {experiment.model} / t={experiment.temperature}
        </CollapsibleTrigger>
        <CollapsibleContent style={{ contain: "layout paint" }}>
          <GlassCard className="mb-4">
            <CardContent className="pt-4">
              <ExperimentPromptPreview
                template={experiment.prompt_template}
                {...(experiment.notes !== undefined ? { notes: experiment.notes } : {})}
                notesLabel={t("experiment.detail.notes")}
              />
            </CardContent>
          </GlassCard>
        </CollapsibleContent>
      </Collapsible>

      {rubric && aggregate && (
        <Collapsible open={scoringOpen} onOpenChange={(v) => startTransition(() => setScoringOpen(v))} style={{ contain: "layout paint" }}>
          <GlassSuccess
            className="mb-6 border-emerald-400/70 bg-emerald-50/50 dark:border-emerald-700/60 dark:bg-emerald-950/20 py-3 gap-2"
            data-copilot-context="rubric_stats"
            data-copilot-context-id={experiment.id}
            data-copilot-context-extra={JSON.stringify({ rubric_id: rubric.id })}
            data-copilot-context-summary={`${rubric.name} 评分统计`}
          >
            <CardContent>
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
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
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
              </CollapsibleContent>
            </CardContent>
          </GlassSuccess>
        </Collapsible>
      )}

      {experiment.rubric_id && !rubric && (
        <div className="mb-6 p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
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
      <GlassDanger className="mb-6 border-red-400/70 bg-red-50/50 dark:border-red-700/60 dark:bg-red-950/20">
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

type ProgressInfo = { completed: number; total: number; failed: number }
