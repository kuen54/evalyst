import type { ToolMetadataDescriptor } from "./types"

export interface ReadToolResultInput {
  ref: string
}

export const readToolResultMetadata: ToolMetadataDescriptor = {
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
    // 回捞型工具：契约就是把已落盘 payload 原样返出，不能再走 ref 化（ref→ref 死循环）。
    // skipPayloadGuard 让 payloadGuardHook 强制 inline；maxResultSizeChars 此时被忽略，
    // 但保留是因为 ToolMetadata 类型要求；设个大值避免后续若有改动误触发。
    maxResultSizeChars: Number.MAX_SAFE_INTEGER,
    skipPayloadGuard: true,
  },
}
