// src/lib/copilot/manifest.ts
//
// Per-type self/parent manifest 纯函数。spec §3.2 表的代码实质化。
// resolveContextSelf / resolveContextById / read_page 共享这一组 shaper。
//
// 设计原则（spec §3 第 3 条）：input_preview / prompt_template / JSX 源码等
// 大字段一律不进 manifest；LLM 想看走专用工具 (read_resource / read_dataset_records)。
//
// ---- 与 spec §3.2 的字段层面偏差（以实际 TypeScript 类型定义为准）----
// - task_result / task_field 的 "metrics" 抽象被展平为
//   latency_ms / input_tokens / output_tokens / cost_value / cost_currency
//   （GenericResultRecord 实际是扁平字段，非嵌套 cost/usage 对象）
// - template manifest 的 "model" 字段 drop（TaskSchema 无此字段；model 属于 ExperimentConfig）
// - experiment manifest 的 "dataset_id" drop（ExperimentConfig 无此字段；通过 schema.inputs[].dataset_id 关联）
// - display.mode 实际 4 种（builtin|table|grouped_grid|jsx），dimension_count 按 mode 分支取
//   table → table.columns.length; grouped_grid → grouped_grid.cell_columns.length; 其他 0

import type { ExperimentConfig, RunStats, ExperimentStatus } from '@/lib/types'
import type {
  GenericResultRecord,
  ResultStatus,
  TaskSchema,
  Display,
  DatasetDef,
  FieldDef,
  Rubric,
} from '@/lib/schema/types'

type ManifestScope = 'self' | 'parent'

// ---------- experiment ----------

interface ExperimentManifest {
  id: string
  name: string
  status: ExperimentStatus
  schema_id?: string        // ExperimentConfig.schema_id 是 optional
  display_id?: string
  rubric_id?: string
  model: string
  run_stats?: RunStats
}

export function manifestExperiment(exp: ExperimentConfig): ExperimentManifest {
  return {
    id: exp.id,
    name: exp.name,
    status: exp.status,
    ...(exp.schema_id !== undefined ? { schema_id: exp.schema_id } : {}),
    ...(exp.display_id !== undefined ? { display_id: exp.display_id } : {}),
    ...(exp.rubric_id !== undefined ? { rubric_id: exp.rubric_id } : {}),
    model: exp.model,
    ...(exp.run_stats !== undefined ? { run_stats: exp.run_stats } : {}),
  }
}

// ---------- task_result ----------

interface TaskResultManifest {
  task_id: string
  status: ResultStatus
  output?: Record<string, unknown>
  error?: string
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  cost_value?: number
  cost_currency?: string
}

interface TaskResultManifestParent extends TaskResultManifest {
  experiment: {
    id: string
    name: string
    schema_id?: string
    model: string
  }
}

export function manifestTaskResult(
  found: GenericResultRecord,
  scope: ManifestScope,
  experiment?: ExperimentConfig | null,
): TaskResultManifest | TaskResultManifestParent {
  const self: TaskResultManifest = {
    task_id: found.task_id,
    status: found.status,
    ...(found.status === 'success' && found.output !== undefined ? { output: found.output } : {}),
    ...(found.error !== undefined ? { error: found.error } : {}),
    ...(found.latency_ms !== undefined ? { latency_ms: found.latency_ms } : {}),
    ...(found.input_tokens !== undefined ? { input_tokens: found.input_tokens } : {}),
    ...(found.output_tokens !== undefined ? { output_tokens: found.output_tokens } : {}),
    ...(found.cost_value !== undefined ? { cost_value: found.cost_value } : {}),
    ...(found.cost_currency !== undefined ? { cost_currency: found.cost_currency } : {}),
  }
  if (scope === 'parent' && experiment) {
    return {
      ...self,
      experiment: {
        id: experiment.id,
        name: experiment.name,
        ...(experiment.schema_id !== undefined ? { schema_id: experiment.schema_id } : {}),
        model: experiment.model,
      },
    }
  }
  return self
}

// ---------- task_field ----------

interface TaskFieldTaskMeta {
  task_id: string
  status: ResultStatus
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  cost_value?: number
  cost_currency?: string
}

interface TaskFieldManifest {
  targeted_field: string
  targeted_value: unknown
}

interface TaskFieldManifestParent extends TaskFieldManifest {
  task_meta: TaskFieldTaskMeta
}

export function manifestTaskField(
  field: string,
  value: unknown,
  scope: ManifestScope,
  taskMeta?: TaskFieldTaskMeta,
): TaskFieldManifest | TaskFieldManifestParent {
  const self: TaskFieldManifest = { targeted_field: field, targeted_value: value }
  if (scope === 'parent' && taskMeta) {
    return { ...self, task_meta: taskMeta }
  }
  return self
}

// ---------- dataset ----------

interface DatasetManifest {
  id: string
  name: string
  fields: FieldDef[]
  total_records: number
}

export function manifestDataset(def: DatasetDef, total_records: number): DatasetManifest {
  return {
    id: def.id,
    name: def.name,
    fields: def.fields,
    total_records,
  }
}

// ---------- template (TaskSchema) ----------

const PROMPT_EXCERPT_LIMIT = 300

interface TemplateManifest {
  id: string
  label: string
  description?: string
  prompt_template_excerpt: string
  variable_names: string[]
  output_field_names: string[]
}

export function manifestTemplate(schema: TaskSchema): TemplateManifest {
  const prompt = schema.default_prompt ?? ''
  const variables = schema.variables ?? []
  const properties = schema.output_schema?.properties ?? {}
  return {
    id: schema.id,
    label: schema.label,
    ...(schema.description !== undefined ? { description: schema.description } : {}),
    prompt_template_excerpt: prompt.slice(0, PROMPT_EXCERPT_LIMIT),
    variable_names: variables.map((v) => v.name),
    output_field_names: Object.keys(properties),
  }
}

// ---------- display ----------

interface DisplayManifest {
  id: string
  name: string
  mode: Display['mode']
  dimension_count: number
}

export function manifestDisplay(d: Display): DisplayManifest {
  let dimension_count = 0
  if (d.mode === 'table') {
    dimension_count = d.table?.columns.length ?? 0
  } else if (d.mode === 'grouped_grid') {
    dimension_count = d.grouped_grid?.cell_columns.length ?? 0
  }
  // 'builtin' / 'jsx' 无 columns 概念，保持 0
  return {
    id: d.id,
    name: d.name,
    mode: d.mode,
    dimension_count,
  }
}

// ---------- rubric ----------

interface RubricManifest {
  id: string
  name: string
  criteria_summary: Array<{
    key: string
    type: string
    label: string
  }>
}

export function manifestRubric(r: Rubric): RubricManifest {
  return {
    id: r.id,
    name: r.name,
    criteria_summary: r.criteria.map((c) => ({
      key: c.key,
      type: c.type,
      label: c.label,
    })),
  }
}
