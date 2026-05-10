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
  it("inline kind is flattened to JSON string", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", { kind: "inline", value: { experiments: [{ id: "a" }] } }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(tr?.content).toContain("experiments")
    expect(tr?.content).not.toContain("ref://")
  })

  it("ref kind exposes preview + read_tool_result hint", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "read_experiment_results"),
      toolResultMsg("c1", {
        kind: "ref",
        ref: "ref://tool-result/tr_abc",
        preview: "{\"results\":[...(truncated)",
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("truncated")
    expect(tr?.content).toContain("read_tool_result")
    expect(tr?.content).toContain("ref://tool-result/tr_abc")
  })

  it("compacted kind exposes summary", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", {
        kind: "compacted",
        summary: "(archived tool result; retrieve via read_tool_result if needed)",
        ref: "ref://tool-result/tr_old",
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("archived tool result")
  })

  it("v1 backward compat: bare output wraps as inline", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      // Old jsonl format: content is plain JSON string of raw output
      toolResultMsg("c1", { experiments: [], total: 0 }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    // normalizeToolResult wraps {experiments:[]} as inline — content should still include it
    expect(tr?.content).toContain("experiments")
  })

  it("system prompt is always first", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = await buildLlmMessages(branch)
    expect(msgs[0]!.role).toBe("system")
    if (msgs[0]!.role === "system") expect(msgs[0]!.content).toBe(COPILOT_SYSTEM_PROMPT)
  })

  it("SystemHeader system message is added when page context is present", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = await buildLlmMessages(branch, {
      route_type: "compare",
      path: "/compare",
      summary: {},
      timestamp: "t",
    })
    const systemMsgs = msgs.filter((m): m is { role: "system"; content: string } => m.role === "system")
    // first is COPILOT_SYSTEM_PROMPT; second is SystemHeader JSON
    expect(systemMsgs.length).toBeGreaterThanOrEqual(2)
    expect(systemMsgs[1]!.content).toContain("Session context")
    expect(systemMsgs[1]!.content).toContain("route_type")
    expect(systemMsgs[1]!.content).toContain("compare")
  })

  it("SystemHeader includes ctx_N for each user-circled context", async () => {
    const branch: CopilotMessage[] = [
      {
        id: "m_u1",
        session_id: "s",
        role: "user",
        content: "hi",
        timestamp: "t",
        contexts: [
          { tag: 1, type: "experiment", id: "exp_A" },
          { tag: 2, type: "task_field", id: "output.answer", extra: { experiment_id: "exp_A" } },
        ],
      },
    ]
    const msgs = await buildLlmMessages(branch, null)
    const systemMsgs = msgs.filter((m): m is { role: "system"; content: string } => m.role === "system")
    const header = systemMsgs.find((s) => s.content.startsWith("Session context"))
    expect(header).toBeTruthy()
    expect(header!.content).toContain("ctx_1")
    expect(header!.content).toContain("ctx_2")
    // no inline-resolution → no exp_A body leaked into system header
    expect(header!.content).not.toContain("\"name\":")
  })

  it("SystemHeader is not added when there are neither contexts nor page_context", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = await buildLlmMessages(branch, null)
    const systemMsgs = msgs.filter((m): m is { role: "system"; content: string } => m.role === "system")
    // Only COPILOT_SYSTEM_PROMPT, no header
    expect(systemMsgs.length).toBe(1)
  })

  it("microCompact: 5 read tool_results → older 2 become summary, newest 3 stay as ref/inline", async () => {
    // 5 consecutive read-only tool_results using list_experiments (read-only in registry).
    // Config in build-llm-messages keeps recent 3 → first 2 should be compacted.
    const branch: CopilotMessage[] = [
      { id: "u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    for (let i = 1; i <= 5; i++) {
      branch.push(toolUseMsg(`c${i}`, "list_experiments"))
      branch.push(
        toolResultMsg(`c${i}`, {
          kind: "ref",
          ref: `ref://tool-result/tr_${i}`,
          preview: `preview_${i}`,
        }),
      )
    }
    const msgs = await buildLlmMessages(branch)
    const toolResults = msgs.filter((m) => m.role === "tool_result")
    expect(toolResults).toHaveLength(5)

    // First 2 → compacted summary text ("archived tool result")
    expect(toolResults[0]!.content).toContain("archived tool result")
    expect(toolResults[1]!.content).toContain("archived tool result")

    // Newest 3 → preview + read_tool_result hint (ref kind rendering)
    for (let i = 2; i < 5; i++) {
      expect(toolResults[i]!.content).toContain(`preview_${i + 1}`)
      expect(toolResults[i]!.content).toContain("read_tool_result")
    }
  })
})

