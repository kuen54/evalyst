import type { ToolMetadataDescriptor } from "./types"

export type ReadResourceType = "experiment" | "template" | "dataset" | "display" | "rubric"

export interface ReadResourceInput {
  type: ReadResourceType
  id: string
  /** 只取这些字段；省略 = 全量 */
  fields?: string[]
}

export const readResourceMetadata: ToolMetadataDescriptor = {
  name: "read_resource",
  description:
    "Fetch a specific platform resource by id. id format depends on type:\n" +
    "- experiment: experiment_id (e.g. 'exp_osDX-dG6')\n" +
    "- template: schema_id (e.g. 'fortune_v4') — NOT a separate template id; same value as experiment.schema_id\n" +
    "- dataset: dataset_id (e.g. 'boxes')\n" +
    "- display: display_id\n" +
    "- rubric: rubric_id\n" +
    "\n" +
    "Available `fields` per type (top-level only — pass exact names, NEVER guess):\n" +
    "- experiment: schema_id, model, model_id, prompt_template, temperature, max_tokens, api_config, dataset_bindings, filter_values, status, run_stats, notes, created_at, updated_at\n" +
    "- template: schema_id, name, description, fields, system_prompt, prompt_template, model_overrides, version\n" +
    "- dataset: id, name, schema, records (records can be huge; consider read_dataset_records instead)\n" +
    "- display: id, name, schema_id, mode, source\n" +
    "- rubric: id, name, schema_id, criteria\n" +
    "\n" +
    "If the field you need isn't in the list above, omit `fields` to get full resource. " +
    "If you pass `fields` and the response includes `_warning.unknown_fields`, those names don't exist — pick from `available_fields` and retry. " +
    "Use when active_contexts doesn't cover the resource you need — e.g. user circled an experiment but you want to read its linked template (call read_resource(type='template', id=<that experiment's schema_id>)).",
  inputSchema: {
    type: "object",
    required: ["type", "id"],
    properties: {
      type: {
        type: "string",
        enum: ["experiment", "template", "dataset", "display", "rubric"],
      },
      id: {
        type: "string",
        description:
          "Resource id. For type='template' this is the schema_id (e.g. 'fortune_v4'), not a 'tpl_xxx' string — there's no separate template entity.",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Subset of top-level fields to return (see description for valid names per type). Omit for full resource. Unknown fields surface as `_warning.unknown_fields` in response — DO NOT fabricate data for them, retry with valid names.",
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    // v0.18.7 G3: 4000→12000。template / dataset 字段多通常超 4KB；read_tool_result
    // skipPayloadGuard 后过限不再死循环，12000 让常规查询直接 inline 省一轮 round-trip。
    maxResultSizeChars: 12000,
  },
}
