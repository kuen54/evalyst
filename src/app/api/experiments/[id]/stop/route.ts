import { NextRequest, NextResponse } from 'next/server'
import { stopBatch } from '@/lib/batch-runner'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const stopped = stopBatch(id)
  if (!stopped) return NextResponse.json({ error: 'not running' }, { status: 409 })
  return NextResponse.json({ status: 'stopped' })
}