function userMsg(id: string, text: string): CopilotMessage {
  return { id, session_id: "s", role: "user", content: text, timestamp: "t" }
}

function asstMsg(id: string, parent_id: string, text: string): CopilotMessage {
  return { id, session_id: "s", parent_id, role: "assistant", content: text, timestamp: "t" }
}

describe("buildLlmMessages with compact_boundary (v2.5)", () => {
  it("skips messages before boundary in output", async () => {
    const branch: CopilotMessage[] = [
      userMsg("u1", "old"),
      asstMsg("a1", "u1", "old reply"),
      {
        id: "bd1",
        session_id: "s",
        role: "system",
        content: "",
        timestamp: "t",
        kind: "compact_boundary",
        at: "t",
      } as CopilotMessage,
      userMsg("u2", "new question"),
    ]
    const out = await buildLlmMessages(branch)
    const userContent = out
      .filter((m): m is { role: "user"; content: string } => m.role === "user")
      .map((m) => m.content)
    expect(userContent).toEqual(["new question"])
    const asstContent = out
      .filter((m): m is { role: "assistant"; content: string } => m.role === "assistant")
      .map((m) => m.content)
    expect(asstContent).toEqual([])
  })

  it("old session without boundary: no behavior change", async () => {
    const branch: CopilotMessage[] = [
      userMsg("u1", "q1"),
      asstMsg("a1", "u1", "a1"),
      userMsg("u2", "q2"),
    ]
    const out = await buildLlmMessages(branch)
    const userContent = out
      .filter((m): m is { role: "user"; content: string } => m.role === "user")
      .map((m) => m.content)
    expect(userContent).toEqual(["q1", "q2"])
  })

  it("system role (non-boundary) silently skipped in LlmMessages loop", async () => {
    const branch: CopilotMessage[] = [
      userMsg("u1", "hi"),
      {
        id: "sys",
        session_id: "s",
        role: "system",
        content: "ignored",
        timestamp: "t",
      } as CopilotMessage,
      userMsg("u2", "ho"),
    ]
    const out = await buildLlmMessages(branch)
    const textRoles = out.filter(
      (m): m is { role: "user" | "assistant" | "system"; content: string } =>
        m.role === "user" || m.role === "assistant" || m.role === "system",
    )
    expect(textRoles.filter((m) => m.content === "ignored")).toEqual([])
  })
})

describe("buildLlmMessages tool_result is_error (v2.5 P2)", () => {
  it("tool_result with new err shape → is_error: true", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "read_resource"),
      toolResultMsg("c1", {
        kind: "inline",
        value: { ok: false, error: { code: "NOT_FOUND", message: "gone" } },
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeDefined()
    expect((tr as { is_error?: boolean }).is_error).toBe(true)
  })

  it("tool_result with new ok shape → is_error falsy", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "read_resource"),
      toolResultMsg("c1", {
        kind: "inline",
        value: { ok: true, value: { results: [1, 2, 3] } },
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect((tr as { is_error?: boolean }).is_error).toBeFalsy()
  })

  it("tool_result with legacy { error: msg } → is_error: true (backward compat)", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "restart_experiment"),
      toolResultMsg("c1", {
        kind: "inline",
        value: { error: "experiment_id is required" },
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect((tr as { is_error?: boolean }).is_error).toBe(true)
  })

  it("tool_result with legacy { denied: true } → is_error: true", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "restart_experiment"),
      toolResultMsg("c1", {
        kind: "inline",
        value: { denied: true, reason: "user said no" },
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect((tr as { is_error?: boolean }).is_error).toBe(true)
  })

  it("tool_result with ref kind → is_error falsy (preview-only, can't classify)", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "read_experiment_results"),
      toolResultMsg("c1", {
        kind: "ref",
        ref: "ref://tool-result/tr_abc",
        preview: "{\"results\":[...truncated",
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect((tr as { is_error?: boolean }).is_error).toBeFalsy()
  })

  it("tool_result with plain success object → is_error falsy", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "q", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", {
        kind: "inline",
        value: { experiments: [{ id: "a" }] },
      }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect((tr as { is_error?: boolean }).is_error).toBeFalsy()
  })
})

