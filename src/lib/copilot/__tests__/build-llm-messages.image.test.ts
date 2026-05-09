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
