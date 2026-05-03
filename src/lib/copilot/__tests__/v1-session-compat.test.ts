/**
 * 老 session jsonl 向后兼容回归。
 *
 * 构造一条 v1 形态的 jsonl（role='tool_result', content=原始 JSON string，无 kind），
 * 用 session-store 正常读出，经 buildLlmMessages 出来要等价 inline —— 不丢数据 / 不走 ref 解析。
 *
 * 这模拟了 spec §8.1 的兼容保证：`data/copilot/sessions/` 不需要迁移。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { getActiveBranch } from "../session-store"
import { buildLlmMessages } from "../build-llm-messages"

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "v1-compat-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function seedV1Session(sessionId: string, messages: Array<Record<string, unknown>>) {
  const sessionsDir = path.join(tmpDir, "data", "copilot", "sessions")
  await fs.mkdir(sessionsDir, { recursive: true })
  const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
  await fs.writeFile(path.join(sessionsDir, `${sessionId}.jsonl`), lines)

  // index.json
  await fs.writeFile(
    path.join(tmpDir, "data", "copilot", "index.json"),
    JSON.stringify({
      sessions: [
        {
          id: sessionId,
          title: "v1 test",
          created_at: "2026-04-28T00:00:00.000Z",
          updated_at: "2026-04-28T00:00:00.000Z",
          head_message_id: messages[messages.length - 1].id,
        },
      ],
    }),
  )
}

describe("v1 session backward compat", () => {
  it("loads a pre-v2 tool_result (raw JSON content) and renders as inline", async () => {
    const sessionId = "sess_v1_a"
    // Exactly the shape of the real data/copilot/sessions/8e7gf223mh.jsonl tool_result:
    //   content is JSON.stringify({experiments:[...], total_matching, returned})，无 kind
    await seedV1Session(sessionId, [
      {
        id: "u1",
        session_id: sessionId,
        role: "user",
        content: "请列出运行中的实验",
        timestamp: "2026-04-28T09:21:20.000Z",
      },
      {
        id: "tu1",
        session_id: sessionId,
        parent_id: "u1",
        role: "tool_use",
        content: "{}",
        tool_name: "list_experiments",
        tool_input: {},
        call_id: "call_v1_a",
        timestamp: "2026-04-28T09:21:25.000Z",
      },
      {
        id: "tr1",
        session_id: sessionId,
        parent_id: "tu1",
        role: "tool_result",
        // 真实 v1：content 是裸 JSON string（不是 ToolResultContent）
        content: JSON.stringify({
          experiments: [
            { id: "exp_A", name: "Exp A", status: "running" },
            { id: "exp_B", name: "Exp B", status: "paused" },
          ],
          total_matching: 2,
          returned: 2,
        }),
        call_id: "call_v1_a",
        tool_name: "list_experiments",
        denied: false,
        timestamp: "2026-04-28T09:21:26.000Z",
      },
    ])

    // Read via session-store; should recover all 3 messages
    const branch = getActiveBranch(sessionId)
    expect(branch).toHaveLength(3)
    expect(branch[2].role).toBe("tool_result")

    // Build LLM messages — v1 tool_result should be rendered as inline (no ref, no compacted)
    const llm = buildLlmMessages(branch, null)
    const tr = llm.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(tr?.content).toContain("exp_A")
    expect(tr?.content).toContain("Exp A")
    // No ref leakage: old content should not be misinterpreted as ToolResultContent
    expect(tr?.content).not.toContain("ref://")
    expect(tr?.content).not.toContain("archived tool result")
  })

  it("mixed v1 + v2 messages in same session coexist", async () => {
    const sessionId = "sess_v1_mixed"
    await seedV1Session(sessionId, [
      {
        id: "u1",
        session_id: sessionId,
        role: "user",
        content: "list them",
        timestamp: "2026-04-28T00:00:00.000Z",
      },
      // v1 tool_result
      {
        id: "tu1",
        session_id: sessionId,
        parent_id: "u1",
        role: "tool_use",
        content: "{}",
        tool_name: "list_experiments",
        tool_input: {},
        call_id: "c1",
        timestamp: "2026-04-28T00:00:01.000Z",
      },
      {
        id: "tr1",
        session_id: sessionId,
        parent_id: "tu1",
        role: "tool_result",
        content: JSON.stringify({ experiments: [], total_matching: 0, returned: 0 }),
        call_id: "c1",
        tool_name: "list_experiments",
        timestamp: "2026-04-28T00:00:02.000Z",
      },
      {
        id: "a1",
        session_id: sessionId,
        parent_id: "tr1",
        role: "assistant",
        content: "No experiments yet.",
        timestamp: "2026-04-28T00:00:03.000Z",
      },
      {
        id: "u2",
        session_id: sessionId,
        parent_id: "a1",
        role: "user",
        content: "how about running ones?",
        timestamp: "2026-05-03T00:00:00.000Z",
      },
      // v2 tool_result with ToolResultContent kind='ref'
      {
        id: "tu2",
        session_id: sessionId,
        parent_id: "u2",
        role: "tool_use",
        content: '{"status":"running"}',
        tool_name: "list_experiments",
        tool_input: { status: "running" },
        call_id: "c2",
        timestamp: "2026-05-03T00:00:01.000Z",
      },
      {
        id: "tr2",
        session_id: sessionId,
        parent_id: "tu2",
        role: "tool_result",
        content: JSON.stringify({
          kind: "ref",
          ref: "ref://tool-result/tr_v2",
          preview: "{\"experiments\":[...](truncated)",
        }),
        call_id: "c2",
        tool_name: "list_experiments",
        timestamp: "2026-05-03T00:00:02.000Z",
      },
    ])

    const branch = getActiveBranch(sessionId)
    expect(branch).toHaveLength(7)

    const llm = buildLlmMessages(branch, null)
    const trs = llm.filter((m) => m.role === "tool_result")
    expect(trs).toHaveLength(2)

    // v1 tool_result → inline (after microCompact, old read-only ones may be compacted;
    // we only have 2 tool_results and keepRecent=3, so both survive raw)
    // First tool_result (v1) → inline value
    expect(trs[0].content).toMatch(/experiments|archived/)
    // Second tool_result (v2 ref) → ref preview + hint
    expect(trs[1].content).toContain("read_tool_result")
    expect(trs[1].content).toContain("ref://tool-result/tr_v2")
  })

  it("v1 tool_result with extremely old data (no call_id in result) still loads without crash", async () => {
    const sessionId = "sess_v1_noCall"
    // Edge case: very old jsonl might not have call_id on tool_result
    // buildLlmMessages skips tool_result without call_id — should not crash
    await seedV1Session(sessionId, [
      {
        id: "u1",
        session_id: sessionId,
        role: "user",
        content: "hi",
        timestamp: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "tr_orphan",
        session_id: sessionId,
        parent_id: "u1",
        role: "tool_result",
        content: JSON.stringify({ ok: true }),
        tool_name: "list_experiments",
        timestamp: "2026-04-01T00:00:01.000Z",
        // intentionally no call_id
      },
    ])

    const branch = getActiveBranch(sessionId)
    expect(branch).toHaveLength(2)
    // buildLlmMessages silently skips the malformed tool_result — should not throw
    expect(() => buildLlmMessages(branch, null)).not.toThrow()
    const llm = buildLlmMessages(branch, null)
    // Only user message + system prompt; no tool_result emitted
    expect(llm.filter((m) => m.role === "tool_result")).toHaveLength(0)
  })
})
