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
    "Use fields parameter to select subset (e.g. fields=['schema_id','prompt_template']). " +
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
        description: "Subset of top-level fields to return. Omit for full resource.",
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
