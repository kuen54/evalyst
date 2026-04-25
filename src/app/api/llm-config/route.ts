import { NextRequest, NextResponse } from 'next/server'
import { getLlmConfig, saveLlmConfig, type LlmConfig } from '@/lib/llm-config'

export async function GET() {
  return NextResponse.json(getLlmConfig())
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as Partial<LlmConfig> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected JSON object' }, { status: 400 })
  }
  const saved = saveLlmConfig(body)
  return NextResponse.json(saved)
}
