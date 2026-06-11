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

import type { CopilotMessage, CopilotContextRef, ImageRef } from './types'
import type { LlmMessage } from '@/lib/llm-client'
import { normalizeToolResult, appendCompactBoundary } from './session-store'
import { buildSystemHeader } from './system-header'
import { microCompact } from './micro-compact'
import { sliceAfterBoundary } from './boundary'
import { isToolErrorShape } from './tools/tool-result'
import { collectImageRefs, readImageBytes, MAX_IMAGES_PER_TURN } from './image-attach'
import type { TaskSchema } from '@/lib/schema/types'

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

When the user circles context, refer to it by its chip tag ("根据你圈的 #1 这个实验...").

ANTI-FABRICATION RULES (strict):
1. NEVER invent specific values — model names (e.g. "claude-sonnet-4-…"), schema_ids, experiment ids, dataset ids, prompt template content, or any concrete data. If you haven't seen a value verbatim in a tool_result earlier in THIS transcript, you don't know it.
2. If a tool response includes \`_warning.unknown_fields\`, the field names you asked for don't exist on this resource. STOP. Re-read the response's \`available_fields\` and call the tool again with valid names. NEVER fill the gap with plausible-sounding data.
3. If the tool returned fewer fields than you requested (and there's no \`_warning\`), some fields are simply null/empty on this resource — say "this experiment doesn't have X recorded" rather than guessing.
4. When uncertain, prefer "I need to check that" + another tool call over a confident-sounding fabrication. Users penalize wrong concrete claims much harder than over-cautious phrasing.`

/**
 * 把 collectImageRefs 输出（仍是 ImageRef[]）落成发给 LLM 的 ContentBlock[]：
 * - 每个 ref 调 readImageBytes（disk → base64 / data URL passthrough / error）
 * - 失败的 ref 退化为 text 块（"[Image unavailable: <reason>]"），不阻塞流程
 * - 块顺序：[text("[Image #N · src_label]"), image_url, ...]
 *
 * Task 8 只产出 plan；splicing 在 Task 9 / 10 / 11 完成。
 */
interface ImagePlan {
  user_blocks: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  tool_blocks_by_call_id: Map<string, Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>>
  system_notes: string[]
  hadImageRefs: boolean
}

async function refsToBlocks(
  refs: ImageRef[],
): Promise<Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>> {
  const blocks: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
  for (const r of refs) {
    const tagPart = r.ctx_tag !== undefined ? `#${r.ctx_tag} · ` : ''
    const label = `[Image ${tagPart}${r.source_label}]`
    const bytes = await readImageBytes(r)
    if ('error' in bytes) {
      blocks.push({ type: 'text', text: `${label} (unavailable: ${bytes.error})` })
      continue
    }
    blocks.push({ type: 'text', text: label })
    blocks.push({ type: 'image_url', image_url: { url: bytes.data_url } })
  }
  return blocks
}

async function materializeImagePlan(
  branch: CopilotMessage[],
  modelVisionCapable: boolean,
): Promise<ImagePlan> {
  // 即使 model 不支持 vision 也要 collectImageRefs 一次（强行收集）来知道 hadImageRefs
  // —— 这是 Task 11 strip-note 提示语依据。
  const probed = collectImageRefs({
    branch,
    schemaCache: new Map<string, TaskSchema>(),
    modelVisionCapable: true,
  })
  const hadImageRefs =
    probed.user_image_refs.length > 0 ||
    Array.from(probed.tool_image_refs.values()).some((arr) => arr.length > 0)

  if (!modelVisionCapable) {
    const system_notes: string[] = []
    if (hadImageRefs) {
      system_notes.push('[Image attachments dropped: model not vision_capable]')
    }
    return {
      user_blocks: [],
      tool_blocks_by_call_id: new Map(),
      system_notes,
      hadImageRefs,
    }
  }

  const user_blocks = await refsToBlocks(probed.user_image_refs)
  // v1 选项 A（2026-05-09 brainstorm 决策）：工具返回的图暂不进 LLM。
  // 原因：sankuai OpenAI-compat 拒绝 image_url in tool role（Task 0 finding），
  // 而 Anthropic 的 user/assistant alternation 又不允许在 tool_result 后追加
  // user 消息。第一版只支持用户主动圈选这条路；用户圈选触达 user_image_refs 路径。
  // 等 sankuai 解禁或我们做 provider-specific 分支时，把这个循环加回来即可：
  //   for (const [callId, refs] of probed.tool_image_refs.entries()) {
  //     const blocks = await refsToBlocks(refs)
  //     if (blocks.length > 0) tool_blocks_by_call_id.set(callId, blocks)
  //   }
  const tool_blocks_by_call_id = new Map<string, ImagePlan['user_blocks']>()
  const system_notes: string[] = []
  if (probed.dropped_count > 0) {
    system_notes.push(
      `${probed.dropped_count} image(s) not attached (per-turn cap is ${MAX_IMAGES_PER_TURN})`,
    )
  }
  return { user_blocks, tool_blocks_by_call_id, system_notes, hadImageRefs }
}

