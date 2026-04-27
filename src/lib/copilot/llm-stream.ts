// ---------- Copilot LLM Streaming ----------
// 对接两种 api_format：OpenAI `/chat/completions` 和 Anthropic `/messages`，都开 stream。
// 把各自 SSE 协议归一化为 StreamEvent 发给调用方（再到前端/API 层）。
//
// PR-1 只覆盖 text + done + error；tool_use 事件在 PR-3 里扩。

import type { ApiConfig } from '../types'
import type { LlmMessage } from '../llm-client'
import { buildApiRequest } from '../llm-client'
import type { StreamEvent } from './types'

export interface CallLlmStreamingParams {
  messages: LlmMessage[]
  config: ApiConfig
  model: string
  temperature: number
  max_tokens: number
  signal?: AbortSignal
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

  const emitDoneOnce = () => {
    if (doneEmitted) return
    doneEmitted = true
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
        if (isAnthropic) parseAnthropicEvent(raw, onEvent, usage, reason => (stopReason = reason))
        else parseOpenaiEvent(raw, onEvent, usage, reason => (stopReason = reason), emitDoneOnce)
      }
    }
    // flush 剩余 buffer
    if (buffer.trim()) {
      if (isAnthropic) parseAnthropicEvent(buffer, onEvent, usage, reason => (stopReason = reason))
      else parseOpenaiEvent(buffer, onEvent, usage, reason => (stopReason = reason), emitDoneOnce)
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
  if (choice?.finish_reason) {
    setReason(choice.finish_reason)
  }
  if (parsed.usage) {
    usage.input_tokens = parsed.usage.prompt_tokens ?? usage.input_tokens
    usage.output_tokens = parsed.usage.completion_tokens ?? usage.output_tokens
  }
}

interface OpenaiChunk {
  choices?: Array<{
    delta?: { content?: string; role?: string }
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
    case 'content_block_delta': {
      const d = parsed.delta
      if (d?.type === 'text_delta' && d.text) {
        onEvent({ type: 'text', delta: d.text })
      }
      return
    }
    case 'message_delta': {
      if (parsed.delta?.stop_reason) setReason(parsed.delta.stop_reason)
      if (parsed.usage?.output_tokens) usage.output_tokens = parsed.usage.output_tokens
      return
    }
    // message_start / content_block_start / content_block_stop / message_stop / ping 等：PR-1 忽略
    default:
      return
  }
}

interface AnthropicEvent {
  type?: string
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
  delta?: { type?: string; text?: string; stop_reason?: string }
  usage?: { output_tokens?: number }
}

// ---------- Request body 构造 ----------

function buildStreamingRequestBody(p: CallLlmStreamingParams): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.max_tokens,
    temperature: p.temperature,
    stream: true,
  }
  if (p.config.api_format === 'anthropic') {
    const systemMsg = p.messages.find(m => m.role === 'system')
    if (systemMsg) {
      base.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
    }
    base.messages = p.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(b => {
              if (b.type === 'text') return { type: 'text', text: b.text }
              return { type: 'image', source: { type: 'url', url: b.image_url.url } }
            }),
      }))
  } else {
    base.messages = p.messages
    // OpenAI 兼容的很多 endpoint 支持 include_usage
    base.stream_options = { include_usage: true }
  }
  if (p.config.extra_body) Object.assign(base, p.config.extra_body)
  return base
}
