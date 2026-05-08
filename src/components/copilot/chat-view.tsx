"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { CopilotMessage, CopilotContextRef } from "@/lib/copilot/types"
import { ModelPicker } from "./model-picker"
import { useCopilotStore } from "./store"
import { MessageRow, ThinkingDots, SystemNoticeBubble, type UiMessage } from "./chat-view-parts"
import { ToolCallCard } from "./tool-call-card"
import { RouteChangeBanner } from "./route-change-banner"
import { CacheStatsChip } from "./cache-stats-chip"
import { ContextChipRail } from "./context-chip-rail"
import { useChatStream } from "./use-chat-stream"

interface Props {
  sessionId?: string
  selectedModelId?: string
  onPickModel: (modelId: string) => void
}

export function ChatView({ sessionId, selectedModelId, onPickModel }: Props) {
  const t = useT()
  const modelId = selectedModelId
  const {
    contexts, clearContexts, removeContext,
    setInspectorActive, inspectorActive,
    pageContext, bumpTypingSignal,
    setActiveSessionId,
  } = useCopilotStore()

  const stream = useChatStream({
    sessionId,
    modelId,
    pageContext,
    onError: (msg) => toast.error(msg),
    tI18nReplyFailed: t("copilot.reply_failed"),
    tI18nChainLimit: t("copilot.tool.chain_limit"),
    tI18nSendFailed: t("copilot.send_failed"),
    tI18nDeleteFailed: t("copilot.delete_failed"),
    tI18nDeleteConfirm: t("copilot.delete_message_confirm"),
  })

  const [input, setInput] = useState("")
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [editDraft, setEditDraft] = useState("")
  const [ctxStatus, setCtxStatus] = useState<Record<string, "ok" | "missing" | "error">>({})
  const [inputExpanded, setInputExpanded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 每次 contexts 变动，向服务端 resolve 拿 per-ref status（chip 状态显示用）。
  // v2 起 LLM 不再消费这段 system_message，前端也不再展示 preview 面板。
  useEffect(() => {
    if (contexts.length === 0) { setCtxStatus({}); return }
    const refs = contexts.map(c => ({ tag: c.tag, type: c.type, id: c.id, extra: c.extra }))
    let cancelled = false
    fetch("/api/copilot/contexts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    })
      .then(r => r.json())
      .then((d: { resolved: Array<{ type: string; id: string; status: "ok" | "missing" | "error" }> }) => {
        if (cancelled) return
        const m: Record<string, "ok" | "missing" | "error"> = {}
        for (const res of d.resolved) m[`${res.type}:${res.id}`] = res.status
        setCtxStatus(m)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [contexts])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [stream.messages, stream.sending, stream.pendingCallIds])

  const canSend = !!input.trim() && !stream.sending && !!sessionId && !!modelId

  const handleSend = async () => {
    if (!canSend) return
    const text = input.trim()
    setInput("")
    // 快照当前 context refs（每条消息快照自己那一刻看到的 contexts，以便历史稳定）
    const snapshot: CopilotContextRef[] = contexts.map(c => ({ tag: c.tag, type: c.type, id: c.id, extra: c.extra }))
    await stream.send(text, snapshot.length > 0 ? snapshot : undefined)
  }

  /** RouteChangeBanner 的"开启新对话"动作：建新 session 并切过去，旧的保留。 */
  const handleForkSession = async () => {
    try {
      const resp = await fetch("/api/copilot/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t("copilot.session.untitled") }),
      })
      if (!resp.ok) { toast.error(t("copilot.session.create_failed")); return }
      const data = await resp.json() as { id: string }
      setActiveSessionId(data.id)
    } catch {
      toast.error(t("copilot.session.create_failed"))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
  }

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success(t("copilot.copied_toast"))
    } catch {
      toast.error(t("copilot.copy_failed"))
    }
  }

  const startEdit = (msg: UiMessage) => {
    if (!msg.id) return
    if (msg.role !== "user" && msg.role !== "assistant") return
    setEditingId(msg.id); setEditDraft(msg.content)
  }
  const cancelEdit = () => { setEditingId(undefined); setEditDraft("") }
  const commitEdit = async (msg: UiMessage) => {
    if (msg.role !== "user" || !msg.id || !editDraft.trim()) { cancelEdit(); return }
    const newText = editDraft.trim()
    cancelEdit()
    await stream.editUserMessage(msg, newText)
  }

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-[12px] px-6 text-center">
        {t("copilot.empty_state")}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <RouteChangeBanner
        hasMessages={stream.messages.length > 0}
        onForkSession={handleForkSession}
      />
      <CacheStatsChip sessionId={sessionId} />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {stream.loadingSession && stream.messages.length === 0 && (
          <div className="text-[11px] text-muted-foreground text-center">{t("common.loading")}</div>
        )}
        {!stream.loadingSession && stream.messages.length === 0 && (
          <div className="text-[12px] text-muted-foreground text-center py-8">
            {t("copilot.empty_conversation")}
          </div>
        )}
        {stream.messages.map((m, i) => {
          if (m.role === "tool_use") return renderToolUse(m, i, stream.messages, sessionId, stream.pendingCallIds, stream.confirmTool, stream.denyTool)
          if (m.role === "tool_result") return null
          if (m.role === "system_notice") {
            return (
              <SystemNoticeBubble
                key={m.id ?? `notice-${i}`}
                kind={m.kind}
                reasonKey={m.reasonKey}
                reasonVars={m.reasonVars}
              />
            )
          }
          return (
            <MessageRow
              key={m.id ?? `p-${i}`}
              msg={m}
              editing={!!m.id && editingId === m.id}
              editDraft={editDraft}
              onEditDraftChange={setEditDraft}
              onCopy={() => handleCopy(m.content)}
              onEdit={() => startEdit(m)}
              onDelete={() => stream.deleteMessage(m)}
              onEditCancel={cancelEdit}
              onEditCommit={() => commitEdit(m)}
            />
          )
        })}
        {renderThinkingDots(stream.messages, stream.sending, stream.pendingCallIds)}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border/60 p-2 space-y-1.5">
        <ContextChipRail
          contexts={contexts}
          ctxStatus={ctxStatus}
          inspectorActive={inspectorActive}
          onInspectorToggle={() => setInspectorActive(!inspectorActive)}
          onRemoveContext={removeContext}
          onClearContexts={clearContexts}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setInputExpanded(v => !v)}
            title={inputExpanded ? t("copilot.input_collapse") : t("copilot.input_expand")}
            className="absolute top-1.5 right-1.5 z-10 w-5 h-5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ExpandIcon collapsed={!inputExpanded} />
          </button>
          <Textarea
            value={input}
            onChange={e => {
              setInput(e.target.value)
              bumpTypingSignal()
            }}
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
          <Button size="sm" onClick={handleSend} disabled={!canSend} className="shrink-0 gap-1.5">
            <span>{stream.sending ? t("copilot.thinking") : t("copilot.send")}</span>
            {!stream.sending && modelId && (
              <kbd className="text-[10px] opacity-70 font-mono bg-primary-foreground/15 px-1 py-px rounded">⌘↩</kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * 任一 fetch 在飞（/chat 或 /tool-result），在消息流末尾 pin 一个 thinking 气泡。
 * 最后一条消息如果本身就是正在 streaming 的 assistant（里面已经有 dots 或 blink cursor）
 * 则不重复渲染，避免双 dots。
 */
function renderThinkingDots(messages: UiMessage[], sending: boolean, pendingCallIds: Set<string>) {
  if (!sending && pendingCallIds.size === 0) return null
  const last = messages[messages.length - 1]
  if (last && last.role === "assistant" && last.streaming === true) return null
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-md px-3 py-2 bg-muted text-foreground border border-border/60">
        <ThinkingDots />
      </div>
    </div>
  )
}

/** 输入框右上角的 expand/collapse 小图标。
 *  collapsed=true（输入框还没展开）→ 两角朝内，"撑开" 语义；
 *  collapsed=false（已展开）→ 两角朝外，"缩回" 语义。 */
function ExpandIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
      {collapsed
        ? (<><path d="M2 8v4h4" /><path d="M12 6V2H8" /></>)
        : (<><path d="M5 2v3H2" /><path d="M9 12V9h3" /></>)}
    </svg>
  )
}

/**
 * 渲染一条 tool_use 消息（含向后配对的 tool_result）到 ToolCallCard。
 * `persistedOnServer = !!m.id && !m.id.startsWith("tu-")` —— 服务端 append tool_use 到 jsonl
 * 后才在 `done` 事件里回填 id。没有 id 时按钮 disabled，避免 race（/tool-result 跑
 * getActiveBranch 看不到 tool_use）。
 */
function renderToolUse(
  m: Extract<UiMessage, { role: "tool_use" }>,
  i: number,
  allMessages: UiMessage[],
  sessionId: string,
  pendingCallIds: Set<string>,
  onConfirm: (call_id: string, tool_name: string, input: Record<string, unknown>, alwaysAllow: boolean) => void,
  onDeny: (call_id: string, tool_name: string, input: Record<string, unknown>, reason: string, alwaysDeny: boolean) => void,
) {
  let paired: UiMessage | undefined
  for (let j = i + 1; j < allMessages.length; j++) {
    const x = allMessages[j]
    if (x.role === "tool_result" && x.call_id === m.call_id) { paired = x; break }
  }
  const pending = pendingCallIds.has(m.call_id)
  const persistedOnServer = !!m.id && !m.id.startsWith("tu-")
  const toolUseShim: CopilotMessage = {
    id: m.id ?? `tu-${i}`, session_id: sessionId, role: "tool_use", content: "", timestamp: "",
    call_id: m.call_id, tool_name: m.tool_name, tool_input: m.tool_input,
  }
  const toolResultShim: CopilotMessage | undefined = paired && paired.role === "tool_result"
    ? {
        id: paired.id ?? `tr-${i}`, session_id: sessionId, role: "tool_result",
        content: paired.content, timestamp: "",
        call_id: paired.call_id, tool_name: paired.tool_name,
        denied: paired.denied, reason: paired.reason,
      }
    : undefined
  return (
    <ToolCallCard
      key={m.id ?? `tu-${i}`}
      toolUse={toolUseShim}
      toolResult={toolResultShim}
      onConfirm={(alwaysAllow) => onConfirm(m.call_id, m.tool_name, m.tool_input, alwaysAllow)}
      onDeny={(reason, alwaysDeny) => onDeny(m.call_id, m.tool_name, m.tool_input, reason, alwaysDeny)}
      pending={pending || !persistedOnServer}
    />
  )
}
