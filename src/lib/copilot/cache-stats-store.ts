// src/lib/copilot/cache-stats-store.ts
import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'
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

/**
 * v2.5 P0 §3.2: 与 openclaw `prompt-cache-observability.ts:51` 对齐的 noise floor。
 * 小波动不视为 break；避免"重启一次实验就让 chip 抖一下"。
 */
export const CACHE_BREAK_MIN_DROP_TOKENS = 1000
export const CACHE_BREAK_MAX_RATIO = 0.95

export function detectCacheBreak(
  prev: CacheUsageStat | undefined,
  curr: CacheUsageStat,
): boolean {
  if (!prev) return false
  const prevRead = prev.cache_read_tokens ?? 0
  if (prevRead === 0) return false
  const currRead = curr.cache_read_tokens ?? 0
  const drop = prevRead - currRead
  if (drop < CACHE_BREAK_MIN_DROP_TOKENS) return false
  const ratio = currRead / prevRead
  return ratio < CACHE_BREAK_MAX_RATIO
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

/**
 * v2.5 P1b §3.1.2: sha256 前 16 字符 digest，用于 break reason detection。
 *
 * 16 字符碰撞概率 1/2^64 完全够判等用（不是密码学场景）；裁短主要是
 * 节省每条 cache-stats jsonl 行的字节数（10K 条节省 ~1MB）。
 */
export function computeSystemPromptDigest(systemPrompt: string): string {
  return crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
}

export function computeToolDigest(toolNames: string[]): string {
  const sorted = [...toolNames].sort().join(',')
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16)
}

export type BreakReason = 'system_prompt' | 'tools' | 'unknown'

export interface BreakInfo {
  broken: boolean
  reasons: BreakReason[]
}

/**
 * v2.5 P1b §3.1.3: 在 detectCacheBreak (PR1) 噪声地板基础上对比 digest，
 * 给出 break 的具体原因。
 *
 * - prev/curr digest 都齐 + 不同 → 加对应 reason
 * - 量级掉但 digest 都一样 → 'unknown'（可能是 cache TTL 过期或其他）
 *
 * 注：prev === undefined 已被 detectCacheBreak short-circuit 成 false，
 * 进到 reasons 分支时 prev 必然存在。
 */
export function detectCacheBreakWithReasons(
  prev: CacheUsageStat | undefined,
  curr: CacheUsageStat,
): BreakInfo {
  if (!detectCacheBreak(prev, curr)) {
    return { broken: false, reasons: [] }
  }
  // detectCacheBreak 保证 prev 非空到这里（用 ! 让 TS 跨函数边界感知）
  const p = prev!
  const reasons: BreakReason[] = []
  if (p.system_prompt_digest && curr.system_prompt_digest &&
      p.system_prompt_digest !== curr.system_prompt_digest) {
    reasons.push('system_prompt')
  }
  if (p.tool_digest && curr.tool_digest &&
      p.tool_digest !== curr.tool_digest) {
    reasons.push('tools')
  }
  if (reasons.length === 0) {
    reasons.push('unknown')
  }
  return { broken: true, reasons }
}

export function collectRecentBreakReasons(
  stats: CacheUsageStat[],
): Record<BreakReason, number> {
  const counts: Record<BreakReason, number> = {
    system_prompt: 0, tools: 0, unknown: 0,
  }
  for (let i = 1; i < stats.length; i++) {
    const info = detectCacheBreakWithReasons(stats[i - 1], stats[i])
    if (!info.broken) continue
    for (const r of info.reasons) counts[r]++
  }
  return counts
}

/**
 * v2.5 P1b §3.1.4: 从 LlmMessages 抽出系统 prompt 文本用于 digest。
 *
 * 第一条 system 消息 = `COPILOT_SYSTEM_PROMPT` 常量（cache 稳定前缀）。
 * `Array.find` 返回首个匹配 → 后续 SystemHeader 每请求变动，不参与 digest。
 *
 * content 可能是 string（OpenAI / 我们 buildLlmMessages 输出）或 array of blocks
 * （未来 Anthropic 4-breakpoint 改造路径），后者 concat text 字段防御性处理。
 *
 * 入参签名故意宽松（`role: string` + `content?: unknown`）以兼容 `LlmMessage` 这种
 * discriminated union（其中 `tool_use` 变体没有 `content` 字段）。
 */
export function extractSystemPromptString(
  messages: ReadonlyArray<{ role: string; content?: unknown }>,
): string {
  const sys = messages.find((m) => m.role === 'system')
  if (!sys) return ''
  if (typeof sys.content === 'string') return sys.content
  if (Array.isArray(sys.content)) {
    return sys.content
      .map((b) =>
        typeof b === 'object' && b !== null && 'text' in b
          ? String((b as { text: unknown }).text)
          : '',
      )
      .join('\n')
  }
  return ''
}

export interface PruneConfig {
  maxAgeDays: number
  maxLines: number
}

export const DEFAULT_PRUNE_CONFIG: PruneConfig = {
  maxAgeDays: 30,
  maxLines: 10000,
}

export interface PruneResult {
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
