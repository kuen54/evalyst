import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  maybePersistToolResult,
  loadPersistedToolResult,
  deleteToolResultDir,
} from "../tool-result-store"

let testDir: string
let originalCwd: string

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-result-"))
  originalCwd = process.cwd()
  process.chdir(testDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("maybePersistToolResult", () => {
  it("returns inline when serialized size <= maxSize", async () => {
    const r = await maybePersistToolResult("sess_1", { a: 1 }, 1000)
    expect(r.kind).toBe("inline")
    if (r.kind === "inline") expect(r.value).toEqual({ a: 1 })
  })

  it("falls back to inline when output cannot be serialized (undefined / function)", async () => {
    const r = await maybePersistToolResult("sess_1", undefined, 1000)
    expect(r.kind).toBe("inline")
    if (r.kind === "inline") expect(r.value).toBeUndefined()
  })

  it("persists to ref when serialized size > maxSize", async () => {
    const big = { body: "x".repeat(5000) }
    const r = await maybePersistToolResult("sess_1", big, 1000)
    expect(r.kind).toBe("ref")
    if (r.kind === "ref") {
      expect(r.ref).toMatch(/^ref:\/\/tool-result\/tr_/)
      expect(r.preview.length).toBeLessThan(600)
      expect(r.preview).toContain("truncated")
    }
  })

  it("round-trip via loadPersistedToolResult", async () => {
    const big = { body: "y".repeat(5000), id: 42 }
    const r = await maybePersistToolResult("sess_1", big, 1000)
    expect(r.kind).toBe("ref")
    if (r.kind === "ref") {
      const loaded = await loadPersistedToolResult("sess_1", r.ref)
      expect(loaded).toEqual(big)
    }
  })

  it("loadPersistedToolResult accepts bare id as well", async () => {
    const big = { body: "z".repeat(5000) }
    const r = await maybePersistToolResult("sess_2", big, 1000)
    if (r.kind !== "ref") throw new Error("expected ref")
    const id = r.ref.replace("ref://tool-result/", "")
    const loaded = await loadPersistedToolResult("sess_2", id)
    expect(loaded).toEqual(big)
  })

  it("different sessions store in separate dirs", async () => {
    const a = await maybePersistToolResult("sess_A", { body: "a".repeat(5000) }, 1000)
    const b = await maybePersistToolResult("sess_B", { body: "b".repeat(5000) }, 1000)
    if (a.kind !== "ref" || b.kind !== "ref") throw new Error("expected ref")
    // Each session has its own dir
    const sessAFiles = await fs.readdir(path.join(testDir, "data", "copilot", "tool-results", "sess_A"))
    const sessBFiles = await fs.readdir(path.join(testDir, "data", "copilot", "tool-results", "sess_B"))
    expect(sessAFiles.length).toBe(1)
    expect(sessBFiles.length).toBe(1)
  })

  it("deleteToolResultDir clears the session's tool-result dir", async () => {
    await maybePersistToolResult("sess_X", { body: "x".repeat(5000) }, 1000)
    await deleteToolResultDir("sess_X")
    await expect(
      fs.readdir(path.join(testDir, "data", "copilot", "tool-results", "sess_X")),
    ).rejects.toThrow()
  })

  it("deleteToolResultDir is a no-op when dir doesn't exist", async () => {
    await expect(deleteToolResultDir("never_existed")).resolves.toBeUndefined()
  })

  it("loadPersistedToolResult throws on missing file", async () => {
    await expect(loadPersistedToolResult("sess_1", "tr_notfound")).rejects.toThrow()
  })

  it("loadPersistedToolResult rejects path-traversal refs (security)", async () => {
    // 在 storeDir 之外种一个文件，验证 traversal ref 读不到它
    const outside = path.join(testDir, "data", "copilot", "secret.json")
    await fs.mkdir(path.dirname(outside), { recursive: true })
    await fs.writeFile(outside, JSON.stringify({ leaked: true }))
    for (const evil of [
      "ref://tool-result/../secret",
      "ref://tool-result/../../../../etc/hosts",
      "../secret",
      "tr_../escape",
      "tr_with/slash",
    ]) {
      await expect(loadPersistedToolResult("sess_evil", evil)).rejects.toThrow(/invalid tool-result ref/)
    }
  })
})

describe("maybePersistToolResult preview head+tail (v2.5 P1a §3.2)", () => {
  it("短 output 返 inline，无 preview 概念", async () => {
    const result = await maybePersistToolResult("s", { x: "hi" }, 1000)
    expect(result.kind).toBe("inline")
  })

  it("长 output 落盘后 preview 有 head + 分隔 + tail", async () => {
    const long = "A".repeat(200) + "MIDDLE_FILLER".repeat(100) + "Z".repeat(200)
    const result = await maybePersistToolResult("s", { data: long }, 500)
    expect(result.kind).toBe("ref")
    if (result.kind === "ref") {
      expect(result.preview).toContain("[truncated]")
      expect(result.preview.startsWith('{"data":"AAAA')).toBe(true)
      expect(result.preview).toMatch(/ZZZ+"\}$/)
    }
  })

  it("error stack tail 被保留（head-only 模式的关键 regression test）", async () => {
    const frames = Array.from({ length: 300 }, (_, i) => `at frame_${i} (/a.ts:${i})`).join("\n")
    const output = { stack: frames, error: "ROOT_CAUSE_AT_TAIL" }
    const result = await maybePersistToolResult("s", output, 500)
    expect(result.kind).toBe("ref")
    if (result.kind === "ref") {
      expect(result.preview).toContain("ROOT_CAUSE_AT_TAIL")
    }
  })

  it("边界：长度刚超过 head + tail + sep → 触发截断", async () => {
    const input = "a".repeat(530)
    const result = await maybePersistToolResult("s", input, 500)
    expect(result.kind).toBe("ref")
    if (result.kind === "ref") {
      expect(result.preview).toContain("[truncated]")
    }
  })

  it("preview 总长度 ≤ 520（head + sep + tail budget）", async () => {
    const long = "X".repeat(2000)
    const result = await maybePersistToolResult("s", long, 500)
    if (result.kind === "ref") {
      expect(result.preview.length).toBeLessThanOrEqual(520)
    }
  })
})
