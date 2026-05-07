import { describe, it, expect } from 'vitest'
import {
  manifestExperiment,
  manifestTaskResult,
  manifestTaskField,
  manifestDataset,
  manifestTemplate,
  manifestDisplay,
  manifestRubric,
} from '../manifest'
import type { ExperimentConfig } from '@/lib/types'
import type {
  GenericResultRecord,
  TaskSchema,
  Display,
  Rubric,
  DatasetDef,
} from '@/lib/schema/types'

describe('manifestExperiment', () => {
  it('drops prompt_template / notes / temperature / api_config / max_tokens', () => {
    const exp: ExperimentConfig = {
      id: 'exp_1', name: 'Exp',
      created_at: 't', updated_at: 't',
      status: 'completed',
      schema_id: 'sch_1', display_id: 'disp_1', rubric_id: 'rub_1',
      model_id: 'mod_1',
      model: 'gpt-4o', temperature: 0.7, max_tokens: 2000,
      api_config: { base_url: 'https://x', api_key: 'SECRET_KEY' },
      prompt_template: 'SECRET_PROMPT',
      run_stats: {
        total_tasks: 10, completed_tasks: 9, failed_tasks: 1,
        started_at: 't',
      },
      notes: 'SECRET_NOTES',
    }
    const out = manifestExperiment(exp)
    expect(out).toEqual({
      id: 'exp_1', name: 'Exp', status: 'completed',
      schema_id: 'sch_1', display_id: 'disp_1', rubric_id: 'rub_1',
      model: 'gpt-4o',
      run_stats: {
        total_tasks: 10, completed_tasks: 9, failed_tasks: 1,
        started_at: 't',
      },
    })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
})

describe('manifestTaskResult', () => {
  const found: GenericResultRecord = {
    schema_id: 'sch_1', schema_version: 1,
    task_id: 't1', experiment_id: 'exp_1',
    input_refs: { ds: 'r1' },
    input_preview: { qa: 'SENSITIVE_RAW' },
    status: 'success',
    output: { answer: 'yes' },
    latency_ms: 120,
    model: 'gpt-4o',
    timestamp: 't',
    input_tokens: 50, output_tokens: 10,
    cost_value: 0.001, cost_currency: 'USD',
  }

  it('self: flat metrics; drops input_preview / input_refs / raw_response / model', () => {
    const out = manifestTaskResult(found, 'self')
    expect(out).toEqual({
      task_id: 't1', status: 'success',
      output: { answer: 'yes' },
      latency_ms: 120,
      input_tokens: 50, output_tokens: 10,
      cost_value: 0.001, cost_currency: 'USD',
    })
    expect(JSON.stringify(out)).not.toContain('SENSITIVE_RAW')
  })

  it('self: failed task has error, no output', () => {
    const failed: GenericResultRecord = {
      ...found, status: 'error', output: undefined, error: 'boom',
    }
    const out = manifestTaskResult(failed, 'self')
    expect(out).toMatchObject({ task_id: 't1', status: 'error', error: 'boom' })
    expect((out as unknown as Record<string, unknown>).output).toBeUndefined()
  })

  it('parent: appends experiment summary (4 fields), not full exp', () => {
    const exp: ExperimentConfig = {
      id: 'exp_1', name: 'Exp',
      created_at: 't', updated_at: 't',
      status: 'completed', schema_id: 'sch_1',
      model: 'gpt-4o', temperature: 0.7, max_tokens: 2000,
      api_config: { base_url: 'https://x', api_key: 'secret' },
      prompt_template: 'SECRET_PROMPT',
    }
    const out = manifestTaskResult(found, 'parent', exp)
    expect((out as { experiment: unknown }).experiment).toEqual({
      id: 'exp_1', name: 'Exp', schema_id: 'sch_1', model: 'gpt-4o',
    })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
})

describe('manifestTaskField', () => {
  it('self only has targeted_field + targeted_value', () => {
    expect(manifestTaskField('output.answer', 'yes', 'self')).toEqual({
      targeted_field: 'output.answer', targeted_value: 'yes',
    })
  })

  it('parent appends flat task_meta, no input_preview', () => {
    const out = manifestTaskField('output.answer', 'yes', 'parent', {
      task_id: 't1', status: 'success',
      latency_ms: 120,
      input_tokens: 50, output_tokens: 10,
      cost_value: 0.001, cost_currency: 'USD',
    })
    expect(out).toEqual({
      targeted_field: 'output.answer', targeted_value: 'yes',
      task_meta: {
        task_id: 't1', status: 'success',
        latency_ms: 120,
        input_tokens: 50, output_tokens: 10,
        cost_value: 0.001, cost_currency: 'USD',
      },
    })
    expect(JSON.stringify(out)).not.toContain('input_preview')
  })
})

describe('manifestDataset', () => {
  it('returns id/name/fields/total_records, no sample', () => {
    const def: DatasetDef = {
      id: 'ds_1', name: 'QA',
      source: 'upload',
      id_field: 'qa',
      fields: [{ key: 'qa', type: 'string' }, { key: 'q', type: 'string' }],
    }
    expect(manifestDataset(def, 12)).toEqual({
      id: 'ds_1', name: 'QA',
      fields: [{ key: 'qa', type: 'string' }, { key: 'q', type: 'string' }],
      total_records: 12,
    })
  })
})

describe('manifestTemplate', () => {
  it('excerpt truncated to 300; variable_names from variables[].name; output fields from output_schema.properties', () => {
    const longPrompt = 'a'.repeat(500)
    const schema: TaskSchema = {
      id: 'sch_1', label: 'QA', description: 'desc', version: 1,
      inputs: [],
      variables: [
        { name: 'q', source: 'item.q' },
        { name: 'topic', source: 'item.topic' },
      ],
      default_prompt: longPrompt,
      message_builder: { user_template: 'user {{q}}' },
      output_schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    }
    const out = manifestTemplate(schema)
    expect(out.id).toBe('sch_1')
    expect(out.label).toBe('QA')
    expect(out.description).toBe('desc')
    expect(out.prompt_template_excerpt.length).toBe(300)
    expect(out.variable_names).toEqual(['q', 'topic'])
    expect(out.output_field_names).toEqual(['answer', 'confidence'])
    // TaskSchema 无 model 字段，manifest 不含
    expect(out).not.toHaveProperty('model')
    // 全量 prompt 不泄露
    expect(JSON.stringify(out)).not.toContain(longPrompt)
  })

  it('handles output_schema without properties (only type)', () => {
    const schema: TaskSchema = {
      id: 's', label: 'S', version: 1,
      inputs: [], variables: [],
      default_prompt: 'x',
      message_builder: {},
      output_schema: { type: 'object' },   // no properties
    }
    const out = manifestTemplate(schema)
    expect(out.output_field_names).toEqual([])
  })
})

describe('manifestDisplay', () => {
  it('table mode: dimension_count from table.columns', () => {
    const d: Display = {
      id: 'disp_1', name: 'Tbl', source: 'user', mode: 'table',
      table: {
        columns: [
          { field: 'a', label: 'A' },
          { field: 'b', label: 'B' },
          { field: 'c', label: 'C' },
        ],
      },
    }
    expect(manifestDisplay(d)).toEqual({
      id: 'disp_1', name: 'Tbl', mode: 'table', dimension_count: 3,
    })
  })

  it('grouped_grid mode: dimension_count from cell_columns', () => {
    const d: Display = {
      id: 'disp_2', name: 'GG', source: 'user', mode: 'grouped_grid',
      grouped_grid: {
        primary_group: { field: 'p' },
        secondary_group: { field: 's' },
        cell_columns: [
          { field: 'x', label: 'X' },
          { field: 'y', label: 'Y' },
        ],
      },
    }
    expect(manifestDisplay(d)).toMatchObject({ mode: 'grouped_grid', dimension_count: 2 })
  })

  it('jsx mode: source code not leaked; dimension_count 0', () => {
    const d: Display = {
      id: 'disp_3', name: 'Custom', source: 'user', mode: 'jsx',
      jsx: { source: 'SENSITIVE_JSX_FUNCTION_BODY' },
    }
    const out = manifestDisplay(d)
    expect(out).toEqual({ id: 'disp_3', name: 'Custom', mode: 'jsx', dimension_count: 0 })
    expect(JSON.stringify(out)).not.toContain('SENSITIVE')
  })

  it('builtin mode: dimension_count 0 (no columns concept)', () => {
    const d: Display = {
      id: 'disp_4', name: 'B', source: 'builtin', mode: 'builtin',
      builtin_component: 'single_list',
    }
    expect(manifestDisplay(d)).toMatchObject({ mode: 'builtin', dimension_count: 0 })
  })
})

describe('manifestRubric', () => {
  it('criteria_summary keeps only key/type/label, drops description/required', () => {
    const r: Rubric = {
      id: 'rub_1', name: 'Acc',
      criteria: [
        { key: 'correct', type: 'pass_fail', label: 'Correct', description: 'long...', required: true },
        { key: 'cal', type: 'likert_1_5', label: 'Cal', description: 'long...' },
      ],
    }
    expect(manifestRubric(r)).toEqual({
      id: 'rub_1', name: 'Acc',
      criteria_summary: [
        { key: 'correct', type: 'pass_fail', label: 'Correct' },
        { key: 'cal', type: 'likert_1_5', label: 'Cal' },
      ],
    })
  })
})
