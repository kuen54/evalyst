import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { runTool } from "../tool-runtime"
import type { AnyToolDescriptor } from "../tools/registry"
import { TOOLS } from "../tools/server-registry"

const readTool: AnyToolDescriptor = {
  name: "r",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
}

const writeTool: AnyToolDescriptor = {
  name: "w",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: false, isDestructive: true, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
}

const bigReadTool: AnyToolDescriptor = {
  name: "br",
  description: "",
  inputSchema: {},
  metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
  // 600 字符 > head 400 + tail 100 + sep 20 = 520 阈值，确保 buildPreview 触发截断
  call: async () => ({ body: "x".repeat(600) }),
}

const signal = new AbortController().signal

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtool-integ-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("runTool", () => {
  it("read tool runs through, output wrapped by payloadGuard as inline when small", async () => {
    const r = await runTool(readTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      expect(r.output).toEqual({ kind: "inline", value: { ok: 1 } })
    }
  })

  it("write tool short-circuits to awaiting_confirm", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal })
    expect(r.kind).toBe("awaiting_confirm")
  })

  it("skipConfirm bypasses Confirm gate and runs the write; output wrapped inline", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal }, { skipConfirm: true })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      expect(r.output).toEqual({ kind: "inline", value: { ok: 1 } })
    }
  })

  it("large output gets persisted as ref via payloadGuard", async () => {
    const r = await runTool(bigReadTool, {}, { session_id: "sess_test", signal })
    expect(r.kind).toBe("done")
    if (r.kind === "done") {
      const content = r.output as { kind: string; ref?: string; preview?: string }
      expect(content.kind).toBe("ref")
      expect(content.ref).toMatch(/^ref:\/\/tool-result\/tr_/)
      expect(content.preview).toContain("truncated")
    }
  })
})

// G2 (v0.18.7): registry-driven property test。
// 任何带 skipPayloadGuard:true 的 tool，无论 call() 返多大 payload，runTool 必须返
// {kind:"inline"}——这是 v0.18.6 修法的核心契约。stub 每个工具的 call() 返 50KB 假数据，
// 走完整 runTool pipeline（含 payloadGuardHook），断言不再 ref 化。
// 未来加新 tool 设 skipPayloadGuard:true 自动覆盖，不再裸调 .call() 跳过 hook 层。
describe("runTool · skipPayloadGuard registry property", () => {
  it("every tool with skipPayloadGuard:true returns kind:'inline' even for huge stubbed output", async () => {
    const skipGuardTools = TOOLS.filter((t) => t.metadata.skipPayloadGuard)
    expect(skipGuardTools.length).toBeGreaterThan(0)  // 至少 read_tool_result 一个
    for (const tool of skipGuardTools) {
      // stub call: 用 50KB 假数据强制超 maxResultSizeChars（即便 MAX_SAFE_INTEGER 也通过路径）
      const stubTool: AnyToolDescriptor = {
        ...tool,
        call: async () => ({ huge: "x".repeat(50000), tool: tool.name }),
      }
      const r = await runTool(
        stubTool,
        {},
        { session_id: "sess_g2", signal },
        { skipConfirm: true },
      )
      expect(r.kind, `${tool.name} should not error in runTool`).toBe("done")
      if (r.kind === "done") {
        const out = r.output as { kind: string; ref?: string; value?: unknown }
        expect(out.kind, `${tool.name} must return inline (skipPayloadGuard contract)`).toBe("inline")
        expect(out.ref, `${tool.name} must not have ref field`).toBeUndefined()
      }
    }
  })

  // 配套 sanity check：所有 tool metadata 字段健康
  it("every registered tool has well-formed metadata", () => {
    const seenNames = new Set<string>()
    for (const tool of TOOLS) {
      expect(tool.name, "tool.name must be non-empty").toMatch(/.+/)
      expect(seenNames.has(tool.name), `duplicate tool name: ${tool.name}`).toBe(false)
      seenNames.add(tool.name)
      expect(typeof tool.metadata.isReadOnly).toBe("boolean")
      expect(typeof tool.metadata.isDestructive).toBe("boolean")
      expect(typeof tool.metadata.maxResultSizeChars).toBe("number")
      expect(tool.metadata.maxResultSizeChars).toBeGreaterThan(0)
    }
  })
})

