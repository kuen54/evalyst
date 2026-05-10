import { startBatch } from "@/lib/batch-runner"
import { getExperiment } from "@/lib/store"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import {
  restartExperimentMetadata,
  type RestartExperimentInput,
  type RestartExperimentOutput,
} from "./restart-experiment.metadata"

export const restartExperimentTool: ToolDescriptor<RestartExperimentInput, RestartExperimentOutput> = {
  ...restartExperimentMetadata,
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
