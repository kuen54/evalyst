import type { ApiConfig } from './types'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

export interface LlmResponse {
  content: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  latency_ms: number
}

/** 已构造好的 HTTP 请求（URL / headers / body 对 OpenAI / Anthropic 已就地适配） */
export interface ApiRequestSpec {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface CallLlmParams {
  messages: LlmMessage[]
  config: ApiConfig
  model: string
  temperature: number
  max_tokens: number
  signal?: AbortSignal
}

export async function callLlm(params: CallLlmParams): Promise<LlmResponse>
export async function callLlm(
  messages: LlmMessage[],
  config: ApiConfig,
  model: string,
  temperature: number,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<LlmResponse>
export async function callLlm(
  messagesOrParams: LlmMessage[] | CallLlmParams,
  config?: ApiConfig,
  model?: string,
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const p: CallLlmParams = Array.isArray(messagesOrParams)
    ? { messages: messagesOrParams, config: config!, model: model!, temperature: temperature!, max_tokens: maxTokens!, signal }
    : messagesOrParams

  if (!p.config.base_url || !p.config.api_key) {
    throw new Error('LLM not configured / LLM 未配置：base_url + api_key needed (see /settings/llm)')
  }

  const start = Date.now()
  const req = buildApiRequest(p.config, buildRequestBody(p))
  const data = await executeWithRetry(req, p.signal)
  const { content, usage } = parseResponse(p.config, data)
  return { content, usage, latency_ms: Date.now() - start }
}

// ---------- API 请求构造（按 api_format 分支） ----------

/** 根据 api_format 构造 URL / headers / body 的框架；body 由上层根据 spec 填 */
export function buildApiRequest(config: ApiConfig, body: Record<string, unknown>): ApiRequestSpec {
  const base = config.base_url.replace(/\/$/, '')
  if (config.api_format === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.api_key,
        'anthropic-version': '2023-06-01',
      },
      body,
    }
  }
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': config.api_key,
    },
    body,
  }
}

function buildRequestBody(p: CallLlmParams): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.max_tokens,
    temperature: p.temperature,
  }
  if (p.config.api_format === 'anthropic') {
    // Anthropic: system 单独字段；messages 只能 user/assistant；image 用 source.url 格式
    const systemMsg = p.messages.find(m => m.role === 'system')
    if (systemMsg) {
      base.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
    }
    base.messages = p.messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return { type: 'image', source: { type: 'url', url: b.image_url.url } }
          }),
    }))
  } else {
    base.stream = false
    base.messages = p.messages
  }
  if (p.config.extra_body) Object.assign(base, p.config.extra_body)
  return base
}

function parseResponse(config: ApiConfig, data: unknown): { content: string; usage?: LlmResponse['usage'] } {
  const d = data as Record<string, unknown>
  if (config.api_format === 'anthropic') {
    const blocks = Array.isArray(d.content) ? (d.content as Array<{ type: string; text?: string }>) : []
    const content = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    const u = d.usage as { input_tokens?: number; output_tokens?: number } | undefined
    const usage = u
      ? { prompt_tokens: u.input_tokens ?? 0, completion_tokens: u.output_tokens ?? 0, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
      : undefined
    return { content, usage }
  }
  const choices = d.choices as Array<{ message?: { content?: string } }> | undefined
  return {
    content: choices?.[0]?.message?.content ?? '',
    usage: d.usage as LlmResponse['usage'],
  }
}

// ---------- 共享 retry / timeout / abort 脚手架 ----------

const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 120_000
const BACKOFF_BASE_MS = 2_000

async function executeWithRetry(req: ApiRequestSpec, externalSignal?: AbortSignal): Promise<unknown> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * attempt))

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      if (externalSignal?.aborted) throw new Error('Aborted')
      externalSignal?.addEventListener('abort', () => controller.abort(), { once: true })

      const resp = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      // 429 / 5xx → 重试
      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
        continue
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`HTTP ${resp.status}: ${text}`)
      }

      return await resp.json()
    } catch (e) {
      if (externalSignal?.aborted) throw new Error('Aborted')
      lastError = e instanceof Error ? e : new Error(String(e))
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Timeout')
    }
  }

  throw lastError ?? new Error('Unknown error')
}
