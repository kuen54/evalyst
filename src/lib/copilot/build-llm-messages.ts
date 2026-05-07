// ---------- Build LlmMessage[] from CopilotMessage[] branch ----------
// 把 Copilot 会话的一条 active branch 序列化为发给 LLM 的 messages 数组。
//
// v2（spec §5.10）：顶部两条 system message —— 固定 prompt + JSON 形 SystemHeader。
// SystemHeader 只含 route_type + path + active_contexts（ref + summary）；
// 不再把 context markdown / page snapshot 塞进来。LLM 需要细节时调：
//   - read_context(id, scope) 拿用户圈选过的 context
//   - read_resource(type, id, fields?) 顺藤摸其他平台资源
//   - read_page(query) 查当前页 DOM 索引
//   - read_tool_result(ref) 回捞落盘的 tool_result
//
// Anthropic user/assistant 严格交替约束由 serializeMessagesForProvider 在
// provider 序列化阶段统一处理，此处不交织。

import type { CopilotMessage, CopilotContextRef } from './types'
import type { LlmMessage } from '../llm-client'
import { normalizeToolResult } from './session-store'
import { buildSystemHeader } from './system-header'
import { microCompact } from './micro-compact'

/** v2 §5.6: 保留最近 N 条可重放（read-only）tool_result 的完整形态，老的压成 summary。 */
const MICRO_COMPACT_KEEP_RECENT_READ_RESULTS = 3

export const COPILOT_SYSTEM_PROMPT = `You are Evalyst Copilot, a helpful assistant embedded in the Evalyst LLM evaluation platform.
You help users analyze experiment results, debug prompts, and iterate on evaluations.
Respond in the user's language — if they write in Chinese, reply in Chinese; if English, reply in English.
Be concise and specific; prefer code or concrete examples over abstract advice.

You have access to tools for progressive disclosure:
- read_context(id, scope?): Fetch details of a user-circled context (system_header.active_contexts[i].id, e.g. "ctx_1"). scope="self" (default) or "parent" for surrounding data.
- read_resource(type, id, fields?): Fetch any platform resource (experiment/template/dataset/display/rubric) by id. Use when you need something not already circled — e.g. an experiment's linked template.
- read_experiment_results(experiment_id, ...): Read task-level results with filtering.
- read_page(query): Search the current page DOM for info the user sees.
- read_tool_result(ref): Retrieve a previously persisted large tool result by its ref URL.
- restart_experiment(experiment_id, task_ids?): Re-run an experiment or specific tasks. Destructive — user must confirm.

When the user circles context, refer to it by its chip tag ("根据你圈的 #1 这个实验..."). Don't fabricate data that wasn't shared.`

export function buildLlmMessages(
  branch: CopilotMessage[],
  pageContext?: import('./types').PageContext | null,
): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  // 当前分支最后一条 user 消息挂的 contexts 渲染成 SystemHeader 并塞第二条 system message。
  // 历史 user 消息可能有 contexts，但那是旧状态，不再重放。
  const lastUser = [...branch].reverse().find((m) => m.role === 'user')
  const refs = (lastUser?.contexts ?? []) as CopilotContextRef[]
  const header = buildSystemHeader({
    route_type: pageContext?.route_type,
    path: pageContext?.path,
    page_context: pageContext,
    contexts: refs,
    // v1 → v2 转场：不做 inline 预解（异步 + fs 依赖），一律 ref-only。
    // LLM 看到 ctx_N 后按需 read_context 拉详情。后续可按遥测决定是否加
    // resolveInline（同步读少量资源，仅小 payload 时塞 inline）。
  })
  if (refs.length > 0 || pageContext) {
    out.push({
      role: 'system',
      content: 'Session context (JSON):\n' + JSON.stringify(header, null, 2),
    })
  }

  // v2 §5.6 + v2.5 §4.2: 进入 transcript 迭代前先 microCompact —— 把老的可重放 tool_result
  // 压成 summary，保最近 N 条原样。LLM 如需详情走 read_tool_result(ref)。
  // maxTotalReplayableTokens 防御 3 条 read_context 各 5KB 的累加（单条不超
  // maxResultSizeChars 也可能合计 15KB+）。
  const compacted = microCompact(branch, {
    keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
    maxTotalReplayableTokens: 4000,
  })

  for (const m of compacted) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content })
    } else if (m.role === 'tool_use') {
      // CopilotMessage 上 call_id / tool_name / tool_input 都应填齐（session-store
      // 的 AppendMessageInput 允许缺，但 tool_use 语义上要求三者都在）。缺任一跳过。
      if (!m.call_id || !m.tool_name) continue
      out.push({
        role: 'tool_use',
        call_id: m.call_id,
        tool_name: m.tool_name,
        tool_input: m.tool_input ?? {},
        // Gemini thinking 模式：原样回传 thought_signature 到下一轮 provider 序列化。
        ...(m.thought_signature ? { thought_signature: m.thought_signature } : {}),
      })
    } else if (m.role === 'tool_result') {
      if (!m.call_id) continue
      // v2：content 是 JSON.stringify(ToolResultContent)。送给 LLM 前按 kind 决定可见内容：
      //   inline    → 完整 value JSON（老行为等价）
      //   ref       → preview + 提示用 read_tool_result(ref) 回捞
      //   compacted → summary 占位（原 payload 已释放）
      // normalizeToolResult 处理了裸字符串 / 裸对象的向后兼容。
      const parsed = normalizeToolResult(m.content)
      let visible: string
      if (parsed.kind === 'inline') {
        visible = JSON.stringify(parsed.value ?? null)
      } else if (parsed.kind === 'ref') {
        visible = `${parsed.preview}\n\n[Full result available via read_tool_result(ref="${parsed.ref}")]`
      } else {
        visible = parsed.summary
      }
      out.push({
        role: 'tool_result',
        call_id: m.call_id,
        content: visible,
      })
    }
  }
  return out
}
