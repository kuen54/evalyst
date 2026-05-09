import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock datasets module BEFORE importing engine (vitest hoists vi.mock)
vi.mock("@/lib/datasets", () => ({
  getDataset: vi.fn(),
}))

import { generateTasks, estimateTaskCount, TooManyTasksError } from "@/lib/schema/engine"
import { getDataset } from "@/lib/datasets"
import type { TaskSchema } from "@/lib/schema/types"

const mockedGetDataset = vi.mocked(getDataset)

function fakeDataset(id: string, recordCount: number, idField = "id") {
  const records = Array.from({ length: recordCount }, (_, i) => ({
    [idField]: `${id}_${i}`,
    value: i,
  }))
  return {
    records,
    def: {
      id,
      name: id,
      source: "builtin" as const,
      id_field: idField,
      fields: [],
    },
  }
}

function makeSchema(aliases: string[]): TaskSchema {
  return {
    id: "test_schema",
    label: "test",
    version: 1,
    inputs: aliases.map(a => ({ alias: a, dataset_id: a })),
    variables: [],
    default_prompt: "",
    message_builder: { user_template: "" },
    output_schema: { type: "object", properties: {} },
  } as unknown as TaskSchema
}

beforeEach(() => {
  mockedGetDataset.mockReset()
})

describe("estimateTaskCount", () => {
  it("returns product of per-alias record counts", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, id === "a" ? 5 : id === "b" ? 7 : 11))
    const schema = makeSchema(["a", "b", "c"])
    expect(estimateTaskCount(schema, {}, {})).toBe(5 * 7 * 11)
  })

  it("returns 0 when any input has 0 records", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, id === "b" ? 0 : 100))
    const schema = makeSchema(["a", "b", "c"])
    expect(estimateTaskCount(schema, {}, {})).toBe(0)
  })

  it("does not materialize cartesian: 3 alias × 1000 records returns 1B in <50ms", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 1000))
    const schema = makeSchema(["a", "b", "c"])
    const start = performance.now()
    const count = estimateTaskCount(schema, {}, {})
    const elapsed = performance.now() - start
    expect(count).toBe(1_000_000_000)
    // generous threshold (spec asks <10ms; CI variance buffer)
    expect(elapsed).toBeLessThan(50)
  })

  it("respects dataset_bindings override per alias", () => {
    mockedGetDataset.mockImplementation((id: string) =>
      fakeDataset(id, id === "override_a" ? 3 : 100)
    )
    const schema = makeSchema(["a"])
    expect(estimateTaskCount(schema, {}, { a: "override_a" })).toBe(3)
  })
})

describe("generateTasks cartesian cap", () => {
  it("throws TooManyTasksError when product exceeds default cap (100_000)", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 60))
    // 60 × 60 × 60 = 216_000, over 100k default cap; small enough not to OOM
    // if cap fails to fire (so failure surfaces as assertion miss, not worker crash)
    const schema = makeSchema(["a", "b", "c"])
    expect(() => generateTasks(schema, {}, {})).toThrow(TooManyTasksError)
  })

  it("respects custom maxTasks override", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 10))
    // 10 × 10 = 100; cap at 50 → throws
    const schema = makeSchema(["a", "b"])
    expect(() => generateTasks(schema, {}, {}, { maxTasks: 50 })).toThrow(TooManyTasksError)
  })

  it("succeeds at exact cap boundary", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 10))
    const schema = makeSchema(["a", "b"])
    const tasks = generateTasks(schema, {}, {}, { maxTasks: 100 })
    expect(tasks).toHaveLength(100)
  })

  it("error carries taskCount and maxTasks for caller to surface", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 100))
    const schema = makeSchema(["a", "b"])
    let caught: TooManyTasksError | null = null
    try {
      generateTasks(schema, {}, {}, { maxTasks: 5000 })
    } catch (e) {
      caught = e as TooManyTasksError
    }
    expect(caught).toBeInstanceOf(TooManyTasksError)
    expect(caught?.taskCount).toBe(10_000)
    expect(caught?.maxTasks).toBe(5000)
    expect(caught?.message).toContain("TOO_MANY_TASKS")
  })

  it("does not throw when product is under cap", () => {
    mockedGetDataset.mockImplementation((id: string) => fakeDataset(id, 50))
    const schema = makeSchema(["a", "b"])
    expect(() => generateTasks(schema, {}, {})).not.toThrow()
  })
})
