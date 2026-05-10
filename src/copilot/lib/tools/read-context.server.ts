import { resolveContextById } from "../resolve-context"
import type { ContextScope } from "../resolve-context"
import { getExperiment } from "@/lib/store"
import { getSchema } from "@/lib/schema"
import type { ImageRef } from "../types"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
import { readContextMetadata, type ReadContextInput } from "./read-context.metadata"

function defaultScope(_type: string): ContextScope {
  // 当前所有 type 默认 self；真正需要 parent 的场景让 LLM 明示
  // （spec §5.10.4 表：未来按 type 区分，现在保守为 self）
  return "self"
}

/**
 * Image vision §4.5: 仅对 task_result / task_field 收图，其他 ref.type 直接 undefined（短路）。
 * task_field 走 self_value.targeted_value（field_type='image_url' 时），任何其他 field_type 一律 0 张。
 * payloadGuardHook 会把 _attachments 提到 wrapper。
 */
function collectImageAttachments(
  r: NonNullable<ReturnType<typeof resolveContextById>>,
): ImageRef[] | undefined {
  if (r.type !== "task_result" && r.type !== "task_field") return undefined

  const ref = r.ref
  const extra = (ref.extra ?? {}) as {
    experiment_id?: string
    task_id?: string
    field?: string
    field_type?: string
  }
  const expId = extra.experiment_id
  if (!expId) return undefined

  if (r.type === "task_field") {
    if (extra.field_type !== "image_url") return undefined
    const self = r.self_value as { targeted_value?: unknown; targeted_field?: string } | null
    const url = self?.targeted_value
    if (typeof url !== "string" || !url) return undefined
    return [
      {
        url,
        source_label: `task_field#${extra.task_id ?? ref.id} · field=${self?.targeted_field ?? extra.field ?? ref.id}`,
      },
    ]
  }

  // task_result: walk schema.output_schema.properties
  const exp = getExperiment(expId)
  if (!exp) return undefined
  if (!exp.schema_id) return undefined
  const schema = getSchema(exp.schema_id)
  if (!schema) return undefined

  const self = r.self_value as { output?: Record<string, unknown> } | null
  const output = self?.output
  if (!output || typeof output !== "object") return undefined

  const refs = extractImageRefsFromOutput(
    output as Record<string, unknown>,
    schema,
    expId,
    undefined,
    ref.id,
  )
  if (refs.length === 0) return undefined
  return refs.slice(0, MAX_IMAGES_PER_TURN)
}

export const readContextTool: ToolDescriptor<ReadContextInput, unknown> = {
  ...readContextMetadata,
  call: async ({ id, scope }, ctx) => {
    if (!id || typeof id !== "string") {
      return err("INVALID_INPUT", "id is required", {
        hint: 'Pass id like "ctx_1" referring to active_contexts[]',
      })
    }
    const r = resolveContextById(ctx.session_id, id)
    if (!r) {
      return err("NOT_FOUND", `context ${id} not found in current session`, {
        hint: "Check active_contexts list in system header",
      })
    }
    const useScope = scope ?? defaultScope(r.type)
    const value =
      useScope === "self"
        ? r.self_value
        : useScope === "parent"
          ? (r.parent_value ?? r.self_value)
          : (r.full_value ?? r.parent_value ?? r.self_value)

    // Image vision §4.5: 仅对 task_result / task_field 收图；payloadGuardHook lifts to wrapper.
    const attachments = collectImageAttachments(r)
    if (attachments && attachments.length > 0 && value && typeof value === "object") {
      return ok({ ...(value as Record<string, unknown>), _attachments: attachments })
    }
    return ok(value)
  },
}
