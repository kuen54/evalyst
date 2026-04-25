import { NextRequest, NextResponse } from 'next/server'
import { getExperiment } from '@/lib/store'
import { getProgress } from '@/lib/store'
import { startBatch } from '@/lib/batch-runner'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const config = getExperiment(id)
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const resume = body.resume === true
  const concurrency = body.concurrency || 3
  const taskIds = Array.isArray(body.task_ids)
    ? (body.task_ids as unknown[]).filter(x => typeof x === 'string') as string[]
    : undefined

  try {
    // 精准 retry 默认走 resume 流程（累加历史 stats）
    const { totalTasks } = startBatch(config, resume || !!taskIds, concurrency, taskIds)
    return NextResponse.json({ status: 'started', total_tasks: totalTasks })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 409 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const progress = getProgress(id)
  if (!progress) return NextResponse.json({ error: 'no progress' }, { status: 404 })
  return NextResponse.json(progress)
}
