"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useCopilotStore } from "./store"
import { queryContextElement } from "@/copilot/lib/context-registry"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/provider"

// 对每个已捕获的 context 渲染一个 fixed 定位的彩色蒙层 + 数字徽章。
// 核心挑战：路由切换 / resize / DOM 变化时 rect 要重算；找不到元素就隐藏（chip 保留，遮罩消失）。
//
// 刷新页面时 mask 永远找不回（新 DOM 不知道 rect），依赖 panel 里的一次 toast 提示用户。
//
// v0.18.8 性能优化：
//   A. 删全局 MutationObserver(document.body, subtree:true) → 换 per-target ResizeObserver。
//      streaming 时每 chunk 触发的 observer 回调消失了。Route change 由 pathname effect 兜底。
//
// v0.18.18 修：v0.18.8 当时还加了 C 级 "busy 期间 schedule return" 的冻结，但
//   1. A 级 per-target ResizeObserver 已经把 streaming 期间的动态 cost 解决了，C 是冗余防御
//   2. 用户 scroll 是主动交互应该立即更新，被 busy 短路是 UX bug
//   3. H4 (v0.18.11) 把 busy 改成计数器后若有 inc/dec 不配对的 race，busy 永久卡 true → mask 永远不动
//   故彻底删掉 busy 守卫 + 落幕 catch-up effect。perf 主防线仅靠 A + RAF debounce。
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
  const t = useT()
  const visible = open
  const pathname = usePathname()
  const [rects, setRects] = useState<MaskRect[]>([])
  const frameRef = useRef<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  // elementKey → 已解析的 DOM 元素。querySelector 只在 contexts/pathname 变化或元素
  // 失联时跑；scroll/resize 的每帧 recompute 只读 getBoundingClientRect。
  const elCacheRef = useRef<Map<string, HTMLElement | null>>(new Map())

  const recompute = useCallback(() => {
    frameRef.current = null
    if (contexts.length === 0) {
      setRects([])
      return
    }
    const cache = elCacheRef.current
    const out: MaskRect[] = contexts.map(c => {
      // text_selection 没有对应 DOM 元素，不渲染 mask（但 chip 保留）
      if (c.type === "text_selection") {
        return { elementKey: c.elementKey, tag: c.tag, rect: null }
      }
      let el = cache.get(c.elementKey) ?? null
      // isConnected 不够：列表筛选/排序后 React 可能复用同一 DOM 节点渲染另一个 task，
      // 节点仍 connected 但 data-id 已变 → mask 框错内容。复用前校验 dataset 仍匹配。
      if (!el || !el.isConnected || el.dataset.copilotContextId !== c.id || el.dataset.copilotContext !== c.type) {
        // 缓存失效（首次 / 路由切换后元素重建 / 节点被复用给别的 context / 之前没找到）才重新 query
        el = queryContextElement(c.type, c.id, c.extra as Record<string, unknown> | undefined)
        cache.set(c.elementKey, el)
      }
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

  // contexts / pathname 变化时立即重算（顺带清掉已移除 context 的缓存项）
  useEffect(() => {
    const keys = new Set(contexts.map(c => c.elementKey))
    for (const k of elCacheRef.current.keys()) {
      if (!keys.has(k)) elCacheRef.current.delete(k)
    }
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
