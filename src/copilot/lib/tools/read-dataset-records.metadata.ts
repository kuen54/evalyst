import type { ToolMetadataDescriptor } from "./types"

export interface ReadDatasetRecordsInput {
  dataset_id: string
  task_id?: string
  limit?: number
  offset?: number
}

export interface ReadDatasetRecordsOutput {
  records: Array<Record<string, unknown>>
  total: number
  has_more: boolean
}

export const READ_DATASET_RECORDS_DEFAULT_LIMIT = 5
export const READ_DATASET_RECORDS_MAX_LIMIT = 20

export const readDatasetRecordsMetadata: ToolMetadataDescriptor = {
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
        description: `How many records to return (default ${READ_DATASET_RECORDS_DEFAULT_LIMIT}, max ${READ_DATASET_RECORDS_MAX_LIMIT}).`,
      },
      offset: { type: "number", description: "Pagination offset (default 0)." },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 8000,
  },
}
