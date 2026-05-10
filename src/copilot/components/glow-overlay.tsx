"use client"

import { memo, useRef } from "react"
import { useCopilotStore } from "./store"

// Copilot 光效：仅背景漂移，刻意不带"点击变色"。
//
// 视觉：
//   - `.copilot-glow::before` —— 四角色斑漂移（8s）
//   - `.copilot-glow-flow`   —— 中层长椭圆反向漂移 + 旋转（8s）
//   - busy(streaming) 时两层加速到 4s，不换色
//
// 刻意不做：点击背景生成额外光点 —— 用户明确要求统一浅色、不要点击变色效果。
//
// 性能：
//   - 静态背景层 `StaticGlow` memo 隔离，enabled + busy 变化才 re-render
//   - isolation + contain 在 CSS 里
//   - translateZ 显式 GPU 提升

/** 静态背景层：enabled + busy 改变才 re-render */
const StaticGlow = memo(function StaticGlow({
  enabled,
  busy,
  innerRef,
}: {
  enabled: boolean
  busy: boolean
  innerRef: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={innerRef}
      className="copilot-glow"
      data-enabled={enabled ? "true" : "false"}
      data-state={busy ? "active" : "idle"}
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

  if (!enabled) return null
  return <StaticGlow enabled={enabled} busy={busy} innerRef={glowRef} />
}
