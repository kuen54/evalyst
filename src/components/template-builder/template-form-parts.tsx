"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { GlassCard } from "@/components/copilot/shell"
import type { TFn } from "@/lib/i18n/provider"
import type { DatasetDef, Display, TaskSchema } from "@/lib/schema/types"
import { inferDisplayBuiltinId } from "@/lib/display-inference"
import { generateMockResults } from "@/lib/mock-data"
import { pickView } from "@/components/results/registry"
import {
  buildSchemaFromForm,
  type TemplateFormState,
  type FormOutputField,
} from "@/components/template-builder/form-state"

/** 可选 output type 选项。和 OUTPUT_TYPE_OPTIONS 在 template-form-page 的同步保持。 */
const OUTPUT_TYPE_OPTIONS: FormOutputField["type"][] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "string|null",
  "tuple:number[]",
  "image_url",
  "image_url_list",
]

/** 不可变 update 辅助：拷贝数组 → 合并 patch → 通过 set 回写 */
export function updateItem<K extends "inputs" | "variables" | "output_fields" | "display_dimensions">(
  form: TemplateFormState,
  set: <K2 extends keyof TemplateFormState>(k: K2, v: TemplateFormState[K2]) => void,
  key: K,
  index: number,
  patch: Partial<TemplateFormState[K][number]>,
) {
  const next = [...form[key]]
  const merged = { ...next[index], ...patch } as TemplateFormState[K][number] & Record<string, unknown>
  // eopt: explicit `undefined` in patch means "clear the optional key" — strip it out
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) delete merged[k]
  }
  next[index] = merged as TemplateFormState[K][number]
  set(key, next as TemplateFormState[K])
}

/** 右栏实时预览：读 form → build schema → pickView → 用 mock records 渲染 */
export function PreviewPane({ form, datasets, displays, datasetSamples, t }: {
  form: TemplateFormState
  datasets: DatasetDef[]
  displays: Display[]
  datasetSamples: Record<string, Record<string, unknown>[]>
  t: TFn
}) {
  const { schema, errors } = buildSchemaFromForm(form)

  const inferredId = schema ? inferDisplayBuiltinId(schema) : "builtin_json_default"
  const overrideId = form.display_id_override
  const effective = overrideId || inferredId
  const effectiveDisplay = displays.find(d => d.id === effective)

  const mockResults = useMemo(() => {
    if (!schema) return []
    return generateMockResults(schema, datasets, datasetSamples, 3)
  }, [schema, datasets, datasetSamples])

  const view = schema ? pickView(schema, effectiveDisplay) : null
  const ViewComp = view?.component

  return (
    <div className="sticky top-6 max-h-[calc(100vh-140px)] overflow-y-auto pr-2">
      <GlassCard>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{t("settings.templates.tform.preview_title")}</h4>
            <Badge variant="outline" className="text-[10px]">{t("settings.templates.tform.preview_mock_badge")}</Badge>
          </div>

          {errors.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <div className="mb-1">{t("settings.templates.tform.preview_errors_prefix", { n: errors.length })}</div>
              <ul className="space-y-0.5 pl-4 list-disc text-red-600">
                {errors.slice(0, 3).map((e, i) => <li key={i}><span className="font-mono">{e.field}</span>: {e.message}</li>)}
              </ul>
            </div>
          ) : (
            <>
              <div className="text-xs space-y-0.5">
                <div>
                  <span className="text-muted-foreground">{t("settings.templates.tform.preview_dims_label")}</span>
                  <Badge variant="secondary" className="text-[10px] ml-1">{form.display_dimensions.length}</Badge>
                  <span className="text-muted-foreground ml-3">{t("settings.templates.tform.preview_display_label")}</span>
                  <span className="font-mono ml-1">{effective}</span>
                  {overrideId && <Badge variant="outline" className="text-[10px] ml-1">{t("settings.templates.tform.preview_override_badge")}</Badge>}
                </div>
              </div>

              <Separator />

              {mockResults.length > 0 && schema && ViewComp ? (
                <div className="scale-[0.85] origin-top-left" style={{ width: "117.65%" }}>
                  <ViewComp results={mockResults} schema={schema} />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-8 text-center">
                  {form.inputs.some(i => !i.dataset_id) ? t("settings.templates.tform.preview_no_dataset") : t("settings.templates.tform.preview_loading")}
                </div>
              )}
            </>
          )}
        </CardContent>
      </GlassCard>
    </div>
  )
}

