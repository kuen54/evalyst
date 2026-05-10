// src/lib/copilot/cache-stats-store.ts
//
// IO 层：CacheUsageStat 类型 + jsonl append/read/prune。
// 聚合 / 命中率走 cache-aggregate.ts；break detection / digest / preview 走
// cache-break-detect.ts。

import fs from 'fs'
import path from 'path'
import { ensureDir, writeAtomic } from '../fs-utils'

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
  // v2.5 P1b: break reason detection
  system_prompt_digest?: string    // sha256 前 16 字符
  tool_digest?: string
  // v2.5 P2: break diff —— 末尾 200 字符 preview，用于 break 时给用户看具体差异
  system_prompt_preview?: string   // system prompt 末尾 200 char
  tool_preview?: string            // sorted tool names join(',')；超长时取末尾 200 char
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

interface PruneConfig {
  maxAgeDays: number
  maxLines: number
}

const DEFAULT_PRUNE_CONFIG: PruneConfig = {
  maxAgeDays: 30,
  maxLines: 10000,
}

interface PruneResult {
  before_lines: number
  after_lines: number
  pruned_by_age: number
  pruned_by_size: number
}

/**
 * v2.5 P1b §3.2: 双阈值 retention
 * - 删 ts < now - maxAgeDays 的所有行（含 malformed JSON）
 * - 若仍 > maxLines，从头删到 maxLines/2（保最后 N/2 条作业暖数据）
 *
 * 原子写：tmp file + rename。
 */
export function pruneCacheStats(config: PruneConfig = DEFAULT_PRUNE_CONFIG): PruneResult {
  const filePath = cacheStatsPath()
  if (!fs.existsSync(filePath)) {
    return { before_lines: 0, after_lines: 0, pruned_by_age: 0, pruned_by_size: 0 }
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  const allLines = raw.split('\n').filter((l) => l.trim())
  const beforeLines = allLines.length

  const cutoff = Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000
  const byAge = allLines.filter((line) => {
    try {
      const s = JSON.parse(line) as CacheUsageStat
      return new Date(s.ts).getTime() >= cutoff
    } catch {
      return false  // malformed 行同时删除
    }
  })
  const prunedByAge = beforeLines - byAge.length

  let final = byAge
  let prunedBySize = 0
  if (byAge.length > config.maxLines) {
    const keepCount = Math.floor(config.maxLines / 2)
    final = byAge.slice(-keepCount)
    prunedBySize = byAge.length - keepCount
  }

  const newContent = final.join('\n') + (final.length > 0 ? '\n' : '')
  writeAtomic(filePath, newContent)

  return {
    before_lines: beforeLines,
    after_lines: final.length,
    pruned_by_age: prunedByAge,
    pruned_by_size: prunedBySize,
  }
}