export async function buildLlmMessages(
  branch: CopilotMessage[],
  pageContext?: import('./types').PageContext | null,
  opts?: { sessionId?: string; modelVisionCapable?: boolean },
): Promise<LlmMessage[]> {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  // v2.5 §5.4: 找最近 boundary，之前的消息不参与本轮组装
  const usable = sliceAfterBoundary(branch)

  // 当前分支最后一条 user 消息挂的 contexts 渲染成 SystemHeader 并塞第二条 system message。
  // 历史 user 消息可能有 contexts，但那是旧状态，不再重放。
  const lastUser = [...usable].reverse().find((m) => m.role === 'user')

  // image-vision §3.1: 预先 materializeImagePlan —— Task 9/10 复用 imageMap 决定 user / tool_result
  // 是否走多模态 content array；Task 11 用 imageMap.hadImageRefs + modelVisionCapable 决定加 strip note。
  const imageMap = await materializeImagePlan(usable, opts?.modelVisionCapable === true)

  const refs = (lastUser?.contexts ?? []) as CopilotContextRef[]
  const header = buildSystemHeader({
    ...(pageContext?.route_type !== undefined ? { route_type: pageContext.route_type } : {}),
    ...(pageContext?.path !== undefined ? { path: pageContext.path } : {}),
    ...(pageContext !== null && pageContext !== undefined ? { page_context: pageContext } : {}),
    contexts: refs,
    // v0.18.19 PR-1：summary 含 experiment_id 等区分字段——之前 ctx_1/ctx_2 都是
    // "task_result box:108"（同 box 不同 experiment 时无差别），LLM 看不出是用户想"对比"
    // 的两个不同 experiment 的同位置结果。
    summarize: (r) => {
      const extra = (r.extra ?? {}) as Record<string, unknown>
      const exp = extra.experiment_id
      if (typeof exp === "string" && exp.length > 0) {
        return `${r.type} ${r.id} in ${exp}`
      }
      return `${r.type} ${r.id}`
    },
    // v1 → v2 转场：不做 inline 预解（异步 + fs 依赖），一律 ref-only。
    // LLM 看到 ctx_N 后按需 read_context 拉详情。后续可按遥测决定是否加
    // resolveInline（同步读少量资源，仅小 payload 时塞 inline）。
  })
  if (refs.length > 0 || pageContext) {
    // v0.18.19 PR-1：硬指令前缀——之前是 passive "Session context (JSON):"，LLM 把
    // active_contexts 当背景信息读，结果它选了它最熟的 read_page 而不是 read_context。
    // session 30cqfqrfxv 实证：用户圈了 box:108×2，LLM 0 次 read_context，
    // 直接 read_page 然后猜 box:1 死磕 34 轮。
    const directive = refs.length > 0
      ? 'User has circled the following contexts (UI chips #1, #2, …). When the user references them — by phrases like "these results", "this experiment", "#N", "两个结果", "圈选的", or any pronoun pointing at the chips — you MUST call `read_context(id=ctx_N)` FIRST, before any other tool. Each context\'s `id` field is the exact argument to read_context.\n\nSession context (JSON):\n'
      : 'Session context (JSON):\n'
    out.push({
      role: 'system',
      content: directive + JSON.stringify(header, null, 2),
    })
  }

  // image-vision §4.4: 把 imageMap.system_notes（dropped_count 提示 / vision-strip 提示）
  // 合并成一条 system 消息塞在 SystemHeader 之后。两类提示理论上互斥（strip 路径短路了 dropped_count
  // 计算），但 join('\n') 形态对 future-proofing 友好。
  if (imageMap.system_notes.length > 0) {
    out.push({
      role: 'system',
      content: imageMap.system_notes.join('\n'),
    })
  }

  // v2 §5.6 + v2.5 §4.2: 进入 transcript 迭代前先 microCompact —— 把老的可重放 tool_result
  // 压成 summary，保最近 N 条原样。LLM 如需详情走 read_tool_result(ref)。
  // maxTotalReplayableTokens 防御 3 条 read_context 各 5KB 的累加（单条不超
  // maxResultSizeChars 也可能合计 15KB+）。
  const { messages: compacted, didCompact } = microCompact(usable, {
    keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
    maxTotalReplayableTokens: 4000,
  })

  // v2.5 §5.3: 只在生产（有 sessionId）且实际压缩时落 boundary。
  // 测试调 buildLlmMessages 不传 opts → 保持纯函数语义，无副作用。
  if (didCompact && opts?.sessionId) {
    appendCompactBoundary(opts.sessionId, { reason: 'micro-compact' })
  }

  for (const m of compacted) {
    // v2.5 §5: system 消息（含 boundary）不进 LlmMessages
    if (m.role === 'system') continue
    if (m.role === 'user') {
      // image-vision §4.4: 仅当当前 m 是最后一条 user 且 imageMap 有 user_blocks 时,
      // 把 user 内容升级为多模态 content array。块顺序：[(text+image_url) × N, text(原 user content)]。
      // m.content 为空字符串时仍 push 一条空 text 块，避免 Anthropic 拒绝 image-only content array。
      if (m === lastUser && imageMap.user_blocks.length > 0) {
        out.push({
          role: 'user',
          content: [
            ...imageMap.user_blocks,
            { type: 'text', text: m.content },
          ],
        })
      } else {
        out.push({ role: 'user', content: m.content })
      }
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
      // v2.5 P2: inline kind 检测 isToolErrorShape → 标记 is_error 让 Anthropic 序列化透传协议字段。
      // ref / compacted 形态没法判 error（只有 preview / summary 字符串），保守 false。
      const parsed = normalizeToolResult(m.content)
      let visible: string
      let isError = false
      if (parsed.kind === 'inline') {
        visible = JSON.stringify(parsed.value ?? null)
        if (isToolErrorShape(parsed.value)) isError = true
      } else if (parsed.kind === 'ref') {
        visible = `${parsed.preview}\n\n[Full result available via read_tool_result(ref="${parsed.ref}")]`
      } else {
        visible = parsed.summary
      }
      out.push({
        role: 'tool_result',
        call_id: m.call_id,
        content: visible,
        ...(isError ? { is_error: true } : {}),
      })
    }
  }
  return fillOrphanToolResults(out)
}

