import type { ToolMetadataDescriptor } from "./types"

export interface ListExperimentsInput {
  status?: "draft" | "running" | "paused" | "completed" | "failed"
  schema_id?: string
  limit?: number
}

export interface ListExperimentsOutput {
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

export const listExperimentsMetadata: ToolMetadataDescriptor = {
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
}
