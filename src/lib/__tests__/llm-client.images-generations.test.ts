import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callLlm } from '../llm-client'

describe('callLlm with endpoint_kind=images_generations', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('builds request body with model/prompt/size/quality and POSTs to /images/generations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: 'AAAA' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await callLlm({
      messages: [{ role: 'user', content: 'A red cube' }],
      config: {
        api_format: 'openai',
        base_url: 'https://example.com/v1',
        api_key: '1983731511187542037',
        endpoint_kind: 'images_generations',
      },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 4096,
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://example.com/v1/images/generations')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'A red cube',
      size: '1024x1024',
      quality: 'low',
    })
    // 不应该带 messages / max_tokens / temperature（Images API 不接受）
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('max_tokens')
  })
})
