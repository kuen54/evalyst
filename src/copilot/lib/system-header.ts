// Copilot v2 system header：LLM 可见的 session "谁在哪里圈了什么" 压缩结构。
//
// 目标（spec §4 三条核心原则）：
//   1. 大小恒定 —— 不含 page snapshot / context 详情，只含 route + ref + summary
//   2. 大东西走 ref —— LLM 需要详情时调 read_context(ctx_N, scope?)
//   3. 工具是唯一入口 —— UI 圈选生成 active_contexts，LLM 按需 read_context
//
// 组装规则：
//   contexts.length ≤ maxContexts 且单条 ≤ maxTokensPerContext 且累计 ≤ maxTotalTokens
//     → inline value 直接塞 inline 字段，省一次 read_context 往返
//   否则 ref-only（LLM 自己决定要不要拉）
//
// 阈值 (3, 1000, 2000 token) 是初值，后期按遥测调。

import type { CopilotContextRef, PageContext } from "./types"

interface InlineLimits {
  maxContexts: number
  maxTokensPerContext: number
  maxTotalTokens: number
}

export const DEFAULT_INLINE_LIMITS: InlineLimits = {
  maxContexts: 3,
  maxTokensPerContext: 1000,
  maxTotalTokens: 2000,
}

interface SystemHeaderActiveContext {
  /** ctx_N 形态的 session-scoped id，对应 CopilotContextRef.tag */
  id: string
  type: string
  /** 底层资源 id，如 "exp_A" / "task_field.output.answer" */
  ref: string
  /** 一句话描述，<100 字符 */
  summary: string
  /** 为 task_field / task_result 这类"内嵌在 experiment 里"的 context 提供祖先链索引 */
  within?: Record<string, string>
  /** 低开销时 LLM 直接看；超阈值为 undefined，走 read_context 拉 */
  inline?: unknown
}

interface SystemHeader {
  route_type: string
  path: string
  active_contexts: SystemHeaderActiveContext[]
}

/**
 * 近似 token 估算：1 token ≈ 4 chars（OpenAI 经验值，够判阈值粒度）。
 * 正式估算涉及 tokenizer，当前用不着——用不准也只是 inline / ref 切换阈值偏移，
 * 实际 LLM 可见总量由 context 本身决定。
 */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

export function shouldInlineContext(
  ctx: { serialized_tokens: number },
  currentCount: number,
  accumulatedTokens: number,
  limits: InlineLimits,
): boolean {
  if (currentCount > limits.maxContexts) return false
  if (ctx.serialized_tokens > limits.maxTokensPerContext) return false
  if (accumulatedTokens + ctx.serialized_tokens > limits.maxTotalTokens) return false
  return true
}

interface BuildHeaderArgs {
  route_type?: string
  path?: string
  page_context?: PageContext | null
  contexts: CopilotContextRef[]
  /** 注入 inline value 的 lookup 函数；缺省则全走 ref-only */
  resolveInline?: (ref: CopilotContextRef) => unknown | undefined
  /** summary lookup；缺省用 `${type} ${id}` */
  summarize?: (ref: CopilotContextRef) => string
  limits?: InlineLimits
}

/**
 * 纯函数：从现有 CopilotContextRef[] + 可选 inline resolver 构造 SystemHeader。
 * 真实的 active_contexts inline value 需要 async resolve（资源走 fs），spec 里
 * 要求的 "ref-only" 模式下本函数足够；inline 模式由调用方 async 预解完再传进来。
 *
 * 阈值按 (count, per-context size, 累计 total) 降级到 ref-only。
 */
export function buildSystemHeader(args: BuildHeaderArgs): SystemHeader {
  const limits = args.limits ?? DEFAULT_INLINE_LIMITS
  const summarize = args.summarize ?? ((r) => `${r.type} ${r.id}`)
  const resolveInline = args.resolveInline

  const active_contexts: SystemHeaderActiveContext[] = []
  let accumulatedTokens = 0
  const contextCount = args.contexts.length

  for (const ref of args.contexts) {
    const id = `ctx_${ref.tag}`
    const summary = summarize(ref)
    const extra = (ref.extra ?? {}) as Record<string, unknown>
    const within: Record<string, string> | undefined =
      Object.keys(extra).length > 0
        ? Object.fromEntries(
            Object.entries(extra).filter(([, v]) => typeof v === "string" || typeof v === "number"),
          ) as Record<string, string>
        : undefined

    let inline: unknown = undefined
    if (resolveInline) {
      const value = resolveInline(ref)
      if (value !== undefined) {
        const serialized = JSON.stringify(value) ?? ""
        const tokens = approxTokens(serialized)
        if (shouldInlineContext({ serialized_tokens: tokens }, contextCount, accumulatedTokens, limits)) {
          inline = value
          accumulatedTokens += tokens
        }
      }
    }

    active_contexts.push({
      id,
      type: ref.type,
      ref: ref.id,
      summary,
      ...(within !== undefined ? { within } : {}),
      ...(inline !== undefined ? { inline } : {}),
    })
  }

  return {
    route_type: args.route_type ?? args.page_context?.route_type ?? "unknown",
    path: args.path ?? args.page_context?.path ?? "",
    active_contexts,
  }
}
