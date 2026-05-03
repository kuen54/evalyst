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

interface Input {
  schema_id: string
  /** Shallow-merged into the loaded TaskSchema. Missing keys are preserved. */
  patch: Partial<TaskSchema>
}

interface Output {
  success: boolean
  new_version: number
  schema_id: string
}

export const editTemplateTool: ToolDescriptor<Input, Output> = {
  name: "edit_template",
  description:
    "Edit a prompt template by shallow-merging `patch` into the stored TaskSchema. DESTRUCTIVE — user confirmation is required. Use after read_resource(type='template', id=schema_id) to see the current state. Returns the bumped version.",
  inputSchema: {
    type: "object",
    required: ["schema_id", "patch"],
    properties: {
      schema_id: { type: "string" },
      patch: {
        type: "object",
        description:
          "Partial<TaskSchema> shallow-merged into the loaded schema. Common fields: label, description, default_prompt. Deep fields (variables, message_builder, output_schema) must be provided whole — they replace, not merge.",
      },
    },
  },
  metadata: {
    isReadOnly: false,
    isDestructive: true,
    maxResultSizeChars: 1000,
  },
  call: async ({ schema_id, patch }) => {
    if (!schema_id || typeof schema_id !== "string") {
      throw new Error("schema_id is required")
    }
    if (!patch || typeof patch !== "object") {
      throw new Error("patch is required")
    }
    const schema = getUserSchema(schema_id)
    if (!schema) throw new Error(`template ${schema_id} not found`)

    const newVersion = (schema.version ?? 0) + 1
    // Shallow merge; id cannot be changed (patch.id is ignored to keep file path stable).
    const updated: TaskSchema = {
      ...schema,
      ...patch,
      id: schema.id,
      version: newVersion,
    }
    createUserSchema(updated)
    return { success: true, new_version: newVersion, schema_id }
  },
}
