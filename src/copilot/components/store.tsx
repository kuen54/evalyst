"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { CopilotContextRef, PageContext } from "@/copilot/lib/types"
import { CopilotShellProvider } from "@/components/glass/copilot-context"
import { GlassRefractionDefs } from "@/components/glass/glass-refraction-defs"
import { applyRevealCascade, clearRevealCascade } from "./material-reveal-cascade"
import { probeSessionExists } from "./probe-session"

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
  activeSessionId?: string | undefined
  setActiveSessionId: (id?: string) => void
  mounted: boolean
  /** rising-edge 时间戳，供 MaterialRevealOverlay 订阅。0 = 从未开过或刚 mount。 */
  lastOpenedAt: number

  // ---- PR-2：context 共享（默认常开，面板开就生效） ----
  inspectorActive: boolean
  setInspectorActive: (v: boolean) => void
  contexts: CapturedContext[]
  addContext: (c: Omit<CapturedContext, "tag">) => number
  removeContext: (elementKey: string) => void
  clearContexts: () => void
  // copilot 是否正在产出（用于 glow idle/active 切换 + ContextMask 冻结）
  // v0.18.8 P3.B: 读 busy 走窄 hook useCopilotBusy() 不要从 main store 读，
  // 避免 streaming 期间 busy 抖动让所有 useCopilotStore 消费者 re-render。
  // 写仍在 main store（writer 不订阅，无 re-render 影响）。
  setBusy: (v: boolean) => void

  // ---- PR-4: Page Context + route change banner ----
  pageContext: PageContext | null
  setPageContext: (pc: PageContext | null) => void
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
  const [routeChangeBanner, setRouteChangeBannerState] = useState<{ visible: boolean; count: number } | null>(null)
  const [lastOpenedAt, setLastOpenedAt] = useState(0)
  /** 同步追踪当前 open 值。rising edge 检测需要 sync 读，state 是异步的 */
  const openRef = useRef(false)
  useEffect(() => { openRef.current = open }, [open])
  /** 同步追踪当前 width 值，给 setOpen rising edge 在 applyRevealCascade 之前
   *  把 panel 宽度写到 html --copilot-panel-width 上用——cascade 需要在 pre-React-commit
   *  时读到这个值计算 startVw。 */
  const widthRef = useRef(420)
  useEffect(() => { widthRef.current = width }, [width])
  /** contexts 的同步真相源：tag 分配 / 去重 / count 都从这里读，不走 setContexts
   *  updater（updater 在 StrictMode 下双调用，且 React 异步执行无法同步返回结果——
   *  burst 颜色对错 + clearManualContexts 计 0 两个 bug 的共同根因）。 */
  const contextsRef = useRef<CapturedContext[]>([])
  const commitContexts = useCallback((next: CapturedContext[]) => {
    contextsRef.current = next
    setContexts(next)
    try { sessionStorage.setItem(SS_CONTEXTS, JSON.stringify(next)) } catch {}
  }, [])

  // 初始化读 localStorage（SSR safe）
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(LS_OPEN)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydrate; see docs/conventions/react19-hydration.md
      if (savedOpen === "1") setOpenState(true)
      const savedW = localStorage.getItem(LS_WIDTH)
      if (savedW) {
        const n = parseInt(savedW, 10)
        if (!Number.isNaN(n)) setWidthState(clampWidth(n))
      }
      const savedActive = localStorage.getItem(LS_ACTIVE)
      if (savedActive) {
        // Defer setting activeSessionId until probe confirms — a stale id (session
        // deleted server-side, data dir reset, machine swap) would otherwise cause
        // use-chat-stream.ts to GET /api/copilot/sessions/{stale} → 404 noise on every
        // mount. panel.tsx open-handler also cleans up via /sessions list, but only
        // runs after the panel opens; chat-view fires earlier.
        void probeSessionExists(savedActive).then(result => {
          if (result === "exists") setActiveSessionIdState(savedActive)
          else if (result === "not_found") {
            try { localStorage.removeItem(LS_ACTIVE) } catch {}
          }
          // unknown (5xx / network): leave LS, retry on next mount.
        })
      }
      // contexts 存 sessionStorage；刷新保留，关标签页清掉
      const savedCtx = sessionStorage.getItem(SS_CONTEXTS)
      if (savedCtx) {
        try {
          const parsed = JSON.parse(savedCtx) as CapturedContext[]
          if (Array.isArray(parsed)) { contextsRef.current = parsed; setContexts(parsed) }
        } catch { /* noop */ }
      }
    } catch { /* noop */ }
    setMounted(true)
  }, [])

  const setOpen = useCallback((v: boolean) => {
    // Rising edge：在 setOpenState 触发 React re-render（会把 shell.tsx 的 glass
    // 新 inline style 提交到 DOM）之前，先同步把 --reveal-delay 和
    // data-copilot-revealing 写进 DOM，这样 glass transition 启动时就能看到 cascade
    // override（带 delay），而不是先用 shell 的 320ms 0-delay 起跑。
    if (v && !openRef.current) {
      // 先把 panel 宽度写到 html，applyRevealCascade 读这个值决定 wave startVw
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--copilot-panel-width", `${widthRef.current}px`)
      }
      applyRevealCascade()
    } else if (!v && openRef.current) {
      // Falling edge：关面板时如果 cascade 还在 DOM 上（上次打开动效没跑完），
      // 先清掉它让 close 走简单 320ms inline fade，否则 close 会触发反向 staggered 过渡。
      clearRevealCascade()
    }
    setOpenState(prev => {
      if (v && !prev) setLastOpenedAt(performance.now())
      return v
    })
    try { localStorage.setItem(LS_OPEN, v ? "1" : "0") } catch {}
    if (!v) setInspectorActive(false) // 关面板连带退 inspector，不然 hover 高亮框留在屏上
  }, [])

  const toggleOpen = useCallback(() => {
    // Rising/falling edge：见 setOpen 注释
    if (!openRef.current) {
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--copilot-panel-width", `${widthRef.current}px`)
      }
      applyRevealCascade()
    } else {
      clearRevealCascade()
    }
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

  /** 返回实际分配的 tag（已存在则返回它现有的 tag）。inspector 用它给 burst 上色，
   *  不再自己从 stale ref 重算 nextTag —— 保证动画色与落地 chip/mask 色一致。 */
  const addContext = useCallback((c: Omit<CapturedContext, "tag">): number => {
    const cur = contextsRef.current
    const existing = cur.find(x => x.elementKey === c.elementKey)
    if (existing) return existing.tag
    const nextTag = cur.length === 0 ? 1 : Math.max(...cur.map(x => x.tag)) + 1
    commitContexts([...cur, { ...c, tag: nextTag } as CapturedContext])
    return nextTag
  }, [commitContexts])

  const removeContext = useCallback((elementKey: string) => {
    // 不重新编号：保持现有 tag 不变，避免删 #1 后 #2 变色的反直觉行为
    commitContexts(contextsRef.current.filter(x => x.elementKey !== elementKey))
  }, [commitContexts])

  const clearContexts = useCallback(() => {
    commitContexts([])
  }, [commitContexts])

  const setPageContext = useCallback((pc: PageContext | null) => {
    setPageContextState(pc)
  }, [])

  const showRouteChangeBanner = useCallback((count: number) => {
    setRouteChangeBannerState({ visible: true, count })
  }, [])

  const dismissRouteChangeBanner = useCallback(() => {
    setRouteChangeBannerState(null)
  }, [])

  const clearManualContexts = useCallback((): { count: number } => {
    // count 从 ref 同步读，不放进 setContexts updater（StrictMode 双调用 → 第二次
    // prev 已是 []，原实现恒返 0，route-change banner 永不出现）
    const count = contextsRef.current.length
    commitContexts([])
    return { count }
  }, [commitContexts])

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
  // 同时把当前 panel 宽度写到 --copilot-panel-width（包括 resize 时同步更新）——
  // reveal wave overlay 和 cascade 起点公式都要读这个值。
  useEffect(() => {
    if (typeof document === "undefined") return
    const html = document.documentElement
    if (open) {
      html.dataset.copilotOpen = "true"
      html.style.setProperty("--copilot-panel-width", `${width}px`)
    } else {
      delete html.dataset.copilotOpen
      html.style.removeProperty("--copilot-panel-width")
    }
  }, [open, width])

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
    // v0.18.8 P3.B: busy 不进 main store value——读走 useCopilotBusy() 窄 hook
    setBusy,
    // new
    pageContext,
    setPageContext,
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
    // busy 故意不在 deps：避免 busy 抖动重建整个 value，让所有 useCopilotStore 消费者 re-render
    pageContext, setPageContext,
    routeChangeBanner, showRouteChangeBanner, dismissRouteChangeBanner,
    clearManualContexts,
  ])

  /** Glass primitive 通过 useCopilotOpen / useCopilotPanelWidth 消费的最小子集。
   *  domain UI（shadcn primitive / sidebar / 各页 Glass 卡）不再依赖完整 CopilotStore shape。 */
  const shellState = useMemo(() => ({ open, width }), [open, width])

  return (
    <CopilotCtx.Provider value={value}>
      <CopilotShellProvider value={shellState}>
        <CopilotBusyCtx.Provider value={busy}>
          {/* Track B: single shared refraction <filter>, mounted only when the lens is live
              (probe + open + no a11y/inspector gate). Sibling region to GlowOverlay. */}
          <GlassRefractionDefs />
          {children}
        </CopilotBusyCtx.Provider>
      </CopilotShellProvider>
    </CopilotCtx.Provider>
  )
}

// v0.18.8 P3.B: busy 单独 context，避免 streaming 期间 busy 抖动让所有 useCopilotStore
// 消费者重渲染。仅消费 busy 的组件（GlowOverlay / ContextMask）走 useCopilotBusy() 窄 hook。
// 写仍在 useCopilotStore.setBusy（writer 不订阅，无 re-render 影响）。
const CopilotBusyCtx = createContext<boolean>(false)
export function useCopilotBusy(): boolean {
  return useContext(CopilotBusyCtx)
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
  addContext: () => 0,
  removeContext: () => {},
  clearContexts: () => {},
  setBusy: () => {},
  // new
  pageContext: null,
  setPageContext: () => {},
  routeChangeBanner: null,
  showRouteChangeBanner: () => {},
  dismissRouteChangeBanner: () => {},
  clearManualContexts: () => ({ count: 0 }),
}

export function useCopilotStore(): CopilotStore {
  const ctx = useContext(CopilotCtx)
  return ctx ?? NOOP_STORE
}
