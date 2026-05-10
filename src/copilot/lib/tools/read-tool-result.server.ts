import { loadPersistedToolResult } from "../tool-result-store"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import {
  readToolResultMetadata,
  type ReadToolResultInput,
} from "./read-tool-result.metadata"

export const readToolResultTool: ToolDescriptor<ReadToolResultInput, unknown> = {
  ...readToolResultMetadata,
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
