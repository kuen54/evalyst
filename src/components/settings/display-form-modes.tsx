"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RequiredMark } from "@/components/ui/field-label"
import { GlassRegular } from "@/components/copilot/shell"
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react"
import type { TFn } from "@/lib/i18n/provider"
import type { DisplayColumn, DisplayFieldType } from "@/lib/schema/types"
import type { FormState } from "./display-form-types"

const FIELD_TYPES: DisplayFieldType[] = ["text", "image", "badge", "json"]

type SetFn = <K extends keyof FormState>(key: K, val: FormState[K]) => void

/** table mode: 一组列定义（field / label / type / max_length + 上移下移删） */
export function TableModeForm({ form, set, tableDup, t }: {
  form: FormState
  set: SetFn
  tableDup: Set<string>
  t: TFn
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.table_columns")}</h4>
        <Button size="sm" variant="outline" onClick={() => set("table_columns", [...form.table_columns, { field: "", label: "", type: "text" }])}>
          {t("settings.displays.form.add_column")}
        </Button>
      </div>
      {form.table_columns.map((c, i) => (
        <ColumnRow
          key={i}
          col={c}
          t={t}
          onChange={patch => set("table_columns", form.table_columns.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
          onDelete={() => set("table_columns", form.table_columns.filter((_, idx) => idx !== i))}
          onMove={dir => {
            const j = i + dir
            if (j < 0 || j >= form.table_columns.length) return
            const next = [...form.table_columns]
            ;[next[i], next[j]] = [next[j]!, next[i]!]
            set("table_columns", next)
          }}
          disableFirst={i === 0}
          disableLast={i === form.table_columns.length - 1}
          disableDelete={form.table_columns.length <= 1}
          isDuplicate={!!c.field && tableDup.has(c.field)}
        />
      ))}
    </section>
  )
}

/** grouped_grid mode: primary_group + secondary_group + cell_columns */
export function GroupedGridModeForm({ form, set, cellDup, t }: {
  form: FormState
  set: SetFn
  cellDup: Set<string>
  t: TFn
}) {
  return (
    <>
      <section className="space-y-3">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.primary_dimension")}<RequiredMark /></h4>
        <GlassRegular className="p-3 border text-sm text-card-foreground overflow-hidden">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.displays.form.field_path_label")}</Label>
              <Input
                value={form.primary_group.field}
                onChange={e => set("primary_group", { ...form.primary_group, field: e.target.value })}
                placeholder="input_refs.qa"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.displays.form.display_label")}</Label>
              <Input
                value={form.primary_group.label}
                onChange={e => set("primary_group", { ...form.primary_group, label: e.target.value })}
                placeholder={t("settings.displays.form.primary_label_placeholder")}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </GlassRegular>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.secondary_dimension")}<RequiredMark /></h4>
        <GlassRegular className="p-3 border text-sm text-card-foreground overflow-hidden">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.displays.form.field_path_label")}</Label>
              <Input
                value={form.secondary_group.field}
                onChange={e => set("secondary_group", { ...form.secondary_group, field: e.target.value })}
                placeholder="input_preview.qa.topic"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.displays.form.display_label")}</Label>
              <Input
                value={form.secondary_group.label}
                onChange={e => set("secondary_group", { ...form.secondary_group, label: e.target.value })}
                placeholder={t("settings.displays.form.secondary_label_placeholder")}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </GlassRegular>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.cell_columns")}</h4>
          <Button size="sm" variant="outline" onClick={() => set("cell_columns", [...form.cell_columns, { field: "", label: "", type: "text" }])}>
            {t("settings.displays.form.add_column")}
          </Button>
        </div>
        {form.cell_columns.map((c, i) => (
          <ColumnRow
            key={i}
            col={c}
            t={t}
            onChange={patch => set("cell_columns", form.cell_columns.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
            onDelete={() => set("cell_columns", form.cell_columns.filter((_, idx) => idx !== i))}
            onMove={dir => {
              const j = i + dir
              if (j < 0 || j >= form.cell_columns.length) return
              const next = [...form.cell_columns]
              ;[next[i], next[j]] = [next[j]!, next[i]!]
              set("cell_columns", next)
            }}
            disableFirst={i === 0}
            disableLast={i === form.cell_columns.length - 1}
            disableDelete={form.cell_columns.length <= 1}
            isDuplicate={!!c.field && cellDup.has(c.field)}
          />
        ))}
      </section>
    </>
  )
}

/** jsx mode: 用户写一段自定义 JSX 源码 */
export function JsxModeForm({ form, set, t }: {
  form: FormState
  set: SetFn
  t: TFn
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.displays.form.jsx_section")}<RequiredMark /></h4>
        <Badge variant="outline" className="text-[10px]">{t("settings.displays.form.jsx_badge")}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("settings.displays.form.jsx_hint_html")}
      </p>
      <Textarea
        value={form.jsx_source}
        onChange={e => set("jsx_source", e.target.value)}
        className="font-mono text-xs min-h-[240px]"
      />
    </section>
  )
}

/** 单行列定义：field / label / type / max_length + 排序 + 删除 */
function ColumnRow({
  col, onChange, onDelete, onMove, disableFirst, disableLast, disableDelete, isDuplicate, t,
}: {
  col: DisplayColumn
  onChange: (patch: Partial<DisplayColumn>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  disableFirst: boolean
  disableLast: boolean
  disableDelete: boolean
  isDuplicate?: boolean
  t: TFn
}) {
  return (
    <GlassRegular className="p-2 border text-sm text-card-foreground overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr_100px_80px_auto] gap-2 items-center">
        <Input
          value={col.field}
          onChange={e => onChange({ field: e.target.value })}
          placeholder={t("settings.displays.form.col_field_placeholder")}
          className={`h-8 text-xs font-mono ${isDuplicate ? "border-destructive text-destructive" : ""}`}
          aria-invalid={isDuplicate}
          title={isDuplicate ? t("settings.displays.form.col_duplicate_title") : undefined}
        />
        <Input
          value={col.label ?? ""}
          onChange={e => onChange({ label: e.target.value })}
          placeholder={t("settings.displays.form.col_label_placeholder")}
          className="h-8 text-xs"
        />
        <Select value={col.type ?? "text"} onValueChange={v => { if (v) onChange({ type: v as DisplayFieldType }) }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map(ft => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={col.max_length ?? ""}
          onChange={e => onChange({ max_length: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder={t("settings.displays.form.col_max_length_placeholder")}
          type="number"
          className="h-8 text-xs"
        />
        <div className="flex items-center">
          <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={disableFirst} onClick={() => onMove(-1)}>
            <ArrowUpIcon className="size-3" />
          </button>
          <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={disableLast} onClick={() => onMove(1)}>
            <ArrowDownIcon className="size-3" />
          </button>
          <button type="button" className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={disableDelete} onClick={onDelete}>
            <XIcon className="size-3" />
          </button>
        </div>
      </div>
    </GlassRegular>
  )
}
