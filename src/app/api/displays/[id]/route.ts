import { NextRequest, NextResponse } from 'next/server'
import { getDisplay, deleteUserDisplay, createUserDisplay, validateDisplay } from '@/lib/displays'
import type { Display } from '@/lib/schema/types'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const d = getDisplay(id)
  if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(d)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const existing = getDisplay(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.source === 'builtin') {
    return NextResponse.json({ error: 'cannot edit builtin display' }, { status: 409 })
  }
  const body = await req.json().catch(() => null)
  const v = validateDisplay(body)
  if (!v.ok) return NextResponse.json({ error: 'validation failed', errors: v.errors }, { status: 400 })
  const display = body as Display
  if (display.id !== id) return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  const updated = createUserDisplay(display)
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const existing = getDisplay(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.source === 'builtin') {
    return NextResponse.json({ error: 'cannot delete builtin display' }, { status: 409 })
  }
  deleteUserDisplay(id)
  return NextResponse.json({ deleted: true })
}
