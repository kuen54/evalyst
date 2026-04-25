export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed'
export type ResultStatus = 'success' | 'error' | 'parse_error'

// Re-export schema types for convenience
export type { TaskSchema, FilterValues, GenericResultRecord, DatasetDef, FieldDef, Rubric, Criterion, CriterionType, Annotation } from './schema/types'

export interface ApiConfig {
  api_format?: 'openai' | 'anthropic'
  base_url: string
  api_key: string
  extra_body?: Record<string, unknown>
}

export interface RunStats {
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  started_at: string
  finished_at?: string
  avg_latency_ms?: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_cost_by_currency?: Record<string, number>
}

export interface ExperimentConfig {
  id: string
  name: string
  created_at: string
  updated_at: string

  schema_id?: string
  filter_values?: Record<string, unknown>
  dataset_bindings?: Record<string, string>   // alias → dataset_id 覆盖
  display_id?: string                          // 实验级覆盖 schema.display_id

  model_id?: string                            // 创建时选中的 model id（用于查 pricing）
  rubric_id?: string                           // 可选：评分量表
  model: string
  temperature: number
  max_tokens: number
  api_config: ApiConfig
  prompt_template: string
  status: ExperimentStatus
  run_stats?: RunStats
  notes?: string
}

// --- Progress ---

export interface ProgressState {
  experiment_id: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  completed_task_ids: string[]
  failed_task_ids: string[]
  started_at: string
  updated_at: string
  error_log: Array<{ task_id: string; error: string; timestamp: string }>
  total_input_tokens?: number
  total_output_tokens?: number
  total_cost_by_currency?: Record<string, number>
}

// --- API request/response ---

export interface CreateExperimentRequest {
  name: string
  schema_id: string
  filter_values?: Record<string, unknown>
  dataset_bindings?: Record<string, string>
  display_id?: string
  model_id?: string
  rubric_id?: string
  model: string
  temperature: number
  max_tokens: number
  prompt_template: string
  notes?: string
}

export interface RunRequest {
  resume?: boolean
  concurrency?: number
}
