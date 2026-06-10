"use client"

import { useMemo, useRef, useState } from "react"
import Papa from "papaparse"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { GlassRegular } from "@/components/glass/shell"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RequiredMark } from "@/components/ui/field-label"
import { StickySaveBar } from "@/components/ui/sticky-save-bar"
import { XIcon, ArrowUpIcon, ArrowDownIcon, UploadIcon } from "lucide-react"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { DatasetDef, FieldDef } from "@/lib/schema/types"
import { coerceCsvRow, inferFieldsFromCsv, detectIdField, tryParseRecords } from "@/lib/dataset-parse"

type FieldType = NonNullable<FieldDef["type"]>

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "url", "array", "object"]

interface FormState {
  id: string
  name: string
  description: string
  id_field: string
  fields: FieldDef[]
  records_text: string
}

function emptyState(): FormState {
  return { id: "", name: "", description: "", id_field: "", fields: [{ key: "" }], records_text: "" }
}

function stateFromDataset(def: DatasetDef, records: Record<string, unknown>[]): FormState {
  const records_text = records.map(r => JSON.stringify(r)).join("\n")
  return {
    id: def.id,
    name: def.name,
    description: def.description ?? "",
    id_field: def.id_field,
    fields: def.fields.length ? def.fields : [{ key: "" }],
    records_text,
  }
}

interface Props {
  mode?: "create" | "edit"
  initial?: { def: DatasetDef; records: Record<string, unknown>[] }
}

