import { NextRequest, NextResponse } from 'next/server'
import { readCacheStats } from '@/copilot/lib/cache-stats-store'
import {
  aggregateCacheHitRate,
  countRecentBreaks,
} from '@/copilot/lib/cache-aggregate'
import {
  collectRecentBreakReasons,
  findLatestBreakPair,
} from '@/copilot/lib/cache-break-detect'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_LIMIT = 10

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id') ?? undefined

  const sessionStats = sessionId ? readCacheStats({ session_id: sessionId }) : []
  const weeklyStats = readCacheStats({ since_ms: SEVEN_DAYS_MS })

  const sessionAgg = aggregateCacheHitRate(sessionStats)
  const weeklyAgg = aggregateCacheHitRate(weeklyStats)
  const weeklyBreaks = countRecentBreaks(weeklyStats)
  const weeklyReasons = collectRecentBreakReasons(weeklyStats)
  const latestBreakPair = findLatestBreakPair(weeklyStats)

  return NextResponse.json({
    session: {
      ...sessionAgg,
      // 最近 N 条倒序（最新在前）供 hover tooltip 展示
      recent: sessionStats.slice(-RECENT_LIMIT).reverse(),
    },
    weekly: {
      ...weeklyAgg,
      ...weeklyBreaks,
      recent_break_reasons: weeklyReasons,
      // v2.5 P2 §3.3: 最近一对 break (prev/curr) + reasons，给 tooltip 做 diff 展示
      latest_break_pair: latestBreakPair,
    },
  })
}
