import { NextRequest, NextResponse } from 'next/server'
import { resolveContexts, formatContextsForLlm } from '@/copilot/lib/resolve-context'
import type { CopilotContextRef } from '@/copilot/lib/types'

// POST /api/copilot/contexts/resolve
// body: { refs: CopilotContextRef[] }
// 返回 { resolved: ResolvedContext[], system_message: string }
// system_message 是 LLM 将看到的 context 段，供 Preview UI 展示。

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { refs?: CopilotContextRef[] }
  const refs = Array.isArray(body.refs) ? body.refs : []
  const resolved = resolveContexts(refs)
  const system_message = formatContextsForLlm(resolved)
  return NextResponse.json({ resolved, system_message })
}
