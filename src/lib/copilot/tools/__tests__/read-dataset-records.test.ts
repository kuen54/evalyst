import { describe, it, expect, vi } from "vitest"
import { readDatasetRecordsTool } from "../read-dataset-records"

vi.mock("@/lib/datasets", () => ({
  getDataset: (id: string) => {
    if (id === "ds_1") {
      return {
        def: {
          id: "ds_1",
          name: "QA",
          source: "upload",
          path: "/tmp/x",
          fields: [
            { key: "qa_id", type: "string" },
            { key: "q", type: "string" },
          ],
          id_field: "qa_id",
        },
        records: Array.from({ length: 25 }, (_, i) => ({
          qa_id: `q${i + 1}`,
          q: `question ${i + 1}`,
        })),
      }
    }
    throw new Error("not found")
  },
}))

const ctx = { session_id: "s", signal: new AbortController().signal }

describe("readDatasetRecordsTool", () => {
  it("metadata: read-only, not destructive, max 8000", () => {
    expect(readDatasetRecordsTool.metadata.isReadOnly).toBe(true)
    expect(readDatasetRecordsTool.metadata.isDestructive).toBe(false)
    expect(readDatasetRecordsTool.metadata.maxResultSizeChars).toBe(8000)
  })

  it("default returns first 5 records, has_more=true", async () => {
    const r = (await readDatasetRecordsTool.call({ dataset_id: "ds_1" }, ctx)) as {
      ok: true
      value: {
        records: Array<Record<string, unknown>>
        total: number
        has_more: boolean
      }
    }
    expect(r.ok).toBe(true)
    expect(r.value.records).toHaveLength(5)
    expect(r.value.records[0]).toMatchObject({ qa_id: "q1" })
    expect(r.value.total).toBe(25)
    expect(r.value.has_more).toBe(true)
  })

  it("limit clamped to 20", async () => {
    const r = (await readDatasetRecordsTool.call(
      { dataset_id: "ds_1", limit: 100 },
      ctx,
    )) as {
      ok: true
      value: { records: Array<Record<string, unknown>>; has_more: boolean }
    }
    expect(r.value.records).toHaveLength(20)
    expect(r.value.has_more).toBe(true)
  })

  it("offset + limit pagination", async () => {
    const r = (await readDatasetRecordsTool.call(
      { dataset_id: "ds_1", limit: 5, offset: 20 },
      ctx,
    )) as {
      ok: true
      value: { records: Array<Record<string, unknown>>; has_more: boolean }
    }
    expect(r.value.records).toHaveLength(5)
    expect(r.value.records[0]).toMatchObject({ qa_id: "q21" })
    expect(r.value.has_more).toBe(false)
  })

  it("task_id matches by id_field", async () => {
    const r = (await readDatasetRecordsTool.call(
      { dataset_id: "ds_1", task_id: "q7" },
      ctx,
    )) as {
      ok: true
      value: {
        records: Array<Record<string, unknown>>
        has_more: boolean
        total: number
      }
    }
    expect(r.value.records).toEqual([{ qa_id: "q7", q: "question 7" }])
    expect(r.value.has_more).toBe(false)
    expect(r.value.total).toBe(25)
  })

  it("task_id miss returns empty records, has_more=false", async () => {
    const r = (await readDatasetRecordsTool.call(
      { dataset_id: "ds_1", task_id: "nope" },
      ctx,
    )) as {
      ok: true
      value: {
        records: Array<Record<string, unknown>>
        total: number
        has_more: boolean
      }
    }
    expect(r.value.records).toEqual([])
    expect(r.value.total).toBe(25)
    expect(r.value.has_more).toBe(false)
  })

  it("returns err(NOT_FOUND) when dataset not found", async () => {
    const r = await readDatasetRecordsTool.call({ dataset_id: "nope" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
  })

  it("returns err(INVALID_INPUT) when dataset_id missing", async () => {
    const r = await readDatasetRecordsTool.call({ dataset_id: "" as never }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("dataset_id") },
    })
  })
})
