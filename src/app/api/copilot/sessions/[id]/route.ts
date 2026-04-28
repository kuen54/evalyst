import { NextRequest, NextResponse } from 'next/server'
import {
  getSession,
  updateSession,
  deleteSession,
  getActiveBranch,
  readAllMessages,
} from '@/lib/copilot/session-store'
import { deleteSnapshot } from '@/lib/copilot/snapshot-cache'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = getSession(id)
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // 带上当前活跃分支的消息（root → head），其余分支消息隐藏
  const messages = getActiveBranch(id)
  return NextResponse.json({ session, messages })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    title?: string
    model_id?: string
    head_message_id?: string
  }
  const updated = updateSession(id, body)
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // 如果切换了分支，返回新的活跃消息链
  const messages = body.head_message_id !== undefined ? getActiveBranch(id) : undefined
  return NextResponse.json({ session: updated, ...(messages ? { messages } : {}) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteSession(id)
  deleteSnapshot(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ deleted: id })
}
