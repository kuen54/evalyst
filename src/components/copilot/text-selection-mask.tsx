"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useCopilotStore } from "./store"
import { queryContextElement } from "@/lib/copilot/context-registry"
import { colorForTag } from "./context-mask"

// 把已捕获的 text_selection 持久高亮在页面上。
// 定位策略：用 host 的 data-copilot-context* 属性重建 host 元素 → TreeWalker 按 textOffset 在 host.textContent 里找到 start/end 文本节点 → Range.getClientRects 得到多行矩形 → 绝对定位渲染。
// scroll / resize / MutationObserver 重算。找不到 host 或 offset 不匹配（DOM 变了）就不渲染（chip 在 panel 里仍保留）。

interface TextMask {
  elementKey: string
  tag: number
  color: string
  rects: DOMRect[]
  badge: { top: number; left: number }
}

export function TextSelectionMask() {
  const { contexts, open } = useCopilotStore()
  const visible = open
  const pathname = usePathname()
  const [masks, setMasks] = useState<TextMask[]>([])
  const frameRef = useRef<number | null>(null)

  const recompute = useCallback(() => {
    frameRef.current = null
    const next: TextMask[] = []
    for (const c of contexts) {
      if (c.type !== "text_selection") continue
      const extra = c.extra as {
        text?: string
        hostType?: string
        hostId?: string
        hostExtra?: Record<string, unknown>
        textOffset?: number
      } | undefined
      if (!extra?.text || !extra.hostType || !extra.hostId || extra.textOffset == null) continue
      const host = queryContextElement(extra.hostType, extra.hostId, extra.hostExtra)
      if (!host) continue
      const range = locateTextRange(host, extra.textOffset, extra.text)
      if (!range) continue
      const rects = Array.from(range.getClientRects())
      if (rects.length === 0) continue
      const last = rects[rects.length - 1]
      next.push({
        elementKey: c.elementKey,
        tag: c.tag,
        color: colorForTag(c.tag),
        rects,
        badge: { top: last.top - 4, left: last.right + 2 },
      })
    }
    setMasks(next)
  }, [contexts])

  const scheduleRecompute = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(recompute)
  }, [recompute])

  useEffect(() => { scheduleRecompute() }, [contexts, pathname, scheduleRecompute])

  useEffect(() => {
    const hasText = contexts.some(c => c.type === "text_selection")
    if (!hasText) return
    const onResize = () => scheduleRecompute()
    const onScroll = () => scheduleRecompute()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions)
    }
  }, [contexts, scheduleRecompute])

  useEffect(() => {
    const hasText = contexts.some(c => c.type === "text_selection")
    if (!hasText) return
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
  }, [contexts, scheduleRecompute])

  if (!visible || masks.length === 0) return null

  return (
    <>
      {masks.map(m => (
        <div key={m.elementKey} data-copilot-overlay>
          {m.rects.map((r, i) => (
            <div
              key={i}
              className="fixed pointer-events-none z-[9996] rounded-sm"
              style={{
                top: r.top - 1,
                left: r.left - 1,
                width: r.width + 2,
                height: r.height + 2,
                backgroundColor: rgba(m.color, 0.34),
                boxShadow: `0 0 0 2px ${rgba(m.color, 0.55)}, 0 1px 8px -2px ${rgba(m.color, 0.45)}`,
                borderBottom: `2.5px solid ${rgba(m.color, 0.9)}`,
              }}
            />
          ))}
          <span
            className="fixed pointer-events-none z-[9997] rounded-full text-[11px] font-bold text-white text-center leading-[18px] shadow-md"
            style={{
              top: m.badge.top - 4,
              left: m.badge.left,
              width: 18,
              height: 18,
              backgroundColor: m.color,
              boxShadow: `0 0 0 2px oklch(1 0 0 / 0.9), 0 2px 6px -1px ${rgba(m.color, 0.5)}`,
            }}
          >{m.tag}</span>
        </div>
      ))}
    </>
  )
}

/** 在 host 的 textContent 里按字符偏移定位起止节点，造一个真正的 Range */
function locateTextRange(host: HTMLElement, offset: number, text: string): Range | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null)
  const endTarget = offset + text.length
  let cumul = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const tn = node as Text
    const len = tn.data.length
    if (!startNode && cumul + len > offset) {
      startNode = tn
      startOffset = offset - cumul
    }
    if (startNode && cumul + len >= endTarget) {
      endNode = tn
      endOffset = endTarget - cumul
      break
    }
    cumul += len
  }
  if (!startNode || !endNode) return null
  // 防御 offset 越界
  if (startOffset < 0 || startOffset > startNode.data.length) return null
  if (endOffset < 0 || endOffset > endNode.data.length) return null
  try {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    // 文字内容是否一致（避免 DOM 变过导致错位）
    if (range.toString() !== text) return null
    return range
  } catch {
    return null
  }
}

/** rgb(r g b) / rgb(r, g, b) / oklch(...) → 加 alpha，失败原样返 */
function rgba(color: string, alpha: number): string {
  const m = color.match(/^rgb\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[,\s]+/).filter(Boolean)
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
  }
  if (color.startsWith("oklch(")) {
    return color.replace(/\)$/, ` / ${alpha})`)
  }
  return color
}
