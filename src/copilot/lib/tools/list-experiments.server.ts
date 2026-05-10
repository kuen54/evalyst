import { listExperiments } from "@/lib/store"
import {
  listExperimentsMetadata,
  type ListExperimentsInput,
  type ListExperimentsOutput,
} from "./list-experiments.metadata"
import type { ToolDescriptor } from "./types"

export const listExperimentsTool: ToolDescriptor<ListExperimentsInput, ListExperimentsOutput> = {
  ...listExperimentsMetadata,
  call: async (input) => {
    const all = listExperiments()
    let filtered = all
    if (input.status) filtered = filtered.filter((e) => e.status === input.status)
    if (input.schema_id) filtered = filtered.filter((e) => e.schema_id === input.schema_id)
    const limit = Math.min(Number(input.limit ?? 20), 50)
    return {
      experiments: filtered.slice(0, limit).map((e) => ({
        id: e.id,
        name: e.name,
        model: e.model,
        status: e.status,
        ...(e.schema_id !== undefined ? { schema_id: e.schema_id } : {}),
        completed_tasks: e.run_stats?.completed_tasks ?? 0,
        total_tasks: e.run_stats?.total_tasks ?? 0,
        failed_tasks: e.run_stats?.failed_tasks ?? 0,
      })),
      total_matching: filtered.length,
      returned: Math.min(filtered.length, limit),
    }
  },
}
