"use client"

import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { FilterDef, FieldDef } from "@/lib/schema/types"

type FilterKind = FilterDef["kind"]

function kindLabels(t: TFn): Record<FilterKind, string> {
  return {
    multiselect: t("filters.kind_multiselect"),
    checkbox: t("filters.kind_checkbox"),
    number: t("filters.kind_number"),
    text_in: t("filters.kind_text_in"),
    literal_set: t("filters.kind_literal_set"),
  }
}

function kindHints(t: TFn): Record<FilterKind, string> {
  return {
    multiselect: t("filters.hint_multiselect"),
    checkbox: t("filters.hint_checkbox"),
    number: t("filters.hint_number"),
    text_in: t("filters.hint_text_in"),
    literal_set: t("filters.hint_literal_set"),
  }
}

interface Props {
  filters: FilterDef[]
  datasetFields: FieldDef[]
  datasetSample: Record<string, unknown>[]
  onChange: (next: FilterDef[]) => void
}

export function FiltersEditor({ filters, datasetFields, datasetSample, onChange }: Props) {
  const t = useT()
  const KIND_LABEL = useMemo(() => kindLabels(t), [t])
  const KIND_HINT = useMemo(() => kindHints(t), [t])

  const update = (i: number, patch: Partial<FilterDef>) => {
    onChange(filters.map((f, j) => (j === i ? ({ ...f, ...patch } as FilterDef) : f)))
  }
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i))
  const add = () => onChange([...filters, defaultFilter("multiselect")])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{t("filters.section_label")}</Label>
        <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">{t("filters.add_btn")}</Button>
      </div>
      {filters.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t("filters.empty_hint")}</p>
      )}
      {filters.map((f, i) => (
        <div key={i} className="border rounded-md p-2.5 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Select
              value={f.kind}
              onValueChange={v => { if (v) update(i, convertKind(f, v as FilterKind)) }}
            >
              <SelectTrigger className="h-7 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as FilterKind[]).map(k => (
                  <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              className="ml-auto text-[11px] text-muted-foreground hover:text-red-500"
              onClick={() => remove(i)}
            >{t("common.delete")}</button>
          </div>
          <p className="text-[10px] text-muted-foreground">{KIND_HINT[f.kind]}</p>
          <FilterFields
            filter={f}
            datasetFields={datasetFields}
            datasetSample={datasetSample}
            onChange={patch => update(i, patch)}
            t={t}
          />
        </div>
      ))}
    </div>
  )
}

