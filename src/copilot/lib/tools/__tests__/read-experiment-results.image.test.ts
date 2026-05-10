import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TaskSchema } from "@/lib/schema/types"
import type { ExperimentConfig } from "@/lib/types"
import type { ImageRef } from "@/copilot/lib/types"

const schema: TaskSchema = {
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
    } as never,
  },
} as TaskSchema

function row(taskId: string, status: "success" | "error", output?: Record<string, unknown>) {
  return {
    task_id: taskId,
    status,
    experiment_id: "exp_img",
    schema_id: "sch_img",
    schema_version: 1,
    input_refs: {},
    input_preview: {},
    timestamp: "2026-05-09T00:00:00Z",
    model: "m",
    output: output ?? {},
  }
}

vi.mock("@/lib/store", () => ({
  readResults: (id: string) => {
    if (id === "exp_img_3") {
      return [
        row("t1", "success", { caption: "a", image_url: "/api/results/exp_img_3/images/a.png" }),
        row("t2", "success", { caption: "b", image_url: "/api/results/exp_img_3/images/b.png" }),
        row("t3", "success", { caption: "c", image_url: "/api/results/exp_img_3/images/c.png" }),
      ]
    }
    if (id === "exp_img_10") {
      return Array.from({ length: 10 }, (_, i) =>
        row(`t${i}`, "success", { caption: `c${i}`, image_url: `/api/results/exp_img_10/images/${i}.png` }),
      )
    }
    if (id === "exp_img_failed") {
      return [
        row("t1", "error"),
        row("t2", "error"),
      ]
    }
    if (id === "exp_no_schema_image") {
      return [
        row("t1", "success", { text: "no images here" }),
      ]
    }
    return []
  },
  getExperiment: (id: string) =>
    ({ id, schema_id: id === "exp_no_schema_image" ? "sch_text_only" : "sch_img" }) as ExperimentConfig,
}))
vi.mock("@/lib/schema", () => ({
  getSchema: (id: string) => {
    if (id === "sch_img") return schema
    if (id === "sch_text_only") {
      return {
        ...schema,
        id: "sch_text_only",
        output_schema: { type: "object", properties: { text: { type: "string" } } as never },
      } as TaskSchema
    }
    return null
  },
}))

import { readExperimentResultsTool } from "../read-experiment-results"

const ctx = { session_id: "s_img", signal: new AbortController().signal }

beforeEach(() => {
  // mocks fresh per case
})

describe("read_experiment_results · image attachments", () => {
  it("3 successful results each with image_url → _attachments has 3 entries", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_img_3" },
      ctx,
    )) as { ok: true; value: { results: unknown[]; _attachments?: ImageRef[] } }
    expect(r.ok).toBe(true)
    expect(r.value._attachments).toBeDefined()
    expect(r.value._attachments).toHaveLength(3)
    expect(r.value._attachments!.map((a) => a.url)).toEqual([
      "/api/results/exp_img_3/images/a.png",
      "/api/results/exp_img_3/images/b.png",
      "/api/results/exp_img_3/images/c.png",
    ])
    expect(r.value._attachments![0]!.ctx_tag).toBeUndefined()
  })

  it("10 successful results → _attachments capped at MAX_IMAGES_PER_TURN=5", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_img_10" },
      ctx,
    )) as { ok: true; value: { results: unknown[]; _attachments?: ImageRef[] } }
    expect(r.value._attachments).toHaveLength(5)
  })

  it("0 successful results (all failed) → no _attachments key in output", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_img_failed" },
      ctx,
    )) as { ok: true; value: Record<string, unknown> }
    expect(r.ok).toBe(true)
    expect("_attachments" in r.value).toBe(false)
  })

  it("schema with no image fields → no _attachments key", async () => {
    const r = (await readExperimentResultsTool.call(
      { experiment_id: "exp_no_schema_image" },
      ctx,
    )) as { ok: true; value: Record<string, unknown> }
    expect("_attachments" in r.value).toBe(false)
  })
})
