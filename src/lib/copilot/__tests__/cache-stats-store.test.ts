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

import { computeSystemPromptDigest, computeToolDigest } from '../cache-stats-store'

describe('computeSystemPromptDigest (v2.5 P1b §3.1.2)', () => {
  it('返回 16 字符 hex 字符串', () => {
    const d = computeSystemPromptDigest('You are helpful')
    expect(d).toMatch(/^[0-9a-f]{16}$/)
  })

  it('相同输入 → 相同 digest（确定性）', () => {
    const a = computeSystemPromptDigest('hello')
    const b = computeSystemPromptDigest('hello')
    expect(a).toBe(b)
  })

  it('不同输入 → 不同 digest', () => {
    const a = computeSystemPromptDigest('hello')
    const b = computeSystemPromptDigest('world')
    expect(a).not.toBe(b)
  })

  it('空 string 也返合法 digest（不抛错）', () => {
    const d = computeSystemPromptDigest('')
    expect(d).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('computeToolDigest (v2.5 P1b §3.1.2)', () => {
  it('返回 16 字符 hex', () => {
    const d = computeToolDigest(['edit_template', 'read_context'])
    expect(d).toMatch(/^[0-9a-f]{16}$/)
  })

  it('相同 names 不同顺序 → 同 digest（自动 sort）', () => {
    const a = computeToolDigest(['edit_template', 'read_context'])
    const b = computeToolDigest(['read_context', 'edit_template'])
    expect(a).toBe(b)
  })

  it('新增 tool → 不同 digest', () => {
    const a = computeToolDigest(['edit_template', 'read_context'])
    const b = computeToolDigest(['edit_template', 'read_context', 'restart_experiment'])
    expect(a).not.toBe(b)
  })

  it('rename tool → 不同 digest（因为 name 变）', () => {
    const a = computeToolDigest(['edit_template'])
    const b = computeToolDigest(['edit_schema'])
    expect(a).not.toBe(b)
  })
})

import {
  detectCacheBreakWithReasons,
  collectRecentBreakReasons,
  type BreakInfo,
} from '../cache-stats-store'

function statWithDigest(overrides: Partial<CacheUsageStat> = {}): CacheUsageStat {
  return {
    session_id: 's', message_id: 'm', ts: new Date().toISOString(),
    input_tokens: 100, output_tokens: 20,
    provider: 'anthropic', model: 'claude-sonnet-4-6',
    system_prompt_digest: 'sysdigest1234567',
    tool_digest: 'tooldigest123456',
    ...overrides,
  }
}

describe('detectCacheBreakWithReasons (v2.5 P1b §3.1.3)', () => {
  it('未达 break 阈值 → broken=false reasons=[]', () => {
    const a = statWithDigest({ cache_read_tokens: 5000 })
    const b = statWithDigest({ cache_read_tokens: 4900 })
    expect(detectCacheBreakWithReasons(a, b)).toEqual({ broken: false, reasons: [] })
  })

  it('break + system_prompt 变 → reasons=["system_prompt"]', () => {
    const a = statWithDigest({ cache_read_tokens: 5000, system_prompt_digest: 'old1234567890abc' })
    const b = statWithDigest({ cache_read_tokens: 0,    system_prompt_digest: 'new1234567890abc' })
    const r = detectCacheBreakWithReasons(a, b)
    expect(r.broken).toBe(true)
    expect(r.reasons).toEqual(['system_prompt'])
  })

  it('break + tool_digest 变 → reasons=["tools"]', () => {
    const a = statWithDigest({ cache_read_tokens: 5000, tool_digest: 'oldtools12345678' })
    const b = statWithDigest({ cache_read_tokens: 0,    tool_digest: 'newtools12345678' })
    const r = detectCacheBreakWithReasons(a, b)
    expect(r.broken).toBe(true)
    expect(r.reasons).toEqual(['tools'])
  })

  it('break + 两个都变 → reasons=["system_prompt", "tools"]', () => {
    const a = statWithDigest({
      cache_read_tokens: 5000,
      system_prompt_digest: 'oldsys1234567890',
      tool_digest: 'oldtools12345678',
    })
    const b = statWithDigest({
      cache_read_tokens: 0,
      system_prompt_digest: 'newsys1234567890',
      tool_digest: 'newtools12345678',
    })
    const r = detectCacheBreakWithReasons(a, b)
    expect(r.broken).toBe(true)
    expect(r.reasons.sort()).toEqual(['system_prompt', 'tools'])
  })

  it('break + 都没变 → reasons=["unknown"]（cache TTL / 其他）', () => {
    const a = statWithDigest({ cache_read_tokens: 5000 })
    const b = statWithDigest({ cache_read_tokens: 0 })
    const r = detectCacheBreakWithReasons(a, b)
    expect(r.broken).toBe(true)
    expect(r.reasons).toEqual(['unknown'])
  })

  it('prev 缺失 digest（旧 jsonl）→ reasons=["unknown"]', () => {
    const a = statWithDigest({ cache_read_tokens: 5000, system_prompt_digest: undefined, tool_digest: undefined })
    const b = statWithDigest({ cache_read_tokens: 0 })
    const r = detectCacheBreakWithReasons(a, b)
    expect(r.broken).toBe(true)
    expect(r.reasons).toEqual(['unknown'])
  })
})

describe('collectRecentBreakReasons (v2.5 P1b §3.1.5)', () => {
  it('空数组 → 全 0', () => {
    expect(collectRecentBreakReasons([])).toEqual({
      system_prompt: 0, tools: 0, unknown: 0,
    })
  })

  it('单条 → 全 0（无 prev 对比）', () => {
    expect(collectRecentBreakReasons([statWithDigest()])).toEqual({
      system_prompt: 0, tools: 0, unknown: 0,
    })
  })

  it('多条混合 break reason → 分类计数', () => {
    const stats: CacheUsageStat[] = [
      statWithDigest({ cache_read_tokens: 5000, system_prompt_digest: 'a' }),
      statWithDigest({ cache_read_tokens: 0,    system_prompt_digest: 'b' }),  // system_prompt break
      statWithDigest({ cache_read_tokens: 5000, system_prompt_digest: 'b', tool_digest: 'x' }),
      statWithDigest({ cache_read_tokens: 0,    system_prompt_digest: 'b', tool_digest: 'y' }),  // tools break
    ]
    expect(collectRecentBreakReasons(stats)).toEqual({
      system_prompt: 1, tools: 1, unknown: 0,
    })
  })
})

describe('appendCacheStat with digests round-trip', () => {
  it('readCacheStats 保留 digest 字段', () => {
    const s = statWithDigest({
      session_id: 'roundtrip',
      system_prompt_digest: 'abc123def4567890',
      tool_digest: '1234567890abcdef',
    })
    appendCacheStat(s)
    const read = readCacheStats({ session_id: 'roundtrip' })
    expect(read).toHaveLength(1)
    expect(read[0].system_prompt_digest).toBe('abc123def4567890')
    expect(read[0].tool_digest).toBe('1234567890abcdef')
  })
})
