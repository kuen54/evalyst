import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { readToolResultTool } from "../read-tool-result"
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

  it("retrieves a persisted payload by full ref URL", async () => {
    const big = { body: "x".repeat(5000), marker: "A" }
    const persisted = await maybePersistToolResult(ctx.session_id, big, 1000)
    if (persisted.kind !== "ref") throw new Error("expected ref")
    const loaded = await readToolResultTool.call({ ref: persisted.ref }, ctx)
    expect(loaded).toEqual(big)
  })

  it("retrieves by bare id too", async () => {
    const big = { body: "y".repeat(5000) }
    const persisted = await maybePersistToolResult(ctx.session_id, big, 1000)
    if (persisted.kind !== "ref") throw new Error("expected ref")
    const id = persisted.ref.replace("ref://tool-result/", "")
    const loaded = await readToolResultTool.call({ ref: id }, ctx)
    expect(loaded).toEqual(big)
  })

  it("throws on missing ref", async () => {
    await expect(readToolResultTool.call({ ref: "tr_nope" }, ctx)).rejects.toThrow()
  })

  it("rejects empty ref", async () => {
    await expect(readToolResultTool.call({ ref: "" }, ctx)).rejects.toThrow()
  })
})
