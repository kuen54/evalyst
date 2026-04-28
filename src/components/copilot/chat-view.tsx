"use client"

import { memo, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { CopilotMessage, CopilotContextRef } from "@/lib/copilot/types"
import { ModelPicker } from "./model-picker"
import { useCopilotStore } from "./store"
import { colorForTag } from "./context-mask"

interface Props {
  sessionId?: string
  selectedModelId?: string
  onPickModel: (modelId: string) => void
}

interface UiMessage {
  id?: string
  role: CopilotMessage["role"]
  content: string
  streaming?: boolean
  contexts?: CopilotContextRef[]
}

export function ChatView({ sessionId, selectedModelId, onPickModel }: Props) {
  const t = useT()
  const modelId = selectedModelId
  const { contexts, clearContexts, removeContext, setInspectorActive, inspectorActive, setBusy } = useCopilotStore()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [editDraft, setEditDraft] = useState("")
  const [ctxStatus, setCtxStatus] = useState<Record<string, "ok" | "missing" | "error">>({})
  const [ctxPreview, setCtxPreview] = useState<string>("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 每次 contexts 变动，向服务端 resolve 拿 per-ref status 和格式化的 system_message
  useEffect(() => {
    if (contexts.length === 0) {
      setCtxStatus({})
      setCtxPreview("")
      return
    }
    const refs = contexts.map(c => ({ tag: c.tag, type: c.type, id: c.id, extra: c.extra }))
    let cancelled = false
    fetch("/api/copilot/contexts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    })
      .then(r => r.json())
      .then((d: { resolved: Array<{ type: string; id: string; status: "ok" | "missing" | "error" }>; system_message: string }) => {
        if (cancelled) return
        const m: Record<string, "ok" | "missing" | "error"> = {}
        for (const res of d.resolved) m[`${res.type}:${res.id}`] = res.status
        setCtxStatus(m)
        setCtxPreview(d.system_message || "")
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [contexts])

  useEffect(() => {
    if (!sessionId) { setMessages([]); return }
    setLoadingSession(true)
    fetch(`/api/copilot/sessions/${sessionId}`)
      .then(r => r.json())
      .then((d: { messages?: CopilotMessage[] }) => {
        setMessages((d.messages ?? []).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          contexts: m.contexts,
        })))
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingSession(false))
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const canSend = !!input.trim() && !sending && !!sessionId && !!modelId

  const doStreamSend = async (text: string, sendContexts?: CopilotContextRef[]) => {
    if (!sessionId || !modelId) return
    setSending(true)
    setBusy(true)
    setMessages(prev => [
      ...prev,
      { role: "user", content: text, contexts: sendContexts },
      { role: "assistant", content: "", streaming: true },
    ])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await fetch(`/api/copilot/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: text,
          model_id: modelId,
          contexts: sendContexts,
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => "")
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const raw of events) {
          const line = raw.trimStart()
          if (!line.startsWith("data:")) continue
          const json = line.slice(5).trim()
          if (!json) continue
          try {
            const ev = JSON.parse(json) as
              | { kind: "user_message"; id: string }
              | { kind: "text"; delta: string }
              | { kind: "done"; assistant_message_id: string }
              | { kind: "error"; message: string }
            if (ev.kind === "text") {
              setMessages(prev => {
                const next = prev.slice()
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + ev.delta }
                }
                return next
              })
            } else if (ev.kind === "user_message") {
              setMessages(prev => {
                const next = prev.slice()
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === "user" && !next[i].id) {
                    next[i] = { ...next[i], id: ev.id }
                    break
                  }
                }
                return next
              })
            } else if (ev.kind === "done") {
              setMessages(prev => {
                const next = prev.slice()
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, id: ev.assistant_message_id, streaming: false }
                }
                return next
              })
            } else if (ev.kind === "error") {
              toast.error(ev.message)
              setMessages(prev => {
                const next = prev.slice()
                const last = next[next.length - 1]
                if (last && last.role === "assistant" && last.streaming) {
                  next[next.length - 1] = { ...last, content: last.content || t("copilot.reply_failed"), streaming: false }
                }
                return next
              })
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error(t("copilot.send_failed") + ": " + (e as Error).message)
      }
      setMessages(prev => {
        const next = prev.slice()
        const last = next[next.length - 1]
        if (last && last.role === "assistant" && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false }
        }
        return next
      })
    } finally {
      setSending(false)
      setBusy(false)
      abortRef.current = null
    }
  }

  const handleSend = async () => {
    if (!canSend) return
    const text = input.trim()
    setInput("")
    // 快照当前 context refs（每条消息快照自己那一刻看到的 contexts，以便历史稳定）
    const snapshot: CopilotContextRef[] = contexts.map(c => ({ tag: c.tag, type: c.type, id: c.id, extra: c.extra }))
    await doStreamSend(text, snapshot.length > 0 ? snapshot : undefined)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  // ---------- 消息悬浮 actions ----------

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success(t("copilot.copied_toast"))
    } catch {
      toast.error(t("copilot.copy_failed"))
    }
  }

  const handleDelete = async (msg: UiMessage) => {
    if (!sessionId || !msg.id) return
    if (!confirm(t("copilot.delete_message_confirm"))) return
    try {
      const r = await fetch(`/api/copilot/sessions/${sessionId}/messages/${msg.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(String(r.status))
      const { removed } = await r.json() as { removed: string[] }
      const set = new Set(removed)
      setMessages(prev => prev.filter(m => !m.id || !set.has(m.id)))
    } catch {
      toast.error(t("copilot.delete_failed"))
    }
  }

  const startEdit = (msg: UiMessage) => {
    if (!msg.id) return
    setEditingId(msg.id)
    setEditDraft(msg.content)
  }

  const cancelEdit = () => {
    setEditingId(undefined)
    setEditDraft("")
  }

  const commitEdit = async (msg: UiMessage) => {
    if (!sessionId || !msg.id || !editDraft.trim()) { cancelEdit(); return }
    const newText = editDraft.trim()
    // 1) 删掉旧 user 消息 + 它的所有后代（通常是一条 assistant 回复）
    try {
      const r = await fetch(`/api/copilot/sessions/${sessionId}/messages/${msg.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(String(r.status))
      const { removed } = await r.json() as { removed: string[] }
      const set = new Set(removed)
      setMessages(prev => prev.filter(m => !m.id || !set.has(m.id)))
    } catch {
      toast.error(t("copilot.delete_failed"))
      return
    }
    cancelEdit()
    // 2) 用新内容作为新 user 消息发一次；复用原消息的 contexts（如果有）
    await doStreamSend(newText, msg.contexts)
  }

  // ---------- 渲染 ----------

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-[12px] px-6 text-center">
        {t("copilot.empty_state")}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loadingSession && messages.length === 0 && (
          <div className="text-[11px] text-muted-foreground text-center">{t("common.loading")}</div>
        )}
        {!loadingSession && messages.length === 0 && (
          <div className="text-[12px] text-muted-foreground text-center py-8">
            {t("copilot.empty_conversation")}
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow
            key={m.id ?? `p-${i}`}
            msg={m}
            editing={!!m.id && editingId === m.id}
            editDraft={editDraft}
            onEditDraftChange={setEditDraft}
            onCopy={() => handleCopy(m.content)}
            onEdit={() => startEdit(m)}
            onDelete={() => handleDelete(m)}
            onEditCancel={cancelEdit}
            onEditCommit={() => commitEdit(m)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border/60 p-2 space-y-1.5">
        {/* 圈选入口 + 当前 context chips */}
        <div data-copilot-chip-rail className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setInspectorActive(!inspectorActive)}
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
                      onClick={() => removeContext(c.elementKey)}
                      className="ml-0.5 text-muted-foreground hover:text-destructive leading-none"
                      title={t("copilot.context_tag_remove")}
                    >×</button>
                  </span>
                )
              })}
              {contexts.length > 1 && (
                <button
                  onClick={clearContexts}
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

        <div className="relative">
          <button
            type="button"
            onClick={() => setInputExpanded(v => !v)}
            title={inputExpanded ? t("copilot.input_collapse") : t("copilot.input_expand")}
            className="absolute top-1.5 right-1.5 z-10 w-5 h-5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {inputExpanded ? (
              // 收起：内部 TL ⌜ + 内部 BR ⌟，两个角朝外（向 NW/SE 外角），视觉是"把角缩进来"
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                <path d="M5 2v3H2" />
                <path d="M9 12V9h3" />
              </svg>
            ) : (
              // 展开：外部 BL ⌞ + 外部 TR ⌝，两个角朝内（撑开到左下/右上两个真角）
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                <path d="M2 8v4h4" />
                <path d="M12 6V2H8" />
              </svg>
            )}
          </button>
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("copilot.input_placeholder")}
            rows={inputExpanded ? 18 : 3}
            className={`text-[13px] resize-none pr-8 ${inputExpanded ? "h-[360px] overflow-y-auto" : "min-h-[60px]"}`}
            disabled={!sessionId || !modelId}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ModelPicker selectedModelId={modelId} onChange={onPickModel} />
          </div>
          <Button variant="tinted" size="sm" onClick={handleSend} disabled={!canSend} className="shrink-0 gap-1.5">
            <span>{sending ? t("copilot.thinking") : t("copilot.send")}</span>
            {!sending && modelId && (
              <kbd className="text-[10px] opacity-70 font-mono bg-primary-foreground/15 px-1 py-px rounded">⌘↩</kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MessageRowProps {
  msg: UiMessage
  editing: boolean
  editDraft: string
  onEditDraftChange: (v: string) => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
  onEditCancel: () => void
  onEditCommit: () => void
}

function MessageRow({ msg, editing, editDraft, onEditDraftChange, onCopy, onEdit, onDelete, onEditCancel, onEditCommit }: MessageRowProps) {
  const t = useT()
  const isUser = msg.role === "user"
  const isAssistant = msg.role === "assistant"
  if (!isUser && !isAssistant) return null
  const canEdit = isUser && !!msg.id && !msg.streaming
  const canDelete = !!msg.id && !msg.streaming

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[90%] space-y-1.5">
          <Textarea
            value={editDraft}
            onChange={e => onEditDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onEditCommit() }
              if (e.key === "Escape") { e.preventDefault(); onEditCancel() }
            }}
            rows={3}
            autoFocus
            className="text-[13px] resize-none"
          />
          <div className="flex items-center gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onEditCancel}>{t("copilot.edit_cancel")}</Button>
            <Button variant="tinted" size="sm" onClick={onEditCommit}>{t("copilot.edit_resend")}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`group flex gap-1.5 items-start ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className={`max-w-[90%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed break-words bg-muted text-foreground border border-border/60`}>
          {msg.content
            ? <MarkdownBody text={msg.content} />
            : msg.streaming ? <ThinkingDots /> : null}
          {msg.streaming && msg.content && <span className="inline-block w-1.5 h-3 ml-0.5 bg-current opacity-60 animate-pulse align-middle" />}
        </div>
      )}
      {isUser && (
        <div className="max-w-[90%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words bg-primary text-primary-foreground">
          {msg.content}
          {msg.contexts && msg.contexts.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-primary-foreground/20">
              {msg.contexts.map(c => (
                <span
                  key={`${c.type}:${c.id}:${c.tag}`}
                  className="inline-flex items-center gap-0.5 text-[9px] rounded bg-primary-foreground/15 px-1 py-0.5"
                  title={`${c.type}#${c.id}`}
                >
                  <span className="font-bold">#{c.tag}</span>
                  <span className="opacity-80">{c.type}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hover 工具条（消息气泡外侧） */}
      <div className={`flex gap-0.5 items-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "order-first" : ""}`}>
        <IconButton title={t("copilot.copy")} onClick={onCopy}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
            <path d="M2 7V2.5A1 1 0 0 1 3 1.5h4.5" />
          </svg>
        </IconButton>
        {canEdit && (
          <IconButton title={t("copilot.edit_message")} onClick={onEdit}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1.5 10.5h2l6-6-2-2-6 6v2z" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
        {canDelete && (
          <IconButton title={t("copilot.delete_message")} onClick={onDelete} danger>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2 3.5h8M5 3.5V2h2v1.5M3 3.5l.7 7h4.6l.7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  )
}

function IconButton({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded hover:bg-accent text-muted-foreground ${danger ? "hover:text-destructive" : "hover:text-foreground"} transition-colors`}
    >
      {children}
    </button>
  )
}

/** 三个交替弹跳的圆点，用于 LLM 回复未开始前的等待状态（Gemini with thinking 常见 10s+ 静默） */
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="thinking-dot" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "180ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "360ms" }} />
    </span>
  )
}

/** Assistant 消息走 markdown；code / pre / table 等做基础样式，外层父用 .prose 兼容 tailwind typography。 */
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="copilot-md space-y-2 [&_p]:my-0 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:text-[13.5px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-medium [&_hr]:my-2 [&_hr]:border-border/50 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_table]:text-[11px] [&_th]:px-1 [&_th]:py-0.5 [&_td]:px-1 [&_td]:py-0.5 [&_th]:border [&_td]:border [&_th]:border-border/60 [&_td]:border-border/60">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">{children}</a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = typeof className === "string" && className.startsWith("language-")
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>
            }
            return <code className="bg-background/60 border border-border/60 rounded px-1 py-[1px] text-[11.5px] font-mono">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="bg-background/60 border border-border/60 rounded p-2 overflow-x-auto text-[11.5px] font-mono leading-relaxed">{children}</pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
