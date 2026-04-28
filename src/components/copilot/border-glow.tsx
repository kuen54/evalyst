"use client"

import { useEffect, useState } from "react"
import { useCopilotStore } from "./store"

type GlowState = 'off' | 'idle' | 'typing' | 'working'

/**
 * Apple Intelligence 风 screen edges glow —— 作为 overlay 渲染到 <main> 内，
 * 与 GlowOverlay（背景漂移）同级 sibling，不包裹 main、不改 main layout。
 * off 状态直接 return null，彻底不上 DOM；状态转移通过 data-glow 属性驱动，
 * CSS 变量切换做状态差异（rim_width / feather / speed / saturate），无 React 重渲染。
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
  return <div className="copilot-border-glow" data-glow={state} aria-hidden />
}
