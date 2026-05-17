"use client"

import { Badge } from "@/components/ui/badge"
import { useGlassStyle } from "@/components/glass/shell"
import { useCopilotOpen } from "@/components/glass/copilot-context"
import { PreviewCard } from "@base-ui/react/preview-card"
import { formatCostMap, formatTokens } from "@/lib/format"
import { STATUS_TONE_CLASS, type StatusInfo } from "@/lib/experiment-status"
import type { Rubric } from "@/lib/schema/types"

export type StatsAgg = {
  total_input_tokens: number | null | undefined
  total_output_tokens: number | null | undefined
  total_cost_by_currency: Record<string, number>
  has_token_data: boolean
  has_cost_data: boolean
}

export type ProgressInfo = { completed: number; total: number; failed: number }

interface Props {
  statusInfo: StatusInfo
  progressInfo: ProgressInfo | null
  statsAgg: StatsAgg
  rubric: Rubric | null
  t: (k: string, v?: Record<string, string | number>) => string
  className?: string
}

/** 实验状态胶囊：Badge + 可 hover info icon + 详情 popup（完成/失败/tokens/cost/rubric）。 */
export function ExperimentStatusBadge({ statusInfo, progressInfo, statsAgg, rubric, t, className }: Props) {
  const copilotOpen = useCopilotOpen()
  const glassStyle = useGlassStyle("thick")
  const hasDetails = !!progressInfo || statsAgg.has_token_data || !!rubric
  const toneClass = STATUS_TONE_CLASS[statusInfo.tone]
  const baseClass = `text-[11px] shrink-0 gap-1 ${toneClass}${className ? " " + className : ""}`

  if (!hasDetails) {
    return (
      <Badge variant="outline" className={baseClass}>
        {statusInfo.label}
      </Badge>
    )
  }

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={120}
        closeDelay={120}
        render={<Badge variant="outline" className={`${baseClass} cursor-help`} />}
      >
        <span>{statusInfo.label}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60" aria-hidden>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 11.5v-.5" />
          <path d="M8 9.5c0-1.5 2-1.5 2-3a2 2 0 1 0-4 0" />
        </svg>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[10000]">
          <PreviewCard.Popup
            className="min-w-[240px] bg-popover border border-border rounded-lg shadow-lg p-3 text-xs space-y-1"
            style={copilotOpen ? { ...glassStyle } : undefined}
            data-glass-variant={copilotOpen ? "thick" : undefined}
          >
            {progressInfo && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("experiment.completed_word")}</span>
                <span className="font-medium tabular-nums">{progressInfo.completed}/{progressInfo.total}</span>
              </div>
            )}
            {progressInfo && progressInfo.failed > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("dashboard.status_failed")}</span>
                <span className="font-medium text-red-500 tabular-nums">{progressInfo.failed}</span>
              </div>
            )}
            {statsAgg.has_token_data && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">tokens</span>
                <span className="font-medium tabular-nums">
                  {t("experiment.tokens_io", {
                    input: formatTokens(statsAgg.total_input_tokens),
                    output: formatTokens(statsAgg.total_output_tokens),
                  })}
                </span>
              </div>
            )}
            {statsAgg.has_cost_data && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">cost</span>
                <span className="font-medium tabular-nums">{formatCostMap(statsAgg.total_cost_by_currency)}</span>
              </div>
            )}
            {rubric && (
              <>
                <div className="border-t border-border/60 my-1.5" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t("experiment.status.rubric_label")}</span>
                  <span className="font-medium truncate max-w-[160px]" title={rubric.name}>{rubric.name}</span>
                </div>
              </>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