function FilterFields({
  filter,
  datasetFields,
  datasetSample,
  onChange,
  t,
}: {
  filter: FilterDef
  datasetFields: FieldDef[]
  datasetSample: Record<string, unknown>[]
  onChange: (patch: Partial<FilterDef>) => void
  t: TFn
}) {
  const fieldDropdown = (
    value: string | undefined,
    onFieldChange: (v: string) => void,
    required = true,
  ) => (
    <Select value={value || "__none__"} onValueChange={v => { if (v) onFieldChange(v === "__none__" ? "" : v) }}>
      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t("filters.pick_field")} /></SelectTrigger>
      <SelectContent>
        {!required && <SelectItem value="__none__">{t("filters.no_specific_field")}</SelectItem>}
        {datasetFields.map(f => (
          <SelectItem key={f.key} value={f.key}>{f.key}{f.label && f.label !== f.key ? ` · ${f.label}` : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const gridRow = (label: string, node: React.ReactNode) => (
    <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {node}
    </div>
  )

  switch (filter.kind) {
    case "multiselect":
    case "literal_set":
      return (
        <div className="space-y-1.5">
          {gridRow("Key", (
            <Input
              value={filter.key}
              onChange={e => onChange({ key: e.target.value } as Partial<FilterDef>)}
              placeholder="topics"
              className="h-7 text-xs font-mono"
            />
          ))}
          {gridRow("Field", fieldDropdown(filter.field, v => onChange({ field: v } as Partial<FilterDef>)))}
          {gridRow("Label", (
            <Input
              value={filter.label}
              onChange={e => onChange({ label: e.target.value } as Partial<FilterDef>)}
              placeholder={t("filters.category_placeholder")}
              className="h-7 text-xs"
            />
          ))}
          {filter.kind === "multiselect" && gridRow(t("filters.include_null_row"), (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={!!filter.include_null}
                onCheckedChange={v => onChange({ include_null: !!v } as Partial<FilterDef>)}
              />
              {t("filters.include_null_inline")}
            </label>
          ))}
          <OptionsEditor
            options={filter.options as Array<{ value: unknown; label: string }>}
            datasetSample={datasetSample}
            field={filter.field}
            literal={filter.kind === "literal_set"}
            onChange={opts => onChange({ options: opts } as Partial<FilterDef>)}
            t={t}
          />
          {gridRow(t("filters.default_selected"), (
            <DefaultSelectEditor
              options={filter.options}
              value={(filter.defaultValue ?? []) as unknown[]}
              onChange={v => onChange({ defaultValue: v } as Partial<FilterDef>)}
              t={t}
            />
          ))}
        </div>
      )

    case "checkbox":
      return (
        <div className="space-y-1.5">
          {gridRow("Key", (
            <Input value={filter.key} onChange={e => onChange({ key: e.target.value })} className="h-7 text-xs font-mono" />
          ))}
          {gridRow("Field", fieldDropdown(filter.field, v => onChange({ field: v })))}
          {gridRow("Label", (
            <Input value={filter.label} onChange={e => onChange({ label: e.target.value })} className="h-7 text-xs" />
          ))}
          {gridRow("Truthy", (
            <Input
              value={String(filter.truthy ?? "")}
              onChange={e => onChange({ truthy: parseLiteral(e.target.value) })}
              placeholder="true / 1 / 'yes'"
              className="h-7 text-xs font-mono"
            />
          ))}
          {gridRow(t("filters.default_checked_row"), (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={!!filter.defaultValue}
                onCheckedChange={v => onChange({ defaultValue: !!v })}
              />
              {t("filters.default_checked_inline")}
            </label>
          ))}
        </div>
      )

    case "number":
      return (
        <div className="space-y-1.5">
          {gridRow("Key", (
            <Input value={filter.key} onChange={e => onChange({ key: e.target.value })} className="h-7 text-xs font-mono" />
          ))}
          {gridRow("Field", fieldDropdown(filter.field, v => onChange({ field: v }), false))}
          {gridRow("Label", (
            <Input value={filter.label} onChange={e => onChange({ label: e.target.value })} className="h-7 text-xs" />
          ))}
          {gridRow("Role", (
            <Select value={filter.role} onValueChange={v => { if (v) onChange({ role: v as "limit" | "min" | "max" }) }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="limit">{t("filters.role_limit")}</SelectItem>
                <SelectItem value="min">{t("filters.role_min")}</SelectItem>
                <SelectItem value="max">{t("filters.role_max")}</SelectItem>
              </SelectContent>
            </Select>
          ))}
          {gridRow(t("filters.default_value"), (
            <Input
              type="number"
              value={filter.defaultValue == null ? "" : String(filter.defaultValue)}
              onChange={e => onChange({ defaultValue: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="h-7 text-xs"
            />
          ))}
        </div>
      )

    case "text_in":
      return (
        <div className="space-y-1.5">
          {gridRow("Key", (
            <Input value={filter.key} onChange={e => onChange({ key: e.target.value })} className="h-7 text-xs font-mono" />
          ))}
          {gridRow("Field", fieldDropdown(filter.field, v => onChange({ field: v })))}
          {gridRow("Label", (
            <Input value={filter.label} onChange={e => onChange({ label: e.target.value })} className="h-7 text-xs" />
          ))}
        </div>
      )
  }
}

function OptionsEditor({
  options,
  onChange,
  datasetSample,
  field,
  literal,
  t,
}: {
  options: Array<{ value: unknown; label: string }>
  onChange: (opts: Array<{ value: unknown; label: string }>) => void
  datasetSample: Record<string, unknown>[]
  field: string | undefined
  literal: boolean
  t: TFn
}) {
  const inferFromData = () => {
    if (!field || !datasetSample.length) return
    const seen = new Set<string>()
    const result: Array<{ value: unknown; label: string }> = []
    for (const r of datasetSample) {
      const v = (r as Record<string, unknown>)[field]
      if (v == null) continue
      const vals = Array.isArray(v) ? v : [v]
      for (const x of vals) {
        const key = typeof x === "object" ? JSON.stringify(x) : String(x)
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ value: literal ? x : String(x), label: String(x) })
      }
    }
    onChange(result)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{t("filters.options_label")}</Label>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            disabled={!field || !datasetSample.length}
            onClick={inferFromData}
            title={field ? "" : t("filters.pick_field_first")}
          >{t("filters.infer_from_data")}</Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            onClick={() => onChange([...options, { value: literal ? "" : "", label: "" }])}
          >{t("filters.add_option")}</Button>
        </div>
      </div>
      {options.length === 0 && (
        <p className="text-[10px] text-muted-foreground pl-1">{t("filters.options_empty_hint")}</p>
      )}
      {options.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-center">
          <Input
            value={typeof o.value === "object" ? JSON.stringify(o.value) : String(o.value ?? "")}
            onChange={e => {
              const next = [...options]
              next[i] = { ...o, value: literal ? parseLiteral(e.target.value) : e.target.value }
              onChange(next)
            }}
            placeholder="value"
            className="h-7 text-xs font-mono"
          />
          <Input
            value={o.label}
            onChange={e => {
              const next = [...options]
              next[i] = { ...o, label: e.target.value }
              onChange(next)
            }}
            placeholder="label"
            className="h-7 text-xs"
          />
          <button
            className="text-[11px] text-muted-foreground hover:text-red-500"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
          >×</button>
        </div>
      ))}
    </div>
  )
}

function DefaultSelectEditor({
  options,
  value,
  onChange,
  t,
}: {
  options: Array<{ value: unknown; label: string }>
  value: unknown[]
  onChange: (v: unknown[]) => void
  t: TFn
}) {
  if (!options.length) {
    return <p className="text-[10px] text-muted-foreground">{t("filters.default_options_hint")}</p>
  }
  const selected = (v: unknown) => value.some(x => (typeof x === "object" ? JSON.stringify(x) : String(x)) === (typeof v === "object" ? JSON.stringify(v) : String(v)))
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => {
        const on = selected(o.value)
        return (
          <label key={i} className="flex items-center gap-1 text-[11px]">
            <Checkbox
              checked={on}
              onCheckedChange={() => {
                if (on) onChange(value.filter(x => (typeof x === "object" ? JSON.stringify(x) : String(x)) !== (typeof o.value === "object" ? JSON.stringify(o.value) : String(o.value))))
                else onChange([...value, o.value])
              }}
            />
            {o.label || String(o.value)}
          </label>
        )
      })}
    </div>
  )
}

function convertKind(old: FilterDef, kind: FilterKind): FilterDef {
  const base = { key: old.key, field: (old as { field?: string }).field ?? "", label: old.label }
  switch (kind) {
    case "multiselect":
      return { kind: "multiselect", key: base.key, field: base.field, label: base.label, options: [] }
    case "literal_set":
      return { kind: "literal_set", key: base.key, field: base.field, label: base.label, options: [] }
    case "checkbox":
      return { kind: "checkbox", key: base.key, field: base.field, label: base.label, truthy: true }
    case "number":
      return { kind: "number", key: base.key, field: base.field || undefined, label: base.label, role: "limit" }
    case "text_in":
      return { kind: "text_in", key: base.key, field: base.field, label: base.label }
  }
}

function defaultFilter(kind: FilterKind): FilterDef {
  switch (kind) {
    case "multiselect":
      return { kind: "multiselect", key: "", field: "", label: "", options: [] }
    case "literal_set":
      return { kind: "literal_set", key: "", field: "", label: "", options: [] }
    case "checkbox":
      return { kind: "checkbox", key: "", field: "", label: "", truthy: true }
    case "number":
      return { kind: "number", key: "", label: "", role: "limit" }
    case "text_in":
      return { kind: "text_in", key: "", field: "", label: "" }
  }
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim()
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  const n = Number(s)
  if (!isNaN(n) && s !== "") return n
  return s
}
