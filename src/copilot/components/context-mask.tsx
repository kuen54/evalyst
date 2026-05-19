"use client"

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react"
import { useCopilotStore } from "./store"
import { queryContextElement } from "@/copilot/lib/context-registry"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/provider"

// 对每个已捕获的 context 渲染一个 fixed 定位的彩色蒙层 + 数字徽章。
// 核心挑战：路由切换 / resize / scroll / 目标元素自身大小变 时 rect 要重算；找不到元素就隐藏（chip 保留，遮罩消失）。
//
// 刷新页面时 mask 永远找不回（新 DOM 不知道 rect），依赖 panel 里的一次 toast 提示用户。
//
// v0.18.8 性能重构（圈选框是页面卡顿的主因）：
//   A. 删全局 MutationObserver(document.body, subtree:true) → 换 per-target ResizeObserver。
//      streaming 时每 chunk 触发的 observer 回调消失了。Route change 由 pathname effect 兜底。
//   B. scroll/resize 走 imperative：scroll 时直接 div.style.transform 写位置，不走 React state。
//      transform 而非 top/left → 避免 layout，只 composite。
//   C. busy（LLM streaming）期间完全冻结：所有 schedule 直接 return，busy 落幕做一次 catch-up。
//
//   状态分两层：
//     - React state 「哪些 context 定位成功」（初次定位的初始 rect）—— 触发 mask 是否渲染
//     - imperative ref 「mask 当前位置」—— 触发 transform 实时更新
//   只有 contexts/pathname 改变时才动 state；scroll/resize/ResizeObserver 全走 ref 不重渲染。

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

interface ResolvedMask {
  elementKey: string
  tag: number
  /** 初始 rect：state 里只存 contexts/pathname 变时的 first-paint 位置；
   *  scroll/resize 不更新 state，走 ref imperative。 */
  initial: { x: number; y: number; w: number; h: number }
}

export function ContextMask() {
  const { contexts, removeContext, open, busy } = useCopilotStore()
  const t = useT()
  const visible = open
  const pathname = usePathname()

  /** 哪些 context 定位成功：只在 contexts/pathname/visible 变时重算 */
  const [resolved, setResolved] = useState<ResolvedMask[]>([])

  // elementKey → target HTMLElement
  const targetsRef = useRef<Map<string, HTMLElement>>(new Map())
  // elementKey → 我们渲染的 mask div
  const maskDivsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const frameRef = useRef<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  /** rAF 内同步：iterate targets，getBoundingClientRect → div.style.transform 直写。
   *  busy / 不可见 时直接 return。 */
  const updatePositions = useCallback(() => {
    frameRef.current = null
    if (!visible || busy) return
    for (const [key, target] of targetsRef.current) {
      const div = maskDivsRef.current.get(key)
      if (!div) continue
      const r = target.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        // 元素被 hide / display:none → 藏 mask
        div.style.opacity = "0"
        continue
      }
      div.style.opacity = "1"
      div.style.width = `${r.width + 4}px`
      div.style.height = `${r.height + 4}px`
      div.style.transform = `translate3d(${r.left - 2}px, ${r.top - 2}px, 0)`
    }
  }, [visible, busy])

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return
    if (busy) return
    frameRef.current = requestAnimationFrame(updatePositions)
  }, [busy, updatePositions])

  // schedule 同步进 ref，避免 useLayoutEffect / ResizeObserver 因 busy 变化重设
  const scheduleRef = useRef(schedule)
  useEffect(() => { scheduleRef.current = schedule }, [schedule])

  // contexts / pathname / visible 变化：重新 query target，刷新 resolved + ResizeObserver
  useLayoutEffect(() => {
    if (!visible) {
      // copilot 关闭：清空 resolved + targets 让 mask 消失
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dep change; see docs/conventions/react19-hydration.md
      setResolved([])
      targetsRef.current = new Map()
      observerRef.current?.disconnect()
      observerRef.current = null
      return
    }
    const newTargets = new Map<string, HTMLElement>()
    const newResolved: ResolvedMask[] = []
    for (const c of contexts) {
      // text_selection 没有对应 DOM
      if (c.type === "text_selection") continue
      const el = queryContextElement(c.type, c.id, c.extra as Record<string, unknown> | undefined)
      if (!el) continue
      newTargets.set(c.elementKey, el)
      const r = el.getBoundingClientRect()
      newResolved.push({
        elementKey: c.elementKey,
        tag: c.tag,
        initial: { x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 },
      })
    }
    targetsRef.current = newTargets
    setResolved(newResolved)

    // A: per-target ResizeObserver 替代旧的 body subtree MutationObserver。
    // 走 scheduleRef 避免捕获过期 schedule（busy 变时不需要重设 observer）。
    observerRef.current?.disconnect()
    if (newTargets.size > 0) {
      const ro = new ResizeObserver(() => scheduleRef.current())
      for (const el of newTargets.values()) ro.observe(el)
      observerRef.current = ro
    } else {
      observerRef.current = null
    }
  }, [contexts, pathname, visible])

  // scroll / resize 监听：capture=true 捕获嵌套 scroll 容器
  useEffect(() => {
    if (!visible || resolved.length === 0) return
    const onScroll = () => scheduleRef.current()
    const onResize = () => scheduleRef.current()
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener("resize", onResize)
    }
  }, [visible, resolved.length])

  // C: busy 落幕 catch-up
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (wasBusyRef.current && !busy) scheduleRef.current()
    wasBusyRef.current = busy
  }, [busy])

  // 卸载清理 ResizeObserver / 在飞 rAF
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  if (!visible || resolved.length === 0) return null

  return (
    <>
      {resolved.map(r => {
        const color = colorForTag(r.tag)
        const bgColor = color.replace("rgb", "rgba").replace(")", " / 0.08)")
        const shadowColor = color.replace("rgb", "rgba").replace(")", " / 0.15)")
        return (
          <div
            key={r.elementKey}
            ref={(el) => {
              if (el) maskDivsRef.current.set(r.elementKey, el)
              else maskDivsRef.current.delete(r.elementKey)
            }}
            data-copilot-overlay
            className="fixed pointer-events-none z-[9996] rounded-sm copilot-mask-enter"
            style={{
              top: 0,
              left: 0,
              width: r.initial.w,
              height: r.initial.h,
              transform: `translate3d(${r.initial.x}px, ${r.initial.y}px, 0)`,
              willChange: "transform",
              border: `2px solid ${color}`,
              backgroundColor: bgColor,
              boxShadow: `0 0 0 3px ${shadowColor}`,
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
