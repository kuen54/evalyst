// src/lib/copilot/cache-stats-store.ts
import fs from 'fs'
import path from 'path'
import { ensureDir } from '../fs-utils'

export interface CacheUsageStat {
  session_id: string
  message_id: string
  ts: string                       // ISO 8601
  input_tokens: number             // Anthropic 语义：uncached only；OpenAI 语义：含 cached_tokens
  output_tokens: number
  cache_creation_tokens?: number   // Anthropic cache_creation_input_tokens（OpenAI 兼容层通常无）
  cache_read_tokens?: number       // Anthropic cache_read_input_tokens / OpenAI prompt_tokens_details.cached_tokens
  provider: 'anthropic' | 'openai'
  model: string
}

// 惰性路径，测试 chdir 有效
function copilotDir() { return path.join(process.cwd(), 'data', 'copilot') }
function cacheStatsPath() { return path.join(copilotDir(), 'cache-stats.jsonl') }

export function appendCacheStat(stat: CacheUsageStat): void {
  ensureDir(copilotDir())
  fs.appendFileSync(cacheStatsPath(), JSON.stringify(stat) + '\n')
}

export function readCacheStats(opts?: {
  since_ms?: number
  session_id?: string
}): CacheUsageStat[] {
  if (!fs.existsSync(cacheStatsPath())) return []
  const raw = fs.readFileSync(cacheStatsPath(), 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim())
  const cutoff = opts?.since_ms ? Date.now() - opts.since_ms : 0
  const out: CacheUsageStat[] = []
  for (const line of lines) {
    try {
      const s = JSON.parse(line) as CacheUsageStat
      if (cutoff && new Date(s.ts).getTime() < cutoff) continue
      if (opts?.session_id && s.session_id !== opts.session_id) continue
      out.push(s)
    } catch {
      // skip malformed
    }
  }
  return out
}

export interface CacheHitRateResult {
  hit_rate: number | null
  calls: number
  total_denom: number
  total_cache_read: number
  total_cache_creation: number
}

/**
 * spec §6 + 调研报告 §8：按 provider 分桶算分母。
 * - Anthropic: `input_tokens` 不含 cache_read/cache_creation → denom = input + cache_read + cache_creation
 * - OpenAI: `prompt_tokens` 映射到 `input_tokens`，已含 cached_tokens → denom = input_tokens
 *
 * 任何 stat 都没有 cache 字段时返 null（区分"不支持 cache 观测"与"0% 命中"）。
 */
export function aggregateCacheHitRate(stats: CacheUsageStat[]): CacheHitRateResult {
  if (stats.length === 0) {
    return { hit_rate: null, calls: 0, total_denom: 0, total_cache_read: 0, total_cache_creation: 0 }
  }
  let totalDenom = 0
  let totalCacheRead = 0
  let totalCacheCreate = 0
  let hasAnyCache = false
  for (const s of stats) {
    const cr = s.cache_read_tokens ?? 0
    const cc = s.cache_creation_tokens ?? 0
    if (s.cache_read_tokens !== undefined || s.cache_creation_tokens !== undefined) {
      hasAnyCache = true
    }
    totalCacheRead += cr
    totalCacheCreate += cc
    if (s.provider === 'anthropic') {
      totalDenom += s.input_tokens + cr + cc
    } else {
      totalDenom += s.input_tokens
    }
  }
  return {
    hit_rate: hasAnyCache && totalDenom > 0 ? totalCacheRead / totalDenom : hasAnyCache ? 0 : null,
    calls: stats.length,
    total_denom: totalDenom,
    total_cache_read: totalCacheRead,
    total_cache_creation: totalCacheCreate,
  }
}
