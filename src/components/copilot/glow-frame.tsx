"use client"

import { useEffect, useState } from "react"
import { useCopilotStore } from "./store"

type GlowState = 'off' | 'idle' | 'typing' | 'working'

/**
 * 包裹主内容区（sidebar 和 copilot panel 之间），copilot 开时显示彩色边框光。
 * 4 状态：
 *   off     — copilot 关
 *   idle    — copilot 开、无输入无工作
 *   typing  — 用户正在输入（debounced 250ms by store.bumpTypingSignal）
 *   working — busy=true（streaming 或 tool 执行中）
 * 状态通过 data-glow 属性驱动，CSS 变量切换，无 React 重渲染（除 data-attr）
 */
export function CopilotGlowFrame({ children }: { children: React.ReactNode }) {
  const { open, busy, typingSignal } = useCopilotStore()
  const [state, setState] = useState<GlowState>('off')

  useEffect(() => {
    if (!open) { setState('off'); return }
    if (busy) { setState('working'); return }
    // typingSignal bump 触发 2s 内 typing 状态，之后回 idle
    if (typingSignal > 0) {
      setState('typing')
      const t = setTimeout(() => {
        setState(curr => (curr === 'typing' ? 'idle' : curr))
      }, 2000)
      return () => clearTimeout(t)
    }
    setState('idle')
  }, [open, busy, typingSignal])

  return (
    <div className="copilot-glow-frame flex-1 h-screen flex flex-col overflow-hidden relative" data-glow={state}>
      {children}
    </div>
  )
}
