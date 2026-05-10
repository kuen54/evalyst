import { describe, it, expect } from "vitest"
import { microCompact, parseRefId, __testOnlyApproxTokens } from "../micro-compact"
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 2 })
    expect(normalizeToolResult(out[0]!.content).kind).toBe("compacted")
    expect(normalizeToolResult(out[1]!.content).kind).toBe("compacted")
    expect(normalizeToolResult(out[2]!.content).kind).toBe("ref")
    expect(normalizeToolResult(out[3]!.content).kind).toBe("ref")
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 0 })
    expect(out[0]).toBe(messages[0]) // exact same object (user untouched)
    expect(out[1]).toBe(messages[1]) // tool_use untouched
    expect(out[3]).toBe(messages[3]) // assistant untouched
    // Only index 2 should be compacted
    expect(normalizeToolResult(out[2]!.content).kind).toBe("compacted")
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 1 })
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 0 })
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 1 })
    const first = normalizeToolResult(out[0]!.content)
    expect(first.kind).toBe("compacted")
    if (first.kind === "compacted") {
      expect(first.ref).toBeUndefined()
      expect(first.summary).toContain("not persisted")
    }
    expect(normalizeToolResult(out[1]!.content).kind).toBe("inline")
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 1 })
    const first = normalizeToolResult(out[0]!.content)
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 3 })
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 0 })
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
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 1 })
    expect(normalizeToolResult(out[0]!.content).kind).toBe("compacted") // read #1 compacted
    expect(normalizeToolResult(out[1]!.content).kind).toBe("inline") // write untouched
    expect(normalizeToolResult(out[2]!.content).kind).toBe("compacted") // read #2 compacted
    expect(normalizeToolResult(out[3]!.content).kind).toBe("ref") // last read kept
  })
})

describe("microCompact maxTotalReplayableTokens (v2.5)", () => {
  it("compacts older read results when accumulated tokens exceed cap even within keepRecentN window", () => {
    // 3 条 read_resource tool_result，每条 ~10_015 token payload (JSON 路径 ÷2)；keepRecent=3, 阈值 15_000
    // 反向遍历：最近条 10_015 ≤ 15_000 keep；中间条 10_015+10_015 > 15_000 → break；最老自然压
    const big = "x".repeat(20_000) // JSON.stringify → ~20_030 chars → ~10_015 tokens
    const messages: CopilotMessage[] = [
      userMsg("u1", "hi"),
      toolUseMsg("a1", "c1", "read_resource"),
      toolResultMsg("a1r", "c1", "read_resource", { kind: "inline", value: { x: big } }),
      toolUseMsg("a2", "c2", "read_resource"),
      toolResultMsg("a2r", "c2", "read_resource", { kind: "inline", value: { x: big } }),
      toolUseMsg("a3", "c3", "read_resource"),
      toolResultMsg("a3r", "c3", "read_resource", { kind: "inline", value: { x: big } }),
    ]
    const { messages: out } = microCompact(messages, {
      keepRecentReadResults: 3,
      maxTotalReplayableTokens: 15_000,
    })
    const inlines = out.filter(
      (m) => m.role === "tool_result" && normalizeToolResult(m.content).kind === "inline",
    )
    const compacted = out.filter(
      (m) => m.role === "tool_result" && normalizeToolResult(m.content).kind === "compacted",
    )
    expect(inlines).toHaveLength(1) // 最近的一条保
    expect(compacted).toHaveLength(2) // 老的两条压
  })

  it("threshold undefined falls back to count-only behavior", () => {
    const messages: CopilotMessage[] = [
      userMsg("u1", "hi"),
      toolUseMsg("a1", "c1", "read_resource"),
      toolResultMsg("a1r", "c1", "read_resource", { kind: "inline", value: { x: "a" } }),
      toolUseMsg("a2", "c2", "read_resource"),
      toolResultMsg("a2r", "c2", "read_resource", { kind: "inline", value: { x: "b" } }),
    ]
    const { messages: out } = microCompact(messages, { keepRecentReadResults: 1 })
    const inlines = out.filter(
      (m) => m.role === "tool_result" && normalizeToolResult(m.content).kind === "inline",
    )
    expect(inlines).toHaveLength(1) // 向后兼容：只按数量
  })
})

