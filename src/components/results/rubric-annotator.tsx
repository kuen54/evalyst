"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"
import type { Annotation, Criterion, Rubric, GenericResultRecord, TaskSchema } from "@/lib/schema/types"
import { toast } from "sonner"
import { CheckIcon, XIcon } from "lucide-react"
import { renderField, readField } from "./view-helpers"
import { getOutputFields } from "./output-structure"

interface Props {
  experimentId: string
  taskId: string
  rubric: Rubric
  existing?: Annotation | null
  onSaved?: (a: Annotation) => void
  triggerClassName?: string
  /** Optional result + schema for inline preview (esp. image generation rubrics) */
  result?: GenericResultRecord
  schema?: TaskSchema
}

function emptyScores(rubric: Rubric): Record<string, number | boolean | null> {
  const r: Record<string, number | boolean | null> = {}
  for (const c of rubric.criteria) r[c.key] = null
  return r
}

export function RubricAnnotator({ experimentId, taskId, rubric, existing, onSaved, triggerClassName, result, schema }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [scores, setScores] = useState<Record<string, number | boolean | null>>(() =>
    existing ? { ...emptyScores(rubric), ...existing.scores } : emptyScores(rubric)
  )
  const [rationale, setRationale] = useState(existing?.rationale ?? "")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setScores(existing ? { ...emptyScores(rubric), ...existing.scores } : emptyScores(rubric))
      setRationale(existing?.rationale ?? "")
    }
  }, [open, existing, rubric])

  const setScore = (key: string, v: number | boolean | null) => {
    setScores(s => ({ ...s, [key]: v }))
  }

  const handleSave = async () => {
    // 过滤未填的 criterion
    const filtered: Record<string, number | boolean> = {}
    for (const [k, v] of Object.entries(scores)) {
      if (v !== null && v !== undefined) filtered[k] = v
    }
    // 校验 required
    for (const c of rubric.criteria) {
      if (c.required && !(c.key in filtered)) {
        toast.error(t("results.annotate.required_missing", { key: c.label }))
        return
      }
    }
    setSubmitting(true)
    const res = await fetch(`/api/experiments/${experimentId}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        rubric_id: rubric.id,
        evaluator: "human",
        scores: filtered,
        rationale: rationale.trim() || undefined,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "save failed" }))
      toast.error(j.error || t("results.annotate.save_fail"))
      return
    }
    const saved = await res.json() as Annotation
    toast.success(t("results.annotate.saved"))
    setOpen(false)
    onSaved?.(saved)
  }

  // 按钮上的汇总 label
  let buttonLabel = t("results.annotate.btn_empty")
  let buttonVariant: "outline" | "secondary" = "outline"
  if (existing) {
    buttonLabel = summarizeScores(existing.scores, rubric.criteria)
    buttonVariant = "secondary"
  }

  return (
    <>
      <Button
        size="sm"
        variant={buttonVariant}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className={`h-6 text-[10px] px-1.5 ${triggerClassName ?? ""}`}
      >
        {buttonLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("results.annotate.dialog_title")}</DialogTitle>
            <p className="text-xs text-muted-foreground">{rubric.name}</p>
          </DialogHeader>
          {result && schema && hasImageOutput(schema) && (
            <ResultPreview result={result} schema={schema} t={t} />
          )}
          <div className="space-y-4 py-2 max-h-[55vh] overflow-auto pr-2">
            {rubric.criteria.map(c => (
              <CriterionRow
                key={c.key}
                criterion={c}
                value={scores[c.key] ?? null}
                onChange={v => setScore(c.key, v)}
                t={t}
              />
            ))}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("results.annotate.rationale")}</Label>
              <Textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2} className="text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" onClick={handleSave} disabled={submitting}>
              {submitting ? t("results.annotate.saving") : t("results.annotate.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CriterionRow({
  criterion: c,
  value,
  onChange,
  t,
}: {
  criterion: Criterion
  value: number | boolean | null
  onChange: (v: number | boolean | null) => void
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{c.label}</Label>
        {c.required && <Badge variant="outline" className="text-[9px] h-4 px-1 border-destructive/40 text-destructive">*</Badge>}
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">{c.key}</span>
      </div>
      {c.description && <p className="text-[11px] text-muted-foreground">{c.description}</p>}
      {c.type === "pass_fail" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={value === true ? "default" : "outline"}
            onClick={() => onChange(value === true ? null : true)}
            className="h-8 flex-1 text-xs"
          >
            <CheckIcon className="size-3 mr-1" />
            {t("common.pass")}
          </Button>
          <Button
            size="sm"
            variant={value === false ? "destructive" : "outline"}
            onClick={() => onChange(value === false ? null : false)}
            className="h-8 flex-1 text-xs"
          >
            <XIcon className="size-3 mr-1" />
            {t("common.fail")}
          </Button>
        </div>
      )}
      {c.type === "likert_1_5" && (
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <Button
              key={n}
              size="sm"
              variant={value === n ? "default" : "outline"}
              onClick={() => onChange(value === n ? null : n)}
              className="h-8 flex-1 text-xs"
            >
              {n}
            </Button>
          ))}
        </div>
      )}
      {c.type === "score_0_100" && (
        <Input
          type="number"
          min={0}
          max={100}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={e => {
            const v = e.target.value
            if (v === "") onChange(null)
            else {
              const n = Number(v)
              if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)))
            }
          }}
          className="h-8 text-xs"
          placeholder="0-100"
        />
      )}
    </div>
  )
}

function summarizeScores(scores: Record<string, number | boolean>, criteria: Criterion[]): string {
  const parts: string[] = []
  for (const c of criteria) {
    const v = scores[c.key]
    if (v === undefined) continue
    if (c.type === "pass_fail") parts.push(v === true ? "✓" : "✗")
    else if (c.type === "likert_1_5") parts.push(String(v))
    else if (c.type === "score_0_100") parts.push(String(v))
  }
  return parts.length > 0 ? parts.join(" · ") : "?"
}

function hasImageOutput(schema: TaskSchema): boolean {
  const fields = getOutputFields(schema.output_schema)
  return fields.some(f => f.type === "image_url" || f.type === "image_url_list")
}

function ResultPreview({
  result,
  schema,
  t,
}: {
  result: GenericResultRecord
  schema: TaskSchema
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  const fields = getOutputFields(schema.output_schema)
  const imageFields = fields.filter(f => f.type === "image_url" || f.type === "image_url_list")
  const inputPreviewKeys = Object.keys(result.input_preview)

  return (
    <div className="grid grid-cols-2 gap-3 py-2 border-y border-border/50">
      {/* Left: input preview (key fields) */}
      <div className="space-y-1.5 text-xs overflow-auto max-h-[30vh]">
        <div className="text-muted-foreground font-medium">{t("results.annotate.preview_input")}</div>
        {inputPreviewKeys.length === 0 ? (
          <div className="text-muted-foreground italic">-</div>
        ) : (
          inputPreviewKeys.map(k => (
            <div key={k} className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground font-mono">{k}</div>
              <div className="text-foreground break-words">{String(result.input_preview[k] ?? "")}</div>
            </div>
          ))
        )}
      </div>
      {/* Right: image output(s) */}
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">{t("results.annotate.preview_image")}</div>
        {imageFields.map(f => {
          const value = readField(result, `output.${f.name}`)
          if (value == null || value === "") return (
            <div key={f.name} className="text-xs text-muted-foreground italic">-</div>
          )
          return (
            <div key={f.name} className="max-h-[30vh] overflow-hidden rounded">
              {renderField(value, "image")}
            </div>
          )
        })}
      </div>
    </div>
  )
}
