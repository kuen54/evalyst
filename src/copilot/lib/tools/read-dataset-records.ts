import { getDataset } from "@/lib/datasets"
import type { ToolDescriptor } from "./types"
import { ok, err } from "./tool-result"
import {
  readDatasetRecordsMetadata,
  READ_DATASET_RECORDS_DEFAULT_LIMIT as DEFAULT_LIMIT,
  READ_DATASET_RECORDS_MAX_LIMIT as MAX_LIMIT,
  type ReadDatasetRecordsInput,
  type ReadDatasetRecordsOutput,
} from "./read-dataset-records.metadata"

export const readDatasetRecordsTool: ToolDescriptor<ReadDatasetRecordsInput, ReadDatasetRecordsOutput> = {
  ...readDatasetRecordsMetadata,
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
