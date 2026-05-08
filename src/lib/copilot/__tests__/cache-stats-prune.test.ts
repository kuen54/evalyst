import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  appendCacheStat,
  pruneCacheStats,
  type CacheUsageStat,
} from '../cache-stats-store'

let tmp: string
let origCwd: string

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-prune-'))
  process.chdir(tmp)
})
afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function stat(overrides: Partial<CacheUsageStat> = {}): CacheUsageStat {
  return {
    session_id: 's', message_id: 'm', ts: new Date().toISOString(),
    input_tokens: 100, output_tokens: 20,
    provider: 'anthropic', model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('pruneCacheStats (v2.5 P1b §3.2)', () => {
  it('文件不存在 → no-op 0/0/0/0', () => {
    const r = pruneCacheStats()
    expect(r).toEqual({ before_lines: 0, after_lines: 0, pruned_by_age: 0, pruned_by_size: 0 })
  })

  it('全部新数据（< 30d）→ no prune', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    appendCacheStat(stat({ session_id: 'b' }))
    const r = pruneCacheStats()
    expect(r.before_lines).toBe(2)
    expect(r.after_lines).toBe(2)
    expect(r.pruned_by_age).toBe(0)
  })

  it('部分过期 → 删 ts < cutoff', () => {
    appendCacheStat(stat({
      session_id: 'old',
      ts: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    }))
    appendCacheStat(stat({ session_id: 'new' }))
    const r = pruneCacheStats({ maxAgeDays: 30, maxLines: 10000 })
    expect(r.before_lines).toBe(2)
    expect(r.after_lines).toBe(1)
    expect(r.pruned_by_age).toBe(1)
  })

  it('全部过期 → after = 0', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    appendCacheStat(stat({ session_id: 'a', ts: old }))
    appendCacheStat(stat({ session_id: 'b', ts: old }))
    const r = pruneCacheStats({ maxAgeDays: 30, maxLines: 10000 })
    expect(r.after_lines).toBe(0)
    expect(r.pruned_by_age).toBe(2)
  })

  it('行数超 maxLines → trim 到 maxLines/2', () => {
    for (let i = 0; i < 100; i++) {
      appendCacheStat(stat({ session_id: `s${i}` }))
    }
    const r = pruneCacheStats({ maxAgeDays: 365, maxLines: 50 })
    expect(r.before_lines).toBe(100)
    expect(r.after_lines).toBe(25)  // maxLines/2 = 25
    expect(r.pruned_by_size).toBe(75)
  })

  it('age 和 size 同时触发：先按 age 删，再按 size 修剪', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    for (let i = 0; i < 5; i++) appendCacheStat(stat({ session_id: `old${i}`, ts: old }))
    for (let i = 0; i < 100; i++) appendCacheStat(stat({ session_id: `new${i}` }))
    const r = pruneCacheStats({ maxAgeDays: 30, maxLines: 50 })
    expect(r.before_lines).toBe(105)
    expect(r.pruned_by_age).toBe(5)
    expect(r.pruned_by_size).toBe(75)  // (100 - 25)
    expect(r.after_lines).toBe(25)
  })

  it('malformed JSON 行 → 一并删除', () => {
    appendCacheStat(stat({ session_id: 'good' }))
    fs.appendFileSync(path.join(tmp, 'data/copilot/cache-stats.jsonl'), '{not valid}\n')
    appendCacheStat(stat({ session_id: 'good2' }))
    const r = pruneCacheStats()
    expect(r.before_lines).toBe(3)
    expect(r.after_lines).toBe(2)  // malformed 行被去掉
  })
})
