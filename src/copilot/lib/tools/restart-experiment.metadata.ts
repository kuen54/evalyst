import type { ToolMetadataDescriptor } from "./types"

export interface RestartExperimentInput {
  experiment_id: string
  task_ids?: string[]
}

export interface RestartExperimentOutput {
  triggered: boolean
  experiment_id: string
  task_count: number
  message: string
}

export const restartExperimentMetadata: ToolMetadataDescriptor = {
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
}
