import { loadPersistedToolResult } from "../tool-result-store"
import type { ToolDescriptor } from "./types"

interface Input {
  ref: string
}

export const readToolResultTool: ToolDescriptor<Input, unknown> = {
  name: "read_tool_result",
  description:
    "Retrieve a previously persisted tool result by its ref. Accepts either the full ref URL (ref://tool-result/tr_xxx) or bare id. Use when an earlier tool_result was spilled to disk and you need the full payload.",
  inputSchema: {
    type: "object",
    required: ["ref"],
    properties: {
      ref: {
        type: "string",
        description:
          "Ref URL 或裸 id，例如 'ref://tool-result/tr_abc123' 或 'tr_abc123'。",
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    // 回捞的 payload 通常是原始大结果；放宽到 8KB，超出仍会再次走 payloadGuard 落盘
    // （防止 read_tool_result 的结果自己又超限——这种情况 LLM 应自己用更精细的查询）。
    maxResultSizeChars: 8000,
  },
  call: async ({ ref }, ctx) => {
    if (!ref || typeof ref !== "string") throw new Error("ref is required")
    return loadPersistedToolResult(ctx.session_id, ref)
  },
}
