import { describe, it, expect } from 'vitest'
import type { ApiConfig } from '../types'

import { parseResponseForTest } from '../llm-client'

const openaiCfg: ApiConfig = { api_format: 'openai', base_url: 'x', api_key: 'k' }

describe('parseResponse with images', () => {
  it('extracts images[] from message (image_url.url shape)', () => {
    const resp = {
      choices: [{
        message: {
          content: 'Here is the image.',
          images: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
          ],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.content).toBe('Here is the image.')
    expect(out.images).toHaveLength(2)
    expect(out.images?.[0]).toEqual({ url: 'data:image/png;base64,AAAA', mime_type: 'image/png' })
    expect(out.images?.[1]).toEqual({ url: 'data:image/jpeg;base64,BBBB', mime_type: 'image/jpeg' })
  })

  it('extracts images from bare url shape', () => {
    const resp = {
      choices: [{
        message: {
          content: '',
          images: [{ url: 'https://example.com/img.png' }],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toHaveLength(1)
    expect(out.images?.[0]!.url).toBe('https://example.com/img.png')
    expect(out.images?.[0]!.mime_type).toBeUndefined()
  })

  it('returns undefined images when none present', () => {
    const resp = { choices: [{ message: { content: 'hello' } }] }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toBeUndefined()
  })

  it('filters out empty url entries', () => {
    const resp = {
      choices: [{
        message: {
          content: '',
          images: [
            { image_url: { url: '' } },
            { image_url: { url: 'data:image/png;base64,XXX' } },
            { url: '' },
            {},
          ],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toHaveLength(1)
    expect(out.images?.[0]!.url).toBe('data:image/png;base64,XXX')
  })

  it('does not break Anthropic branch (no images extracted)', () => {
    const anthropicCfg: ApiConfig = { api_format: 'anthropic', base_url: 'x', api_key: 'k' }
    const resp = {
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    const out = parseResponseForTest(anthropicCfg, resp)
    expect(out.content).toBe('hello')
    expect(out.images).toBeUndefined()
  })
})
