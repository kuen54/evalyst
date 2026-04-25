"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react"
import { KeyValueEditor } from "./key-value-editor"
import { useT } from "@/lib/i18n/provider"
import type { TFn } from "@/lib/i18n/provider"
import type { TransformStep } from "@/lib/schema/types"

type Op = TransformStep["op"]

function buildOpMeta(t: TFn): Array<{ op: Op; label: string; hint: string }> {
  return [
    { op: "join", label: t("transform.op_join"), hint: t("transform.op_join_hint") },
    { op: "truncate", label: t("transform.op_truncate"), hint: t("transform.op_truncate_hint") },
    { op: "slice", label: t("transform.op_slice"), hint: t("transform.op_slice_hint") },
    { op: "eq", label: t("transform.op_eq"), hint: t("transform.op_eq_hint") },
    { op: "notEmpty", label: t("transform.op_notempty"), hint: t("transform.op_notempty_hint") },
    { op: "default", label: t("transform.op_default"), hint: t("transform.op_default_hint") },
    { op: "map", label: t("transform.op_map"), hint: t("transform.op_map_hint") },
    { op: "prompt_excerpt", label: t("transform.op_prompt_excerpt"), hint: t("transform.op_prompt_excerpt_hint") },
    { op: "spu_desc_list", label: t("transform.op_spu_desc_list"), hint: t("transform.op_spu_desc_list_hint") },
    { op: "js", label: t("transform.op_js"), hint: t("transform.op_js_hint") },
  ]
}

export function TransformChainEditor({
  value,
  onChange,
}: {
  value: TransformStep[]
  onChange: (v: TransformStep[]) => void
}) {
  const t = useT()
  const [addOp, setAddOp] = useState<Op>("join")
  const opMeta = useMemo(() => buildOpMeta(t), [t])
  const opLabels = useMemo(() => Object.fromEntries(opMeta.map(m => [m.op, m.label])) as Record<Op, string>, [opMeta])

  const update = (i: number, patch: Partial<TransformStep>) =>
    onChange(value.map((s, idx) => idx === i ? { ...s, ...patch } as TransformStep : s))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = () => onChange([...value, defaultStep(addOp)])

  return (
    <div className="space-y-1.5">
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">{t("transform.empty")}</p>
      )}
      {value.map((step, i) => (
        <div key={i} className="rounded border bg-muted/30 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">#{i + 1}</Badge>
            <span className="text-xs font-mono">{opLabels[step.op] ?? step.op}</span>
            <div className="ml-auto flex items-center">
              <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUpIcon className="size-3" />
              </button>
              <button type="button" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDownIcon className="size-3" />
              </button>
              <button type="button" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
                <XIcon className="size-3" />
              </button>
            </div>
          </div>
          <StepParams step={step} onUpdate={p => update(i, p)} t={t} />
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Select value={addOp} onValueChange={v => setAddOp(v as Op)}>
          <SelectTrigger className="h-7 text-[11px] w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {opMeta.map(m => (
              <SelectItem key={m.op} value={m.op} className="text-xs">
                <div>
                  <div>{m.label}</div>
                  <div className="text-[10px] text-muted-foreground">{m.hint}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={add} className="h-7 text-[11px] px-2">{t("transform.add_btn")}</Button>
      </div>
    </div>
  )
}

function StepParams({ step, onUpdate, t }: { step: TransformStep; onUpdate: (p: Partial<TransformStep>) => void; t: TFn }) {
  switch (step.op) {
    case "join":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_sep")}</ParamLabel>
          <Input value={step.sep} onChange={e => onUpdate({ sep: e.target.value } as Partial<TransformStep>)} placeholder="、" className="h-7 text-[11px]" />
        </div>
      )
    case "truncate":
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_max")}</ParamLabel>
            <Input type="number" value={step.max ?? ""} onChange={e => onUpdate({ max: Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
          </div>
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_suffix")}</ParamLabel>
            <Input value={step.suffix ?? ""} onChange={e => onUpdate({ suffix: e.target.value } as Partial<TransformStep>)} placeholder="…" className="h-7 text-[11px]" />
          </div>
        </div>
      )
    case "slice":
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_start")}</ParamLabel>
            <Input type="number" value={step.start ?? ""} onChange={e => onUpdate({ start: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
          </div>
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_end")}</ParamLabel>
            <Input type="number" value={step.end ?? ""} onChange={e => onUpdate({ end: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
          </div>
        </div>
      )
    case "eq":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_eq_value")}</ParamLabel>
          <Input value={stringifyLiteral(step.value)} onChange={e => onUpdate({ value: parseLiteral(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
        </div>
      )
    case "notEmpty":
      return <p className="text-[11px] text-muted-foreground">{t("transform.no_params")}</p>
    case "default":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_default_value")}</ParamLabel>
          <Input value={step.value} onChange={e => onUpdate({ value: e.target.value } as Partial<TransformStep>)} className="h-7 text-[11px]" />
        </div>
      )
    case "map":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_mapping")}</ParamLabel>
          <KeyValueEditor
            value={step.mapping}
            onChange={m => onUpdate({ mapping: m } as Partial<TransformStep>)}
            keyPlaceholder={t("transform.param_mapping_key")}
            valuePlaceholder={t("transform.param_mapping_value")}
          />
        </div>
      )
    case "prompt_excerpt":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_max_len")}</ParamLabel>
          <Input type="number" value={step.maxLen ?? ""} onChange={e => onUpdate({ maxLen: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
        </div>
      )
    case "spu_desc_list":
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_max_spus")}</ParamLabel>
            <Input type="number" value={step.maxSpus ?? ""} onChange={e => onUpdate({ maxSpus: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
          </div>
          <div className="space-y-0.5">
            <ParamLabel>{t("transform.param_max_chars_per_spu")}</ParamLabel>
            <Input type="number" value={step.maxCharsPerSpu ?? ""} onChange={e => onUpdate({ maxCharsPerSpu: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TransformStep>)} className="h-7 text-[11px]" />
          </div>
        </div>
      )
    case "js":
      return (
        <div className="space-y-0.5">
          <ParamLabel>{t("transform.param_js_body")}</ParamLabel>
          <Textarea
            value={step.fn}
            onChange={e => onUpdate({ fn: e.target.value } as Partial<TransformStep>)}
            placeholder="return String(v).toUpperCase()"
            className="font-mono text-[11px] min-h-[50px]"
          />
        </div>
      )
  }
}

function ParamLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] text-muted-foreground">{children}</label>
}

function defaultStep(op: Op): TransformStep {
  switch (op) {
    case "join": return { op, sep: "、" }
    case "truncate": return { op, max: 200 }
    case "slice": return { op }
    case "eq": return { op, value: "" }
    case "notEmpty": return { op }
    case "default": return { op, value: "" }
    case "map": return { op, mapping: {} }
    case "prompt_excerpt": return { op }
    case "spu_desc_list": return { op }
    case "js": return { op, fn: "return v" }
  }
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim()
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  const n = Number(s)
  if (!isNaN(n) && s !== "") return n
  return raw
}

function stringifyLiteral(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "boolean" || typeof v === "number") return String(v)
  return String(v)
}
