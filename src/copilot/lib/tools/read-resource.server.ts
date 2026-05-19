import { getExperiment, readResults } from "@/lib/store"
import { getSchema } from "@/lib/schema"
import { getDataset } from "@/lib/datasets"
import { getDisplay } from "@/lib/displays"
import { getRubric } from "@/lib/rubric-store"
import type { ImageRef } from "../types"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
import {
  readResourceMetadata,
  type ReadResourceInput,
  type ReadResourceType,
} from "./read-resource.metadata"

function loadResource(type: ReadResourceType, id: string): unknown {
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

/**
 * v0.18.22 PR-A：之前用 `.filter(([,v]) => v !== undefined)` 静默丢弃未知字段。
 * LLM 问 ["schema_id", "variables"] 拿到 {schema_id: "fortune_v4"} 完全分不清是
 * "variables 字段不存在" 还是 "值为 null"——session dnbsrpjz3y 实证导致 LLM 直接
 * 编造模型名（"claude-sonnet-4-20250514" / "gemini-3.1-pro-preview"，工具结果里 0 出现）。
 *
 * 改为：picked + unknown_fields + available_fields 三段返回；LLM 看到 _warning 就
 * 知道字段不存在，能换个名字 retry。
 */
function pickFields(obj: unknown, fields: string[]): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {}
  const src = obj as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  const unknownFields: string[] = []
  for (const f of fields) {
    if (f in src) {
      // 包含 undefined / null 也保留（语义上"字段存在但无值"，与"字段不存在"区分）
      picked[f] = src[f]
    } else {
      unknownFields.push(f)
    }
  }
  if (unknownFields.length > 0) {
    picked._warning = {
      unknown_fields: unknownFields,
      available_fields: Object.keys(src),
      hint: "These field names don't exist on this resource. Pick from available_fields and call again. DO NOT fabricate data for missing fields.",
    }
  }
  return picked
}

/** v0.18.7 G4: NOT_FOUND 时按 type 给具体 hint，避免 LLM 编 id（session repro: LLM
 *  把 'tpl_aB92xkLq' 当 template id 反复试，实际应传 schema_id）。 */
function notFoundHint(type: ReadResourceType): string {
  switch (type) {
    case "template":
      return "For type='template', id is the schema_id (e.g. 'fortune_v4'), NOT a 'tpl_xxx' string. Get it from experiment.schema_id (call read_resource(type='experiment', id=<exp_id>, fields=['schema_id']) first)."
    case "experiment":
      return "Verify the experiment exists. Use list_experiments to enumerate."
    case "dataset":
      return "id is the dataset_id (e.g. 'boxes'). Get it from experiment.dataset_bindings."
    case "display":
      return "id is the display_id."
    case "rubric":
      return "id is the rubric_id (e.g. 'rb_xxx')."
  }
}

export const readResourceTool: ToolDescriptor<ReadResourceInput, unknown> = {
  ...readResourceMetadata,
  call: async ({ type, id, fields }) => {
    if (!type || !id) {
      return err("INVALID_INPUT", "type and id are required", {
        hint: 'Pass both type (e.g. "experiment") and id',
      })
    }
    const res = loadResource(type, id)
    if (!res) {
      return err("NOT_FOUND", `${type}/${id} not found`, {
        hint: notFoundHint(type),
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
