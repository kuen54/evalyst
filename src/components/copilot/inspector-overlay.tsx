"use client"

import { useEffect, useRef, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import { useCopilotStore, type CapturedContext } from "./store"
import { captureFromElement, KNOWN_CONTEXT_TYPES, collectAncestorChain } from "@/lib/copilot/context-registry"

// Chrome DevTools 风格的 element inspect。
// 捕获成功时播放 burst 动效（外环扩散 + 内核飞向右上角 panel），独立于 GlowOverlay 的 click spawn。

// tag 色（和 context-mask 保持一致的序列）
const TAG_COLORS = [
  "oklch(0.65 0.18 240)",  // blue
  "oklch(0.7 0.22 0)",     // pink
  "oklch(0.68 0.18 160)",  // emerald
  "oklch(0.78 0.18 70)",   // amber
  "oklch(0.62 0.22 290)",  // violet
  "oklch(0.68 0.18 210)",  // sky
]

function colorForTag(tag: number): string {
  return TAG_COLORS[(tag - 1) % TAG_COLORS.length]!
}

interface Burst {
  id: number
  x: number
  y: number
  color: string
  flyDx: number
  flyDy: number
}

export function InspectorOverlay() {
  const t = useT()
  const { inspectorActive, setInspectorActive, addContext, contexts } = useCopilotStore()
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{ type: string; id: string; summary?: string } | null>(null)
  const [bursts, setBursts] = useState<Burst[]>([])
  const [hintCenterPx, setHintCenterPx] = useState<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const burstIdRef = useRef(0)

  // 跟踪中间内容区（<main>）的水平中心，让 hint banner 在 sidebar 和 copilot panel 之间居中，
  // 而不是相对整个 viewport。sidebar 折叠 / copilot panel resize / 窗口 resize 时都会更新。
  useEffect(() => {
    if (!inspectorActive) return
    const main = document.querySelector("main")
    if (!main) return
    const update = () => {
      const r = main.getBoundingClientRect()
      setHintCenterPx(r.left + r.width / 2)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(main)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [inspectorActive])

  useEffect(() => {
    if (!inspectorActive) return
    const body = document.body
    body.classList.add("copilot-inspector-active")
    return () => {
      body.classList.remove("copilot-inspector-active")
      setHoverRect(null)
      setHoverInfo(null)
    }
  }, [inspectorActive])

  useEffect(() => {
    if (!inspectorActive) return

    const isInCopilotUI = (el: Element | null): boolean => {
      if (!el) return false
      return !!el.closest("[data-copilot-panel], [data-copilot-overlay]")
    }

    const pickTargetAt = (x: number, y: number): HTMLElement | null => {
      const stack = document.elementsFromPoint(x, y)
      for (const el of stack) {
        if (isInCopilotUI(el)) continue
        const host = (el as HTMLElement).closest("[data-copilot-context]") as HTMLElement | null
        if (host) return host
        return null
      }
      return null
    }

    const updateHover = () => {
      rafRef.current = null
      const pt = lastPointRef.current
      if (!pt) return
      const host = pickTargetAt(pt.x, pt.y)
      if (!host) {
        setHoverRect(null)
        setHoverInfo(null)
        return
      }
      const type = host.dataset.copilotContext ?? ""
      if (!(KNOWN_CONTEXT_TYPES as readonly string[]).includes(type)) {
        setHoverRect(null)
        setHoverInfo(null)
        return
      }
      setHoverRect(host.getBoundingClientRect())
      setHoverInfo({
        type,
        id: host.dataset.copilotContextId ?? "",
        ...(host.dataset.copilotContextSummary !== undefined ? { summary: host.dataset.copilotContextSummary } : {}),
      })
    }

    const onMove = (e: MouseEvent) => {
      lastPointRef.current = { x: e.clientX, y: e.clientY }
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(updateHover)
    }

    const emitBurst = (x: number, y: number, nextTag: number) => {
      // 优先飞向 chip rail 的右端（新 chip 会出现的位置）；找不到退回 panel 中部
      const rail = document.querySelector<HTMLElement>("[data-copilot-chip-rail]")
      let tx: number
      let ty: number
      if (rail) {
        const rect = rail.getBoundingClientRect()
        tx = rect.right - 12
        ty = rect.top + rect.height / 2
      } else {
        const panel = document.querySelector<HTMLElement>("[data-copilot-panel]")
        const pr = panel?.getBoundingClientRect()
        tx = pr ? pr.left + 12 : window.innerWidth - 40
        ty = pr ? pr.top + pr.height / 2 : window.innerHeight / 2
      }
      const flyDx = Math.round(tx - x)
      const flyDy = Math.round(ty - y)
      const id = ++burstIdRef.current
      setBursts(prev => [...prev, { id, x, y, color: colorForTag(nextTag), flyDx, flyDy }])
      setTimeout(() => {
        setBursts(prev => prev.filter(b => b.id !== id))
      }, 1000)
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (isInCopilotUI(target)) return

      const host = pickTargetAt(e.clientX, e.clientY)
      if (!host) {
        // 点的是空处或纯 UI 控件（没包在 [data-copilot-context] 里）—— 放行，让原生 click 正常工作。
        // 这样用户 inspector 开着也能点 filter、下拉、按钮等页面控件。
        return
      }

      e.preventDefault()
      e.stopPropagation()
      const captured = captureFromElement(host)
      if (!captured) return

      // 检查是否已存在同 context（已选过不应重复播 burst）
      const alreadyPicked = contexts.some(c => c.elementKey === captured.elementKey)
      if (alreadyPicked) return

      const nextTag = contexts.length === 0 ? 1 : Math.max(...contexts.map(c => c.tag)) + 1
      // 收集 host 之外的祖先链（host 自己是 primary，不重复）
      const ancestors = collectAncestorChain(host.parentElement)
      const newCtx: Omit<CapturedContext, "tag"> = {
        type: captured.type,
        id: captured.id,
        extra: { ...(captured.extra ?? {}), ancestors },
        ...(captured.summary !== undefined ? { summary: captured.summary } : {}),
        elementKey: captured.elementKey,
      }
      addContext(newCtx)
      emitBurst(e.clientX, e.clientY, nextTag)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()
        setInspectorActive(false)
      }
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("click", onClick, { capture: true })
    window.addEventListener("keydown", onKey, { capture: true })
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("click", onClick, { capture: true } as EventListenerOptions)
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastPointRef.current = null
    }
  }, [inspectorActive, addContext, setInspectorActive, contexts])

  // burst 可以在 inspector 关闭后仍短暂存在（让动画放完）
  if (!inspectorActive && bursts.length === 0) return null

  const existingKeys = new Set(contexts.map(c => c.elementKey))
  const elementKey = hoverInfo ? `${hoverInfo.type}:${hoverInfo.id}` : null
  const alreadyPicked = elementKey ? existingKeys.has(elementKey) : false

  return (
    <>
      {inspectorActive && (
        <div
          data-copilot-overlay
          className="fixed top-3 -translate-x-1/2 z-[9998]"
          style={{ left: hintCenterPx != null ? `${hintCenterPx}px` : "50%" }}
        >
          <div className="bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary-foreground/70 animate-pulse" />
            <span>{t("copilot.inspector_hint")}</span>
            <button
              className="ml-2 text-[11px] opacity-80 hover:opacity-100 underline-offset-2 hover:underline cursor-pointer"
              onClick={() => setInspectorActive(false)}
            >
              {t("copilot.inspector_exit_hint")}
            </button>
          </div>
        </div>
      )}

      {inspectorActive && hoverRect && hoverInfo && (
        <div
          data-copilot-overlay
          className="fixed pointer-events-none z-[9997] border-2 rounded-sm transition-[top,left,width,height] duration-75"
          style={{
            top: hoverRect.top - 3,
            left: hoverRect.left - 3,
            width: hoverRect.width + 6,
            height: hoverRect.height + 6,
            borderColor: alreadyPicked ? "rgb(251 146 60)" : "rgb(59 130 246)",
            backgroundColor: alreadyPicked ? "rgba(251, 146, 60, 0.10)" : "rgba(59, 130, 246, 0.10)",
            boxShadow: alreadyPicked
              ? "0 0 0 4px rgba(251, 146, 60, 0.15)"
              : "0 0 0 4px rgba(59, 130, 246, 0.15)",
          }}
        >
          <div
            className="absolute -top-6 left-0 text-[10px] font-mono px-1.5 py-0.5 rounded text-white whitespace-nowrap"
            style={{
              backgroundColor: alreadyPicked ? "rgb(251 146 60)" : "rgb(59 130 246)",
            }}
          >
            {alreadyPicked ? t("copilot.inspector_already") + " · " : ""}
            {hoverInfo.type}
            {hoverInfo.summary ? ` · ${hoverInfo.summary.slice(0, 32)}` : ""}
          </div>
        </div>
      )}

      {/* 捕获命中 burst —— 外环扩散 + 内核飞向 panel */}
      {bursts.map(b => (
        <div
          key={b.id}
          data-copilot-overlay
          className="copilot-capture-burst"
          style={{ top: b.y, left: b.x }}
        >
          <span
            className="copilot-capture-ring"
            style={{ ["--capture-color" as string]: b.color }}
          />
          <span
            className="copilot-capture-core"
            style={{
              ["--capture-color" as string]: b.color,
              ["--fly-dx" as string]: `${b.flyDx}px`,
              ["--fly-dy" as string]: `${b.flyDy}px`,
            }}
          />
        </div>
      ))}
    </>
  )
}
