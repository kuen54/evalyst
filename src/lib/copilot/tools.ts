import { listExperiments, getExperiment, readResults } from "@/lib/store"
import { startBatch } from "@/lib/batch-runner"

export interface CopilotToolContext {
  sessionId: string
}

export interface CopilotTool {
  name: string
  description: string
  input_schema: {
    type: "object"
    required?: string[]
    properties: Record<string, unknown>
  }
  requiresConfirm: boolean
  run: (input: Record<string, unknown>, ctx: CopilotToolContext) => Promise<unknown>
}

export const tools: CopilotTool[] = [
  {
    name: "list_experiments",
    description: "列出平台上的实验，可按 status / schema_id 过滤。用于发现用户没圈选的相关实验。",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed"] },
        schema_id: { type: "string", description: "按评测任务 ID 过滤" },
        limit: { type: "number", description: "最多返回多少条，上限 50" },
      },
    },
    requiresConfirm: false,
    run: async (input, _ctx) => {
      const all = listExperiments()
      let filtered = all
      if (input.status) filtered = filtered.filter(e => e.status === input.status)
      if (input.schema_id) filtered = filtered.filter(e => e.schema_id === input.schema_id)
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return {
        experiments: filtered.slice(0, limit).map(e => ({
          id: e.id,
          name: e.name,
          model: e.model,
          status: e.status,
          schema_id: e.schema_id,
          completed_tasks: e.run_stats?.completed_tasks ?? 0,
          total_tasks: e.run_stats?.total_tasks ?? 0,
          failed_tasks: e.run_stats?.failed_tasks ?? 0,
        })),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
      }
    },
  },
  {
    name: "read_experiment_results",
    description: "读取某个实验的 task 结果，可按 task_id 列表或 status 过滤。用于扫描失败样本或提取特定结果。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["success", "error", "parse_error"] },
        limit: { type: "number" },
      },
    },
    requiresConfirm: false,
    run: async (input, _ctx) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const all = readResults(String(input.experiment_id))
      let filtered = all
      if (Array.isArray(input.task_ids) && input.task_ids.length) {
        const set = new Set(input.task_ids as string[])
        filtered = filtered.filter(r => set.has(r.task_id))
      }
      if (input.status) filtered = filtered.filter(r => r.status === input.status)
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return {
        results: filtered.slice(0, limit),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
      }
    },
  },
  {
    name: "restart_experiment",
    description: "重新运行一个实验。可选：只跑指定的 task_ids 子集（用于修了 prompt 后只重跑失败的几条）。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
      },
    },
    requiresConfirm: true,
    run: async (input, _ctx) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const expId = String(input.experiment_id)
      const exp = getExperiment(expId)
      if (!exp) throw new Error(`Experiment not found: ${expId}`)
      const taskIds = Array.isArray(input.task_ids) ? (input.task_ids as string[]) : undefined
      // ExperimentConfig has no concurrency field; default to 3 per run route convention
      const { totalTasks } = startBatch(exp, true, 3, taskIds)
      return {
        triggered: true,
        experiment_id: expId,
        task_count: taskIds?.length ?? totalTasks,
        message: taskIds?.length
          ? `已触发重跑 ${taskIds.length} 条指定 task`
          : `已触发全量重跑实验 ${expId}`,
      }
    },
  },
]
