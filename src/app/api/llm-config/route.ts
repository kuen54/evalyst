import { NextRequest, NextResponse } from 'next/server'
import { getLlmConfig, saveLlmConfig, maskKey, type LlmConfig } from '@/lib/llm-config'

export async function GET() {
  const cfg = getLlmConfig()
  // Mask api_key on read so it never leaves the server in plaintext.
  // Editing UI requires the user to re-enter a key when changing it,
  // which is fine — the existing "test connection" flow already prompts
  // for explicit input.
  return NextResponse.json({
    ...cfg,
    models: cfg.models.map(m => ({ ...m, api_key: maskKey(m.api_key) })),
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as Partial<LlmConfig> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected JSON object' }, { status: 400 })
  }
  const saved = saveLlmConfig(body)
  // Mask api_key on the response too — the client already has the value
  // it just sent, so there's no reason to echo it back.
  return NextResponse.json({
    ...saved,
    models: saved.models.map(m => ({ ...m, api_key: maskKey(m.api_key) })),
  })
}
