import { describe, it, expect } from "vitest"
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

const signal = new AbortController().signal

describe("runTool", () => {
  it("read tool runs through to done", async () => {
    const r = await runTool(readTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("done")
    if (r.kind === "done") expect(r.output).toEqual({ ok: 1 })
  })

  it("write tool short-circuits to awaiting_confirm", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("awaiting_confirm")
  })

  it("skipConfirm bypasses Confirm gate and runs the write", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal }, { skipConfirm: true })
    expect(r.kind).toBe("done")
  })
})