export function DatasetFormPage({ mode = "create", initial }: Props = {}) {
  const t = useT()
  const isEdit = mode === "edit"
  const [form, setForm] = useState<FormState>(() => initial ? stateFromDataset(initial.def, initial.records) : emptyState())
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSeeded = initial?.def.source === "builtin" || (initial?.def.id === "boxes" || initial?.def.id === "users")

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const fieldKeys = useMemo(() => form.fields.map(f => f.key).filter(Boolean), [form.fields])
  const duplicateKeys = useMemo(() => {
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const f of form.fields) {
      if (!f.key) continue
      if (seen.has(f.key)) dup.add(f.key)
      seen.add(f.key)
    }
    return dup
  }, [form.fields])
  const recordsPreview = useMemo(() => tryParseRecords(form.records_text, t), [form.records_text, t])

  const addField = () => set("fields", [...form.fields, { key: "" }])
  const removeField = (i: number) => set("fields", form.fields.filter((_, idx) => idx !== i))
  const updateField = (i: number, patch: Partial<FieldDef>) =>
    set("fields", form.fields.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= form.fields.length) return
    const next = [...form.fields]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    set("fields", next)
  }

  const importFile = async (f: File) => {
    const text = await f.text()
    const isCsv = f.name.toLowerCase().endsWith(".csv")
    if (isCsv) {
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: "greedy",
        dynamicTyping: false,
      })
      if (parsed.errors.length > 0) {
        const first = parsed.errors[0]!
        toast.error(t("settings.datasets.form.csv_parse_error", { row: (first.row ?? 0) + 1, message: first.message }))
        return
      }
      const rows = parsed.data
      if (rows.length === 0) {
        toast.error(t("settings.datasets.form.csv_empty"))
        return
      }
      const headers = parsed.meta.fields ?? Object.keys(rows[0]!)
      const records = rows.map(r => coerceCsvRow(r, headers))
      const jsonl = records.map(r => JSON.stringify(r)).join("\n")

      const hasUserFields = form.fields.some(ff => ff.key)
      if (!hasUserFields) {
        const inferred = inferFieldsFromCsv(records, headers)
        const detectedId = detectIdField(records, headers)
        const idFieldToUse = detectedId ?? inferred[0]?.key ?? ""
        setForm(prev => ({
          ...prev,
          records_text: jsonl,
          fields: inferred,
          id_field: prev.id_field || idFieldToUse,
        }))
        if (detectedId) {
          toast.success(t("settings.datasets.form.csv_imported_with_id", { file: f.name, count: records.length, fields: inferred.length, id: detectedId }))
        } else {
          toast.success(t("settings.datasets.form.csv_imported", { file: f.name, count: records.length, fields: inferred.length }))
        }
      } else {
        set("records_text", jsonl)
        toast.success(t("settings.datasets.form.csv_imported_short", { file: f.name, count: records.length }))
      }
      return
    }
    set("records_text", text)
    toast.success(t("settings.datasets.form.file_read", { file: f.name }))
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    await importFile(f)
    e.target.value = ""
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) await importFile(f)
  }

  const handleSubmit = async () => {
    const errs: Array<{ field: string; message: string }> = []
    if (!isEdit) {
      if (!form.id) errs.push({ field: "id", message: t("settings.datasets.form.required") })
      else if (!/^[a-z][a-z0-9_]*$/.test(form.id)) errs.push({ field: "id", message: t("settings.datasets.form.id_validation") })
    }
    if (!form.name) errs.push({ field: "name", message: t("settings.datasets.form.required") })
    if (form.fields.length === 0 || form.fields.every(f => !f.key)) errs.push({ field: "fields", message: t("settings.datasets.form.at_least_one_field") })
    const keySet = new Set<string>()
    form.fields.forEach((f, i) => {
      if (!f.key) return
      if (keySet.has(f.key)) errs.push({ field: `fields[${i}].key`, message: t("settings.datasets.form.duplicate_key", { key: f.key }) })
      keySet.add(f.key)
    })
    if (!form.id_field) errs.push({ field: "id_field", message: t("settings.datasets.form.id_field_required") })
    else if (!keySet.has(form.id_field)) errs.push({ field: "id_field", message: t("settings.datasets.form.id_field_not_in_fields", { field: form.id_field }) })

    if (recordsPreview.error) errs.push({ field: "records", message: recordsPreview.error })
    else if (recordsPreview.records.length === 0) errs.push({ field: "records", message: t("settings.datasets.form.at_least_one_record") })

    if (errs.length) {
      setErrors(errs)
      toast.error(t("settings.datasets.form.errors_toast", { n: errs.length }))
      return
    }
    setErrors([])
    setSubmitting(true)
    const body = {
      id: form.id,
      name: form.name,
      description: form.description || undefined,
      id_field: form.id_field,
      fields: form.fields.filter(f => f.key),
      records: recordsPreview.records,
    }
    const url = isEdit ? `/api/datasets/${form.id}` : "/api/datasets"
    const method = isEdit ? "PATCH" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      setErrors(data.errors ?? [{ field: "$", message: data.error ?? t("settings.datasets.form.save_fail_default") }])
      toast.error(data.error ?? t("settings.datasets.form.save_fail_default"))
      setSubmitting(false)
      return
    }
    toast.success(isEdit
      ? t("settings.datasets.form.saved_toast", { name: form.name })
      : t("settings.datasets.form.created_toast", { name: form.name }))
    window.location.href = isEdit ? `/settings/datasets/${form.id}` : "/settings/datasets"
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="space-y-6 pb-12">
        {isSeeded && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-400">
            {t("settings.datasets.form.seed_banner")}
          </div>
        )}

        {!isEdit && (
          <div
            onDragOver={e => { e.preventDefault(); if (!dragActive) setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
              dragActive
                ? "border-[color:var(--copilot-accent)] bg-[color:color-mix(in_oklab,var(--copilot-accent)_12%,transparent)]"
                : form.records_text
                  ? "border-muted-foreground/30 bg-muted/30 hover:border-[color:color-mix(in_oklab,var(--copilot-accent)_50%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--copilot-accent)_6%,transparent)]"
                  : "border-[color:color-mix(in_oklab,var(--copilot-accent)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--copilot-accent)_6%,transparent)] hover:border-[color:color-mix(in_oklab,var(--copilot-accent)_60%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--copilot-accent)_12%,transparent)]"
            }`}
          >
            <UploadIcon className={`size-8 ${dragActive ? "text-[color:var(--copilot-accent)]" : "text-[color:color-mix(in_oklab,var(--copilot-accent)_70%,transparent)]"}`} />
            <div className="text-sm font-medium">{t("settings.datasets.form.dropzone_title")}</div>
            <div className="text-xs text-muted-foreground text-center max-w-xl">
              {t("settings.datasets.form.dropzone_hint")}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-1 pointer-events-none"
            >
              {t("settings.datasets.form.dropzone_cta")}
            </Button>
            {form.records_text && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                {t("settings.datasets.form.dropzone_replace_hint")}
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.jsonl,.json,.txt"
              className="hidden"
              onChange={handleFileUpload}
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}

        {/* 基本信息 */}
      <section className="space-y-3">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.section_basic")}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("common.id")}<RequiredMark /></Label>
            <Input
              value={form.id}
              onChange={e => set("id", e.target.value)}
              placeholder="my_dataset"
              aria-invalid={!!form.id && !/^[a-z][a-z0-9_]*$/.test(form.id)}
              disabled={isEdit}
            />
            <p className="text-[11px] text-muted-foreground">{isEdit ? t("settings.datasets.form.id_locked") : t("settings.datasets.form.id_format_hint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.datasets.form.display_name")}<RequiredMark /></Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder={t("settings.datasets.form.display_name_placeholder")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("settings.datasets.form.dataset_description")}</Label>
          <Input value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("settings.datasets.form.description_placeholder")} />
        </div>
      </section>

      <Separator />

      {/* 字段 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.fields_title")}<RequiredMark /></h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("settings.datasets.form.fields_desc")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={addField}>{t("settings.datasets.form.add_field")}</Button>
        </div>
        {form.fields.map((f, i) => {
          const isDup = !!f.key && duplicateKeys.has(f.key)
          return (
            <GlassRegular key={i} className="p-2 border text-sm text-card-foreground overflow-hidden">
              <div className="grid grid-cols-[100px_1fr_120px_1fr_auto] gap-2 items-center">
                <Input
                  value={f.key}
                  onChange={e => updateField(i, { key: e.target.value })}
                  placeholder="key"
                  className={`h-8 text-xs font-mono ${isDup ? "border-destructive text-destructive" : ""}`}
                  aria-invalid={isDup}
                  title={isDup ? t("settings.datasets.form.field_key_duplicate_title") : undefined}
                />
                <Input
                  value={f.label ?? ""}
                  onChange={e => updateField(i, { label: e.target.value })}
                  placeholder={t("settings.datasets.form.field_label_placeholder")}
                  className="h-8 text-xs"
                />
                <Select
                  value={f.type ?? "string"}
                  onValueChange={v => { if (v) updateField(i, { type: v as FieldType }) }}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map(ft => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={f.description ?? ""}
                  onChange={e => updateField(i, { description: e.target.value })}
                  placeholder={t("settings.datasets.form.field_description_placeholder")}
                  className="h-8 text-xs"
                />
                <div className="flex items-center">
                  <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => moveField(i, -1)}>
                    <ArrowUpIcon className="size-3" />
                  </button>
                  <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === form.fields.length - 1} onClick={() => moveField(i, 1)}>
                    <ArrowDownIcon className="size-3" />
                  </button>
                  <button type="button" className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={form.fields.length <= 1} onClick={() => removeField(i)}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              </div>
            </GlassRegular>
          )
        })}
      </section>

      <Separator />

      {/* ID 字段 */}
      <section className="space-y-2">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.id_field_section")}<RequiredMark /></h4>
        <p className="text-[11px] text-muted-foreground">{t("settings.datasets.form.id_field_desc_html")}</p>
        <Select value={form.id_field || "__none__"} onValueChange={v => { if (v) set("id_field", v === "__none__" ? "" : v) }}>
          <SelectTrigger className="h-8 text-xs w-[260px]"><SelectValue placeholder={t("settings.datasets.form.choose_field")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("settings.datasets.form.none_option")}</SelectItem>
            {fieldKeys.map(k => <SelectItem key={k} value={k} className="font-mono">{k}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>

      <Separator />

      {/* 记录 */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div>
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.records_section")}<RequiredMark /></h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("settings.datasets.form.records_format_hint_html")}
            </p>
          </div>
          <label className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer">
            {t("settings.datasets.form.upload_btn")}
            <input type="file" accept=".csv,.jsonl,.json,.txt" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
        <Textarea
          value={form.records_text}
          onChange={e => set("records_text", e.target.value)}
          placeholder={`{"id": 1, "name": "A"}\n{"id": 2, "name": "B"}\n...or [{"id":1},{"id":2}]`}
          className="font-mono text-[11px] min-h-[200px]"
        />
        {recordsPreview.error ? (
          <p className="text-xs text-destructive">{recordsPreview.error}</p>
        ) : form.records_text.trim() ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">{t("settings.datasets.form.records_badge", { n: recordsPreview.records.length })}</Badge>
            {recordsPreview.records[0] && (
              <span>
                {t("settings.datasets.form.first_fields_inline", { fields: Object.keys(recordsPreview.records[0]).slice(0, 8).join(", ") })}
                {Object.keys(recordsPreview.records[0]).length > 8 && " ..."}
              </span>
            )}
            <MissingFieldsWarning declaredKeys={fieldKeys} {...(recordsPreview.records[0] !== undefined ? { record: recordsPreview.records[0] } : {})} t={t} />
          </div>
        ) : null}
      </section>

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
        onCancel={() => (window.location.href = isEdit ? `/settings/datasets/${form.id}` : "/settings/datasets")}
        submitting={submitting}
        {...(isEdit ? { saveLabel: t("settings.datasets.form.submit_update") } : {})}
      />
      </div>

      {/* 右栏预览 */}
      <DatasetPreviewPane
        fields={form.fields}
        idField={form.id_field}
        records={recordsPreview.records}
        parseError={recordsPreview.error}
        t={t}
      />
    </div>
  )
}

function DatasetPreviewPane({
  fields, idField, records, parseError, t,
}: {
  fields: FieldDef[]
  idField: string
  records: Record<string, unknown>[]
  parseError: string | null
  t: TFn
}) {
  const declared = fields.filter(f => f.key).map(f => f.key)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: derived from stable form args; useMemo cost negligible
  const declaredSet = new Set(declared)

  // 字段覆盖统计：每个已声明字段在多少条记录里出现
  const coverage = useMemo(() => {
    const map = new Map<string, number>()
    for (const key of declared) map.set(key, 0)
    for (const r of records) {
      for (const key of declared) {
        if (key in r && r[key] != null && r[key] !== "") {
          map.set(key, (map.get(key) ?? 0) + 1)
        }
      }
    }
    return map
  }, [declared, records])

  // 记录里出现但未声明的字段
  const extraFields = useMemo(() => {
    if (records.length === 0) return []
    const allKeys = new Set<string>()
    for (const r of records.slice(0, 20)) {
      for (const k of Object.keys(r)) allKeys.add(k)
    }
    return Array.from(allKeys).filter(k => !declaredSet.has(k))
  }, [records, declaredSet])

  const sample = records.slice(0, 5)

  return (
    <div className="sticky top-6 max-h-[calc(100vh-140px)] overflow-y-auto">
      <GlassRegular className="p-3 space-y-3 text-sm text-card-foreground overflow-hidden">
        <div className="flex items-center gap-2">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.datasets.form.preview_title")}</h4>
          {records.length > 0 && <Badge variant="outline" className="text-[10px]">{t("settings.datasets.form.preview_n_records", { n: records.length })}</Badge>}
        </div>

        {parseError && (
          <div className="p-2 rounded border border-destructive/40 bg-destructive/10 text-[11px] text-destructive">
            ⚠ {parseError}
          </div>
        )}

        {declared.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">{t("settings.datasets.form.declare_fields_first")}</p>
        )}

        {declared.length > 0 && records.length === 0 && !parseError && (
          <p className="text-[11px] text-muted-foreground italic">{t("settings.datasets.form.paste_for_preview")}</p>
        )}

        {/* 字段覆盖率 */}
        {declared.length > 0 && records.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">{t("settings.datasets.form.field_coverage")}</div>
            <div className="space-y-0.5">
              {declared.map(k => {
                const n = coverage.get(k) ?? 0
                const pct = records.length ? Math.round((n / records.length) * 100) : 0
                const low = pct < 80
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px]">
                    <span className={`font-mono ${k === idField ? "text-foreground" : "text-muted-foreground"}`}>
                      {k}{k === idField && " 🔑"}
                    </span>
                    <div className="flex-1 h-1 bg-muted rounded overflow-hidden">
                      <div
                        className={`h-full ${pct === 100 ? "bg-emerald-500" : low ? "bg-amber-500" : "bg-muted-foreground"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`tabular-nums ${low ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {n}/{records.length}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 未声明的字段警告 */}
        {extraFields.length > 0 && (
          <div className="text-[11px] space-y-1">
            <div className="text-amber-600 dark:text-amber-400">{t("settings.datasets.form.undeclared_fields")}</div>
            <div className="flex flex-wrap gap-1">
              {extraFields.slice(0, 10).map(k => (
                <Badge key={k} variant="outline" className="text-[10px] font-mono font-normal">{k}</Badge>
              ))}
              {extraFields.length > 10 && (
                <span className="text-muted-foreground">+{extraFields.length - 10}</span>
              )}
            </div>
          </div>
        )}

        {/* 采样记录 */}
        {sample.length > 0 && declared.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">{t("settings.datasets.form.sample_prefix", { n: sample.length })}</div>
            <div className="rounded border overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {declared.map(k => (
                      <th key={k} className="px-1.5 py-1 text-left font-mono font-normal text-muted-foreground whitespace-nowrap">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, i) => (
                    <tr key={i} className="border-t">
                      {declared.map(k => (
                        <td key={k} className="px-1.5 py-1 whitespace-nowrap max-w-[140px] overflow-hidden text-ellipsis">
                          {formatCell(r[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </GlassRegular>
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "string") return v.length > 32 ? v.slice(0, 32) + "…" : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return `{${Object.keys(v as object).length}}`
}

function MissingFieldsWarning({ declaredKeys, record, t }: { declaredKeys: string[]; record?: Record<string, unknown>; t: TFn }) {
  if (!record || declaredKeys.length === 0) return null
  const missing = declaredKeys.filter(k => !(k in record))
  if (missing.length === 0) return null
  return (
    <span className="text-amber-600 dark:text-amber-400">
      {t("settings.datasets.form.missing_first", { fields: missing.join(", ") })}
    </span>
  )
}

