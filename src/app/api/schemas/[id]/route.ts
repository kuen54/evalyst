import { NextRequest, NextResponse } from 'next/server'
import { getSchema } from '@/lib/schema'
import { deleteUserSchema, validateUserSchema, createUserSchema } from '@/lib/schema/user-schema-store'
import type { TaskSchema } from '@/lib/schema/types'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = getSchema(id)
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(s)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const existing = getSchema(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.source === 'builtin') {
    return NextResponse.json({ error: 'cannot edit builtin schema' }, { status: 409 })
  }
  const body = await req.json().catch(() => null)
  const v = validateUserSchema(body)
  if (!v.ok) return NextResponse.json({ error: 'validation failed', errors: v.errors }, { status: 400 })
  const schema = body as TaskSchema
  if (schema.id !== id) return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  const updated = createUserSchema(schema) // 写入覆盖
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const existing = getSchema(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.source === 'builtin') {
    return NextResponse.json({ error: 'cannot delete builtin schema' }, { status: 409 })
  }
  deleteUserSchema(id)
  return NextResponse.json({ deleted: true })
}
