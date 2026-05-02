"use client"

import { useEffect, useRef, useState } from "react"
import type { CopilotMessage, CopilotContextRef, PageContext } from "@/lib/copilot/types"
import { findToolMetadata } from "@/lib/copilot/tool-metadata"
import { collectClientSnapshot } from "@/lib/copilot/collect-snapshot"
import { useCopilotStore } from "./store"
import type { UiMessage } from "./chat-view-parts"

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

export interface UseChatStreamParams {
  sessionId?: string
  modelId?: string
  pageContext: PageContext | null
  onError: (message: string) => void
  tI18nReplyFailed: string
  tI18nChainLimit: string
  tI18nSendFailed: string
  tI18nDeleteFailed: string
  tI18nDeleteConfirm: string
}

export interface UseChatStreamResult {
  messages: UiMessage[]
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>
  sending: boolean
  loadingSession: boolean
  pendingCallIds: Set<string>
  send: (text: string, contexts?: CopilotContextRef[]) => Promise<void>
  confirmTool: (call_id: string, tool_name: string, input: Record<string, unknown>) => void
  denyTool: (call_id: string, tool_name: string, input: Record<string, unknown>, reason: string) => void
  deleteMessage: (msg: UiMessage) => Promise<void>
  editUserMessage: (msg: UiMessage, newText: string) => Promise<void>
}

export function useChatStream(p: UseChatStreamParams): UseChatStreamResult {
  const { sessionId, modelId, pageContext, onError } = p
  const { setBusy } = useCopilotStore()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [pendingCallIds, setPendingCallIds] = useState<Set<string>>(new Set())
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
    return () => { abortRef.current?.abort() }
  }, [])

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
        // Race fix: React 19 concurrent 下，setMessages 的 functional updater 可能在
        // commit 阶段异步运行 —— 若此时 streamToolUseOrderRef.current 已被下面清空（= []），
        // updater 内 for-loop 会零迭代，tool_use 消息的 m.id 永远不会回填。前端
        // ToolCallCard 的 persistedOnServer 随之为 false，Confirm/Deny 按钮被卡死
        // disabled 直到用户刷新页面（服务端已持久化，重新 GET /sessions/{id} 拿真 id 才好）。
        // 修复：先捕获 ref 值到 local 再清 ref；updater 用 local snapshot 而非 ref.current。
        const orderSnapshot = streamToolUseOrderRef.current
        streamToolUseOrderRef.current = []
        const pending = pendingAutoRunRef.current
        pendingAutoRunRef.current = []

        // 关掉最后一条 streaming assistant
        setMessages(prev => {
          const next = prev.slice()
          const toolIds = ev.tool_use_message_ids ?? []
          // 按 orderSnapshot 的顺序把 id 赋到对应 tool_use 消息
          let orderCursor = 0
          for (let i = 0; i < next.length && orderCursor < orderSnapshot.length; i++) {
            const m = next[i]
            if (m.role === "tool_use" && !m.id && m.call_id === orderSnapshot[orderCursor]) {
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
        // 现在 server 已经把所有本轮的 tool_use append 到 jsonl 了，可以放心 auto-run read 工具。
        // 写工具（requiresConfirm=true）等用户点 Confirm 再走，走同一个 postToolResult 路径。
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
        onError(ev.message)
        setMessages(prev => {
          const next = prev.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === "assistant" && m.streaming) {
              next[i] = { ...m, content: m.content || p.tI18nReplyFailed, streaming: false }
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
          onError(p.tI18nChainLimit)
        } else {
          const errBody = await resp.text().catch(() => "")
          onError(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
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
        onError((e as Error).message)
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

  const confirmTool = (call_id: string, tool_name: string, tool_input: Record<string, unknown>) => {
    void postToolResult(call_id, tool_name, tool_input, false)
  }
  const denyTool = (call_id: string, tool_name: string, tool_input: Record<string, unknown>, reason: string) => {
    void postToolResult(call_id, tool_name, tool_input, true, reason)
  }

  const send = async (text: string, sendContexts?: CopilotContextRef[]) => {
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
        onError(p.tI18nSendFailed + ": " + (e as Error).message)
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

  const deleteMessage = async (msg: UiMessage) => {
    if (!sessionId || !msg.id) return
    if (!confirm(p.tI18nDeleteConfirm)) return
    try {
      const r = await fetch(`/api/copilot/sessions/${sessionId}/messages/${msg.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(String(r.status))
      const { removed } = await r.json() as { removed: string[] }
      const set = new Set(removed)
      setMessages(prev => prev.filter(m => !m.id || !set.has(m.id)))
    } catch {
      onError(p.tI18nDeleteFailed)
    }
  }

  const editUserMessage = async (msg: UiMessage, newText: string) => {
    if (!sessionId || !msg.id || !newText.trim()) return
    if (msg.role !== "user") return
    const oldContexts = msg.contexts
    // 1) 删掉旧 user 消息 + 它的所有后代（通常是一条 assistant 回复）
    try {
      const r = await fetch(`/api/copilot/sessions/${sessionId}/messages/${msg.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(String(r.status))
      const { removed } = await r.json() as { removed: string[] }
      const set = new Set(removed)
      setMessages(prev => prev.filter(m => !m.id || !set.has(m.id)))
    } catch {
      onError(p.tI18nDeleteFailed)
      return
    }
    // 2) 用新内容作为新 user 消息发一次；复用原消息的 contexts（如果有）
    await send(newText.trim(), oldContexts)
  }

  return {
    messages,
    setMessages,
    sending,
    loadingSession,
    pendingCallIds,
    send,
    confirmTool,
    denyTool,
    deleteMessage,
    editUserMessage,
  }
}
