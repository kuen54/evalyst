import { describe, it, expect } from "vitest"
import { tools } from "../tools"

const listTool = tools.find(t => t.name === "list_experiments")!
const readTool = tools.find(t => t.name === "read_experiment_results")!
const restartTool = tools.find(t => t.name === "restart_experiment")!

describe("tool: list_experiments", () => {
  it("returns all when no filter", async () => {
    const result = await listTool.run({}) as { experiments: unknown[]; total_matching: number }
    expect(Array.isArray(result.experiments)).toBe(true)
  })

  it("caps limit at 50", async () => {
    const result = await listTool.run({ limit: 999 }) as { returned: number }
    expect(result.returned).toBeLessThanOrEqual(50)
  })

  it("requiresConfirm false", () => {
    expect(listTool.requiresConfirm).toBe(false)
  })
})

describe("tool: read_experiment_results", () => {
  it("requires experiment_id", async () => {
    await expect(readTool.run({} as never)).rejects.toThrow()
  })

  it("returns empty for unknown experiment", async () => {
    const result = await readTool.run({ experiment_id: "nonexistent" }) as { results: unknown[] }
    expect(result.results).toEqual([])
  })

  it("requiresConfirm false", () => {
    expect(readTool.requiresConfirm).toBe(false)
  })
})

describe("tool: restart_experiment", () => {
  it("requiresConfirm true", () => {
    expect(restartTool.requiresConfirm).toBe(true)
  })

  it("requires experiment_id", async () => {
    await expect(restartTool.run({} as never)).rejects.toThrow()
  })
})
