// ---------- Experiment status badge state machine（双轴：生成 + 评分） ----------
// 同时被 dashboard 卡片 + 实验详情页头部消费。

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"
export type StatusInfo = { label: string; tone: StatusTone }

/** Tailwind class string per tone, applied on Badge variant="outline". */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30 dark:bg-destructive/20 dark:text-destructive-foreground",
}

interface ComputeStatusInput {
  /** experiment.status: "draft" | "running" | "paused" | "completed" | "failed" */
  experimentStatus: string
  /** 失败 task 数（completed 时优先反映） */
  failedCount: number
  /** 是否挂了 rubric_id（评估轴是否启用） */
  hasRubric: boolean
  /** 已标注数（rubric aggregate） */
  annotatedCount: number
  /** 评估覆盖范围（结果数量 / aggregate.total_tasks，已兜底） */
  evalTotal: number
  t: (k: string, v?: Record<string, string | number>) => string
}

/**
 * 状态机（顺序）：
 *   1. 非 completed → 直接映射 dashboard.status_*
 *   2. completed + failed > 0      → 已生成 · N 失败 (warning)
 *   3. completed + 无 rubric        → 已生成 (success)
 *   4. completed + rubric, evalTotal=0 → 已生成 (success)  ※ 兜底（aggregate 数据缺失）
 *   5. completed + rubric, 0 标注    → 已生成 · 待评分 (warning)
 *   6. completed + rubric, 部分标注  → 已生成 · 评分 X/Y (info)
 *   7. completed + rubric, 全标注    → 已生成 · 已评分 (success)
 */
export function computeStatusInfo(input: ComputeStatusInput): StatusInfo {
  const { experimentStatus, failedCount, hasRubric, annotatedCount, evalTotal, t } = input

  if (experimentStatus !== "completed") {
    const tone: StatusTone = experimentStatus === "running"
      ? "info"
      : experimentStatus === "failed"
        ? "danger"
        : experimentStatus === "paused"
          ? "warning"
          : "neutral"
    return { label: t(`dashboard.status_${experimentStatus}`), tone }
  }

  if (failedCount > 0) {
    return { label: t("experiment.status.completed_with_failures", { n: failedCount }), tone: "warning" }
  }

  if (!hasRubric || evalTotal === 0) {
    return { label: t("dashboard.status_completed"), tone: "success" }
  }

  if (annotatedCount === 0) {
    return { label: t("experiment.status.awaiting_review"), tone: "warning" }
  }

  if (annotatedCount < evalTotal) {
    return { label: t("experiment.status.reviewing", { n: annotatedCount, total: evalTotal }), tone: "info" }
  }

  return { label: t("experiment.status.fully_done"), tone: "success" }
}
