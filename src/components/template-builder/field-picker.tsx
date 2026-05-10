"use client"

import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { DatasetDef } from "@/lib/schema/types"
import type { TemplateFormState } from "./form-state"

type FieldPickerScope = "all" | "inputs_only" | "preview_only"

interface Option {
  value: string
  label: string
  group: string
}

interface Props {
  form: TemplateFormState
  datasets: DatasetDef[]
  value: string
  onChange: (v: string) => void
  scope?: FieldPickerScope
  placeholder?: string
  allowLiteral?: boolean
  className?: string
  filterType?: "url" | "all"   // 只显示某类型字段；对 image_field 场景 = 'url'
}

/**
 * 字段路径选择器：
 *  - 左侧 Input 允许自由输入（literal:xxx / 任意路径）
 *  - 右侧下拉展示"常见候选"：input_refs.* / input_preview.*.* / output.*
 *  - 选中候选自动填入 Input
 */
export function FieldPicker({ form, datasets, value, onChange, scope = "all", placeholder, allowLiteral = false, className, filterType = "all" }: Props) {
  const t = useT()
  const options = useMemo<Option[]>(() => buildOptions(form, datasets, scope, filterType, t), [form, datasets, scope, filterType, t])

  const effectivePlaceholder = placeholder ?? (allowLiteral ? "alias.field / literal:xxx" : "input_preview.alias.field")

  const isDead = useMemo(() => {
    if (!value) return false
    if (allowLiteral && value.startsWith("literal:")) return false
    if (scope === "all" && value.startsWith("output.")) return false
    if (scope === "inputs_only" && form.inputs.some(inp => inp.alias === value)) return false
    return !options.some(o => o.value === value)
  }, [value, options, scope, allowLiteral, form.inputs])

  return (
    <div className={`flex gap-1.5 ${className ?? ""}`}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={effectivePlaceholder}
        className={`font-mono text-xs flex-1 h-8 ${isDead ? "border-destructive/60 text-destructive" : ""}`}
        title={isDead ? t("field_picker.dead_title") : undefined}
      />
      <Select
        value=""
        onValueChange={v => { if (v) onChange(v) }}
      >
        <SelectTrigger className="h-8 w-[96px] shrink-0 text-[11px] text-muted-foreground">
          <SelectValue placeholder={t("field_picker.pick_field")} />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 && <SelectItem value="__no__" disabled>{t("field_picker.no_fields")}</SelectItem>}
          {groupByGroup(options).map(([group, opts]) => (
            <SelectGroup key={group} label={group} options={opts} />
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SelectGroup({ label, options }: { label: string; options: Option[] }) {
  return (
    <>
      <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      {options.map(o => (
        <SelectItem key={o.value} value={o.value}>
          <span className="font-mono text-xs">{o.value}</span>
          {o.label !== o.value && <span className="text-[10px] text-muted-foreground ml-2">{o.label}</span>}
        </SelectItem>
      ))}
    </>
  )
}

function groupByGroup(options: Option[]): Array<[string, Option[]]> {
  const map = new Map<string, Option[]>()
  for (const o of options) {
    if (!map.has(o.group)) map.set(o.group, [])
    map.get(o.group)!.push(o)
  }
  return Array.from(map.entries())
}

function buildOptions(form: TemplateFormState, datasets: DatasetDef[], scope: FieldPickerScope, filterType: "url" | "all", t: TFn): Option[] {
  const out: Option[] = []

  for (const input of form.inputs) {
    if (!input.dataset_id) continue
    const ds = datasets.find(d => d.id === input.dataset_id)
    if (!ds) continue

    const prefix = scope === "inputs_only" ? `${input.alias}.` : `input_preview.${input.alias}.`

    if (scope === "all" && filterType === "all") {
      out.push({
        value: `input_refs.${input.alias}`,
        label: t("field_picker.alias_id_of", { alias: input.alias, field: ds.id_field }),
        group: `${input.alias} (refs)`,
      })
    }

    for (const f of ds.fields) {
      if (filterType === "url" && f.type !== "url") continue
      out.push({
        value: `${prefix}${f.key}`,
        label: f.label ?? f.key,
        group: `${input.alias} (fields)`,
      })
    }
  }

  if (scope === "all" && filterType === "all") {
    for (const f of form.output_fields) {
      if (!f.name) continue
      out.push({
        value: `output.${f.name}`,
        label: f.name,
        group: "output",
      })
    }
  }

  return out
}
