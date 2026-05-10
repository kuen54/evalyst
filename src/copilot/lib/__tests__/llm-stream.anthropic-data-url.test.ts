import { describe, it, expect } from 'vitest'
import { __testOnly } from '@/copilot/lib/llm-stream'
import type { LlmMessage } from '@/lib/llm-client'
import type { ApiConfig } from '@/lib/types'

const baseConfig: ApiConfig = { api_format: 'anthropic', base_url: 'x', api_key: 'k' }

describe('llm-stream Anthropic image serialization', () => {
  it('converts data: URL image_url block in user message to source.type=base64', () => {
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this image:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        ],
      },
    ]
    const body = __testOnly.buildStreamingRequestBody({
      messages,
      config: baseConfig,
      model: 'claude-sonnet-4',
      temperature: 0,
      max_tokens: 100,
    })
    const userMsg = (body.messages as Array<{ role: string; content: unknown[] }>)[0]!
    expect(userMsg.role).toBe('user')
    // toMatchObject 忽略 anthropic-cache-control 在尾块上注入的 cache_control 字段，
    // 只校验本次改动的契约：source.type=base64 + media_type + data
    expect(userMsg.content).toMatchObject([
      { type: 'text', text: 'Look at this image:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
      },
    ])
  })

  it('keeps HTTP URL image_url block in user message as source.type=url', () => {
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://cdn.example.com/x.png' } },
        ],
      },
    ]
    const body = __testOnly.buildStreamingRequestBody({
      messages,
      config: baseConfig,
      model: 'claude-sonnet-4',
      temperature: 0,
      max_tokens: 100,
    })
    const content = (body.messages as Array<{ content: unknown[] }>)[0]!.content
    // toMatchObject 忽略尾块 cache_control 注入；只校验 source 契约
    expect(content).toMatchObject([
      {
        type: 'image',
        source: { type: 'url', url: 'https://cdn.example.com/x.png' },
      },
    ])
  })
})
