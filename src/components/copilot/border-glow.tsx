"use client"

import { useEffect, useState } from "react"
import { useCopilotStore } from "./store"

type GlowState = 'off' | 'idle' | 'typing' | 'working'

/**
 * Apple Intelligence 风 screen edges glow —— 路线 A · CSS 近似实现。
 * 5 层 pastel blob 独立 drift + inset radial mask (inverse-square 近似)
 * + mix-blend-mode: screen。作为 overlay 渲染到 <main> 内与 GlowOverlay 同级。
 * off 状态直接 return null；状态转移通过 data-glow 属性驱动 CSS 切换 blob 动画速度与滤镜。
 */
export function CopilotBorderGlow() {
  const { open, busy, typingSignal } = useCopilotStore()
  const [state, setState] = useState<GlowState>('off')

  useEffect(() => {
    if (!open) { setState('off'); return }
    if (busy) { setState('working'); return }
    if (typingSignal > 0) {
      setState('typing')
      const t = setTimeout(() => {
        setState(curr => (curr === 'typing' ? 'idle' : curr))
      }, 2000)
      return () => clearTimeout(t)
    }
    setState('idle')
  }, [open, busy, typingSignal])

  if (state === 'off') return null
  return (
    <div className="copilot-border-glow" data-glow={state} aria-hidden>
      <div className="csg-blob csg-blob-1" />
      <div className="csg-blob csg-blob-2" />
      <div className="csg-blob csg-blob-3" />
      <div className="csg-blob csg-blob-4" />
      <div className="csg-blob csg-blob-5" />
    </div>
  )
}
