import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  listDisplays,
  getDisplay,
  createUserDisplay,
  deleteUserDisplay,
  validateDisplay,
} from "@/lib/displays"
import type { Display } from "@/lib/schema/types"

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r2-display-"))
  fs.mkdirSync(path.join(tmp, "data"))
  process.chdir(tmp)
  // listDisplays 静默吞 broken JSON（无 console.error）；
  // ensureSeeds 走不到这条文件（displays 不在 seed 列表）。这里 spy 防御未来扩散。
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function writeUserDisplay(id: string, body: unknown) {
  const dir = path.join(tmp, "data", "displays")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    typeof body === "string" ? body : JSON.stringify(body),
  )
}

function makeUserDisplay(id: string, overrides: Partial<Display> = {}): Display {
  return {
    id,
    name: `User ${id}`,
    source: "user",
    mode: "table",
    table: { columns: [{ field: "output.x", label: "X" }] },
    ...overrides,
  }
}

const BUILTIN_IDS = [
  "builtin_single_list",
  "builtin_dual_list",
  "builtin_triple_grid",
  "builtin_bubble_overlay",
  "builtin_json_default",
]

describe("listDisplays", () => {
  it("returns the 5 builtins when user dir is empty; appends user JSON and skips broken JSON", () => {
    const empty = listDisplays()
    expect(empty.map(d => d.id)).toEqual(BUILTIN_IDS)
    expect(empty.every(d => d.source === "builtin")).toBe(true)

    writeUserDisplay("custom_one", makeUserDisplay("custom_one"))
    writeUserDisplay("broken", "{not valid json")
    const mixed = listDisplays()
    expect(mixed).toHaveLength(BUILTIN_IDS.length + 1)
    const user = mixed.find(d => d.id === "custom_one")!
    expect(user.source).toBe("user")
  })
})

describe("getDisplay", () => {
  it("dispatches across builtin / user / missing / corrupted with correct results", () => {
    expect(getDisplay("builtin_single_list")?.source).toBe("builtin")

    writeUserDisplay("u1", makeUserDisplay("u1"))
    expect(getDisplay("u1")?.source).toBe("user")

    expect(getDisplay("nonexistent")).toBeNull()

    writeUserDisplay("rotten", "{ broken")
    expect(getDisplay("rotten")).toBeNull()
  })
})

describe("createUserDisplay", () => {
  it("rejects builtin id, rejects bad id regex, and overwrites source='user' on success", () => {
    expect(() => createUserDisplay(makeUserDisplay("builtin_single_list"))).toThrow(
      /Cannot override builtin/,
    )

    expect(() => createUserDisplay(makeUserDisplay("Bad-Id"))).toThrow(/Invalid id/)
    expect(() => createUserDisplay(makeUserDisplay("9starts_with_digit"))).toThrow(/Invalid id/)

    // 即便 caller 传 source='builtin' 也被强制覆写成 'user'
    const created = createUserDisplay(makeUserDisplay("ok_id", { source: "builtin" }))
    expect(created.source).toBe("user")

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmp, "data", "displays", "ok_id.json"), "utf-8"),
    ) as Display
    expect(onDisk.source).toBe("user")
  })
})

describe("deleteUserDisplay", () => {
  it("returns false for builtin and missing; returns true after deleting an existing user file", () => {
    expect(deleteUserDisplay("builtin_single_list")).toBe(false)
    expect(deleteUserDisplay("never_existed")).toBe(false)

    writeUserDisplay("doomed", makeUserDisplay("doomed"))
    expect(deleteUserDisplay("doomed")).toBe(true)
    expect(fs.existsSync(path.join(tmp, "data", "displays", "doomed.json"))).toBe(false)
  })
})

describe("validateDisplay · top-level fields", () => {
  it("flags non-object input and missing/invalid id/name/mode", () => {
    const nonObj = validateDisplay("not an object")
    expect(nonObj.ok).toBe(false)
    expect(nonObj.errors[0]).toEqual({ field: "$", message: "must be a JSON object" })

    const nullInput = validateDisplay(null)
    expect(nullInput.ok).toBe(false)

    const missingAll = validateDisplay({})
    expect(missingAll.ok).toBe(false)
    const fields = missingAll.errors.map(e => e.field)
    expect(fields).toContain("id")
    expect(fields).toContain("name")
    expect(fields).toContain("mode")

    const badMode = validateDisplay({ id: "x", name: "X", mode: "garbage" })
    expect(badMode.ok).toBe(false)
    expect(badMode.errors.map(e => e.field)).toContain("mode")
  })
})

describe("validateDisplay · table mode", () => {
  it("requires non-empty columns; passes when columns is supplied", () => {
    const missing = validateDisplay({ id: "a", name: "A", mode: "table" })
    expect(missing.ok).toBe(false)
    expect(missing.errors.map(e => e.field)).toContain("table.columns")

    const empty = validateDisplay({ id: "a", name: "A", mode: "table", table: { columns: [] } })
    expect(empty.ok).toBe(false)

    const ok = validateDisplay({
      id: "a",
      name: "A",
      mode: "table",
      table: { columns: [{ field: "output.x", label: "X" }] },
    })
    expect(ok.ok).toBe(true)
    expect(ok.errors).toEqual([])
  })
})

describe("validateDisplay · grouped_grid mode", () => {
  it("requires primary_group / secondary_group / cell_columns; passes when supplied", () => {
    const missing = validateDisplay({ id: "a", name: "A", mode: "grouped_grid" })
    expect(missing.ok).toBe(false)
    expect(missing.errors.map(e => e.field)).toContain("grouped_grid")

    const partial = validateDisplay({
      id: "a",
      name: "A",
      mode: "grouped_grid",
      grouped_grid: { cell_columns: [] },
    })
    expect(partial.ok).toBe(false)
    const fields = partial.errors.map(e => e.field)
    expect(fields).toContain("grouped_grid.primary_group")
    expect(fields).toContain("grouped_grid.secondary_group")
    expect(fields).toContain("grouped_grid.cell_columns")

    const ok = validateDisplay({
      id: "a",
      name: "A",
      mode: "grouped_grid",
      grouped_grid: {
        primary_group: { field: "input.cat" },
        secondary_group: { field: "input.sub" },
        cell_columns: [{ field: "output.v", label: "V" }],
      },
    })
    expect(ok.ok).toBe(true)
  })
})

describe("validateDisplay · jsx mode", () => {
  it("requires non-empty source string; passes when supplied", () => {
    const missing = validateDisplay({ id: "a", name: "A", mode: "jsx" })
    expect(missing.ok).toBe(false)
    expect(missing.errors.map(e => e.field)).toContain("jsx.source")

    const blank = validateDisplay({ id: "a", name: "A", mode: "jsx", jsx: { source: "   " } })
    expect(blank.ok).toBe(false)

    const ok = validateDisplay({
      id: "a",
      name: "A",
      mode: "jsx",
      jsx: { source: "({ result }) => null" },
    })
    expect(ok.ok).toBe(true)
  })
})
