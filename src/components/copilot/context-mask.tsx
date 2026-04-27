"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useCopilotStore } from "./store"
import { queryContextElement } from "@/lib/copilot/context-registry"
import { usePathname } from "next/navigation"

// 对每个已捕获的 context 渲染一个 fixed 定位的彩色蒙层 + 数字徽章。
// 核心挑战：路由切换 / resize / DOM 变化时 rect 要重算；找不到元素就隐藏（chip 保留，遮罩消失）。
//
// 刷新页面时 mask 永远找不回（新 DOM 不知道 rect），依赖 panel 里的一次 toast 提示用户。

interface MaskRect {
  elementKey: string
  tag: number
  rect: DOMRect | null
}

// 给每个 tag 一个颜色（循环）
const COLORS = [
  "rgb(59 130 246)",  // blue
  "rgb(236 72 153)",  // pink
  "rgb(16 185 129)",  // emerald
  "rgb(245 158 11)",  // amber
  "rgb(139 92 246)",  // violet
  "rgb(14 165 233)",  // sky
]

function colorForTag(tag: number): string {
  return COLORS[(tag - 1) % COLORS.length]
}

export function ContextMask() {
  const { contexts, removeContext, open } = useCopilotStore()
  const visible = open
  const pathname = usePathname()
  const [rects, setRects] = useState<MaskRect[]>([])
  const frameRef = useRef<number | null>(null)

  const recompute = useCallback(() => {
    frameRef.current = null
    if (contexts.length === 0) {
      setRects([])
      return
    }
    const out: MaskRect[] = contexts.map(c => {
      // text_selection 没有对应 DOM 元素，不渲染 mask（但 chip 保留）
      if (c.type === "text_selection") {
        return { elementKey: c.elementKey, tag: c.tag, rect: null }
      }
      const el = queryContextElement(c.type, c.id, c.extra as Record<string, unknown> | undefined)
      return {
        elementKey: c.elementKey,
        tag: c.tag,
        rect: el ? el.getBoundingClientRect() : null,
      }
    })
    setRects(out)
  }, [contexts])

  const scheduleRecompute = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(recompute)
  }, [recompute])

  // contexts / pathname 变化时立即重算
  useEffect(() => {
    scheduleRecompute()
  }, [contexts, pathname, scheduleRecompute])

  // resize / scroll 时重算
  useEffect(() => {
    if (contexts.length === 0) return
    const onResize = () => scheduleRecompute()
    const onScroll = () => scheduleRecompute()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
    }
  }, [contexts.length, scheduleRecompute])

  // DOM 变化时用 MutationObserver 触发重算，但按 500ms 节流
  // —— 避免 copilot streaming / 其它高频局部更新把 rect 查询跑到 60fps。
  useEffect(() => {
    if (contexts.length === 0) return
    let pending = false
    let lastRun = 0
    const observer = new MutationObserver(() => {
      const now = performance.now()
      if (now - lastRun < 500) {
        if (pending) return
        pending = true
        setTimeout(() => {
          pending = false
          lastRun = performance.now()
          scheduleRecompute()
        }, 500 - (now - lastRun))
        return
      }
      lastRun = now
      scheduleRecompute()
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: false })
    return () => observer.disconnect()
  }, [contexts.length, scheduleRecompute])

  if (!visible || contexts.length === 0) return null

  return (
    <>
      {rects.map(r => {
        if (!r.rect) return null
        const color = colorForTag(r.tag)
        return (
          <div
            key={r.elementKey}
            data-copilot-overlay
            className="fixed pointer-events-none z-[9996] rounded-sm copilot-mask-enter"
            style={{
              top: r.rect.top - 2,
              left: r.rect.left - 2,
              width: r.rect.width + 4,
              height: r.rect.height + 4,
              border: `2px solid ${color}`,
              backgroundColor: `${color.replace("rgb", "rgba").replace(")", " / 0.08)")}`,
              boxShadow: `0 0 0 3px ${color.replace("rgb", "rgba").replace(")", " / 0.15)")}`,
            }}
          >
            {/* 数字徽章 —— 左上角 */}
            <div
              data-copilot-overlay
              className="absolute -top-2.5 -left-2.5 pointer-events-auto"
            >
              <span
                className="w-5 h-5 rounded-full text-[11px] font-bold text-white flex items-center justify-center shadow-sm"
                style={{ backgroundColor: color }}
              >
                {r.tag}
              </span>
            </div>
            {/* X 移除按钮 —— 右上角 */}
            <button
              data-copilot-overlay
              onClick={() => removeContext(r.elementKey)}
              className="absolute -top-2.5 -right-2.5 pointer-events-auto w-5 h-5 rounded-full bg-white/95 hover:bg-white border flex items-center justify-center text-[11px] leading-none text-muted-foreground hover:text-destructive shadow-sm transition-colors"
              style={{ borderColor: color }}
              title="移除"
              aria-label="移除"
            >
              ×
            </button>
          </div>
        )
      })}
    </>
  )
}

export { colorForTag }
