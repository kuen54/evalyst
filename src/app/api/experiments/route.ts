import { NextRequest, NextResponse } from 'next/server'
import { listExperiments, createExperiment } from '@/lib/store'
import type { CreateExperimentRequest } from '@/lib/types'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  let experiments = listExperiments()

  const schemaId = params.get('schema_id')
  if (schemaId) experiments = experiments.filter(e => e.schema_id === schemaId)

  const status = params.get('status')
  if (status) experiments = experiments.filter(e => e.status === status)

  return NextResponse.json(experiments)
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateExperimentRequest
  if (!body.name || !body.schema_id || !body.prompt_template) {
    return NextResponse.json(
      { error: 'name, schema_id, and prompt_template are required' },
      { status: 400 },
    )
  }
  const config = createExperiment(body)
  return NextResponse.json(config, { status: 201 })
}
