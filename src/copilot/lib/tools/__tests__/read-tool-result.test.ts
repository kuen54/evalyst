import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { readToolResultTool } from "../read-tool-result.server"
import { maybePersistToolResult } from "../../tool-result-store"
import { runTool } from "../../tool-runtime"

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

  // Bug repro: session qooekg5n90 第 38-168 行 LLM 卡在 read_tool_result 死循环 26 次。
  // 原因：payloadGuardHook 见 read_tool_result 输出 > maxResultSizeChars 又把它落盘成新 ref，
  // LLM 拿新 ref 再调 read_tool_result，又 > maxResultSizeChars，再生新 ref。
  // skipPayloadGuard: true 修法——payloadGuardHook 见到强制 inline。
  it("returns kind:inline even when payload exceeds maxResultSizeChars (no ref→ref loop)", async () => {
    // Persist 一个 20KB payload；任何合理 size 阈值都会 > 之
    const big = { body: "x".repeat(20000), marker: "huge" }
    const persisted = await maybePersistToolResult(ctx.session_id, big, 1000)
    if (persisted.kind !== "ref") throw new Error("setup expected ref")

    // 走完整 runTool pipeline（含 payloadGuardHook），之前会拿到 kind:"ref"，导致死循环
    const r = await runTool(readToolResultTool, { ref: persisted.ref }, ctx, { skipConfirm: true })

    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      const out = r.output as { kind: string; value?: unknown; ref?: string }
      expect(out.kind).toBe("inline")
      expect(out.ref).toBeUndefined()
      expect(out.value).toEqual(big)
    }
  })
})
