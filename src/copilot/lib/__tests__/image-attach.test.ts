import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CopilotMessage, CopilotContextRef, ImageRef } from '@/copilot/lib/types'
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

import { collectImageRefs, MAX_IMAGES_PER_TURN } from '@/copilot/lib/image-attach'
import { readResults, getExperiment } from '@/lib/store'
import { getSchema } from '@/lib/schema'

// ---------- helpers ----------

/** Build a TaskSchema with the canonical output_schema.properties Record shape. */
function makeSchema(props: Record<string, { type: string }>): TaskSchema {
  return {
    id: 'sch_test',
    label: 'test',
    version: 1,
    inputs: [],
    variables: [],
    default_prompt: '',
    message_builder: {},
    output_schema: {
      type: 'object',
      // properties is Record<fieldName, JsonPropDef>; field name = map key
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

function makeUserMsg(contexts: CopilotContextRef[]): CopilotMessage {
  return {
    id: 'msg_u', session_id: 's', role: 'user',
    content: 'hi', contexts, timestamp: 't',
  }
}

function ctx(tag: number, type: string, id: string, extra?: Record<string, unknown>): CopilotContextRef {
  return { tag, type, id, ...(extra !== undefined ? { extra } : {}) }
}

beforeEach(() => {
  vi.mocked(readResults).mockReset()
  vi.mocked(getExperiment).mockReset()
  vi.mocked(getSchema).mockReset()
  vi.mocked(getExperiment).mockReturnValue({ id: 'exp_1', schema_id: 'sch_test' } as ExperimentConfig)
})

// ---------- tests ----------

describe('collectImageRefs — schema-aware extraction', () => {
  it('image_url field type → 1 ref per task_result context', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ caption: { type: 'string' }, image_url: { type: 'image_url' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { caption: 'a cat', image_url: '/api/results/exp_1/images/cat.png' }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(1)
    expect(out.user_image_refs[0]!.url).toBe('/api/results/exp_1/images/cat.png')
    expect(out.user_image_refs[0]!.source_label).toContain('field=image_url')
    expect(out.user_image_refs[0]!.ctx_tag).toBe(1)
    expect(out.dropped_count).toBe(0)
  })

  it('image_url_list field type → N refs', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ images: { type: 'image_url_list' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { images: [
        '/api/results/exp_1/images/a.png',
        '/api/results/exp_1/images/b.png',
        '/api/results/exp_1/images/c.png',
      ] }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(3)
    expect(out.user_image_refs.map(r => r.url)).toEqual([
      '/api/results/exp_1/images/a.png',
      '/api/results/exp_1/images/b.png',
      '/api/results/exp_1/images/c.png',
    ])
  })

  it('heuristic fallback: field name matches /url|image|pic|img|photo/i + value matches path prefix', () => {
    // No declared image_url field; only string field with name "photo_url"
    vi.mocked(getSchema).mockReturnValue(makeSchema({ photo_url: { type: 'string' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { photo_url: 'images/foo.png' }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(1)
    expect(out.user_image_refs[0]!.url).toBe('/api/results/exp_1/images/foo.png')
    expect(out.user_image_refs[0]!.source_label).toContain('(inferred)')
  })

  it('heuristic skips when name matches but value does NOT match path prefix', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ photo_url: { type: 'string' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { photo_url: 'just a description, not a path' }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(0)
  })

  it('dedupes by exact URL string', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { image_url: '/api/results/exp_1/images/dup.png' }),
      makeResult('t2', { image_url: '/api/results/exp_1/images/dup.png' }),
    ])
    const branch = [makeUserMsg([
      ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' }),
      ctx(2, 'task_result', 't2', { experiment_id: 'exp_1' }),
    ])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(1)
    expect(out.dropped_count).toBe(0)
  })

  it('caps at MAX_IMAGES_PER_TURN=5 and reports dropped_count', () => {
    expect(MAX_IMAGES_PER_TURN).toBe(5)
    vi.mocked(getSchema).mockReturnValue(makeSchema({ images: { type: 'image_url_list' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { images: Array.from({ length: 8 }, (_, i) => `/api/results/exp_1/images/i${i}.png`) }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(5)
    expect(out.dropped_count).toBe(3)
  })

  it('normalizes "images/foo.png" → "/api/results/{expId}/images/foo.png"', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { image_url: 'images/foo.png' }),
    ])
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs[0]!.url).toBe('/api/results/exp_1/images/foo.png')
  })

  it('task_field with extra.field_type === image_url collects exactly 1 image', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t1', { image_url: '/api/results/exp_1/images/cat.png' }),
    ])
    const branch = [makeUserMsg([
      ctx(1, 'task_field', 't1', { experiment_id: 'exp_1', field: 'image_url', field_type: 'image_url' }),
    ])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
    expect(out.user_image_refs).toHaveLength(1)
    expect(out.user_image_refs[0]!.source_label).toContain('field=image_url')
  })

  it('non-vision-capable model short-circuits to empty result without reading store', () => {
    const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
    const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: false })
    expect(out.user_image_refs).toEqual([])
    expect(out.tool_image_refs.size).toBe(0)
    expect(out.dropped_count).toBe(0)
    expect(vi.mocked(readResults)).not.toHaveBeenCalled()
    expect(vi.mocked(getSchema)).not.toHaveBeenCalled()
  })

  it('cap order: user contexts win priority over tool refs when total exceeds 5', () => {
    vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
    vi.mocked(readResults).mockReturnValue([
      makeResult('t_user_1', { image_url: '/api/results/exp_1/images/u1.png' }),
      makeResult('t_user_2', { image_url: '/api/results/exp_1/images/u2.png' }),
      makeResult('t_user_3', { image_url: '/api/results/exp_1/images/u3.png' }),
      makeResult('t_user_4', { image_url: '/api/results/exp_1/images/u4.png' }),
    ])
    const userMsg = makeUserMsg([
      ctx(1, 'task_result', 't_user_1', { experiment_id: 'exp_1' }),
      ctx(2, 'task_result', 't_user_2', { experiment_id: 'exp_1' }),
      ctx(3, 'task_result', 't_user_3', { experiment_id: 'exp_1' }),
      ctx(4, 'task_result', 't_user_4', { experiment_id: 'exp_1' }),
    ])
    const toolMsg: CopilotMessage = {
      id: 'msg_tr', session_id: 's', role: 'tool_result',
      call_id: 'call_x', tool_name: 'read_experiment_results',
      content: JSON.stringify({
        kind: 'inline',
        value: { results: [] },
        attachments: [
          { url: '/api/results/exp_1/images/tool1.png', source_label: 'tool#1' },
          { url: '/api/results/exp_1/images/tool2.png', source_label: 'tool#2' },
        ] satisfies ImageRef[],
      }),
      timestamp: 't',
    }
    const out = collectImageRefs({ branch: [userMsg, toolMsg], schemaCache: new Map(), modelVisionCapable: true })
    // 4 user + 1 tool = 5 total; second tool ref dropped
    expect(out.user_image_refs).toHaveLength(4)
    expect(out.tool_image_refs.get('call_x')).toHaveLength(1)
    expect(out.dropped_count).toBe(1)
  })
})

