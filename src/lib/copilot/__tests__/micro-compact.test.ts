import { describe, it, expect } from "vitest"
import { microCompact, parseRefId } from "../micro-compact"
import { normalizeToolResult } from "../session-store"
import type { CopilotMessage, ToolResultContent } from "../types"

function userMsg(id: string, text: string): CopilotMessage {
  return { id, session_id: "s", role: "user", content: text, timestamp: "t" }
}
function asstMsg(id: string, text: string): CopilotMessage {
  return { id, session_id: "s", role: "assistant", content: text, timestamp: "t" }
}
function toolUseMsg(id: string, call_id: string, tool_name: string): CopilotMessage {
  return {
    id,
    session_id: "s",
    role: "tool_use",
    content: JSON.stringify({}),
    timestamp: "t",
    call_id,
    tool_name,
    tool_input: {},
  }
}
function toolResultMsg(
  id: string,
  call_id: string,
  tool_name: string,
  content: ToolResultContent,
): CopilotMessage {
  return {
    id,
    session_id: "s",
    role: "tool_result",
    content: JSON.stringify(content),
    timestamp: "t",
    call_id,
    tool_name,
  }
}

describe("parseRefId", () => {
  it("extracts id from ref URL", () => {
    expect(parseRefId("ref://tool-result/tr_abc123")).toBe("tr_abc123")
  })
  it("returns undefined on invalid input", () => {
    expect(parseRefId("garbage")).toBeUndefined()
    expect(parseRefId("")).toBeUndefined()
    expect(parseRefId("ref://other/tr_abc")).toBeUndefined()
  })
  it("captures suffix with dashes / underscores", () => {
    expect(parseRefId("ref://tool-result/tr_abc-def_123")).toBe("tr_abc-def_123")
  })
})

describe("microCompact", () => {
  it("keeps most recent N read tool_results, compacts older ones", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p1",
      }),
      toolResultMsg("m2", "c2", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_2",
        preview: "p2",
      }),
      toolResultMsg("m3", "c3", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_3",
        preview: "p3",
      }),
      toolResultMsg("m4", "c4", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_4",
        preview: "p4",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 2 })
    expect(normalizeToolResult(out[0].content).kind).toBe("compacted")
    expect(normalizeToolResult(out[1].content).kind).toBe("compacted")
    expect(normalizeToolResult(out[2].content).kind).toBe("ref")
    expect(normalizeToolResult(out[3].content).kind).toBe("ref")
  })

  it("preserves non-tool messages verbatim", () => {
    const messages: CopilotMessage[] = [
      userMsg("u1", "hi"),
      toolUseMsg("tu1", "c1", "list_experiments"),
      toolResultMsg("tr1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "x",
      }),
      asstMsg("a1", "hello"),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 0 })
    expect(out[0]).toBe(messages[0]) // exact same object (user untouched)
    expect(out[1]).toBe(messages[1]) // tool_use untouched
    expect(out[3]).toBe(messages[3]) // assistant untouched
    // Only index 2 should be compacted
    expect(normalizeToolResult(out[2].content).kind).toBe("compacted")
  })

  it("does NOT compact write tool results (restart_experiment)", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "restart_experiment", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p",
      }),
      toolResultMsg("m2", "c2", "restart_experiment", {
        kind: "ref",
        ref: "ref://tool-result/tr_2",
        preview: "p",
      }),
      toolResultMsg("m3", "c3", "restart_experiment", {
        kind: "ref",
        ref: "ref://tool-result/tr_3",
        preview: "p",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 1 })
    for (const m of out) {
      expect(normalizeToolResult(m.content).kind).toBe("ref")
    }
  })

  it("treats unknown tool names as not replayable (leaves them alone)", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "nonexistent_tool_xyz", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p",
      }),
      toolResultMsg("m2", "c2", "nonexistent_tool_xyz", {
        kind: "ref",
        ref: "ref://tool-result/tr_2",
        preview: "p",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 0 })
    // Both untouched — unknown tool name treated as not replayable
    for (const m of out) {
      expect(normalizeToolResult(m.content).kind).toBe("ref")
    }
  })

  it("handles inline tool_result (no ref) — summary has no ref hint", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "inline",
        value: { experiments: [{ id: "a" }] },
      }),
      toolResultMsg("m2", "c2", "list_experiments", {
        kind: "inline",
        value: { experiments: [{ id: "b" }] },
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 1 })
    const first = normalizeToolResult(out[0].content)
    expect(first.kind).toBe("compacted")
    if (first.kind === "compacted") {
      expect(first.ref).toBeUndefined()
      expect(first.summary).toContain("not persisted")
    }
    expect(normalizeToolResult(out[1].content).kind).toBe("inline")
  })

  it("ref case: summary includes read_tool_result hint with the exact ref", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_xyz",
        preview: "p",
      }),
      toolResultMsg("m2", "c2", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_abc",
        preview: "p",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 1 })
    const first = normalizeToolResult(out[0].content)
    expect(first.kind).toBe("compacted")
    if (first.kind === "compacted") {
      expect(first.ref).toBe("ref://tool-result/tr_xyz")
      expect(first.summary).toContain("read_tool_result")
      expect(first.summary).toContain("ref://tool-result/tr_xyz")
    }
  })

  it("is a no-op when there are fewer tool_results than keep threshold", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 3 })
    expect(out[0]).toBe(messages[0])
  })

  it("keepRecentReadResults=0 compacts ALL replayable tool_results", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p",
      }),
      toolResultMsg("m2", "c2", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_2",
        preview: "p",
      }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 0 })
    for (const m of out) {
      expect(normalizeToolResult(m.content).kind).toBe("compacted")
    }
  })

  it("mixes read + write: only read are eligible", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_1",
        preview: "p",
      }),
      toolResultMsg("m2", "c2", "restart_experiment", {
        kind: "inline",
        value: { started: true },
      }),
      toolResultMsg("m3", "c3", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_3",
        preview: "p",
      }),
      toolResultMsg("m4", "c4", "list_experiments", {
        kind: "ref",
        ref: "ref://tool-result/tr_4",
        preview: "p",
      }),
    ]
    // keep 1 read → older reads compact, write untouched
    const out = microCompact(messages, { keepRecentReadResults: 1 })
    expect(normalizeToolResult(out[0].content).kind).toBe("compacted") // read #1 compacted
    expect(normalizeToolResult(out[1].content).kind).toBe("inline") // write untouched
    expect(normalizeToolResult(out[2].content).kind).toBe("compacted") // read #2 compacted
    expect(normalizeToolResult(out[3].content).kind).toBe("ref") // last read kept
  })
})
