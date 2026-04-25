import { NextRequest, NextResponse } from 'next/server'
import { getExperiment, updateExperiment, deleteExperiment } from '@/lib/store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const config = getExperiment(id)
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(config)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const config = getExperiment(id)
  if (!config) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (config.status === 'running') {
    return NextResponse.json({ error: 'cannot update a running experiment' }, { status: 409 })
  }
  const updated = updateExperiment(id, body)
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteExperiment(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
