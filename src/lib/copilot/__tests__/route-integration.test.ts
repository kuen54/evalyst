/**
 * 集成测试：POST /api/copilot/sessions/{id}/tool-result 的核心流程
 *
 * Mock runTool 不被 mock（走真实 hook pipeline，含 payloadGuard），
 * 但 /chat 的上游 LLM stream 不走 —— 这里专测：
 *   1. tool dispatch 经 runTool 穿过 postToolCallHooks → maybePersistToolResult
 *   2. 大 payload 落盘到 data/copilot/tool-results/{sid}/tr_xxx.json
 *   3. 小 payload 不落盘，stay inline
 *   4. tool_result 消息正确 append 到 session jsonl
 *   5. content 字段是 JSON.stringify(ToolResultContent)，normalizeToolResult 能读回
 *
 * 手动构造 ctx + tool + 调 runTool —— 绕开 Next route 的 req/res，聚焦核心链。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { runTool } from "../tool-runtime"
import { appendMessage, createSession, normalizeToolResult } from "../session-store"
import { loadPersistedToolResult } from "../tool-result-store"
import { buildLlmMessages } from "../build-llm-messages"
import type { AnyToolDescriptor } from "../tools/registry"

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "route-integ-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const signal = new AbortController().signal

describe("tool-result route integration", () => {
  it("small tool output stays inline in jsonl + transcript renders inline", async () => {
    const session = createSession({ title: "small" })
    const sessionId = session.id

    const readTool: AnyToolDescriptor = {
      name: "mock_small_read",
      description: "",
      inputSchema: {},
      metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 },
      call: async () => ({ items: [{ id: "a" }, { id: "b" }] }),
    }

    // simulate /tool-result flow: user already Confirmed, route calls runTool skipConfirm
    const userMsg = appendMessage({
      session_id: sessionId,
      role: "user",
      content: "run small",
    })
    const toolUseMsg = appendMessage({
      session_id: sessionId,
      parent_id: userMsg.id,
      role: "tool_use",
      content: "{}",
      call_id: "call_s",
      tool_name: readTool.name,
      tool_input: {},
    })

    const r = await runTool(readTool, {}, { session_id: sessionId, signal }, { skipConfirm: true })
    expect(r.kind).toBe("done")
    if (r.kind !== "done") throw new Error("expected done")

    // Route persists output as tool_result content (JSON.stringified ToolResultContent)
    const toolResultMsg = appendMessage({
      session_id: sessionId,
      parent_id: toolUseMsg.id,
      role: "tool_result",
      content: JSON.stringify(r.output),
      call_id: "call_s",
      tool_name: readTool.name,
    })

    // Validate stored shape
    const normalized = normalizeToolResult(toolResultMsg.content)
    expect(normalized.kind).toBe("inline")
    if (normalized.kind === "inline") {
      expect(normalized.value).toEqual({ items: [{ id: "a" }, { id: "b" }] })
    }

    // No ref file should be written
    const trDir = path.join(tmpDir, "data", "copilot", "tool-results", sessionId)
    const trExists = await fs
      .stat(trDir)
      .then(() => true)
      .catch(() => false)
    expect(trExists).toBe(false)

    // buildLlmMessages renders inline value
    // need a full branch — re-read
    const { getActiveBranch } = await import("../session-store")
    const branch = getActiveBranch(sessionId)
    const llm = buildLlmMessages(branch, null)
    const tr = llm.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("items")
    expect(tr?.content).not.toContain("ref://")
  })

  it("large tool output gets ref'd to disk + transcript shows preview + hint", async () => {
    const session = createSession({ title: "large" })
    const sessionId = session.id

    const bigReadTool: AnyToolDescriptor = {
      name: "mock_big_read",
      description: "",
      inputSchema: {},
      metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 200 },
      call: async () => ({ body: "x".repeat(5000), meta: "rich" }),
    }

    const userMsg = appendMessage({
      session_id: sessionId,
      role: "user",
      content: "big",
    })
    const toolUseMsg = appendMessage({
      session_id: sessionId,
      parent_id: userMsg.id,
      role: "tool_use",
      content: "{}",
      call_id: "call_b",
      tool_name: bigReadTool.name,
      tool_input: {},
    })

    const r = await runTool(
      bigReadTool,
      {},
      { session_id: sessionId, signal },
      { skipConfirm: true },
    )
    if (r.kind !== "done") throw new Error("expected done")

    const toolResultMsg = appendMessage({
      session_id: sessionId,
      parent_id: toolUseMsg.id,
      role: "tool_result",
      content: JSON.stringify(r.output),
      call_id: "call_b",
      tool_name: bigReadTool.name,
    })

    // The runTool output after payloadGuard is ToolResultContent{kind:'ref'}
    const normalized = normalizeToolResult(toolResultMsg.content)
    expect(normalized.kind).toBe("ref")
    if (normalized.kind !== "ref") throw new Error("expected ref")
    expect(normalized.ref).toMatch(/^ref:\/\/tool-result\/tr_/)
    expect(normalized.preview.length).toBeLessThan(600)

    // File landed on disk
    const trDir = path.join(tmpDir, "data", "copilot", "tool-results", sessionId)
    const files = await fs.readdir(trDir)
    expect(files).toHaveLength(1)

    // read_tool_result roundtrips the full payload back
    const roundtrip = await loadPersistedToolResult(sessionId, normalized.ref)
    expect(roundtrip).toEqual({ body: "x".repeat(5000), meta: "rich" })

    // LLM messages: preview + hint, not full body
    const { getActiveBranch } = await import("../session-store")
    const branch = getActiveBranch(sessionId)
    const llm = buildLlmMessages(branch, null)
    const tr = llm.find((m) => m.role === "tool_result")
    expect(tr?.content).toContain("read_tool_result")
    expect(tr?.content).toContain("truncated")
    // full payload NOT sent to LLM
    expect(tr?.content?.length).toBeLessThan(1000)
  })

  it("write tool (isDestructive) requires Confirm by default; skipConfirm bypasses", async () => {
    const session = createSession({ title: "write" })
    const sessionId = session.id

    const writeTool: AnyToolDescriptor = {
      name: "mock_write",
      description: "",
      inputSchema: {},
      metadata: { isReadOnly: false, isDestructive: true, maxResultSizeChars: 1000 },
      call: async () => ({ written: true }),
    }

    // 默认 (no skipConfirm): 不执行，返 awaiting_confirm
    const pending = await runTool(writeTool, {}, { session_id: sessionId, signal })
    expect(pending.kind).toBe("awaiting_confirm")

    // skipConfirm=true: 执行成功，output wrapped as inline ToolResultContent
    const confirmed = await runTool(
      writeTool,
      {},
      { session_id: sessionId, signal },
      { skipConfirm: true },
    )
    expect(confirmed.kind).toBe("done")
    if (confirmed.kind === "done") {
      expect(confirmed.output).toEqual({ kind: "inline", value: { written: true } })
    }
  })

  it("tool throwing doesn't crash pipeline; caller wraps as error content", async () => {
    const session = createSession({ title: "err" })
    const sessionId = session.id

    const throwingTool: AnyToolDescriptor = {
      name: "mock_throw",
      description: "",
      inputSchema: {},
      metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 500 },
      call: async () => {
        throw new Error("boom from tool")
      },
    }

    await expect(
      runTool(throwingTool, {}, { session_id: sessionId, signal }),
    ).rejects.toThrow(/boom from tool/)

    // Route's try/catch would wrap as { error: msg }; confirm that shape normalizes fine
    const errPayload = { error: "boom from tool" }
    const toolResultContent = JSON.stringify(errPayload) // Route writes raw object, not ToolResultContent
    const normalized = normalizeToolResult(toolResultContent)
    expect(normalized.kind).toBe("inline")
    if (normalized.kind === "inline") {
      expect((normalized.value as { error: string }).error).toBe("boom from tool")
    }
  })

  it("multiple read tool calls trigger microCompact on subsequent builds (older compacted)", async () => {
    const session = createSession({ title: "compact" })
    const sessionId = session.id

    const listTool: AnyToolDescriptor = {
      name: "list_experiments", // must match real registry so microCompact sees isReadOnly
      description: "",
      inputSchema: {},
      metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
      call: async () => ({ experiments: Array.from({ length: 30 }, (_, i) => ({ id: `e${i}` })) }),
    }

    // 5 round-trips of the same read tool; payloadGuard persists each as ref
    const userMsg = appendMessage({ session_id: sessionId, role: "user", content: "repeat" })
    let parentId = userMsg.id
    for (let i = 1; i <= 5; i++) {
      const tu = appendMessage({
        session_id: sessionId,
        parent_id: parentId,
        role: "tool_use",
        content: "{}",
        call_id: `c${i}`,
        tool_name: listTool.name,
        tool_input: {},
      })
      const r = await runTool(
        listTool,
        {},
        { session_id: sessionId, signal },
        { skipConfirm: true },
      )
      if (r.kind !== "done") throw new Error("expected done")
      const tr = appendMessage({
        session_id: sessionId,
        parent_id: tu.id,
        role: "tool_result",
        content: JSON.stringify(r.output),
        call_id: `c${i}`,
        tool_name: listTool.name,
      })
      parentId = tr.id
    }

    const { getActiveBranch } = await import("../session-store")
    const branch = getActiveBranch(sessionId)
    // 1 user + 5 pairs = 11 messages
    expect(branch).toHaveLength(11)

    const llm = buildLlmMessages(branch, null)
    const toolResults = llm.filter((m) => m.role === "tool_result")
    expect(toolResults).toHaveLength(5)

    // microCompact (keepRecent=3) → first 2 become "archived tool result", last 3 keep ref preview
    expect(toolResults[0].content).toContain("archived tool result")
    expect(toolResults[1].content).toContain("archived tool result")
    expect(toolResults[2].content).toContain("read_tool_result")
    expect(toolResults[3].content).toContain("read_tool_result")
    expect(toolResults[4].content).toContain("read_tool_result")
  })
})
