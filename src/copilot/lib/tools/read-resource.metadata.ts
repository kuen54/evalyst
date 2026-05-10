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
}
