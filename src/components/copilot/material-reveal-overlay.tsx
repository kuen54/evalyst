"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

/**
 * 计算某卡片受 wave 驱动的 glass transition 启动延迟（ms）。
 *
 * 时序：panel spring 0-450ms → wave 200ms 起步 → cascade 紧跟 wave。
 * wave 自己的 200ms 延迟 + 550ms wait-for-wave-offset = 总基线 750ms。
 * 卡片在 wave 已经扫过后才翻面，让 "wave 点亮 UI" 的因果感成立。
 *
 * 当 copilot panel 开着（~420px）时，wave overlay 从 panel 左边缘开始扫，
 * startVw = 100 - panelVw，卡片最大 centerXvw = startVw。
 *
 * @param centerXvw 卡片水平中心位置（vw 单位，0=左边缘，100=右边缘）
 * @param startVw 波纹起始位置（vw 单位），缺省 100（无 panel）
 */
export function computeRevealDelay(centerXvw: number, startVw = 100): number {
  const totalVwTraveled = 100 // startVw → (startVw - 100)
  const durationMs = 1250
  const waitForWaveOffsetMs = 750 // 包含 wave 自己的 200ms 启动延迟
  const raw = waitForWaveOffsetMs + ((startVw - centerXvw) / totalVwTraveled) * durationMs
  return Math.max(0, Math.min(2000, raw))
}

/** 读取当前 panel 宽度（vw 单位）。未开面板或 DOM 未准备好时返回 0。 */
function readPanelVw(): number {
  if (typeof document === "undefined") return 0
  const vw = window.innerWidth
  if (vw <= 0) return 0
  const panelEl = document.querySelector<HTMLElement>("[data-copilot-panel]")
  if (!panelEl) return 0
  const rect = panelEl.getBoundingClientRect()
  return (rect.width / vw) * 100
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
    // Panel 尚未 open（此函数在 rising edge setOpen 前同步调），readPanelVw() 返回 0 —
    // 这正是我们要的 startVw=100（wave 从 viewport 右边缘扫）；但更自然的方案是让
    // wave 从 panel 实际左边缘扫。由于 panel 宽度 = store.width（默认 420px）在 store
    // layer 已知，store 把它写到 html[style] --copilot-panel-width 上。此处读 panel
    // DOM rect 在第一次打开时还是 0（DOM 还没画），所以直接从 store 的 width 推 panelVw。
    // 但无法在这一层访问 store；改从 html inline style 的 --copilot-panel-width 读，
    // 而这也要 store 先同步写。rising-edge 顺序：store.setOpen → apply 到 html var →
    // applyRevealCascade → applyRevealCascade 读 var。
    const htmlEl = document.documentElement
    const panelPxStr = htmlEl.style.getPropertyValue("--copilot-panel-width").trim()
    const panelPx = parseFloat(panelPxStr.replace("px", "")) || 0
    const panelVw = panelPx > 0 ? (panelPx / vw) * 100 : readPanelVw()
    const startVw = 100 - panelVw
    document
      .querySelectorAll<HTMLElement>("[data-glass-variant]")
      .forEach(el => {
        const rect = el.getBoundingClientRect()
        const centerXvw = ((rect.left + rect.width / 2) / vw) * 100
        el.style.setProperty("--reveal-delay", `${computeRevealDelay(centerXvw, startVw)}ms`)
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
