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

  it("registers exactly the 9 expected tools", () => {
    const names = TOOLS.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        "list_experiments",
        "read_experiment_results",
        "restart_experiment",
        "read_page",
        "read_tool_result",
        "read_context",
        "read_resource",
        "read_dataset_records",
        "edit_template",
      ].sort(),
    )
  })
})
