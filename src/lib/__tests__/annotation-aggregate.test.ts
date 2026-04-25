import { describe, it, expect, afterAll } from "vitest"
import { latestAnnotations, aggregateAnnotations } from "@/lib/annotation-store"
import type { Annotation, Rubric } from "@/lib/schema/types"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// annotation-store 读写 data/results/{id}/annotations.jsonl；用临时目录替换 cwd
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-test-"))
const origCwd = process.cwd()
process.chdir(tmp)

function write(expId: string, annotations: Annotation[]) {
  const dir = path.join(tmp, "data", "results", expId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "annotations.jsonl"), annotations.map(a => JSON.stringify(a)).join("\n") + "\n")
}

function ann(overrides: Partial<Annotation>): Annotation {
  return {
    annotation_id: "aid",
    task_id: "t",
    rubric_id: "r",
    evaluator: "human",
    scores: {},
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("latestAnnotations", () => {
  it("dedupes same (task_id, rubric_id, evaluator) by latest timestamp", () => {
    const expId = "exp1"
    write(expId, [
      ann({ annotation_id: "1", task_id: "t1", scores: { a: true }, timestamp: "2026-01-01T00:00:00Z" }),
      ann({ annotation_id: "2", task_id: "t1", scores: { a: false }, timestamp: "2026-01-02T00:00:00Z" }),
      ann({ annotation_id: "3", task_id: "t2", scores: { a: true }, timestamp: "2026-01-01T00:00:00Z" }),
    ])
    const out = latestAnnotations(expId)
    expect(out).toHaveLength(2)
    const t1 = out.find(a => a.task_id === "t1")!
    expect(t1.annotation_id).toBe("2")
    expect(t1.scores.a).toBe(false)
  })

  it("keeps same task with different evaluator separately", () => {
    const expId = "exp2"
    write(expId, [
      ann({ annotation_id: "1", task_id: "t1", evaluator: "human" }),
      ann({ annotation_id: "2", task_id: "t1", evaluator: "llm" }),
    ])
    expect(latestAnnotations(expId)).toHaveLength(2)
  })

  it("filters by rubric_id", () => {
    const expId = "exp3"
    write(expId, [
      ann({ annotation_id: "1", task_id: "t1", rubric_id: "r1" }),
      ann({ annotation_id: "2", task_id: "t1", rubric_id: "r2" }),
    ])
    expect(latestAnnotations(expId, "r1")).toHaveLength(1)
    expect(latestAnnotations(expId, "r1")[0].rubric_id).toBe("r1")
  })

  it("returns empty for nonexistent experiment", () => {
    expect(latestAnnotations("missing")).toEqual([])
  })
})

describe("aggregateAnnotations", () => {
  const rubric: Rubric = {
    id: "r1",
    name: "test",
    criteria: [
      { key: "correct", label: "Correct", type: "pass_fail" },
      { key: "score", label: "Score", type: "likert_1_5" },
      { key: "numeric", label: "Numeric", type: "score_0_100" },
    ],
  }

  it("aggregates pass_fail criterion", () => {
    const expId = "exp_pf"
    write(expId, [
      ann({ task_id: "t1", rubric_id: "r1", scores: { correct: true } }),
      ann({ task_id: "t2", rubric_id: "r1", scores: { correct: true } }),
      ann({ task_id: "t3", rubric_id: "r1", scores: { correct: false } }),
    ])
    const agg = aggregateAnnotations(expId, rubric, 3)
    const c = agg.criteria.find(x => x.key === "correct")!
    expect(c.count).toBe(3)
    expect(c.pass).toBe(2)
    expect(c.fail).toBe(1)
    expect(c.pass_rate).toBeCloseTo(2 / 3, 5)
    expect(agg.annotated_tasks).toBe(3)
  })

  it("aggregates likert_1_5 criterion (avg + dist + min/max)", () => {
    const expId = "exp_lk"
    write(expId, [
      ann({ task_id: "t1", rubric_id: "r1", scores: { score: 3 } }),
      ann({ task_id: "t2", rubric_id: "r1", scores: { score: 4 } }),
      ann({ task_id: "t3", rubric_id: "r1", scores: { score: 5 } }),
      ann({ task_id: "t4", rubric_id: "r1", scores: { score: 4 } }),
    ])
    const agg = aggregateAnnotations(expId, rubric, 4)
    const c = agg.criteria.find(x => x.key === "score")!
    expect(c.count).toBe(4)
    expect(c.avg).toBeCloseTo(4, 5)
    expect(c.min).toBe(3)
    expect(c.max).toBe(5)
    expect(c.dist).toEqual({ "1": 0, "2": 0, "3": 1, "4": 2, "5": 1 })
  })

  it("aggregates score_0_100", () => {
    const expId = "exp_num"
    write(expId, [
      ann({ task_id: "t1", rubric_id: "r1", scores: { numeric: 80 } }),
      ann({ task_id: "t2", rubric_id: "r1", scores: { numeric: 90 } }),
    ])
    const agg = aggregateAnnotations(expId, rubric, 2)
    const c = agg.criteria.find(x => x.key === "numeric")!
    expect(c.count).toBe(2)
    expect(c.avg).toBeCloseTo(85, 5)
    expect(c.min).toBe(80)
    expect(c.max).toBe(90)
    expect(c.dist).toBeUndefined()
  })

  it("count=0 when no matching annotations", () => {
    const expId = "exp_empty"
    write(expId, [])
    const agg = aggregateAnnotations(expId, rubric, 5)
    for (const c of agg.criteria) {
      expect(c.count).toBe(0)
    }
    expect(agg.annotated_tasks).toBe(0)
  })
})

// 清理
afterAll(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})
