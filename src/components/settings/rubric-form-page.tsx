"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StickySaveBar } from "@/components/ui/sticky-save-bar"
import { useT } from "@/lib/i18n/provider"
import type { Rubric, Criterion, CriterionType } from "@/lib/schema/types"
import { XIcon, ArrowUpIcon, ArrowDownIcon } from "lucide-react"

interface Props {
  mode: "create" | "edit"
  initial?: Rubric
}

function emptyCriterion(): Criterion {
  return { key: "", label: "", type: "pass_fail" }
}

export function RubricFormPage({ mode, initial }: Props) {
  const t = useT()
  const router = useRouter()
  const [id, setId] = useState(initial?.id ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [criteria, setCriteria] = useState<Criterion[]>(initial?.criteria ?? [emptyCriterion()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initial) {
      setId(initial.id)
      setName(initial.name)
      setDescription(initial.description ?? "")
      setCriteria(initial.criteria)
    }
  }, [initial])

  const updateC = (i: number, patch: Partial<Criterion>) => {
    setCriteria(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= criteria.length) return
    const next = criteria.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setCriteria(next)
  }
  const remove = (i: number) => setCriteria(cs => cs.filter((_, j) => j !== i))
  const add = () => setCriteria(cs => [...cs, emptyCriterion()])

  const handleSave = async () => {
    setError(null)
    if (mode === "create" && !/^[a-z][a-z0-9_]*$/.test(id)) {
      setError(t("settings.rubrics.form.id_invalid"))
      return
    }
    if (!name.trim()) {
      setError(t("settings.rubrics.form.name_required"))
      return
    }
    if (criteria.length === 0) {
      setError(t("settings.rubrics.form.criteria_required"))
      return
    }
    const keys = new Set<string>()
    for (const c of criteria) {
      if (!/^[a-z][a-z0-9_]*$/.test(c.key)) {
        setError(t("settings.rubrics.form.criterion_key_invalid", { key: c.key || "(empty)" }))
        return
      }
      if (keys.has(c.key)) {
        setError(t("settings.rubrics.form.criterion_key_dup", { key: c.key }))
        return
      }
      keys.add(c.key)
      if (!c.label.trim()) {
        setError(t("settings.rubrics.form.criterion_label_required", { key: c.key }))
        return
      }
    }

    setSubmitting(true)
    const body: Rubric = {
      id,
      name: name.trim(),
      description: description.trim() || undefined,
      criteria,
    }
    const url = mode === "create" ? "/api/rubrics" : `/api/rubrics/${id}`
    const method = mode === "create" ? "POST" : "PATCH"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSubmitting(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "save failed" }))
      setError(j.error || "save failed")
      return
    }
    toast.success(t("settings.rubrics.form.saved_toast"))
    router.push(mode === "edit" && initial ? `/settings/rubrics/${initial.id}` : "/settings/rubrics")
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={mode === "edit" && initial ? `/settings/rubrics/${initial.id}` : "/settings/rubrics"} className="text-xs text-muted-foreground hover:text-foreground">
          {mode === "edit" ? t("settings.rubrics.form.back_to_detail") : t("settings.rubrics.detail.back")}
        </Link>
        <h2 className="text-lg font-semibold tracking-tight mt-1">
          {mode === "create" ? t("settings.rubrics.form.new_title") : t("settings.rubrics.form.edit_title")}
        </h2>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("settings.rubrics.form.id_label")} {mode === "create" && <span className="text-red-500">*</span>}</Label>
              <Input
                value={id}
                onChange={e => setId(e.target.value)}
                placeholder="qa_accuracy"
                disabled={mode === "edit"}
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.rubrics.form.name_label")} <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="h-8" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.rubrics.form.description_label")}</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="text-sm" />
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {t("settings.rubrics.form.criteria_header")}
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">{t("settings.rubrics.form.criteria_hint")}</p>
        <div className="space-y-2">
          {criteria.map((c, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-[1fr_1fr_140px] gap-2 items-start">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("settings.rubrics.form.criterion_key")}</Label>
                    <Input
                      value={c.key}
                      onChange={e => updateC(i, { key: e.target.value })}
                      placeholder="correct"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("settings.rubrics.form.criterion_label")}</Label>
                    <Input
                      value={c.label}
                      onChange={e => updateC(i, { label: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("settings.rubrics.form.criterion_type")}</Label>
                    <Select value={c.type} onValueChange={v => { if (v) updateC(i, { type: v as CriterionType }) }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pass_fail">{t("settings.rubrics.form.type_pass_fail")}</SelectItem>
                        <SelectItem value="likert_1_5">{t("settings.rubrics.form.type_likert")}</SelectItem>
                        <SelectItem value="score_0_100">{t("settings.rubrics.form.type_numeric")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.rubrics.form.criterion_description")}</Label>
                  <Textarea
                    value={c.description ?? ""}
                    onChange={e => updateC(i, { description: e.target.value })}
                    rows={2}
                    className="text-xs"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={!!c.required}
                      onCheckedChange={v => updateC(i, { required: !!v })}
                    />
                    {t("settings.rubrics.form.criterion_required")}
                  </label>
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">#{i + 1}</Badge>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1">
                    <ArrowUpIcon className="size-3" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === criteria.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1">
                    <ArrowDownIcon className="size-3" />
                  </button>
                  <button type="button" onClick={() => remove(i)} disabled={criteria.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30 p-1">
                    <XIcon className="size-3" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button size="sm" variant="outline" onClick={add} className="w-full">
            {t("settings.rubrics.form.add_criterion")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-destructive/50 bg-destructive/5 text-xs text-destructive">
          {error}
        </div>
      )}

      <StickySaveBar onSave={handleSave} submitting={submitting} saveLabel={t("settings.rubrics.form.save_btn")} />
    </div>
  )
}
