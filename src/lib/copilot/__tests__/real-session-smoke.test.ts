/**
 * 用仓库里真实的 data/copilot/sessions/*.jsonl（v1 数据）跑 buildLlmMessages，
 * 确保线上既有会话不因 v2 重构崩。此测试不 mock fs，直接读真实文件。
 *
 * 测试结果应当：
 *  - 每条 session 能完整 load 成 branch
 *  - buildLlmMessages 对每条都不抛
 *  - tool_result 消息的 content 经 normalizeToolResult 后合法（kind 能解析）
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { listSessions, getActiveBranch, normalizeToolResult } from "../session-store"
import { buildLlmMessages } from "../build-llm-messages"

// 用仓库根目录。process.cwd() 在 vitest 下就是 repo root（除非被别的 test chdir 了，
// 但这个测试不 chdir，且 afterEach 在其他 test 会 restore）。
const sessionsDir = path.join(process.cwd(), "data", "copilot", "sessions")

describe("real v1 session data smoke", () => {
  it("can list existing sessions if data/copilot/ is present", () => {
    if (!fs.existsSync(sessionsDir)) {
      // Clean checkout without data/ — skip
      return
    }
    const sessions = listSessions()
    expect(Array.isArray(sessions)).toBe(true)
  })

  it("buildLlmMessages does not crash on any existing session's active branch", () => {
    if (!fs.existsSync(sessionsDir)) return
    const sessions = listSessions()
    for (const s of sessions) {
      const branch = getActiveBranch(s.id)
      expect(() => buildLlmMessages(branch, null)).not.toThrow()
    }
  })

  it("every tool_result content normalizes to a valid ToolResultContent kind", () => {
    if (!fs.existsSync(sessionsDir)) return
    const sessions = listSessions()
    for (const s of sessions) {
      const branch = getActiveBranch(s.id)
      for (const m of branch) {
        if (m.role !== "tool_result") continue
        const normalized = normalizeToolResult(m.content)
        expect(["inline", "ref", "compacted"]).toContain(normalized.kind)
      }
    }
  })
})
