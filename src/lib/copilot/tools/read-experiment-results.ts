import { readResults } from "@/lib/store"
import type { ToolDescriptor } from "./types"

interface Input {
  experiment_id: string
  task_ids?: string[]
  status?: "success" | "error" | "parse_error"
  limit?: number
}

export const readExperimentResultsTool: ToolDescriptor<Input, unknown> = {
  name: "read_experiment_results",
  description:
    "读取某个实验的 task 结果，可按 task_id 列表或 status 过滤。用于扫描失败样本或提取特定结果。",
  inputSchema: {
    type: "object",
    required: ["experiment_id"],
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["success", "error", "parse_error"] },
      limit: { type: "number" },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,
  },
  call: async (input) => {
    if (!input.experiment_id) throw new Error("experiment_id is required")
    const all = readResults(String(input.experiment_id))
    let filtered = all
    if (Array.isArray(input.task_ids) && input.task_ids.length) {
      const set = new Set(input.task_ids)
      filtered = filtered.filter((r) => set.has(r.task_id))
    }
    if (input.status) filtered = filtered.filter((r) => r.status === input.status)
    const limit = Math.min(Number(input.limit ?? 20), 50)
    return {
      results: filtered.slice(0, limit),
      total_matching: filtered.length,
      returned: Math.min(filtered.length, limit),
      truncated: filtered.length > limit,
    }
  },
}
