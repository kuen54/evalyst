"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgentHintBanner } from "@/components/settings/agent-hint-banner"
import { GlassCard } from "@/components/glass/shell"
import { ExperimentStatusBadge, type StatsAgg, type ProgressInfo } from "@/components/experiment-status-badge"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"
import { useT, useLocale } from "@/lib/i18n/provider"
import { formatDate } from "@/lib/i18n/format"
import { formatCostMap } from "@/lib/format"
import { computeStatusInfo } from "@/lib/experiment-status"
import type { ExperimentConfig } from "@/lib/types"
import type { TaskSchema, Rubric } from "@/lib/schema/types"

/** rubric_id 实验的标注覆盖摘要——用于 dashboard 状态胶囊推算评分阶段 */
type AnnotationSummary = { annotated: number; total: number }

export default function Dashboard() {
  const t = useT()
  const { locale } = useLocale()
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaFilter, setSchemaFilter] = useState<string | undefined>(undefined)
  /** rubric_id 实验 → 标注覆盖摘要。dashboard 推算评分阶段用。 */
  const [annotationSummaries, setAnnotationSummaries] = useState<Record<string, AnnotationSummary>>({})

  const fetchExperiments = () => {
    fetch("/api/experiments")
      .then(r => r.json())
      .then(setExperiments)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // rubric experiments 列表的稳定 key —— 内容（id + rubric_id + updated_at）变了再触发 aggregate fetch
  const rubricExpsKey = useMemo(
    () => experiments
      .filter(e => !!e.rubric_id)
      .map(e => `${e.id}:${e.rubric_id}:${e.updated_at}`)
      .join("|"),
    [experiments],
  )

  const fetchAnnotationSummaries = useCallback(async (exps: ExperimentConfig[]) => {
    const targets = exps.filter(e => !!e.rubric_id)
    if (targets.length === 0) return
    const entries = await Promise.all(
      targets.map(async e => {
        try {
          const r = await fetch(`/api/experiments/${e.id}/annotations?rubric_id=${e.rubric_id}`)
          if (!r.ok) return [e.id, null] as const
          const data = await r.json() as { aggregate: { annotated_tasks: number; total_tasks: number } | null }
          const agg = data.aggregate
          if (!agg) return [e.id, null] as const
          // sample/老 fixture 里 aggregate.total_tasks 可能为 0；用 run_stats / annotated_tasks 兜底
          const total = agg.total_tasks || e.run_stats?.total_tasks || agg.annotated_tasks
          return [e.id, { annotated: agg.annotated_tasks, total }] as const
        } catch {
          return [e.id, null] as const
        }
      }),
    )
    setAnnotationSummaries(prev => {
      const next = { ...prev }
      for (const [id, summary] of entries) {
        if (summary) next[id] = summary
        else delete next[id]
      }
      return next
    })
  }, [])

  useEffect(() => {
    fetchExperiments()
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
    fetch("/api/rubrics").then(r => r.json()).then((list: Rubric[]) => Array.isArray(list) && setRubrics(list)).catch(() => {})
    const interval = setInterval(fetchExperiments, 5000)
    return () => clearInterval(interval)
  }, [])

  // rubric 实验列表变化时拉 aggregate（rubricExpsKey 用 updated_at 触发，不会每 5s 重拉）
  useEffect(() => {
    if (experiments.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch seeds aggregate state inside Promise.then
    fetchAnnotationSummaries(experiments)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rubricExpsKey 已经是 experiments 的稳定派生 key
  }, [rubricExpsKey, fetchAnnotationSummaries])

  const handleDelete = async (id: string) => {
    if (!confirm(t("dashboard.delete_experiment_confirm"))) return
    await fetch(`/api/experiments/${id}`, { method: "DELETE" })
    fetchExperiments()
  }

  const schemaById = Object.fromEntries(schemas.map(s => [s.id, s]))
  const rubricById = useMemo(() => Object.fromEntries(rubrics.map(r => [r.id, r])), [rubrics])

  const filtered = useMemo(() => {
    if (!schemaFilter) return experiments
    return experiments.filter(e => e.schema_id === schemaFilter)
  }, [experiments, schemaFilter])

  useRegisterPageContext(() => ({
    route_type: 'dashboard',
    path: '/',
    summary: {
      experiments_total: experiments.length,
      counts: { schemas: schemas.length },
      recent: experiments.slice(0, 5).map(e => ({
        id: e.id,
        name: e.name,
        status: e.status,
        success: e.run_stats?.completed_tasks ?? 0,
        failed: e.run_stats?.failed_tasks ?? 0,
        created_at: e.created_at,
      })),
    },
    timestamp: new Date().toISOString(),
  }), [experiments, schemas])

  if (loading) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>

  return (
    <div className="px-8 py-6">
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="text-lg font-semibold tracking-tight">{t("dashboard.title")}</h2>
        <div className="flex items-center gap-2">
          <Select value={schemaFilter} onValueChange={v => setSchemaFilter(v ?? undefined)}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder={t("dashboard.filter_by_schema")} />
            </SelectTrigger>
            <SelectContent>
              {schemas.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {schemaFilter && (
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setSchemaFilter(undefined)}
            >{t("common.clear")}</button>
          )}
          <Link href="/experiments/new">
            <Button size="sm" variant="tinted">{t("dashboard.new_btn")}</Button>
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div>
          {!schemaFilter && (
            <div className="max-w-2xl mx-auto mb-8 mt-4">
              <AgentHintBanner
                slashCommand="evalyst"
                title={t("app.agent_hint_title")}
                bodyPrefix={t("app.agent_hint_body_prefix")}
                bodySuffix={t("app.agent_hint_body_suffix")}
              />
            </div>
          )}
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-base mb-1.5">{schemaFilter ? t("dashboard.empty_filtered") : t("dashboard.empty_all")}</p>
            <p className="text-sm mb-5">{schemaFilter ? t("dashboard.empty_filtered_hint") : t("dashboard.empty_all_hint")}</p>
            {!schemaFilter && (
              <Link href="/experiments/new">
                <Button size="sm" variant="outline">{t("dashboard.new_btn")}</Button>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {filtered.map(exp => (
            <ExperimentCard
              key={exp.id}
              experiment={exp}
              schemaLabel={schemaById[exp.schema_id ?? ""]?.label ?? exp.schema_id ?? t("common.unknown")}
              rubric={exp.rubric_id ? (rubricById[exp.rubric_id] ?? null) : null}
              annotationSummary={annotationSummaries[exp.id] ?? null}
              onDelete={handleDelete}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExperimentCard({ experiment: exp, schemaLabel, rubric, annotationSummary, onDelete, locale, t }: {
  experiment: ExperimentConfig
  schemaLabel: string
  rubric: Rubric | null
  annotationSummary: AnnotationSummary | null
  onDelete: (id: string) => void
  locale: "zh" | "en"
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const progress = exp.run_stats
    ? Math.round((exp.run_stats.completed_tasks / exp.run_stats.total_tasks) * 100)
    : 0
  const isRunning = exp.status === "running"
  const statusInfo = computeStatusInfo({
    experimentStatus: exp.status,
    failedCount: exp.run_stats?.failed_tasks ?? 0,
    hasRubric: !!exp.rubric_id,
    annotatedCount: annotationSummary?.annotated ?? 0,
    evalTotal: annotationSummary?.total ?? 0,
    t,
  })
  const progressInfo: ProgressInfo | null = exp.run_stats
    ? { completed: exp.run_stats.completed_tasks, total: exp.run_stats.total_tasks, failed: exp.run_stats.failed_tasks }
    : null
  const statsAgg: StatsAgg = {
    total_input_tokens: exp.run_stats?.total_input_tokens,
    total_output_tokens: exp.run_stats?.total_output_tokens,
    total_cost_by_currency: exp.run_stats?.total_cost_by_currency ?? {},
    has_token_data: exp.run_stats?.total_input_tokens != null,
    has_cost_data: !!exp.run_stats?.total_cost_by_currency && Object.keys(exp.run_stats.total_cost_by_currency).length > 0,
  }

  return (
    <GlassCard
      data-copilot-context="experiment"
      data-copilot-context-id={exp.id}
      data-copilot-context-summary={`${exp.name} · ${exp.model}`}
      className="group transition-colors hover:border-foreground/30 h-full"
    >
      <CardHeader className="pb-1.5 pt-4 px-4">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <CardTitle className="text-sm font-medium leading-snug truncate min-w-0 flex-1" title={exp.name}>{exp.name}</CardTitle>
          <ExperimentStatusBadge
            statusInfo={statusInfo}
            progressInfo={progressInfo}
            statsAgg={statsAgg}
            rubric={rubric}
            t={t}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 min-w-0">
          <span className="truncate min-w-0" title={exp.model}>{exp.model}</span>
          <span className="text-border shrink-0">|</span>
          <span className="shrink-0">t={exp.temperature}</span>
          <span className="ml-auto shrink-0">{formatDate(exp.created_at, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </CardHeader>
      <CardContent className="pb-3 px-4 pt-0 space-y-2">
        <div className="flex items-center gap-2 text-[12px] min-w-0">
          <span className="text-muted-foreground truncate min-w-0" title={schemaLabel}>
            {t("dashboard.schema_label", { label: schemaLabel })}
          </span>
          {exp.run_stats && (
            <span className="text-muted-foreground text-[11px] shrink-0 ml-auto">
              {exp.run_stats.completed_tasks}/{exp.run_stats.total_tasks}
            </span>
          )}
          {exp.run_stats && exp.run_stats.total_cost_by_currency && Object.keys(exp.run_stats.total_cost_by_currency).length > 0 && (
            <span className="text-[11px] font-medium text-foreground shrink-0">
              {formatCostMap(exp.run_stats.total_cost_by_currency)}
            </span>
          )}
        </div>
        {isRunning && exp.run_stats && <Progress value={progress} className="h-1" />}
        <div className="flex items-center gap-1.5 pt-0.5">
          <Link href={`/experiments/${exp.id}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs">{t("common.view")}</Button>
          </Link>
          <button className="text-[11px] text-muted-foreground hover:text-red-500 ml-auto cursor-pointer px-1.5 py-1 -my-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" onClick={() => onDelete(exp.id)}>
            {t("common.delete")}
          </button>
        </div>
      </CardContent>
    </GlassCard>
  )
}
