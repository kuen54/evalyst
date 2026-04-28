// ---------- Copilot LLM Streaming ----------
// 对接两种 api_format：OpenAI `/chat/completions` 和 Anthropic `/messages`，都开 stream。
// 把各自 SSE 协议归一化为 StreamEvent 发给调用方（再到前端/API 层）。
//
// PR-3：扩 tool_use_start / _delta / _end 事件 + tools 请求参数 + tool_use / tool_result
// 消息序列化。

import type { ApiConfig } from '../types'
import type { LlmMessage } from '../llm-client'
import { isTextMessage, buildApiRequest } from '../llm-client'
import type { StreamEvent } from './types'

export interface CallLlmStreamingParams {
  messages: LlmMessage[]
  config: ApiConfig
  model: string
  temperature: number
  max_tokens: number
  /** 已按 provider 格式 pre-adapted 的 tools（caller 用 toOpenaiTools / toAnthropicTools 转换后传入） */
  tools?: Array<Record<string, unknown>>
  signal?: AbortSignal
}

/** 单个 tool_use 块（按 index 归并）跨 SSE 帧积累状态 */
interface ToolUseState {
  call_id: string
  tool_name: string
  args_buffer: string
}

/**
 * 发起流式 LLM 调用，把归一化后的事件通过 onEvent 推给调用方。
 * 只要 HTTP 请求成功建立，就会 emit 至少一条事件（text 或 done 或 error）。
 */
export async function callLlmStreaming(
  p: CallLlmStreamingParams,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  if (!p.config.base_url || !p.config.api_key) {
    onEvent({ type: 'error', message: 'LLM not configured: base_url + api_key needed' })
    return
  }

  const body = buildStreamingRequestBody(p)
  const req = buildApiRequest(p.config, body)

  let resp: Response
  try {
    resp = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: p.signal,
    })
  } catch (e) {
    onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    return
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    onEvent({ type: 'error', message: `HTTP ${resp.status}: ${text.slice(0, 300)}` })
    return
  }

  const isAnthropic = p.config.api_format === 'anthropic'
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // 共享的 usage 累加器（Anthropic 分两次给：message_start 有 input_tokens；message_delta 有 output_tokens）
  const usage = { input_tokens: 0, output_tokens: 0 }
  let stopReason: string | undefined
  let doneEmitted = false
  // 跨 SSE 帧的 tool_use 状态（按 index 归并）
  const toolState = new Map<number, ToolUseState>()

  const emitDoneOnce = () => {
    if (doneEmitted) return
    doneEmitted = true
    // 若 OpenAI 在没明确 finish_reason 的情况下直接发 [DONE]，兜底 flush 所有未闭合的 tool_use
    if (!isAnthropic && toolState.size > 0) {
      flushOpenaiTools(toolState, onEvent)
    }
    onEvent({ type: 'done', usage, stop_reason: stopReason })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 以空行分隔事件
      const events = splitSseEvents(buffer)
      buffer = events.pop() ?? '' // 最后一段可能未完整

      for (const raw of events) {
        if (!raw.trim()) continue
        if (isAnthropic) parseAnthropicEvent(raw, onEvent, usage, reason => (stopReason = reason), toolState)
        else parseOpenaiEvent(raw, onEvent, usage, reason => (stopReason = reason), emitDoneOnce, toolState)
      }
    }
    // flush 剩余 buffer
    if (buffer.trim()) {
      if (isAnthropic) parseAnthropicEvent(buffer, onEvent, usage, reason => (stopReason = reason), toolState)
      else parseOpenaiEvent(buffer, onEvent, usage, reason => (stopReason = reason), emitDoneOnce, toolState)
    }
    emitDoneOnce()
  } catch (e) {
    if (!doneEmitted) {
      onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }
}

// ---------- SSE 解析工具 ----------

/**
 * 把 buffer 按 SSE 规范 "\n\n" 分隔成事件块；最后一个元素可能不完整（调用方保留到下次）。
 * 兼容 \r\n\r\n。
 */
export function splitSseEvents(buffer: string): string[] {
  // 统一把 \r\n 规整成 \n，再按 \n\n split
  const normalized = buffer.replace(/\r\n/g, '\n')
  return normalized.split('\n\n')
}

/** 取 SSE 事件块里 data: 开头的行拼成 JSON string；如果有 event: 行，也取出来 */
export function parseSseBlock(block: string): { event?: string; data: string } {
  const lines = block.split('\n')
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    // 忽略其他行（id:、retry: 等）
  }
  return { event, data: dataLines.join('\n') }
}

// ---------- OpenAI 格式 ----------

