// src/lib/copilot/anthropic-cache-control.ts
//
// v2.5 P1a §3.1: hermes prompt_caching.py:41-72 system_and_3 策略的 TS 翻译。
// 在 buildStreamingRequestBody 组装完 Anthropic body 之后、发送前调用。
//
// 4 个 breakpoints 上限（Anthropic spec）：
//   1. system prompt 末尾（最稳定前缀）
//   2-4. 最后 3 条非 system 消息的最后 content block
//
// "最后 3 条"是滚动窗口末 3 条（任意 role），按 hermes 实现。
//
// 对 Bedrock / Sankuai Anthropic gateway：字段大概率静默兼容；若 gateway 拒绝
// 会抛 4xx，caller 按原错误显示即可。

export interface AnthropicBody {
  system?: string | Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
}

export function applyAnthropicCacheControl(body: AnthropicBody): void {
  applyToSystem(body)
  applyToTailMessages(body.messages)
}

function applyToSystem(body: AnthropicBody): void {
  const sys = body.system
  if (typeof sys === 'string') {
    if (sys.length === 0) return
    body.system = [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }]
    return
  }
  if (Array.isArray(sys) && sys.length > 0) {
    const last = sys[sys.length - 1]!
    if (!last.cache_control) {
      last.cache_control = { type: 'ephemeral' }
    }
  }
}

function applyToTailMessages(messages: Array<Record<string, unknown>>): void {
  const tail = messages.slice(-3)
  for (const msg of tail) {
    addCacheControlToLastBlock(msg)
  }
}

function addCacheControlToLastBlock(msg: Record<string, unknown>): void {
  const content = msg.content
  if (typeof content === 'string') {
    // string 转 single text block + cache_control
    msg.content = [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }]
    return
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1] as Record<string, unknown>
    if (!last.cache_control) {
      last.cache_control = { type: 'ephemeral' }
    }
  }
  // 空 content array / 非 string 非 array → 跳过
}
