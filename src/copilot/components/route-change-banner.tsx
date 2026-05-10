"use client"

import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n/provider"
import { useCopilotStore } from "./store"

interface Props {
  onForkSession: () => void
  hasMessages: boolean
}

/**
 * 切页 banner：告知清空了 N 个 context，提供“开启新对话”/“继续”二选一。
 * 显示条件（AND）：routeChangeBanner.visible + hasMessages 为 true
 * 沿用 amber agent-hint 样式（semantic 色 > 装饰玻璃）
 */
export function RouteChangeBanner({ onForkSession, hasMessages }: Props) {
  const t = useT()
  const { routeChangeBanner, dismissRouteChangeBanner } = useCopilotStore()
  if (!routeChangeBanner?.visible || !hasMessages) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200">
      <AlertTriangle className="size-4 shrink-0" />
      <div className="flex-1 text-xs">
        {t("copilot.route_change.message", { n: routeChangeBanner.count })}
      </div>
      <button
        type="button"
        className="h-7 px-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-xs font-medium"
        onClick={() => {
          dismissRouteChangeBanner()
          onForkSession()
        }}
      >
        {t("copilot.route_change.new_session")}
      </button>
      <button
        type="button"
        className="h-7 px-2 rounded hover:bg-amber-500/10 text-xs"
        onClick={dismissRouteChangeBanner}
      >
        {t("copilot.route_change.continue")}
      </button>
    </div>
  )
}
