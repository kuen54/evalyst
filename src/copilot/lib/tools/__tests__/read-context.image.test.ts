import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import type { ImageRef } from "@/lib/copilot/types"

const mockTag = vi.fn<(sessionId: string, tag: number) => unknown>()
vi.mock("../../session-store", async () => {
  const actual = await vi.importActual<typeof import("../../session-store")>("../../session-store")
  return {
    ...actual,
    getActiveContextByTag: (sessionId: string, tag: number) => mockTag(sessionId, tag),
  }
})

vi.mock("@/lib/schema", () => ({
  getSchema: (id: string) => {
    if (id === "sch_img") {
      return {
        id: "sch_img",
        label: "img",
        version: 1,
        inputs: [],
        variables: [],
        default_prompt: "",
        message_builder: {},
        output_schema: {
          type: "object",
          properties: {
            caption: { type: "string" },
            image_url: { type: "image_url" },
          },
        },
      }
    }
    if (id === "sch_text_only") {
      return {
        id: "sch_text_only",
        label: "text",
        version: 1,
        inputs: [],
        variables: [],
        default_prompt: "",
        message_builder: {},
        output_schema: { type: "object", properties: { text: { type: "string" } } },
      }
    }
    return null
  },
}))

import { readContextTool } from "../read-context"

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-ctx-img-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
  mockTag.mockReset()

  await fs.mkdir(path.join(tmpDir, "data", "experiments"), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, "data", "experiments", "exp_img.json"),
    JSON.stringify({
      id: "exp_img",
      name: "Img Exp",
      model: "gpt-4o",
      status: "completed",
      schema_id: "sch_img",
      api_config: { api_format: "openai", base_url: "x", api_key: "k" },
      temperature: 1,
    }),
  )
  await fs.mkdir(path.join(tmpDir, "data", "results", "exp_img"), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, "data", "results", "exp_img", "results.jsonl"),
    JSON.stringify({
      task_id: "task_img_1",
      input: { prompt: "a cat" },
      output: { caption: "a cat", image_url: "/api/results/exp_img/images/cat.png" },
      status: "success",
      experiment_id: "exp_img",
    }) + "\n",
  )

  await fs.writeFile(
    path.join(tmpDir, "data", "experiments", "exp_text.json"),
    JSON.stringify({
      id: "exp_text",
      name: "Text Exp",
      model: "gpt-4o",
      status: "completed",
      schema_id: "sch_text_only",
      api_config: { api_format: "openai", base_url: "x", api_key: "k" },
      temperature: 1,
    }),
  )
  await fs.mkdir(path.join(tmpDir, "data", "results", "exp_text"), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, "data", "results", "exp_text", "results.jsonl"),
    JSON.stringify({
      task_id: "task_text_1",
      input: {},
      output: { text: "no images here" },
      status: "success",
      experiment_id: "exp_text",
    }) + "\n",
  )
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const ctx = { session_id: "s_ctx_img", signal: new AbortController().signal }

describe("read_context · image attachments", () => {
  it("task_result with declared image_url field → _attachments has 1 entry", async () => {
    mockTag.mockReturnValue({
      tag: 1,
      type: "task_result",
      id: "task_img_1",
      extra: { experiment_id: "exp_img" },
    })
    const r = (await readContextTool.call({ id: "ctx_1" }, ctx)) as {
      ok: true
      value: { _attachments?: ImageRef[] } & Record<string, unknown>
    }
    expect(r.ok).toBe(true)
    expect(r.value._attachments).toBeDefined()
    expect(r.value._attachments).toHaveLength(1)
    expect(r.value._attachments![0]!.url).toBe("/api/results/exp_img/images/cat.png")
  })

  it("task_field with extra.field_type='image_url' → _attachments has 1 entry", async () => {
    mockTag.mockReturnValue({
      tag: 2,
      type: "task_field",
      id: "output.image_url",
      extra: {
        experiment_id: "exp_img",
        task_id: "task_img_1",
        field: "image_url",
        field_type: "image_url",
      },
    })
    const r = (await readContextTool.call({ id: "ctx_2", scope: "self" }, ctx)) as {
      ok: true
      value: { _attachments?: ImageRef[] } & Record<string, unknown>
    }
    expect(r.value._attachments).toHaveLength(1)
    expect(r.value._attachments![0]!.url).toBe("/api/results/exp_img/images/cat.png")
    expect(r.value._attachments![0]!.source_label).toContain("field=image_url")
  })

  it("experiment ref → no _attachments key on output", async () => {
    mockTag.mockReturnValue({ tag: 3, type: "experiment", id: "exp_img" })
    const r = (await readContextTool.call({ id: "ctx_3" }, ctx)) as {
      ok: true
      value: Record<string, unknown>
    }
    expect("_attachments" in r.value).toBe(false)
  })

  it("task_result with text-only schema → no _attachments key", async () => {
    mockTag.mockReturnValue({
      tag: 4,
      type: "task_result",
      id: "task_text_1",
      extra: { experiment_id: "exp_text" },
    })
    const r = (await readContextTool.call({ id: "ctx_4" }, ctx)) as {
      ok: true
      value: Record<string, unknown>
    }
    expect("_attachments" in r.value).toBe(false)
  })
})
