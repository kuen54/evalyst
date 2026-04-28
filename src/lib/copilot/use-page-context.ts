"use client"

import { useEffect } from "react"
import { useCopilotStore } from "@/components/copilot/store"
import type { PageContext } from "./types"

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
  useEffect(() => {
    setPageContext(getter())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    return () => setPageContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
