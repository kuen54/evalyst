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
    // parent scope 可能带整条 task 出来，4KB 给缓冲；超出走 payloadGuard 落盘
    maxResultSizeChars: 4000,
  },
}
