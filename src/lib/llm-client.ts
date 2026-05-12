import type { ApiConfig } from './types'

/**
 * 统一的 LLM 消息类型。PR-3 起扩展成 discriminated union 以承载工具调用：
 * - 文本三元组（system/user/assistant）走 content: string | ContentBlock[]
 * - tool_use 承载 LLM 发起的工具调用（call_id + tool_name + tool_input）
 * - tool_result 承载工具返回结果（call_id + content，content 为 JSON string；
 *   denied 分支也序列化为 JSON string 存入 content）
 *
 * 非流式 callLlm（experiment batch runner）只走 text 分支——widened union 里
 * tool_use / tool_result 对 batch-runner 没意义，由 buildRequestBody 过滤掉。
 */
export type LlmMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
    }
  | {
      role: 'tool_use'
      call_id: string
      tool_name: string
      tool_input: Record<string, unknown>
      /**
       * Gemini thinking 模式的不透明签名；下一轮调用必须原样回显到
       * OpenAI 兼容格式的 `tool_calls[].function.thought_signature` 字段，
       * 否则 Vertex/Gemini 返回 400。其他 provider 没有该字段，序列化时按
       * 缺省处理。
       */
      thought_signature?: string
    }
  | {
      role: 'tool_result'
      call_id: string
      content: string
      /** v2.5 P2: tool_result 是 error 时设为 true，仅 Anthropic 序列化生效（is_error 协议字段透传）。 */
      is_error?: boolean
    }

/** Narrow guard: 只保留普通 text-style 消息（batch-runner 走此路径）。 */
export function isTextMessage(
  m: LlmMessage,
): m is Extract<LlmMessage, { role: 'system' | 'user' | 'assistant' }> {
  return m.role === 'system' || m.role === 'user' || m.role === 'assistant'
}

export interface LlmResponse {
  content: string
  images?: Array<{ url: string; mime_type?: string }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  latency_ms: number
}

/**
 * 把 image_url 的 url 字符串转成 Anthropic content block：
 * - data:image/{png|jpeg|webp};base64,... → { type:'image', source:{ type:'base64', media_type, data } }
 * - HTTP(S) URL（或任何不匹配 data:...;base64,... 的字符串）→ { type:'image', source:{ type:'url', url } }
 * 不识别的 media_type（如 image/gif）按 image/png 兜底（Anthropic 当前接受 png/jpeg/webp/gif）；
 * 真正不支持时由 provider 返回 400，本函数不做白名单。
 */
export function imageBlockForAnthropic(url: string): Record<string, unknown> {
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

/** 已构造好的 HTTP 请求（URL / headers / body 对 OpenAI / Anthropic 已就地适配） */
interface ApiRequestSpec {
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
  /**
   * Optional reproducibility seed.
   * - OpenAI-format gateways: passed through as `body.seed`. Skipped entirely
   *   (key omitted) when undefined — `{"seed": undefined}` triggers 400 on
   *   strict gateways.
   * - Anthropic: dropped with `console.warn` (Anthropic Messages API has no
   *   seed parameter as of 2026; sampling determinism is not exposed).
   */
  seed?: number
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
    ? {
        messages: messagesOrParams,
        config: config!,
        model: model!,
        temperature: temperature!,
        max_tokens: maxTokens!,
        ...(signal !== undefined ? { signal } : {}),
      }
    : messagesOrParams

  if (!p.config.base_url || !p.config.api_key) {
    throw new Error('LLM not configured / LLM 未配置：base_url + api_key needed (see /settings/llm)')
  }

  if ((p.config.endpoint_kind ?? 'chat') === 'images_generations') {
    return callImagesGenerations(p)
  }

  const start = Date.now()
  const req = buildApiRequest(p.config, buildRequestBody(p))
  const data = await executeWithRetry(req, p.signal)
  const { content, images, usage } = parseResponse(p.config, data)
  return {
    content,
    ...(images !== undefined ? { images } : {}),
    ...(usage !== undefined ? { usage } : {}),
    latency_ms: Date.now() - start,
  }
}

// ---------- API 请求构造（按 api_format 分支） ----------

/** 根据 api_format 构造 URL / headers / body 的框架；body 由上层根据 spec 填 */
export function buildApiRequest(config: ApiConfig, body: Record<string, unknown>): ApiRequestSpec {
  const base = config.base_url.replace(/\/$/, '')
  if (config.api_format === 'anthropic') {
    // 默认走官方 Anthropic 的 x-api-key。有些 gateway（如美团 aigc.sankuai.com
    // 的 /v1/anthropic/v1 入口）只收 `Authorization: Bearer`，所以当 api_key
    // 以 "Bearer " 开头时切到 Authorization header，不再发 x-api-key。
    const useBearer = config.api_key.startsWith('Bearer ')
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        ...(useBearer
          ? { Authorization: config.api_key }
          : { 'x-api-key': config.api_key }),
        'anthropic-version': '2023-06-01',
      },
      body,
    }
  }
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      // OpenAI 兼容 API 标准要求 "Authorization: Bearer <key>"。用户如果填纯 "sk-..."，
      // 自动加前缀；已经带 "Bearer " 的原样保留（向后兼容旧用户手动加前缀的 workaround）。
      // 对不要 Bearer 的 gateway 是破坏性变更候选 —— 有需求再加 ModelConfig.auth_no_bearer_prefix。
      'Authorization': config.api_key.startsWith('Bearer ') ? config.api_key : `Bearer ${config.api_key}`,
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
  // 非流式 callLlm 只处理 text-style 消息；tool_use/tool_result 走流式路径（Copilot）
  const textMessages = p.messages.filter(isTextMessage)
  if (p.config.api_format === 'anthropic') {
    // Anthropic: system 单独字段；messages 只能 user/assistant；image block 通过
    // imageBlockForAnthropic 把 data:URL → source.type='base64'，HTTP(S) → source.type='url'
    // （Anthropic source.type='url' 不接受 data: URL，必须落到 base64 分支）
    const systemMsg = textMessages.find(m => m.role === 'system')
    if (systemMsg) {
      base.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
    }
    base.messages = textMessages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return imageBlockForAnthropic(b.image_url.url)
          }),
    }))
  } else {
    base.stream = false
    base.messages = textMessages
    // OpenAI: pass seed through transparently when set. SKIP the key when
    // undefined — some OpenAI-compatible gateways (DeepSeek, certain
    // 沿海机房 forwarders) 400 on `{"seed": null}` / `{"seed": undefined}`
    // payloads even though spec-pure OpenAI tolerates it.
    if (typeof p.seed === 'number') {
      base.seed = p.seed
    }
  }
  // Anthropic does NOT support a seed parameter on the Messages API; drop
  // with a single warn so the user sees their reproducibility intent was
  // not honored on this provider. We do not silently drop — silent drops
  // mask "I set seed=42 but my Anthropic results vary every run" surprises.
  if (p.config.api_format === 'anthropic' && typeof p.seed === 'number') {
    console.warn(
      `[evalyst] Anthropic Messages API does not support 'seed' parameter; dropped (was: ${p.seed})`,
    )
  }
  if (p.config.extra_body) Object.assign(base, p.config.extra_body)
  return base
}

