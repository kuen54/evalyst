// ---------- Copilot LLM Streaming ----------
// 对接两种 api_format：OpenAI `/chat/completions` 和 Anthropic `/messages`，都开 stream。
// 把各自 SSE 协议归一化为 StreamEvent 发给调用方（再到前端/API 层）。
//
// PR-3：扩 tool_use_start / _delta / _end 事件 + tools 请求参数 + tool_use / tool_result
// 消息序列化。Task 6 进一步在 serializeMessagesForProvider 里合并连续的
// assistant text + tool_use，以满足 Anthropic 的 user/assistant 严格交替约束。

import type { ApiConfig } from '@/lib/types'
import type { LlmMessage } from '@/lib/llm-client'
import { isTextMessage, buildApiRequest } from '@/lib/llm-client'
import type { StreamEvent } from './types'
import { applyAnthropicCacheControl, type AnthropicBody } from './anthropic-cache-control'

/**
 * 与 src/lib/llm-client.ts 同名 helper 同形（YAGNI 就地拷贝，避免跨模块依赖）：
 * data:image/{mime};base64,... → source.type='base64' + media_type + data
 * 其他 URL → source.type='url'
 */
function imageBlockForAnthropic(url: string): Record<string, unknown> {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url)
  if (m) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: m[1],
        data: m[2],
      },
    }
  }
  return {
    type: 'image',
    source: { type: 'url', url },
  }
}

interface CallLlmStreamingParams {
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
  /**
   * Gemini thinking 模式的 thought_signature —— proxy 可能在任何一个 tool_call
   * chunk 上给（不一定是 first chunk；常在带 finish_reason 的 last chunk），
   * 所以每次 chunk 都检测一次并覆盖（last write wins）。
   */
  thought_signature?: string
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
      signal: p.signal ?? null,
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
  // v2.5 §6: 保留 cache 字段 undefined 语义——区分 "provider 不返" 和 "返 0"
  const usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens?: number
    cache_read_tokens?: number
  } = { input_tokens: 0, output_tokens: 0 }
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
    onEvent({ type: 'done', usage, ...(stopReason !== undefined ? { stop_reason: stopReason } : {}) })
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
function splitSseEvents(buffer: string): string[] {
  // 统一把 \r\n 规整成 \n，再按 \n\n split
  const normalized = buffer.replace(/\r\n/g, '\n')
  return normalized.split('\n\n')
}

/** 取 SSE 事件块里 data: 开头的行拼成 JSON string；如果有 event: 行，也取出来 */
function parseSseBlock(block: string): { event?: string; data: string } {
  const lines = block.split('\n')
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    // 忽略其他行（id:、retry: 等）
  }
  return { ...(event !== undefined ? { event } : {}), data: dataLines.join('\n') }
}

// ---------- OpenAI 格式 ----------

function parseOpenaiEvent(
  block: string,
  onEvent: (ev: StreamEvent) => void,
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens?: number
    cache_read_tokens?: number
  },
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
      // Gemini thinking 模式：thought_signature 可能在 tool_call 的 function 里或顶层，
      // 也可能只在最后一个 chunk（带 finish_reason）里给。每个 chunk 都检测一次，
      // last write wins。Sankuai/Vertex OpenAI-compat 把它塞在 extra_content.google 下。
      const sig =
        tc.extra_content?.google?.thought_signature ??
        tc.function?.thought_signature ??
        tc.function?.thoughtSignature ??
        tc.thought_signature ??
        tc.thoughtSignature
      if (typeof sig === 'string' && sig.length > 0) {
        st.thought_signature = sig
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
    // v2.5 §6: 标准路径 (OpenAI + Sankuai 兼容) 把 cached prompt tokens 放在 prompt_tokens_details.cached_tokens
    const cached = parsed.usage.prompt_tokens_details?.cached_tokens
    if (cached !== undefined) usage.cache_read_tokens = cached
    // v2.5 §6: 非标准 compat 层 fallback —— usage 顶层的 cache_read_tokens
    const topLevelCacheRead = (parsed.usage as { cache_read_tokens?: number }).cache_read_tokens
    if (topLevelCacheRead !== undefined && usage.cache_read_tokens === undefined) {
      usage.cache_read_tokens = topLevelCacheRead
    }
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
    onEvent({
      type: 'tool_use_end',
      call_id: st.call_id,
      tool_name: st.tool_name,
      input,
      ...(st.thought_signature ? { thought_signature: st.thought_signature } : {}),
    })
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
        function?: {
          name?: string
          arguments?: string
          // Gemini-proxy thinking 签名：snake_case / camelCase / function 内或顶层均见过
          thought_signature?: string
          thoughtSignature?: string
        }
        thought_signature?: string
        thoughtSignature?: string
        // Sankuai/Vertex OpenAI-compat 走 Google provider 扩展槽
        extra_content?: { google?: { thought_signature?: string } }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    /** 标准 OpenAI / Sankuai 兼容：cached prompt tokens 在 prompt_tokens_details.cached_tokens */
    prompt_tokens_details?: { cached_tokens?: number }
    /** 非标准 compat 层：把 cache_read_tokens 直接放在 usage 顶层 */
    cache_read_tokens?: number
  }
}

