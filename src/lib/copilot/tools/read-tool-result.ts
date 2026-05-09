import { loadPersistedToolResult } from "../tool-result-store"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"

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
    if (!ref || typeof ref !== "string") {
      return err("INVALID_INPUT", "ref is required", {
        hint: "Pass ref as string starting with ref://",
      })
    }
    try {
      return ok(await loadPersistedToolResult(ctx.session_id, ref))
    } catch (e) {
      // ENOENT → NOT_FOUND（语义对齐 read_resource / edit_template / restart_experiment）。
      // 其他 IO / parse 错误重新 throw，让 runTool 兜底成 INTERNAL。
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return err("NOT_FOUND", `tool result ${ref} not found (may have been pruned)`, {
          hint: "Verify the ref is from a recent tool call; older refs may be evicted",
        })
      }
      throw e
    }
  },
}
