// Copilot v2 hook pipeline。两条 hook 链：
//   pre  → 在 tool.call 之前跑（Confirm gate / audit log / 未来权限检查挂这里）
//   post → 在 tool.call 之后跑（落盘护栏 / 遥测）
//
// 合流简化自 claude-code-best `useCanUseTool` + openclaw `before-tool-call` /
// `after-tool-call`。不做 CCB 的四源权限矩阵、openclaw 的 availability 表达式；
// 当前规模 pre 链 2 条 / post 链 2 条即可，新增挂载位到时再加。

import type { AnyToolDescriptor } from "./registry"
import { maybePersistToolResult } from "../tool-result-store"
import { isSessionAllowed, isSessionDenied } from "../session-allow"
import type { ImageRef } from "../types"

interface PreToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  session_id: string
  /** v2.5 §8: per-request 的会话级信任列表（客户端 sessionStorage → body → hook） */
  session_allow_list?: string[]
  /** v2.5 P0 §3.3: per-request 的会话级拒绝列表。优先级高于 allow，先于默认 confirm 判定。 */
  session_deny_list?: string[]
}

type PreToolCallResult =
  | { action: "proceed" }
  | { action: "require_confirm" }
  | { action: "deny"; reason: string }

type PreToolCallHook = (ctx: PreToolCallCtx) => Promise<PreToolCallResult>

interface PostToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  output: unknown
  session_id: string
}

type PostToolCallResult = { output: unknown }
type PostToolCallHook = (ctx: PostToolCallCtx) => Promise<PostToolCallResult>

// ---- 内置 hooks ----

/**
 * Confirm gate：读 metadata 决定是否要用户确认。
 * 规则：`requiresConfirm` 显式覆盖；否则跟 `isDestructive`。
 * v2.5 §8：若 session_allow_list 含 tool.name 则短路直接 proceed（用户已在该 session 勾选"信任此工具"）。
 * v2.5 P0 §3.3：若 session_deny_list 含 tool.name 则直接 deny（防越权，优先级最高）。
 *   优先级：deny > allow > 默认 confirm。
 */
export const confirmGateHook: PreToolCallHook = async ({ tool, session_allow_list, session_deny_list }) => {
  // v2.5 P0 §3.3: deny 优先级最高（防越权），先于 allow。
  if (isSessionDenied(session_deny_list, tool.name)) {
    return { action: "deny", reason: "user-denied for this session" }
  }
  if (isSessionAllowed(session_allow_list, tool.name)) {
    return { action: "proceed" }
  }
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}

/** Audit 占位，当前 no-op；未来串 structured log / 审计表 */
const auditLogHook: PreToolCallHook = async () => ({ action: "proceed" })

/**
 * 检测 tool 返回的 output 是否带 `_attachments: ImageRef[]`。命中即剥离并返还。
 * 仅对 plain-object output 生效；非对象 / `_attachments` 非 array 时按"无 attachments"处理。
 * 注意：`runTool` 已 unwrap `ToolResult`，所以这里看到的 `output` 是 tool.call 返回的
 * 内层 value（e.g. `{results, _attachments}`），不是 `{ok:true, value:{...}}`。
 */
function liftAttachments(output: unknown): { value: unknown; attachments: ImageRef[] | undefined } {
  if (output === null || typeof output !== "object") {
    return { value: output, attachments: undefined }
  }
  const obj = output as Record<string, unknown>
  if (!Array.isArray(obj._attachments)) {
    return { value: output, attachments: undefined }
  }
  const { _attachments, ...rest } = obj
  return { value: rest, attachments: _attachments as ImageRef[] }
}

/**
 * Payload guard：tool 返回后把 output 经 maybePersistToolResult 压成 ToolResultContent
 * (inline | ref)。caller 拿到的 output 就是 ToolResultContent 形态，可以直接
 * JSON.stringify 到 tool_result 消息 content 字段 —— 不用再区分"裸 output vs 封装"。
 *
 * Image vision §4.5：先 lift `_attachments`（如有），再走 maybePersistToolResult。
 * 这样落盘的 inner value 不带 `_attachments`（避免 base64 路径名串撑大），
 * wrapper 上挂 `attachments` 让 build-llm-messages 后续 collectImageRefs 能识别。
 */
export const payloadGuardHook: PostToolCallHook = async ({ tool, output, session_id }) => {
  const { value, attachments } = liftAttachments(output)
  const wrapped = await maybePersistToolResult(session_id, value, tool.metadata.maxResultSizeChars)
  if (attachments && attachments.length > 0 && wrapped.kind !== "compacted") {
    // ToolResultContent.inline / .ref 都接受 attachments?: ImageRef[]
    ;(wrapped as { attachments?: ImageRef[] }).attachments = attachments
  }
  return { output: wrapped }
}

/** Telemetry 占位，当前直通 output；未来串指标 / trace */
const telemetryHook: PostToolCallHook = async ({ output }) => ({ output })

export const preToolCallHooks: PreToolCallHook[] = [confirmGateHook, auditLogHook]
export const postToolCallHooks: PostToolCallHook[] = [payloadGuardHook, telemetryHook]
