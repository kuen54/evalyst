"use client"

import { useState, useCallback } from "react"
import { useT } from "@/lib/i18n/provider"
import { useImageLightbox } from "@/components/ui/image-lightbox"
import { colorForTag } from "./context-mask"
import type { CapturedContext } from "./store"

interface ContextChipRailProps {
  contexts: CapturedContext[]
  ctxStatus: Record<string, "ok" | "missing" | "error">
  inspectorActive: boolean
  onInspectorToggle: () => void
  onRemoveContext: (elementKey: string) => void
  onClearContexts: () => void
}

/**
 * 输入框上方的 context 控制行：圈选入口按钮 + chip 列表 + 清空。
 * 每个 chip 自带可展开的「查看详情」面板，懒加载 /api/copilot/contexts/resolve
 * 结果缓存到组件本地 state（不跨 chip 共享）。
 */
export function ContextChipRail({
  contexts,
  ctxStatus,
  inspectorActive,
  onInspectorToggle,
  onRemoveContext,
  onClearContexts,
}: ContextChipRailProps) {
  const t = useT()

  return (
    <div data-copilot-chip-rail className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={onInspectorToggle}
          title={t("copilot.inspector_hint")}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-all duration-150 active:scale-95 ${
            inspectorActive
              ? "bg-primary text-primary-foreground border-primary shadow-[0_0_0_3px_oklch(0.7_0.17_280_/_0.25)] animate-[copilot-inspector-pulse_1.6s_ease-in-out_infinite]"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
          }`}
        >
          {inspectorActive ? t("copilot.inspector_exit") : t("copilot.inspector_start")}
        </button>
        {contexts.length > 1 && (
          <button
            onClick={onClearContexts}
            className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-auto"
          >{t("copilot.context_clear_all")}</button>
        )}
      </div>
      {contexts.length > 0 && (
        <div className="flex flex-col gap-1">
          {contexts.map(c => {
            const status = ctxStatus[`${c.type}:${c.id}`]
            const stale = status === "missing" || status === "error"
            return (
              <ContextChip
                key={c.elementKey}
                ctx={c}
                stale={stale}
                onRemove={() => onRemoveContext(c.elementKey)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ResolvedDetail {
  tag: number
  type: string
  id: string
  status: "ok" | "missing" | "error"
  summary?: string
  data?: unknown
  error?: string
  context_chain?: Array<{ type: string; id: string; summary?: string }>
}

/** 单个 chip：body 可点击展开详情，× 独立按钮移除（不触发展开）。 */
function ContextChip({
  ctx,
  stale,
  onRemove,
}: {
  ctx: CapturedContext
  stale: boolean
  onRemove: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<ResolvedDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isText = ctx.type === "text_selection"
  const hostType = isText ? (ctx.extra as { hostType?: string } | undefined)?.hostType : undefined
  const hostId = isText ? (ctx.extra as { hostId?: string } | undefined)?.hostId : undefined
  const hostHeader = isText && hostType
    ? `${hostType}${hostId ? "#" + hostId : ""}`
    : ""
  const textBody = isText
    ? ((ctx.summary ?? "").replace(/…$/, ""))
    : ""
  const label = isText
    ? (hostHeader ? t("copilot.chip.text_in_host", { host: hostHeader }) : "text")
    : ctx.type

  const loadDetail = useCallback(async () => {
    if (detail || loading) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch("/api/copilot/contexts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refs: [{ tag: ctx.tag, type: ctx.type, id: ctx.id, extra: ctx.extra }],
        }),
      })
      const body = await resp.json() as { resolved: ResolvedDetail[] }
      setDetail(body.resolved?.[0] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [ctx, detail, loading])

  const toggleExpand = () => {
    setExpanded(v => {
      const next = !v
      if (next) void loadDetail()
      return next
    })
  }

  const titleText = stale
    ? `${ctx.type}#${ctx.id} · ${t("copilot.context_stale_title")}`
    : ctx.summary ? `${ctx.type}#${ctx.id} · ${ctx.summary}` : `${ctx.type}#${ctx.id}`

  return (
    <div
      className={`rounded border bg-card ${stale ? "opacity-60" : ""}`}
      style={{ borderColor: colorForTag(ctx.tag) + "99" }}
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
          <span
            className="inline-block w-3 h-3 rounded-full text-[9px] font-bold text-white text-center leading-3 shrink-0"
            style={{ backgroundColor: colorForTag(ctx.tag) }}
          >{ctx.tag}</span>
          <button
            type="button"
            onClick={toggleExpand}
            title={titleText}
            className="flex-1 min-w-0 text-left flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
            aria-expanded={expanded}
            aria-label={t("copilot.chip.expand_detail")}
          >
            <span aria-hidden className="text-muted-foreground text-[9px]">{expanded ? "▾" : "▸"}</span>
            <span className={`truncate text-muted-foreground ${isText ? "italic" : ""} ${stale ? "line-through" : ""}`}>{label}</span>
            {stale && <span className="text-destructive" aria-hidden>!</span>}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="text-muted-foreground hover:text-destructive leading-none shrink-0"
            title={t("copilot.context_tag_remove")}
          >×</button>
        </div>
        {isText && textBody && (
          <div className="px-1.5 pb-0.5 pl-5 text-[10px] text-muted-foreground/80 italic truncate">
            └ &quot;{textBody}&quot;
          </div>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border/60 bg-muted/30 px-2 py-1.5 text-[10px] space-y-1.5">
          {loading && (
            <div className="text-muted-foreground">{t("copilot.chip.loading")}</div>
          )}
          {error && (
            <div className="text-destructive">{error}</div>
          )}
          {detail && !loading && (
            isText ? (
              <>
                {detail.context_chain && detail.context_chain.length > 0 && (
                  <div className="text-muted-foreground">
                    {t("copilot.chip.within")}{" "}
                    {detail.context_chain.map((a, i) => (
                      <span key={`${a.type}:${a.id}:${i}`}>
                        {i > 0 && " / "}
                        <span className="text-foreground">{a.type}</span>
                        <span className="opacity-70">:{a.id}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.selected_text")}</div>
                  <blockquote className="border-l-2 border-foreground/30 pl-2 text-foreground/90 italic whitespace-pre-wrap break-words">
                    &quot;{textBody}&quot;
                  </blockquote>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.context_anchor")}</div>
                  <ul className="space-y-0.5">
                    {hostType && (
                      <li>· {t("copilot.chip.anchor_taken_from", { hostType, hostId: hostId ?? "" })}</li>
                    )}
                    <li className="text-muted-foreground/70">
                      · {t("copilot.chip.anchor_full_value_hint", { tag: String(ctx.tag) })}
                    </li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                {detail.context_chain && detail.context_chain.length > 0 && (
                  <div className="text-muted-foreground">
                    {t("copilot.chip.within")}{" "}
                    {detail.context_chain.map((a, i) => (
                      <span key={`${a.type}:${a.id}:${i}`}>
                        {i > 0 && " / "}
                        <span className="text-foreground">{a.type}</span>
                        <span className="opacity-70">:{a.id}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.value_label")}</div>
                  <pre className="bg-background/60 p-1.5 rounded text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                    {detail.data !== undefined ? JSON.stringify(detail.data, null, 2) : "(empty)"}
                  </pre>
                </div>
                {(() => {
                  const expId = (ctx.extra as { experiment_id?: string } | undefined)?.experiment_id
                  const urls = extractImageUrlsFromDetail(detail.data, expId)
                  if (urls.length === 0) return null
                  return (
                    <div>
                      <div className="text-muted-foreground mb-0.5">{t("copilot.chip.image_preview_label")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {urls.map((u, i) => (
                          <ChipImageThumb key={`${u}-${i}`} src={u} alt={`ctx_${ctx.tag}_img_${i}`} />
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.metadata_label")}</div>
                  <div className="text-muted-foreground">
                    <span className="text-foreground">{detail.type}</span>
                    <span className="opacity-70">:{detail.id}</span>
                    {" · "}
                    <span className={detail.status === "ok" ? "text-foreground" : "text-destructive"}>
                      {detail.status}
                    </span>
                    {detail.summary ? ` · ${detail.summary}` : null}
                  </div>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ---------- chip-local image preview helpers ----------

/** Walks any JSON-ish detail.data and extracts URLs that look like images. Loose. */
function extractImageUrlsFromDetail(data: unknown, expId?: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (v: unknown) => {
    if (v == null) return
    if (typeof v === 'string') {
      const url = looksLikeImageUrl(v) ? normalizeChipImageUrl(v, expId) : null
      if (url && !seen.has(url)) { seen.add(url); out.push(url) }
      return
    }
    if (Array.isArray(v)) { v.forEach(visit); return }
    if (typeof v === 'object') {
      for (const inner of Object.values(v as Record<string, unknown>)) visit(inner)
    }
  }
  visit(data)
  return out
}

function looksLikeImageUrl(s: string): boolean {
  return s.startsWith('data:image/')
    || /^\/api\/results\/[^/]+\/images\//.test(s)
    || /^images\//.test(s)
    || /^https?:\/\/.*\.(png|jpe?g|webp|gif)(\?|$)/i.test(s)
}

function normalizeChipImageUrl(raw: string, expId?: string): string {
  if (raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('/api/')) return raw
  if (raw.startsWith('images/') && expId) return `/api/results/${expId}/${raw}`
  return raw
}

/** 120×120 thumbnail; click → ImageLightbox (mounted at root via ImageLightboxProvider). */
function ChipImageThumb({ src, alt }: { src: string; alt: string }) {
  const { openLightbox } = useImageLightbox()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onClick={(e) => { e.stopPropagation(); openLightbox(src, alt) }}
      className="w-[120px] h-[120px] object-contain cursor-zoom-in rounded border bg-background/40"
    />
  )
}
