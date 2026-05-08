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
      display_id: "disp_X",
      rubric_id: "rub_X",
      api_config: { api_format: "openai", base_url: "x", api_key: "SECRET_KEY" },
      temperature: 1,
      prompt_template: "SECRET_PROMPT",
      notes: "SECRET_NOTES",
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

  it("returns err(INVALID_INPUT) on missing id", async () => {
    const r = await readContextTool.call({ id: "" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("id") },
    })
  })

  it("returns err(NOT_FOUND) when ctx_N not in session", async () => {
    mockTag.mockReturnValue(undefined)
    const r = await readContextTool.call({ id: "ctx_99" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
  })

  it("experiment self returns experiment meta (ok)", async () => {
    mockTag.mockReturnValue({ tag: 1, type: "experiment", id: "exp_A" })
    const r = (await readContextTool.call({ id: "ctx_1" }, ctx)) as {
      ok: true
      value: { id: string; name: string; model: string }
    }
    expect(r.ok).toBe(true)
    expect(r.value.id).toBe("exp_A")
    expect(r.value.name).toBe("Exp A")
  })

  it("task_field self returns only field value (ok)", async () => {
    mockTag.mockReturnValue({
      tag: 2,
      type: "task_field",
      id: "output.answer",
      extra: { experiment_id: "exp_A", task_id: "task_A1", field: "answer" },
    })
    const r = (await readContextTool.call({ id: "ctx_2", scope: "self" }, ctx)) as {
      ok: true
      value: { targeted_field: string; targeted_value: unknown }
    }
    expect(r.value.targeted_field).toBe("answer")
    expect(r.value.targeted_value).toBe("crisp green notes")
    // parent data should NOT be in self scope
    expect((r.value as { task?: unknown }).task).toBeUndefined()
  })

  it("task_field parent returns task_meta (manifest, no input_preview)", async () => {
    mockTag.mockReturnValue({
      tag: 2,
      type: "task_field",
      id: "output.answer",
      extra: { experiment_id: "exp_A", task_id: "task_A1", field: "answer" },
    })
    const r = (await readContextTool.call({ id: "ctx_2", scope: "parent" }, ctx)) as {
      ok: true
      value: {
        targeted_field: string
        targeted_value: unknown
        task_meta: { task_id: string; status: string }
      }
    }
    expect(r.value.targeted_field).toBe("answer")
    expect(r.value.targeted_value).toBe("crisp green notes")
    expect(r.value.task_meta?.task_id).toBe("task_A1")
    expect(r.value.task_meta?.status).toBe("success")
    // Manifest drops input_preview / input_refs even in parent scope
    expect(JSON.stringify(r.value)).not.toMatch(/input_preview|input_refs/)
  })

  it("task_result self drops input_preview and input_refs", async () => {
    mockTag.mockReturnValue({
      tag: 3,
      type: "task_result",
      id: "task_A1",
      extra: { experiment_id: "exp_A" },
    })
    const r = (await readContextTool.call({ id: "ctx_3", scope: "self" }, ctx)) as {
      ok: true
      value: Record<string, unknown>
    }
    expect(r.value.task_id).toBe("task_A1")
    expect(r.value.status).toBe("success")
    expect(r.value.output).toEqual({ answer: "crisp green notes" })
    expect(r.value.input_preview).toBeUndefined()
    expect(r.value.input_refs).toBeUndefined()
  })

  it("task_result parent has manifest task + 4-field experiment, drops prompt_template/notes", async () => {
    mockTag.mockReturnValue({
      tag: 3,
      type: "task_result",
      id: "task_A1",
      extra: { experiment_id: "exp_A" },
    })
    const r = (await readContextTool.call({ id: "ctx_3", scope: "parent" }, ctx)) as {
      ok: true
      value: { task_id: string; experiment: Record<string, unknown> }
    }
    expect(r.value.task_id).toBe("task_A1")
    expect(r.value.experiment).toEqual({
      id: "exp_A", name: "Exp A", schema_id: "sch_X", model: "gpt-4o",
    })
    expect(r.value.experiment.prompt_template).toBeUndefined()
    expect(r.value.experiment.notes).toBeUndefined()
    // Top-level task should not leak input_preview either
    expect(JSON.stringify(r.value)).not.toMatch(/SECRET|input_preview|input_refs/)
  })

  it("task_field parent returns err(NOT_FOUND) when task not found", async () => {
    mockTag.mockReturnValue({
      tag: 4,
      type: "task_field",
      id: "output.answer",
      extra: { experiment_id: "exp_A", task_id: "task_NONEXISTENT", field: "answer" },
    })
    // resolveContextSelf returns status:"missing" → resolveContextById returns null
    // → readContextTool returns err(NOT_FOUND)
    const r = await readContextTool.call({ id: "ctx_4", scope: "parent" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
  })

  it("rejects malformed ctx_id with err(NOT_FOUND)", async () => {
    // Non-empty but unresolvable id passes input validation, then hits resolve-context
    // and gets err(NOT_FOUND). mockTag returns undefined by default after reset.
    const r = await readContextTool.call({ id: "not_valid" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    })
  })
})
