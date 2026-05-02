// Copilot v2 hook pipeline。两条 hook 链：
//   pre  → 在 tool.call 之前跑（Confirm gate / audit log / 未来权限检查挂这里）
//   post → 在 tool.call 之后跑（落盘护栏 / 遥测）
//
// 合流简化自 claude-code-best `useCanUseTool` + openclaw `before-tool-call` /
// `after-tool-call`。不做 CCB 的四源权限矩阵、openclaw 的 availability 表达式；
// 当前规模 pre 链 2 条 / post 链 1 条即可，新增挂载位到时再加。

import type { AnyToolDescriptor } from "./registry"

export interface PreToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  session_id: string
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
 */
export const confirmGateHook: PreToolCallHook = async ({ tool }) => {
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}

/** Audit 占位，当前 no-op；未来串 structured log / 审计表 */
export const auditLogHook: PreToolCallHook = async () => ({ action: "proceed" })

/** Telemetry 占位，当前直通 output；未来串指标 / trace */
export const telemetryHook: PostToolCallHook = async ({ output }) => ({ output })

export const preToolCallHooks: PreToolCallHook[] = [confirmGateHook, auditLogHook]
export const postToolCallHooks: PostToolCallHook[] = [telemetryHook]
