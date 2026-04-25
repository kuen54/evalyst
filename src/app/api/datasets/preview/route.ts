import { NextRequest, NextResponse } from 'next/server'
import { inferFieldsFromJsonl } from '@/lib/datasets'

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { jsonl?: string }
  if (!body.jsonl || typeof body.jsonl !== 'string') {
    return NextResponse.json({ error: 'jsonl string required' }, { status: 400 })
  }
  const result = inferFieldsFromJsonl(body.jsonl)
  return NextResponse.json(result)
}
