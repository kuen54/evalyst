import { describe, it, expect } from "vitest"
import { toolByName } from "../tools/registry"

const listTool = toolByName.get("list_experiments")!
const readTool = toolByName.get("read_experiment_results")!
const restartTool = toolByName.get("restart_experiment")!

const ctx = { session_id: "test-session", signal: new AbortController().signal }

describe("tool: list_experiments", () => {
  it("returns all when no filter", async () => {
    const result = (await listTool.call({}, ctx)) as { experiments: unknown[]; total_matching: number }
    expect(Array.isArray(result.experiments)).toBe(true)
  })

  it("caps limit at 50", async () => {
    const result = (await listTool.call({ limit: 999 }, ctx)) as { returned: number }
    expect(result.returned).toBeLessThanOrEqual(50)
  })

  it("is read-only, not destructive", () => {
    expect(listTool.metadata.isReadOnly).toBe(true)
    expect(listTool.metadata.isDestructive).toBe(false)
  })
})

describe("tool: read_experiment_results", () => {
  it("requires experiment_id (returns err(INVALID_INPUT))", async () => {
    const r = await readTool.call({}, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    })
  })

  it("returns empty for unknown experiment (wrapped in ok)", async () => {
    const r = (await readTool.call({ experiment_id: "nonexistent" }, ctx)) as {
      ok: true
      value: { results: unknown[] }
    }
    expect(r.ok).toBe(true)
    expect(r.value.results).toEqual([])
  })

  it("is read-only, not destructive", () => {
    expect(readTool.metadata.isReadOnly).toBe(true)
    expect(readTool.metadata.isDestructive).toBe(false)
  })
})

describe("tool: restart_experiment", () => {
  it("is destructive (triggers Confirm gate)", () => {
    expect(restartTool.metadata.isDestructive).toBe(true)
    expect(restartTool.metadata.isReadOnly).toBe(false)
  })

  it("requires experiment_id (returns err(INVALID_INPUT))", async () => {
    const r = await restartTool.call({}, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    })
  })
})

// Registry-level shape assertions live in tools/__tests__/registry.test.ts.
