"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { CopilotMessage, CopilotContextRef } from "@/lib/copilot/types"
import { findToolMetadata } from "@/lib/copilot/tool-metadata"
import { collectClientSnapshot } from "@/lib/copilot/collect-snapshot"
import { ModelPicker } from "./model-picker"
import { useCopilotStore } from "./store"
import { colorForTag } from "./context-mask"
import { MessageRow, MarkdownBody, ThinkingDots, type UiMessage } from "./chat-view-parts"
import { ToolCallCard } from "./tool-call-card"

interface Props {
  sessionId?: string
  selectedModelId?: string
  onPickModel: (modelId: string) => void
}

/**
 * 所有从 /chat 和 /tool-result POST 出的 SSE 事件共享这一组 kind。
 *  - user_message / tool_result_message：服务端分配的消息 id
 *  - text：assistant 文本增量
 *  - tool_use_*：LLM 工具调用生命周期
 *  - done：流结束 + assistant/tool_use 的最终 message id 列表
 *  - error：业务错误
 */
type ChatSseEvent =
  | { kind: "user_message"; id: string }
  | { kind: "tool_result_message"; id: string; content?: string; denied?: boolean; reason?: string }
  | { kind: "text"; delta: string }
  | { kind: "tool_use_start"; call_id: string; tool_name: string }
  | { kind: "tool_use_delta"; call_id: string; input_json_delta: string }
  | { kind: "tool_use_end"; call_id: string; tool_name: string; input: Record<string, unknown> }
  | { kind: "done"; assistant_message_id?: string; tool_use_message_ids?: string[]; usage?: { input_tokens: number; output_tokens: number }; stop_reason?: string }
  | { kind: "error"; message: string }

/**
 * 把 fetch Response 的 SSE body 解出来，按 `\n\n` 分条，丢给 onEvent。
 * /chat 和 /tool-result 的事件 shape 一致，共用同一个消费器。
 * 调用方持有 AbortController / AbortSignal，把 signal 传给 fetch 即可——
 * 一旦 abort，resp.body reader 会抛错退出循环，这里无需显式处理 signal。
 */
async function consumeSseStream(
  resp: Response,
  onEvent: (ev: ChatSseEvent) => void,
): Promise<void> {
  if (!resp.body) return
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
        onEvent(JSON.parse(json) as ChatSseEvent)
      } catch {
        /* skip malformed event */
      }
    }
  }
}

