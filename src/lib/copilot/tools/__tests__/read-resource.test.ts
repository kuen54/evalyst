import { describe, it, expect, vi } from "vitest"
import { readResourceTool } from "../read-resource"

vi.mock("@/lib/store", () => ({
  getExperiment: (id: string) =>
    id === "exp_A"
      ? { id, schema_id: "sch", model_name: "gpt-4o", extra: "ignored" }
      : null,
}))
vi.mock("@/lib/schema", () => ({
  getSchema: (id: string) => (id === "sch_X" ? { id, prompt_template: "hi {{x}}" } : null),
}))
vi.mock("@/lib/datasets", () => ({
  getDataset: (id: string) => {
    if (id === "ds_1") return { records: [{ a: 1 }], def: { id, fields: [] } }
    throw new Error("not found")
  },
}))
vi.mock("@/lib/displays", () => ({
  getDisplay: (id: string) => (id === "disp_1" ? { id, mode: "table" } : null),
}))
vi.mock("@/lib/rubric-store", () => ({
  getRubric: (id: string) => (id === "rub_1" ? { id, criteria: [] } : null),
}))

const ctx = { session_id: "s", signal: new AbortController().signal }

describe("readResourceTool", () => {
  it("metadata is read-only", () => {
    expect(readResourceTool.metadata.isReadOnly).toBe(true)
    expect(readResourceTool.metadata.isDestructive).toBe(false)
  })

  it("returns whole experiment when no fields specified", async () => {
    const r = (await readResourceTool.call(
      { type: "experiment", id: "exp_A" },
      ctx,
    )) as Record<string, unknown>
    expect(r.id).toBe("exp_A")
    expect(r.extra).toBe("ignored")
  })

  it("fields filter picks subset only", async () => {
    const r = (await readResourceTool.call(
      { type: "experiment", id: "exp_A", fields: ["schema_id", "model_name"] },
      ctx,
    )) as Record<string, unknown>
    expect(r).toEqual({ schema_id: "sch", model_name: "gpt-4o" })
    expect(r.extra).toBeUndefined()
  })

  it("loads template via getSchema", async () => {
    const r = (await readResourceTool.call(
      { type: "template", id: "sch_X", fields: ["prompt_template"] },
      ctx,
    )) as Record<string, unknown>
    expect(r.prompt_template).toBe("hi {{x}}")
  })

  it("loads dataset (structure includes records+def)", async () => {
    const r = (await readResourceTool.call({ type: "dataset", id: "ds_1" }, ctx)) as {
      records: unknown[]; def: { id: string }
    }
    expect(Array.isArray(r.records)).toBe(true)
    expect(r.def.id).toBe("ds_1")
  })

  it("loads display", async () => {
    const r = (await readResourceTool.call(
      { type: "display", id: "disp_1" },
      ctx,
    )) as Record<string, unknown>
    expect(r.mode).toBe("table")
  })

  it("loads rubric", async () => {
    const r = (await readResourceTool.call({ type: "rubric", id: "rub_1" }, ctx)) as {
      criteria: unknown[]
    }
    expect(r.criteria).toEqual([])
  })

  it("throws on missing resource", async () => {
    await expect(
      readResourceTool.call({ type: "experiment", id: "nope" }, ctx),
    ).rejects.toThrow(/not found/)
  })

  it("throws on missing dataset (wrapped null)", async () => {
    await expect(
      readResourceTool.call({ type: "dataset", id: "nope" }, ctx),
    ).rejects.toThrow(/not found/)
  })

  it("requires type + id", async () => {
    await expect(
      readResourceTool.call({ type: "" as never, id: "x" }, ctx),
    ).rejects.toThrow()
    await expect(
      readResourceTool.call({ type: "experiment", id: "" }, ctx),
    ).rejects.toThrow()
  })
})
