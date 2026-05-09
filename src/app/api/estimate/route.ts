import { NextRequest, NextResponse } from 'next/server'
import { getSchema } from '@/lib/schema'
import { estimateTaskCount } from '@/lib/schema/engine'
import type { FilterValues } from '@/lib/schema/types'

/** POST /api/estimate — 给出任务数估算（不物化笛卡尔积，避免大配置 OOM） */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    schema_id?: string
    filter_values?: FilterValues
    dataset_bindings?: Record<string, string>
  }
  if (!body.schema_id) {
    return NextResponse.json({ error: 'schema_id required' }, { status: 400 })
  }
  const schema = getSchema(body.schema_id)
  if (!schema) {
    return NextResponse.json({ error: `Unknown schema: ${body.schema_id}` }, { status: 404 })
  }
  try {
    const task_count = estimateTaskCount(schema, body.filter_values ?? {}, body.dataset_bindings ?? {})
    return NextResponse.json({ task_count })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
