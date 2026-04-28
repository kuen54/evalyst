import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
  autoTitleSessionIfNeeded,
  updateSession,
} from '@/lib/copilot/session-store'
import { callLlmStreaming } from '@/lib/copilot/llm-stream'
import type { CopilotContextRef, StreamEvent } from '@/lib/copilot/types'
import { getLlmConfig } from '@/lib/llm-config'
import { buildLlmMessages } from '@/lib/copilot/build-llm-messages'

/**
 * POST body：
 *   { user_message: string, parent_id?: string, model_id?: string, contexts?: CopilotContextRef[] }
 *
 * 返回 text/event-stream，事件类型（每条一行 `data: <json>\n\n`）：
 *   { kind: 'user_message', id }           — 服务端为用户消息分配的 id
 *   { kind: 'text', delta }                — LLM 文本增量
 *   { kind: 'done', assistant_message_id, usage?, stop_reason? }
 *   { kind: 'error', message }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) {
    return new Response(JSON.stringify({ error: 'session not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const body = await req.json().catch(() => ({})) as {
    user_message?: string
    parent_id?: string
    model_id?: string
    contexts?: CopilotContextRef[]
  }
  if (!body.user_message || typeof body.user_message !== 'string') {
    return new Response(JSON.stringify({ error: 'user_message required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // 解析 model
  const cfg = getLlmConfig()
  const modelId = body.model_id ?? session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) {
    return new Response(JSON.stringify({ error: 'copilot model not configured or not enabled' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!model.base_url || !model.api_key) {
    return new Response(JSON.stringify({ error: 'model missing base_url or api_key' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // 如果 model_id 被本次请求指定了且与 session 之前不同，更新 session.model_id
  if (body.model_id && body.model_id !== session.model_id) {
    updateSession(sessionId, { model_id: body.model_id })
  }

  // 选 parent_id：默认为当前 head
  const parent_id = body.parent_id ?? session.head_message_id

  // 追加 user 消息
  const userMsg = appendMessage({
    session_id: sessionId,
    role: 'user',
    content: body.user_message,
    parent_id,
    contexts: body.contexts,
  })
  autoTitleSessionIfNeeded(sessionId, body.user_message)

  // 构造发给 LLM 的 messages：系统 prompt + 当前活跃分支历史（含刚才 user msg）
  const branch = getActiveBranch(sessionId, userMsg.id)
  const llmMessages = buildLlmMessages(branch)

  // 组装流式响应
  const encoder = new TextEncoder()
  let assistantText = ''
  let assistantUsage: { input_tokens: number; output_tokens: number } | undefined
  let stopReason: string | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      write({ kind: 'user_message', id: userMsg.id })

      try {
        await callLlmStreaming(
          {
            messages: llmMessages,
            config: {
              api_format: model.api_format,
              base_url: model.base_url,
              api_key: model.api_key,
            },
            model: model.model,
            temperature: model.default_temperature ?? 1,
            max_tokens: model.default_max_tokens ?? 4096,
            signal: req.signal,
          },
          (ev: StreamEvent) => {
            if (ev.type === 'text') {
              assistantText += ev.delta
              write({ kind: 'text', delta: ev.delta })
            } else if (ev.type === 'done') {
              assistantUsage = ev.usage
              stopReason = ev.stop_reason
            } else if (ev.type === 'error') {
              write({ kind: 'error', message: ev.message })
            }
          },
        )

        // 落盘 assistant 消息
        const asst = appendMessage({
          session_id: sessionId,
          role: 'assistant',
          content: assistantText,
          parent_id: userMsg.id,
          usage: assistantUsage,
          model_id: model.id,
        })
        write({
          kind: 'done',
          assistant_message_id: asst.id,
          usage: assistantUsage,
          stop_reason: stopReason,
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
