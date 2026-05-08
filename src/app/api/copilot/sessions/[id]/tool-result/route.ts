import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
} from '@/lib/copilot/session-store'
import { TOOLS, toolByName } from '@/lib/copilot/tools/registry'
import { runTool } from '@/lib/copilot/tool-runtime'
import { getLlmConfig } from '@/lib/llm-config'
import type { ClientSnapshot } from '@/lib/copilot/types'
import { setSnapshot } from '@/lib/copilot/snapshot-cache'
import { runToolAwareLlmStream } from '@/lib/copilot/stream-response'

/**
 * POST body：
 *   {
 *     call_id: string              // 配对待处理的 tool_use 消息
 *     tool_name: string            // 审计 + 安全检查
 *     input: Record<string, unknown>  // 用户确认的参数（通常与 LLM 原始 tool_input 一致）
 *     denied?: boolean             // true = 用户拒绝；false/undefined = 确认执行
 *     reason?: string              // 拒绝的可选原因
 *     client_snapshot?: ClientSnapshot
 *   }
 *
 * 流程：
 *   1. 校验 session / body
 *   2. 链长上限 5（trailing tool_use+tool_result 对计数）→ 超过返 429
 *   3. 校验 model（race fix：必须在 append 之前，避免孤儿 tool_result）
 *   4. 执行工具（或记录 denied）→ 写 tool_result 消息（parent_id = tail）
 *   5. 重新拉 branch（含本次 tool_result）→ 调 `runToolAwareLlmStream`
 *      → helper 内部做 callLlmStreaming + 累 text/tool_use + 后置顺序 append
 *      → 回到本 route 再 emit `done`
 *
 * SSE 事件（与 /chat route 对齐）：
 *   { kind: 'tool_result_message', id, content, denied?, reason? }
 *       — 服务端为 tool_result 分配的消息 id + 结果 JSON（供前端 summary 渲染）
 *   { kind: 'text', delta }
 *   { kind: 'tool_use_start' | 'tool_use_delta' | 'tool_use_end', ... } — 转发 LLM 事件
 *   { kind: 'done', assistant_message_id?, tool_use_message_ids?, usage?, stop_reason? }
 *   { kind: 'error', message }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) return jsonError(404, 'session not found')

  const body = (await req.json().catch(() => ({}))) as {
    call_id?: string
    tool_name?: string
    input?: Record<string, unknown>
    denied?: boolean
    reason?: string
    client_snapshot?: ClientSnapshot
    /** v2.5 §8: 客户端 sessionStorage 读出的 allow list，未来 `/chat` 内直跑工具时由 confirmGateHook 消费 */
    session_allow_list?: string[]
    /** v2.5 P0 §3.3: 对称的 deny list；confirmGateHook 中 deny > allow > 默认 confirm */
    session_deny_list?: string[]
  }
  if (!body.call_id || typeof body.call_id !== 'string') return jsonError(400, 'call_id required')
  if (!body.tool_name || typeof body.tool_name !== 'string') return jsonError(400, 'tool_name required')
  if (!body.input || typeof body.input !== 'object') return jsonError(400, 'input required')

  // 缓存 client_snapshot（用于 read_page 工具 + page_context 注入）
  if (body.client_snapshot) setSnapshot(sessionId, body.client_snapshot)

  // 链长上限 5（trailing tool_use + tool_result 对）
  const branchBefore = getActiveBranch(sessionId)
  const completedPairs = countTrailingToolUsePairs(branchBefore)
  if (completedPairs >= 5) return jsonError(429, 'chain call limit reached')

  // race fix：model 校验必须放在 appendMessage 之前，避免 model 未配置时
  // 留下孤儿 tool_result 消息在 jsonl 里。
  const cfg = getLlmConfig()
  const modelId = session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) return jsonError(400, 'copilot model not configured or not enabled')
  if (!model.base_url || !model.api_key) return jsonError(400, 'model missing base_url or api_key')

  // 本条 tool_result 的 parent 指向当前 branch 末端（通常是 hanging tool_use）
  const tailId = branchBefore[branchBefore.length - 1]?.id

  // 计算 result content
  let resultContent: unknown
  if (body.denied === true) {
    resultContent = { denied: true, reason: body.reason ?? '' }
  } else {
    // 未知 tool 直接 400：客户端说谎，不该发生
    const tool = toolByName.get(body.tool_name)
    if (!tool) return jsonError(400, `unknown tool: ${body.tool_name}`)
    try {
      // 走 runTool 以穿过 postToolCallHooks（M3 payloadGuard 会在这里做落盘 +
      // ref 替换）。skipConfirm=true：用户已在 UI 点 Confirm 才会走到这个 route，
      // 绕过 preToolCall 的 confirmGateHook 避免死锁。
      const r = await runTool(tool, body.input, { session_id: sessionId, signal: req.signal }, { skipConfirm: true, sessionAllowList: body.session_allow_list, sessionDenyList: body.session_deny_list })
      if (r.kind === 'done') {
        resultContent = r.output
      } else if (r.kind === 'denied') {
        resultContent = { error: `tool denied by server hook: ${r.reason}` }
      } else {
        // 理论上 skipConfirm=true 不该走到这；防御性兜底
        resultContent = { error: 'unexpected: tool awaiting confirm in /tool-result route' }
      }
    } catch (e) {
      // 工具错误不 500：LLM 看到 error 字段后可以决定下一步
      resultContent = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  // 落盘 tool_result 消息
  const toolResultMsg = appendMessage({
    session_id: sessionId,
    role: 'tool_result',
    content: JSON.stringify(resultContent),
    call_id: body.call_id,
    tool_name: body.tool_name,
    denied: body.denied,
    reason: body.reason,
    parent_id: tailId,
  })

  // 重新拉 branch（含刚 append 的 tool_result）
  const branch = getActiveBranch(sessionId, toolResultMsg.id)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // race fix：客户端已 abort / 流已关时 controller.enqueue 会抛
      // "Controller is already closed"；吞掉 —— 没法再回写客户端。
      const write = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch { /* stream closed */ }
      }
      // 回传 content + denied + reason 给前端，让 ToolCallCard.summarizeResult 能渲出
      // "5/12" 这种读工具摘要。只发 id 会让占位 UiMessage 的 content 保持空串。
      write({
        kind: 'tool_result_message',
        id: toolResultMsg.id,
        content: JSON.stringify(resultContent),
        denied: body.denied,
        reason: body.reason,
      })

      try {
        const result = await runToolAwareLlmStream({
          sessionId,
          branch,
          model,
          tools: TOOLS,
          pageContext: body.client_snapshot?.page_context ?? null,
          startParentId: toolResultMsg.id,
          signal: req.signal,
          write,
        })
        // helper 已保证 assistant / tool_use 落盘先于这里 emit done
        write({
          kind: 'done',
          assistant_message_id: result.assistantMessageId,
          tool_use_message_ids: result.toolUseMessageIds,
          usage: result.usage,
          stop_reason: result.stopReason,
        })
      } catch (e) {
        write({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * 统计 branch 末端连续 tool_use / tool_result 的"已完成对"数。
 * 调用 /tool-result 时，末端通常是 hanging tool_use（没有配对 result），所以
 * trailing 计数含奇数项；Math.floor(count/2) 得到完成对的数量。cap=5。
 */
function countTrailingToolUsePairs(messages: { role: string }[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (role === 'tool_use' || role === 'tool_result') count++
    else break
  }
  return Math.floor(count / 2)
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