/** JSON 粘贴 pane：解析 → 基础校验 → 回调 onApply(schema) */
export function JsonApplyPane({ onApply, t }: { onApply: (schema: TaskSchema) => void; t: TFn }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [parsedPreview, setParsedPreview] = useState<Record<string, unknown> | null>(null)

  const parseAndApply = () => {
    setError(null)
    setParsedPreview(null)
    if (!text.trim()) {
      setError(t("settings.templates.tform.paste_empty_err"))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setError(t("settings.templates.tform.paste_parse_err", { message: (e as Error).message }))
      return
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setError(t("settings.templates.tform.paste_root_err"))
      return
    }
    const obj = parsed as Record<string, unknown>
    const missing = ["id", "label", "inputs", "output_schema"].filter(k => !obj[k])
    if (missing.length) {
      setError(t("settings.templates.tform.paste_missing_err", { fields: missing.join(", ") }))
      return
    }
    setParsedPreview(obj)
    onApply(obj as unknown as TaskSchema)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-medium">{t("settings.templates.tform.paste_json_title")}</h3>
        <Button size="sm" onClick={parseAndApply}>{t("settings.templates.tform.paste_parse_btn")}</Button>
      </div>
      <p className="text-xs text-muted-foreground mb-2 shrink-0">
        {t("settings.templates.tform.paste_applied_hint")}
      </p>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t("settings.templates.tform.paste_placeholder")}
        className="flex-1 min-h-0 font-mono text-xs"
      />
      {error && (
        <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/40 text-xs text-red-700 dark:text-red-300 shrink-0">
          {error}
        </div>
      )}
      {parsedPreview && !error && (
        <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/40 text-xs text-emerald-700 dark:text-emerald-300 shrink-0">
          {t("settings.templates.tform.paste_applied_badge")}<span className="font-mono">{String(parsedPreview.id)}</span> · {String(parsedPreview.label)}
        </div>
      )}
    </div>
  )
}

/** 扫描 prompt 模板里的 {{var}} 占位，和 declaredVars 做 diff，标红缺失 / 提示冗余 */
export function PromptVariableLint({ text, declaredVars, t }: { text: string; declaredVars: string[]; t: TFn }) {
  const used = Array.from(text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)).map(m => m[1]!)
  const usedSet = new Set(used)
  const declaredSet = new Set(declaredVars)
  const missing = Array.from(usedSet).filter(v => !declaredSet.has(v))
  const unused = declaredVars.filter(v => !usedSet.has(v))

  if (declaredVars.length === 0 && used.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className="text-muted-foreground">{t("settings.templates.tform.lint_available_vars")}</span>
      {declaredVars.map(v => (
        <span
          key={v}
          className={`font-mono ${usedSet.has(v) ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40"}`}
          title={usedSet.has(v) ? t("settings.templates.tform.lint_used_title") : t("settings.templates.tform.lint_unused_title")}
        >
          {`{{${v}}}`}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="text-destructive">
          {t("settings.templates.tform.lint_missing", { vars: missing.map(v => `{{${v}}}`).join(" ") })}
        </span>
      )}
      {unused.length > 0 && missing.length === 0 && (
        <span className="text-muted-foreground">{t("settings.templates.tform.lint_unused_count", { n: unused.length })}</span>
      )}
    </div>
  )
}

