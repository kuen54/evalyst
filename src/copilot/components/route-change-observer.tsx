"use client"

import { Suspense, useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCopilotStore } from "./store"

/**
 * 监听路由变化：
 *   - 路由变 → 清空 manual contexts（inspector + text_selection）
 *   - 清空数 > 0 → 显示 banner 建议开新对话
 * 首次 mount 不触发（避免初始 path 被当成变化）。
 *
 * 注："session 有 messages"的判定放在 banner 组件里——observer 只负责触发 showRouteChangeBanner；
 *    banner 自身根据 message 长度决定是否渲染。
 *
 * useSearchParams() 需要 Suspense 边界（Next.js 静态预渲染要求），所以内部 Inner 组件用
 * Suspense 包裹再导出。
 */
function RouteChangeObserverInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { clearManualContexts, showRouteChangeBanner } = useCopilotStore()
  const previousKey = useRef<string | null>(null)

  useEffect(() => {
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (previousKey.current === null) {
      previousKey.current = key
      return
    }
    if (key !== previousKey.current) {
      previousKey.current = key
      const { count } = clearManualContexts()
      if (count > 0) showRouteChangeBanner(count)
    }
  }, [pathname, searchParams, clearManualContexts, showRouteChangeBanner])

  return null
}

export function RouteChangeObserver() {
  return (
    <Suspense fallback={null}>
      <RouteChangeObserverInner />
    </Suspense>
  )
}
