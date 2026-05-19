// v2.5 P0 §3.4: hermes tool_guardrails.py:71 三档阈值的 evalyst 翻译版。
// 替代 v0.9.0 的硬数步 chain cap 5，改成"按错误模式"判定。
//
// 四档（覆盖范围从严到宽）：
//   1. exact-failure：连续 N 次同 (tool, argsHash) 失败 → block
//   2. same-tool：连续 N 次同 tool（args 可不同）失败 → block
//   3. no-progress：连续 N 次同 (tool, argsHash) 成功但 output identical → block
//   4. ref-chain：连续 N 次 read_tool_result 返 {kind:"ref"} → block。v0.18.6
//      skipPayloadGuard 修法的 tripwire——正常路径下 read_tool_result 永远返 inline，
//      若再现 ref 链是该 bug 回归。args 不同 + 不算 failed + output 不同导致前 3 档都漏。

import type { CopilotMessage } from "./types"

interface ToolLoopDetectorConfig {
  exactFailureWarn: number
  exactFailureBlock: number
  sameToolFailureWarn: number
  sameToolFailureHalt: number
  noProgressWarn: number
  noProgressBlock: number
  /** v0.18.7 G1: read_tool_result 返 {kind:"ref"} 连续次数阈值 */
  refChainWarn: number
  refChainBlock: number
}

export const DEFAULT_LOOP_CONFIG: ToolLoopDetectorConfig = {
  exactFailureWarn: 2, exactFailureBlock: 5,
  sameToolFailureWarn: 3, sameToolFailureHalt: 8,
  noProgressWarn: 2, noProgressBlock: 5,
  // 紧阈值：skipPayloadGuard 后正常 0 次。warn 2 / block 3 留 1 次缓冲应对边缘场景。
  refChainWarn: 2, refChainBlock: 3,
}

type LoopReasonKey = "exact_failure" | "same_tool" | "no_progress" | "ref_chain"

export type ToolLoopDecision =
  | { action: "proceed" }
  | { action: "warn"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }
  | { action: "block"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }

/**
 * 稳定 JSON hash —— 递归 sort 所有嵌套 object 的 keys（v0.18.13 M2）。
 * v0.18.6 之前只 sort top-level，嵌套字段（如 `read_experiment_results.filter.score_lt`）
 * 顺序不同就 hash 不同 → no-progress 检测对嵌套 args 工具不可靠。
 * 数组保留顺序（语义有意义）。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}"
}

function argsHash(input: Record<string, unknown>): string {
  return stableStringify(input)
}

/**
 * 解析 tool_result.content，判定 ToolResultContent.kind 是否为 "ref"（v0.18.13 M1）。
 * v0.18.7 原实现用 `includes('"kind":"ref"')` substring 匹配，会被 payload **内容**
 * 含这个字面量的合法工具返回（如讨论 ref 协议的 dataset record / meta 实验数据）误触发。
 */
function isRefKindResult(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== "object") return false
    return (parsed as { kind?: unknown }).kind === "ref"
  } catch {
    return false
  }
}

/**
 * 判定 tool_result.content 是否代表"失败"。
 * 目前只识别两种形态：
 *   1. { error: string } — runTool 默认 catch + payloadGuard 的失败包装
 *   2. { denied: true }  — 用户拒绝执行写工具
 * 其他形态（{ ok: false } / { success: false } / HTTP error shapes）均视为成功。
 * 新增自定义失败字段时同步更新此函数。
 */
function isFailure(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== "object" || parsed === null) return false
    const obj = parsed as Record<string, unknown>
    if ("error" in obj) return true
    if ("denied" in obj && obj.denied === true) return true
    return false
  } catch {
    return false
  }
}

interface PairSummary {
  toolName: string
  argsHash: string
  failed: boolean
  outputContent: string
}

/**
 * 反向扫 branch 尾部连续的 tool_use + tool_result 配对。
 *
 * **跳过的消息**（不算"边界"）：
 * - 末尾 hanging tool_use：/tool-result POST 时分支末端是刚 append 的 tool_use（待计算
 *   result），先跳过它才能看到前面的 pair。
 * - `system` 消息（含 `kind: 'compact_boundary'`）：v2.5 M2 microCompact 在每个 tool_result
 *   后插一条 boundary，纯粹是 transcript 卫生标记，不应打断 trailing-pair 串。
 *
 * **打断扫描的消息**（intentional：视为策略变更）：
 * - `assistant` 文本：LLM 通常在调用工具间不发文字；一旦出现意味着 LLM 已 end_turn 并切换思路
 * - `user` 文本：用户重新发问 → 重置检测
 *
 * 修复历史（hotfix 2026-05-08）：原实现要求末端必须是 tool_result 且 pair 之间无任何消息，
 * 与 v2.5 M2 的 compact_boundary 联动后导致检测器永远见不到任何 pair。手动回归捞出这个 bug。
 */
