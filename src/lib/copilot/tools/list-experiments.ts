import { listExperiments } from "@/lib/store"
import type { ToolDescriptor } from "./types"

interface Input {
  status?: "draft" | "running" | "paused" | "completed" | "failed"
  schema_id?: string
  limit?: number
}

interface Output {
  experiments: Array<{
    id: string
    name: string
    model: string
    status: string
    schema_id?: string
    completed_tasks: number
    total_tasks: number
    failed_tasks: number
  }>
  total_matching: number
  returned: number
}

export const listExperimentsTool: ToolDescriptor<Input, Output> = {
  name: "list_experiments",
  description:
    "列出平台上的实验，可按 status / schema_id 过滤。用于发现用户没圈选的相关实验。",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed"] },
      schema_id: { type: "string", description: "按评测任务 ID 过滤" },
      limit: { type: "number", description: "最多返回多少条，上限 50" },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 2000,
  },
  call: async (input) => {
    const all = listExperiments()
    let filtered = all
    if (input.status) filtered = filtered.filter((e) => e.status === input.status)
    if (input.schema_id) filtered = filtered.filter((e) => e.schema_id === input.schema_id)
    const limit = Math.min(Number(input.limit ?? 20), 50)
    return {
      experiments: filtered.slice(0, limit).map((e) => ({
        id: e.id,
        name: e.name,
        model: e.model,
        status: e.status,
        ...(e.schema_id !== undefined ? { schema_id: e.schema_id } : {}),
        completed_tasks: e.run_stats?.completed_tasks ?? 0,
        total_tasks: e.run_stats?.total_tasks ?? 0,
        failed_tasks: e.run_stats?.failed_tasks ?? 0,
      })),
      total_matching: filtered.length,
      returned: Math.min(filtered.length, limit),
    }
  },
}
