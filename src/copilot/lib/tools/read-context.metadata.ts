import type { ToolMetadataDescriptor } from "./types"
import type { ContextScope } from "../resolve-context"

export interface ReadContextInput {
  id: string
  scope?: ContextScope
}

export const readContextMetadata: ToolMetadataDescriptor = {
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
    // v0.18.7 G3: 4000→12000。parent scope 拉整条 task 经常超 4KB；read_tool_result
    // skipPayloadGuard 后过限不再死循环，12000 让常规查询直接 inline 省一轮 round-trip。
    maxResultSizeChars: 12000,
  },
}
