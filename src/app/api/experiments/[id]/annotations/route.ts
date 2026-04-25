import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { appendAnnotation, latestAnnotations, aggregateAnnotations } from '@/lib/annotation-store'
import { getExperiment } from '@/lib/store'
import { getRubric } from '@/lib/rubric-store'
import type { Annotation } from '@/lib/schema/types'

/**
 * GET /api/experiments/[id]/annotations
 *   query: rubric_id (optional)
 *     · 不带: 返回所有 latest annotations（按 (task_id, rubric_id, evaluator) 去重）
 *     · 带 rubric_id: 过滤 + 附带 aggregate 聚合（需要实验 run_stats 的 total_tasks）
 *
 * POST /api/experiments/[id]/annotations
 *   body: { task_id, rubric_id, evaluator?, scores, rationale? }
 *   追加一条（不去重；latest 由读取时按 timestamp 决定）
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: experimentId } = await params
  const rubricId = req.nextUrl.searchParams.get('rubric_id') || undefined
  const annotations = latestAnnotations(experimentId, rubricId)

  if (rubricId) {
    const rubric = getRubric(rubricId)
    const exp = getExperiment(experimentId)
    const totalTasks = exp?.run_stats?.total_tasks ?? 0
    const aggregate = rubric ? aggregateAnnotations(experimentId, rubric, totalTasks) : null
    return NextResponse.json({ annotations, aggregate })
  }

  return NextResponse.json({ annotations })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: experimentId } = await params
  const body = await req.json().catch(() => null) as Partial<Annotation> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be object' }, { status: 400 })
  }
  if (typeof body.task_id !== 'string' || !body.task_id) {
    return NextResponse.json({ error: 'task_id required' }, { status: 400 })
  }
  if (typeof body.rubric_id !== 'string' || !body.rubric_id) {
    return NextResponse.json({ error: 'rubric_id required' }, { status: 400 })
  }
  if (!body.scores || typeof body.scores !== 'object') {
    return NextResponse.json({ error: 'scores must be an object' }, { status: 400 })
  }
  // 校验 rubric 存在且 scores 的 key 都在 criteria 里
  const rubric = getRubric(body.rubric_id)
  if (!rubric) return NextResponse.json({ error: `rubric not found: ${body.rubric_id}` }, { status: 404 })
  const allowedKeys = new Set(rubric.criteria.map(c => c.key))
  for (const k of Object.keys(body.scores)) {
    if (!allowedKeys.has(k)) {
      return NextResponse.json({ error: `unknown criterion key: ${k}` }, { status: 400 })
    }
  }

  const annotation: Annotation = {
    annotation_id: nanoid(10),
    task_id: body.task_id,
    rubric_id: body.rubric_id,
    evaluator: body.evaluator === 'llm' || body.evaluator === 'rule' ? body.evaluator : 'human',
    scores: body.scores as Record<string, number | boolean>,
    rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
    timestamp: new Date().toISOString(),
  }
  appendAnnotation(experimentId, annotation)
  return NextResponse.json(annotation, { status: 201 })
}
