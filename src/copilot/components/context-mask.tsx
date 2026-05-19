"use client"

import { useEffect, useLayoutEffect, useRef, useCallback } from "react"
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
//   B. 位置更新走 imperative：scroll/resize 时直接 div.style.transform 写位置，
//      不走 React state → 不触发 setRects → 不触发 N 个 div re-render。
//      用 transform 而非 top/left 避免 layout，只 composite。
//   C. busy（LLM streaming）期间完全冻结：所有 schedule 直接 return，busy 落幕做一次 catch-up。

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
  const { contexts, removeContext, open, busy } = useCopilotStore()
  const t = useT()
  const visible = open
  const pathname = usePathname()

  // elementKey → target HTMLElement（每次 contexts/pathname 变重新 query）
  const targetsRef = useRef<Map<string, HTMLElement>>(new Map())
  // elementKey → 我们渲染的 mask div（callback ref 注册）
  const maskDivsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const frameRef = useRef<number | null>(null)
  // ResizeObserver 监听每个 target 自身大小变化（取代原 MutationObserver）
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
    if (busy) return // C: busy 期间不调度
    frameRef.current = requestAnimationFrame(updatePositions)
  }, [busy, updatePositions])

  // contexts / pathname 变化：重新 query target elements + 重设 ResizeObserver
  useLayoutEffect(() => {
    const newTargets = new Map<string, HTMLElement>()
    for (const c of contexts) {
      // text_selection 没有对应 DOM，不渲染 mask
      if (c.type === "text_selection") continue
      const el = queryContextElement(c.type, c.id, c.extra as Record<string, unknown> | undefined)
      if (el) newTargets.set(c.elementKey, el)
    }
    targetsRef.current = newTargets

    // A: 替换 MutationObserver。每个 target 自带 ResizeObserver，仅在尺寸变才触发
    observerRef.current?.disconnect()
    if (newTargets.size > 0) {
      const ro = new ResizeObserver(() => schedule())
      for (const el of newTargets.values()) ro.observe(el)
      observerRef.current = ro
    } else {
      observerRef.current = null
    }

    // useLayoutEffect 在 paint 前同步跑，立即写 transform 避免 1 帧瞬移闪烁
    updatePositions()

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [contexts, pathname, updatePositions, schedule])

  // scroll / resize 监听：用 capture=true 捕获嵌套 scroll 容器（chat list / main overflow）
  useEffect(() => {
    if (contexts.length === 0) return
    const onScroll = () => schedule()
    const onResize = () => schedule()
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener("resize", onResize)
    }
  }, [contexts.length, schedule])

  // C: busy 落幕 catch-up——streaming 期间冻结的 mask 在结束时对齐到当前位置
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      // busy 0→1 不动；1→0 时补一帧
      schedule()
    }
    wasBusyRef.current = busy
  }, [busy, schedule])

  if (!visible || contexts.length === 0) return null

  return (
    <>
      {contexts.map(c => {
        if (c.type === "text_selection") return null
        const color = colorForTag(c.tag)
        const bgColor = color.replace("rgb", "rgba").replace(")", " / 0.08)")
        const shadowColor = color.replace("rgb", "rgba").replace(")", " / 0.15)")
        return (
          <div
            key={c.elementKey}
            ref={(el) => {
              if (el) maskDivsRef.current.set(c.elementKey, el)
              else maskDivsRef.current.delete(c.elementKey)
            }}
            data-copilot-overlay
            className="fixed pointer-events-none z-[9996] rounded-sm copilot-mask-enter"
            style={{
              top: 0,
              left: 0,
              // initial 0/0；useLayoutEffect 同步阶段会改成正确 transform
              width: 0,
              height: 0,
              transform: "translate3d(0, 0, 0)",
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
                {c.tag}
              </span>
            </div>
            {/* X 移除按钮 —— 右上角 */}
            <button
              data-copilot-overlay
              onClick={() => removeContext(c.elementKey)}
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