describe("microCompact didCompact flag (v2.5)", () => {
  it("didCompact=true when at least one read tool_result is compacted", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref", ref: "ref://tool-result/tr_1", preview: "p",
      }),
      toolResultMsg("m2", "c2", "list_experiments", {
        kind: "ref", ref: "ref://tool-result/tr_2", preview: "p",
      }),
    ]
    const { didCompact } = microCompact(messages, { keepRecentReadResults: 1 })
    expect(didCompact).toBe(true)
  })

  it("didCompact=false when all reads fit within keep window", () => {
    const messages: CopilotMessage[] = [
      toolResultMsg("m1", "c1", "list_experiments", {
        kind: "ref", ref: "ref://tool-result/tr_1", preview: "p",
      }),
    ]
    const { messages: out, didCompact } = microCompact(messages, { keepRecentReadResults: 3 })
    expect(didCompact).toBe(false)
    expect(out).toBe(messages) // same reference, no rebuild
  })

  it("didCompact=false when there are no replayable tool_results at all", () => {
    const messages: CopilotMessage[] = [
      userMsg("u1", "hi"),
      asstMsg("a1", "hello"),
    ]
    const { didCompact } = microCompact(messages, { keepRecentReadResults: 0 })
    expect(didCompact).toBe(false)
  })
})

describe("approxTokens content-type 分岔（v2.5 P0）", () => {
  it("JSON 格式（{ ... }）按 length / 2 估算", () => {
    const json = JSON.stringify({ x: "hello world", y: [1, 2, 3] })
    expect(__testOnlyApproxTokens(json)).toBe(Math.ceil(json.length / 2))
  })

  it("JSON 格式（[ ... ]）按 length / 2 估算", () => {
    const json = JSON.stringify([1, 2, 3, 4, 5])
    expect(__testOnlyApproxTokens(json)).toBe(Math.ceil(json.length / 2))
  })

  it("中文 heavy（>30% CJK）按 length / 1.5 估算", () => {
    const cn = "你好世界这是一段中文文本中文占比超过百分之三十"
    expect(__testOnlyApproxTokens(cn)).toBe(Math.ceil(cn.length / 1.5))
  })

  it("英文为主（<30% CJK）按 length / 4 估算", () => {
    const en = "Hello world this is mostly English with one 字 in it"
    expect(__testOnlyApproxTokens(en)).toBe(Math.ceil(en.length / 4))
  })

  it("空字符串返回 0", () => {
    expect(__testOnlyApproxTokens("")).toBe(0)
  })

  it("JSON 优先级高于中文判定（JSON 里含中文也走 ÷2）", () => {
    const jsonCn = JSON.stringify({ msg: "中文内容比较多需要超过百分之三十" })
    expect(__testOnlyApproxTokens(jsonCn)).toBe(Math.ceil(jsonCn.length / 2))
  })
})

describe("approxTokens image 补偿（v2.5 P0）", () => {
  it("每个 https:// 图片 url 补偿 1600 tokens", () => {
    const s = '{"img":"https://example.com/foo.png"}'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 1600)
  })

  it("多张图叠加", () => {
    const s = '{"a":"https://x.com/1.jpg","b":"https://x.com/2.webp"}'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 3200)
  })

  it("data:image/...;base64 也算一张", () => {
    const s = "data:image/png;base64,iVBORw0KGgoAAAA"
    const baseTokens = Math.ceil(s.length / 4)
    expect(__testOnlyApproxTokens(s)).toBe(baseTokens + 1600)
  })

  it("不带扩展名的 url 不算 image", () => {
    const s = '{"url":"https://example.com/api/foo"}'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2))
  })

  it("image url query string 不影响匹配", () => {
    const s = '{"url":"https://example.com/foo.png?v=2"}'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 1600)
  })
})
