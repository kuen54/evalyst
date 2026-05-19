"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useCopilotStore, useCopilotBusy } from "./store"
import { queryContextElement } from "@/copilot/lib/context-registry"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/provider"

// 对每个已捕获的 context 渲染一个 fixed 定位的彩色蒙层 + 数字徽章。
// 核心挑战：路由切换 / resize / DOM 变化时 rect 要重算；找不到元素就隐藏（chip 保留，遮罩消失）。
//
// 刷新页面时 mask 永远找不回（新 DOM 不知道 rect），依赖 panel 里的一次 toast 提示用户。
//
// v0.18.8 性能优化（圈选框是页面卡顿的主因，但 setRects 路径定位本身正常，不动）：
//   A. 删全局 MutationObserver(document.body, subtree:true) → 换 per-target ResizeObserver。
//      streaming 时每 chunk 触发的 observer 回调消失了。Route change 由 pathname effect 兜底。
//   C. busy（LLM streaming）期间冻结：所有 schedule 直接 return；busy 落幕做一次 catch-up。
//      streaming 期间 mask 完全 0 cost。
//
// 不做 imperative DOM 更新（曾经试过，初始 rect 0,0,0,0 时所有 mask 堆左上角，回归到 setRects 路径）。

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
  return COLORS[(tag - 1) % COLORS.length]!
}

export function ContextMask() {
  const { contexts, removeContext, open } = useCopilotStore()
  const busy = useCopilotBusy()
  const t = useT()
  const visible = open
  const pathname = usePathname()
  const [rects, setRects] = useState<MaskRect[]>([])
  const frameRef = useRef<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const recompute = useCallback(() => {
    frameRef.current = null
    if (busy) return // C: busy 期间不更新
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
  }, [contexts, busy])

  const scheduleRecompute = useCallback(() => {
    if (frameRef.current !== null) return
    if (busy) return // C: busy 期间不调度
    frameRef.current = requestAnimationFrame(recompute)
  }, [recompute, busy])

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

  // A: per-target ResizeObserver 取代旧 MutationObserver(body, subtree:true)
  // 旧方案 streaming 期间每 chunk 都触发 observer 回调；新方案只在 target 自身尺寸变化时触发。
  // Route change 已有 pathname effect 兜底，新元素出现的场景由 inspector 添加新 context 自带 query。
  useEffect(() => {
    if (contexts.length === 0) return
    const targets: HTMLElement[] = []
    for (const c of contexts) {
      if (c.type === "text_selection") continue
      const el = queryContextElement(c.type, c.id, c.extra as Record<string, unknown> | undefined)
      if (el) targets.push(el)
    }
    if (targets.length === 0) return
    const ro = new ResizeObserver(() => scheduleRecompute())
    for (const el of targets) ro.observe(el)
    observerRef.current = ro
    return () => {
      ro.disconnect()
      observerRef.current = null
    }
  }, [contexts, pathname, scheduleRecompute])

  // C: busy 落幕 catch-up——streaming 期间冻结的 mask 在结束时对齐当前位置
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (wasBusyRef.current && !busy) scheduleRecompute()
    wasBusyRef.current = busy
  }, [busy, scheduleRecompute])

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
              title={t("copilot.context_remove_title")}
              aria-label={t("copilot.context_remove_title")}
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
