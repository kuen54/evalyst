"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { RequiredMark } from "@/components/ui/field-label"
import { StickySaveBar } from "@/components/ui/sticky-save-bar"
import { useGlassStyle, GlassRegular } from "@/components/copilot/shell"
import { useCopilotStore } from "@/components/copilot/store"
import { segmentedItem } from "@/lib/segmented"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { DisplayColumn, DisplayMode, Display, TaskSchema, GenericResultRecord } from "@/lib/schema/types"
import { pickView } from "@/components/results/registry"
import { TableModeForm, GroupedGridModeForm, JsxModeForm } from "./display-form-modes"

interface GroupConfig {
  field: string
  label: string
}

export interface FormState {
  id: string
  name: string
  description: string
  mode: Exclude<DisplayMode, "builtin">
  // table
  table_columns: DisplayColumn[]
  // grouped_grid
  primary_group: GroupConfig
  secondary_group: GroupConfig
  cell_columns: DisplayColumn[]
  // jsx
  jsx_source: string
}

function emptyState(): FormState {
  return {
    id: "",
    name: "",
    description: "",
    mode: "table",
    table_columns: [{ field: "", label: "", type: "text" }],
    primary_group: { field: "", label: "" },
    secondary_group: { field: "", label: "" },
    cell_columns: [{ field: "", label: "", type: "text" }],
    jsx_source: `function ({ result, schema, helpers }) {
  return <div>{helpers.renderField(result.output?.copy, "text")}</div>
}`,
  }
}

