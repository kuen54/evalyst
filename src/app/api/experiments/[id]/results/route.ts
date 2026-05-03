import { NextRequest, NextResponse } from 'next/server'
import { readResults } from '@/lib/store'
import type { GenericResultRecord } from '@/lib/schema/types'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const searchParams = req.nextUrl.searchParams
  let results: GenericResultRecord[] = readResults(id)

  const status = searchParams.get('status')
  if (status) results = results.filter(r => r.status === status)

  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '500')
  const start = (page - 1) * limit
  let paged = results.slice(start, start + limit)

  // ?exclude=raw_response,output 等：按字段裁剪响应体（仅支持可选字段，不碰必填字段）
  const exclude = searchParams.get('exclude')
  if (exclude) {
    const dropped = new Set(exclude.split(',').map(s => s.trim()).filter(Boolean))
    paged = paged.map(r => {
      const copy: Record<string, unknown> = { ...r }
      for (const k of dropped) delete copy[k]
      return copy as unknown as GenericResultRecord
    })
  }

  return NextResponse.json(paged)
}
