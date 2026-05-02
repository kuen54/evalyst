import { describe, it, expect } from "vitest"
import { TOOLS, toolByName } from "../tools/registry"

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
  it("requires experiment_id", async () => {
    await expect(readTool.call({}, ctx)).rejects.toThrow()
  })

  it("returns empty for unknown experiment", async () => {
    const result = (await readTool.call({ experiment_id: "nonexistent" }, ctx)) as { results: unknown[] }
    expect(result.results).toEqual([])
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

  it("requires experiment_id", async () => {
    await expect(restartTool.call({}, ctx)).rejects.toThrow()
  })
})

describe("TOOLS registry", () => {
  it("includes the 4 migrated tools", () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(["list_experiments", "read_experiment_results", "restart_experiment", "read_page"]),
    )
  })
})
