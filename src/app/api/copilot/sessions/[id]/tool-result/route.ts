import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
} from '@/lib/copilot/session-store'
import { callLlmStreaming } from '@/lib/copilot/llm-stream'
import { tools } from '@/lib/copilot/tools'
import { findTool } from '@/lib/copilot/tool-registry'
import { toOpenaiTools, toAnthropicTools } from '@/lib/copilot/tool-adapters'
import { getLlmConfig } from '@/lib/llm-config'
import type { CopilotMessage, StreamEvent } from '@/lib/copilot/types'
import { buildLlmMessages } from '@/lib/copilot/build-llm-messages'

/**
 * POST body：
 *   {
 *     call_id: string              // 配对待处理的 tool_use 消息
 *     tool_name: string            // 审计 + 安全检查
 *     input: Record<string, unknown>  // 用户确认的参数（通常与 LLM 原始 tool_input 一致）
 *     denied?: boolean             // true = 用户拒绝；false/undefined = 确认执行
 *     reason?: string              // 拒绝的可选原因
 *   }
 *
 * 流程：
 *   1. 校验 session / body
 *   2. 链长上限 5（trailing tool_use+tool_result 对计数）→ 超过返 429
 *   3. 执行工具（或记录 denied）→ 写 tool_result 消息
 *   4. 重新拉 branch、构造 LlmMessages（含本次 tool_result）→ 发 provider-adapted tools
 *      → callLlmStreaming 重新 stream LLM
 *   5. 把 text 累积 / tool_use_end 累积 → 流 close 时统一 append 到 jsonl
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
  if (!session) {
    return jsonError(404, 'session not found')
  }

  const body = (await req.json().catch(() => ({}))) as {
    call_id?: string
    tool_name?: string
    input?: Record<string, unknown>
    denied?: boolean
    reason?: string
  }
  if (!body.call_id || typeof body.call_id !== 'string') {
    return jsonError(400, 'call_id required')
  }
  if (!body.tool_name || typeof body.tool_name !== 'string') {
    return jsonError(400, 'tool_name required')
  }
  if (!body.input || typeof body.input !== 'object') {
    return jsonError(400, 'input required')
  }

  // 链长上限 5（trailing tool_use + tool_result 对）
  const branchBefore = getActiveBranch(sessionId)
  const completedPairs = countTrailingToolUsePairs(branchBefore)
  if (completedPairs >= 5) {
    return jsonError(429, 'chain call limit reached')
  }

  // 本条 tool_result 的 parent 指向当前 branch 末端（通常是 hanging tool_use）
  const tailId = branchBefore[branchBefore.length - 1]?.id

  // 计算 result content
  let resultContent: unknown
  if (body.denied === true) {
    resultContent = { denied: true, reason: body.reason ?? '' }
  } else {
    // 未知 tool 直接 400：客户端说谎，不该发生
    const tool = findTool(tools, body.tool_name)
    if (!tool) {
      return jsonError(400, `unknown tool: ${body.tool_name}`)
    }
    try {
      resultContent = await tool.run(body.input)
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

  // 解析 model
  const cfg = getLlmConfig()
  const modelId = session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) {
    return jsonError(400, 'copilot model not configured or not enabled')
  }
  if (!model.base_url || !model.api_key) {
    return jsonError(400, 'model missing base_url or api_key')
  }

  // 重新拉 branch（含刚 append 的 tool_result），构造 LLM messages
  const branch = getActiveBranch(sessionId, toolResultMsg.id)
  const llmMessages = buildLlmMessages(branch)

  // Provider-adapted tools
  const toolsFormatted =
    model.api_format === 'openai' ? toOpenaiTools(tools) : toAnthropicTools(tools)

  // 组装流式响应
  const encoder = new TextEncoder()
  let assistantText = ''
  let assistantUsage: { input_tokens: number; output_tokens: number } | undefined
  let stopReason: string | undefined
  const pendingToolUses: Array<{ call_id: string; tool_name: string; input: Record<string, unknown>; thought_signature?: string }> = []

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
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
            tools: toolsFormatted,
            signal: req.signal,
          },
          (ev: StreamEvent) => {
            if (ev.type === 'text') {
              assistantText += ev.delta
              write({ kind: 'text', delta: ev.delta })
            } else if (ev.type === 'tool_use_start') {
              write({ kind: 'tool_use_start', call_id: ev.call_id, tool_name: ev.tool_name })
            } else if (ev.type === 'tool_use_delta') {
              write({ kind: 'tool_use_delta', call_id: ev.call_id, input_json_delta: ev.input_json_delta })
            } else if (ev.type === 'tool_use_end') {
              // 不 mid-stream append（避免 jsonl 写句柄竞争）；先 buffer，关流时统一落盘
              pendingToolUses.push({
                call_id: ev.call_id,
                tool_name: ev.tool_name,
                input: ev.input,
                thought_signature: ev.thought_signature,
              })
              write({ kind: 'tool_use_end', call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
            } else if (ev.type === 'done') {
              assistantUsage = ev.usage
              stopReason = ev.stop_reason
            } else if (ev.type === 'error') {
              write({ kind: 'error', message: ev.message })
            }
          },
        )

        // 流结束后，按顺序落盘：assistant 文本（若有）→ 每条 tool_use
        let parentId: string | undefined = toolResultMsg.id
        let assistantMessageId: string | undefined
        if (assistantText.trim().length > 0) {
          const asst: CopilotMessage = appendMessage({
            session_id: sessionId,
            role: 'assistant',
            content: assistantText,
            parent_id: parentId,
            usage: assistantUsage,
            model_id: model.id,
          })
          assistantMessageId = asst.id
          parentId = asst.id
        }
        const toolUseMessageIds: string[] = []
        for (const tu of pendingToolUses) {
          const msg = appendMessage({
            session_id: sessionId,
            role: 'tool_use',
            content: JSON.stringify(tu.input),
            parent_id: parentId,
            call_id: tu.call_id,
            tool_name: tu.tool_name,
            tool_input: tu.input,
            thought_signature: tu.thought_signature,
            model_id: model.id,
          })
          toolUseMessageIds.push(msg.id)
          parentId = msg.id
        }

        write({
          kind: 'done',
          assistant_message_id: assistantMessageId,
          tool_use_message_ids: toolUseMessageIds,
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
