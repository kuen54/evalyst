"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react"
import { FieldPicker } from "./field-picker"
import { useT } from "@/lib/i18n/provider"
import type { DatasetDef } from "@/lib/schema/types"
import type { TemplateFormState } from "./form-state"

type Entry = { field: string; label?: string }

/** DisplayDimension.header_fields 的结构化编辑器 */
export function HeaderFieldsEditor({
  value,
  onChange,
  form,
  datasets,
}: {
  value: Entry[]
  onChange: (v: Entry[]) => void
  form: TemplateFormState
  datasets: DatasetDef[]
}) {
  const t = useT()
  const update = (i: number, patch: Partial<Entry>) =>
    onChange(value.map((e, idx) => idx === i ? { ...e, ...patch } : e))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () => onChange([...value, { field: "", label: "" }])
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">{t("editor.empty_prompt_add")}</p>
      )}
      {value.map((entry, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-1.5 items-center">
          <FieldPicker
            form={form}
            datasets={datasets}
            value={entry.field}
            onChange={v => update(i, { field: v })}
            scope="all"
            placeholder="input_preview.qa.question"
          />
          <Input
            value={entry.label ?? ""}
            onChange={e => update(i, { label: e.target.value })}
            placeholder={t("editor.display_label_placeholder")}
            className="h-8 text-xs"
          />
          <div className="flex items-center">
            <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("editor.move_up")}>
              <ArrowUpIcon className="size-3" />
            </button>
            <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={t("editor.move_down")}>
              <ArrowDownIcon className="size-3" />
            </button>
            <button type="button" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => remove(i)} aria-label={t("editor.delete")}>
              <XIcon className="size-3" />
            </button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add} className="h-6 text-[11px] px-2">
        {t("editor.add_field")}
      </Button>
    </div>
  )
}
