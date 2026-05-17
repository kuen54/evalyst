"use client"

import { useT } from "@/lib/i18n/provider"
import { RubricAnnotator } from "./rubric-annotator"
import type { Annotation, Criterion, GenericResultRecord, Rubric, TaskSchema } from "@/lib/schema/types"

interface Props {
  result: GenericResultRecord
  schema: TaskSchema
  experimentId?: string
  rubric?: Rubric | null
  annotationByTask?: Map<string, Annotation>
  onAnnotationSaved?: () => void
  className?: string
}

/**
 * 结果卡片底部的评分字段区域。
 * - 没挂 rubric 或 experimentId 缺失 → 渲染 null
 * - 上方分隔线 + 左侧 criterion: value 内联展示 + 右上角「评分/编辑」按钮（打开 RubricAnnotator dialog）
 */
export function ResultScoringSection({ result, schema, experimentId, rubric, annotationByTask, onAnnotationSaved, className }: Props) {
  const t = useT()
  if (!experimentId || !rubric) return null
  const existing = annotationByTask?.get(result.task_id) ?? null
  const buttonLabel = existing ? t("results.annotate.btn_edit") : t("results.annotate.btn_empty")

  return (
    <div className={`mt-1.5 pt-1.5 border-t border-border/60 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] min-w-0">
          {rubric.criteria.map(c => (
            <span key={c.key} className="inline-flex items-baseline gap-1">
              <span className="text-muted-foreground">{c.label}:</span>
              <span className="font-medium tabular-nums">{formatScore(existing?.scores[c.key] ?? null, c)}</span>
            </span>
          ))}
        </div>
        <RubricAnnotator
          experimentId={experimentId}
          taskId={result.task_id}
          rubric={rubric}
          {...(existing ? { existing } : {})}
          {...(onAnnotationSaved ? { onSaved: onAnnotationSaved } : {})}
          result={result}
          schema={schema}
          labelOverride={buttonLabel}
          triggerClassName="shrink-0"
        />
      </div>
    </div>
  )
}

function formatScore(v: number | boolean | null | undefined, c: Criterion): string {
  if (v == null) return "—"
  if (c.type === "pass_fail") return v ? "✓" : "✗"
  return String(v)
}
