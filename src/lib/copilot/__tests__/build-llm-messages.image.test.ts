import { describe, it, expect, beforeEach, vi } from "vitest"
import type { CopilotMessage, ImageRef } from "../types"
import type { LlmMessage } from "../../llm-client"

type TextStyleMessage = Extract<LlmMessage, { role: "system" | "user" | "assistant" }>

vi.mock("@/lib/copilot/image-attach", () => ({
  MAX_IMAGES_PER_TURN: 5,
  collectImageRefs: vi.fn(),
  readImageBytes: vi.fn(),
}))

import { buildLlmMessages } from "../build-llm-messages"
import { collectImageRefs, readImageBytes } from "@/lib/copilot/image-attach"

function userMsg(content: string, contexts?: CopilotMessage["contexts"]): CopilotMessage {
  return { id: "m_u", session_id: "s", role: "user", content, contexts: contexts ?? [], timestamp: "t" }
}

function refOf(url: string, tag: number, label: string): ImageRef {
  return { url, source_label: label, ctx_tag: tag }
}

function dataUrlOk(url: string) {
  return { data_url: url }
}

beforeEach(() => {
  vi.mocked(collectImageRefs).mockReset()
  vi.mocked(readImageBytes).mockReset()
  vi.mocked(collectImageRefs).mockReturnValue({
    user_image_refs: [],
    tool_image_refs: new Map(),
    dropped_count: 0,
  })
  vi.mocked(readImageBytes).mockImplementation(async (r) => dataUrlOk(`data:image/png;base64,FAKE_${r.url}`))
})

describe("buildLlmMessages · last user message multimodal rewrite", () => {
  it("user message with 2 image contexts → content is array of 5 blocks (alternating text/image, ending with original text)", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [
        refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
        refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
      ],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("compare these two")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const u = msgs.find((m) => m.role === "user") as TextStyleMessage
    expect(Array.isArray(u.content)).toBe(true)
    const arr = u.content as Array<Record<string, unknown>>
    expect(arr).toHaveLength(5)
    expect(arr[0]).toMatchObject({ type: "text" })
    expect((arr[0] as { text: string }).text).toContain("#1")
    expect((arr[0] as { text: string }).text).toContain("task_result#t1")
    expect(arr[1]).toMatchObject({ type: "image_url" })
    expect((arr[1] as { image_url: { url: string } }).image_url.url).toContain("FAKE_/api/results/exp_1/images/a.png")
    expect(arr[2]).toMatchObject({ type: "text" })
    expect((arr[2] as { text: string }).text).toContain("#2")
    expect(arr[3]).toMatchObject({ type: "image_url" })
    expect(arr[4]).toEqual({ type: "text", text: "compare these two" })
  })

  it("empty user content (only context, no text) → still pushes empty text block at end", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [refOf("/api/results/exp_1/images/x.png", 1, "task_result#tx · field=image_url")],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const u = msgs.find((m) => m.role === "user") as TextStyleMessage
    const arr = u.content as Array<Record<string, unknown>>
    expect(arr).toHaveLength(3)
    expect(arr[2]).toEqual({ type: "text", text: "" })
  })

  it("user message without any image refs → content stays as plain string", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("just a plain question")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const u = msgs.find((m) => m.role === "user") as TextStyleMessage
    expect(u.content).toBe("just a plain question")
    expect(typeof u.content).toBe("string")
  })

  it("only the LAST user message gets the rewrite; older user messages stay plain string", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [refOf("/api/results/exp_1/images/x.png", 1, "task_result#tx · field=image_url")],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch: CopilotMessage[] = [
      userMsg("old question"),
      { id: "m_a1", session_id: "s", role: "assistant", content: "old answer", timestamp: "t" },
      userMsg("new question with image"),
    ]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const userMsgs = msgs.filter((m) => m.role === "user") as Array<TextStyleMessage>
    expect(userMsgs).toHaveLength(2)
    expect(userMsgs[0].content).toBe("old question")
    expect(Array.isArray(userMsgs[1].content)).toBe(true)
  })
})