describe('extractImageRefsFromOutput — direct helper coverage', () => {
  function makeSchemaT(props: Record<string, { type: string }>): TaskSchema {
    return {
      id: 'sch_t', label: 't', version: 1,
      inputs: [], variables: [], default_prompt: '',
      message_builder: {},
      output_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(props).map(([n, d]) => [n, { type: d.type } as never]),
        ),
      },
    } as TaskSchema
  }

  it('image_url field with non-empty string → 1 ref, source_label includes field name', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ caption: { type: 'string' }, image_url: { type: 'image_url' } })
    const refs = extractImageRefsFromOutput(
      { caption: 'a cat', image_url: '/api/results/exp_1/images/cat.png' },
      schema,
      'exp_1',
      7,
      't_abc',
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]).toEqual({
      url: '/api/results/exp_1/images/cat.png',
      source_label: 'task_result#t_abc · field=image_url',
      ctx_tag: 7,
    })
  })

  it('image_url_list with 3 entries → 3 refs', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ images: { type: 'image_url_list' } })
    const refs = extractImageRefsFromOutput(
      { images: [
        '/api/results/exp_1/images/a.png',
        '/api/results/exp_1/images/b.png',
        '/api/results/exp_1/images/c.png',
      ] },
      schema,
      'exp_1',
    )
    expect(refs).toHaveLength(3)
    expect(refs.map(r => r.url)).toEqual([
      '/api/results/exp_1/images/a.png',
      '/api/results/exp_1/images/b.png',
      '/api/results/exp_1/images/c.png',
    ])
    expect(refs[0]!.ctx_tag).toBeUndefined()  // tool path doesn't pass ctx_tag
  })

  it('heuristic catches "photo_url" with /api/results/... value (marked inferred)', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ photo_url: { type: 'string' } })
    const refs = extractImageRefsFromOutput(
      { photo_url: '/api/results/exp_1/images/x.png' },
      schema,
      'exp_1',
      undefined,
      't_abc',
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]!.source_label).toBe('task_result#t_abc · field=photo_url (inferred)')
  })

  it('heuristic skips when name matches but value is empty string', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ photo_url: { type: 'string' } })
    const refs = extractImageRefsFromOutput({ photo_url: '' }, schema, 'exp_1')
    expect(refs).toHaveLength(0)
  })

  it('heuristic skips when name matches but value is non-path (e.g. a description)', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ image_caption: { type: 'string' } })
    const refs = extractImageRefsFromOutput(
      { image_caption: 'a brown dog with a red collar' },
      schema,
      'exp_1',
    )
    expect(refs).toHaveLength(0)
  })

  it('heuristic does not double-count a field already declared as image_url', async () => {
    const { extractImageRefsFromOutput } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ image_url: { type: 'image_url' } })
    const refs = extractImageRefsFromOutput(
      { image_url: '/api/results/exp_1/images/dup.png' },
      schema,
      'exp_1',
    )
    expect(refs).toHaveLength(1)  // declared path, NOT also picked up by heuristic
  })

  it('does not enforce cap or dedup (caller responsibility)', async () => {
    const { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } = await import('@/copilot/lib/image-attach')
    const schema = makeSchemaT({ images: { type: 'image_url_list' } })
    const arr = Array.from({ length: MAX_IMAGES_PER_TURN + 4 }, (_, i) => `/api/results/exp_1/images/i${i}.png`)
    const refs = extractImageRefsFromOutput({ images: arr }, schema, 'exp_1')
    expect(refs).toHaveLength(MAX_IMAGES_PER_TURN + 4)
  })
})
