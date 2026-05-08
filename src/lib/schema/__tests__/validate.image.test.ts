import { describe, it, expect } from 'vitest'
import { validateJson } from '../validate'

describe('validate image_url', () => {
  it('accepts non-empty string', () => {
    const r = validateJson({ url: 'https://example.com/x.png' }, {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts data URL', () => {
    const r = validateJson({ url: 'data:image/png;base64,iVBORw0K' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts API route URL', () => {
    const r = validateJson({ url: '/api/results/abc/images/xyz_0.png' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects empty string', () => {
    const r = validateJson({ url: '' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects non-string', () => {
    const r = validateJson({ url: 42 }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(false)
  })
})

describe('validate image_url_list', () => {
  it('accepts non-empty string array', () => {
    const r = validateJson({ urls: ['a.png', 'b.png'] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts empty array (no min_length)', () => {
    const r = validateJson({ urls: [] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects array with empty string entries', () => {
    const r = validateJson({ urls: ['a.png', ''] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects non-array', () => {
    const r = validateJson({ urls: 'a.png' }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(false)
  })
})
