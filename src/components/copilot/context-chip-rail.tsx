"use client"

import { useState } from "react"
import { useT } from "@/lib/i18n/provider"
import { colorForTag } from "./context-mask"
import { MarkdownBody } from "./chat-view-parts"
import type { CapturedContext } from "./store"

interface ContextChipRailProps {
  contexts: CapturedContext[]
  ctxStatus: Record<string, "ok" | "missing" | "error">
  ctxPreview: string
  inspectorActive: boolean
  onInspectorToggle: () => void
  onRemoveContext: (elementKey: string) => void
  onClearContexts: () => void
}

/**
 * 输入框上方的 context 控制行：圈选入口按钮 + chip 列表 + 清空 + preview 折叠面板。
 * UI 只读；context 数据和 inspector 开关由 caller 的 store 托管并通过 props 注入。
 * preview 面板展开与否是本地状态（不需要跨组件共享）。
 */
export function ContextChipRail({
  contexts,
  ctxStatus,
  ctxPreview,
  inspectorActive,
  onInspectorToggle,
  onRemoveContext,
  onClearContexts,
}: ContextChipRailProps) {
  const t = useT()
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      {/* 圈选入口 + 当前 context chips */}
      <div data-copilot-chip-rail className="flex items-center gap-1.5 flex-wrap">
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
        {contexts.length > 0 && (
          <>
            {contexts.map(c => {
              const isText = c.type === "text_selection"
              const label = isText
                ? `"${(c.summary ?? "").replace(/…$/, "")}"`
                : c.type
              const status = ctxStatus[`${c.type}:${c.id}`]
              const stale = status === "missing" || status === "error"
              return (
                <span
                  key={c.elementKey}
                  className={`inline-flex items-center gap-1 text-[10px] rounded border px-1.5 py-0.5 bg-card ${stale ? "opacity-50" : ""}`}
                  style={{ borderColor: colorForTag(c.tag) + "99" }}
                  title={
                    stale
                      ? `${c.type}#${c.id} · ${t("copilot.context_stale_title")}`
                      : c.summary ? `${c.type}#${c.id} · ${c.summary}` : `${c.type}#${c.id}`
                  }
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full text-[9px] font-bold text-white text-center leading-3"
                    style={{ backgroundColor: colorForTag(c.tag) }}
                  >{c.tag}</span>
                  <span className={`truncate text-muted-foreground ${isText ? "max-w-[140px] italic" : "max-w-[80px]"} ${stale ? "line-through" : ""}`}>{label}</span>
                  {stale && <span className="text-destructive text-[10px]" aria-hidden>!</span>}
                  <button
                    onClick={() => onRemoveContext(c.elementKey)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive leading-none"
                    title={t("copilot.context_tag_remove")}
                  >×</button>
                </span>
              )
            })}
            {contexts.length > 1 && (
              <button
                onClick={onClearContexts}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >{t("copilot.context_clear_all")}</button>
            )}
            {ctxPreview && (
              <button
                onClick={() => setPreviewOpen(v => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-auto"
              >
                {previewOpen ? "▾" : "▸"} {t("copilot.preview_system_message")}
              </button>
            )}
          </>
        )}
      </div>

      {previewOpen && ctxPreview && (
        <div className="rounded border border-border bg-muted/30 max-h-80 overflow-auto px-3 py-2">
          <div className="copilot-preview-md text-[11px] leading-relaxed">
            <MarkdownBody text={ctxPreview} />
          </div>
        </div>
      )}
    </>
  )
}
