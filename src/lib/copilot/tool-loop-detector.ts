// v2.5 P0 §3.4: hermes tool_guardrails.py:71 三档阈值的 evalyst 翻译版。
// 替代 v0.9.0 的硬数步 chain cap 5，改成"按错误模式"判定。
//
// 三档（覆盖范围从严到宽）：
//   1. exact-failure：连续 N 次同 (tool, argsHash) 失败 → block
//   2. same-tool：连续 N 次同 tool（args 可不同）失败 → block
//   3. no-progress：连续 N 次同 (tool, argsHash) 成功但 output identical → block

import type { CopilotMessage } from "./types"

export interface ToolLoopDetectorConfig {
  exactFailureWarn: number
  exactFailureBlock: number
  sameToolFailureWarn: number
  sameToolFailureHalt: number
  noProgressWarn: number
  noProgressBlock: number
}

export const DEFAULT_LOOP_CONFIG: ToolLoopDetectorConfig = {
  exactFailureWarn: 2, exactFailureBlock: 5,
  sameToolFailureWarn: 3, sameToolFailureHalt: 8,
  noProgressWarn: 2, noProgressBlock: 5,
}

export type LoopReasonKey = "exact_failure" | "same_tool" | "no_progress"

export type ToolLoopDecision =
  | { action: "proceed" }
  | { action: "warn"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }
  | { action: "block"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }

function argsHash(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

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

function collectTrailingPairs(branch: CopilotMessage[]): PairSummary[] {
  const pairs: PairSummary[] = []
  let i = branch.length - 1
  while (i >= 1) {
    const result = branch[i]
    const use = branch[i - 1]
    if (result.role !== "tool_result" || use.role !== "tool_use") break
    if (!use.tool_name || !use.call_id || result.call_id !== use.call_id) break
    pairs.unshift({
      toolName: use.tool_name,
      argsHash: argsHash((use.tool_input ?? {}) as Record<string, unknown>),
      failed: isFailure(result.content),
      outputContent: result.content,
    })
    i -= 2
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

  return { action: "proceed" }
}
