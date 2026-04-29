"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { CopilotContextRef, PageContext } from "@/lib/copilot/types"

// ---------- 全局面板状态 ----------
// 持久化：localStorage 存 open/width/activeSessionId。
// contexts / inspector 是会话周期内状态，不写盘。
// 刷新页面 contexts 保留但 mask 失效（因 DOM 重建，rect 找不回）。

const LS_OPEN = "copilot.panel_open"
const LS_WIDTH = "copilot.panel_width"
const LS_ACTIVE = "copilot.active_session"
const SS_CONTEXTS = "copilot.contexts" // sessionStorage，刷新保留、关标签页清掉

export interface CapturedContext extends CopilotContextRef {
  // elementKey 用于路由/DOM 变化后重新 query 回锚定元素
  elementKey: string // `${type}:${id}`
  // 捕获时的简短摘要（前端展示用，服务端会重新 resolve）
  summary?: string
}

interface CopilotStore {
  open: boolean
  setOpen: (v: boolean) => void
  toggleOpen: () => void
  width: number
  setWidth: (w: number) => void
  activeSessionId?: string
  setActiveSessionId: (id?: string) => void
  mounted: boolean
  /** rising-edge 时间戳，供 MaterialRevealOverlay 订阅。0 = 从未开过或刚 mount。 */
  lastOpenedAt: number

  // ---- PR-2：context 共享（默认常开，面板开就生效） ----
  inspectorActive: boolean
  setInspectorActive: (v: boolean) => void
  contexts: CapturedContext[]
  addContext: (c: Omit<CapturedContext, "tag">) => void
  removeContext: (elementKey: string) => void
  clearContexts: () => void
  // copilot 是否正在产出（用于 glow idle/active 切换）
  busy: boolean
  setBusy: (v: boolean) => void

  // ---- PR-4: Page Context + typing signal + route change banner ----
  pageContext: PageContext | null
  setPageContext: (pc: PageContext | null) => void
  typingSignal: number
  bumpTypingSignal: () => void
  routeChangeBanner: { visible: boolean; count: number } | null
  showRouteChangeBanner: (count: number) => void
  dismissRouteChangeBanner: () => void
  clearManualContexts: () => { count: number }
}

const CopilotCtx = createContext<CopilotStore | null>(null)

function clampWidth(w: number): number {
  return Math.max(360, Math.min(720, Math.round(w)))
}

