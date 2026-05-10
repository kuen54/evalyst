// Next.js 16 instrumentation hook
// 文档：https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// 每次 Node runtime 启动调一次（dev 重启 / prod 启动）。Edge runtime 跳过。

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // v2.5 P1b §3.2: cache-stats jsonl retention
  try {
    const { pruneCacheStats } = await import('@/copilot/lib/cache-stats-store')
    const result = pruneCacheStats()
    if (result.pruned_by_age + result.pruned_by_size > 0) {
      console.log(
        `[copilot] pruned cache-stats.jsonl: ${result.before_lines} → ${result.after_lines} ` +
          `(by_age: ${result.pruned_by_age}, by_size: ${result.pruned_by_size})`,
      )
    }
  } catch (e) {
    console.warn('[copilot] cache-stats prune failed at startup:', e)
  }
}
