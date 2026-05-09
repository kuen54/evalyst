// Copilot v2 tool runtime：主入口 runTool。
// 串 pre 链 → tool.call → post 链。caller（/chat / /tool-result route）
// 按返回 kind dispatch。

import type { ToolContext } from "./tools/types"
import type { AnyToolDescriptor } from "./tools/registry"
import type { ToolError, ToolResult } from "./tools/tool-result"
import { preToolCallHooks, postToolCallHooks } from "./tools/hooks"

// ---- 主入口 runTool ----
//
// 串 pre 链 → tool.call → post 链。pre 链上一旦遇到 require_confirm / deny
// 立即短路，不执行 tool。caller（/chat / /tool-result route）按返回 kind dispatch。
// skipConfirm = true 绕过 pre 链（/tool-result route 里用户 Confirm 后再次 run，
// 避免 confirmGateHook 再次要 confirm 陷入死锁）。
//
// v2.5 P2: 加 'error' kind。tool throw 兜底成 INTERNAL error；tool 显式 return
// { ok: false, error } 透传 ToolError；ok shape unwrap value 后走 done。
//
// v2.5 P3: 'denied' kind 收敛进 'error'（USER_DENIED ToolError）。caller 不再
// 区分 deny 与 error 两条 dispatch 分支，统一走 ToolError shape。

export type RunToolResult =
  | { kind: "done"; output: unknown }
  | { kind: "awaiting_confirm" }
  | { kind: "error"; error: ToolError }

function isToolResultShape(value: unknown): value is ToolResult<unknown> {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  // 严格识别 ok/err shape：避免把 { ok: 1 } 这种 legacy raw output 误判
  if (obj.ok === true && "value" in obj) return true
  if (obj.ok === false && typeof obj.error === "object" && obj.error !== null) return true
  return false
}

export async function runTool(
  tool: AnyToolDescriptor,
  input: unknown,
  ctx: ToolContext,
  opts: { skipConfirm?: boolean; sessionAllowList?: string[]; sessionDenyList?: string[] } = {},
): Promise<RunToolResult> {
  if (!opts.skipConfirm) {
    for (const hook of preToolCallHooks) {
      const r = await hook({
        tool,
        input,
        session_id: ctx.session_id,
        session_allow_list: opts.sessionAllowList,
        session_deny_list: opts.sessionDenyList,
      })
      if (r.action === "deny") {
        return {
          kind: "error",
          error: {
            code: "USER_DENIED",
            message: r.reason,
            retry_safe: false,
          },
        }
      }
      if (r.action === "require_confirm") return { kind: "awaiting_confirm" }
    }
  }

  // v2.5 P2: 兜底 throw → INTERNAL error，不让 caller 自己 try/catch
  let raw: unknown
  try {
    raw = await tool.call(input, ctx)
  } catch (e) {
    return {
      kind: "error",
      error: {
        code: "INTERNAL",
        message: e instanceof Error ? e.message : String(e),
        retry_safe: false,
      },
    }
  }

  // v2.5 P2: 检测新 ToolResult 形态，unwrap value 或冒 error
  let output: unknown = raw
  if (isToolResultShape(raw)) {
    if (raw.ok === false) return { kind: "error", error: raw.error }
    output = raw.value
  }

  for (const hook of postToolCallHooks) {
    const r = await hook({ tool, input, output, session_id: ctx.session_id })
    output = r.output
  }
  return { kind: "done", output }
}
