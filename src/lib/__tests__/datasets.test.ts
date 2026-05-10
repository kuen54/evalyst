import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getDataset,
  listDatasets,
  getDatasetSummary,
  createDatasetFromJson,
  validateDatasetJson,
  updateCustomDataset,
  deleteCustomDataset,
  inferFieldsFromJsonl,
} from "@/lib/datasets"
import type { DatasetDef, FieldDef } from "@/lib/schema/types"

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r2-dataset-"))
  fs.mkdirSync(path.join(tmp, "data"))
  process.chdir(tmp)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function dsDir() {
  return path.join(tmp, "data", "datasets")
}

function seedDataset(id: string, def: Partial<DatasetDef>, records: Record<string, unknown>[]) {
  fs.mkdirSync(dsDir(), { recursive: true })
  const fullDef: DatasetDef = {
    id,
    name: def.name ?? `DS ${id}`,
    source: def.source ?? "upload",
    id_field: def.id_field ?? "id",
    fields: def.fields ?? [
      { key: "id", type: "string" },
      { key: "label", type: "string" },
    ],
    path: `data/datasets/${id}.jsonl`,
    created_at: def.created_at ?? new Date().toISOString(),
  }
  fs.writeFileSync(path.join(dsDir(), `${id}.meta.json`), JSON.stringify(fullDef))
  fs.writeFileSync(
    path.join(dsDir(), `${id}.jsonl`),
    records.map(r => JSON.stringify(r)).join("\n") + "\n",
  )
  return fullDef
}

const SIMPLE_FIELDS: FieldDef[] = [
  { key: "id", type: "string" },
  { key: "title", type: "string" },
]

describe("validateDatasetJson", () => {
  it("flags non-object input and 5 missing/empty top-level fields", () => {
    expect(validateDatasetJson("not an object").ok).toBe(false)
    expect(validateDatasetJson(null).ok).toBe(false)

    const empty = validateDatasetJson({})
    expect(empty.ok).toBe(false)
    const fields = empty.errors.map(e => e.field)
    expect(fields).toEqual(expect.arrayContaining(["id", "name", "id_field", "fields", "records"]))

    const ok = validateDatasetJson({
      id: "x",
      name: "X",
      id_field: "id",
      fields: SIMPLE_FIELDS,
      records: [{ id: "a" }],
    })
    expect(ok.ok).toBe(true)
    expect(ok.errors).toEqual([])
  })
})

describe("createDatasetFromJson", () => {
  it("writes both files on happy path; rejects bad id regex / dup id / id_field not in fields", () => {
    const created = createDatasetFromJson({
      id: "ds_one",
      name: "DS One",
      id_field: "id",
      fields: SIMPLE_FIELDS,
      records: [{ id: "a", title: "alpha" }, { id: "b", title: "beta" }],
    })
    expect(created.id).toBe("ds_one")
    expect(created.source).toBe("upload")
    expect(fs.existsSync(path.join(dsDir(), "ds_one.meta.json"))).toBe(true)
    expect(fs.existsSync(path.join(dsDir(), "ds_one.jsonl"))).toBe(true)

    expect(() =>
      createDatasetFromJson({
        id: "Bad-Id",
        name: "x",
        id_field: "id",
        fields: SIMPLE_FIELDS,
        records: [{ id: "a" }],
      }),
    ).toThrow(/Invalid id/)

    expect(() =>
      createDatasetFromJson({
        id: "ds_one",
        name: "Dup",
        id_field: "id",
        fields: SIMPLE_FIELDS,
        records: [{ id: "z" }],
      }),
    ).toThrow(/already exists/)

    expect(() =>
      createDatasetFromJson({
        id: "ds_two",
        name: "x",
        id_field: "missing",
        fields: SIMPLE_FIELDS,
        records: [{ id: "a" }],
      }),
    ).toThrow(/id_field "missing" not in fields/)
  })
})

describe("listDatasets", () => {
  it("returns [] when empty; lists all datasets with record_count populated", () => {
    expect(listDatasets()).toEqual([])

    seedDataset("a_one", {}, [{ id: "a" }, { id: "b" }, { id: "c" }])
    seedDataset("z_two", {}, [{ id: "x" }])

    const list = listDatasets()
    expect(list).toHaveLength(2)
    const a = list.find(d => d.id === "a_one")!
    const z = list.find(d => d.id === "z_two")!
    expect(a.record_count).toBe(3)
    expect(z.record_count).toBe(1)
  })
})

describe("getDataset / getDatasetSummary", () => {
  it("returns def+records on success; throws on missing meta or missing jsonl; sample capped at 5", () => {
    const records = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `t${i}` }))
    seedDataset("big", {}, records)

    const got = getDataset("big")
    expect(got.records).toHaveLength(12)
    expect(got.def.id).toBe("big")

    const summary = getDatasetSummary("big")
    expect(summary.record_count).toBe(12)
    expect(summary.sample).toHaveLength(5)
    expect(summary.sample[0]).toEqual({ id: "r0", title: "t0" })

    expect(() => getDataset("nonexistent")).toThrow(/Dataset not found/)

    // meta exists but jsonl missing → "Dataset file missing"
    fs.writeFileSync(path.join(dsDir(), "orphan.meta.json"), JSON.stringify({ id: "orphan" }))
    expect(() => getDataset("orphan")).toThrow(/Dataset file missing/)
  })
})

