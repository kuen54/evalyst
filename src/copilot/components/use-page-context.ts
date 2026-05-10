"use client"

import { useEffect } from "react"
import { useCopilotStore } from "@/components/copilot/store"
import type { PageContext } from "@/lib/copilot/types"

/**
 * 每个页面在顶部调用，把当前页面摘要注册到 copilot store。
 * 依赖变化时自动更新；unmount 时清空。
 *
 * 用法：
 *   useRegisterPageContext(() => ({
 *     route_type: 'experiment_detail',
 *     path: `/experiments/${id}`,
 *     summary: { id, name, status, ... },
 *     timestamp: new Date().toISOString(),
 *   }), [experiment, tasks])
 */
export function useRegisterPageContext(
  getter: () => PageContext,
  deps: React.DependencyList,
): void {
  const { setPageContext } = useCopilotStore()
  // 单 effect: deps 变 → set 新值；unmount / deps 再变前先清空。
  // 合并成一个 effect 是故意的：避免 Strict Mode 下 split effects 在 mount→unmount→remount
  // 的生命周期里，空依赖的 cleanup 把刚 set 的 context 立刻清掉。
  useEffect(() => {
    setPageContext(getter())
    return () => setPageContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