export function ChatView({ sessionId, selectedModelId, onPickModel }: Props) {
  const t = useT()
  const modelId = selectedModelId
  const {
    contexts, clearContexts, removeContext,
    setInspectorActive, inspectorActive,
    setBusy, pageContext, bumpTypingSignal,
  } = useCopilotStore()
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
  const [pendingCallIds, setPendingCallIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 追踪流中 tool_use_end 进入 state 的顺序，done 时按序配 id 给 tool_use_message_ids
  const streamToolUseOrderRef = useRef<string[]>([])
  // Auto-run 队列：tool_use_end 事件进来时先只渲染 UI，把 read 工具的 call_id/input
  // 塞进这里，等 `done` SSE 事件到达（此时 server 已经把 tool_use 消息 append 到 jsonl）
  // 再一次性 fire /tool-result POST。这样避免 /tool-result 在 server append 之前跑，
  // 导致 getActiveBranch 里没有 tool_use → tool_result 的 parent_id 错链到上游。
  const pendingAutoRunRef = useRef<Array<{ call_id: string; tool_name: string; input: Record<string, unknown> }>>([])
  // 追踪 session 身份：sessionId 变更时停掉 inflight 的 auto-run 以避免串 session
  const currentSessionRef = useRef<string | undefined>(undefined)

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
    currentSessionRef.current = sessionId
    if (!sessionId) { setMessages([]); return }
    setLoadingSession(true)
    fetch(`/api/copilot/sessions/${sessionId}`)
      .then(r => r.json())
      .then((d: { messages?: CopilotMessage[] }) => {
        setMessages((d.messages ?? []).map(toUiMessage))
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingSession(false))
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, sending, pendingCallIds])

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const canSend = !!input.trim() && !sending && !!sessionId && !!modelId

  /**
   * 把 SSE 事件落到 React state 的通用 handler 工厂。/chat 和 /tool-result
   * 流共用；auto-run 的读工具在 tool_use_end 里直接触发第二段 POST。
   *
   * 参数 pairSessionId 是发起流时快照的 sessionId —— 流回来的事件只有在
   * 还在同一 session 时才生效，避免用户中途切会话 / fork 后 stale 事件污染。
   */
  const makeSseHandler = (pairSessionId: string) => {
    return (ev: ChatSseEvent) => {
      if (currentSessionRef.current !== pairSessionId) return
      if (ev.kind === "text") {
        setMessages(prev => {
          const next = prev.slice()
          // 找最后一条 assistant，没有就 push 一个 streaming=true 的新气泡
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "assistant") {
              next[i] = { ...m, content: m.content + ev.delta, streaming: true }
              return next
            }
            if (m.role === "tool_use" || m.role === "tool_result") break
          }
          next.push({ role: "assistant", content: ev.delta, streaming: true })
          return next
        })
      } else if (ev.kind === "user_message") {
        setMessages(prev => {
          const next = prev.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "user" && !m.id) {
              next[i] = { ...m, id: ev.id }
              break
            }
          }
          return next
        })
      } else if (ev.kind === "tool_result_message") {
        setMessages(prev => {
          const next = prev.slice()
          // 最近一条没 id 的 tool_result 拿这个 id（我们在 postToolResult 时 push 的占位），
          // 同时把服务端的 content / denied / reason 回填进去——ToolCallCard 依赖
          // content 的 JSON 字符串通过 summarizeResult 渲出 "5/12" 这种摘要。
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "tool_result" && !m.id) {
              next[i] = {
                ...m,
                id: ev.id,
                content: ev.content ?? m.content,
                denied: ev.denied ?? m.denied,
                reason: ev.reason ?? m.reason,
              }
              break
            }
          }
          return next
        })
      } else if (ev.kind === "tool_use_start") {
        // 无需改 UI state（input 未齐，先不渲染占位；等 _end 再 push）
      } else if (ev.kind === "tool_use_delta") {
        // 同上：跳过 delta，ToolCallCard 只看 _end 后的完整 input
      } else if (ev.kind === "tool_use_end") {
        // 关掉当前 assistant 气泡的 streaming flag（tool_use 出现即意味 LLM 这轮 text 说完了）
        setMessages(prev => {
          const next = prev.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "assistant" && m.streaming) {
              next[i] = { ...m, streaming: false }
              break
            }
            if (m.role === "tool_use" || m.role === "tool_result") break
          }
          next.push({
            role: "tool_use",
            call_id: ev.call_id,
            tool_name: ev.tool_name,
            tool_input: ev.input,
          })
          return next
        })
        streamToolUseOrderRef.current.push(ev.call_id)
        // Auto-run read 工具：先入队，等 `done` 事件到（此时 server 已 append tool_use）再真正 POST。
        // 立即 POST 会和 /chat 的 post-stream append 竞争，产生 parent_id 错链（tool_result 挂到 user 而不是 tool_use）。
        const tool = findToolMetadata(ev.tool_name)
        if (tool && !tool.requiresConfirm) {
          pendingAutoRunRef.current.push({ call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
        }
      } else if (ev.kind === "done") {
        // 关掉最后一条 streaming assistant
        setMessages(prev => {
          const next = prev.slice()
          const toolIds = ev.tool_use_message_ids ?? []
          // 按 streamToolUseOrderRef 的顺序把 id 赋到对应 tool_use 消息
          const order = streamToolUseOrderRef.current
          let orderCursor = 0
          for (let i = 0; i < next.length && orderCursor < order.length; i++) {
            const m = next[i]
            if (m.role === "tool_use" && !m.id && m.call_id === order[orderCursor]) {
              if (toolIds[orderCursor]) {
                next[i] = { ...m, id: toolIds[orderCursor], streaming: false }
              }
              orderCursor++
            }
          }
          // 找到末尾 streaming assistant，挂上 id
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "assistant" && m.streaming) {
              next[i] = { ...m, id: ev.assistant_message_id ?? m.id, streaming: false }
              break
            }
            if (m.role === "assistant" && !m.id && ev.assistant_message_id) {
              next[i] = { ...m, id: ev.assistant_message_id }
              break
            }
          }
          return next
        })
        streamToolUseOrderRef.current = []
        // 现在 server 已经把所有本轮的 tool_use append 到 jsonl 了，可以放心 auto-run read 工具。
        // 写工具（requiresConfirm=true）等用户点 Confirm 再走，走同一个 postToolResult 路径。
        const pending = pendingAutoRunRef.current
        pendingAutoRunRef.current = []
        // 必须串行（await 每个）：若并行 POST /tool-result，多个请求读同一 branch、
        // 各自 append tool_result + 调 LLM → appendMessage 虽然现在用 append-mode 不会丢消息，
        // 但多条 tool_result 的 parent_id 都会错位指向 /chat 末端而不是各自的 tool_use。
        // 另外 chain cap 逻辑依赖 trailing pair 计数，串行才准。
        ;(async () => {
          for (const tu of pending) {
            if (currentSessionRef.current !== pairSessionId) break
            await postToolResult(tu.call_id, tu.tool_name, tu.input, false)
          }
        })()
      } else if (ev.kind === "error") {
        toast.error(ev.message)
        setMessages(prev => {
          const next = prev.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "assistant" && m.streaming) {
              next[i] = { ...m, content: m.content || t("copilot.reply_failed"), streaming: false }
              break
            }
          }
          return next
        })
      }
    }
  }

  /**
   * 发送 /tool-result。封装 /chat 和 auto-run 共用的工具结果回传：
   *  1. pendingCallIds 登记（UI 上对应的 ToolCallCard 按钮 disabled）
   *  2. 先 push 一个无 id 的 tool_result 占位 message，等 SSE 的 tool_result_message 事件回来填 id
   *  3. 消费 SSE：text / tool_use_end 同一套 handler，形成链式 LLM 对话
   *  4. finally 清 pending
   */
  const postToolResult = async (
    call_id: string,
    tool_name: string,
    input: Record<string, unknown>,
    denied: boolean,
    reason?: string,
  ) => {
    if (!sessionId) return
    const pairSessionId = sessionId
    setPendingCallIds(prev => {
      const next = new Set(prev)
      next.add(call_id)
      return next
    })
    setBusy(true)
    // 先插入 tool_result 占位（content 显示 denied/resolved 摘要；id 由 tool_result_message 事件回填）
    setMessages(prev => [
      ...prev,
      {
        role: "tool_result",
        call_id,
        tool_name,
        content: denied ? JSON.stringify({ denied: true, reason: reason ?? "" }) : "",
        denied: denied || undefined,
        reason,
      },
    ])
    // 若前一个请求（另一个 postToolResult 或 doStreamSend）还没结束，先 abort：
    // 避免旧 SSE 继续消费 + 状态回写和新的 action 混线。
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await fetch(`/api/copilot/sessions/${sessionId}/tool-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id, tool_name, input, denied, reason,
          client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        if (resp.status === 429) {
          toast.error(t("copilot.tool.chain_limit"))
        } else {
          const errBody = await resp.text().catch(() => "")
          toast.error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
        }
        return
      }
      // Reset order ref for this stream segment
      streamToolUseOrderRef.current = []
      pendingAutoRunRef.current = []
      await consumeSseStream(resp, makeSseHandler(pairSessionId))
      // tool_result_message 事件已经回填了 content / denied / reason，这里不再需要兜底占位。
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error((e as Error).message)
      }
    } finally {
      setPendingCallIds(prev => {
        const next = new Set(prev)
        next.delete(call_id)
        return next
      })
      setBusy(false)
      abortRef.current = null
    }
  }

  const handleToolConfirm = (call_id: string, tool_name: string, tool_input: Record<string, unknown>) => {
    void postToolResult(call_id, tool_name, tool_input, false)
  }
  const handleToolDeny = (call_id: string, tool_name: string, tool_input: Record<string, unknown>, reason: string) => {
    void postToolResult(call_id, tool_name, tool_input, true, reason)
  }

  const doStreamSend = async (text: string, sendContexts?: CopilotContextRef[]) => {
    if (!sessionId || !modelId) return
    const pairSessionId = sessionId
    setSending(true)
    setBusy(true)
    setMessages(prev => [
      ...prev,
      { role: "user", content: text, contexts: sendContexts },
      { role: "assistant", content: "", streaming: true },
    ])
    // 同理先 abort 旧请求，防止用户连点 Send 时两个流并行跑
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    streamToolUseOrderRef.current = []
    pendingAutoRunRef.current = []
    try {
      const resp = await fetch(`/api/copilot/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: text,
          model_id: modelId,
          contexts: sendContexts,
          client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => "")
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
      }
      await consumeSseStream(resp, makeSseHandler(pairSessionId))
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error(t("copilot.send_failed") + ": " + (e as Error).message)
      }
      setMessages(prev => {
        const next = prev.slice()
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i]
          if (m.role === "assistant" && m.streaming) {
            next[i] = { ...m, streaming: false }
            break
          }
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
    if (msg.role !== "user" && msg.role !== "assistant") return
    setEditingId(msg.id)
    setEditDraft(msg.content)
  }

  const cancelEdit = () => {
    setEditingId(undefined)
    setEditDraft("")
  }

  const commitEdit = async (msg: UiMessage) => {
    if (!sessionId || !msg.id || !editDraft.trim()) { cancelEdit(); return }
    if (msg.role !== "user") { cancelEdit(); return }
    const newText = editDraft.trim()
    const oldContexts = msg.contexts
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
    await doStreamSend(newText, oldContexts)
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
        {messages.map((m, i) => {
          if (m.role === "tool_use") {
            // 往后找配对 tool_result（同 call_id）
            let paired: UiMessage | undefined
            for (let j = i + 1; j < messages.length; j++) {
              const x = messages[j]
              if (x.role === "tool_result" && x.call_id === m.call_id) {
                paired = x
                break
              }
            }
            const pending = pendingCallIds.has(m.call_id)
            // 服务端 append tool_use 到 jsonl 后才在 `done` 事件里回填 id。
            // 没有 id 说明本轮流还没关 / tool_use 还没持久化 —— 此时点 Confirm 会触发 race
            // （/tool-result 跑 getActiveBranch 看不到 tool_use）。按钮先 disabled 挡住。
            const persistedOnServer = !!m.id && !m.id.startsWith("tu-")
            const toolUseShim: CopilotMessage = {
              id: m.id ?? `tu-${i}`,
              session_id: sessionId,
              role: "tool_use",
              content: "",
              timestamp: "",
              call_id: m.call_id,
              tool_name: m.tool_name,
              tool_input: m.tool_input,
            }
            const toolResultShim: CopilotMessage | undefined = paired && paired.role === "tool_result"
              ? {
                  id: paired.id ?? `tr-${i}`,
                  session_id: sessionId,
                  role: "tool_result",
                  content: paired.content,
                  timestamp: "",
                  call_id: paired.call_id,
                  tool_name: paired.tool_name,
                  denied: paired.denied,
                  reason: paired.reason,
                }
              : undefined
            return (
              <ToolCallCard
                key={m.id ?? `tu-${i}`}
                toolUse={toolUseShim}
                toolResult={toolResultShim}
                onConfirm={() => handleToolConfirm(m.call_id, m.tool_name, m.tool_input)}
                onDeny={(reason) => handleToolDeny(m.call_id, m.tool_name, m.tool_input, reason)}
                pending={pending || !persistedOnServer}
              />
            )
          }
          if (m.role === "tool_result") return null
          return (
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
          )
        })}
        {(() => {
          // 任一 fetch 在飞（/chat 或 /tool-result），就在消息流末尾 pin 一个 thinking 气泡。
          // 最后一条消息如果本身就是正在 streaming 的 assistant（里面已经有 dots 或 blink cursor）
          // 则不重复渲染，避免双 dots。
          const inFlight = sending || pendingCallIds.size > 0
          if (!inFlight) return null
          const last = messages[messages.length - 1]
          const lastIsStreamingAssistant =
            last && last.role === "assistant" && last.streaming === true
          if (lastIsStreamingAssistant) return null
          return (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-md px-3 py-2 bg-muted text-foreground border border-border/60">
                <ThinkingDots />
              </div>
            </div>
          )
        })()}
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

/**
 * 把 session 历史里的 CopilotMessage 映射成 UiMessage 的 discriminated union。
 * tool_use / tool_result 消息在存储层必有 call_id / tool_name；做了兜底以兼容旧数据。
 */
function toUiMessage(m: CopilotMessage): UiMessage {
  if (m.role === "tool_use") {
    return {
      role: "tool_use",
      id: m.id,
      call_id: m.call_id ?? "",
      tool_name: m.tool_name ?? "",
      tool_input: m.tool_input ?? {},
    }
  }
  if (m.role === "tool_result") {
    return {
      role: "tool_result",
      id: m.id,
      call_id: m.call_id ?? "",
      tool_name: m.tool_name ?? "",
      content: m.content,
      denied: m.denied,
      reason: m.reason,
    }
  }
  if (m.role === "user") {
    return { role: "user", id: m.id, content: m.content, contexts: m.contexts }
  }
  return { role: "assistant", id: m.id, content: m.content }
}
