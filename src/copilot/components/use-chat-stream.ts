"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CopilotMessage, CopilotContextRef, PageContext } from "@/copilot/lib/types"
import { needsConfirm } from "@/copilot/lib/tools/client-registry"
import { isSessionAllowed, getSessionAllowList, addSessionAllow, isSessionDenied, getSessionDenyList, addSessionDeny } from "@/copilot/lib/session-allow"
import { collectClientSnapshot } from "@/copilot/lib/collect-snapshot"
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
  | { kind: "loop_warn"; call_id: string; reason_key: string; reason_vars: { tool: string; count: number } }
  | { kind: "done"; assistant_message_id?: string; tool_use_message_ids?: string[]; usage?: { input_tokens: number; output_tokens: number }; stop_reason?: string }
  | { kind: "error"; message: string }
  | { kind: "heartbeat" } // v0.18.8 P1.1: 防中间件 idle-close；client 收到直接忽略

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
      ...(m.denied !== undefined ? { denied: m.denied } : {}),
      ...(m.reason !== undefined ? { reason: m.reason } : {}),
    }
  }
  if (m.role === "user") {
    return {
      role: "user",
      id: m.id,
      content: m.content,
      ...(m.contexts !== undefined ? { contexts: m.contexts } : {}),
    }
  }
  return { role: "assistant", id: m.id, content: m.content }
}

interface UseChatStreamParams {
  sessionId?: string | undefined
  modelId?: string | undefined
  pageContext: PageContext | null
  onError: (message: string) => void
  tI18nReplyFailed: string
  tI18nChainLimit: string
  tI18nSendFailed: string
  tI18nDeleteFailed: string
  tI18nDeleteConfirm: string
}

