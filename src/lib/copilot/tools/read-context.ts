import { resolveContextById } from "../resolve-context"
import type { ContextScope } from "../resolve-context"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"

interface Input {
  id: string
  scope?: ContextScope
}

function defaultScope(_type: string): ContextScope {
  // 当前所有 type 默认 self；真正需要 parent 的场景让 LLM 明示
  // （spec §5.10.4 表：未来按 type 区分，现在保守为 self）
  return "self"
}

export const readContextTool: ToolDescriptor<Input, unknown> = {
  name: "read_context",
  description:
    "Fetch details of a user-circled context chip by its session-scoped id (ctx_N from system header). Use scope='parent' for surrounding context — e.g. task_field's parent scope returns the whole task_result with input/output/metrics. scope='self' (default) returns just the targeted data.",
  inputSchema: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description:
          "Session-scoped chip id, e.g. 'ctx_1'. Comes from active_contexts[].id in the system header.",
      },
      scope: {
        type: "string",
        enum: ["self", "parent", "full"],
        description: "self = just the targeted object/field. parent = include surrounding data. full = reserved.",
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    // parent scope 可能带整条 task 出来，4KB 给缓冲；超出走 payloadGuard 落盘
    maxResultSizeChars: 4000,
  },
  call: async ({ id, scope }, ctx) => {
    if (!id || typeof id !== "string") {
      return err("INVALID_INPUT", "id is required", {
        hint: 'Pass id like "ctx_1" referring to active_contexts[]',
      })
    }
    const r = resolveContextById(ctx.session_id, id)
    if (!r) {
      return err("NOT_FOUND", `context ${id} not found in current session`, {
        hint: "Check active_contexts list in system header",
      })
    }
    const useScope = scope ?? defaultScope(r.type)
    if (useScope === "self") return ok(r.self_value)
    if (useScope === "parent") return ok(r.parent_value ?? r.self_value)
    // full 当前语义等价 parent
    return ok(r.full_value ?? r.parent_value ?? r.self_value)
  },
}
