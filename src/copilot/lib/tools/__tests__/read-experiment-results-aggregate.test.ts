import { describe, it, expect, vi } from "vitest"

// Mock store.readResults to return a fixed dataset; the tool calls it synchronously.
vi.mock("@/lib/store", () => ({
  readResults: (experimentId: string) => {
    if (experimentId === "exp_empty") return []
    return [
      { task_id: "t1", status: "error", error: "timeout while calling llm", score: 0.2 },
      { task_id: "t2", status: "error", error: "timeout while calling llm", score: 0.35 },
      { task_id: "t3", status: "error", error: "parse_error: bad json", score: undefined },
      { task_id: "t4", status: "success", score: 0.65 },
      { task_id: "t5", status: "success", score: 0.9 },
      { task_id: "t6", status: "success", score: 0.82 },
      { task_id: "t7", status: "success" /* no score */ },
    ]
  },
  // image-vision §4.5: tool now also reads experiment to schema-aware extract images.
  // These tests don't assert on _attachments; returning null short-circuits collectAttachmentsForFiltered.
  getExperiment: () => null,
}))
// image-vision §4.5: schema lookup is gated by getExperiment returning null above, but
// the import must resolve. Provide a no-op mock to keep the module graph clean.
vi.mock("@/lib/schema", () => ({
  getSchema: () => null,
}))

// Import AFTER mocks. The tool lives in the same dir; re-import via relative path.
import { readExperimentResultsTool } from "../read-experiment-results.server"

const ctx = { session_id: "s", signal: new AbortController().signal }

describe("read_experiment_results · backward compat (no group_by)", () => {
  it("returns ok wrapping {results,total_matching,returned,truncated} when group_by not given", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_A" },
      ctx,
    )) as {
      ok: true
      value: {
        results: unknown[]
        total_matching: number
        returned: number
        truncated: boolean
      }
    }
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.value.results)).toBe(true)
    expect(r.value.total_matching).toBe(7)
    expect(r.value.returned).toBe(7)
    expect(r.value.truncated).toBe(false)
  })

  it("status filter still works without group_by", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_A", status: "error" },
      ctx,
    )) as { ok: true; value: { total_matching: number } }
    expect(r.value.total_matching).toBe(3)
  })
})

describe("read_experiment_results · input validation (v2.5 P2)", () => {
  it("missing experiment_id → err(INVALID_INPUT)", async () => {
    const r = await readExperimentResultsTool.call({ experiment_id: "" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("experiment_id") },
    })
  })
})

describe("read_experiment_results · group_by + aggregate", () => {
  it("groups by error_type with count + sample_ids", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        status: "error",
        group_by: "error_type",
        aggregate: ["count", "sample_ids"],
      },
      ctx,
    )) as {
      ok: true
      value: {
        groups: Array<{
          group_key: string
          metrics: Record<string, unknown>
          sample_ids?: string[]
        }>
        total: number
      }
    }
    expect(r.value.total).toBe(3)
    expect(r.value.groups).toHaveLength(2)
    const timeout = r.value.groups.find((g) => g.group_key === "timeout while calling llm")
    expect(timeout?.metrics.count).toBe(2)
    expect(timeout?.sample_ids).toEqual(["t1", "t2"])
    const parseErr = r.value.groups.find((g) => g.group_key === "parse_error: bad json")
    expect(parseErr?.metrics.count).toBe(1)
    expect(parseErr?.sample_ids).toEqual(["t3"])
  })

  it("groups by score_bucket with pass_rate + avg_score (no sample_ids)", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        group_by: "score_bucket",
        aggregate: ["count", "pass_rate", "avg_score"],
      },
      ctx,
    )) as {
      ok: true
      value: {
        groups: Array<{
          group_key: string
          metrics: Record<string, unknown>
          sample_ids?: string[]
        }>
      }
    }
    // Buckets keyed: "<0.5" (t1, t2, t3->no score goes to no_score), "0.5-0.8" (t4), "≥0.8" (t5, t6), "no_score" (t3, t7)
    // t1=0.2 <0.5, t2=0.35 <0.5, t3=no_score, t4=0.65 in 0.5-0.8, t5=0.9 ≥0.8, t6=0.82 ≥0.8, t7=no_score
    const lt = r.value.groups.find((g) => g.group_key === "<0.5")
    expect(lt?.metrics.count).toBe(2)
    expect(lt?.metrics.pass_rate).toBe(0) // both are status=error
    expect(lt?.metrics.avg_score).toBeCloseTo(0.275, 5)

    const mid = r.value.groups.find((g) => g.group_key === "0.5-0.8")
    expect(mid?.metrics.count).toBe(1)
    expect(mid?.metrics.pass_rate).toBe(1) // t4 is success
    expect(mid?.metrics.avg_score).toBeCloseTo(0.65, 5)

    const hi = r.value.groups.find((g) => g.group_key === "≥0.8")
    expect(hi?.metrics.count).toBe(2)
    expect(hi?.metrics.pass_rate).toBe(1)
    expect(hi?.metrics.avg_score).toBeCloseTo(0.86, 5)

    const noScore = r.value.groups.find((g) => g.group_key === "no_score")
    expect(noScore?.metrics.count).toBe(2)
    expect(noScore?.metrics.avg_score).toBeNull()

    // sample_ids not requested → undefined
    for (const g of r.value.groups) expect(g.sample_ids).toBeUndefined()
  })

  it("sample_ids capped at 5 per group", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        group_by: "task_id",
        aggregate: ["sample_ids"],
      },
      ctx,
    )) as {
      ok: true
      value: { groups: Array<{ group_key: string; sample_ids?: string[] }> }
    }
    // group_by=task_id gives each task its own group of 1
    for (const g of r.value.groups) {
      expect(g.sample_ids?.length).toBeLessThanOrEqual(5)
    }
  })

  it("filter.score_lt applied before grouping", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        group_by: "task_id",
        aggregate: ["count"],
        filter: { score_lt: 0.5 },
      },
      ctx,
    )) as { ok: true; value: { groups: Array<unknown>; total: number } }
    // t1=0.2, t2=0.35 match (score defined & <0.5). t3/t7 undefined score → excluded.
    expect(r.value.total).toBe(2)
    expect(r.value.groups).toHaveLength(2)
  })

  it("filter.error_contains narrows before grouping", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        group_by: "error_type",
        aggregate: ["count"],
        filter: { error_contains: "timeout" },
      },
      ctx,
    )) as {
      ok: true
      value: {
        groups: Array<{ group_key: string; metrics: { count: number } }>
        total: number
      }
    }
    expect(r.value.total).toBe(2)
    expect(r.value.groups).toHaveLength(1)
    expect(r.value.groups[0]!.metrics.count).toBe(2)
  })

  it("filter.score_gte narrows before grouping", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_A",
        group_by: "task_id",
        aggregate: ["count"],
        filter: { score_gte: 0.8 },
      },
      ctx,
    )) as { ok: true; value: { total: number } }
    // t5=0.9, t6=0.82 → 2
    expect(r.value.total).toBe(2)
  })

  it("empty dataset returns empty groups + total=0", async () => {
    const r = (await readExperimentResultsTool.call(
      {
        experiment_id: "exp_empty",
        group_by: "task_id",
        aggregate: ["count"],
      },
      ctx,
    )) as { ok: true; value: { groups: unknown[]; total: number } }
    expect(r.value.groups).toEqual([])
    expect(r.value.total).toBe(0)
  })
})
