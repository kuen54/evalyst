"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { RequiredMark } from "@/components/ui/field-label"
import { GlassRegular } from "@/components/copilot/shell"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { DatasetDef, Display, TaskSchema } from "@/lib/schema/types"
import { inferDisplayBuiltinId } from "@/lib/display-inference"
import { generateMockResults } from "@/lib/mock-data"
import { pickView } from "@/components/results/registry"
import { FieldPicker } from "@/components/template-builder/field-picker"
import { FiltersEditor } from "@/components/template-builder/filters-editor"
import { KeyValueEditor } from "@/components/template-builder/key-value-editor"
import { OrderListEditor } from "@/components/template-builder/order-list-editor"
import { HeaderFieldsEditor } from "@/components/template-builder/header-fields-editor"
import { TransformChainEditor } from "@/components/template-builder/transform-chain-editor"
import { MetaPromptPane } from "@/components/settings/meta-prompt-pane"
import { AgentHintBanner } from "@/components/settings/agent-hint-banner"
import { TEMPLATE_META_PROMPT } from "@/lib/meta-prompts/template"
import {
  emptyFormState,
  emptyInput,
  emptyVariable,
  emptyDimension,
  buildSchemaFromForm,
  formFromSchema,
  type TemplateFormState,
  type FormOutputField,
} from "@/components/template-builder/form-state"

const OUTPUT_TYPE_OPTIONS: FormOutputField["type"][] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "string|null",
  "tuple:number[]",
]

export type TemplateFormMode = "create" | "edit"

interface Props {
  mode: TemplateFormMode
  initialSchema?: TaskSchema
  readOnly?: boolean
  fromId?: string
}

function describeEquals(raw: string, t: TFn): string {
  const v = raw.trim()
  if (v === "") return t("settings.templates.tform.desc_empty")
  if (v === "true" || v === "false") return t("settings.templates.tform.desc_bool", { value: v })
  if (v === "null") return t("settings.templates.tform.desc_null")
  if (!isNaN(Number(v)) && v !== "") return t("settings.templates.tform.desc_number", { value: v })
  return t("settings.templates.tform.desc_string", { value: v })
}

