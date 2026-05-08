import { getDataset } from "@/lib/datasets"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"

interface Input {
  dataset_id: string
  task_id?: string
  limit?: number
  offset?: number
}

interface Output {
  records: Array<Record<string, unknown>>
  total: number
  has_more: boolean
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

export const readDatasetRecordsTool: ToolDescriptor<Input, Output> = {
  name: "read_dataset_records",
  description:
    "Read raw records from a dataset. Use after read_resource(dataset) when the user's question needs actual record content. Pass task_id for one specific record (matched by dataset.id_field), or use limit/offset for pagination (limit defaults to 5, max 20).",
  inputSchema: {
    type: "object",
    required: ["dataset_id"],
    properties: {
      dataset_id: { type: "string", description: "Dataset id (slug)." },
      task_id: {
        type: "string",
        description:
          "Optional. When given, returns the single record whose dataset.id_field matches this value. Skip pagination.",
      },
      limit: {
        type: "number",
        description: `How many records to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
      },
      offset: { type: "number", description: "Pagination offset (default 0)." },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 8000,
  },
  call: async ({ dataset_id, task_id, limit = DEFAULT_LIMIT, offset = 0 }) => {
    if (!dataset_id) {
      return err("INVALID_INPUT", "dataset_id is required", {
        hint: "Pass dataset_id as string",
      })
    }

    let bundle: {
      def: { id_field: string; name?: string }
      records: Array<Record<string, unknown>>
    }
    try {
      bundle = getDataset(dataset_id) as typeof bundle
    } catch {
      return err("NOT_FOUND", `dataset ${dataset_id} not found`, {
        hint: 'Use read_resource(type:"dataset") to verify',
      })
    }

    const { def, records } = bundle
    const total = records.length

    if (task_id) {
      const match = records.find((r) => r[def.id_field] === task_id)
      return ok({
        records: match ? [match] : [],
        total,
        has_more: false,
      })
    }

    const cap = Math.min(Math.max(0, limit), MAX_LIMIT)
    const start = Math.max(0, offset)
    const slice = records.slice(start, start + cap)
    return ok({
      records: slice,
      total,
      has_more: start + cap < total,
    })
  },
}
