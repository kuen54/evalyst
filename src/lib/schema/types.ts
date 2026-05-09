// ---------- TaskSchema & 相关类型 ----------
// 整个 evalyst 平台的「任务定义」抽象。每个 Schema 声明：
// - 需要哪些数据源（inputs，笛卡尔积基础）
// - 从输入里抽哪些 prompt 变量（variables，可链式 transform）
// - LLM 消息如何构造（system 由 prompt_template 渲染，user 由 message_builder 生成，支持多模态）
// - 输出 JSON 的 schema 校验
// - 展示器：display_id 显式指定，或由 display_dimensions 自动推断（display-inference.ts）
//
// 详见 /Users/lijiakun/.claude/plans/ethereal-churning-dusk.md

// --- Variables & transforms ---

export interface VariableDef {
  name: string
  source: string                       // 'item.title' | 'user.role' | 'item' | 'literal:xxx'
  transform?: TransformStep[]
  fallback?: string
  description?: string
}

export type TransformStep =
  | { op: 'join'; sep: string }
  | { op: 'truncate'; max: number; suffix?: string }
  | { op: 'slice'; start?: number; end?: number }
  | { op: 'eq'; value: unknown }
  | { op: 'notEmpty' }
  | { op: 'default'; value: string }
  | { op: 'map'; mapping: Record<string, string> }
  | { op: 'prompt_excerpt'; maxLen?: number }
  | { op: 'spu_desc_list'; maxSpus?: number; maxCharsPerSpu?: number }

// --- Dataset & Field ---

export interface FieldDef {
  key: string
  label?: string
  type?: 'string' | 'number' | 'boolean' | 'url' | 'array' | 'object'
  description?: string
}

export interface DatasetDef {
  id: string
  name: string
  source: 'builtin' | 'upload'
  id_field: string
  fields: FieldDef[]
  path?: string
  created_at?: string
  description?: string
  record_count?: number              // listDatasets 时填充
}

// --- Input sources ---

export interface InputSourceDef {
  alias: string                        // 'item' | 'user' | ...
  dataset_id: string                   // 默认数据集 id；实验可通过 dataset_bindings 覆盖
  dedupe_by?: string[]                 // 运行时按这些字段联合去重，每组只保留第一条
  hard_filter?: { field: string; equals: unknown }  // 不暴露到 UI 的硬过滤
  filters?: FilterDef[]                // UI 动态渲染的过滤器
}

// --- Filters ---

export type FilterDef =
  | {
      kind: 'multiselect'
      key: string
      field: string
      label: string
      options: Array<{ value: string | number; label: string }>
      defaultValue?: Array<string | number>
      include_null?: boolean          // 为 true 时，字段为 null 的记录永远不被过滤掉
    }
  | {
      kind: 'checkbox'
      key: string
      field: string
      label: string
      truthy: unknown                 // 字段等于 truthy 且 checkbox 未勾选时被过滤
      defaultValue?: boolean
    }
  | {
      kind: 'number'
      key: string
      field?: string
      label: string
      role: 'limit' | 'min' | 'max'
      defaultValue?: number
    }
  | {
      kind: 'text_in'
      key: string
      field: string
      label: string
    }
  | {
      kind: 'literal_set'
      key: string
      field: string
      label: string
      options: Array<{ value: unknown; label: string }>
      defaultValue?: unknown[]
    }

export type FilterValues = Record<string, unknown>

// --- Message builder ---

export interface MessageBuilderDef {
  user_template?: string                // fallback 用户消息
  user_templates_by_cond?: Array<{      // 按变量命中条件选不同模板（取第一个命中的）
    when: string                        // 变量名：渲染后非空即 match
    template: string
  }>
  image?: {
    field: string                       // 形如 'item.image_url'
    required?: boolean                  // false → 无图时退回纯文本
  }
}

// --- Output JSON schema (mini) ---

export type JsonFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'string|null'
  | 'tuple:number[]'
  | 'image_url'
  | 'image_url_list'

export interface JsonSchemaDef {
  type?: 'object'
  required?: string[]
  properties?: Record<string, JsonPropDef>
  description?: string
}

export interface JsonPropDef {
  type: JsonFieldType
  items?: JsonPropDef | JsonSchemaDef
  properties?: Record<string, JsonPropDef>
  required?: string[]
  min_length?: number
  max_length?: number
  tuple_len?: number
  enum?: Array<string | number>
}

// --- Display dimensions（用于展示分组/排列的字段声明） ---

