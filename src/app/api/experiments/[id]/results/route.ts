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
  const paged = results.slice(start, start + limit)

  return NextResponse.json(paged)
}