export function DisplayFormPage() {
  const t = useT()
  const [form, setForm] = useState<FormState>(emptyState)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])
  const { open: copilotOpen } = useCopilotStore()
  const thinStyle = useGlassStyle("thin")
  const tintedStyle = useGlassStyle("tinted")

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const tableDup = useMemo(() => findDuplicates(form.table_columns.map(c => c.field)), [form.table_columns])
  const cellDup = useMemo(() => findDuplicates(form.cell_columns.map(c => c.field)), [form.cell_columns])

  const handleSubmit = async () => {
    const errs: Array<{ field: string; message: string }> = []
    if (!form.id) errs.push({ field: "id", message: t("settings.datasets.form.required") })
    else if (!/^[a-z][a-z0-9_]*$/.test(form.id)) errs.push({ field: "id", message: t("settings.datasets.form.id_validation") })
    if (!form.name) errs.push({ field: "name", message: t("settings.datasets.form.required") })

    const body: Record<string, unknown> = {
      id: form.id,
      name: form.name,
      description: form.description || undefined,
      mode: form.mode,
    }

    if (form.mode === "table") {
      const cols = form.table_columns.filter(c => c.field)
      if (cols.length === 0) errs.push({ field: "table.columns", message: t("new_res.at_least_one_column") })
      body.table = { columns: cols }
    } else if (form.mode === "grouped_grid") {
      if (!form.primary_group.field) errs.push({ field: "primary_group.field", message: t("settings.datasets.form.required") })
      if (!form.secondary_group.field) errs.push({ field: "secondary_group.field", message: t("settings.datasets.form.required") })
      const cells = form.cell_columns.filter(c => c.field)
      if (cells.length === 0) errs.push({ field: "cell_columns", message: t("new_res.at_least_one_column") })
      body.grouped_grid = {
        primary_group: { field: form.primary_group.field, label: form.primary_group.label || undefined },
        secondary_group: { field: form.secondary_group.field, label: form.secondary_group.label || undefined },
        cell_columns: cells,
      }
    } else if (form.mode === "jsx") {
      if (!form.jsx_source.trim()) errs.push({ field: "jsx.source", message: t("settings.datasets.form.required") })
      body.jsx = { source: form.jsx_source }
    }

    if (errs.length) {
      setErrors(errs)
      toast.error(t("settings.displays.form.errors_toast", { n: errs.length }))
      return
    }
    setErrors([])
    setSubmitting(true)

    const res = await fetch("/api/displays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      setErrors(data.errors ?? [{ field: "$", message: data.error ?? t("settings.displays.form.save_fail_default") }])
      toast.error(data.error ?? t("settings.displays.form.save_fail_default"))
      setSubmitting(false)
      return
    }
    toast.success(t("settings.displays.form.created_toast", { name: form.name }))
    window.location.href = "/settings/displays"
  }

  return (
    <div className="grid grid-cols-[1fr_420px] gap-6">
      <div className="space-y-6 pb-12">
      <section className="space-y-3">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.section_basic")}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("common.id")}<RequiredMark /></Label>
            <Input value={form.id} onChange={e => set("id", e.target.value)} placeholder={t("settings.displays.form.id_placeholder")} />
            <p className="text-[11px] text-muted-foreground">{t("settings.datasets.form.id_format_hint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.displays.form.display_name")}<RequiredMark /></Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder={t("settings.displays.form.display_name_placeholder")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("settings.datasets.form.dataset_description")}</Label>
          <Input value={form.description} onChange={e => set("description", e.target.value)} />
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.mode_section")}<RequiredMark /></h4>
        <div className="grid grid-cols-3 gap-2">
          {(["table", "grouped_grid", "jsx"] as const).map(m => {
            const isActive = form.mode === m
            return (
            <button
              key={m}
              type="button"
              onClick={() => set("mode", m)}
              className={`p-3 rounded-md border text-left transition-colors ${segmentedItem(isActive, copilotOpen)}`}
              style={copilotOpen ? (isActive ? tintedStyle : thinStyle) : undefined}
              data-glass-variant={copilotOpen ? (isActive ? "tinted" : "thin") : undefined}
            >
              <div className="font-medium text-sm">
                {m === "table" ? t("settings.displays.form.mode_table_btn") : m === "grouped_grid" ? t("settings.displays.form.mode_grouped_grid_btn") : t("settings.displays.form.mode_jsx_btn")}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {m === "table"
                  ? t("settings.displays.form.mode_table_desc")
                  : m === "grouped_grid"
                  ? t("settings.displays.form.mode_grouped_grid_desc")
                  : t("settings.displays.form.mode_jsx_desc")}
              </div>
            </button>
            )
          })}
        </div>
      </section>

      <Separator />

      {form.mode === "table" && (
        <TableModeForm form={form} set={set} tableDup={tableDup} t={t} />
      )}

      {form.mode === "grouped_grid" && (
        <GroupedGridModeForm form={form} set={set} cellDup={cellDup} t={t} />
      )}

      {form.mode === "jsx" && (
        <JsxModeForm form={form} set={set} t={t} />
      )}

      {errors.length > 0 && (
        <div className="p-3 rounded border border-destructive/40 bg-destructive/10 text-sm">
          <div className="font-medium text-destructive mb-1">{t("settings.datasets.form.validation_failed_header", { n: errors.length })}</div>
          <ul className="text-xs space-y-0.5 text-destructive/90 max-h-40 overflow-y-auto">
            {errors.map((e, i) => <li key={i}><span className="font-mono">{e.field}</span>: {e.message}</li>)}
          </ul>
        </div>
      )}

      <StickySaveBar
        onSave={handleSubmit}
        onCancel={() => (window.location.href = "/settings/displays")}
        submitting={submitting}
      />
      </div>

      <DisplayPreviewPane form={form} t={t} />
    </div>
  )
}

function DisplayPreviewPane({ form, t }: { form: FormState; t: TFn }) {
  const { display, schema, results } = useMemo(() => buildPreviewInputs(form, t), [form, t])

  const view = useMemo(() => {
    try {
      return pickView(schema, display)
    } catch {
      return null
    }
  }, [schema, display])

  const ViewComp = view?.component

  return (
    <div className="sticky top-6 max-h-[calc(100vh-140px)] overflow-y-auto">
      <GlassRegular className="p-3 space-y-2 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden">
        <div className="flex items-center gap-2">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.preview_title")}</h4>
          <Badge variant="outline" className="text-[10px]">{t("settings.displays.form.preview_mock")}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("settings.displays.form.preview_desc")}
        </p>
        <div className="border rounded p-2 bg-muted/10 overflow-x-auto">
          {ViewComp && schema ? (
            <div className="min-w-0">
              <ViewComp results={results} schema={schema} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic p-2">{t("settings.displays.form.preview_empty")}</p>
          )}
        </div>
      </GlassRegular>
    </div>
  )
}

