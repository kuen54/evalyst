import { getExperiment } from "@/lib/store"
import { getSchema } from "@/lib/schema"
import { getDataset } from "@/lib/datasets"
import { getDisplay } from "@/lib/displays"
import { getRubric } from "@/lib/rubric-store"
import type { ToolDescriptor } from "./types"

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
    if (!type || !id) throw new Error("type and id are required")
    const res = loadResource(type, id)
    if (!res) throw new Error(`${type}/${id} not found`)
    return fields && fields.length > 0 ? pickFields(res, fields) : res
  },
}
