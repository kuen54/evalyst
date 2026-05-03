import { describe, it, expect } from 'vitest'
import { buildApiRequest } from '@/lib/llm-client'

describe('buildApiRequest · Authorization Bearer 前缀', () => {
  it('OpenAI format: 裸 api_key 自动加 Bearer 前缀', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'sk-abc123' },
      { model: 'gpt-4o-mini' },
    )
    expect(req.headers.Authorization).toBe('Bearer sk-abc123')
  })

  it('OpenAI format: 已有 Bearer 前缀不重复加', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'Bearer sk-abc123' },
      { model: 'gpt-4o-mini' },
    )
    expect(req.headers.Authorization).toBe('Bearer sk-abc123')
  })

  it('Anthropic format: x-api-key 不走 Bearer 分支', () => {
    const req = buildApiRequest(
      { api_format: 'anthropic', base_url: 'https://api.anthropic.com/v1', api_key: 'sk-ant-abc' },
      { model: 'claude-haiku' },
    )
    expect(req.headers['x-api-key']).toBe('sk-ant-abc')
    expect(req.headers.Authorization).toBeUndefined()
  })

  it('Anthropic format: Bearer 前缀切到 Authorization（gateway 场景）', () => {
    const req = buildApiRequest(
      { api_format: 'anthropic', base_url: 'https://gateway.example/v1/anthropic/v1', api_key: 'Bearer 12345' },
      { model: 'claude-opus' },
    )
    expect(req.headers.Authorization).toBe('Bearer 12345')
    expect(req.headers['x-api-key']).toBeUndefined()
    expect(req.url).toBe('https://gateway.example/v1/anthropic/v1/messages')
  })

  it('OpenAI format: base_url 末尾 / 被剥掉', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1/', api_key: 'sk-k' },
      { model: 'x' },
    )
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
  })
})