function parseOpenaiEvent(
  block: string,
  onEvent: (ev: StreamEvent) => void,
  usage: { input_tokens: number; output_tokens: number },
  setReason: (r: string) => void,
  emitDoneOnce: () => void,
  toolState: Map<number, ToolUseState>,
) {
  const { data } = parseSseBlock(block)
  if (!data) return
  if (data === '[DONE]') {
    emitDoneOnce()
    return
  }
  let parsed: OpenaiChunk
  try {
    parsed = JSON.parse(data) as OpenaiChunk
  } catch {
    return
  }
  const choice = parsed.choices?.[0]
  if (choice?.delta?.content) {
    onEvent({ type: 'text', delta: choice.delta.content })
  }
  // tool_calls 增量（数组里按 index 归并）
  if (choice?.delta?.tool_calls) {
    for (const tc of choice.delta.tool_calls) {
      const idx = tc.index ?? 0
      let st = toolState.get(idx)
      if (!st) {
        // 首次见这个 index → 初始化并 emit start（id / name 第一次出现时带齐）
        st = {
          call_id: tc.id ?? '',
          tool_name: tc.function?.name ?? '',
          args_buffer: '',
        }
        toolState.set(idx, st)
      } else {
        // 后续 chunk 可能补齐 id / name（少见，但 spec 不保证一次性给全）
        if (tc.id && !st.call_id) st.call_id = tc.id
        if (tc.function?.name && !st.tool_name) st.tool_name = tc.function.name
      }
      // 第一次出现就 emit start（哪怕参数还没来）
      if (!(st as ToolUseState & { _startEmitted?: boolean })._startEmitted && st.call_id && st.tool_name) {
        ;(st as ToolUseState & { _startEmitted?: boolean })._startEmitted = true
        onEvent({ type: 'tool_use_start', call_id: st.call_id, tool_name: st.tool_name })
      }
      const argsDelta = tc.function?.arguments
      if (typeof argsDelta === 'string' && argsDelta.length > 0) {
        st.args_buffer += argsDelta
        if (st.call_id) {
          onEvent({ type: 'tool_use_delta', call_id: st.call_id, input_json_delta: argsDelta })
        }
      }
    }
  }
  if (choice?.finish_reason) {
    setReason(choice.finish_reason)
    if (choice.finish_reason === 'tool_calls') {
      flushOpenaiTools(toolState, onEvent)
    }
  }
  if (parsed.usage) {
    usage.input_tokens = parsed.usage.prompt_tokens ?? usage.input_tokens
    usage.output_tokens = parsed.usage.completion_tokens ?? usage.output_tokens
  }
}

/** OpenAI: parse 累计的 args_buffer 并 emit tool_use_end；逐项清空 Map */
function flushOpenaiTools(toolState: Map<number, ToolUseState>, onEvent: (ev: StreamEvent) => void) {
  for (const st of toolState.values()) {
    if (!st.call_id) continue
    let input: Record<string, unknown>
    try {
      // 允许空字符串 → 视为无参数调用
      input = st.args_buffer.trim() ? (JSON.parse(st.args_buffer) as Record<string, unknown>) : {}
    } catch (e) {
      onEvent({
        type: 'error',
        message: `Tool args JSON parse failed: ${e instanceof Error ? e.message : String(e)} (raw=${st.args_buffer.slice(0, 200)})`,
      })
      continue
    }
    onEvent({ type: 'tool_use_end', call_id: st.call_id, tool_name: st.tool_name, input })
  }
  toolState.clear()
}

