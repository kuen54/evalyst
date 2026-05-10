"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react"
import { useT } from "@/lib/i18n/provider"

/** Array<string | number> 的可上下重排编辑器 */
export function OrderListEditor({
  value,
  onChange,
  placeholder,
  hint,
}: {
  value: Array<string | number>
  onChange: (v: Array<string | number>) => void
  placeholder?: string
  hint?: string
}) {
  const t = useT()
  const ph = placeholder ?? t("editor.value")
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const update = (i: number, raw: string) => {
    const n = Number(raw)
    const v: string | number = raw !== "" && !isNaN(n) && String(n) === raw ? n : raw
    onChange(value.map((x, idx) => idx === i ? v : x))
  }
  const add = () => onChange([...value, ""])

  return (
    <div className="space-y-1.5">
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">{t("editor.empty_prompt_add")}</p>
      )}
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground font-mono w-4 text-right">{i + 1}.</span>
          <Input
            value={String(v)}
            onChange={e => update(i, e.target.value)}
            placeholder={ph}
            className="h-7 text-[11px] flex-1"
          />
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
      ))}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={add} className="h-6 text-[11px] px-2">
          {t("editor.add")}
        </Button>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  )
}
