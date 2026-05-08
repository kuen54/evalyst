import { NextRequest, NextResponse } from 'next/server'
import { readCacheStats, aggregateCacheHitRate } from '@/lib/copilot/cache-stats-store'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_LIMIT = 10

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id') ?? undefined

  const sessionStats = sessionId ? readCacheStats({ session_id: sessionId }) : []
  const weeklyStats = readCacheStats({ since_ms: SEVEN_DAYS_MS })

  const sessionAgg = aggregateCacheHitRate(sessionStats)
  const weeklyAgg = aggregateCacheHitRate(weeklyStats)

  return NextResponse.json({
    session: {
      ...sessionAgg,
      // 最近 N 条倒序（最新在前）供 hover tooltip 展示
      recent: sessionStats.slice(-RECENT_LIMIT).reverse(),
    },
    weekly: weeklyAgg,
  })
}
