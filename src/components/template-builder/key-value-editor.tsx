"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useT } from "@/lib/i18n/provider"

/** Record<string, string> 的 key/value 行编辑器 */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
}) {
  const t = useT()
  const kPh = keyPlaceholder ?? t("editor.key")
  const vPh = valuePlaceholder ?? t("editor.value")
  const addLbl = addLabel ?? t("editor.add_pair")
  const entries = Object.entries(value)

  const update = (idx: number, newKey: string, newVal: string) => {
    const next: Record<string, string> = {}
    entries.forEach(([k, v], i) => {
      if (i === idx) next[newKey] = newVal
      else next[k] = v
    })
    onChange(next)
  }

  const remove = (idx: number) => {
    const next: Record<string, string> = {}
    entries.forEach(([k, v], i) => { if (i !== idx) next[k] = v })
    onChange(next)
  }

  const add = () => {
    let i = 1
    while (value[`key${i}`] !== undefined) i++
    onChange({ ...value, [`key${i}`]: "" })
  }

  return (
    <div className="space-y-1.5">
      {entries.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">{t("editor.empty_prompt_add_pair")}</p>
      )}
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={e => update(i, e.target.value, v)}
            placeholder={kPh}
            className="h-7 text-[11px] font-mono flex-1"
          />
          <span className="text-[11px] text-muted-foreground">→</span>
          <Input
            value={v}
            onChange={e => update(i, k, e.target.value)}
            placeholder={vPh}
            className="h-7 text-[11px] flex-1"
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive p-1"
            onClick={() => remove(i)}
            aria-label={t("editor.delete")}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add} className="h-6 text-[11px] px-2">
        {addLbl}
      </Button>
    </div>
  )
}