// ---------- Anthropic 格式 ----------

function parseAnthropicEvent(
  block: string,
  onEvent: (ev: StreamEvent) => void,
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens?: number
    cache_read_tokens?: number
  },
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
      // v2.5 §6: Anthropic 在 message_start 的 message.usage 里已给出 cache_creation_input_tokens / cache_read_input_tokens
      if (u?.cache_creation_input_tokens !== undefined) {
        usage.cache_creation_tokens = u.cache_creation_input_tokens
      }
      if (u?.cache_read_input_tokens !== undefined) {
        usage.cache_read_tokens = u.cache_read_input_tokens
      }
      // Bedrock/Sankuai nested `cache_creation` 对象：sum ephemeral buckets
      if (u?.cache_creation) {
        const s1h = u.cache_creation.ephemeral_1h_input_tokens ?? 0
        const s5m = u.cache_creation.ephemeral_5m_input_tokens ?? 0
        if (s1h + s5m > 0 || usage.cache_creation_tokens === undefined) {
          usage.cache_creation_tokens = s1h + s5m
        }
      }
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
      // Bedrock/Sankuai 把 input_tokens 也放在 message_delta（native Anthropic 只在 message_start）
      if (parsed.usage?.input_tokens) usage.input_tokens = parsed.usage.input_tokens
      if (parsed.usage?.output_tokens) usage.output_tokens = parsed.usage.output_tokens
      // v2.5 §6: Anthropic 在 message_delta 中也可能更新 cache 字段（跨 stream 部分 ordering）
      if (parsed.usage?.cache_creation_input_tokens !== undefined) {
        usage.cache_creation_tokens = parsed.usage.cache_creation_input_tokens
      }
      if (parsed.usage?.cache_read_input_tokens !== undefined) {
        usage.cache_read_tokens = parsed.usage.cache_read_input_tokens
      }
      // Bedrock/Sankuai nested `cache_creation` 对象
      if (parsed.usage?.cache_creation) {
        const s1h = parsed.usage.cache_creation.ephemeral_1h_input_tokens ?? 0
        const s5m = parsed.usage.cache_creation.ephemeral_5m_input_tokens ?? 0
        if (s1h + s5m > 0 || usage.cache_creation_tokens === undefined) {
          usage.cache_creation_tokens = s1h + s5m
        }
      }
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
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      // AWS Bedrock / Sankuai 兼容层：cache_creation 可能是嵌套对象
      cache_creation?: {
        ephemeral_1h_input_tokens?: number
        ephemeral_5m_input_tokens?: number
      }
    }
  }
  content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
  delta?: { type?: string; text?: string; stop_reason?: string; partial_json?: string }
  usage?: {
    input_tokens?: number   // Sankuai/Bedrock 把 input_tokens 也放在 message_delta
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    // AWS Bedrock / Sankuai 兼容层 nested 形态
    cache_creation?: {
      ephemeral_1h_input_tokens?: number
      ephemeral_5m_input_tokens?: number
    }
  }
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
 * 合并规则（两个 provider 都走，PR-3 Task 6）：连续的
 * [assistant-text?, tool_use, tool_use, ...] 会被合并成一条"复合 assistant"：
 *   - OpenAI: { role: 'assistant', content: text || null, tool_calls: [...] }
 *   - Anthropic: { role: 'assistant', content: [{type:'text',text}?, {type:'tool_use'}*] }
 * 这样 Anthropic 严格的 user/assistant 交替约束自动满足；OpenAI 的
 * tool_calls association semantics 也更正确。
 */