/**
 * 防御兜底：给没有匹配 tool_result 的孤儿 tool_use 紧随其后补一条合成 error
 * tool_result，保证发给 provider 的链恒完整。
 *
 * 孤儿的来源：stream-response 的 mid-stream `error` 事件（网络断 / SSE 畸形）
 * 不触发 abort 守卫（race fix #6 只看 p.signal.aborted），已 buffer 的 tool_use
 * 照常落盘；若客户端 auto-run 此后没把 tool_result POST 回来（confirm 类工具、
 * 切 session、POST 自身失败），下一条 user 消息会直接挂在孤儿后面。Anthropic
 * 对 "assistant tool_use 后必须紧跟 user tool_result" 强校验，孤儿会让该 session
 * 后续每次请求都 400，整个会话被钉死 —— 在序列化层兜底比在落盘层修保险：
 * 落盘层跳过 append 会反过来破坏 read 类工具 auto-run 的自愈路径。
 */
export function fillOrphanToolResults(messages: LlmMessage[]): LlmMessage[] {
  const answered = new Set<string>()
  for (const m of messages) {
    if (m.role === 'tool_result') answered.add(m.call_id)
  }
  const hasOrphan = messages.some((m) => m.role === 'tool_use' && !answered.has(m.call_id))
  if (!hasOrphan) return messages

  const filled: LlmMessage[] = []
  for (const m of messages) {
    filled.push(m)
    if (m.role === 'tool_use' && !answered.has(m.call_id)) {
      filled.push({
        role: 'tool_result',
        call_id: m.call_id,
        content: JSON.stringify({
          ok: false,
          error: { code: 'INTERNAL', message: 'tool call interrupted before a result was recorded (stream error)' },
        }),
        is_error: true,
      })
    }
  }
  return filled
}
