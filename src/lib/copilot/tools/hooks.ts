// Copilot v2 hook pipeline。两条 hook 链：
//   pre  → 在 tool.call 之前跑（Confirm gate / audit log / 未来权限检查挂这里）
//   post → 在 tool.call 之后跑（落盘护栏 / 遥测）
//
// 合流简化自 claude-code-best `useCanUseTool` + openclaw `before-tool-call` /
// `after-tool-call`。不做 CCB 的四源权限矩阵、openclaw 的 availability 表达式；
// 当前规模 pre 链 2 条 / post 链 2 条即可，新增挂载位到时再加。

import type { AnyToolDescriptor } from "./registry"
import { maybePersistToolResult } from "../tool-result-store"
import { isSessionAllowed } from "../session-allow"

export interface PreToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  session_id: string
  /** v2.5 §8: per-request 的会话级信任列表（客户端 sessionStorage → body → hook） */
  session_allow_list?: string[]
}

export type PreToolCallResult =
  | { action: "proceed" }
  | { action: "require_confirm" }
  | { action: "deny"; reason: string }

export type PreToolCallHook = (ctx: PreToolCallCtx) => Promise<PreToolCallResult>

export interface PostToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  output: unknown
  session_id: string
}

export type PostToolCallResult = { output: unknown }
export type PostToolCallHook = (ctx: PostToolCallCtx) => Promise<PostToolCallResult>

// ---- 内置 hooks ----

/**
 * Confirm gate：读 metadata 决定是否要用户确认。
 * 规则：`requiresConfirm` 显式覆盖；否则跟 `isDestructive`。
 * v2.5 §8：若 session_allow_list 含 tool.name 则短路直接 proceed（用户已在该 session 勾选"信任此工具"）。
 */
export const confirmGateHook: PreToolCallHook = async ({ tool, session_allow_list }) => {
  if (isSessionAllowed(session_allow_list, tool.name)) {
    return { action: "proceed" }
  }
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}

/** Audit 占位，当前 no-op；未来串 structured log / 审计表 */
export const auditLogHook: PreToolCallHook = async () => ({ action: "proceed" })

/**
 * Payload guard：tool 返回后把 output 经 maybePersistToolResult 压成 ToolResultContent
 * (inline | ref)。caller 拿到的 output 就是 ToolResultContent 形态，可以直接
 * JSON.stringify 到 tool_result 消息 content 字段 —— 不用再区分"裸 output vs 封装"。
 */
export const payloadGuardHook: PostToolCallHook = async ({ tool, output, session_id }) => {
  const wrapped = await maybePersistToolResult(session_id, output, tool.metadata.maxResultSizeChars)
  return { output: wrapped }
}

/** Telemetry 占位，当前直通 output；未来串指标 / trace */
export const telemetryHook: PostToolCallHook = async ({ output }) => ({ output })

export const preToolCallHooks: PreToolCallHook[] = [confirmGateHook, auditLogHook]
export const postToolCallHooks: PostToolCallHook[] = [payloadGuardHook, telemetryHook]
