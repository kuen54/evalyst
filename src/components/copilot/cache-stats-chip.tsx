"use client"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import type { CacheUsageStat, CacheHitRateResult, CacheBreaksSummary, BreakPair } from "@/lib/copilot/cache-stats-store"

interface ApiResponse {
  session: CacheHitRateResult & { recent: CacheUsageStat[] }
  weekly: CacheHitRateResult & CacheBreaksSummary & {
    recent_break_reasons: { system_prompt: number; tools: number; unknown: number }
    latest_break_pair: BreakPair | null
  }
}

function formatPct(r: number | null): string {
  if (r === null) return "—"
  return `${Math.round(r * 100)}%`
}

/**
 * v2.5 §6.4 顶部 mini chip：本 session hit rate · 近 7 天 hit rate · hover tooltip 最近几条调用。
 * 不走玻璃（CLAUDE.md "Copilot panel 内部一律扁平"约定），用 border-b 作视觉分隔。
 * 0 calls 时不渲染（避免空 chip）。
 */
export function CacheStatsChip({ sessionId }: { sessionId?: string }) {
  const t = useT()
  const [data, setData] = useState<ApiResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchStats = () => {
      const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""
      fetch(`/api/copilot/cache-stats${qs}`)
        .then((r) => r.json())
        .then((d: ApiResponse) => { if (!cancelled) setData(d) })
        .catch(() => {})
    }
    fetchStats()
    const iv = setInterval(fetchStats, 10_000) // 10s 刷新
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId])

  if (!data) return null
  if (data.session.calls === 0 && data.weekly.calls === 0) return null

  const tooltipLines: string[] = []
  if (data.session.recent.length > 0) {
    tooltipLines.push(t("copilot.cache.tooltip.recent_title"))
    for (const s of data.session.recent) {
      tooltipLines.push(
        `${s.model}: ${t("copilot.cache.tooltip.input", { n: String(s.input_tokens) })}` +
          (s.cache_read_tokens !== undefined
            ? ` · ${t("copilot.cache.tooltip.cache_read", { n: String(s.cache_read_tokens) })}`
            : "") +
          (s.cache_creation_tokens !== undefined
            ? ` · ${t("copilot.cache.tooltip.cache_create", { n: String(s.cache_creation_tokens) })}`
            : ""),
      )
    }
  }
  if (data.weekly.recent_breaks > 0) {
    if (tooltipLines.length > 0) tooltipLines.push("")  // 空行分段
    tooltipLines.push(
      t("copilot.cache.tooltip.breaks_summary", { n: String(data.weekly.recent_breaks) }),
    )
    const r = data.weekly.recent_break_reasons
    if (r.system_prompt > 0) {
      tooltipLines.push(
        t("copilot.cache.tooltip.breaks_by_reason_system_prompt", { n: String(r.system_prompt) }),
      )
    }
    if (r.tools > 0) {
      tooltipLines.push(
        t("copilot.cache.tooltip.breaks_by_reason_tools", { n: String(r.tools) }),
      )
    }
    if (r.unknown > 0) {
      tooltipLines.push(
        t("copilot.cache.tooltip.breaks_by_reason_unknown", { n: String(r.unknown) }),
      )
    }
    // v2.5 P2 §3.4: 给最近一次 break 展示具体 prev→curr 末尾差异，让用户能定位
    // "system prompt 哪几个字符变了" / "工具列表加/减了什么"
    const pair = data.weekly.latest_break_pair
    if (pair) {
      const { prev, curr, reasons } = pair
      if (
        reasons.includes("system_prompt") &&
        prev.system_prompt_preview &&
        curr.system_prompt_preview
      ) {
        tooltipLines.push("")
        tooltipLines.push(t("copilot.cache.tooltip.system_prompt_diff_title"))
        tooltipLines.push(`  ${t("copilot.cache.tooltip.before")}: ...${prev.system_prompt_preview}`)
        tooltipLines.push(`  ${t("copilot.cache.tooltip.after")}: ...${curr.system_prompt_preview}`)
      }
      if (
        reasons.includes("tools") &&
        prev.tool_preview &&
        curr.tool_preview &&
        prev.tool_preview !== curr.tool_preview
      ) {
        tooltipLines.push("")
        tooltipLines.push(t("copilot.cache.tooltip.tools_diff_title"))
        tooltipLines.push(`  ${t("copilot.cache.tooltip.before")}: ${prev.tool_preview}`)
        tooltipLines.push(`  ${t("copilot.cache.tooltip.after")}: ${curr.tool_preview}`)
      }
    }
  }
  const tooltip = tooltipLines.length > 0 ? tooltipLines.join("\n") : undefined

  return (
    <div
      data-testid="cache-stats-chip"
      className="px-3 py-1 text-xs text-muted-foreground flex items-center gap-2 border-b border-border/40"
      title={tooltip}
    >
      <span className="font-medium">{t("copilot.cache.label")}:</span>
      <span>{t("copilot.cache.session", { pct: formatPct(data.session.hit_rate) })}</span>
      <span className="opacity-60">·</span>
      <span>{t("copilot.cache.weekly", { pct: formatPct(data.weekly.hit_rate) })}</span>
      {data.weekly.recent_breaks > 0 && (
        <>
          <span className="opacity-60">·</span>
          <span title={t("copilot.cache.tooltip.breaks_explain")}>
            {t("copilot.cache.weekly_breaks", { n: String(data.weekly.recent_breaks) })}
          </span>
        </>
      )}
    </div>
  )
}