function buildPreviewInputs(form: FormState, t: TFn): {
  display: Display | undefined
  schema: TaskSchema | undefined
  results: GenericResultRecord[]
} {
  // 从列配置里推 output_schema 字段
  const cols = form.mode === "table" ? form.table_columns : form.mode === "grouped_grid" ? form.cell_columns : []
  const outputFieldNames = cols
    .map(c => {
      const m = c.field.match(/^output\.(.+)$/)
      return m ? m[1] : null
    })
    .filter((x): x is string => !!x)

  // 构造最简 TaskSchema
  const schema: TaskSchema = {
    id: "__preview__",
    label: "preview",
    version: 1,
    inputs: [
      { alias: "qa", dataset_id: "__stub__" },
      { alias: "topic", dataset_id: "__stub__" },
    ],
    variables: [],
    default_prompt: "",
    message_builder: {},
    output_schema: {
      type: "object",
      properties: Object.fromEntries(
        outputFieldNames.length > 0
          ? outputFieldNames.map(n => [n, { type: "string" as const }])
          : [["copy", { type: "string" as const }]]
      ),
      required: outputFieldNames.length > 0 ? outputFieldNames : ["copy"],
    },
    display_dimensions:
      form.mode === "grouped_grid"
        ? [
            { field: form.primary_group.field || "input_refs.qa", label: form.primary_group.label || t("settings.displays.form.primary_default_label") },
            { field: form.secondary_group.field || "input_preview.qa.topic", label: form.secondary_group.label || t("settings.displays.form.secondary_default_label") },
          ]
        : undefined,
  }

  // 构造 Display
  let display: Display | undefined
  if (form.mode === "table") {
    const cols = form.table_columns.filter(c => c.field)
    if (cols.length > 0) {
      display = {
        id: "__preview__",
        name: "preview",
        source: "user",
        mode: "table",
        table: { columns: cols },
      }
    }
  } else if (form.mode === "grouped_grid") {
    const cells = form.cell_columns.filter(c => c.field)
    if (form.primary_group.field && form.secondary_group.field && cells.length > 0) {
      display = {
        id: "__preview__",
        name: "preview",
        source: "user",
        mode: "grouped_grid",
        grouped_grid: {
          primary_group: { field: form.primary_group.field, label: form.primary_group.label || undefined },
          secondary_group: { field: form.secondary_group.field, label: form.secondary_group.label || undefined },
          cell_columns: cells,
        },
      }
    }
  } else if (form.mode === "jsx") {
    if (form.jsx_source.trim()) {
      display = {
        id: "__preview__",
        name: "preview",
        source: "user",
        mode: "jsx",
        jsx: { source: form.jsx_source },
      }
    }
  }

  // 构造 3 条 mock 记录
  const stubItems = ["q1", "q2", "q3"]
  const stubTopics = ["geography", "science", "history"]
  const results: GenericResultRecord[] = stubItems.flatMap((b, i) =>
    form.mode === "grouped_grid"
      ? stubTopics.map(u => mockRecord(schema, `${b}_${u}`, { qa: b, topic: u }, t))
      : [mockRecord(schema, `t_${i}`, { qa: b, topic: stubTopics[i % stubTopics.length] }, t)]
  )

  return { display, schema, results }
}

function mockRecord(schema: TaskSchema, taskId: string, refs: { qa: string; topic: string }, t: TFn): GenericResultRecord {
  const output: Record<string, string> = {}
  for (const name of Object.keys(schema.output_schema.properties ?? {})) {
    output[name] = `mock ${name}`
  }
  return {
    schema_id: schema.id,
    schema_version: schema.version,
    task_id: taskId,
    experiment_id: "__preview__",
    input_refs: { qa: refs.qa, topic: refs.topic },
    input_preview: {
      "qa.question": t("settings.displays.form.mock_sample_question", { id: refs.qa }),
      "qa.topic": refs.topic,
      "qa.difficulty": "easy",
    },
    output,
    status: "success",
    latency_ms: 123,
    model: "mock",
    timestamp: new Date().toISOString(),
  }
}


function findDuplicates(values: string[]): Set<string> {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const v of values) {
    if (!v) continue
    if (seen.has(v)) dup.add(v)
    seen.add(v)
  }
  return dup
}
