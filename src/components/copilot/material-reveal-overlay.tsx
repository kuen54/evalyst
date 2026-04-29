"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

/**
 * 计算某卡片受 wave 驱动的 glass transition 启动延迟（ms）。
 *
 * 波纹从 x=100vw 起，1250ms 线性扫到 x=0vw（覆盖 100vw 距离）。
 * 卡片 glass 过渡在"wave 已经扫过"后才启动：统一加 700ms offset，
 * 让 wave 先行抢镜、UI 在波纹完全过境之后才翻面。
 *
 * 最右卡 delay 700ms（wave peak 已到 44vw）；中线卡 1325ms（wave 出屏 75ms）；
 * 最左卡 1950ms（wave 出屏 700ms）。
 * 返回：夹在 [0, 1950] 区间。
 *
 * @param centerXvw 卡片水平中心位置（vw 单位，0=左边缘，100=右边缘）
 */
export function computeRevealDelay(centerXvw: number): number {
  const fromVw = 100
  const totalVwTraveled = 100 // 100 → 0
  const durationMs = 1250
  const waitForWaveOffsetMs = 700
  const raw = waitForWaveOffsetMs + ((fromVw - centerXvw) / totalVwTraveled) * durationMs
  return Math.max(0, Math.min(1950, raw))
}

/**
 * 同步 apply cascade：遍历 [data-glass-variant]，按 getBoundingClientRect 水平中心
 * 写 inline CSS var --reveal-delay，再设 html[data-copilot-revealing=true]
 * 激活高优先级 transition override。
 *
 * 必须在 React 提交 shell.tsx 新 inline style（closed→glass 值）之前调用，
 * 否则浏览器会用 shell 的 inline transition 先启动 320ms 过渡，
 * 之后再写的 --reveal-delay 不作用于 in-flight transition。
 *
 * 因此本函数在 store.setOpen / toggleOpen 里被同步调用，挤在 setOpenState 之前。
 */
export function applyRevealCascade(): void {
  if (typeof window === "undefined") return
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const vw = window.innerWidth
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
}

/**
 * 清理 cascade 副作用：移除所有 --reveal-delay inline CSS var 和 data-copilot-revealing flag。
 * 对没有 --reveal-delay 的元素调 removeProperty 是 no-op，幂等。
 */
export function clearRevealCascade(): void {
  if (typeof document === "undefined") return
  document
    .querySelectorAll<HTMLElement>("[data-glass-variant]")
    .forEach(el => el.style.removeProperty("--reveal-delay"))
  delete document.documentElement.dataset.copilotRevealing
}

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

    const cleanupDelay = prefersReduce ? 220 : 2350

    const cleanup = () => {
      clearRevealCascade()
      setActive(false)
    }

    const timer = setTimeout(cleanup, cleanupDelay)

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
