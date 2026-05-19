import { describe, it, expect, vi } from "vitest"
import { readResourceTool } from "../read-resource.server"

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
    )) as { ok: true; value: Record<string, unknown> }
    expect(r.ok).toBe(true)
    expect(r.value.id).toBe("exp_A")
    expect(r.value.extra).toBe("ignored")
  })

  it("fields filter picks subset only", async () => {
    const r = (await readResourceTool.call(
      { type: "experiment", id: "exp_A", fields: ["schema_id", "model_name"] },
      ctx,
    )) as { ok: true; value: Record<string, unknown> }
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ schema_id: "sch", model_name: "gpt-4o" })
    expect(r.value.extra).toBeUndefined()
  })

  it("loads template via getSchema", async () => {
    const r = (await readResourceTool.call(
      { type: "template", id: "sch_X", fields: ["prompt_template"] },
      ctx,
    )) as { ok: true; value: Record<string, unknown> }
    expect(r.value.prompt_template).toBe("hi {{x}}")
  })

  it("loads dataset (structure includes records+def)", async () => {
    const r = (await readResourceTool.call({ type: "dataset", id: "ds_1" }, ctx)) as {
      ok: true
      value: { records: unknown[]; def: { id: string } }
    }
    expect(Array.isArray(r.value.records)).toBe(true)
    expect(r.value.def.id).toBe("ds_1")
  })

  it("loads display", async () => {
    const r = (await readResourceTool.call(
      { type: "display", id: "disp_1" },
      ctx,
    )) as { ok: true; value: Record<string, unknown> }
    expect(r.value.mode).toBe("table")
  })

  it("loads rubric", async () => {
    const r = (await readResourceTool.call({ type: "rubric", id: "rub_1" }, ctx)) as {
      ok: true
      value: { criteria: unknown[] }
    }
    expect(r.value.criteria).toEqual([])
  })

  it("returns err(NOT_FOUND) on missing resource", async () => {
    const r = await readResourceTool.call({ type: "experiment", id: "nope" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
  })

  it("returns err(NOT_FOUND) on missing dataset (wrapped null)", async () => {
    const r = await readResourceTool.call({ type: "dataset", id: "nope" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
  })

  it("returns err(INVALID_INPUT) when type or id missing", async () => {
    const rNoType = await readResourceTool.call({ type: "" as never, id: "x" }, ctx)
    expect(rNoType).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    })
    const rNoId = await readResourceTool.call({ type: "experiment", id: "" }, ctx)
    expect(rNoId).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    })
  })

  // v0.18.7 G4: NOT_FOUND hint 按 type 给具体提示，避免 LLM 编 id（session repro
  // qooekg5n90 第 25/100 行：把 'tpl_aB92xkLq' 当 template id 反复试，实际应传 schema_id）
  it("NOT_FOUND for type=template hints to use schema_id, not 'tpl_xxx'", async () => {
    const r = await readResourceTool.call({ type: "template", id: "tpl_made_up" }, ctx) as {
      ok: false; error: { code: string; message: string; hint?: string }
    }
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe("NOT_FOUND")
    expect(r.error.hint).toContain("schema_id")
  })

  it("NOT_FOUND hint differs per type (template vs dataset vs rubric)", async () => {
    const tplR = await readResourceTool.call({ type: "template", id: "x" }, ctx) as { error: { hint: string } }
    const dsR = await readResourceTool.call({ type: "dataset", id: "x" }, ctx) as { error: { hint: string } }
    const rbR = await readResourceTool.call({ type: "rubric", id: "x" }, ctx) as { error: { hint: string } }
    expect(tplR.error.hint).not.toBe(dsR.error.hint)
    expect(tplR.error.hint).not.toBe(rbR.error.hint)
    expect(dsR.error.hint).not.toBe(rbR.error.hint)
  })
})
