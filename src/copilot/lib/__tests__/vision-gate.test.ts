import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CopilotContextRef } from '@/copilot/lib/types'
import type { ModelConfig } from '@/lib/llm-config'
import type { TaskSchema, GenericResultRecord } from '@/lib/schema/types'
import type { ExperimentConfig } from '@/lib/types'

// Mock store + schema lookups so the pure function can be exercised without fs.
vi.mock('@/lib/store', () => ({
  readResults: vi.fn(),
  getExperiment: vi.fn(),
}))
vi.mock('@/lib/schema', () => ({
  getSchema: vi.fn(),
}))

import { validateVisionGate } from '@/copilot/lib/vision-gate'
import { readResults, getExperiment } from '@/lib/store'
import { getSchema } from '@/lib/schema'

// ---------- helpers ----------

function makeSchema(props: Record<string, { type: string }>): TaskSchema {
  return {
    id: 'sch_test', label: 'test', version: 1,
    inputs: [], variables: [], default_prompt: '', message_builder: {},
    output_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(props).map(([name, def]) => [name, { type: def.type } as never]),
      ),
    },
  } as TaskSchema
}

function makeResult(taskId: string, output: Record<string, unknown>): GenericResultRecord {
  return {
    schema_id: 'sch_test', schema_version: 1,
    task_id: taskId, experiment_id: 'exp_1',
    input_refs: {}, input_preview: {},
    status: 'success',
    output,
    timestamp: '2026-05-09T00:00:00Z',
    model: 'm',
  } as GenericResultRecord
}

const NON_VISION: Pick<ModelConfig, 'vision_capable'> = { vision_capable: false }
const VISION: Pick<ModelConfig, 'vision_capable'> = { vision_capable: true }

beforeEach(() => {
  vi.mocked(readResults).mockReset()
  vi.mocked(getExperiment).mockReset()
  vi.mocked(getSchema).mockReset()
  vi.mocked(getExperiment).mockReturnValue({ id: 'exp_1', schema_id: 'sch_test' } as ExperimentConfig)
})

// ---------- tests ----------

describe('validateVisionGate · spec §3.3 layer 2', () => {
  it('empty contexts + non-vision → ok', () => {
    expect(validateVisionGate([], NON_VISION)).toEqual({ ok: true })
    expect(validateVisionGate(undefined, NON_VISION)).toEqual({ ok: true })
  })

  it('experiment context (no image) + non-vision → ok', () => {
    const ctx: CopilotContextRef[] = [{ tag: 1, type: 'experiment', id: 'exp_1' }]
    expect(validateVisionGate(ctx, NON_VISION)).toEqual({ ok: true })
  })

  it('task_result with image schema + non-vision → not ok (with reason)', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({
      caption: { type: 'string' }, image_url: { type: 'image_url' },
    }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { caption: 'cat', image_url: '/api/results/exp_1/images/cat.png' }),
    ])
    const ctx: CopilotContextRef[] = [
      { tag: 1, type: 'task_result', id: 't1', extra: { experiment_id: 'exp_1' } },
    ]
    const out = validateVisionGate(ctx, NON_VISION)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/vision_capable/)
  })

  it('task_result with no image schema + non-vision → ok', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ answer: { type: 'string' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { answer: 'hello' }),
    ])
    const ctx: CopilotContextRef[] = [
      { tag: 1, type: 'task_result', id: 't1', extra: { experiment_id: 'exp_1' } },
    ]
    expect(validateVisionGate(ctx, NON_VISION)).toEqual({ ok: true })
  })

  it('task_field of image_url type + non-vision → not ok', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({
      caption: { type: 'string' }, image_url: { type: 'image_url' },
    }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { caption: 'cat', image_url: '/api/results/exp_1/images/cat.png' }),
    ])
    const ctx: CopilotContextRef[] = [{
      tag: 1, type: 'task_field', id: 't1',
      extra: { experiment_id: 'exp_1', field: 'image_url', field_type: 'image_url' },
    }]
    const out = validateVisionGate(ctx, NON_VISION)
    expect(out.ok).toBe(false)
  })

  it('task_field of string type + non-vision → ok', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ answer: { type: 'string' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { answer: 'hello' }),
    ])
    const ctx: CopilotContextRef[] = [{
      tag: 1, type: 'task_field', id: 't1',
      extra: { experiment_id: 'exp_1', field: 'answer', field_type: 'string' },
    }]
    expect(validateVisionGate(ctx, NON_VISION)).toEqual({ ok: true })
  })

  it('vision-capable model + image contexts → always ok', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({
      caption: { type: 'string' }, image_url: { type: 'image_url' },
    }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { caption: 'cat', image_url: '/api/results/exp_1/images/cat.png' }),
    ])
    const ctx: CopilotContextRef[] = [
      { tag: 1, type: 'task_result', id: 't1', extra: { experiment_id: 'exp_1' } },
    ]
    expect(validateVisionGate(ctx, VISION)).toEqual({ ok: true })
  })

  it('vision-capable model + no contexts → ok', () => {
    expect(validateVisionGate([], VISION)).toEqual({ ok: true })
  })
})
