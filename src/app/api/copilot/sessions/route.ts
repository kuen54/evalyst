import { NextRequest, NextResponse } from 'next/server'
import { listSessions, createSession } from '@/lib/copilot/session-store'

export async function GET() {
  return NextResponse.json({ sessions: listSessions() })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { title?: string; model_id?: string }
  const session = createSession({
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.model_id !== undefined ? { model_id: body.model_id } : {}),
  })
  return NextResponse.json(session)
}
