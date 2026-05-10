// src/lib/copilot/cache-break-detect.ts
//
// Cache break 检测 + reason / digest / preview helpers。
// 依赖 cache-stats-store.ts 的 CacheUsageStat 类型，但不反向依赖 io。

import crypto from 'node:crypto'
import type { CacheUsageStat } from './cache-stats-store'

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

/**
 * v2.5 P1b §3.1.2: sha256 前 16 字符 digest，用于 break reason detection。
 *
 * 16 字符碰撞概率 1/2^64 完全够判等用（不是密码学场景）；裁短主要是
 * 节省每条 cache-stats jsonl 行的字节数（10K 条节省 ~1MB）。
 */
export function computeSystemPromptDigest(systemPrompt: string): string {
  return crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
}

/**
 * Canonicalize a tool name list to a stable comma-joined string.
 * Both digest + preview use the same lexicographic sort to keep them aligned.
 * Internal helper — not exported (callers should go through computeToolDigest /
 * computeToolPreview).
 */
function sortedToolList(toolNames: string[]): string {
  return [...toolNames].sort().join(',')
}

export function computeToolDigest(toolNames: string[]): string {
  return crypto.createHash('sha256').update(sortedToolList(toolNames)).digest('hex').slice(0, 16)
}

type BreakReason = 'system_prompt' | 'tools' | 'unknown'

interface BreakInfo {
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
    const info = detectCacheBreakWithReasons(stats[i - 1]!, stats[i]!)
    if (!info.broken) continue
    for (const r of info.reasons) counts[r]++
  }
  return counts
}

/**
 * v2.5 P2 §3.1: preview 字段助手。digest 只能告诉用户"变了"，preview 让用户看到
 * 具体哪几个字符变了。末尾 200 char 足够看到大部分增量改动（系统 prompt 通常是
 * 在尾部追加内容，cache breakpoint 也通常打在尾部）。
 */
export const PREVIEW_LIMIT = 200

export function computeSystemPromptPreview(systemPrompt: string): string {
  if (systemPrompt.length <= PREVIEW_LIMIT) return systemPrompt
  return systemPrompt.slice(-PREVIEW_LIMIT)
}

/**
 * tool_preview: sorted tool names 用逗号 join。通常 < 200 char 全展示；
 * 极端长名 + 多工具时也走 200 char 截断（slice 末尾），保持上限。
 */
export function computeToolPreview(toolNames: string[]): string {
  const joined = sortedToolList(toolNames)
  if (joined.length <= PREVIEW_LIMIT) return joined
  return joined.slice(-PREVIEW_LIMIT)
}

/**
 * v2.5 P2 §3.3: 找最近一次 break 对应的 (prev, curr) 对。
 * 反向扫描，第一个命中即返。caller 拿到后 + 对应 reasons 可以做 diff 展示。
 */
export interface BreakPair {
  prev: CacheUsageStat
  curr: CacheUsageStat
  reasons: BreakReason[]
}

export function findLatestBreakPair(stats: CacheUsageStat[]): BreakPair | null {
  for (let i = stats.length - 1; i >= 1; i--) {
    const info = detectCacheBreakWithReasons(stats[i - 1]!, stats[i]!)
    if (info.broken) {
      return { prev: stats[i - 1]!, curr: stats[i]!, reasons: info.reasons }
    }
  }
  return null
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
