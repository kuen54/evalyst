import { NextRequest, NextResponse } from 'next/server'
import { getExperiment, updateExperiment, deleteExperiment } from '@/lib/store'
import type { ExperimentConfig } from '@/lib/types'

// PATCH 只放行用户可编辑字段。status / run_stats / api_config / 时间戳是 runner
// 内部维护的派生态；model / model_id 在创建时与 api_config 耦合派生（pickModel
// 同时定 base_url / api_key / pricing），单独 PATCH 任一会让两者失配 —— 都不放行。
const EDITABLE_FIELDS = [
  'name', 'notes', 'prompt_template', 'temperature', 'max_tokens',
  'display_id', 'rubric_id', 'dataset_bindings', 'filter_values', 'seed', 'schema_id',
] as const satisfies readonly (keyof ExperimentConfig)[]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const config = getExperiment(id)
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(config)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (body == null || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const config = getExperiment(id)
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (config.status === 'running') {
    return NextResponse.json({ error: 'cannot update a running experiment' }, { status: 409 })
  }
  // Reject body.id mismatch — without this gate, body.id overrides the URL id
  // and writeExperiment writes to `experimentsDir/${body.id}.json`, which
  // path.join interprets as `..`-traversal (e.g. body.id="../llm-config" →
  // overwrite `data/llm-config.json`). Aligns with schemas/displays/rubrics/
  // datasets PATCH which all enforce this. The whitelist below already drops
  // `id`, but an explicit 400 is more diagnosable than a silent drop.
  if ((body as { id?: unknown }).id != null && (body as { id?: unknown }).id !== id) {
    return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  }
  const updates: Partial<ExperimentConfig> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in body) (updates as Record<string, unknown>)[k] = (body as Record<string, unknown>)[k]
  }
  const updated = updateExperiment(id, updates)
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteExperiment(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