interface UseChatStreamResult {
  messages: UiMessage[]
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>
  sending: boolean
  loadingSession: boolean
  pendingCallIds: Set<string>
  send: (text: string, contexts?: CopilotContextRef[]) => Promise<void>
  confirmTool: (call_id: string, tool_name: string, input: Record<string, unknown>, alwaysAllow?: boolean) => void
  denyTool: (call_id: string, tool_name: string, input: Record<string, unknown>, reason: string, alwaysDeny?: boolean) => void
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
  // v0.18.11 H4：busy 改成计数器
  // 原因：`send()` 触发的 done 事件会 fire-and-forget IIFE 跑 `postToolResult()`
  //   auto-run，IIFE 不被 send() await。两者都 setBusy(true)/setBusy(false)，重叠时
  //   先结束的那条会把 busy 提前置 false，但另一条还在跑——UI 显 idle 但 stream 活着。
  // 解：incBusy/decBusy 维护引用计数；只在 0→1 / 1→0 转换时实际写 setBusy；负数兜底。
  const busyCountRef = useRef(0)
  const incBusy = useCallback(() => {
    if (busyCountRef.current === 0) setBusy(true)
    busyCountRef.current++
  }, [setBusy])
  const decBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1)
    if (busyCountRef.current === 0) setBusy(false)
  }, [setBusy])
  // v0.18.11 H4：abortRef 只在仍是自己拥有的 ctrl 时清——
  // 避免新 send() 已设了新 ctrl 后被旧操作 finally 误清成 null。
  const clearAbortIfOwn = useCallback((ctrl: AbortController) => {
    if (abortRef.current === ctrl) abortRef.current = null
  }, [])
  // 追踪流中 tool_use_end 进入 state 的顺序，done 时按序配 id 给 tool_use_message_ids
  const streamToolUseOrderRef = useRef<string[]>([])
  // Auto-run 队列：tool_use_end 事件进来时先只渲染 UI，把 read 工具的 call_id/input
  // 塞进这里，等 `done` SSE 事件到达（此时 server 已经把 tool_use 消息 append 到 jsonl）
  // 再一次性 fire /tool-result POST。这样避免 /tool-result 在 server append 之前跑，
  // 导致 getActiveBranch 里没有 tool_use → tool_result 的 parent_id 错链到上游。
  const pendingAutoRunRef = useRef<Array<{ call_id: string; tool_name: string; input: Record<string, unknown> }>>([])
  // v2.5 P0 §3.3 Auto-deny 队列：对称 pendingAutoRunRef。用户勾过 "Always deny in this session"
  // 后，tool_use_end 时不再弹 Confirm card，直接入队，done 时串行 POST denied=true 的 /tool-result。
  const pendingAutoDenyRef = useRef<Array<{ call_id: string; tool_name: string; input: Record<string, unknown>; reason: string }>>([])
  // 追踪 session 身份：sessionId 变更时停掉 inflight 的 auto-run 以避免串 session
  const currentSessionRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    currentSessionRef.current = sessionId
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on session change before async load; see docs/conventions/react19-hydration.md
    if (!sessionId) { setMessages([]); return }
    // v0.18.10 H3：快速切 session 时旧 session GET .then 后到会覆盖新 session messages。
    // AbortController 取消 stale 请求 + signal.aborted 守卫每个 chain 段，确保只有当前
    // session 的响应能改 state。
    const ctrl = new AbortController()
    setLoadingSession(true)
    fetch(`/api/copilot/sessions/${sessionId}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { messages?: CopilotMessage[] }) => {
        if (ctrl.signal.aborted) return
        setMessages((d.messages ?? []).map(toUiMessage))
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setMessages([])
      })
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoadingSession(false)
      })
    return () => { ctrl.abort() }
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
      // v0.18.8 P1.2: server 每 20s 发 heartbeat 防中间件 idle-close；client 直接忽略。
      if (ev.kind === "heartbeat") return
      if (ev.kind === "text") {
        setMessages(prev => {
          const next = prev.slice()
          // 找最后一条 assistant，没有就 push 一个 streaming=true 的新气泡
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (!m) continue
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
            if (!m) continue
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
            if (!m) continue
            if (m.role === "tool_result" && !m.id) {
              const denied = ev.denied ?? m.denied
              const reason = ev.reason ?? m.reason
              next[i] = {
                ...m,
                id: ev.id,
                content: ev.content ?? m.content,
                ...(denied !== undefined ? { denied } : {}),
                ...(reason !== undefined ? { reason } : {}),
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
            if (!m) continue
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
        // Task 20: 同时也短路 session-allow 的写工具——用户勾过"本次会话信任此工具"，
        // 下一次命中这个 tool_name 就不再弹 Confirm card，走 auto-run 路径。
        const sessionAllowList = pairSessionId ? getSessionAllowList(pairSessionId) : []
        const sessionDenyList = pairSessionId ? getSessionDenyList(pairSessionId) : []
        if (isSessionDenied(sessionDenyList, ev.tool_name)) {
          // v2.5 P0 §3.3: 用户勾过 "Always deny in this session"，跳过 Confirm 直接入队 auto-deny
          pendingAutoDenyRef.current.push({
            call_id: ev.call_id,
            tool_name: ev.tool_name,
            input: ev.input,
            reason: "auto-denied for this session",
          })
        } else if (!needsConfirm(ev.tool_name) || isSessionAllowed(sessionAllowList, ev.tool_name)) {
          pendingAutoRunRef.current.push({ call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
        }
      } else if (ev.kind === "loop_warn") {
        // v2.5 P0 §3.4: warn 档命中 —— server 仍继续执行，UI 插一条 system_notice 提醒用户
        setMessages(prev => [
          ...prev,
          {
            role: "system_notice",
            kind: "loop_warn",
            reasonKey: ev.reason_key,
            reasonVars: ev.reason_vars,
          },
        ])
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
        const pendingDeny = pendingAutoDenyRef.current
        pendingAutoDenyRef.current = []

        // 关掉最后一条 streaming assistant
        setMessages(prev => {
          const next = prev.slice()
          const toolIds = ev.tool_use_message_ids ?? []
          // 按 orderSnapshot 的顺序把 id 赋到对应 tool_use 消息
          let orderCursor = 0
          for (let i = 0; i < next.length && orderCursor < orderSnapshot.length; i++) {
            const m = next[i]
            if (!m) continue
            if (m.role === "tool_use" && !m.id && m.call_id === orderSnapshot[orderCursor]) {
              const newId = toolIds[orderCursor]
              if (newId) {
                next[i] = { ...m, id: newId, streaming: false }
              }
              orderCursor++
            }
          }
          // 找到末尾 streaming assistant，挂上 id
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (!m) continue
            if (m.role === "assistant" && m.streaming) {
              const newId = ev.assistant_message_id ?? m.id
              next[i] = {
                ...m,
                ...(newId !== undefined ? { id: newId } : {}),
                streaming: false,
              }
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
          for (const tu of pendingDeny) {
            if (currentSessionRef.current !== pairSessionId) break
            await postToolResult(tu.call_id, tu.tool_name, tu.input, true, tu.reason)
          }
        })()
      } else if (ev.kind === "error") {
        onError(ev.message)
        setMessages(prev => {
          const next = prev.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (!m) continue
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
    incBusy()
    // 先插入 tool_result 占位（content 显示 denied/resolved 摘要；id 由 tool_result_message 事件回填）
    setMessages(prev => [
      ...prev,
      {
        role: "tool_result",
        call_id,
        tool_name,
        content: denied ? JSON.stringify({ denied: true, reason: reason ?? "" }) : "",
        ...(denied ? { denied: true } : {}),
        ...(reason !== undefined ? { reason } : {}),
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
          session_allow_list: pairSessionId ? getSessionAllowList(pairSessionId) : [],
          session_deny_list: pairSessionId ? getSessionDenyList(pairSessionId) : [],
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => "")
        let parsed: unknown = null
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }
        const obj = parsed as {
          loop_reason_key?: string
          loop_reason_vars?: { tool: string; count: number }
          error?: string
        } | null
        if (resp.status === 429 && obj?.loop_reason_key) {
          // v2.5 P0 §3.4: block 档命中 —— UI 插 system_notice，不再用旧链长 fallback 文案
          console.warn('[copilot] tool-loop blocked', obj.loop_reason_key, obj.loop_reason_vars)
          setMessages(prev => [
            ...prev,
            {
              role: "system_notice",
              kind: "loop_block",
              reasonKey: obj.loop_reason_key!,
              reasonVars: obj.loop_reason_vars ?? { tool: tool_name, count: 0 },
            },
          ])
        } else if (resp.status === 429) {
          // 兼容老 server / 其他 429（比如限流）：fallback 到旧链长文案
          onError(p.tI18nChainLimit)
        } else {
          onError(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
        }
        return
      }
      // Reset order ref for this stream segment
      streamToolUseOrderRef.current = []
      pendingAutoRunRef.current = []
      pendingAutoDenyRef.current = []
      await consumeSseStream(resp, makeSseHandler(pairSessionId))
      // tool_result_message 事件已经回填了 content / denied / reason，这里不再需要兜底占位。
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        // v0.18.8 P1.4: 完整 stack 打到 browser console，toast 仍只显示 message
        console.error("[copilot/chat-stream] tool-result fetch failed:", e)
        onError((e as Error).message)
      }
    } finally {
      setPendingCallIds(prev => {
        const next = new Set(prev)
        next.delete(call_id)
        return next
      })
      decBusy()
      clearAbortIfOwn(ctrl)
    }
  }

  const confirmTool = (
    call_id: string,
    tool_name: string,
    tool_input: Record<string, unknown>,
    alwaysAllow: boolean = false,
  ) => {
    if (alwaysAllow && sessionId) {
      addSessionAllow(sessionId, tool_name)
    }
    void postToolResult(call_id, tool_name, tool_input, false)
  }
  const denyTool = (
    call_id: string,
    tool_name: string,
    tool_input: Record<string, unknown>,
    reason: string,
    alwaysDeny: boolean = false,
  ) => {
    if (alwaysDeny && sessionId) {
      addSessionDeny(sessionId, tool_name)
    }
    void postToolResult(call_id, tool_name, tool_input, true, reason)
  }

  const send = async (text: string, sendContexts?: CopilotContextRef[]) => {
    if (!sessionId || !modelId) return
    const pairSessionId = sessionId
    setSending(true)
    incBusy()
    setMessages(prev => [
      ...prev,
      {
        role: "user",
        content: text,
        ...(sendContexts !== undefined ? { contexts: sendContexts } : {}),
      },
      { role: "assistant", content: "", streaming: true },
    ])
    // 同理先 abort 旧请求，防止用户连点 Send 时两个流并行跑
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    streamToolUseOrderRef.current = []
    pendingAutoRunRef.current = []
    pendingAutoDenyRef.current = []
    try {
      const resp = await fetch(`/api/copilot/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: text,
          model_id: modelId,
          contexts: sendContexts,
          client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
          session_allow_list: pairSessionId ? getSessionAllowList(pairSessionId) : [],
          session_deny_list: pairSessionId ? getSessionDenyList(pairSessionId) : [],
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
        // v0.18.8 P1.4: 完整 stack 打到 browser console，toast 仍只显示 message
        console.error("[copilot/chat-stream] send failed:", e)
        onError(p.tI18nSendFailed + ": " + (e as Error).message)
      }
      setMessages(prev => {
        const next = prev.slice()
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i]
          if (!m) continue
          if (m.role === "assistant" && m.streaming) {
            next[i] = { ...m, streaming: false }
            break
          }
        }
        return next
      })
    } finally {
      setSending(false)
      decBusy()
      clearAbortIfOwn(ctrl)
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
