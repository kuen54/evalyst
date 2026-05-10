import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
} from '@/copilot/lib/session-store'
import { TOOLS, toolByName } from '@/copilot/lib/tools/registry'
import { visibleToolsForRoute } from '@/copilot/lib/tools/route-gating'
import { runTool } from '@/copilot/lib/tool-runtime'
import { getLlmConfig } from '@/lib/llm-config'
import type { ClientSnapshot } from '@/copilot/lib/types'
import { setSnapshot } from '@/copilot/lib/snapshot-cache'
import { runToolAwareLlmStream } from '@/copilot/lib/stream-response'
import { streamSseResponse } from '@/copilot/lib/sse-response'
import { analyzeToolLoop, type ToolLoopDecision } from '@/copilot/lib/tool-loop-detector'

/**
 * POST body：
 *   {
 *     call_id: string              // 配对待处理的 tool_use 消息
 *     tool_name: string            // 审计 + 安全检查
 *     input: Record<string, unknown>  // 用户确认的参数（通常与 LLM 原始 tool_input 一致）
 *     denied?: boolean             // true = 用户拒绝；false/undefined = 确认执行
 *     reason?: string              // 拒绝的可选原因
 *     client_snapshot?: ClientSnapshot
 *   }
 *
 * 流程：
 *   1. 校验 session / body
 *   2. Tool-loop 检测（exact-failure / same-tool / no-progress，hermes 三档阈值）
 *      → block：返 429 附 loop_reason_key/vars
 *      → warn：继续执行 + 流中 emit loop_warn 事件
 *   3. 校验 model（race fix：必须在 append 之前，避免孤儿 tool_result）
 *   4. 执行工具（或记录 denied）→ 写 tool_result 消息（parent_id = tail）
 *   5. 重新拉 branch（含本次 tool_result）→ 调 `runToolAwareLlmStream`
 *      → helper 内部做 callLlmStreaming + 累 text/tool_use + 后置顺序 append
 *      → 回到本 route 再 emit `done`
 *
 * SSE 事件（与 /chat route 对齐）：
 *   { kind: 'tool_result_message', id, content, denied?, reason? }
 *       — 服务端为 tool_result 分配的消息 id + 结果 JSON（供前端 summary 渲染）
 *   { kind: 'loop_warn', call_id, reason_key, reason_vars }
 *       — v2.5 P0 §3.4：warn 档重复检测命中（execution 继续，提醒用户可能在打转）
 *   { kind: 'text', delta }
 *   { kind: 'tool_use_start' | 'tool_use_delta' | 'tool_use_end', ... } — 转发 LLM 事件
 *   { kind: 'done', assistant_message_id?, tool_use_message_ids?, usage?, stop_reason? }
 *   { kind: 'error', message }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) return jsonError(404, 'session not found')

  const body = (await req.json().catch(() => ({}))) as {
    call_id?: string
    tool_name?: string
    input?: Record<string, unknown>
    denied?: boolean
    reason?: string
    client_snapshot?: ClientSnapshot
    /** v2.5 §8: 客户端 sessionStorage 读出的 allow list，未来 `/chat` 内直跑工具时由 confirmGateHook 消费 */
    session_allow_list?: string[]
    /** v2.5 P0 §3.3: 对称的 deny list；confirmGateHook 中 deny > allow > 默认 confirm */
    session_deny_list?: string[]
  }
  if (!body.call_id || typeof body.call_id !== 'string') return jsonError(400, 'call_id required')
  if (!body.tool_name || typeof body.tool_name !== 'string') return jsonError(400, 'tool_name required')
  if (!body.input || typeof body.input !== 'object') return jsonError(400, 'input required')

  // 缓存 client_snapshot（用于 read_page 工具 + page_context 注入）
  if (body.client_snapshot) setSnapshot(sessionId, body.client_snapshot)

  // v2.5 P0 §3.4: 从硬数步 cap 5 换成 hermes 三档重复检测（exact-failure / same-tool / no-progress）
  const branchBefore = getActiveBranch(sessionId)
  let loopWarnDecision: Extract<ToolLoopDecision, { action: "warn" }> | null = null
  if (body.denied !== true) {
    const decision = analyzeToolLoop(branchBefore, body.tool_name, body.input)
    if (decision.action === "block") {
      return new Response(
        JSON.stringify({
          error: "tool-loop blocked",
          loop_reason_key: decision.reasonKey,
          loop_reason_vars: decision.reasonVars,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      )
    }
    if (decision.action === "warn") {
      loopWarnDecision = decision  // stream start 里 emit
    }
  }

  // race fix：model 校验必须放在 appendMessage 之前，避免 model 未配置时
  // 留下孤儿 tool_result 消息在 jsonl 里。
  const cfg = getLlmConfig()
  const modelId = session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) return jsonError(400, 'copilot model not configured or not enabled')
  if (!model.base_url || !model.api_key) return jsonError(400, 'model missing base_url or api_key')

  // 本条 tool_result 的 parent 指向当前 branch 末端（通常是 hanging tool_use）
  const tailId = branchBefore[branchBefore.length - 1]?.id

  // 计算 result content
  let resultContent: unknown
  if (body.denied === true) {
    // 用户主动 deny：保留旧 jsonl 形态（{ denied:true, reason }）
    // build-llm-messages 序列化时由 isToolErrorShape 识别为 error，
    // Anthropic 序列化加 is_error: true
    resultContent = { denied: true, reason: body.reason ?? '' }
  } else {
    // 未知 tool 直接 400：客户端说谎，不该发生
    const tool = toolByName.get(body.tool_name)
    if (!tool) return jsonError(400, `unknown tool: ${body.tool_name}`)

    // v2.5 P2: runTool 兜底 throw → kind:'error' INTERNAL，不再需要外层 try/catch。
    // skipConfirm=true：用户已在 UI 点 Confirm 才走到这个 route，绕过 preToolCall 的
    // confirmGateHook 避免死锁。M3 payloadGuard 仍在 postToolCallHooks 里跑（仅 'done' 路径）。
    const r = await runTool(
      tool,
      body.input,
      { session_id: sessionId, signal: req.signal },
      {
        skipConfirm: true,
        ...(body.session_allow_list !== undefined ? { sessionAllowList: body.session_allow_list } : {}),
        ...(body.session_deny_list !== undefined ? { sessionDenyList: body.session_deny_list } : {}),
      },
    )

    if (r.kind === 'done') {
      resultContent = r.output
    } else if (r.kind === 'error') {
      // v2.5 P2/P3: tool throw / tool return err / server hook deny 统一走
      // 结构化 ToolError 形态。USER_DENIED code 由 confirmGateHook 写入。
      resultContent = { ok: false, error: r.error }
    } else {
      // skipConfirm=true 不该走到 awaiting_confirm；防御性兜底
      resultContent = {
        ok: false,
        error: {
          code: 'AWAITING_CONFIRM' as const,
          message: 'unexpected: tool awaiting confirm in /tool-result route',
          retry_safe: false,
        },
      }
    }
  }

  // 落盘 tool_result 消息
  const toolResultMsg = appendMessage({
    session_id: sessionId,
    role: 'tool_result',
    content: JSON.stringify(resultContent),
    call_id: body.call_id,
    tool_name: body.tool_name,
    ...(body.denied !== undefined ? { denied: body.denied } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(tailId !== undefined ? { parent_id: tailId } : {}),
  })

  // 重新拉 branch（含刚 append 的 tool_result）
  const branch = getActiveBranch(sessionId, toolResultMsg.id)

  // 初始事件：tool_result_message 回填（让 ToolCallCard.summarizeResult 能渲出
  // "5/12" 摘要）+ 可选 loop_warn（warn 档命中时通知前端，但仍继续执行）。
  const initialEvents: unknown[] = [
    {
      kind: 'tool_result_message',
      id: toolResultMsg.id,
      content: JSON.stringify(resultContent),
      denied: body.denied,
      reason: body.reason,
    },
  ]
  if (loopWarnDecision) {
    initialEvents.push({
      kind: 'loop_warn',
      call_id: body.call_id,
      reason_key: loopWarnDecision.reasonKey,
      reason_vars: loopWarnDecision.reasonVars,
    })
  }

  return streamSseResponse({
    initialEvents,
    runner: async (write) => {
      const pageContext = body.client_snapshot?.page_context ?? null
      const result = await runToolAwareLlmStream({
        sessionId,
        branch,
        model,
        tools: visibleToolsForRoute(TOOLS, pageContext?.route_type ?? null),
        pageContext,
        startParentId: toolResultMsg.id,
        signal: req.signal,
        write,
      })
      // helper 已保证 assistant / tool_use 落盘先于这里 emit done
      write({
        kind: 'done',
        assistant_message_id: result.assistantMessageId,
        tool_use_message_ids: result.toolUseMessageIds,
        usage: result.usage,
        stop_reason: result.stopReason,
      })
    },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
