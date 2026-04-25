import { NextRequest, NextResponse } from 'next/server'
import { readResults, listExperiments } from '@/lib/store'
import type { GenericResultRecord } from '@/lib/schema/types'

// GET /api/compare?ids=exp1,exp2
export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get('ids')?.split(',').filter(Boolean) ?? []

  if (ids.length === 0) {
    const experiments = listExperiments().filter(e => e.status === 'completed' || e.status === 'paused')
    return NextResponse.json(experiments)
  }

  const combined: Record<string, {
    experiment_id: string
    experiment_name: string
    model: string
    schema_id: string
    results: GenericResultRecord[]
  }> = {}

  const experiments = listExperiments()
  for (const id of ids) {
    const results = readResults(id)
    const exp = experiments.find(e => e.id === id)
    combined[id] = {
      experiment_id: id,
      experiment_name: exp?.name ?? id,
      model: exp?.model ?? 'unknown',
      schema_id: exp?.schema_id ?? 'unknown',
      results,
    }
  }

  return NextResponse.json(combined)
}
