import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { runTool } from "../tool-runtime"
import type { AnyToolDescriptor } from "../tools/registry"

const readTool: AnyToolDescriptor = {
  name: "r",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
}

const writeTool: AnyToolDescriptor = {
  name: "w",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: false, isDestructive: true, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
}

const bigReadTool: AnyToolDescriptor = {
  name: "br",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
  call: async () => ({ body: "x".repeat(500) }),
}

const signal = new AbortController().signal

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtool-integ-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("runTool", () => {
  it("read tool runs through, output wrapped by payloadGuard as inline when small", async () => {
    const r = await runTool(readTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      expect(r.output).toEqual({ kind: "inline", value: { ok: 1 } })
    }
  })

  it("write tool short-circuits to awaiting_confirm", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("awaiting_confirm")
  })

  it("skipConfirm bypasses Confirm gate and runs the write; output wrapped inline", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal }, { skipConfirm: true })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      expect(r.output).toEqual({ kind: "inline", value: { ok: 1 } })
    }
  })

  it("large output gets persisted as ref via payloadGuard", async () => {
    const r = await runTool(bigReadTool, {}, { session_id: "sess_test", signal })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      const content = r.output as { kind: string; ref?: string; preview?: string }
      expect(content.kind).toBe("ref")
      expect(content.ref).toMatch(/^ref:\/\/tool-result\/tr_/)
      expect(content.preview).toContain("truncated")
    }
  })
})

