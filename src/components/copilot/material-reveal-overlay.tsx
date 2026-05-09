"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"
import { clearRevealCascade } from "./material-reveal-cascade"

// computeRevealDelay / applyRevealCascade / clearRevealCascade 已迁出到
// ./material-reveal-cascade（无 React 依赖），用于切断 store ↔ overlay 循环依赖。
// 本组件只保留依赖 React 的 MaterialRevealOverlay。
export { computeRevealDelay } from "./material-reveal-cascade"

/**
 * 一次性 Material Reveal overlay：订阅 store.lastOpenedAt rising-edge，
 * 渲染扫光 overlay divs，并在结束后清理 cascade。
 *
 * Cascade 的 apply 已经在 store.setOpen 里同步完成（必须 pre-React-commit 才生效）；
 * 本组件只负责渲染 `.copilot-reveal-wave` + `.copilot-reveal-tail` 和调度清理。
 *
 * 刷新页面恢复 open=true 时不触发（首次 mount 被 firstMountRef 屏蔽）。
 * 关闭 copilot 时无动作（关闭不改 lastOpenedAt）。
 */
export function MaterialRevealOverlay() {
  const { lastOpenedAt } = useCopilotStore()
  const [active, setActive] = useState(false)
  const firstMountRef = useRef(true)

  useLayoutEffect(() => {
    if (firstMountRef.current) {
      firstMountRef.current = false
      return
    }
    if (lastOpenedAt === 0) return

    const prefersReduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    setActive(true)

    const cleanupDelay = prefersReduce ? 220 : 2400

    const cleanup = () => {
      clearRevealCascade()
      setActive(false)
    }

    const timer = setTimeout(cleanup, cleanupDelay)

    /**
     * effect cleanup 只清 timer——不调 cleanup()，否则 React 在下一次 reveal 触发
     * re-run 时会先跑旧 cleanup 擦掉 store.setOpen 刚写的 --reveal-delay，导致
     * shell 提交新 inline style 时 cascade override 已经失效。
     * 真正的 DOM 清理由 setTimeout 回调 或 store.setOpen(false) 主动调用 clearRevealCascade 负责。
     */
    return () => {
      clearTimeout(timer)
    }
  }, [lastOpenedAt])

  if (!active) return null
  return (
    <>
      <div className="copilot-reveal-wave" aria-hidden />
      <div className="copilot-reveal-tail" aria-hidden />
    </>
  )
}
