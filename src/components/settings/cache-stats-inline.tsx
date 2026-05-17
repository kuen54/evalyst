"use client"

import { useEffect, useState } from "react"
import { PreviewCard } from "@base-ui/react/preview-card"
import { useT } from "@/lib/i18n/provider"
import { useGlassStyle } from "@/components/glass/shell"
import { useCopilotOpen } from "@/components/glass/copilot-context"
import type { CacheUsageStat } from "@/copilot/lib/cache-stats-store"
import type { CacheHitRateResult, CacheBreaksSummary } from "@/copilot/lib/cache-aggregate"
import type { BreakPair } from "@/copilot/lib/cache-break-detect"

interface ApiResponse {
  weekly: CacheHitRateResult & CacheBreaksSummary & {
    recent: CacheUsageStat[]
    recent_break_reasons: { system_prompt: number; tools: number; unknown: number }
    latest_break_pair: BreakPair | null
  }
}

function formatPct(r: number | null): string {
  if (r === null) return "—"
  return `${Math.round(r * 100)}%`
}

interface Props {
  /** 模型 id（CacheUsageStat.model 字段值，对应 ModelConfig.model） */
  model: string
}

/**
 * 设置页 per-model cache 命中可观测组件：
 * 默认 inline 展示「Cache 7d {pct} · N break」，hover info icon 出最近调用 + break diff。
 * 0 calls 时只展示 "暂无数据"，info icon 隐藏。
 */
export function CacheStatsInline({ model }: Props) {
  const t = useT()
  const copilotOpen = useCopilotOpen()
  const glassStyle = useGlassStyle("thick")
  const [data, setData] = useState<ApiResponse | null>(null)

  useEffect(() => {
    if (!model) return
    let cancelled = false
    fetch(`/api/copilot/cache-stats?model=${encodeURIComponent(model)}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [model])

  if (!model) return null
  const calls = data?.weekly.calls ?? 0
  if (data && calls === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("settings.llm.cache.no_data")}
      </span>
    )
  }
  if (!data) return null

  const w = data.weekly
  const pct = formatPct(w.hit_rate)
  const breaks = w.recent_breaks

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={120}
        closeDelay={120}
        render={
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 cursor-help" />
        }
      >
        <span>
          {t("settings.llm.cache.label_summary", {
            pct,
            calls: String(calls),
          })}
        </span>
        {breaks > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {t("settings.llm.cache.break_count", { n: String(breaks) })}
          </span>
        )}
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60" aria-hidden>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 11.5v-.5" />
          <path d="M8 9.5c0-1.5 2-1.5 2-3a2 2 0 1 0-4 0" />
        </svg>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[10000]">
          <PreviewCard.Popup
            className="min-w-[280px] max-w-[420px] bg-popover border border-border rounded-lg shadow-lg p-3 text-xs space-y-1.5"
            style={copilotOpen ? { ...glassStyle } : undefined}
            data-glass-variant={copilotOpen ? "thick" : undefined}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("settings.llm.cache.window_label")}</span>
              <span className="font-medium tabular-nums">{t("settings.llm.cache.calls_value", { n: String(calls) })}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("settings.llm.cache.hit_rate_label")}</span>
              <span className="font-medium tabular-nums">{pct}</span>
            </div>
            {(w.total_cache_read > 0 || w.total_cache_creation > 0) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("settings.llm.cache.tokens_label")}</span>
                <span className="font-medium tabular-nums">
                  {t("settings.llm.cache.tokens_value", {
                    read: String(w.total_cache_read),
                    create: String(w.total_cache_creation),
                  })}
                </span>
              </div>
            )}
            {w.recent.length > 0 && (
              <>
                <div className="border-t border-border/60 my-1.5" />
                <div className="text-muted-foreground">{t("copilot.cache.tooltip.recent_title")}</div>
                <div className="space-y-0.5">
                  {w.recent.slice(0, 5).map((s, i) => (
                    <div key={i} className="font-mono text-[10px] tabular-nums opacity-80">
                      {t("copilot.cache.tooltip.input", { n: String(s.input_tokens) })}
                      {s.cache_read_tokens !== undefined && ` · ${t("copilot.cache.tooltip.cache_read", { n: String(s.cache_read_tokens) })}`}
                      {s.cache_creation_tokens !== undefined && ` · ${t("copilot.cache.tooltip.cache_create", { n: String(s.cache_creation_tokens) })}`}
                    </div>
                  ))}
                </div>
              </>
            )}
            {breaks > 0 && (
              <>
                <div className="border-t border-border/60 my-1.5" />
                <div className="text-muted-foreground" title={t("copilot.cache.tooltip.breaks_explain")}>
                  {t("copilot.cache.tooltip.breaks_summary", { n: String(breaks) })}
                </div>
                {w.recent_break_reasons.system_prompt > 0 && (
                  <div className="opacity-80">{t("copilot.cache.tooltip.breaks_by_reason_system_prompt", { n: String(w.recent_break_reasons.system_prompt) })}</div>
                )}
                {w.recent_break_reasons.tools > 0 && (
                  <div className="opacity-80">{t("copilot.cache.tooltip.breaks_by_reason_tools", { n: String(w.recent_break_reasons.tools) })}</div>
                )}
                {w.recent_break_reasons.unknown > 0 && (
                  <div className="opacity-80">{t("copilot.cache.tooltip.breaks_by_reason_unknown", { n: String(w.recent_break_reasons.unknown) })}</div>
                )}
                {w.latest_break_pair && (() => {
                  const pair = w.latest_break_pair
                  const showSysDiff = pair.reasons.includes("system_prompt") && pair.prev.system_prompt_preview && pair.curr.system_prompt_preview
                  const showToolDiff = pair.reasons.includes("tools") && pair.prev.tool_preview && pair.curr.tool_preview && pair.prev.tool_preview !== pair.curr.tool_preview
                  if (!showSysDiff && !showToolDiff) return null
                  return (
                    <div className="border-t border-border/40 my-1.5 pt-1.5 space-y-1">
                      {showSysDiff && (
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground">{t("copilot.cache.tooltip.system_prompt_diff_title")}</div>
                          <div className="font-mono text-[10px] opacity-80">{t("copilot.cache.tooltip.before")}: ...{pair.prev.system_prompt_preview}</div>
                          <div className="font-mono text-[10px] opacity-80">{t("copilot.cache.tooltip.after")}: ...{pair.curr.system_prompt_preview}</div>
                        </div>
                      )}
                      {showToolDiff && (
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground">{t("copilot.cache.tooltip.tools_diff_title")}</div>
                          <div className="font-mono text-[10px] opacity-80">{t("copilot.cache.tooltip.before")}: {pair.prev.tool_preview}</div>
                          <div className="font-mono text-[10px] opacity-80">{t("copilot.cache.tooltip.after")}: {pair.curr.tool_preview}</div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