describe("buildLlmMessages · tool_result regression (Option A: tool images deferred)", () => {
  function toolResultMsg(call_id: string, content: unknown): CopilotMessage {
    return {
      id: `m_${call_id}r`,
      session_id: "s",
      role: "tool_result",
      content: typeof content === "string" ? content : JSON.stringify(content),
      timestamp: "t",
      call_id,
      tool_name: "read_experiment_results",
    }
  }

  function toolUseMsg(call_id: string): CopilotMessage {
    return {
      id: `m_${call_id}u`,
      session_id: "s",
      role: "tool_use",
      content: "{}",
      timestamp: "t",
      call_id,
      tool_name: "read_experiment_results",
      tool_input: {},
    }
  }

  it("inline kind + tool images present → tool_result.content stays plain string", async () => {
    // collectImageRefs 返回工具图，但选项 A 下 tool_blocks_by_call_id 应该被忽略
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map([
        ["c1", [refOf("/api/results/exp_1/images/a.png", undefined as unknown as number, "task_result#t1 · field=image_url")]],
      ]),
      dropped_count: 0,
    })
    const branch: CopilotMessage[] = [
      userMsg("look at the result"),
      toolUseMsg("c1"),
      toolResultMsg("c1", { kind: "inline", value: { results: [{ id: "t1" }] } }),
    ]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(typeof tr!.content).toBe("string")
    expect(tr!.content).toContain("results")
  })

  it("ref kind + tool images present → tool_result.content stays plain string with read_tool_result hint", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map([
        ["c1", [refOf("/api/results/exp_1/images/r.png", undefined as unknown as number, "task_result#tr · field=image_url")]],
      ]),
      dropped_count: 0,
    })
    const branch: CopilotMessage[] = [
      userMsg("look"),
      toolUseMsg("c1"),
      toolResultMsg("c1", { kind: "ref", ref: "ref://tool-result/tr_abc", preview: '{"results":[...(truncated)' }),
    ]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(typeof tr!.content).toBe("string")
    expect(tr!.content as string).toContain("truncated")
    expect(tr!.content as string).toContain("read_tool_result")
  })

  it("compacted kind → summary string", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch: CopilotMessage[] = [
      userMsg("hi"),
      toolUseMsg("c1"),
      toolResultMsg("c1", { kind: "compacted", summary: "(archived tool result; retrieve via read_tool_result if needed)", ref: "ref://tool-result/tr_old" }),
    ]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(typeof tr!.content).toBe("string")
    expect(tr!.content as string).toContain("archived tool result")
  })

  it("Option A perf: readImageBytes is NOT called for tool refs", async () => {
    // collectImageRefs 上报有工具图，但 materializeImagePlan 不应该读它们的 bytes
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map([
        ["c1", [
          refOf("/api/results/exp_1/images/a.png", undefined as unknown as number, "task_result#t1 · field=image_url"),
          refOf("/api/results/exp_1/images/b.png", undefined as unknown as number, "task_result#t2 · field=image_url"),
        ]],
      ]),
      dropped_count: 0,
    })
    const branch: CopilotMessage[] = [
      userMsg("hi"),
      toolUseMsg("c1"),
      toolResultMsg("c1", { kind: "inline", value: { results: [] } }),
    ]
    await buildLlmMessages(branch, null, { modelVisionCapable: true })
    // 选项 A：工具图全部丢弃，readImageBytes 不应该为这两张图调用
    expect(vi.mocked(readImageBytes)).not.toHaveBeenCalled()
  })
})

describe("buildLlmMessages · vision strip + dropped_count notes", () => {
  it("vision-capable=true + 0 image refs → no extra system notes (clean baseline)", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("just a question")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const sysMsgs = msgs.filter((m) => m.role === "system") as Array<TextStyleMessage>
    // Only COPILOT_SYSTEM_PROMPT (no SystemHeader because no contexts/pageContext, no image notes)
    expect(sysMsgs).toHaveLength(1)
  })

  it("vision-capable=true + cap exceeded (dropped_count=2) → 1 dropped_count note system message", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [
        refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
        refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
        refOf("/api/results/exp_1/images/c.png", 3, "task_result#t3 · field=image_url"),
        refOf("/api/results/exp_1/images/d.png", 4, "task_result#t4 · field=image_url"),
        refOf("/api/results/exp_1/images/e.png", 5, "task_result#t5 · field=image_url"),
      ],
      tool_image_refs: new Map(),
      dropped_count: 2,
    })
    const branch = [userMsg("compare these")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
    const sysMsgs = msgs.filter((m) => m.role === "system") as Array<TextStyleMessage>
    const noteMsg = sysMsgs.find((s) => typeof s.content === "string" && s.content.includes("not attached"))
    expect(noteMsg).toBeTruthy()
    expect(noteMsg!.content as string).toContain("2 image(s) not attached")
    expect(noteMsg!.content as string).toContain("per-turn cap is 5")
    // User content should still be multimodal with 5 attached image_url blocks
    const u = msgs.find((m) => m.role === "user") as TextStyleMessage
    const arr = u.content as Array<Record<string, unknown>>
    expect(arr.filter((b) => b.type === "image_url")).toHaveLength(5)
  })

  it("vision-capable=false + 3 refs → 1 strip note + content stays plain string", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [
        refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
        refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
        refOf("/api/results/exp_1/images/c.png", 3, "task_result#t3 · field=image_url"),
      ],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("compare these")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: false })
    const sysMsgs = msgs.filter((m) => m.role === "system") as Array<TextStyleMessage>
    const noteMsg = sysMsgs.find((s) => typeof s.content === "string" && s.content.includes("Image attachments dropped"))
    expect(noteMsg).toBeTruthy()
    expect(noteMsg!.content as string).toContain("model not vision_capable")
    // User content stays plain string
    const u = msgs.find((m) => m.role === "user") as TextStyleMessage
    expect(typeof u.content).toBe("string")
    expect(u.content).toBe("compare these")
  })

  it("vision-capable=false + 0 refs → no extra system notes (clean path for non-image use)", async () => {
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    const branch = [userMsg("a non-image question")]
    const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: false })
    const sysMsgs = msgs.filter((m) => m.role === "system") as Array<TextStyleMessage>
    // Only COPILOT_SYSTEM_PROMPT
    expect(sysMsgs).toHaveLength(1)
  })
})
