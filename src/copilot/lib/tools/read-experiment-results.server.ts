import { readResults, getExperiment } from "@/lib/store"
import { getSchema } from "@/lib/schema"
import type { GenericResultRecord } from "@/lib/schema/types"
import type { ImageRef } from "../types"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
import {
  readExperimentResultsMetadata,
  type ReadExperimentResultsInput,
  type ReadExperimentResultsGroupBy,
  type ReadExperimentResultsAggregate,
} from "./read-experiment-results.metadata"

/** Row view — allow optional score (not in GenericResultRecord; user eval schemas may populate). */
type Row = GenericResultRecord & { score?: number }

function scoreBucket(score: number | undefined): string {
  if (score === undefined || score === null || Number.isNaN(score)) return "no_score"
  if (score < 0.5) return "<0.5"
  if (score < 0.8) return "0.5-0.8"
  return "≥0.8"
}

function groupKeyFor(r: Row, by: ReadExperimentResultsGroupBy): string {
  if (by === "error_type") return r.error ?? "no_error"
  if (by === "score_bucket") return scoreBucket(r.score)
  return r.task_id
}

function computeMetrics(
  members: Row[],
  aggs: ReadExperimentResultsAggregate[],
): Record<string, unknown> {
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

export const readExperimentResultsTool: ToolDescriptor<ReadExperimentResultsInput, unknown> = {
  ...readExperimentResultsMetadata,
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

    // image-vision §4.5: 在 filtered 上扫前 N=MAX_IMAGES_PER_TURN 张图，schema-aware 提取。
    // 全空时返 undefined，让 caller 用 `...(attachments ? { _attachments: attachments } : {})`
    // 完全省略字段——避免 text-only schema 也带 `_attachments` 空数组扰动 LLM。
    function collectAttachmentsForFiltered(): ImageRef[] | undefined {
      const exp = getExperiment(String(input.experiment_id))
      if (!exp) return undefined
      if (!exp.schema_id) return undefined
      const schema = getSchema(exp.schema_id)
      if (!schema) return undefined
      const refs: ImageRef[] = []
      for (const r of filtered) {
        if (r.status !== "success") continue
        if (refs.length >= MAX_IMAGES_PER_TURN) break
        const outRefs = extractImageRefsFromOutput(
          (r.output ?? {}) as Record<string, unknown>,
          schema,
          exp.id,
          undefined,
          r.task_id,
        )
        for (const ref of outRefs) {
          if (refs.length >= MAX_IMAGES_PER_TURN) break
          refs.push(ref)
        }
      }
      return refs.length > 0 ? refs : undefined
    }

    // Legacy mode: no group_by → original shape
    if (!input.group_by) {
      const limit = Math.min(Number(input.limit ?? 20), 50)
      const attachments = collectAttachmentsForFiltered()
      return ok({
        results: filtered.slice(0, limit),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
        ...(attachments ? { _attachments: attachments } : {}),
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

    const attachments = collectAttachmentsForFiltered()
    return ok({
      groups: Array.from(groups.entries()).map(([key, members]) => ({
        group_key: key,
        metrics: computeMetrics(members, aggs),
        ...(wantSampleIds
          ? { sample_ids: members.slice(0, 5).map((m) => m.task_id) }
          : {}),
      })),
      total: filtered.length,
      ...(attachments ? { _attachments: attachments } : {}),
    })
  },
}
