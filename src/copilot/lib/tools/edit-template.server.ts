// edit_template · v2 · spec §5.9
// Copilot 的第一个"写"工具。允许 LLM 把用户同意的 prompt template 改动落到 data/schemas/{id}.json。
//
// 关键约束：
//   - isDestructive = true → runTool pipeline 中 confirmGateHook 强制 require_confirm；
//     UI 的 WriteVariant tool-call-card 弹"[拒绝] [确认]"。
//   - patch 是 shallow merge 到 loaded TaskSchema。LLM 通常会给全量 prompt_template 字段；
//     也支持只传 label / description / 其他扁平字段。深层字段（variables / message_builder 等）
//     要覆盖就传完整新值，避免半融合踩坑。
//   - version 自增：写入前把 (schema.version ?? 0) + 1 作为 new_version。前端不感知，
//     但让 LLM / 审计能看到"这是第几次改"。
//   - createUserSchema 本身对 id / 源文件幂等 upsert —— 不存在的 id 会直接 throw
//     (因为我们先 getUserSchema 检查了)，存在的直接写盘。

import type { ToolDescriptor } from "./types"
import type { TaskSchema } from "@/lib/schema/types"
import { getUserSchema, createUserSchema } from "@/lib/schema/user-schema-store"
import { ok, err } from "./tool-result"
import {
  editTemplateMetadata,
  type EditTemplateInput,
  type EditTemplateOutput,
} from "./edit-template.metadata"

export const editTemplateTool: ToolDescriptor<EditTemplateInput, EditTemplateOutput> = {
  ...editTemplateMetadata,
  call: async ({ schema_id, patch }) => {
    if (!schema_id || typeof schema_id !== "string") {
      return err("INVALID_INPUT", "schema_id is required", {
        hint: "Pass schema_id as string",
      })
    }
    if (!patch || typeof patch !== "object") {
      return err("INVALID_INPUT", "patch is required", {
        hint: "Pass patch object with fields to update",
      })
    }
    const schema = getUserSchema(schema_id)
    if (!schema) {
      return err("NOT_FOUND", `template ${schema_id} not found`, {
        hint: "Use list_experiments / read_resource to find templates",
      })
    }

    const newVersion = (schema.version ?? 0) + 1
    // Shallow merge; id cannot be changed (patch.id is ignored to keep file path stable).
    const updated: TaskSchema = {
      ...schema,
      ...patch,
      id: schema.id,
      version: newVersion,
    }
    createUserSchema(updated)
    return ok({ success: true, new_version: newVersion, schema_id })
  },
}
