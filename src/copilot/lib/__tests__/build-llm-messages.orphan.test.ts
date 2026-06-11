import { describe, it, expect } from "vitest"
import { fillOrphanToolResults, buildLlmMessages } from "../build-llm-messages"
import type { LlmMessage } from "@/lib/llm-client"
import type { CopilotMessage } from "../types"

function userMsg(id: string, content: string): CopilotMessage {
  return { id, session_id: "s", role: "user", content, timestamp: "t" }
}

function toolUseMsg(call_id: string): CopilotMessage {
  return {
    id: `m_${call_id}u`,
    session_id: "s",
    role: "tool_use",
    content: JSON.stringify({ q: "hi" }),
    timestamp: "t",
    call_id,
    tool_name: "read_page",
    tool_input: { q: "hi" },
  }
}

function toolResultMsg(call_id: string): CopilotMessage {
  return {
    id: `m_${call_id}r`,
    session_id: "s",
    role: "tool_result",
    content: JSON.stringify({ ok: true, value: { hits: [] } }),
    timestamp: "t",
    call_id,
    tool_name: "read_page",
  }
}

describe("fillOrphanToolResults", () => {
  it("returns input unchanged (same reference) when every tool_use has a tool_result", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool_use", call_id: "c1", tool_name: "read_page", tool_input: {} },
      { role: "tool_result", call_id: "c1", content: "{}" },
    ]
    expect(fillOrphanToolResults(messages)).toBe(messages)
  })

  it("inserts a synthetic error tool_result right after an orphan tool_use", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool_use", call_id: "c1", tool_name: "read_page", tool_input: {} },
      { role: "user", content: "still there?" },
    ]
    const filled = fillOrphanToolResults(messages)
    expect(filled).toHaveLength(4)
    const synthetic = filled[2]!
    expect(synthetic.role).toBe("tool_result")
    if (synthetic.role !== "tool_result") throw new Error("unreachable")
    expect(synthetic.call_id).toBe("c1")
    expect(synthetic.is_error).toBe(true)
    expect(JSON.parse(synthetic.content)).toMatchObject({ ok: false, error: { code: "INTERNAL" } })
  })

  it("only fills the orphan when answered and orphan tool_uses are mixed", () => {
    const messages: LlmMessage[] = [
      { role: "tool_use", call_id: "cA", tool_name: "read_page", tool_input: {} },
      { role: "tool_use", call_id: "cB", tool_name: "read_page", tool_input: {} },
      { role: "tool_result", call_id: "cB", content: "{}" },
    ]
    const filled = fillOrphanToolResults(messages)
    expect(filled.map(m => m.role)).toEqual(["tool_use", "tool_result", "tool_use", "tool_result"])
    const synthetic = filled[1]!
    if (synthetic.role !== "tool_result") throw new Error("unreachable")
    expect(synthetic.call_id).toBe("cA")
    expect(synthetic.is_error).toBe(true)
  })
})

describe("buildLlmMessages · orphan tool_use hardening", () => {
  it("a branch ending in an orphan tool_use followed by a user message yields no unanswered tool_use", async () => {
    // mid-stream error 场景：tool_use 已落盘但客户端没能 POST tool-result，
    // 用户接着发了下一条消息。序列化结果里孤儿必须被合成 tool_result 补齐，
    // 否则 Anthropic 对该 session 的所有后续请求都 400。
    const branch: CopilotMessage[] = [
      userMsg("m1", "check the page"),
      toolUseMsg("c1"),
      userMsg("m2", "hello?"),
    ]
    const out = await buildLlmMessages(branch)
    const toolUseIds = out.filter(m => m.role === "tool_use").map(m => (m as Extract<LlmMessage, { role: "tool_use" }>).call_id)
    const answeredIds = new Set(out.filter(m => m.role === "tool_result").map(m => (m as Extract<LlmMessage, { role: "tool_result" }>).call_id))
    for (const id of toolUseIds) expect(answeredIds.has(id)).toBe(true)
  })

  it("does not touch a well-formed tool_use → tool_result chain", async () => {
    const branch: CopilotMessage[] = [
      userMsg("m1", "check the page"),
      toolUseMsg("c1"),
      toolResultMsg("c1"),
    ]
    const out = await buildLlmMessages(branch)
    expect(out.filter(m => m.role === "tool_result")).toHaveLength(1)
  })
})
