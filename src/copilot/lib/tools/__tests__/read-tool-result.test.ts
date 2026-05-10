import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { readToolResultTool } from "../read-tool-result.server"
import { maybePersistToolResult } from "../../tool-result-store"

let testDir: string
let originalCwd: string
const ctx = { session_id: "sess_ttr", signal: new AbortController().signal }

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-tr-"))
  originalCwd = process.cwd()
  process.chdir(testDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("read_tool_result tool", () => {
  it("metadata is read-only", () => {
    expect(readToolResultTool.metadata.isReadOnly).toBe(true)
    expect(readToolResultTool.metadata.isDestructive).toBe(false)
  })

  it("retrieves a persisted payload by full ref URL (returns ok)", async () => {
    const big = { body: "x".repeat(5000), marker: "A" }
    const persisted = await maybePersistToolResult(ctx.session_id, big, 1000)
    if (persisted.kind !== "ref") throw new Error("expected ref")
    const r = (await readToolResultTool.call({ ref: persisted.ref }, ctx)) as {
      ok: true
      value: unknown
    }
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(big)
  })

  it("retrieves by bare id too (returns ok)", async () => {
    const big = { body: "y".repeat(5000) }
    const persisted = await maybePersistToolResult(ctx.session_id, big, 1000)
    if (persisted.kind !== "ref") throw new Error("expected ref")
    const id = persisted.ref.replace("ref://tool-result/", "")
    const r = (await readToolResultTool.call({ ref: id }, ctx)) as {
      ok: true
      value: unknown
    }
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(big)
  })

  it("returns err(NOT_FOUND) on missing ref (ENOENT mapped to NOT_FOUND)", async () => {
    // v0.9.3 review cleanup: 之前 ENOENT 被 runTool 兜底成 INTERNAL；现在 tool 层显式
    // map 成 NOT_FOUND，与 read_resource / edit_template / restart_experiment 等一致。
    const r = await readToolResultTool.call({ ref: "tr_nope" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("not found"),
      },
    })
  })

  it("rejects empty ref with err(INVALID_INPUT)", async () => {
    const r = await readToolResultTool.call({ ref: "" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("ref") },
    })
  })
})