export function TemplateFormPage({ mode, initialSchema, readOnly = false, fromId }: Props) {
  const router = useRouter()
  const t = useT()
  const [form, setForm] = useState<TemplateFormState>(() => {
    if (initialSchema) {
      const f = formFromSchema(initialSchema)
      if (fromId) f.id = ""
      return f
    }
    return emptyFormState()
  })
  const [datasets, setDatasets] = useState<DatasetDef[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [datasetSamples, setDatasetSamples] = useState<Record<string, Record<string, unknown>[]>>({})
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<"json" | "form">("form")
  const [savedForm, setSavedForm] = useState<TemplateFormState | null>(null)
  const isDirty = useMemo(() => {
    if (submitting) return false
    if (readOnly) return false
    const baseline = savedForm ?? (initialSchema && !fromId ? formFromSchema(initialSchema) : null)
    if (!baseline) {
      return !!(form.id || form.label)
    }
    return JSON.stringify(baseline) !== JSON.stringify(form)
  }, [form, savedForm, initialSchema, fromId, submitting, readOnly])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  useEffect(() => {
    fetch("/api/datasets").then(r => r.json()).then(setDatasets)
    fetch("/api/displays").then(r => r.json()).then(setDisplays)
  }, [])

  useEffect(() => {
    const needed = form.inputs.map(i => i.dataset_id).filter(Boolean)
    for (const id of needed) {
      if (datasetSamples[id]) continue
      fetch(`/api/datasets/${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.sample) {
            setDatasetSamples(prev => ({ ...prev, [id]: data.sample }))
          }
        })
        .catch(() => {})
    }
  }, [form.inputs, datasetSamples])

  const set = <K extends keyof TemplateFormState>(key: K, val: TemplateFormState[K]) =>
    setForm(f => ({ ...f, [key]: val }))

  const inferredIdForForm = useMemo(() => {
    const { schema } = buildSchemaFromForm(form)
    return schema ? inferDisplayBuiltinId(schema) : "builtin_json_default"
  }, [form])

  const handleSubmit = async () => {
    if (readOnly) return
    setErrors([])
    const { schema, errors: buildErrors } = buildSchemaFromForm(form)
    if (buildErrors.length || !schema) {
      setErrors(buildErrors)
      toast.error(t("settings.templates.tform.errors_toast", { n: buildErrors.length }))
      return
    }
    setSubmitting(true)
    const url = mode === "edit" ? `/api/schemas/${form.id}` : "/api/schemas"
    const method = mode === "edit" ? "PATCH" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schema),
    })
    const data = await res.json()
    if (!res.ok) {
      setErrors(data.errors ?? [{ field: "$", message: data.error ?? t("settings.templates.tform.save_fail_default") }])
      setSubmitting(false)
      toast.error(data.error ?? t("settings.templates.tform.save_fail_default"))
      return
    }
    toast.success(mode === "edit" ? t("settings.templates.tform.saved_edit_toast") : t("settings.templates.tform.saved_create_toast"))
    setSavedForm(form)
    router.push(`/settings/templates/${schema.id}`)
  }

  const formAndPreview = (
    <div className="grid grid-cols-[1fr_400px] gap-6" style={{ minHeight: "calc(100vh - 320px)" }}>
      <div className="space-y-6 overflow-y-auto pr-4" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <section className="space-y-3">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.section_basic")}</h4>
          {fromId && (
            <p className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
              {t("settings.templates.tform.copying_from_html", { id: fromId })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label>{t("common.id")}<RequiredMark /></Label>
            <Input
              value={form.id}
              onChange={e => set("id", e.target.value)}
              placeholder={t("settings.templates.tform.id_placeholder")}
              disabled={mode === "edit"}
              aria-invalid={!!form.id && !/^[a-z][a-z0-9_]*$/.test(form.id)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("settings.templates.tform.id_rule_hint")}
              {!!form.id && !/^[a-z][a-z0-9_]*$/.test(form.id) && (
                <span className="text-red-500 ml-2">{t("settings.templates.tform.id_bad_format")}</span>
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.templates.tform.label_label")}<RequiredMark /></Label>
            <Input value={form.label} onChange={e => set("label", e.target.value)} placeholder={t("settings.templates.tform.label_placeholder")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.datasets.form.dataset_description")}</Label>
            <Input value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.templates.tform.compare_group_label")}</Label>
            <Input value={form.compare_group} onChange={e => set("compare_group", e.target.value)} />
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.inputs_title")}</h4>
            <Button size="sm" variant="outline" onClick={() => set("inputs", [...form.inputs, emptyInput()])}>{t("settings.templates.tform.add_btn")}</Button>
          </div>
          {form.inputs.map((inp, i) => (
            <GlassRegular key={i} className="p-3 space-y-2 border border-border text-sm text-card-foreground overflow-hidden">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">#{i}</Badge>
                {form.inputs.length > 1 && (
                  <button
                    className="text-[11px] text-muted-foreground hover:text-red-500 ml-auto"
                    onClick={() => set("inputs", form.inputs.filter((_, j) => j !== i))}
                  >{t("common.delete")}</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Alias</Label>
                  <Input value={inp.alias} onChange={e => updateItem(form, set, "inputs", i, { alias: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Dataset</Label>
                  <Select value={inp.dataset_id} onValueChange={v => { if (v) updateItem(form, set, "inputs", i, { dataset_id: v, dedupe_by: [], hard_filter_field: "" }) }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("settings.templates.tform.select_placeholder")} /></SelectTrigger>
                    <SelectContent>
                      {datasets.map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} <span className="text-muted-foreground">{d.record_count != null ? t("settings.templates.tform.records_count_suffix", { n: d.record_count }) : t("settings.templates.tform.records_unknown_suffix")}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {inp.dataset_id && (() => {
                const ds = datasets.find(d => d.id === inp.dataset_id)
                if (!ds) return null
                return (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("settings.templates.tform.dedupe_label")}</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {ds.fields.map(f => {
                          const checked = inp.dedupe_by.includes(f.key)
                          return (
                            <label key={f.key} className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => {
                                  const next = checked ? inp.dedupe_by.filter(x => x !== f.key) : [...inp.dedupe_by, f.key]
                                  updateItem(form, set, "inputs", i, { dedupe_by: next })
                                }}
                              />
                              <span className="font-mono">{f.key}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.templates.tform.hard_filter_field_label")}</Label>
                        <Select value={inp.hard_filter_field || "__none__"} onValueChange={v => { if (v) updateItem(form, set, "inputs", i, { hard_filter_field: v === "__none__" ? "" : v }) }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("settings.templates.tform.none_option")}</SelectItem>
                            {ds.fields.map(f => <SelectItem key={f.key} value={f.key}>{f.key}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.templates.tform.equals_label")}</Label>
                        <Input
                          value={inp.hard_filter_equals_raw}
                          onChange={e => updateItem(form, set, "inputs", i, { hard_filter_equals_raw: e.target.value })}
                          placeholder={t("settings.templates.tform.equals_placeholder")}
                          className="h-8 text-xs"
                          disabled={!inp.hard_filter_field}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {inp.hard_filter_field
                            ? t("settings.templates.tform.equals_hint_field_equals", { field: inp.hard_filter_field, desc: describeEquals(inp.hard_filter_equals_raw, t) })
                            : t("settings.templates.tform.equals_hint_empty")}
                        </p>
                      </div>
                    </div>
                    <FiltersEditor
                      filters={inp.filters}
                      datasetFields={ds.fields}
                      datasetSample={datasetSamples[inp.dataset_id] ?? []}
                      onChange={next => updateItem(form, set, "inputs", i, { filters: next })}
                    />
                  </>
                )
              })()}
            </GlassRegular>
          ))}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.variables_title")}</h4>
            <Button size="sm" variant="outline" onClick={() => set("variables", [...form.variables, emptyVariable()])}>{t("settings.templates.tform.add_btn")}</Button>
          </div>
          {form.variables.map((v, i) => (
            <GlassRegular key={i} className="p-3 space-y-3 border border-border text-sm text-card-foreground overflow-hidden">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">#{i}</Badge>
                <button className="text-[11px] text-muted-foreground hover:text-red-500 ml-auto" onClick={() => set("variables", form.variables.filter((_, j) => j !== i))}>{t("common.delete")}</button>
              </div>
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.templates.tform.var_name_label")}</Label>
                  <Input value={v.name} onChange={e => updateItem(form, set, "variables", i, { name: e.target.value })} placeholder="question" className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.templates.tform.var_source_label")}</Label>
                  <FieldPicker
                    form={form}
                    datasets={datasets}
                    value={v.source}
                    onChange={val => updateItem(form, set, "variables", i, { source: val })}
                    scope="inputs_only"
                    allowLiteral
                    placeholder={t("settings.templates.tform.var_source_placeholder")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-[2fr_1fr] gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.templates.tform.var_transform_label")}</Label>
                  <TransformChainEditor
                    value={v.transform}
                    onChange={ts => updateItem(form, set, "variables", i, { transform: ts })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.templates.tform.var_fallback_label")}</Label>
                  <Input value={v.fallback} onChange={e => updateItem(form, set, "variables", i, { fallback: e.target.value })} placeholder={t("settings.templates.tform.var_fallback_placeholder")} className="h-8 text-xs" />
                </div>
              </div>
            </GlassRegular>
          ))}
          {form.variables.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              {t("settings.templates.tform.variables_empty_html")}
            </p>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.prompt_title")}</h4>
          <div className="space-y-1.5">
            <Label>{t("settings.templates.tform.system_prompt")}</Label>
            <Textarea value={form.default_prompt} onChange={e => set("default_prompt", e.target.value)} className="font-mono text-xs min-h-[180px]" placeholder={t("settings.templates.tform.system_prompt_placeholder")} />
            <PromptVariableLint
              text={`${form.default_prompt}\n${form.user_template}`}
              declaredVars={form.variables.map(v => v.name).filter(Boolean)}
              t={t}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.templates.tform.user_template_label")}</Label>
            <Textarea value={form.user_template} onChange={e => set("user_template", e.target.value)} className="font-mono text-xs min-h-[60px]" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.templates.tform.image_field_label")}</Label>
            <FieldPicker
              form={form}
              datasets={datasets}
              value={form.image_field}
              onChange={v => set("image_field", v)}
              scope="inputs_only"
              filterType="url"
              placeholder={t("settings.templates.tform.image_field_placeholder")}
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.output_title")}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t("settings.templates.tform.output_hint_html")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={form.raw_text_output && form.output_fields.length >= 1}
              onClick={() => set("output_fields", [...form.output_fields, { name: "", type: "string", required: true, enum_values: [] }])}
            >{t("settings.templates.tform.add_btn")}</Button>
          </div>

          <div className="flex items-start gap-2 rounded border bg-muted/30 px-2 py-2">
            <Checkbox
              id="raw_text_output"
              checked={form.raw_text_output}
              onCheckedChange={v => {
                const next = !!v
                set("raw_text_output", next)
                if (next && form.output_fields.length > 0) {
                  const first = { ...form.output_fields[0], type: "string" as const }
                  set("output_fields", [first])
                } else if (next && form.output_fields.length === 0) {
                  set("output_fields", [{ name: "copy", type: "string", required: true, enum_values: [] }])
                }
              }}
            />
            <div className="space-y-0.5">
              <Label htmlFor="raw_text_output" className="text-xs cursor-pointer">{t("settings.templates.tform.raw_text_output_label")}</Label>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.templates.tform.raw_text_output_hint")}
              </p>
            </div>
          </div>

          {form.output_fields.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("settings.templates.tform.output_empty")}</p>
          )}
          {form.output_fields.map((f, i) => {
            const disallowedType = form.raw_text_output && f.type !== "string"
            return (
              <OutputFieldRow
                key={i}
                field={f}
                rawTextMode={form.raw_text_output}
                disallowedType={disallowedType}
                canDelete={!(form.raw_text_output && form.output_fields.length <= 1)}
                onChange={patch => updateItem(form, set, "output_fields", i, patch)}
                onDelete={() => set("output_fields", form.output_fields.filter((_, j) => j !== i))}
                t={t}
              />
            )
          })}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.dimensions_title")}</h4>
              <p className="text-[11px] text-muted-foreground">{t("settings.templates.tform.dimensions_hint")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => set("display_dimensions", [...form.display_dimensions, emptyDimension()])}>{t("settings.templates.tform.add_btn")}</Button>
          </div>
          {form.display_dimensions.map((d, i) => (
            <GlassRegular key={i} className="p-3 space-y-2 border border-border text-sm text-card-foreground overflow-hidden">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">#{i}</Badge>
                <button className="text-[11px] text-muted-foreground hover:text-red-500 ml-auto" onClick={() => set("display_dimensions", form.display_dimensions.filter((_, j) => j !== i))}>{t("common.delete")}</button>
              </div>
              <div className="grid grid-cols-[2fr_1fr] gap-2">
                <FieldPicker
                  form={form}
                  datasets={datasets}
                  value={d.field}
                  onChange={val => updateItem(form, set, "display_dimensions", i, { field: val })}
                  scope="all"
                  placeholder={t("settings.templates.tform.dimension_field_placeholder")}
                />
                <Input value={d.label} onChange={e => updateItem(form, set, "display_dimensions", i, { label: e.target.value })} placeholder={t("settings.templates.tform.dimension_label_placeholder")} className="h-8 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("settings.templates.tform.value_labels_label")}</Label>
                  <KeyValueEditor
                    value={d.value_labels}
                    onChange={m => updateItem(form, set, "display_dimensions", i, { value_labels: m })}
                    keyPlaceholder={t("settings.templates.tform.value_orig_placeholder")}
                    valuePlaceholder={t("settings.templates.tform.value_display_placeholder")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("settings.templates.tform.order_label")}</Label>
                  <OrderListEditor
                    value={d.order}
                    onChange={o => updateItem(form, set, "display_dimensions", i, { order: o })}
                    placeholder={t("settings.templates.tform.value_orig_placeholder")}
                    hint={t("settings.templates.tform.order_hint")}
                  />
                </div>
              </div>
              {i === 0 && (
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("settings.templates.tform.header_fields_label")}</Label>
                  <HeaderFieldsEditor
                    value={d.header_fields}
                    onChange={h => updateItem(form, set, "display_dimensions", i, { header_fields: h })}
                    form={form}
                    datasets={datasets}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("settings.templates.tform.header_fields_hint")}</p>
                </div>
              )}
            </GlassRegular>
          ))}
          {form.display_dimensions.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("settings.templates.tform.no_dimensions")}</p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.display_override_title")}</h4>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.templates.tform.display_override_hint", { n: form.display_dimensions.length, id: inferredIdForForm })}
          </p>
          <Select value={form.display_id_override || "__auto__"} onValueChange={v => { if (v) set("display_id_override", v === "__auto__" ? "" : v) }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">{t("settings.templates.tform.auto_infer_option")}</SelectItem>
              {displays.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.display_id_override && form.display_dimensions.length > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {t("settings.templates.tform.override_warning")}
            </p>
          )}
        </section>

        {errors.length > 0 && (
          <div className="p-3 rounded border border-destructive/40 bg-destructive/10 text-sm">
            <div className="font-medium text-destructive mb-1">{t("settings.templates.tform.validation_failed_header", { n: errors.length })}</div>
            <ul className="text-xs space-y-0.5 text-destructive/90 max-h-40 overflow-y-auto">
              {errors.map((e, i) => (
                <li key={i}><span className="font-mono">{e.field}</span>: {e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {readOnly && (
          <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs">
            {t("settings.templates.tform.readonly_hint")}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 pb-8 sticky bottom-0 bg-background">
          <Button variant="outline" onClick={() => router.push("/settings/templates")}>{t("common.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={submitting || readOnly}>
            {submitting ? t("settings.templates.tform.saving_word") : mode === "edit" ? t("settings.templates.tform.save_edit_word") : t("settings.templates.tform.save_word")}
          </Button>
          {isDirty && !submitting && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">{t("settings.templates.tform.unsaved_marker")}</span>
          )}
        </div>
      </div>

      <PreviewPane form={form} datasets={datasets} displays={displays} datasetSamples={datasetSamples} t={t} />
    </div>
  )

  if (readOnly) {
    return formAndPreview
  }

  return (
    <>
      {mode === "create" && <AgentHintBanner slashCommand="evalyst-task" />}
      <Tabs value={tab} onValueChange={v => setTab((v ?? "form") as "json" | "form")}>
        <TabsList className="mb-4">
          <TabsTrigger value="form">{t("settings.templates.tform.tab_form")}</TabsTrigger>
          <TabsTrigger value="json">{t("settings.templates.tform.tab_json")}{mode === "edit" ? t("settings.templates.tform.tab_json_edit_suffix") : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="json">
          <p className="text-xs text-muted-foreground mb-3">
            {mode === "edit"
              ? t("settings.templates.tform.json_hint_edit")
              : t("settings.templates.tform.json_hint_create")}
          </p>
          <div className="grid grid-cols-2 gap-6" style={{ height: "calc(100vh - 340px)" }}>
            <MetaPromptPane
              promptText={TEMPLATE_META_PROMPT}
              title={t("settings.templates.tform.json_prompt_title")}
            />
            <JsonApplyPane
              t={t}
              onApply={schema => {
                setForm(formFromSchema(schema))
                setTab("form")
                toast.success(t("settings.templates.tform.paste_applied_toast"))
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="form">{formAndPreview}</TabsContent>
      </Tabs>
    </>
  )
}

function updateItem<K extends "inputs" | "variables" | "output_fields" | "display_dimensions">(
  form: TemplateFormState,
  set: <K2 extends keyof TemplateFormState>(k: K2, v: TemplateFormState[K2]) => void,
  key: K,
  index: number,
  patch: Partial<TemplateFormState[K][number]>,
) {
  const next = [...form[key]]
  next[index] = { ...next[index], ...patch } as TemplateFormState[K][number]
  set(key, next as TemplateFormState[K])
}

function PreviewPane({ form, datasets, displays, datasetSamples, t }: {
  form: TemplateFormState
  datasets: DatasetDef[]
  displays: Display[]
  datasetSamples: Record<string, Record<string, unknown>[]>
  t: TFn
}) {
  const { schema, errors } = buildSchemaFromForm(form)

  const inferredId = schema ? inferDisplayBuiltinId(schema) : "builtin_json_default"
  const overrideId = form.display_id_override
  const effective = overrideId || inferredId
  const effectiveDisplay = displays.find(d => d.id === effective)

  const mockResults = useMemo(() => {
    if (!schema) return []
    return generateMockResults(schema, datasets, datasetSamples, 3)
  }, [schema, datasets, datasetSamples])

  const view = schema ? pickView(schema, effectiveDisplay) : null
  const ViewComp = view?.component

  return (
    <div className="sticky top-6 max-h-[calc(100vh-140px)] overflow-y-auto pr-2">
      <GlassRegular className="flex flex-col gap-4 py-4 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.preview_title")}</h4>
            <Badge variant="outline" className="text-[10px]">{t("settings.templates.tform.preview_mock_badge")}</Badge>
          </div>

          {errors.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <div className="mb-1">{t("settings.templates.tform.preview_errors_prefix", { n: errors.length })}</div>
              <ul className="space-y-0.5 pl-4 list-disc text-red-600">
                {errors.slice(0, 3).map((e, i) => <li key={i}><span className="font-mono">{e.field}</span>: {e.message}</li>)}
              </ul>
            </div>
          ) : (
            <>
              <div className="text-xs space-y-0.5">
                <div>
                  <span className="text-muted-foreground">{t("settings.templates.tform.preview_dims_label")}</span>
                  <Badge variant="secondary" className="text-[10px] ml-1">{form.display_dimensions.length}</Badge>
                  <span className="text-muted-foreground ml-3">{t("settings.templates.tform.preview_display_label")}</span>
                  <span className="font-mono ml-1">{effective}</span>
                  {overrideId && <Badge variant="outline" className="text-[10px] ml-1">{t("settings.templates.tform.preview_override_badge")}</Badge>}
                </div>
              </div>

              <Separator />

              {mockResults.length > 0 && schema && ViewComp ? (
                <div className="scale-[0.85] origin-top-left" style={{ width: "117.65%" }}>
                  <ViewComp results={mockResults} schema={schema} />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-8 text-center">
                  {form.inputs.some(i => !i.dataset_id) ? t("settings.templates.tform.preview_no_dataset") : t("settings.templates.tform.preview_loading")}
                </div>
              )}
            </>
          )}
        </CardContent>
      </GlassRegular>
    </div>
  )
}

function JsonApplyPane({ onApply, t }: { onApply: (schema: TaskSchema) => void; t: TFn }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [parsedPreview, setParsedPreview] = useState<Record<string, unknown> | null>(null)

  const parseAndApply = () => {
    setError(null)
    setParsedPreview(null)
    if (!text.trim()) {
      setError(t("settings.templates.tform.paste_empty_err"))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setError(t("settings.templates.tform.paste_parse_err", { message: (e as Error).message }))
      return
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setError(t("settings.templates.tform.paste_root_err"))
      return
    }
    const obj = parsed as Record<string, unknown>
    const missing = ["id", "label", "inputs", "output_schema"].filter(k => !obj[k])
    if (missing.length) {
      setError(t("settings.templates.tform.paste_missing_err", { fields: missing.join(", ") }))
      return
    }
    setParsedPreview(obj)
    onApply(obj as unknown as TaskSchema)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-medium">{t("settings.templates.tform.paste_json_title")}</h3>
        <Button size="sm" onClick={parseAndApply}>{t("settings.templates.tform.paste_parse_btn")}</Button>
      </div>
      <p className="text-xs text-muted-foreground mb-2 shrink-0">
        {t("settings.templates.tform.paste_applied_hint")}
      </p>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t("settings.templates.tform.paste_placeholder")}
        className="flex-1 min-h-0 font-mono text-xs"
      />
      {error && (
        <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700 shrink-0">
          {error}
        </div>
      )}
      {parsedPreview && !error && (
        <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 shrink-0">
          {t("settings.templates.tform.paste_applied_badge")}<span className="font-mono">{String(parsedPreview.id)}</span> · {String(parsedPreview.label)}
        </div>
      )}
    </div>
  )
}

function PromptVariableLint({ text, declaredVars, t }: { text: string; declaredVars: string[]; t: TFn }) {
  const used = Array.from(text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)).map(m => m[1])
  const usedSet = new Set(used)
  const declaredSet = new Set(declaredVars)
  const missing = Array.from(usedSet).filter(v => !declaredSet.has(v))
  const unused = declaredVars.filter(v => !usedSet.has(v))

  if (declaredVars.length === 0 && used.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className="text-muted-foreground">{t("settings.templates.tform.lint_available_vars")}</span>
      {declaredVars.map(v => (
        <span
          key={v}
          className={`font-mono ${usedSet.has(v) ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40"}`}
          title={usedSet.has(v) ? t("settings.templates.tform.lint_used_title") : t("settings.templates.tform.lint_unused_title")}
        >
          {`{{${v}}}`}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="text-destructive">
          {t("settings.templates.tform.lint_missing", { vars: missing.map(v => `{{${v}}}`).join(" ") })}
        </span>
      )}
      {unused.length > 0 && missing.length === 0 && (
        <span className="text-muted-foreground">{t("settings.templates.tform.lint_unused_count", { n: unused.length })}</span>
      )}
    </div>
  )
}

function OutputFieldRow({
  field, rawTextMode, disallowedType, canDelete, onChange, onDelete, t,
}: {
  field: FormOutputField
  rawTextMode: boolean
  disallowedType: boolean
  canDelete: boolean
  onChange: (patch: Partial<FormOutputField>) => void
  onDelete: () => void
  t: TFn
}) {
  const [expanded, setExpanded] = useState(false)
  const supportsLength = field.type === "string" || field.type === "string|null"
  const supportsTupleLen = field.type === "tuple:number[]"
  const hasConstraints =
    field.max_length != null || field.min_length != null || field.enum_values.length > 0 || field.tuple_len != null

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2fr_1fr_80px_auto_auto] gap-2 items-center">
        <Input
          value={field.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={t("settings.templates.tform.field_name_placeholder")}
          className="h-8 text-xs font-mono"
        />
        <Select
          value={field.type}
          onValueChange={v => { if (v) onChange({ type: v as FormOutputField["type"] }) }}
          disabled={rawTextMode}
        >
          <SelectTrigger className="h-8 text-xs" aria-invalid={disallowedType}><SelectValue /></SelectTrigger>
          <SelectContent>
            {OUTPUT_TYPE_OPTIONS.map(ty => (
              <SelectItem key={ty} value={ty} disabled={rawTextMode && ty !== "string"}>
                {ty}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox
            checked={field.required}
            disabled={rawTextMode}
            onCheckedChange={v => onChange({ required: !!v })}
          />
          {t("settings.templates.tform.required_word")}
        </label>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? "▾" : "▸"} {t("settings.templates.tform.constraints_label")}
          {hasConstraints && <Badge variant="outline" className="ml-1 text-[9px] px-1">{t("settings.templates.tform.constraints_set_badge")}</Badge>}
        </button>
        <button
          className="text-[11px] text-muted-foreground hover:text-red-500 disabled:opacity-40"
          disabled={!canDelete}
          onClick={onDelete}
        >{t("common.delete")}</button>
      </div>
      {expanded && (
        <div className="ml-2 pl-3 border-l-2 border-border space-y-2 py-1.5">
          {supportsLength ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[11px]">{t("settings.templates.tform.min_length")}</Label>
                <Input
                  type="number"
                  value={field.min_length ?? ""}
                  onChange={e => onChange({ min_length: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder={t("settings.templates.tform.unlimited")}
                  className="h-7 text-[11px]"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[11px]">{t("settings.templates.tform.max_length")}</Label>
                <Input
                  type="number"
                  value={field.max_length ?? ""}
                  onChange={e => onChange({ max_length: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder={t("settings.templates.tform.unlimited")}
                  className="h-7 text-[11px]"
                />
              </div>
            </div>
          ) : null}
          {supportsTupleLen ? (
            <div className="space-y-0.5">
              <Label className="text-[11px]">{t("settings.templates.tform.tuple_len_label")}</Label>
              <Input
                type="number"
                value={field.tuple_len ?? ""}
                onChange={e => onChange({ tuple_len: e.target.value === "" ? undefined : Number(e.target.value) })}
                placeholder={t("settings.templates.tform.tuple_len_placeholder")}
                className="h-7 text-[11px]"
              />
            </div>
          ) : null}
          {(field.type === "string" || field.type === "number") && (
            <div className="space-y-0.5">
              <Label className="text-[11px]">{t("settings.templates.tform.enum_label")}</Label>
              <EnumValuesEditor
                value={field.enum_values}
                onChange={vals => onChange({ enum_values: vals })}
                t={t}
              />
              <p className="text-[10px] text-muted-foreground">{t("settings.templates.tform.enum_hint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EnumValuesEditor({ value, onChange, t }: { value: string[]; onChange: (v: string[]) => void; t: TFn }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const tr = draft.trim()
    if (!tr) return
    if (value.includes(tr)) { setDraft(""); return }
    onChange([...value, tr])
    setDraft("")
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((v, i) => (
        <Badge key={i} variant="secondary" className="text-[10px] gap-1">
          {v}
          <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={t("settings.templates.tform.enum_placeholder")}
        className="h-6 w-[120px] text-[11px]"
      />
    </div>
  )
}