interface OpenaiChunk {
  choices?: Array<{
    delta?: {
      content?: string
      role?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

// ---------- Anthropic 格式 ----------

function parseAnthropicEvent(
  block: string,
  onEvent: (ev: StreamEvent) => void,
  usage: { input_tokens: number; output_tokens: number },
  setReason: (r: string) => void,
  toolState: Map<number, ToolUseState>,
) {
  const { event, data } = parseSseBlock(block)
  if (!data) return
  let parsed: AnthropicEvent
  try {
    parsed = JSON.parse(data) as AnthropicEvent
  } catch {
    return
  }
  const t = event ?? parsed.type
  switch (t) {
    case 'message_start': {
      const u = parsed.message?.usage
      if (u?.input_tokens) usage.input_tokens = u.input_tokens
      if (u?.output_tokens) usage.output_tokens = u.output_tokens
      return
    }
    case 'content_block_start': {
      const cb = parsed.content_block
      const idx = parsed.index ?? 0
      if (cb?.type === 'tool_use' && cb.id && cb.name) {
        toolState.set(idx, { call_id: cb.id, tool_name: cb.name, args_buffer: '' })
        onEvent({ type: 'tool_use_start', call_id: cb.id, tool_name: cb.name })
      }
      return
    }
    case 'content_block_delta': {
      const d = parsed.delta
      if (d?.type === 'text_delta' && d.text) {
        onEvent({ type: 'text', delta: d.text })
      } else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
        const idx = parsed.index ?? 0
        const st = toolState.get(idx)
        if (st) {
          st.args_buffer += d.partial_json
          onEvent({ type: 'tool_use_delta', call_id: st.call_id, input_json_delta: d.partial_json })
        }
      }
      return
    }
    case 'content_block_stop': {
      const idx = parsed.index ?? 0
      const st = toolState.get(idx)
      if (st) {
        let input: Record<string, unknown>
        try {
          input = st.args_buffer.trim() ? (JSON.parse(st.args_buffer) as Record<string, unknown>) : {}
        } catch (e) {
          onEvent({
            type: 'error',
            message: `Tool args JSON parse failed: ${e instanceof Error ? e.message : String(e)} (raw=${st.args_buffer.slice(0, 200)})`,
          })
          toolState.delete(idx)
          return
        }
        onEvent({ type: 'tool_use_end', call_id: st.call_id, tool_name: st.tool_name, input })
        toolState.delete(idx)
      }
      return
    }
    case 'message_delta': {
      if (parsed.delta?.stop_reason) setReason(parsed.delta.stop_reason)
      if (parsed.usage?.output_tokens) usage.output_tokens = parsed.usage.output_tokens
      return
    }
    // message_stop / ping 等：忽略
    default:
      return
  }
}

interface AnthropicEvent {
  type?: string
  index?: number
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
  content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
  delta?: { type?: string; text?: string; stop_reason?: string; partial_json?: string }
  usage?: { output_tokens?: number }
}

// ---------- Request body 构造 ----------

/**
 * 把 LlmMessage[] 序列化成 provider 要的 messages 数组。
 * 导出是为了 llm-stream-serialize.test.ts 能单独覆盖这段纯逻辑。
 *
 * apiFormat === 'openai'：
 *   - text 三元组不变
 *   - tool_use → assistant 带 tool_calls 数组
 *   - tool_result → role: 'tool' + tool_call_id
 *
 * apiFormat === 'anthropic'：
 *   - text 三元组走 content blocks（user/assistant，system 会在更外层抽出）
 *   - tool_use → role: 'assistant' 的 content block { type: 'tool_use', ... }
 *   - tool_result → role: 'user' 的 content block { type: 'tool_result', ... }
 *
 * TODO(Task 6): Anthropic 要求 user / assistant 严格交替出现。若上游 buildLlmMessages
 * 把 assistant text + tool_use 摆成两条连续 assistant 消息，这里需要合并或让 caller 交织。
 * 当前 Task 4 走直白映射，留待 Task 6 的 /chat route 重写时统一处理。
 */
export function serializeMessagesForProvider(
  messages: LlmMessage[],
  apiFormat: 'openai' | 'anthropic',
): Array<Record<string, unknown>> {
  if (apiFormat === 'anthropic') {
    return messages
      .filter(m => !(isTextMessage(m) && m.role === 'system')) // system 单独抽出
      .map(m => serializeAnthropicMessage(m))
  }
  // OpenAI
  return messages.map(m => serializeOpenaiMessage(m))
}

function serializeOpenaiMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool_use') {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: m.call_id,
          type: 'function',
          function: {
            name: m.tool_name,
            arguments: JSON.stringify(m.tool_input ?? {}),
          },
        },
      ],
    }
  }
  if (m.role === 'tool_result') {
    return {
      role: 'tool',
      tool_call_id: m.call_id,
      content: m.content,
    }
  }
  // text 三元组：OpenAI 直接透传
  return { role: m.role, content: m.content }
}

function serializeAnthropicMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool_use') {
    return {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: m.call_id,
          name: m.tool_name,
          input: m.tool_input ?? {},
        },
      ],
    }
  }
  if (m.role === 'tool_result') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: m.call_id,
          content: m.content,
        },
      ],
    }
  }
  // text 三元组
  const content = typeof m.content === 'string'
    ? m.content
    : m.content.map(b => {
        if (b.type === 'text') return { type: 'text', text: b.text }
        return { type: 'image', source: { type: 'url', url: b.image_url.url } }
      })
  return { role: m.role, content }
}

function buildStreamingRequestBody(p: CallLlmStreamingParams): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.max_tokens,
    temperature: p.temperature,
    stream: true,
  }
  if (p.config.api_format === 'anthropic') {
    const systemMsg = p.messages.find(m => isTextMessage(m) && m.role === 'system')
    if (systemMsg && isTextMessage(systemMsg)) {
      base.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
    }
    base.messages = serializeMessagesForProvider(p.messages, 'anthropic')
    if (p.tools && p.tools.length > 0) {
      base.tools = p.tools
    }
  } else {
    base.messages = serializeMessagesForProvider(p.messages, 'openai')
    // OpenAI 兼容的很多 endpoint 支持 include_usage
    base.stream_options = { include_usage: true }
    if (p.tools && p.tools.length > 0) {
      base.tools = p.tools
      base.tool_choice = 'auto'
    }
  }
  if (p.config.extra_body) Object.assign(base, p.config.extra_body)
  return base
}