/** 一条 output schema 字段的编辑行：name / type / required / 可展开约束（min/max_length、tuple_len、enum） */
export function OutputFieldRow({
  field, rawTextMode, disallowedType, canDelete, onChange, onDelete, t,
}: {
  field: FormOutputField
  rawTextMode: boolean
  disallowedType: boolean
  canDelete: boolean
  onChange: (patch: Partial<FormOutputField>) => void
  onDelete: () => void
  t: TFn
}) {
  const [expanded, setExpanded] = useState(false)
  const supportsLength = field.type === "string" || field.type === "string|null"
  const supportsTupleLen = field.type === "tuple:number[]"
  const hasConstraints =
    field.max_length != null || field.min_length != null || field.enum_values.length > 0 || field.tuple_len != null

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2fr_1fr_80px_auto_auto] gap-2 items-center">
        <Input
          value={field.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={t("settings.templates.tform.field_name_placeholder")}
          className="h-8 text-xs font-mono"
        />
        <Select
          value={field.type}
          onValueChange={v => { if (v) onChange({ type: v as FormOutputField["type"] }) }}
          disabled={rawTextMode}
        >
          <SelectTrigger className="h-8 text-xs" aria-invalid={disallowedType}><SelectValue /></SelectTrigger>
          <SelectContent>
            {OUTPUT_TYPE_OPTIONS.map(ty => (
              <SelectItem key={ty} value={ty} disabled={rawTextMode && ty !== "string"}>
                {ty}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox
            checked={field.required}
            disabled={rawTextMode}
            onCheckedChange={v => onChange({ required: !!v })}
          />
          {t("settings.templates.tform.required_word")}
        </label>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? "▾" : "▸"} {t("settings.templates.tform.constraints_label")}
          {hasConstraints && <Badge variant="outline" className="ml-1 text-[9px] px-1">{t("settings.templates.tform.constraints_set_badge")}</Badge>}
        </button>
        <button
          className="text-[11px] text-muted-foreground hover:text-red-500 disabled:opacity-40"
          disabled={!canDelete}
          onClick={onDelete}
        >{t("common.delete")}</button>
      </div>
      {expanded && (
        <div className="ml-2 pl-3 border-l-2 border-border space-y-2 py-1.5">
          {supportsLength ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[11px]">{t("settings.templates.tform.min_length")}</Label>
                <Input
                  type="number"
                  value={field.min_length ?? ""}
                  onChange={e => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value)
                    onChange({ min_length: v } as Partial<FormOutputField>)
                  }}
                  placeholder={t("settings.templates.tform.unlimited")}
                  className="h-7 text-[11px]"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[11px]">{t("settings.templates.tform.max_length")}</Label>
                <Input
                  type="number"
                  value={field.max_length ?? ""}
                  onChange={e => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value)
                    onChange({ max_length: v } as Partial<FormOutputField>)
                  }}
                  placeholder={t("settings.templates.tform.unlimited")}
                  className="h-7 text-[11px]"
                />
              </div>
            </div>
          ) : null}
          {supportsTupleLen ? (
            <div className="space-y-0.5">
              <Label className="text-[11px]">{t("settings.templates.tform.tuple_len_label")}</Label>
              <Input
                type="number"
                value={field.tuple_len ?? ""}
                onChange={e => {
                  const v = e.target.value === "" ? undefined : Number(e.target.value)
                  onChange({ tuple_len: v } as Partial<FormOutputField>)
                }}
                placeholder={t("settings.templates.tform.tuple_len_placeholder")}
                className="h-7 text-[11px]"
              />
            </div>
          ) : null}
          {(field.type === "string" || field.type === "number") && (
            <div className="space-y-0.5">
              <Label className="text-[11px]">{t("settings.templates.tform.enum_label")}</Label>
              <EnumValuesEditor
                value={field.enum_values}
                onChange={vals => onChange({ enum_values: vals })}
                t={t}
              />
              <p className="text-[10px] text-muted-foreground">{t("settings.templates.tform.enum_hint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** enum_values 编辑器：Badge × 已有值 + Input 添加新值（Enter / blur 提交，重复值忽略） */
function EnumValuesEditor({ value, onChange, t }: { value: string[]; onChange: (v: string[]) => void; t: TFn }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const tr = draft.trim()
    if (!tr) return
    if (value.includes(tr)) { setDraft(""); return }
    onChange([...value, tr])
    setDraft("")
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((v, i) => (
        <Badge key={i} variant="secondary" className="text-[10px] gap-1">
          {v}
          <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={t("settings.templates.tform.enum_placeholder")}
        className="h-6 w-[120px] text-[11px]"
      />
    </div>
  )
}
