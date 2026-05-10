import { NextRequest, NextResponse } from 'next/server'
import { pruneMessageAndDescendants } from '@/copilot/lib/session-store'

/**
 * DELETE /api/copilot/sessions/{id}/messages/{msg_id}
 * 删除该消息 + 所有后代。用于：
 *   1) UI 上"删除"一条消息的悬浮按钮
 *   2)"编辑 = 删 + 重发" 的第一步
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msg_id: string }> },
) {
  const { id, msg_id } = await params
  const removed = pruneMessageAndDescendants(id, msg_id)
  if (removed.length === 0) {
    return NextResponse.json({ error: 'message not found' }, { status: 404 })
  }
  return NextResponse.json({ removed })
}
