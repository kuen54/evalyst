import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  appendCacheStat,
  readCacheStats,
  aggregateCacheHitRate,
  detectCacheBreak,
  countRecentBreaks,
  CACHE_BREAK_MIN_DROP_TOKENS,
  CACHE_BREAK_MAX_RATIO,
  type CacheUsageStat,
} from '../cache-stats-store'

let tmp: string
let origCwd: string

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-cache-'))
  process.chdir(tmp)
})
afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function stat(overrides: Partial<CacheUsageStat> = {}): CacheUsageStat {
  return {
    session_id: 's1', message_id: 'm1', ts: new Date().toISOString(),
    input_tokens: 100, output_tokens: 20,
    provider: 'anthropic', model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('appendCacheStat + readCacheStats', () => {
  it('roundtrips across multiple appends', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats().map((s) => s.session_id)).toEqual(['a', 'b'])
  })

  it('session_id filter', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats({ session_id: 'a' })).toHaveLength(1)
  })

  it('since_ms filter', () => {
    const old = stat({ session_id: 'old', ts: new Date(Date.now() - 10 * 60_000).toISOString() })
    const recent = stat({ session_id: 'new', ts: new Date().toISOString() })
    appendCacheStat(old)
    appendCacheStat(recent)
    expect(readCacheStats({ since_ms: 5 * 60_000 }).map((s) => s.session_id)).toEqual(['new'])
  })

  it('skips malformed lines gracefully', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    fs.appendFileSync(path.join(tmp, 'data/copilot/cache-stats.jsonl'), '{not json}\n')
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats().map((s) => s.session_id)).toEqual(['a', 'b'])
  })
})

describe('aggregateCacheHitRate by provider', () => {
  it('Anthropic: denom = input + cache_read + cache_creation', () => {
    // 2 calls: 1st creates cache (write 1000), 2nd reads it (read 900)
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, cache_creation_tokens: 1000, cache_read_tokens: 0, provider: 'anthropic' }),
      stat({ input_tokens: 100, cache_creation_tokens: 0,    cache_read_tokens: 900, provider: 'anthropic' }),
    ])
    // denom = (100+0+1000) + (100+900+0) = 2100; cache_read = 900
    expect(r.hit_rate).toBeCloseTo(900 / 2100, 3)
    expect(r.calls).toBe(2)
  })

  it('OpenAI: denom = input_tokens (already inclusive of cached)', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 1000, cache_read_tokens: 800, provider: 'openai' }),
      stat({ input_tokens: 500,  cache_read_tokens: 400, provider: 'openai' }),
    ])
    // denom = 1500; cache_read = 1200
    expect(r.hit_rate).toBeCloseTo(1200 / 1500, 3)
  })

  it('no cache fields (undefined): returns null hit_rate', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, provider: 'openai', cache_read_tokens: undefined }),
    ])
    expect(r.hit_rate).toBeNull()
    expect(r.calls).toBe(1)
  })

  it('empty stats: null rate, 0 calls', () => {
    const r = aggregateCacheHitRate([])
    expect(r.hit_rate).toBeNull()
    expect(r.calls).toBe(0)
  })

  it('mixed providers: Anthropic + OpenAI sum correctly', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, cache_creation_tokens: 500, cache_read_tokens: 0, provider: 'anthropic' }),
      stat({ input_tokens: 600, cache_read_tokens: 400, provider: 'openai' }),
    ])
    // Anthropic denom: 100 + 0 + 500 = 600 ; OpenAI denom: 600; total denom = 1200
    // cache_read: 0 + 400 = 400
    expect(r.hit_rate).toBeCloseTo(400 / 1200, 3)
  })
})

describe('detectCacheBreak (v2.5 P0 §3.2)', () => {
  it('prev undefined 永不算 break', () => {
    expect(detectCacheBreak(undefined, stat({ cache_read_tokens: 100 }))).toBe(false)
  })

  it('drop < 1000 tokens 不算 break', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: 4500 })
    expect(detectCacheBreak(a, b)).toBe(false)
  })

  it('drop >= 1000 但 ratio >= 0.95 不算 break', () => {
    const a = stat({ cache_read_tokens: 100_000 })
    const b = stat({ cache_read_tokens: 96_000 })
    expect(detectCacheBreak(a, b)).toBe(false)
  })

  it('drop >= 1000 且 ratio < 0.95 算 break', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: 3000 })
    expect(detectCacheBreak(a, b)).toBe(true)
  })

  it('prev.cache_read_tokens = 0 时不算 break（无可掉的基线）', () => {
    const a = stat({ cache_read_tokens: 0 })
    const b = stat({ cache_read_tokens: 0 })
    expect(detectCacheBreak(a, b)).toBe(false)
  })

  it('curr.cache_read_tokens undefined 视作 0', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: undefined })
    expect(detectCacheBreak(a, b)).toBe(true)  // drop=5000, ratio=0
  })

  it('阈值常量值正确', () => {
    expect(CACHE_BREAK_MIN_DROP_TOKENS).toBe(1000)
    expect(CACHE_BREAK_MAX_RATIO).toBe(0.95)
  })
})

describe('countRecentBreaks (v2.5 P0 §3.2)', () => {
  it('空数组返 0/0', () => {
    expect(countRecentBreaks([])).toEqual({ recent_breaks: 0, total_pairs_considered: 0 })
  })

  it('单条返 0/0（没有前一条对比）', () => {
    expect(countRecentBreaks([stat({ cache_read_tokens: 100 })])).toEqual({
      recent_breaks: 0, total_pairs_considered: 0,
    })
  })

  it('两条全稳：0 breaks / 1 pair', () => {
    const stats = [
      stat({ cache_read_tokens: 5000 }),
      stat({ cache_read_tokens: 4900 }),
    ]
    expect(countRecentBreaks(stats)).toEqual({ recent_breaks: 0, total_pairs_considered: 1 })
  })

  it('三条 ABA 模式：第一对 break，第二对回升不 break', () => {
    const stats = [
      stat({ cache_read_tokens: 5000 }),
      stat({ cache_read_tokens: 1000 }),  // drop=4000, ratio=0.2 → break
      stat({ cache_read_tokens: 5000 }),  // 回升不算 break
    ]
    expect(countRecentBreaks(stats)).toEqual({ recent_breaks: 1, total_pairs_considered: 2 })
  })
})
