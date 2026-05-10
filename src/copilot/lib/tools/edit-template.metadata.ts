import type { ToolMetadataDescriptor } from "./types"
import type { TaskSchema } from "@/lib/schema/types"

export interface EditTemplateInput {
  schema_id: string
  /** Shallow-merged into the loaded TaskSchema. Missing keys are preserved. */
  patch: Partial<TaskSchema>
}

export interface EditTemplateOutput {
  success: boolean
  new_version: number
  schema_id: string
}

export const editTemplateMetadata: ToolMetadataDescriptor = {
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
}
