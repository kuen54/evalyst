// Copilot v2 tool runtime：主入口 runTool + JSON 语义截断 util。
// truncateJsonSemantic 来自 hermes-agent `_truncate_tool_call_args_json`：
// 递归把字符串字段裁到上限，防止 LLM 产出过长参数把 provider 拒掉。

import type { ToolContext } from "./tools/types"
import type { AnyToolDescriptor } from "./tools/registry"
import { preToolCallHooks, postToolCallHooks } from "./tools/hooks"

export function truncateJsonSemantic(obj: unknown, maxFieldChars: number): unknown {
  if (typeof obj === "string") {
    return obj.length > maxFieldChars
      ? obj.slice(0, maxFieldChars) + "...(truncated)"
      : obj
  }
  if (Array.isArray(obj)) return obj.map((x) => truncateJsonSemantic(x, maxFieldChars))
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateJsonSemantic(v, maxFieldChars),
      ]),
    )
  }
  return obj
}

// ---- 主入口 runTool ----
//
// 串 pre 链 → tool.call → post 链。pre 链上一旦遇到 require_confirm / deny
// 立即短路，不执行 tool。caller（/chat / /tool-result route）按返回 kind dispatch。
// skipConfirm = true 绕过 pre 链（/tool-result route 里用户 Confirm 后再次 run，
// 避免 confirmGateHook 再次要 confirm 陷入死锁）。

export type RunToolResult =
  | { kind: "done"; output: unknown }
  | { kind: "awaiting_confirm" }
  | { kind: "denied"; reason: string }

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
      if (r.action === "deny") return { kind: "denied", reason: r.reason }
      if (r.action === "require_confirm") return { kind: "awaiting_confirm" }
    }
  }

  let output = await tool.call(input, ctx)
  for (const hook of postToolCallHooks) {
    const r = await hook({ tool, input, output, session_id: ctx.session_id })
    output = r.output
  }
  return { kind: "done", output }
}
