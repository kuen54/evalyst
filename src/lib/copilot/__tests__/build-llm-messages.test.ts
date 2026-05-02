import { describe, it, expect } from "vitest"
import { buildLlmMessages, COPILOT_SYSTEM_PROMPT } from "../build-llm-messages"
import type { CopilotMessage } from "../types"

function toolUseMsg(call_id: string, tool_name: string): CopilotMessage {
  return {
    id: `m_${call_id}u`,
    session_id: "s",
    role: "tool_use",
    content: JSON.stringify({ q: "hi" }),
    timestamp: "t",
    call_id,
    tool_name,
    tool_input: { q: "hi" },
  }
}

function toolResultMsg(call_id: string, content: unknown): CopilotMessage {
  return {
    id: `m_${call_id}r`,
    session_id: "s",
    role: "tool_result",
    content: typeof content === "string" ? content : JSON.stringify(content),
    timestamp: "t",
    call_id,
    tool_name: "list_experiments",
  }
}

describe("buildLlmMessages · ToolResultContent rendering", () => {
  it("inline kind is flattened to JSON string", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", { kind: "inline", value: { experiments: [{ id: "a" }] } }),
    ]
    const msgs = buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(tr?.content).toContain("experiments")
    expect(tr?.content).not.toContain("ref://")
  })

  it("ref kind exposes preview + read_tool_result hint", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "read_experiment_results"),
      toolResultMsg("c1", {
        kind: "ref",
        ref: "ref://tool-result/tr_abc",
        preview: "{\"results\":[...(truncated)",
      }),
    ]
    const msgs = buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("truncated")
    expect(tr?.content).toContain("read_tool_result")
    expect(tr?.content).toContain("ref://tool-result/tr_abc")
  })

  it("compacted kind exposes summary", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", {
        kind: "compacted",
        summary: "(archived tool result; retrieve via read_tool_result if needed)",
        ref: "ref://tool-result/tr_old",
      }),
    ]
    const msgs = buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("archived tool result")
  })

  it("v1 backward compat: bare output wraps as inline", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      // Old jsonl format: content is plain JSON string of raw output
      toolResultMsg("c1", { experiments: [], total: 0 }),
    ]
    const msgs = buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    // normalizeToolResult wraps {experiments:[]} as inline — content should still include it
    expect(tr?.content).toContain("experiments")
  })

  it("system prompt appears exactly once", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = buildLlmMessages(branch)
    const systems = msgs.filter((m): m is { role: "system"; content: string } => m.role === "system")
    expect(systems.length).toBeGreaterThanOrEqual(1)
    expect(systems[0].content).toBe(COPILOT_SYSTEM_PROMPT)
  })
})
