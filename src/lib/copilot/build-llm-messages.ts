// ---------- Build LlmMessage[] from CopilotMessage[] branch ----------
// 把 Copilot 会话的一条 active branch 序列化为发给 LLM 的 messages 数组。
// 原先埋在 /chat route 里；PR-3 Task 5 抽出来，让 /chat route 和 /tool-result route
// 共用同一套逻辑（并补齐 tool_use / tool_result 的处理）。
//
// 注意：顶部加一条固定 system prompt；当前分支最后一条 user 消息挂的 contexts
// 会 resolve 成第二条 system message（把 context 块给 LLM 看）。
//
// TODO(Task 6): Anthropic API 要求 user / assistant 严格交替，当前映射在
// "assistant text + tool_use" 时会产生两条相邻 assistant 消息。serializeMessagesForProvider
// 层已留 TODO 注释；Task 6 的 /chat route 重写时统一处理（合并为同一条 assistant
// 的 content blocks，或者让 buildLlmMessages 直接生成 block 列表）。

import type { CopilotMessage, CopilotContextRef } from './types'
import type { LlmMessage } from '../llm-client'
import { resolveContexts, formatContextsForLlm } from './resolve-context'

export const COPILOT_SYSTEM_PROMPT = `You are Evalyst Copilot, a helpful assistant embedded in the Evalyst LLM evaluation platform.
You help users analyze experiment results, debug prompts, and iterate on evaluations.
Respond in the user's language — if they write in Chinese, reply in Chinese; if English, reply in English.
Be concise and specific; prefer code or concrete examples over abstract advice.
When the user has shared context (圈选的对象，以 <context tag="N" ...> 标注), refer to them by their tag number in your answer (例如 "根据你圈的 #1 这个实验..."). Never fabricate data that wasn't shared.`

export function buildLlmMessages(branch: CopilotMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  // 把当前分支最后一条 user 消息挂的 contexts 渲染成第二条 system message。
  // 历史 user 消息可能有 contexts，但那是旧状态，不再重放。
  const lastUser = [...branch].reverse().find(m => m.role === 'user')
  if (lastUser?.contexts && lastUser.contexts.length > 0) {
    const resolved = resolveContexts(lastUser.contexts as CopilotContextRef[])
    const ctxText = formatContextsForLlm(resolved)
    if (ctxText) {
      out.push({ role: 'system', content: ctxText })
    }
  }

  for (const m of branch) {
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
      })
    } else if (m.role === 'tool_result') {
      if (!m.call_id) continue
      out.push({
        role: 'tool_result',
        call_id: m.call_id,
        // content 已在 /tool-result route 里 JSON.stringify 过（denied / error / 正常结果都走同一字段）
        content: m.content,
      })
    }
  }
  return out
}
