import { getExperiment, readResults } from "@/lib/store"
import { getSchema } from "@/lib/schema"
import { getDataset } from "@/lib/datasets"
import { getDisplay } from "@/lib/displays"
import { getRubric } from "@/lib/rubric-store"
import type { ImageRef } from "../types"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"

type ResourceType = "experiment" | "template" | "dataset" | "display" | "rubric"

interface Input {
  type: ResourceType
  id: string
  /** 只取这些字段；省略 = 全量 */
  fields?: string[]
}

function loadResource(type: ResourceType, id: string): unknown {
  switch (type) {
    case "experiment":
      return getExperiment(id)
    case "template":
      return getSchema(id)
    case "dataset": {
      // getDataset 抛错而非返 null；先 try/catch
      try {
        return getDataset(id)
      } catch {
        return null
      }
    }
    case "display":
      return getDisplay(id)
    case "rubric":
      return getRubric(id)
  }
}

function pickFields(obj: unknown, fields: string[]): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {}
  const src = obj as Record<string, unknown>
  return Object.fromEntries(
    fields.map((f) => [f, src[f]]).filter(([, v]) => v !== undefined),
  )
}

export const readResourceTool: ToolDescriptor<Input, unknown> = {
  name: "read_resource",
  description:
    "Fetch a specific platform resource (experiment/template/dataset/display/rubric) by id. Use fields parameter to select subset (e.g. fields=['schema_id','prompt_template']). Use when active_contexts doesn't cover the resource you need — e.g. user circled an experiment but you want to read its linked template.",
  inputSchema: {
    type: "object",
    required: ["type", "id"],
    properties: {
      type: {
        type: "string",
        enum: ["experiment", "template", "dataset", "display", "rubric"],
      },
      id: { type: "string" },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Subset of top-level fields to return. Omit for full resource.",
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    // template / dataset 通常比 task 大；4KB 给缓冲，超出走 payloadGuard 落盘
    maxResultSizeChars: 4000,
  },
  call: async ({ type, id, fields }) => {
    if (!type || !id) {
      return err("INVALID_INPUT", "type and id are required", {
        hint: 'Pass both type (e.g. "experiment") and id',
      })
    }
    const res = loadResource(type, id)
    if (!res) {
      return err("NOT_FOUND", `${type}/${id} not found`, {
        hint: "Verify the resource exists",
      })
    }
    const value = fields && fields.length > 0 ? pickFields(res, fields) : res

    // Image vision §4.5: only experiment type may attach images (sample task_result
    // outputs). Other types (template / dataset / display / rubric) are metadata,
    // never images. Resist over-engineering — simple branch by type.
    if (type === "experiment") {
      const attachments = collectExperimentAttachments(id)
      if (attachments && attachments.length > 0 && value && typeof value === "object") {
        return ok({ ...(value as Record<string, unknown>), _attachments: attachments })
      }
    }
    return ok(value)
  },
}

/**
 * Walk the experiment's results.jsonl, attach images from successful rows up to
 * MAX_IMAGES_PER_TURN. Mirrors read_experiment_results' helper but called from
 * read_resource when type='experiment'.
 */
function collectExperimentAttachments(expId: string): ImageRef[] | undefined {
  const exp = getExperiment(expId)
  if (!exp) return undefined
  if (!exp.schema_id) return undefined
  const schema = getSchema(exp.schema_id)
  if (!schema) return undefined
  const all = readResults(expId)
  const refs: ImageRef[] = []
  for (const r of all) {
    if (r.status !== "success") continue
    if (refs.length >= MAX_IMAGES_PER_TURN) break
    const outRefs = extractImageRefsFromOutput(
      (r.output ?? {}) as Record<string, unknown>,
      schema,
      expId,
      undefined,
      r.task_id,
    )
    for (const ref of outRefs) {
      if (refs.length >= MAX_IMAGES_PER_TURN) break
      refs.push(ref)
    }
  }
  return refs.length > 0 ? refs : undefined
}
