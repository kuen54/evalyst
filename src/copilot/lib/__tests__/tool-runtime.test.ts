import { describe, it, expect } from "vitest"
import { runTool } from "../tool-runtime"
import { ok, err } from "../tools/tool-result"
import type { ToolDescriptor } from "../tools/types"

function fakeTool(call: ToolDescriptor["call"]): ToolDescriptor {
  return {
    name: "t",
    description: "fake",
    inputSchema: { type: "object" },
    metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 },
    call,
  }
}

const ctx = { session_id: "s", signal: new AbortController().signal }

describe("runTool with ToolResult (v2.5 P2)", () => {
  it("tool returns raw output → kind: done (legacy compatible)", async () => {
    const r = await runTool(fakeTool(async () => ({ x: 1 })), {}, ctx, { skipConfirm: true })
    expect(r.kind).toBe("done")
    // payloadGuardHook 把 output 包成 ToolResultContent.inline；inline.value 是真正的 tool 返回
    if (r.kind === "done") expect(r.output).toEqual({ kind: "inline", value: { x: 1 } })
  })

  it("tool returns ok(value) → kind: done with unwrapped value", async () => {
    const r = await runTool(fakeTool(async () => ok({ x: 1 })), {}, ctx, { skipConfirm: true })
    expect(r.kind).toBe("done")
    // ok(...) 先被 runTool unwrap 出 value, 再走 payloadGuardHook → inline.value 应该等于原 value（不是 ToolResult shape）
    if (r.kind === "done") expect(r.output).toEqual({ kind: "inline", value: { x: 1 } })
  })

  it("tool returns err(...) → kind: error with code + message + hint preserved", async () => {
    const r = await runTool(
      fakeTool(async () => err("NOT_FOUND", "gone", { hint: "try other id" })),
      {},
      ctx,
      { skipConfirm: true },
    )
    expect(r.kind).toBe("error")
    if (r.kind === "error") {
      expect(r.error.code).toBe("NOT_FOUND")
      expect(r.error.message).toBe("gone")
      expect(r.error.hint).toBe("try other id")
    }
  })

  it("tool throws Error → kind: error with code: INTERNAL + retry_safe: false", async () => {
    const r = await runTool(
      fakeTool(async () => { throw new Error("boom") }),
      {},
      ctx,
      { skipConfirm: true },
    )
    expect(r.kind).toBe("error")
    if (r.kind === "error") {
      expect(r.error.code).toBe("INTERNAL")
      expect(r.error.message).toBe("boom")
      expect(r.error.retry_safe).toBe(false)
    }
  })

  it("tool throws non-Error value → kind: error with String() message", async () => {
    const r = await runTool(
      fakeTool(async () => { throw "string-thrown" }),
      {},
      ctx,
      { skipConfirm: true },
    )
    expect(r.kind).toBe("error")
    if (r.kind === "error") expect(r.error.message).toBe("string-thrown")
  })
})
