import { describe, it, expect } from 'vitest'
import { sliceAfterBoundary } from '../boundary'
import type { CopilotMessage } from '../types'

function msg(
  id: string,
  role: CopilotMessage['role'],
  kind?: 'compact_boundary',
): CopilotMessage {
  return {
    id, session_id: 's', role,
    content: '', timestamp: '2026-05-07T00:00:00Z',
    ...(kind ? { kind } : {}),
  }
}

describe('sliceAfterBoundary', () => {
  it('no boundary: returns the same branch reference', () => {
    const b: CopilotMessage[] = [msg('a', 'user'), msg('b', 'assistant'), msg('c', 'user')]
    expect(sliceAfterBoundary(b)).toBe(b)
  })

  it('single boundary: returns slice after it', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('b', 'assistant'),
      msg('bd', 'system', 'compact_boundary'),
      msg('c', 'user'),
      msg('d', 'assistant'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['c', 'd'])
  })

  it('multiple boundaries: uses the latest (closest to end)', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('bd1', 'system', 'compact_boundary'),
      msg('c', 'user'),
      msg('bd2', 'system', 'compact_boundary'),
      msg('d', 'user'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['d'])
  })

  it('boundary at tail: returns empty array', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('bd', 'system', 'compact_boundary'),
    ]
    expect(sliceAfterBoundary(b)).toEqual([])
  })

  it('empty branch: returns empty', () => {
    expect(sliceAfterBoundary([])).toEqual([])
  })

  it('system role without kind=compact_boundary is not treated as boundary', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('sys', 'system'),  // no kind
      msg('c', 'user'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['a', 'sys', 'c'])
  })
})
