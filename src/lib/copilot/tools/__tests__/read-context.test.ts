import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { readContextTool } from "../read-context"

// Mock session store to return a controlled active context set
const mockTag = vi.fn<(sessionId: string, tag: number) => unknown>()
vi.mock("../../session-store", async () => {
  const actual = await vi.importActual<typeof import("../../session-store")>("../../session-store")
  return {
    ...actual,
    getActiveContextByTag: (sessionId: string, tag: number) => mockTag(sessionId, tag),
  }
})

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-ctx-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
  mockTag.mockReset()

  // Seed a minimal experiment + task result for resolve-context to read
  await fs.mkdir(path.join(tmpDir, "data", "experiments"), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, "data", "experiments", "exp_A.json"),
    JSON.stringify({
      id: "exp_A",
      name: "Exp A",
      model: "gpt-4o",
      status: "completed",
      schema_id: "sch_X",
      api_config: { api_format: "openai", base_url: "x", api_key: "y" },
      temperature: 1,
    }),
  )
  await fs.mkdir(path.join(tmpDir, "data", "results", "exp_A"), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, "data", "results", "exp_A", "results.jsonl"),
    JSON.stringify({
      task_id: "task_A1",
      input: { product: "tea" },
      output: { answer: "crisp green notes" },
      status: "success",
      experiment_id: "exp_A",
    }) + "\n",
  )
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const ctx = { session_id: "sess_rc", signal: new AbortController().signal }

describe("read_context tool", () => {
  it("metadata is read-only", () => {
    expect(readContextTool.metadata.isReadOnly).toBe(true)
    expect(readContextTool.metadata.isDestructive).toBe(false)
  })

  it("throws on missing id", async () => {
    await expect(readContextTool.call({ id: "" }, ctx)).rejects.toThrow()
  })

  it("throws when ctx_N not in session", async () => {
    mockTag.mockReturnValue(undefined)
    await expect(readContextTool.call({ id: "ctx_99" }, ctx)).rejects.toThrow(/not found/)
  })

  it("experiment self returns experiment meta", async () => {
    mockTag.mockReturnValue({ tag: 1, type: "experiment", id: "exp_A" })
    const out = (await readContextTool.call({ id: "ctx_1" }, ctx)) as {
      id: string; name: string; model: string
    }
    expect(out.id).toBe("exp_A")
    expect(out.name).toBe("Exp A")
  })

  it("task_field self returns only field value", async () => {
    mockTag.mockReturnValue({
      tag: 2,
      type: "task_field",
      id: "output.answer",
      extra: { experiment_id: "exp_A", task_id: "task_A1", field: "answer" },
    })
    const out = (await readContextTool.call({ id: "ctx_2", scope: "self" }, ctx)) as {
      targeted_field: string; targeted_value: unknown
    }
    expect(out.targeted_field).toBe("answer")
    expect(out.targeted_value).toBe("crisp green notes")
    // parent data should NOT be in self scope
    expect((out as { task?: unknown }).task).toBeUndefined()
  })

  it("task_field parent returns the whole task_result", async () => {
    mockTag.mockReturnValue({
      tag: 2,
      type: "task_field",
      id: "output.answer",
      extra: { experiment_id: "exp_A", task_id: "task_A1", field: "answer" },
    })
    const out = (await readContextTool.call({ id: "ctx_2", scope: "parent" }, ctx)) as {
      targeted_field: string; task: { task_id: string }
    }
    expect(out.task?.task_id).toBe("task_A1")
  })

  it("rejects malformed ctx_id", async () => {
    await expect(readContextTool.call({ id: "not_valid" }, ctx)).rejects.toThrow()
  })
})
