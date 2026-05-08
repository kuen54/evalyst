// ---------- Copilot · /chat 与 /tool-result 共享的 streaming helper ----------
// 把两个 route 的 "调 LLM stream → 累 text/tool_use → 流结束后 append 到 jsonl
// → 返回落盘 id 给 caller emit done" 的公共段抽出来。前提：caller 已经校验 body /
// 处理鉴权 / 构造好 branch + model + parent_id。
//
// 关键 race fix（CHANGELOG [0.4.0] "后续调试轮次修复"，保留不动）：
//   1. appendFileSync 原子 append —— 继承自 `session-store.appendMessage`
//      的实现（OS 层原子 append 替代 read-modify-writeAtomic）。helper 只调
//      `appendMessage`，不自己拼写 fs，原子性天然继承。
//   2. SSE `controller.enqueue` 在流关后抛 —— 本 helper 不碰 controller；
//      caller 的 `write` 函数必须自己 try/catch 吞 "Controller is already
//      closed"。helper 里 `p.write(...)` 的所有调用都假定 caller 已做 try/catch。
//   3. tool_use 落盘必须先于 emit done —— 本 helper 的做法是：stream close 后
//      **在 return 之前** 顺序 append assistant + 每条 tool_use，然后才把
//      {assistantMessageId, toolUseMessageIds} 交给 caller。caller 拿到 result
//      后再 `write({ kind: 'done', ... })`，从而保证"消息落盘 → done 事件"顺序。
//   4. Abort signal 透传给 callLlmStreaming —— `p.signal` 直接转给 stream，
//      客户端 abort / 页面卸载时 fetch 终止，LLM 连接也立即关闭。
//   5. 合并相邻 assistant+tool_use 保证 Anthropic alternation —— 这是
//      `serializeMessagesForProvider` 的职责（在 `llm-stream.ts` 内），本 helper
//      只把 branch 交给 `buildLlmMessages`，序列化阶段自动处理，不在 helper 层。

import { callLlmStreaming } from './llm-stream'
import { appendMessage } from './session-store'
import { buildLlmMessages } from './build-llm-messages'
import { toOpenaiTools, toAnthropicTools } from './tool-adapters'
import type { AnyToolDescriptor } from './tools/registry'
import type { CopilotMessage, PageContext, StreamEvent } from './types'
import type { ModelConfig } from '../llm-config'

export interface RunStreamParams {
  sessionId: string
  /** 已经拉好的 active branch（含上游消息，新 user / tool_result 已 append） */
  branch: CopilotMessage[]
  model: ModelConfig
  /** Server-side tool descriptors（manual array from tools/registry.ts） */
  tools: readonly AnyToolDescriptor[]
  pageContext: PageContext | null
  /** 新 assistant / 首条 tool_use 的 parent_id 起点（通常是刚 append 的 user / tool_result 的 id） */
  startParentId: string | undefined
  signal: AbortSignal
  /** SSE `data: <json>\n\n` 写出；caller 必须在里面 try/catch 吞流关后抛 */
  write: (payload: unknown) => void
}

export interface RunStreamResult {
  assistantMessageId?: string
  toolUseMessageIds: string[]
  usage?: { input_tokens: number; output_tokens: number }
  stopReason?: string
}

/**
 * 调 LLM stream 并把 text / tool_use 事件转发到 caller 的 SSE write；
 * 流 close 后按顺序 `appendMessage` assistant（若有文本）+ 每条 tool_use，
 * 通过 parent_id 串成链，把落盘 id 交给 caller 去 emit `done` 事件。
 *
 * 不负责：SSE 响应头 / ReadableStream 脚手架 / body 校验 / 鉴权 / chain cap /
 * user / tool_result 消息 append（这些是 caller 的职责）。
 */
export async function runToolAwareLlmStream(p: RunStreamParams): Promise<RunStreamResult> {
  const llmMessages = buildLlmMessages(p.branch, p.pageContext, { sessionId: p.sessionId })
  const toolsFormatted =
    p.model.api_format === 'openai' ? toOpenaiTools(p.tools) : toAnthropicTools(p.tools)

  let assistantText = ''
  let assistantUsage: { input_tokens: number; output_tokens: number } | undefined
  let stopReason: string | undefined
  const pendingToolUses: Array<{
    call_id: string
    tool_name: string
    input: Record<string, unknown>
    thought_signature?: string
  }> = []

  await callLlmStreaming(
    {
      messages: llmMessages,
      config: {
        api_format: p.model.api_format,
        base_url: p.model.base_url,
        api_key: p.model.api_key,
      },
      model: p.model.model,
      temperature: p.model.default_temperature ?? 1,
      max_tokens: p.model.default_max_tokens ?? 4096,
      tools: toolsFormatted,
      // race fix #4：abort signal 透传，客户端断开则 LLM 连接立即关闭
      signal: p.signal,
    },
    (ev: StreamEvent) => {
      if (ev.type === 'text') {
        assistantText += ev.delta
        p.write({ kind: 'text', delta: ev.delta })
      } else if (ev.type === 'tool_use_start') {
        p.write({ kind: 'tool_use_start', call_id: ev.call_id, tool_name: ev.tool_name })
      } else if (ev.type === 'tool_use_delta') {
        p.write({ kind: 'tool_use_delta', call_id: ev.call_id, input_json_delta: ev.input_json_delta })
      } else if (ev.type === 'tool_use_end') {
        // 不 mid-stream append（避免 jsonl 写句柄竞争 / race fix #1 依赖 post-stream 顺序落盘）；
        // 先 buffer，关流后统一落盘。
        pendingToolUses.push({
          call_id: ev.call_id,
          tool_name: ev.tool_name,
          input: ev.input,
          thought_signature: ev.thought_signature,
        })
        p.write({ kind: 'tool_use_end', call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
      } else if (ev.type === 'done') {
        assistantUsage = ev.usage
        stopReason = ev.stop_reason
      } else if (ev.type === 'error') {
        p.write({ kind: 'error', message: ev.message })
      }
    },
  )

  // race fix #3：流结束后，按顺序落盘 assistant 文本（若有）→ 每条 tool_use，
  // parent_id 链式串起来。caller 拿到 result 后才 emit done，保证"落盘先于 done"。
  let parentId: string | undefined = p.startParentId
  let assistantMessageId: string | undefined
  if (assistantText.trim().length > 0) {
    const asst = appendMessage({
      session_id: p.sessionId,
      role: 'assistant',
      content: assistantText,
      parent_id: parentId,
      usage: assistantUsage,
      model_id: p.model.id,
    })
    assistantMessageId = asst.id
    parentId = asst.id
  }

  const toolUseMessageIds: string[] = []
  for (const tu of pendingToolUses) {
    const msg = appendMessage({
      session_id: p.sessionId,
      role: 'tool_use',
      content: JSON.stringify(tu.input),
      parent_id: parentId,
      call_id: tu.call_id,
      tool_name: tu.tool_name,
      tool_input: tu.input,
      thought_signature: tu.thought_signature,
      model_id: p.model.id,
    })
    toolUseMessageIds.push(msg.id)
    parentId = msg.id
  }

  return {
    assistantMessageId,
    toolUseMessageIds,
    usage: assistantUsage,
    stopReason,
  }
}
