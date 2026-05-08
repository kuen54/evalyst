// ---------- microCompact · v2 · spec §5.6 ----------
// 纯函数：扫 CopilotMessage[]，把"老的 read-only tool_result"压成 compacted 摘要；
// 只保留最近 N 条完整形态（inline / ref）。调用方：build-llm-messages 组装前。
//
// 语义：
//   - role === 'tool_result' 且对应 tool 的 metadata.isReadOnly === true 才算"可重放"，
//     LLM 需要时可通过 read_tool_result(ref) 重新拉回（前提是原来走了 ref 落盘）。
//   - Write tool 的 result（restart_experiment / edit_template 等）**永不压缩** —— 这些操作的
//     观测事实必须完整保留（如"重启成功 / 拒绝原因"），压成摘要会误导 LLM。
//   - Compact 时尽量保留 ref（若原为 ref 形态）：refId 仍在则提示 LLM 用 read_tool_result；
//     若原本就是 inline（payload 没落盘）或未知格式，摘要标明"not persisted"。
//   - 非 tool_result 消息一律透传。
//
// 实现注意：
//   - CopilotMessage.content 在存储里是 string（JSON.stringify(ToolResultContent)），本函数
//     读时走 normalizeToolResult 兼容裸对象 / 老数据；写回时 re-serialize 成 string，保持
//     jsonl 形态一致。
//   - toolByName 在 registry 启动时一次性构建，O(1) 查找。未知工具（registry 里找不到）
//     视作不可重放，不触及。

import type { CopilotMessage, ToolResultContent } from "./types"
import { toolByName } from "./tools/registry"
import { normalizeToolResult } from "./session-store"

/** 从 `ref://tool-result/tr_xxx` 提取 `tr_xxx`；非法格式返回 undefined。 */
export function parseRefId(ref: string): string | undefined {
  return ref.match(/^ref:\/\/tool-result\/(.+)$/)?.[1]
}

/** tool name → registry.metadata.isReadOnly；未知或缺失时返 false。 */
function isReplayableTool(name: string | undefined): boolean {
  if (!name) return false
  const tool = toolByName.get(name)
  return tool?.metadata.isReadOnly ?? false
}

export interface MicroCompactConfig {
  /** 保留最近 N 条可重放 tool_result 的完整形态；其余（更老的）压成 compacted。 */
  keepRecentReadResults: number
  /**
   * 累计 token 上限。从最近到老反向遍历可重放 tool_result，acc + tokens > 阈值
   * 时停止保留（即使在 keepRecentReadResults 窗内）。undefined 时只按数量。
   *
   * spec §4.2：防御 3 条 read_context 各 5KB 的极端累加。约 4 char ≈ 1 token 的
   * 朴素估算。
   */
  maxTotalReplayableTokens?: number
}

/** 4 char ≈ 1 token 的朴素估算，与 anthropic / openai tokenizer 偏差 < 30% 但够用 */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

export function microCompact(
  messages: CopilotMessage[],
  config: MicroCompactConfig,
): CopilotMessage[] {
  // 1. 找所有 replayable tool_result 的索引
  const replayableIdx: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "tool_result") continue
    if (!isReplayableTool(m.tool_name)) continue
    replayableIdx.push(i)
  }

  // 2. 决定保留哪些（从最近到老反向扫，受双阈值约束）
  const keep = Math.max(0, config.keepRecentReadResults)
  const tokenCap = config.maxTotalReplayableTokens
  const keepIdxs = new Set<number>()
  let acc = 0
  for (let pos = replayableIdx.length - 1; pos >= 0; pos--) {
    const reverseRank = replayableIdx.length - 1 - pos // 0 = 最近
    if (reverseRank >= keep) break
    const i = replayableIdx[pos]
    if (tokenCap !== undefined) {
      const tokens = approxTokens(messages[i].content)
      if (acc + tokens > tokenCap) break
      acc += tokens
    }
    keepIdxs.add(i)
  }

  const toCompact = new Set(replayableIdx.filter((i) => !keepIdxs.has(i)))
  if (toCompact.size === 0) return messages

  // 3. 替换
  return messages.map((m, i) => {
    if (!toCompact.has(i)) return m

    const parsed = normalizeToolResult(m.content)
    let refId: string | undefined
    if (parsed.kind === "ref") refId = parseRefId(parsed.ref)
    else if (parsed.kind === "compacted") refId = parsed.ref ? parseRefId(parsed.ref) : undefined
    // inline / 未知 → 无 ref

    const newContent: ToolResultContent = refId
      ? {
          kind: "compacted",
          summary: `(archived tool result; retrieve via read_tool_result('ref://tool-result/${refId}') if needed)`,
          ref: `ref://tool-result/${refId}`,
        }
      : {
          kind: "compacted",
          summary: `(archived tool result; payload not persisted)`,
        }

    return {
      ...m,
      content: JSON.stringify(newContent),
    }
  })
}