export function CopilotStoreProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [width, setWidthState] = useState(420)
  const [activeSessionId, setActiveSessionIdState] = useState<string | undefined>(undefined)
  const [mounted, setMounted] = useState(false)
  const [inspectorActive, setInspectorActive] = useState(false)
  const [contexts, setContexts] = useState<CapturedContext[]>([])
  const [busy, setBusy] = useState(false)
  const [pageContext, setPageContextState] = useState<PageContext | null>(null)
  const [typingSignal, setTypingSignalState] = useState(0)
  const [routeChangeBanner, setRouteChangeBannerState] = useState<{ visible: boolean; count: number } | null>(null)
  const [lastOpenedAt, setLastOpenedAt] = useState(0)

  // 初始化读 localStorage（SSR safe）
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(LS_OPEN)
      if (savedOpen === "1") setOpenState(true)
      const savedW = localStorage.getItem(LS_WIDTH)
      if (savedW) {
        const n = parseInt(savedW, 10)
        if (!Number.isNaN(n)) setWidthState(clampWidth(n))
      }
      const savedActive = localStorage.getItem(LS_ACTIVE)
      if (savedActive) setActiveSessionIdState(savedActive)
      // contexts 存 sessionStorage；刷新保留，关标签页清掉
      const savedCtx = sessionStorage.getItem(SS_CONTEXTS)
      if (savedCtx) {
        try {
          const parsed = JSON.parse(savedCtx) as CapturedContext[]
          if (Array.isArray(parsed)) setContexts(parsed)
        } catch { /* noop */ }
      }
    } catch { /* noop */ }
    setMounted(true)
  }, [])

  const setOpen = useCallback((v: boolean) => {
    setOpenState(prev => {
      if (v && !prev) setLastOpenedAt(performance.now())
      return v
    })
    try { localStorage.setItem(LS_OPEN, v ? "1" : "0") } catch {}
    if (!v) setInspectorActive(false) // 关面板连带退 inspector，不然 hover 高亮框留在屏上
  }, [])

  const toggleOpen = useCallback(() => {
    setOpenState(prev => {
      const next = !prev
      if (next && !prev) setLastOpenedAt(performance.now())
      try { localStorage.setItem(LS_OPEN, next ? "1" : "0") } catch {}
      if (!next) setInspectorActive(false)
      return next
    })
  }, [])

  const setWidth = useCallback((w: number) => {
    const clamped = clampWidth(w)
    setWidthState(clamped)
    try { localStorage.setItem(LS_WIDTH, String(clamped)) } catch {}
  }, [])

  const setActiveSessionId = useCallback((id?: string) => {
    setActiveSessionIdState(id)
    try {
      if (id) localStorage.setItem(LS_ACTIVE, id)
      else localStorage.removeItem(LS_ACTIVE)
    } catch {}
  }, [])

  const persistContexts = useCallback((list: CapturedContext[]) => {
    try { sessionStorage.setItem(SS_CONTEXTS, JSON.stringify(list)) } catch {}
  }, [])

  const addContext = useCallback((c: Omit<CapturedContext, "tag">) => {
    setContexts(prev => {
      // 已存在（同 elementKey）不重复，但仍算作"已选"（不加 tag）
      if (prev.some(x => x.elementKey === c.elementKey)) return prev
      const nextTag = prev.length === 0 ? 1 : Math.max(...prev.map(x => x.tag)) + 1
      const next = [...prev, { ...c, tag: nextTag } as CapturedContext]
      persistContexts(next)
      return next
    })
  }, [persistContexts])

  const removeContext = useCallback((elementKey: string) => {
    setContexts(prev => {
      const next = prev.filter(x => x.elementKey !== elementKey)
      // 不重新编号：保持现有 tag 不变，避免删 #1 后 #2 变色的反直觉行为
      persistContexts(next)
      return next
    })
  }, [persistContexts])

  const clearContexts = useCallback(() => {
    setContexts([])
    try { sessionStorage.removeItem(SS_CONTEXTS) } catch {}
  }, [])

  const setPageContext = useCallback((pc: PageContext | null) => {
    setPageContextState(pc)
  }, [])

  // typing signal 内部 debounce 250ms，避免每键盘事件都 setState
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpTypingSignal = useCallback(() => {
    if (typingDebounceRef.current) return
    typingDebounceRef.current = setTimeout(() => {
      setTypingSignalState(n => n + 1)
      typingDebounceRef.current = null
    }, 250)
  }, [])

  // Provider unmount 时清掉在飞的 debounce 计时器，避免 leaked timeout 触发 setState on unmounted。
  useEffect(() => {
    return () => {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current)
        typingDebounceRef.current = null
      }
    }
  }, [])

  const showRouteChangeBanner = useCallback((count: number) => {
    setRouteChangeBannerState({ visible: true, count })
  }, [])

  const dismissRouteChangeBanner = useCallback(() => {
    setRouteChangeBannerState(null)
  }, [])

  const clearManualContexts = useCallback((): { count: number } => {
    let removed = 0
    setContexts(prev => {
      removed = prev.length
      return []
    })
    try { sessionStorage.removeItem(SS_CONTEXTS) } catch {}
    return { count: removed }
  }, [])

  // 全局快捷键：⌘K / Ctrl+K 切换面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        toggleOpen()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleOpen])

  // 面板开启时把 html 节点打标：UI 外壳走 liquid glass 变体，让底部光晕透过壳可见。
  useEffect(() => {
    if (typeof document === "undefined") return
    const html = document.documentElement
    if (open) html.dataset.copilotOpen = "true"
    else delete html.dataset.copilotOpen
  }, [open])

  const value = useMemo<CopilotStore>(() => ({
    open,
    setOpen,
    toggleOpen,
    width,
    setWidth,
    activeSessionId,
    setActiveSessionId,
    mounted,
    lastOpenedAt,
    inspectorActive,
    setInspectorActive,
    contexts,
    addContext,
    removeContext,
    clearContexts,
    busy,
    setBusy,
    // new
    pageContext,
    setPageContext,
    typingSignal,
    bumpTypingSignal,
    routeChangeBanner,
    showRouteChangeBanner,
    dismissRouteChangeBanner,
    clearManualContexts,
  }), [
    open, setOpen, toggleOpen,
    width, setWidth,
    activeSessionId, setActiveSessionId,
    mounted,
    lastOpenedAt,
    inspectorActive,
    contexts, addContext, removeContext, clearContexts,
    busy,
    pageContext, setPageContext,
    typingSignal, bumpTypingSignal,
    routeChangeBanner, showRouteChangeBanner, dismissRouteChangeBanner,
    clearManualContexts,
  ])

  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>
}

// Fallback store returned when useCopilotStore is called outside a provider.
// Keeps shared UI primitives (Dialog / Select / etc.) working in any context
// without forcing callers to wrap hooks in try/catch or conditionals.
const NOOP_STORE: CopilotStore = {
  open: false,
  setOpen: () => {},
  toggleOpen: () => {},
  width: 420,
  setWidth: () => {},
  activeSessionId: undefined,
  setActiveSessionId: () => {},
  mounted: false,
  lastOpenedAt: 0,
  inspectorActive: false,
  setInspectorActive: () => {},
  contexts: [],
  addContext: () => {},
  removeContext: () => {},
  clearContexts: () => {},
  busy: false,
  setBusy: () => {},
  // new
  pageContext: null,
  setPageContext: () => {},
  typingSignal: 0,
  bumpTypingSignal: () => {},
  routeChangeBanner: null,
  showRouteChangeBanner: () => {},
  dismissRouteChangeBanner: () => {},
  clearManualContexts: () => ({ count: 0 }),
}

export function useCopilotStore(): CopilotStore {
  const ctx = useContext(CopilotCtx)
  return ctx ?? NOOP_STORE
}
