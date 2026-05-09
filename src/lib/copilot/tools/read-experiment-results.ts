import { readResults } from "@/lib/store"
import type { GenericResultRecord } from "@/lib/schema/types"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"

type GroupBy = "error_type" | "score_bucket" | "task_id"
type Aggregate = "count" | "pass_rate" | "avg_score" | "sample_ids"

interface Input {
  experiment_id: string
  task_ids?: string[]
  status?: "success" | "error" | "parse_error"
  limit?: number
  // M6: optional aggregation
  group_by?: GroupBy
  aggregate?: Aggregate[]
  filter?: {
    score_lt?: number
    score_gte?: number
    error_contains?: string
  }
}

/** Row view — allow optional score (not in GenericResultRecord; user eval schemas may populate). */
type Row = GenericResultRecord & { score?: number }

function scoreBucket(score: number | undefined): string {
  if (score === undefined || score === null || Number.isNaN(score)) return "no_score"
  if (score < 0.5) return "<0.5"
  if (score < 0.8) return "0.5-0.8"
  return "≥0.8"
}

function groupKeyFor(r: Row, by: GroupBy): string {
  if (by === "error_type") return r.error ?? "no_error"
  if (by === "score_bucket") return scoreBucket(r.score)
  return r.task_id
}

function computeMetrics(members: Row[], aggs: Aggregate[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const wants = new Set(aggs)
  if (wants.has("count")) out.count = members.length
  if (wants.has("pass_rate")) {
    out.pass_rate = members.length
      ? members.filter((m) => m.status === "success").length / members.length
      : 0
  }
  if (wants.has("avg_score")) {
    const scores = members
      .map((m) => m.score)
      .filter((s): s is number => typeof s === "number" && !Number.isNaN(s))
    out.avg_score = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null
  }
  return out
}

export const readExperimentResultsTool: ToolDescriptor<Input, unknown> = {
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
  call: async (input) => {
    if (!input.experiment_id) {
      return err("INVALID_INPUT", "experiment_id is required", {
        hint: "Pass experiment_id as string",
      })
    }
    const all = readResults(String(input.experiment_id)) as Row[]
    let filtered: Row[] = all
    if (Array.isArray(input.task_ids) && input.task_ids.length) {
      const set = new Set(input.task_ids)
      filtered = filtered.filter((r) => set.has(r.task_id))
    }
    if (input.status) filtered = filtered.filter((r) => r.status === input.status)
    if (input.filter?.error_contains) {
      const needle = input.filter.error_contains
      filtered = filtered.filter((r) => (r.error ?? "").includes(needle))
    }
    if (input.filter?.score_lt !== undefined) {
      const lt = input.filter.score_lt
      filtered = filtered.filter((r) => typeof r.score === "number" && r.score < lt)
    }
    if (input.filter?.score_gte !== undefined) {
      const gte = input.filter.score_gte
      filtered = filtered.filter((r) => typeof r.score === "number" && r.score >= gte)
    }

    // Legacy mode: no group_by → original shape
    if (!input.group_by) {
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return ok({
        results: filtered.slice(0, limit),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
      })
    }

    // Aggregated mode
    const aggs = input.aggregate ?? ["count"]
    const wantSampleIds = aggs.includes("sample_ids")
    const groups = new Map<string, Row[]>()
    for (const r of filtered) {
      const key = groupKeyFor(r, input.group_by)
      let arr = groups.get(key)
      if (!arr) {
        arr = []
        groups.set(key, arr)
      }
      arr.push(r)
    }

    return ok({
      groups: Array.from(groups.entries()).map(([key, members]) => ({
        group_key: key,
        metrics: computeMetrics(members, aggs),
        ...(wantSampleIds
          ? { sample_ids: members.slice(0, 5).map((m) => m.task_id) }
          : {}),
      })),
      total: filtered.length,
    })
  },
}
