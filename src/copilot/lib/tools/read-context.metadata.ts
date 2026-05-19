import type { ToolMetadataDescriptor } from "./types"
import type { ContextScope } from "../resolve-context"

export interface ReadContextInput {
  id: string
  scope?: ContextScope
}

export const readContextMetadata: ToolMetadataDescriptor = {
  name: "read_context",
  description:
    // v0.18.21 audit PR-3：从 passive description 改成动词驱动 + trigger phrase。
    // 之前 'Fetch details of a user-circled context chip'，LLM 没收到"WHEN to call this"
    // 的明确信号——session 30cqfqrfxv 实证：LLM 直接 read_page 找而不是 read_context。
    "PRIMARY tool when the user references circled contexts. Trigger phrases: 'these results', 'this experiment', '#N' (chip number), '两个结果', '圈选的', any pronoun ('this', 'that') pointing at chips shown in the system header's active_contexts. Call this BEFORE read_page or read_experiment_results when active_contexts is non-empty. Returns the actual data the user circled, identified by ctx_N. Use scope='parent' for surrounding context — e.g. task_field's parent scope returns the whole task_result with input/output/metrics. scope='self' (default) returns just the targeted data.",
  inputSchema: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description:
          "Session-scoped chip id, e.g. 'ctx_1'. Comes from active_contexts[].id in the system header. Each user-circled chip gets a unique ctx_N.",
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
