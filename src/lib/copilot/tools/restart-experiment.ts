import { startBatch } from "@/lib/batch-runner"
import { getExperiment } from "@/lib/store"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"

interface Input {
  experiment_id: string
  task_ids?: string[]
}

interface Output {
  triggered: boolean
  experiment_id: string
  task_count: number
  message: string
}

export const restartExperimentTool: ToolDescriptor<Input, Output> = {
  name: "restart_experiment",
  description:
    "重新运行一个实验。可选：只跑指定的 task_ids 子集（用于修了 prompt 后只重跑失败的几条）。",
  inputSchema: {
    type: "object",
    required: ["experiment_id"],
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
    },
  },
  metadata: {
    isReadOnly: false,
    isDestructive: true,
    maxResultSizeChars: 500,
  },
  call: async (input) => {
    if (!input.experiment_id) {
      return err("INVALID_INPUT", "experiment_id is required", {
        hint: "Pass experiment_id as string in input",
      })
    }
    const expId = String(input.experiment_id)
    const exp = getExperiment(expId)
    if (!exp) {
      return err("NOT_FOUND", `Experiment not found: ${expId}`, {
        hint: "Use list_experiments to see valid ids",
      })
    }
    const taskIds = Array.isArray(input.task_ids) ? input.task_ids : undefined
    // ExperimentConfig 无 concurrency 字段；按 run route 约定用默认 3
    const { totalTasks } = startBatch(exp, true, 3, taskIds)
    return ok({
      triggered: true,
      experiment_id: expId,
      task_count: taskIds?.length ?? totalTasks,
      message: taskIds?.length
        ? `已触发重跑 ${taskIds.length} 条指定 task`
        : `已触发全量重跑实验 ${expId}`,
    })
  },
}