describe("updateCustomDataset", () => {
  it("happy path: persists new name + new records to disk", () => {
    seedDataset("editable", {}, [{ id: "a", title: "alpha" }])

    const updated = updateCustomDataset("editable", {
      name: "Renamed",
      records: [{ id: "b", title: "bravo" }, { id: "c", title: "charlie" }],
    })
    expect(updated.name).toBe("Renamed")

    const reloaded = getDataset("editable")
    expect(reloaded.def.name).toBe("Renamed")
    expect(reloaded.records).toEqual([
      { id: "b", title: "bravo" },
      { id: "c", title: "charlie" },
    ])
  })

  it.each<[string, () => void, RegExp]>([
    [
      "rejects unknown id (NOT_FOUND)",
      () => {
        updateCustomDataset("missing_id", { name: "x" })
      },
      /Dataset not found/,
    ],
    [
      "rejects empty fields",
      () => {
        seedDataset("e1", {}, [{ id: "a" }])
        updateCustomDataset("e1", { fields: [] })
      },
      /fields must be non-empty/,
    ],
    [
      "rejects duplicate field keys",
      () => {
        seedDataset("e2", {}, [{ id: "a" }])
        updateCustomDataset("e2", {
          fields: [
            { key: "dupe", type: "string" },
            { key: "dupe", type: "string" },
          ],
          id_field: "dupe",
        })
      },
      /duplicate field key/,
    ],
    [
      "rejects id_field not present in fields",
      () => {
        seedDataset("e3", {}, [{ id: "a" }])
        updateCustomDataset("e3", { id_field: "ghost" })
      },
      /id_field "ghost" not in fields/,
    ],
  ])("%s", (_label, run, msg) => {
    expect(run).toThrow(msg)
  })
})

describe("deleteCustomDataset", () => {
  it("returns true when any file is removed; false when neither exists", () => {
    seedDataset("full", {}, [{ id: "a" }])
    expect(deleteCustomDataset("full")).toBe(true)
    expect(fs.existsSync(path.join(dsDir(), "full.meta.json"))).toBe(false)
    expect(fs.existsSync(path.join(dsDir(), "full.jsonl"))).toBe(false)

    fs.mkdirSync(dsDir(), { recursive: true })
    fs.writeFileSync(path.join(dsDir(), "meta_only.meta.json"), '{"id":"meta_only"}')
    expect(deleteCustomDataset("meta_only")).toBe(true)

    expect(deleteCustomDataset("never_was")).toBe(false)
  })
})

describe("inferFieldsFromJsonl · type inference", () => {
  it("infers string / number / boolean / array / object / url across keys", () => {
    const lines = [
      JSON.stringify({
        s: "plain text",
        n: 42,
        b: true,
        arr: [1, 2, 3],
        obj: { nested: 1 },
        link: "https://example.com/x",
      }),
    ]
    const r = inferFieldsFromJsonl(lines.join("\n"))
    expect(r.error).toBeUndefined()
    expect(r.total_lines).toBe(1)
    expect(r.preview).toHaveLength(1)

    const byKey = Object.fromEntries(r.fields.map(f => [f.key, f.type]))
    expect(byKey).toEqual({
      s: "string",
      n: "number",
      b: "boolean",
      arr: "array",
      obj: "object",
      link: "url",
    })
  })
})

describe("inferFieldsFromJsonl · edges", () => {
  it("returns parse error with line number; reports total_lines but caps sampling at sampleSize", () => {
    const broken = inferFieldsFromJsonl('{"a":1}\n{not valid json\n{"a":3}')
    expect(broken.fields).toEqual([])
    expect(broken.preview).toEqual([])
    expect(broken.error).toMatch(/^Line 2:/)
    expect(broken.total_lines).toBe(3)

    expect(inferFieldsFromJsonl("").error).toMatch(/No valid JSON objects/)
    // 全是 JSON 数组 / 字符串 → 没有 record-shaped object，fall through 到 No valid
    expect(inferFieldsFromJsonl('[1,2]\n"plain"').error).toMatch(/No valid JSON objects/)

    // sampleSize cap：传 30 行，sampleSize=2 只看 preview 2 个；total_lines 仍 30
    const lines = Array.from({ length: 30 }, (_, i) => JSON.stringify({ id: `r${i}` }))
    const capped = inferFieldsFromJsonl(lines.join("\n"), 2)
    expect(capped.preview).toHaveLength(2)
    expect(capped.total_lines).toBe(30)
    expect(capped.fields.map(f => f.key)).toEqual(["id"])
  })
})
