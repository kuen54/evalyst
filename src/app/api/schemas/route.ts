import { NextRequest, NextResponse } from 'next/server'
import { listSchemas } from '@/lib/schema'
import { createUserSchema, validateUserSchema } from '@/lib/schema/user-schema-store'
import type { TaskSchema } from '@/lib/schema/types'

export async function GET() {
  return NextResponse.json(listSchemas())
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const v = validateUserSchema(body)
  if (!v.ok) {
    return NextResponse.json({ error: 'validation failed', errors: v.errors }, { status: 400 })
  }
  const all = listSchemas()
  const schema = body as TaskSchema
  if (all.some(s => s.id === schema.id)) {
    return NextResponse.json({ error: `ID already exists: ${schema.id}` }, { status: 409 })
  }
  const created = createUserSchema(schema)
  return NextResponse.json(created, { status: 201 })
}
