import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tools } from '../tools'
import { setSnapshot, deleteSnapshot } from '../snapshot-cache'
import type { ClientSnapshot } from '../types'

// Mock resolveContexts to avoid fs deps in unit test
vi.mock('../resolve-context', () => ({
  resolveContexts: vi.fn((refs) => refs.map((r: { tag: number; type: string; id: string }) => ({
    tag: r.tag,
    type: r.type,
    id: r.id,
    status: 'ok',
    data: { id: r.id, stub: true },
  }))),
}))

const readPage = tools.find(t => t.name === 'read_page')!

function makeSnap(sessionId: string, entries: Array<{ key: string; type: string; preview_text: string; ancestors?: string[] }>): ClientSnapshot {
  return {
    session_id: sessionId,
    route_type: 'experiment_detail',
    path: '/experiments/exp_1',
    page_context: { route_type: 'experiment_detail', path: '/experiments/exp_1', summary: {}, timestamp: 'ts' },
    viewport_index: entries,
    timestamp: 'ts',
  }
}

describe('read_page tool', () => {
  beforeEach(() => {
    deleteSnapshot('sess')
  })

  it('exists and has query input schema', () => {
    expect(readPage).toBeTruthy()
    expect(readPage.requiresConfirm).toBe(false)
    expect(readPage.input_schema.required).toContain('query')
  })

  it('returns empty result with message when no snapshot', async () => {
    const r = await readPage.run({ query: 'anything' }, { sessionId: 'sess' }) as {
      matches: unknown[]; total_scanned: number; message?: string
    }
    expect(r.matches).toEqual([])
    expect(r.total_scanned).toBe(0)
    expect(r.message).toBeTruthy()
  })

  it('returns zero matches with message when query finds nothing', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'apple pie' },
      { key: 'task_result:t2', type: 'task_result', preview_text: 'banana bread' },
    ]))
    const r = await readPage.run({ query: 'xylophone' }, { sessionId: 'sess' }) as {
      matches: unknown[]; total_scanned: number; message?: string
    }
    expect(r.matches).toEqual([])
    expect(r.total_scanned).toBe(2)
    expect(r.message).toContain('xylophone')
  })

  it('matches by substring in preview_text', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'failed: connection timeout' },
      { key: 'task_result:t2', type: 'task_result', preview_text: 'success: 200 ok' },
    ]))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: Array<{ key: string }>
    }
    expect(r.matches.length).toBe(1)
    expect(r.matches[0].key).toBe('task_result:t1')
  })

  it('scores multi-token queries higher for entries with more hits', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'a', type: 'task_result', preview_text: 'failed timeout' },
      { key: 'b', type: 'task_result', preview_text: 'failed' },
      { key: 'c', type: 'task_result', preview_text: 'timeout' },
    ]))
    const r = await readPage.run({ query: 'failed timeout' }, { sessionId: 'sess' }) as {
      matches: Array<{ key: string }>
    }
    expect(r.matches[0].key).toBe('a') // 2 hits beats 1
  })

  it('caps at top 5 matches', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      key: `t${i}`, type: 'task_result', preview_text: 'failed hit',
    }))
    setSnapshot('sess', makeSnap('sess', entries))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: unknown[]
    }
    expect(r.matches.length).toBe(5)
  })

  it('hydrates matched entries via resolveContexts', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'failed' },
    ]))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: Array<{ content_tree: unknown }>
    }
    expect(r.matches[0].content_tree).toBeTruthy()
    expect((r.matches[0].content_tree as { stub: boolean }).stub).toBe(true)
  })
})
