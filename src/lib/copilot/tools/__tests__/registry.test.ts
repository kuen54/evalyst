import { describe, it, expect } from "vitest"
import { TOOLS, toolByName } from "../registry"

describe("tool registry", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("toolByName lookup works", () => {
    for (const t of TOOLS) {
      expect(toolByName.get(t.name)).toBe(t)
    }
  })

  it("every tool has required metadata fields", () => {
    for (const t of TOOLS) {
      expect(typeof t.metadata.isReadOnly).toBe("boolean")
      expect(typeof t.metadata.isDestructive).toBe("boolean")
      expect(t.metadata.maxResultSizeChars).toBeGreaterThan(0)
    }
  })

  it("destructive tools are not marked read-only", () => {
    for (const t of TOOLS) {
      if (t.metadata.isDestructive) expect(t.metadata.isReadOnly).toBe(false)
    }
  })

  it("contains the 4 migrated tools", () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toContain("list_experiments")
    expect(names).toContain("read_experiment_results")
    expect(names).toContain("restart_experiment")
    expect(names).toContain("read_page")
  })
})
