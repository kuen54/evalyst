import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { listRubrics, getRubric, saveRubric, deleteRubric } from "@/lib/rubric-store"
import type { Rubric } from "@/lib/schema/types"

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r2-rubric-"))
  fs.mkdirSync(path.join(tmp, "data"))
  process.chdir(tmp)
  // ensureSeeds 在 chdir tmp 下 src/lib/seeds 不存在 → silent noop；
  // listRubrics 对 broken JSON 会 console.error，不验证内容只静音。
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function writeRubricFile(id: string, body: unknown) {
  const dir = path.join(tmp, "data", "rubrics")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.json`), typeof body === "string" ? body : JSON.stringify(body))
}

function makeRubric(id: string, overrides: Partial<Rubric> = {}): Rubric {
  return {
    id,
    name: `Rubric ${id}`,
    criteria: [{ key: "ok", label: "OK", type: "pass_fail" }],
    ...overrides,
  }
}

describe("listRubrics", () => {
  it("returns [] when rubrics dir is empty (and seed silently noops)", () => {
    expect(listRubrics()).toEqual([])
    // 仍创建 dir（ensureDir 副作用），不抛
    expect(fs.existsSync(path.join(tmp, "data", "rubrics"))).toBe(true)
  })

  it("returns sorted rubrics; broken JSON is skipped, not thrown", () => {
    writeRubricFile("z_last", makeRubric("z_last"))
    writeRubricFile("a_first", makeRubric("a_first"))
    writeRubricFile("broken", "{not valid json")

    const out = listRubrics()
    expect(out).toHaveLength(2)
    expect(out[0]!.id).toBe("a_first")
    expect(out[1]!.id).toBe("z_last")
    // 缺省 source 注入 'user'
    expect(out[0]!.source).toBe("user")
  })
})

describe("getRubric", () => {
  it("returns null when file is missing or JSON is corrupted", () => {
    expect(getRubric("nonexistent")).toBeNull()

    writeRubricFile("corrupted", "{ broken")
    expect(getRubric("corrupted")).toBeNull()
  })

  it("preserves explicit source='builtin' but defaults missing source to 'user'", () => {
    writeRubricFile("builtin_one", makeRubric("builtin_one", { source: "builtin" }))
    writeRubricFile("plain_one", makeRubric("plain_one"))

    expect(getRubric("builtin_one")?.source).toBe("builtin")
    expect(getRubric("plain_one")?.source).toBe("user")
  })
})

describe("saveRubric", () => {
  it("creates a new file with auto source='user' and overwrites existing", () => {
    const created = saveRubric(makeRubric("r1"))
    expect(created.source).toBe("user")

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmp, "data", "rubrics", "r1.json"), "utf-8"),
    ) as Rubric
    expect(onDisk.id).toBe("r1")
    expect(onDisk.source).toBe("user")

    // 覆盖：改 name 后再 save，文件被覆写；显式 source='builtin' 不被踩
    const overwritten = saveRubric(makeRubric("r1", { name: "renamed", source: "builtin" }))
    expect(overwritten.source).toBe("builtin")
    expect(overwritten.name).toBe("renamed")

    const reread = JSON.parse(
      fs.readFileSync(path.join(tmp, "data", "rubrics", "r1.json"), "utf-8"),
    ) as Rubric
    expect(reread.name).toBe("renamed")
    expect(reread.source).toBe("builtin")
  })
})

describe("deleteRubric", () => {
  it("removes existing file and returns true; returns false when missing", () => {
    writeRubricFile("doomed", makeRubric("doomed"))
    expect(deleteRubric("doomed")).toBe(true)
    expect(fs.existsSync(path.join(tmp, "data", "rubrics", "doomed.json"))).toBe(false)

    expect(deleteRubric("never_existed")).toBe(false)
    expect(deleteRubric("doomed")).toBe(false)
  })
})
