import { NextRequest, NextResponse } from 'next/server'
import { listDisplays, createUserDisplay, validateDisplay } from '@/lib/displays'
import type { Display } from '@/lib/schema/types'

export async function GET() {
  return NextResponse.json(listDisplays())
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const v = validateDisplay(body)
  if (!v.ok) return NextResponse.json({ error: 'validation failed', errors: v.errors }, { status: 400 })
  const display = body as Display
  const all = listDisplays()
  if (all.some(d => d.id === display.id)) {
    return NextResponse.json({ error: `ID already exists: ${display.id}` }, { status: 409 })
  }
  try {
    const created = createUserDisplay(display)
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
