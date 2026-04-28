import { describe, it, expect, beforeEach } from 'vitest'
import { setSnapshot, getSnapshot, deleteSnapshot } from '../snapshot-cache'
import type { ClientSnapshot } from '../types'

function makeSnap(sessionId: string, path = '/'): ClientSnapshot {
  return {
    session_id: sessionId,
    route_type: 'dashboard',
    path,
    page_context: { route_type: 'dashboard', path, summary: {}, timestamp: 'ts' },
    viewport_index: [],
    timestamp: 'ts',
  }
}

describe('snapshot-cache', () => {
  beforeEach(() => {
    deleteSnapshot('s1')
    deleteSnapshot('s2')
  })

  it('stores and retrieves a snapshot by session id', () => {
    const snap = makeSnap('s1')
    setSnapshot('s1', snap)
    expect(getSnapshot('s1')).toEqual(snap)
  })

  it('returns undefined when no snapshot exists', () => {
    expect(getSnapshot('missing')).toBeUndefined()
  })

  it('overwrites on repeated set', () => {
    setSnapshot('s1', makeSnap('s1', '/a'))
    setSnapshot('s1', makeSnap('s1', '/b'))
    expect(getSnapshot('s1')?.path).toBe('/b')
  })

  it('isolates different session ids', () => {
    setSnapshot('s1', makeSnap('s1', '/a'))
    setSnapshot('s2', makeSnap('s2', '/b'))
    expect(getSnapshot('s1')?.path).toBe('/a')
    expect(getSnapshot('s2')?.path).toBe('/b')
  })

  it('deletes cleanly', () => {
    setSnapshot('s1', makeSnap('s1'))
    deleteSnapshot('s1')
    expect(getSnapshot('s1')).toBeUndefined()
  })
})
