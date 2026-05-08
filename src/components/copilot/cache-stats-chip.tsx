"use client"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import type { CacheUsageStat, CacheHitRateResult, CacheBreaksSummary } from "@/lib/copilot/cache-stats-store"

interface ApiResponse {
  session: CacheHitRateResult & { recent: CacheUsageStat[] }
  weekly: CacheHitRateResult & CacheBreaksSummary
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

  const tooltip = data.session.recent.length > 0
    ? [
        t("copilot.cache.tooltip.recent_title"),
        ...data.session.recent.map((s) =>
          `${s.model}: ${t("copilot.cache.tooltip.input", { n: String(s.input_tokens) })}` +
          (s.cache_read_tokens !== undefined
            ? ` · ${t("copilot.cache.tooltip.cache_read", { n: String(s.cache_read_tokens) })}`
            : "") +
          (s.cache_creation_tokens !== undefined
            ? ` · ${t("copilot.cache.tooltip.cache_create", { n: String(s.cache_creation_tokens) })}`
            : ""),
        ),
      ].join("\n")
    : undefined

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
