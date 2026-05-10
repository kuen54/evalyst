// Client-safe consolidation of tool metadata. UI components (tool-call-card,
// use-chat-stream) consume from here to render Confirm gates / variant badges
// without pulling server-only deps (fs / store / db).
//
// Each {name}.metadata.ts exports a ToolMetadataDescriptor; this file
// imports + collects them. There is no separate manual mirror — the
// previous metadata-client.ts pattern (and its strict-sync test) is gone
// because there is now a single source per tool.
//
// 加新 tool：在 {name}.metadata.ts export → import 在此 → 加进 CLIENT_TOOLS。

import type { ToolMetadataDescriptor } from "./types"
import { listExperimentsMetadata } from "./list-experiments.metadata"
import { readExperimentResultsMetadata } from "./read-experiment-results.metadata"
import { restartExperimentMetadata } from "./restart-experiment.metadata"
import { readPageMetadata } from "./read-page.metadata"
import { readToolResultMetadata } from "./read-tool-result.metadata"
import { readContextMetadata } from "./read-context.metadata"
import { readResourceMetadata } from "./read-resource.metadata"
import { readDatasetRecordsMetadata } from "./read-dataset-records.metadata"
import { editTemplateMetadata } from "./edit-template.metadata"

export const CLIENT_TOOLS: ReadonlyArray<ToolMetadataDescriptor> = [
  listExperimentsMetadata,
  readExperimentResultsMetadata,
  restartExperimentMetadata,
  readPageMetadata,
  readToolResultMetadata,
  readContextMetadata,
  readResourceMetadata,
  readDatasetRecordsMetadata,
  editTemplateMetadata,
] as const

const toolMetadataByName = new Map<string, ToolMetadataDescriptor>(
  CLIENT_TOOLS.map((t) => [t.name, t] as const),
)

export function findClientToolMetadata(name: string): ToolMetadataDescriptor | null {
  return toolMetadataByName.get(name) ?? null
}

/** UI 判断：这个工具调用是否需要用户点 Confirm。 */
export function needsConfirm(name: string): boolean {
  const meta = findClientToolMetadata(name)
  if (!meta) return false
  return meta.metadata.requiresConfirm ?? meta.metadata.isDestructive
}
