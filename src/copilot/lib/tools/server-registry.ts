// Server-side tool registry: imports each tool descriptor (which itself
// imports its metadata) and exposes TOOLS array + toolByName Map.
//
// Tool 作者内部用 ToolDescriptor<Input, Output> 拿强类型；registry 用宽松
// any-input 视图，避免 call 的 contravariance 把各个 descriptor 拒给
// unknown-input 槽位。UI / runtime 遇 tool 时都经由 toolByName 查找
// → dispatch，不再关心具体 Input/Output。

import { listExperimentsTool } from "./list-experiments"
import { readExperimentResultsTool } from "./read-experiment-results"
import { restartExperimentTool } from "./restart-experiment"
import { readPageTool } from "./read-page"
import { readToolResultTool } from "./read-tool-result"
import { readContextTool } from "./read-context"
import { readResourceTool } from "./read-resource"
import { readDatasetRecordsTool } from "./read-dataset-records"
import { editTemplateTool } from "./edit-template"
import type { ToolDescriptor } from "./types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDescriptor = ToolDescriptor<any, unknown>

// Manual array registry. 加新工具：在 tools/{name}.ts export descriptor + 在
// {name}.metadata.ts export metadata；此文件 + client-registry.ts 各 import
// 一行；不走自注册（YAGNI）；toolByName 是 O(1) 查找。
export const TOOLS: ReadonlyArray<AnyToolDescriptor> = [
  listExperimentsTool,
  readExperimentResultsTool,
  restartExperimentTool,
  readPageTool,
  readToolResultTool,
  readContextTool,
  readResourceTool,
  readDatasetRecordsTool,
  editTemplateTool,
] as const

export const toolByName = new Map<string, AnyToolDescriptor>(
  TOOLS.map((t) => [t.name, t] as const),
)
