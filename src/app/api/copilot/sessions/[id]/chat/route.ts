import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
  autoTitleSessionIfNeeded,
  updateSession,
} from '@/lib/copilot/session-store'
import { TOOLS } from '@/lib/copilot/tools/registry'
import type { CopilotContextRef, ClientSnapshot } from '@/lib/copilot/types'
import { getLlmConfig } from '@/lib/llm-config'
import { setSnapshot } from '@/lib/copilot/snapshot-cache'
import { runToolAwareLlmStream } from '@/lib/copilot/stream-response'

/**
 * POST body：
 *   { user_message: string, parent_id?: string, model_id?: string, contexts?: CopilotContextRef[], client_snapshot?: ClientSnapshot }
 *
 * 返回 text/event-stream，事件类型（每条一行 `data: <json>\n\n`）：
 *   { kind: 'user_message', id }                        — 服务端为用户消息分配的 id
 *   { kind: 'text', delta }                             — LLM 文本增量
 *   { kind: 'tool_use_start' | 'tool_use_delta' | 'tool_use_end', ... }
 *                                                       — 转发 LLM 工具调用事件（PR-3）
 *   { kind: 'done', assistant_message_id?, tool_use_message_ids?, usage?, stop_reason? }
 *   { kind: 'error', message }
 *
 * 工具调用流程与 /tool-result route 对齐：本 route 负责首轮。若 LLM 在首轮就发起
 * 工具调用，text 与 tool_use 都会落盘（text 作 assistant 消息，每条 tool_use 作一条
 * tool_use 消息，parent_id 链式串起来），前端收到 tool_use_end 后会调 /tool-result。
 *
 * 流式段（调 LLM + 累 text/tool_use + 后置顺序 append）已抽到
 * `@/lib/copilot/stream-response.ts` 的 `runToolAwareLlmStream`，与 /tool-result 共享。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) return jsonError(404, 'session not found')

  const body = await req.json().catch(() => ({})) as {
    user_message?: string
    parent_id?: string
    model_id?: string
    contexts?: CopilotContextRef[]
    client_snapshot?: ClientSnapshot
    /** v2.5 §8: 与 /tool-result 对齐；当前 /chat 流不调 runTool 直接跑工具，留字段供未来扩展 */
    session_allow_list?: string[]
  }
  if (!body.user_message || typeof body.user_message !== 'string') return jsonError(400, 'user_message required')

  const cfg = getLlmConfig()
  const modelId = body.model_id ?? session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) return jsonError(400, 'copilot model not configured or not enabled')
  if (!model.base_url || !model.api_key) return jsonError(400, 'model missing base_url or api_key')

  // 如果 model_id 被本次请求指定了且与 session 之前不同，更新 session.model_id
  if (body.model_id && body.model_id !== session.model_id) {
    updateSession(sessionId, { model_id: body.model_id })
  }

  // 选 parent_id：默认为当前 head
  const parent_id = body.parent_id ?? session.head_message_id

  // 缓存 client_snapshot（用于 read_page 工具 + page_context 注入）
  if (body.client_snapshot) setSnapshot(sessionId, body.client_snapshot)

  // 追加 user 消息
  const userMsg = appendMessage({
    session_id: sessionId,
    role: 'user',
    content: body.user_message,
    parent_id,
    contexts: body.contexts,
  })
  autoTitleSessionIfNeeded(sessionId, body.user_message)

  const branch = getActiveBranch(sessionId, userMsg.id)

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
      write({ kind: 'user_message', id: userMsg.id })

      try {
        const result = await runToolAwareLlmStream({
          sessionId,
          branch,
          model,
          tools: TOOLS,
          pageContext: body.client_snapshot?.page_context ?? null,
          startParentId: userMsg.id,
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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
