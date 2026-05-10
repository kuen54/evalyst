import { describe, it, expect } from "vitest"
import { normalizeToolResult } from "../session-store"

describe("normalizeToolResult", () => {
  it("wraps bare output object as inline", () => {
    const bare = { a: 1 }
    expect(normalizeToolResult(bare)).toEqual({ kind: "inline", value: bare })
  })

  it("parses JSON string and wraps if no kind", () => {
    const jsonStr = JSON.stringify({ x: 2 })
    expect(normalizeToolResult(jsonStr)).toEqual({ kind: "inline", value: { x: 2 } })
  })

  it("preserves inline shape from string", () => {
    const jsonStr = JSON.stringify({ kind: "inline", value: { y: 3 } })
    expect(normalizeToolResult(jsonStr)).toEqual({ kind: "inline", value: { y: 3 } })
  })

  it("preserves ref shape from string", () => {
    const jsonStr = JSON.stringify({ kind: "ref", ref: "ref://tool-result/tr_abc", preview: "..." })
    expect(normalizeToolResult(jsonStr)).toEqual({
      kind: "ref",
      ref: "ref://tool-result/tr_abc",
      preview: "...",
    })
  })

  it("preserves compacted shape from string", () => {
    const jsonStr = JSON.stringify({ kind: "compacted", summary: "archived", ref: "ref://tool-result/tr_z" })
    expect(normalizeToolResult(jsonStr)).toEqual({
      kind: "compacted",
      summary: "archived",
      ref: "ref://tool-result/tr_z",
    })
  })

  it("preserves already-parsed ToolResultContent object", () => {
    const content = { kind: "ref" as const, ref: "ref://tool-result/x", preview: "p" }
    expect(normalizeToolResult(content)).toBe(content)
  })

  it("handles non-JSON strings by wrapping as inline string", () => {
    expect(normalizeToolResult("not json")).toEqual({ kind: "inline", value: "not json" })
  })

  it("unknown kind is coerced back to inline wrapping the whole parsed object", () => {
    const weird = { kind: "something_else", value: 42 }
    expect(normalizeToolResult(weird)).toEqual({ kind: "inline", value: weird })
  })
})
