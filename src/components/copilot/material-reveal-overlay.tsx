"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

/**
 * 计算某卡片受 wave 驱动的 glass transition 启动延迟（ms）。
 *
 * 波纹中心从 x=100vw 起，700ms 线性扫到 x=-20vw（覆盖 120vw 距离）。
 * 返回：wave 中心到达卡片中心的时刻，夹在 [0, 600] 区间。
 *
 * @param centerXvw 卡片水平中心位置（vw 单位，0=左边缘，100=右边缘）
 */
export function computeRevealDelay(centerXvw: number): number {
  const fromVw = 100
  const totalVwTraveled = 120 // 100 → -20
  const durationMs = 700
  const raw = ((fromVw - centerXvw) / totalVwTraveled) * durationMs
  return Math.max(0, Math.min(600, raw))
}

/**
 * 一次性 Material Reveal overlay：订阅 store.lastOpenedAt rising-edge，
 * 扫一道 accent 色高光带 + 让 [data-glass-variant] 按水平位置级联翻成玻璃态。
 *
 * 刷新页面恢复 open=true 时不触发（首次 mount 被 firstMountRef 屏蔽）。
 * 关闭 copilot 时无动作（关闭不改 lastOpenedAt）。
 */
export function MaterialRevealOverlay() {
  const { lastOpenedAt } = useCopilotStore()
  const [active, setActive] = useState(false)
  const firstMountRef = useRef(true)

  useLayoutEffect(() => {
    // 首次 mount（含刷新恢复 open=true 的情况）不触发
    if (firstMountRef.current) {
      firstMountRef.current = false
      return
    }
    if (lastOpenedAt === 0) return

    const prefersReduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // 计算每个 [data-glass-variant] 的 --reveal-delay 并写成 inline CSS var
    const vw = typeof window !== "undefined" ? window.innerWidth : 0
    if (vw > 0 && !prefersReduce) {
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => {
          const rect = el.getBoundingClientRect()
          const centerXvw = ((rect.left + rect.width / 2) / vw) * 100
          el.style.setProperty("--reveal-delay", `${computeRevealDelay(centerXvw)}ms`)
        })
    }

    document.documentElement.dataset.copilotRevealing = "true"
    setActive(true)

    const cleanupDelay = prefersReduce ? 220 : 850

    /**
     * 清理：重新 querySelectorAll（不用前面捕获的集合），因为 850ms 内 DOM 可能变化。
     * 对没有 --reveal-delay 的元素调 removeProperty 是 no-op。
     */
    const cleanup = () => {
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => el.style.removeProperty("--reveal-delay"))
      delete document.documentElement.dataset.copilotRevealing
      setActive(false)
    }

    const timer = setTimeout(cleanup, cleanupDelay)

    // lastOpenedAt 再次变化（< 850ms 内二次打开）→ 先清再重起
    return () => {
      clearTimeout(timer)
      cleanup()
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