function parseResponse(config: ApiConfig, data: unknown): { content: string; images?: LlmResponse['images']; usage?: LlmResponse['usage'] } {
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
  const choices = d.choices as Array<{ message?: { content?: string; images?: unknown } }> | undefined
  const message = choices?.[0]?.message
  const content = message?.content ?? ''

  // Extract images[] (OpenAI-compatible gateway convention for image-out models)
  let images: LlmResponse['images'] | undefined
  const rawImages = Array.isArray(message?.images) ? (message!.images as Array<Record<string, unknown>>) : null
  if (rawImages) {
    const parsed = rawImages
      .map((img): { url: string; mime_type?: string } | null => {
        const fromImageUrl = (img.image_url as { url?: unknown })?.url
        const fromBareUrl = img.url
        const url = typeof fromImageUrl === 'string'
          ? fromImageUrl
          : (typeof fromBareUrl === 'string' ? fromBareUrl : '')
        if (!url) return null
        const mimeMatch = /^data:([^;]+);base64,/.exec(url)
        const mime = mimeMatch?.[1]
        return mime !== undefined ? { url, mime_type: mime } : { url }
      })
      .filter((x): x is { url: string; mime_type?: string } => x !== null)
    if (parsed.length > 0) images = parsed
  }

  return {
    content,
    images,
    usage: d.usage as LlmResponse['usage'],
  }
}

// Re-export for unit tests (private to project, not in public API of llm-client)
export const parseResponseForTest = parseResponse
export const buildRequestBodyForTest = buildRequestBody

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

// ---------- OpenAI Images API 端点支持（生图模型） ----------

async function callImagesGenerations(p: CallLlmParams): Promise<LlmResponse> {
  const start = Date.now()
  // 取最后一条 user 消息的 content 作为 prompt（生图 API 不接 messages 数组）
  const lastUser = [...p.messages].reverse().find(m => m.role === 'user')
  const prompt = !lastUser
    ? ''
    : typeof lastUser.content === 'string'
      ? lastUser.content
      : lastUser.content.map(b => ('text' in b ? b.text : '')).join('')

  const base = p.config.base_url.replace(/\/$/, '')
  const body: Record<string, unknown> = {
    model: p.model,
    prompt,
    size: '1024x1024',
    quality: 'low',
    ...(p.config.extra_body ?? {}),
  }
  const req: ApiRequestSpec = {
    url: `${base}/images/generations`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: p.config.api_key.startsWith('Bearer ')
        ? p.config.api_key
        : `Bearer ${p.config.api_key}`,
    },
    body,
  }

  const data = await executeWithRetry(req, p.signal)
  const images = parseImagesGenerationsResponse(data)
  return {
    content: '',
    ...(images !== undefined ? { images } : {}),
    latency_ms: Date.now() - start,
  }
}

function parseImagesGenerationsResponse(data: unknown): LlmResponse['images'] | undefined {
  const d = data as { data?: Array<Record<string, unknown>> }
  if (!Array.isArray(d.data)) return undefined
  const out = d.data
    .map((entry): { url: string; mime_type?: string } | null => {
      const b64 = entry.b64_json
      if (typeof b64 === 'string' && b64.length > 0) {
        return { url: `data:image/png;base64,${b64}`, mime_type: 'image/png' }
      }
      const url = entry.url
      if (typeof url === 'string' && url.length > 0) return { url }
      return null
    })
    .filter((x): x is { url: string; mime_type?: string } => x !== null)
  return out.length > 0 ? out : undefined
}
