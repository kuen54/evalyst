"use client"

import { memo, useEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

// Copilot 光效：仅背景漂移，刻意不带"点击变色"。
//
// 视觉：
//   - `.copilot-glow::before` —— 四角色斑（idle 静止，busy 时 4s 漂移）
//   - `.copilot-glow-flow`   —— 中层长椭圆（同上）
//   - idle 不动：避免 backdrop-filter 玻璃卡每帧重 blur（H1 性能主因）
//
// 刻意不做：点击背景生成额外光点 —— 用户明确要求统一浅色、不要点击变色效果。
//
// 性能：
//   - 静态背景层 `StaticGlow` memo 隔离，enabled + busy + visible 变化才 re-render
//   - isolation + contain 在 CSS 里
//   - busy 时才 translateZ + will-change（idle 不占 GPU layer 预算）
//   - document.hidden 时 data-visible="false"，CSS 暂停动画

/** 静态背景层：enabled + busy + visible 改变才 re-render */
const StaticGlow = memo(function StaticGlow({
  enabled,
  busy,
  visible,
  innerRef,
}: {
  enabled: boolean
  busy: boolean
  visible: boolean
  innerRef: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={innerRef}
      className="copilot-glow"
      data-enabled={enabled ? "true" : "false"}
      data-state={busy ? "active" : "idle"}
      data-visible={visible ? "true" : "false"}
      aria-hidden
    >
      <div className="copilot-glow-flow" />
    </div>
  )
})

export function GlowOverlay() {
  const { open, busy } = useCopilotStore()
  const enabled = open
  const glowRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(true)

  // Page Visibility：tab 隐藏时给 data-visible="false"，CSS 暂停动画
  useEffect(() => {
    if (typeof document === "undefined") return
    const sync = () => setVisible(!document.hidden)
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])

  if (!enabled) return null
  return <StaticGlow enabled={enabled} busy={busy} visible={visible} innerRef={glowRef} />
}