export interface DisplayDimension {
  field: string                         // 'input_refs.item' / 'input_preview.user.role' / 'output.xxx'
  label?: string                        // 展示名
  value_labels?: Record<string, string> // 值 → label 映射
  order?: Array<string | number>        // 展示顺序（仅分组键用）
  header_fields?: Array<{               // 分组头额外展示的字段（仅 primary dim 在 dual_list / triple_grid 头上用）
    field: string
    label?: string
  }>
}

// --- TaskSchema (top-level) ---

export interface TaskSchema {
  id: string
  label: string
  description?: string
  version: number
  compare_group?: string                // 默认 === id；相同 compare_group 可跨对比
  source?: 'builtin' | 'user'           // runtime 补充，不持久化

  inputs: InputSourceDef[]
  variables: VariableDef[]
  default_prompt: string
  message_builder: MessageBuilderDef
  output_schema: JsonSchemaDef

  display_dimensions?: DisplayDimension[]  // 声明展示维度，推断引擎读它
  display_id?: string                      // 显式指定 Display 资源，跳过推断

  // 模型直接输出纯文本（不是 JSON）。为 true 时 parseResponse 跳过 JSON 提取，
  // 把剥掉 <think> 后的整段 raw response 作为 output_schema 第一个 required / property 的值。
  // 仍然需要在 output_schema 声明一个 string 字段，以便下游 display / mock / 校验链路不变。
  raw_text_output?: boolean
}

// --- Display (展示模板) ---

export type DisplayMode = 'builtin' | 'table' | 'grouped_grid' | 'jsx'

export type DisplayFieldType = 'text' | 'image' | 'badge' | 'json'

export interface DisplayColumn {
  field: string              // 'input_preview.item.title' / 'output.answer' / 'input_refs.item'
  label: string
  type?: DisplayFieldType
  max_length?: number
  width?: string
}

export interface DisplayTableConfig {
  columns: DisplayColumn[]
}

export interface DisplayGroupedGridConfig {
  primary_group: { field: string; label?: string }
  secondary_group: {
    field: string
    label?: string
    order?: Array<string | number>
    value_labels?: Record<string, string>
  }
  fallback_group?: { field: string; value: unknown; label: string }
  header_fields?: string[]   // 组头展示哪些字段
  cell_columns: DisplayColumn[]
}

export interface DisplayJsxConfig {
  source: string             // function ({ result, schema, helpers }) { return <...> }
}

export interface Display {
  id: string
  name: string
  description?: string
  source: 'builtin' | 'user'
  mode: DisplayMode

  builtin_component?: string         // source=builtin 时指向代码里 register 的组件 key
  table?: DisplayTableConfig
  grouped_grid?: DisplayGroupedGridConfig
  jsx?: DisplayJsxConfig
}

// --- Generic result record ---

export type ResultStatus = 'success' | 'error' | 'parse_error'

export interface GenericResultRecord {
  schema_id: string
  schema_version: number
  task_id: string
  experiment_id: string

  input_refs: Record<string, string | number>   // { qa: 'q01', user: 'young_high' }
  input_preview: Record<string, unknown>        // 冗余的关键字段，便于展示层直接用

  output?: Record<string, unknown>
  status: ResultStatus
  error?: string
  raw_response?: string
  latency_ms: number
  model: string
  timestamp: string

  // Token / cost telemetry (optional — undefined on old records or when pricing not configured)
  input_tokens?: number
  output_tokens?: number
  cost_value?: number                     // 成本金额（以 cost_currency 计价）
  cost_currency?: string                  // 'USD' | 'CNY' | …；省略默认 'USD'
}

// --- Rubric & Annotation（评分系统） ---

export type CriterionType = 'pass_fail' | 'likert_1_5' | 'score_0_100'

export interface Criterion {
  key: string                             // slug，如 'correct' / 'confidence_calibrated'
  label: string
  type: CriterionType
  description?: string
  required?: boolean                      // 为 true 时未填则该 task 算"未完成评分"
}

export interface Rubric {
  id: string
  name: string
  description?: string
  criteria: Criterion[]
  source?: 'builtin' | 'user'
}

export interface Annotation {
  annotation_id: string                   // nanoid(10)
  task_id: string                         // 指向 GenericResultRecord.task_id
  rubric_id: string
  evaluator: 'human' | 'llm' | 'rule'
  scores: Record<string, number | boolean>  // criterion.key → value
  rationale?: string
  timestamp: string
}
