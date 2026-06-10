import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { readResults, appendResult } from "@/lib/store"
import type { GenericResultRecord } from "@/lib/schema/types"

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "store-read-results-"))
  fs.mkdirSync(path.join(tmp, "data", "results", "exp_a"), { recursive: true })
  process.chdir(tmp)
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function rec(task_id: string, status: GenericResultRecord["status"] = "success"): GenericResultRecord {
  return {
    schema_id: "s1",
    schema_version: 1,
    task_id,
    experiment_id: "exp_a",
    input_refs: {},
    input_preview: {},
    status,
    latency_ms: 1,
    model: "m",
    timestamp: new Date().toISOString(),
  }
}

describe("readResults · corrupt-line tolerance", () => {
  it("returns [] when file is missing", () => {
    expect(readResults("exp_missing")).toEqual([])
  })

  it("reads valid records normally", () => {
    appendResult("exp_a", rec("t1"))
    appendResult("exp_a", rec("t2"))
    const out = readResults("exp_a")
    expect(out.map(r => r.task_id)).toEqual(["t1", "t2"])
  })

  it("skips a corrupt line in the middle without throwing", () => {
    // Simulate: 1 valid line, then a torn write (half a JSON), then a valid line.
    // Pre-fix behavior: JSON.parse threw → readResults itself threw → entire
    // experiment unreadable. Post-fix: corrupt line is skipped, both valid
    // entries returned.
    const file = path.join(tmp, "data", "results", "exp_a", "results.jsonl")
    fs.writeFileSync(
      file,
      JSON.stringify(rec("t1")) + "\n" +
      '{"task_id":"t2","schema_id":"s1","stat' + "\n" +
      JSON.stringify(rec("t3")) + "\n",
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = readResults("exp_a")
    expect(out.map(r => r.task_id)).toEqual(["t1", "t3"])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/skipping corrupt line/)
  })

  it("returns [] when file is entirely garbage", () => {
    const file = path.join(tmp, "data", "results", "exp_a", "results.jsonl")
    fs.writeFileSync(file, "not json\n{\"incomplete\":\n")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(readResults("exp_a")).toEqual([])
  })

  it("mtime cache: invalidates on append, returns stable ref when unchanged", () => {
    appendResult("exp_a", rec("t1"))
    const first = readResults("exp_a")
    // 同一文件未变 → cache 命中，返回同一数组引用（让上层 memo/identity 跳过）
    expect(readResults("exp_a")).toBe(first)
    // append 改变 size/mtime → cache 失效，拿到新数据
    appendResult("exp_a", rec("t2"))
    const second = readResults("exp_a")
    expect(second).not.toBe(first)
    expect(second.map(r => r.task_id)).toEqual(["t1", "t2"])
  })

  it("dedupes by task_id (last wins) even when corrupt lines are interleaved", () => {
    const file = path.join(tmp, "data", "results", "exp_a", "results.jsonl")
    fs.writeFileSync(
      file,
      JSON.stringify(rec("t1", "error")) + "\n" +
      "{garbage}\n" +
      JSON.stringify(rec("t1", "success")) + "\n",
    )
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = readResults("exp_a")
    expect(out).toHaveLength(1)
    expect(out[0]!.status).toBe("success")
  })
})