function collectTrailingPairs(branch: CopilotMessage[]): PairSummary[] {
  const pairs: PairSummary[] = []
  let i = branch.length - 1

  // 1. 跳过末尾的 hanging tool_use / system / compact_boundary，找到第一个 tool_result。
  //    遇到 user/assistant text → 末端就在策略变更后，直接返空。
  while (i >= 0) {
    const m = branch[i]
    if (!m) break
    if (m.role === 'tool_result') break
    if (m.role === 'tool_use' || m.role === 'system') {
      i--
      continue
    }
    return pairs  // user / assistant 文本 → 没有 trailing pair
  }
  if (i < 0) return pairs

  // 2. 反向扫 (tool_result, tool_use) 对，hopping over 中间的 system 消息。
  while (i >= 1) {
    const result = branch[i]
    if (!result || result.role !== 'tool_result') break

    let j = i - 1
    while (j >= 0 && branch[j]?.role === 'system') j--
    if (j < 0) break

    const use = branch[j]
    if (!use || use.role !== 'tool_use') break
    if (!use.tool_name || !use.call_id || result.call_id !== use.call_id) break

    pairs.unshift({
      toolName: use.tool_name,
      argsHash: argsHash((use.tool_input ?? {}) as Record<string, unknown>),
      failed: isFailure(result.content),
      outputContent: result.content,
    })

    // 跳到下一个 tool_result：跨过 system 消息。
    i = j - 1
    while (i >= 0 && branch[i]?.role === 'system') i--
  }
  return pairs
}

export function analyzeToolLoop(
  branch: CopilotMessage[],
  nextToolName: string,
  nextToolInput: Record<string, unknown>,
  config: ToolLoopDetectorConfig = DEFAULT_LOOP_CONFIG,
): ToolLoopDecision {
  const pairs = collectTrailingPairs(branch)
  if (pairs.length === 0) return { action: "proceed" }

  const nextHash = argsHash(nextToolInput)

  // exact-failure: 反向扫连续 (toolName, argsHash) 全失败
  // 阈值含义 = "已累计 N 次满足条件的历史" → 比较 count，不加 1
  let exactFailCount = 0
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (!p) break
    if (p.toolName === nextToolName && p.argsHash === nextHash && p.failed) {
      exactFailCount++
    } else break
  }
  if (exactFailCount >= config.exactFailureBlock) {
    return { action: "block", reasonKey: "exact_failure", reasonVars: { tool: nextToolName, count: exactFailCount } }
  }
  if (exactFailCount >= config.exactFailureWarn) {
    return { action: "warn", reasonKey: "exact_failure", reasonVars: { tool: nextToolName, count: exactFailCount } }
  }

  // same-tool: 连续同 toolName 都失败（不限 args）
  let sameToolFailCount = 0
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (!p) break
    if (p.toolName === nextToolName && p.failed) {
      sameToolFailCount++
    } else break
  }
  if (sameToolFailCount >= config.sameToolFailureHalt) {
    return { action: "block", reasonKey: "same_tool", reasonVars: { tool: nextToolName, count: sameToolFailCount } }
  }
  if (sameToolFailCount >= config.sameToolFailureWarn) {
    return { action: "warn", reasonKey: "same_tool", reasonVars: { tool: nextToolName, count: sameToolFailCount } }
  }

  // no-progress: 连续同 (toolName, argsHash) 成功但输出相同
  let noProgressCount = 0
  let firstOutput: string | undefined
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (!p) break
    if (p.toolName !== nextToolName || p.argsHash !== nextHash || p.failed) break
    if (firstOutput === undefined) firstOutput = p.outputContent
    if (p.outputContent !== firstOutput) break
    noProgressCount++
  }
  if (noProgressCount >= config.noProgressBlock) {
    return { action: "block", reasonKey: "no_progress", reasonVars: { tool: nextToolName, count: noProgressCount } }
  }
  if (noProgressCount >= config.noProgressWarn) {
    return { action: "warn", reasonKey: "no_progress", reasonVars: { tool: nextToolName, count: noProgressCount } }
  }

  // ref-chain (v0.18.7 G1): read_tool_result 连续返 {kind:"ref"}。
  // skipPayloadGuard 修法的 tripwire——args 每次不同（不同 ref）+ 不算 failed +
  // outputContent 也每次不同（嵌套新 ref），前三档全漏。仅当 nextToolName === read_tool_result
  // 才检测，避免误伤其它工具的正常 ref 返回（其它工具返 ref 是合规设计）。
  if (nextToolName === "read_tool_result") {
    let refChainCount = 0
    for (let i = pairs.length - 1; i >= 0; i--) {
      const p = pairs[i]
      if (!p) break
      if (p.toolName !== "read_tool_result") break
      if (!isRefKindResult(p.outputContent)) break
      refChainCount++
    }
    if (refChainCount >= config.refChainBlock) {
      return { action: "block", reasonKey: "ref_chain", reasonVars: { tool: nextToolName, count: refChainCount } }
    }
    if (refChainCount >= config.refChainWarn) {
      return { action: "warn", reasonKey: "ref_chain", reasonVars: { tool: nextToolName, count: refChainCount } }
    }
  }

  return { action: "proceed" }
}