export function serializeMessagesForProvider(
  messages: LlmMessage[],
  apiFormat: 'openai' | 'anthropic',
): Array<Record<string, unknown>> {
  // Anthropic: 先剥掉 system（由 caller 单独抽出放到 body.system）
  const src = apiFormat === 'anthropic'
    ? messages.filter(m => !(isTextMessage(m) && m.role === 'system'))
    : messages

  const out: Array<Record<string, unknown>> = []
  let i = 0
  while (i < src.length) {
    const m = src[i]
    if (!m) { i++; continue }

    // assistant text 或 tool_use 开头 → 收集一段连续运行，合并为一条复合 assistant
    if ((isTextMessage(m) && m.role === 'assistant') || m.role === 'tool_use') {
      let text = ''
      const toolUses: Array<{ call_id: string; tool_name: string; tool_input: Record<string, unknown>; thought_signature?: string }> = []
      while (i < src.length) {
        const cur = src[i]
        if (!cur) { i++; continue }
        if (isTextMessage(cur) && cur.role === 'assistant') {
          // 合并多段 assistant 文本（实际不太会出现，保守起见用换行拼）
          const curText = typeof cur.content === 'string'
            ? cur.content
            : cur.content.map(b => ('text' in b ? b.text : '')).join('')
          text += (text ? '\n' : '') + curText
          i++
          continue
        }
        if (cur.role === 'tool_use') {
          toolUses.push({
            call_id: cur.call_id,
            tool_name: cur.tool_name,
            tool_input: cur.tool_input ?? {},
            ...(cur.thought_signature !== undefined ? { thought_signature: cur.thought_signature } : {}),
          })
          i++
          continue
        }
        break
      }
      if (toolUses.length === 0) {
        // 纯 assistant 文本：按原来的 per-provider 形状输出
        out.push(emitAssistantText(text, apiFormat))
      } else {
        out.push(emitCompositeAssistant(text, toolUses, apiFormat))
      }
      continue
    }

    // 其他消息（system / user / tool_result）走单消息映射
    if (apiFormat === 'anthropic') {
      out.push(serializeAnthropicNonAssistant(m))
    } else {
      out.push(serializeOpenaiNonAssistant(m))
    }
    i++
  }
  return out
}

function emitAssistantText(
  text: string,
  apiFormat: 'openai' | 'anthropic',
): Record<string, unknown> {
  if (apiFormat === 'anthropic') {
    return { role: 'assistant', content: text }
  }
  return { role: 'assistant', content: text }
}

function emitCompositeAssistant(
  text: string,
  toolUses: Array<{ call_id: string; tool_name: string; tool_input: Record<string, unknown>; thought_signature?: string }>,
  apiFormat: 'openai' | 'anthropic',
): Record<string, unknown> {
  if (apiFormat === 'anthropic') {
    const content: Array<Record<string, unknown>> = []
    if (text) content.push({ type: 'text', text })
    for (const tu of toolUses) {
      content.push({
        type: 'tool_use',
        id: tu.call_id,
        name: tu.tool_name,
        input: tu.tool_input,
        // Anthropic 格式目前用不到 thought_signature（Claude-on-Vertex 走另一条协议）；
        // 如果 caller 误把 Gemini 的 tool_use 塞给 Anthropic 路径，仍原样回显以防万一。
        ...(tu.thought_signature ? { thought_signature: tu.thought_signature } : {}),
      })
    }
    return { role: 'assistant', content }
  }
  // OpenAI
  return {
    role: 'assistant',
    content: text ? text : null,
    tool_calls: toolUses.map(tu => ({
      id: tu.call_id,
      type: 'function',
      function: {
        name: tu.tool_name,
        arguments: JSON.stringify(tu.tool_input),
      },
      // Gemini thinking 模式：Sankuai/Vertex OpenAI-compat 的 signature 槽在
      // tool_call.extra_content.google.thought_signature；原样回传，否则 Gemini
      // 会在下一轮拒绝请求（"missing a thought_signature"）。
      ...(tu.thought_signature
        ? { extra_content: { google: { thought_signature: tu.thought_signature } } }
        : {}),
    })),
  }
}

function serializeOpenaiNonAssistant(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool_result') {
    return {
      role: 'tool',
      tool_call_id: m.call_id,
      content: m.content,
    }
  }
  // system / user text 三元组（assistant / tool_use 由 emitComposite 处理）
  if (isTextMessage(m)) {
    return { role: m.role, content: m.content }
  }
  // 兜底（不应到达）
  return { role: 'user', content: '' }
}

function serializeAnthropicNonAssistant(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool_result') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: m.call_id,
          content: m.content,
          // v2.5 P2: 透传 is_error（Anthropic 协议字段）让 Claude/Sonnet 一眼分清 success vs failure。
          ...(m.is_error ? { is_error: true } : {}),
        },
      ],
    }
  }
  // user text（system 已被 caller 过滤；assistant / tool_use 由 emitComposite 处理）
  if (isTextMessage(m)) {
    const content = typeof m.content === 'string'
      ? m.content
      : m.content.map(b => {
          if (b.type === 'text') return { type: 'text', text: b.text }
          return imageBlockForAnthropic(b.image_url.url)
        })
    return { role: m.role, content }
  }
  return { role: 'user', content: '' }
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
    // v2.5 P1a §3.1: 4-breakpoint cache_control（hermes system_and_3）
    // base 是 Record<string, unknown>；通过 unknown 中转兜个 AnthropicBody 形状（messages 已在上方填进 base）
    applyAnthropicCacheControl(base as unknown as AnthropicBody)
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

// --- test-only exports ---
// v2.5 §6 Task 13: 测试 cache token 提取需要直接 feed raw SSE block 给 parser；
// callLlmStreaming 整体走 fetch 路径不便单测，暴露两个 parser 给 __tests__ 使用
export const __testOnly = { parseAnthropicEvent, parseOpenaiEvent, buildStreamingRequestBody }
