import { NextRequest, NextResponse } from 'next/server'
import { deleteCustomDataset, getDataset, getDatasetSummary, updateCustomDataset } from '@/lib/datasets'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const full = req.nextUrl.searchParams.get('full') === '1'
  try {
    if (full) {
      const { records, def } = getDataset(id)
      return NextResponse.json({ def, record_count: records.length, records })
    }
    return NextResponse.json(getDatasetSummary(id))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be object' }, { status: 400 })
  }
  if (body.id != null && body.id !== id) {
    return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  }
  try {
    const next = updateCustomDataset(id, {
      name: body.name as string | undefined,
      description: body.description as string | undefined,
      id_field: body.id_field as string | undefined,
      fields: body.fields as never,
      records: body.records as never,
    })
    return NextResponse.json(next)
  } catch (e) {
    const msg = (e as Error).message
    const status = msg.startsWith('Dataset not found') ? 404 : 400
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteCustomDataset(id)
  if (!ok) return NextResponse.json({ error: 'not found or builtin' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
