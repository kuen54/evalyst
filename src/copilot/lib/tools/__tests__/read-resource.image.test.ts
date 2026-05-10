import { describe, it, expect, vi } from "vitest"
import type { ImageRef } from "@/copilot/lib/types"

vi.mock("@/lib/store", () => ({
  getExperiment: (id: string) => {
    if (id === "exp_img") return { id, name: "Img", schema_id: "sch_img", model: "gpt-4o" }
    if (id === "exp_text") return { id, name: "Text", schema_id: "sch_text_only", model: "gpt-4o" }
    return null
  },
  readResults: (id: string) => {
    if (id === "exp_img") {
      return [
        {
          task_id: "t1",
          status: "success",
          experiment_id: "exp_img",
          output: { caption: "a", image_url: "/api/results/exp_img/images/a.png" },
        },
        {
          task_id: "t2",
          status: "success",
          experiment_id: "exp_img",
          output: { caption: "b", image_url: "/api/results/exp_img/images/b.png" },
        },
      ]
    }
    if (id === "exp_text") {
      return [{ task_id: "t1", status: "success", output: { text: "no images" } }]
    }
    return []
  },
}))
vi.mock("@/lib/schema", () => ({
  getSchema: (id: string) => {
    if (id === "sch_img") {
      return {
        id, label: "img", version: 1, inputs: [], variables: [], default_prompt: "",
        message_builder: {},
        output_schema: {
          type: "object",
          properties: { caption: { type: "string" }, image_url: { type: "image_url" } },
        },
      }
    }
    if (id === "sch_text_only") {
      return {
        id, label: "text", version: 1, inputs: [], variables: [], default_prompt: "",
        message_builder: {},
        output_schema: { type: "object", properties: { text: { type: "string" } } },
      }
    }
    return null
  },
}))
vi.mock("@/lib/datasets", () => ({ getDataset: () => null }))
vi.mock("@/lib/displays", () => ({ getDisplay: () => null }))
vi.mock("@/lib/rubric-store", () => ({ getRubric: () => null }))

import { readResourceTool } from "../read-resource"

const ctx = { session_id: "s_rr_img", signal: new AbortController().signal }

describe("read_resource · image attachments", () => {
  it("type=experiment + image-bearing schema → _attachments has refs from successful rows", async () => {
    const r = (await readResourceTool.call({ type: "experiment", id: "exp_img" }, ctx)) as {
      ok: true
      value: { _attachments?: ImageRef[] } & Record<string, unknown>
    }
    expect(r.ok).toBe(true)
    expect(r.value._attachments).toBeDefined()
    expect(r.value._attachments!.map((a) => a.url)).toEqual([
      "/api/results/exp_img/images/a.png",
      "/api/results/exp_img/images/b.png",
    ])
  })

  it("type=experiment + text-only schema → no _attachments key", async () => {
    const r = (await readResourceTool.call({ type: "experiment", id: "exp_text" }, ctx)) as {
      ok: true
      value: Record<string, unknown>
    }
    expect("_attachments" in r.value).toBe(false)
  })
})
