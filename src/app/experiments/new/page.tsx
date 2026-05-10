"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterRenderer } from "@/components/filter-renderer"
import { useT } from "@/lib/i18n/provider"
import type { TaskSchema, FilterValues, DatasetDef, Rubric } from "@/lib/schema/types"
import type { LlmConfig, ModelConfig } from "@/lib/llm-config"
import { GlassRegular } from "@/components/copilot/shell"
import { GlassSegmentedItem } from "@/components/copilot/glass-segmented"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"

const TASK_COUNT_CONFIRM_THRESHOLD = 5_000
const TASK_COUNT_HARD_CAP = 100_000

export default function NewExperiment() {
  const router = useRouter()
  const t = useT()
  const [submitting, setSubmitting] = useState(false)

  // Schema registry
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [schemaId, setSchemaId] = useState<string>("")
  const schema = useMemo(() => schemas.find(s => s.id === schemaId), [schemas, schemaId])

  // Datasets registry (for 数据源切换)
  const [datasets, setDatasets] = useState<DatasetDef[]>([])
  const [datasetBindings, setDatasetBindings] = useState<Record<string, string>>({})

  // LLM models
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelId, setModelId] = useState<string>("")
  const selectedModel = useMemo(() => models.find(m => m.id === modelId), [models, modelId])

  // Rubrics
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [rubricId, setRubricId] = useState<string>("")

  // Form fields
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [model, setModel] = useState("")
  const [temperature, setTemperature] = useState(1)
  const [maxTokens, setMaxTokens] = useState(4096)
  // Seed: optional reproducibility hint forwarded to OpenAI-format providers
  // (Anthropic ignores it). Empty string = "user did not set" → omit from request.
  const [seed, setSeed] = useState<string>("")
  const [promptTemplate, setPromptTemplate] = useState("")
  const [filterValues, setFilterValues] = useState<FilterValues>({})

  const [estimatedTasks, setEstimatedTasks] = useState<number | null>(null)

  // Load schemas + datasets + llm-config
  useEffect(() => {
    fetch("/api/schemas").then(r => r.json()).then((s: TaskSchema[]) => {
      setSchemas(s)
      if (s.length && !schemaId) setSchemaId(s[0]!.id)
    })
    fetch("/api/datasets").then(r => r.json()).then(setDatasets)
    fetch("/api/rubrics").then(r => r.json()).then(setRubrics).catch(() => {})
    fetch("/api/llm-config").then(r => r.json()).then((c: LlmConfig) => {
      setModels(c.models || [])
      const initial = c.active_model_id ?? c.models?.[0]?.id ?? ""
      setModelId(initial)
    })
  }, [schemaId])

  // When schema changes: reset prompt, filter values, bindings
  useEffect(() => {
    if (!schema) return
    setPromptTemplate(schema.default_prompt)
    setFilterValues(initFilterValues(schema))
    setDatasetBindings(Object.fromEntries(schema.inputs.map(i => [i.alias, i.dataset_id])))
  }, [schemaId, schema])

  // When selected model changes: prefill model / temp / max_tokens from the entry
  useEffect(() => {
    if (!selectedModel) return
    setModel(selectedModel.model || "")
    setTemperature(selectedModel.default_temperature ?? 1)
    setMaxTokens(selectedModel.default_max_tokens ?? 4096)
  }, [modelId, selectedModel])

  // Estimate task count whenever config changes
  useEffect(() => {
    if (!schema) return
    setEstimatedTasks(null)
    fetch("/api/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema_id: schema.id,
        filter_values: filterValues,
        dataset_bindings: datasetBindings,
      }),
    })
      .then(r => r.json())
      .then(d => setEstimatedTasks(d.task_count ?? 0))
      .catch(() => setEstimatedTasks(null))
  }, [schema, filterValues, datasetBindings])

  useRegisterPageContext(() => ({
    route_type: 'experiment_new',
    path: '/experiments/new',
    summary: {
      template_id: schemaId || null,
      dataset_ids: Object.values(datasetBindings),
      model_id: modelId || null,
      rubric_id: rubricId || null,
      estimated_tasks: estimatedTasks,
    },
    timestamp: new Date().toISOString(),
  }), [schemaId, datasetBindings, modelId, rubricId, estimatedTasks])

  const handleSubmit = async (andRun: boolean) => {
    if (!name.trim()) { alert(t("experiment.new.name_required")); return }
    if (!schema) return
    if (!selectedModel) { alert(t("experiment.new.model_none")); return }
    if (estimatedTasks !== null) {
      if (estimatedTasks > TASK_COUNT_HARD_CAP) {
        alert(t("experiment.new.task_count_over_cap", {
          n: estimatedTasks.toLocaleString(),
          cap: TASK_COUNT_HARD_CAP.toLocaleString(),
        }))
        return
      }
      if (estimatedTasks > TASK_COUNT_CONFIRM_THRESHOLD) {
        const ok = confirm(t("experiment.new.task_count_large_confirm", {
          n: estimatedTasks.toLocaleString(),
        }))
        if (!ok) return
      }
    }
    const seedTrimmed = seed.trim()
    const seedNum = seedTrimmed === "" ? undefined : Number(seedTrimmed)
    if (seedNum !== undefined && !Number.isFinite(seedNum)) {
      alert(t("experiment.new.seed_invalid"))
      return
    }
    setSubmitting(true)

    const res = await fetch("/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        schema_id: schema.id,
        filter_values: filterValues,
        dataset_bindings: datasetBindings,
        model_id: selectedModel.id,
        rubric_id: rubricId || undefined,
        model,
        temperature,
        max_tokens: maxTokens,
        ...(seedNum !== undefined ? { seed: seedNum } : {}),
        prompt_template: promptTemplate,
        notes: notes.trim() || undefined,
      }),
    })
    const created = await res.json()
    setSubmitting(false)

    if (andRun) {
      await fetch(`/api/experiments/${created.id}/run`, { method: "POST" })
    }
    router.push(`/experiments/${created.id}`)
  }

  return (
    <div className="px-8 py-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold tracking-tight mb-8">{t("experiment.new_title")}</h2>
      <GlassRegular className="p-6 space-y-0">

      {/* Basic info */}
      <section className="space-y-4 mb-8">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("experiment.new.basic_info")}</h3>
        <div className="space-y-1.5">
          <Label>{t("experiment.name")}</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("experiment.new.name_placeholder_full")} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("experiment.new.task")}</Label>
          <div className="grid grid-cols-2 gap-2">
            {schemas.map(s => {
              const isActive = schemaId === s.id
              return (
              <GlassSegmentedItem
                key={s.id}
                active={isActive}
                className="p-3 text-left"
                render={<button type="button" onClick={() => setSchemaId(s.id)} />}
              >
                <div className="font-medium text-sm">{s.label}</div>
                {s.description && <div className="text-xs text-muted-foreground mt-1">{s.description}</div>}
              </GlassSegmentedItem>
              )
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("experiment.new.notes")}</Label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("experiment.new.notes_placeholder")} />
        </div>
      </section>

      <Separator className="mb-8" />

      {/* Model config */}
      <section className="space-y-4 mb-8">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("experiment.new.model_config")}</h3>
        {models.length === 0 ? (
          <div className="p-3 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800">
            {t("experiment.new.model_none")} · <Link href="/settings/llm" className="underline">/settings/llm</Link>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>{t("experiment.new.model_pick")}</Label>
            <Select value={modelId} onValueChange={v => { if (v) setModelId(v) }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.model || m.id}
                    <span className="text-muted-foreground ml-2 text-xs">{m.model || "—"} · {m.api_format}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-[1fr_1fr] gap-4">
          <div className="space-y-1.5">
            <Label>{t("experiment.new.model")}</Label>
            <Input value={model} onChange={e => setModel(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("experiment.new.max_tokens")}</Label>
            <Input type="number" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value) || 4096)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t("experiment.new.temperature", { value: temperature })}</Label>
          <Slider
            value={[temperature]}
            onValueChange={v => setTemperature(Array.isArray(v) ? v[0] : v)}
            min={0} max={2} step={0.1}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("experiment.new.seed_label")}</Label>
          <Input
            type="number"
            value={seed}
            onChange={e => setSeed(e.target.value)}
            placeholder={t("experiment.new.seed_placeholder")}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{t("experiment.new.seed_hint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("experiment.new.rubric_label")}</Label>
          <Select value={rubricId || "__none__"} onValueChange={v => setRubricId(!v || v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("experiment.new.rubric_none")}</SelectItem>
              {rubrics.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  <span className="text-muted-foreground ml-2 text-xs">{r.criteria.length} criteria</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t("experiment.new.rubric_hint")}</p>
        </div>
      </section>

      <Separator className="mb-8" />

      {/* Prompt */}
      <section className="space-y-3 mb-8">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("experiment.new.prompt_template")}</h3>
        <Textarea
          value={promptTemplate}
          onChange={e => setPromptTemplate(e.target.value)}
          className="font-mono text-xs min-h-[300px]"
        />
        {schema && (
          <p className="text-xs text-muted-foreground">
            {t("experiment.new.available_vars", { vars: schema.variables.map(v => `{{${v.name}}}`).join("、") })}
          </p>
        )}
      </section>

      <Separator className="mb-8" />

      {/* Scope — schema-driven */}
      <section className="space-y-5 mb-8">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("experiment.new.scope_filter")}</h3>
        {schema?.inputs.map(input => (
          <div key={input.alias} className="space-y-3 pl-3 border-l-2 border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{input.alias}</span>
              <Select
                value={datasetBindings[input.alias] ?? input.dataset_id}
                onValueChange={v => { if (v) setDatasetBindings(b => ({ ...b, [input.alias]: v })) }}
              >
                <SelectTrigger className="h-7 text-xs w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map(ds => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name} <span className="text-muted-foreground">({ds.source})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {input.dedupe_by && (
                <span className="text-[11px] text-muted-foreground">{t("experiment.new.dedupe_by", { fields: input.dedupe_by.join(",") })}</span>
              )}
              {input.hard_filter && (
                <span className="text-[11px] text-muted-foreground">{t("experiment.new.hard_filter", { field: String(input.hard_filter.field), value: String(input.hard_filter.equals) })}</span>
              )}
            </div>
            {input.filters?.map(f => (
              <FilterRenderer
                key={f.key}
                filter={f}
                value={filterValues[f.key]}
                onChange={v => setFilterValues(fv => ({ ...fv, [f.key]: v }))}
              />
            ))}
          </div>
        ))}
        <div className="pt-1 text-sm text-muted-foreground">
          {estimatedTasks === null ? t("experiment.new.calculating") : t("experiment.new.estimated", { n: estimatedTasks.toLocaleString() })}
        </div>
      </section>

      <Separator className="mb-6" />
      <div className="flex gap-3 pb-8">
        <Button variant="outline" onClick={() => handleSubmit(false)} disabled={submitting}>{t("experiment.new.save_draft")}</Button>
        <Button variant="tinted" onClick={() => handleSubmit(true)} disabled={submitting}>
          {submitting ? t("experiment.new.submitting") : t("experiment.new.save_run")}
        </Button>
      </div>
      </GlassRegular>
    </div>
  )
}

function initFilterValues(schema: TaskSchema): FilterValues {
  const v: FilterValues = {}
  for (const input of schema.inputs) {
    for (const f of input.filters ?? []) {
      if ("defaultValue" in f && f.defaultValue !== undefined) {
        v[f.key] = f.defaultValue
      }
    }
  }
  return v
}
