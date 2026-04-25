import { NextRequest, NextResponse } from 'next/server'
import { listDatasets, createDatasetFromJson, validateDatasetJson } from '@/lib/datasets'
import type { FieldDef } from '@/lib/schema/types'

export async function GET() {
  return NextResponse.json(listDatasets())
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const v = validateDatasetJson(body)
  if (!v.ok) {
    return NextResponse.json({ error: 'validation failed', errors: v.errors }, { status: 400 })
  }
  try {
    const data = body as {
      id: string
      name: string
      description?: string
      id_field: string
      fields: FieldDef[]
      records: Record<string, unknown>[]
    }
    const def = createDatasetFromJson(data)
    return NextResponse.json(def, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}