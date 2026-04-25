"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgentHintBanner } from "@/components/settings/agent-hint-banner"
import { useT, useLocale } from "@/lib/i18n/provider"
import { formatDate } from "@/lib/i18n/format"
import { formatCostMap } from "@/lib/format"
import type { ExperimentConfig } from "@/lib/types"
import type { TaskSchema } from "@/lib/schema/types"

const SCHEMA_BADGE_COLORS: Record<string, string> = {}

const SCHEMA_COLOR_POOL = [
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-teal-50 text-teal-700 border-teal-200",
]

function colorForSchema(id: string): string {
  if (SCHEMA_BADGE_COLORS[id]) return SCHEMA_BADGE_COLORS[id]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return SCHEMA_COLOR_POOL[Math.abs(h) % SCHEMA_COLOR_POOL.length]
}

export default function Dashboard() {
  const t = useT()
  const { locale } = useLocale()
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaFilter, setSchemaFilter] = useState<string | undefined>(undefined)

  const fetchExperiments = () => {
    fetch("/api/experiments")
      .then(r => r.json())
      .then(setExperiments)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchExperiments()
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
    const interval = setInterval(fetchExperiments, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm(t("dashboard.delete_experiment_confirm"))) return
    await fetch(`/api/experiments/${id}`, { method: "DELETE" })
    fetchExperiments()
  }

  const schemaById = Object.fromEntries(schemas.map(s => [s.id, s]))

  const filtered = useMemo(() => {
    if (!schemaFilter) return experiments
    return experiments.filter(e => e.schema_id === schemaFilter)
  }, [experiments, schemaFilter])

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
            <Button size="sm">{t("dashboard.new_btn")}</Button>
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div>
          {!schemaFilter && (
            <div className="max-w-2xl mx-auto mb-8 mt-4">
              <AgentHintBanner
                slashCommand="batch-eval"
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
                <Button size="sm">{t("dashboard.new_btn")}</Button>
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
              schemaColor={colorForSchema(exp.schema_id ?? "")}
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

function ExperimentCard({ experiment: exp, schemaLabel, schemaColor, onDelete, locale, t }: {
  experiment: ExperimentConfig
  schemaLabel: string
  schemaColor?: string
  onDelete: (id: string) => void
  locale: "zh" | "en"
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const progress = exp.run_stats
    ? Math.round((exp.run_stats.completed_tasks / exp.run_stats.total_tasks) * 100)
    : 0
  const isRunning = exp.status === "running"

  return (
    <Card className="group transition-colors hover:border-foreground/30 hover:bg-muted/20 h-full">
      <CardHeader className="pb-1.5 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-snug">{exp.name}</CardTitle>
          <Badge variant="outline" className={`text-[11px] shrink-0 ${schemaColor ?? ""}`}>
            {schemaLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
          <span>{exp.model}</span>
          <span className="text-border">|</span>
          <span>t={exp.temperature}</span>
          <span className="ml-auto">{formatDate(exp.created_at, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </CardHeader>
      <CardContent className="pb-3 px-4 pt-0 space-y-2">
        <div className="flex items-center gap-1.5 text-[13px]">
          <StatusDot status={exp.status} />
          <span className="text-muted-foreground">{t(`dashboard.status_${exp.status}`)}</span>
          {exp.run_stats && (
            <span className="text-muted-foreground text-[11px]">
              {exp.run_stats.completed_tasks}/{exp.run_stats.total_tasks}
              {exp.run_stats.failed_tasks > 0 && (
                <span className="text-red-500"> ({t("dashboard.failed_count", { n: exp.run_stats.failed_tasks })})</span>
              )}
            </span>
          )}
          {exp.run_stats && exp.run_stats.total_cost_by_currency && Object.keys(exp.run_stats.total_cost_by_currency).length > 0 && (
            <span className="ml-auto text-[11px] font-medium text-foreground">
              {formatCostMap(exp.run_stats.total_cost_by_currency)}
            </span>
          )}
        </div>
        {isRunning && exp.run_stats && <Progress value={progress} className="h-1" />}
        <div className="flex items-center gap-1.5 pt-0.5">
          <Link href={`/experiments/${exp.id}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs">{t("common.view")}</Button>
          </Link>
          <button className="text-[11px] text-muted-foreground hover:text-red-500 ml-auto cursor-pointer" onClick={() => onDelete(exp.id)}>
            {t("common.delete")}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-400",
    running: "bg-blue-500 animate-pulse",
    paused: "bg-yellow-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || "bg-gray-400"}`} />
}
