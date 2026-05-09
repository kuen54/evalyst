// src/lib/copilot/cache-aggregate.ts
//
// Cache hit rate / break 数量聚合。依赖 cache-stats-store 的 CacheUsageStat 类型
// 和 cache-break-detect 的 detectCacheBreak 谓词；自身不做 io。

import type { CacheUsageStat } from './cache-stats-store'
import { detectCacheBreak } from './cache-break-detect'

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

export interface CacheBreaksSummary {
  recent_breaks: number
  total_pairs_considered: number
}

export function countRecentBreaks(stats: CacheUsageStat[]): CacheBreaksSummary {
  let breaks = 0
  for (let i = 1; i < stats.length; i++) {
    if (detectCacheBreak(stats[i - 1], stats[i])) breaks++
  }
  return { recent_breaks: breaks, total_pairs_considered: Math.max(0, stats.length - 1) }
}
