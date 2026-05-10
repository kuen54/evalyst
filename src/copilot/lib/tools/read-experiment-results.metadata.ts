import type { ToolMetadataDescriptor } from "./types"

export type ReadExperimentResultsGroupBy = "error_type" | "score_bucket" | "task_id"
export type ReadExperimentResultsAggregate =
  | "count"
  | "pass_rate"
  | "avg_score"
  | "sample_ids"

export interface ReadExperimentResultsInput {
  experiment_id: string
  task_ids?: string[]
  status?: "success" | "error" | "parse_error"
  limit?: number
  group_by?: ReadExperimentResultsGroupBy
  aggregate?: ReadExperimentResultsAggregate[]
  filter?: {
    score_lt?: number
    score_gte?: number
    error_contains?: string
  }
}

export const readExperimentResultsMetadata: ToolMetadataDescriptor = {
  name: "read_experiment_results",
  description:
    "读取某个实验的 task 结果，可按 task_id 列表或 status 过滤。带 group_by 时返回分组聚合（count/pass_rate/avg_score/sample_ids），用于扫描失败样本分布或分数分布，避免主 LLM 遍历原始数据。",
  inputSchema: {
    type: "object",
    required: ["experiment_id"],
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["success", "error", "parse_error"] },
      limit: { type: "number" },
      group_by: {
        type: "string",
        enum: ["error_type", "score_bucket", "task_id"],
        description:
          "Return aggregated groups instead of raw rows. error_type buckets by r.error; score_bucket uses <0.5 / 0.5-0.8 / ≥0.8 / no_score.",
      },
      aggregate: {
        type: "array",
        items: { type: "string", enum: ["count", "pass_rate", "avg_score", "sample_ids"] },
        description:
          "Which metrics to compute per group. sample_ids returns up to 5 task_ids per group.",
      },
      filter: {
        type: "object",
        properties: {
          score_lt: { type: "number" },
          score_gte: { type: "number" },
          error_contains: { type: "string" },
        },
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,
  },
}
