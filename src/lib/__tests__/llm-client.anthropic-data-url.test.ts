import { describe, it, expect } from 'vitest'
import { imageBlockForAnthropic } from '@/lib/llm-client'

describe('imageBlockForAnthropic', () => {
  it('detects PNG data URL → source.type=base64 with media_type=image/png', () => {
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    const block = imageBlockForAnthropic(url)
    expect(block).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUg==',
      },
    })
  })

  it('detects JPEG data URL → media_type=image/jpeg', () => {
    const url = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    const block = imageBlockForAnthropic(url) as { source: { media_type: string; data: string } }
    expect(block.source.media_type).toBe('image/jpeg')
    expect(block.source.data).toBe('/9j/4AAQSkZJRg==')
  })

  it('detects WebP data URL → media_type=image/webp', () => {
    const url = 'data:image/webp;base64,UklGRhwAAABXRUJQ'
    const block = imageBlockForAnthropic(url) as { source: { media_type: string } }
    expect(block.source.media_type).toBe('image/webp')
  })

  it('passes HTTP URL through as source.type=url', () => {
    const url = 'https://example.com/image.png'
    const block = imageBlockForAnthropic(url)
    expect(block).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/image.png' },
    })
  })

  it('falls back to source.type=url for malformed data: prefix (no ;base64,)', () => {
    const url = 'data:image/png,raw-not-base64'
    const block = imageBlockForAnthropic(url)
    expect(block).toEqual({
      type: 'image',
      source: { type: 'url', url: 'data:image/png,raw-not-base64' },
    })
  })
})
