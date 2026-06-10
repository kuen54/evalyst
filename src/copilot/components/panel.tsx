"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n/provider"
import { useCopilotStore } from "./store"
import { SessionList } from "./session-list"
import { ChatView } from "./chat-view"
import { RouteChangeObserver } from "./route-change-observer"
import type { CopilotSessionMeta } from "@/copilot/lib/types"

export function CopilotPanel() {
  const t = useT()
  const { open, setOpen, toggleOpen, width, setWidth, activeSessionId, setActiveSessionId, mounted, contexts, clearContexts } = useCopilotStore()

  const [sessions, setSessions] = useState<CopilotSessionMeta[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [modelId, setModelId] = useState<string | undefined>(undefined)
  const [resizing, setResizing] = useState(false)
  const reloadToastShown = useRef(false)

  useEffect(() => {
    if (!open || sessionsLoaded) return
    // eslint-disable-next-line react-hooks/immutability -- intentional: useCallback declared below; capture is stable for this load-once effect
    refreshSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: load-once on first open; sessionsLoaded gate prevents re-fire
  }, [open, sessionsLoaded])

  const refreshSessions = useCallback(async () => {
    try {
      const r = await fetch("/api/copilot/sessions")
      const d = await r.json() as { sessions: CopilotSessionMeta[] }
      setSessions(d.sessions)
      setSessionsLoaded(true)
      if (!activeSessionId && d.sessions.length > 0) {
        setActiveSessionId(d.sessions[0]!.id)
      } else if (activeSessionId && !d.sessions.find(s => s.id === activeSessionId)) {
        setActiveSessionId(d.sessions[0]?.id)
      }
    } catch {
      toast.error(t("copilot.load_sessions_failed"))
    }
  }, [activeSessionId, setActiveSessionId, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dep change; see docs/conventions/react19-hydration.md
    if (!activeSessionId) { setModelId(undefined); return }
    const s = sessions.find(x => x.id === activeSessionId)
    if (s?.model_id) setModelId(s.model_id)
  }, [activeSessionId, sessions])

  const handleCreate = useCallback(async () => {
    try {
      const r = await fetch("/api/copilot/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      })
      const s = await r.json() as CopilotSessionMeta
      setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
      clearContexts() // 新会话清空上一轮残留圈选；切换到已有会话不清，那是历史浏览语义
    } catch {
      toast.error(t("copilot.create_session_failed"))
    }
  }, [modelId, setActiveSessionId, clearContexts, t])

  const handleRename = useCallback(async (id: string, title: string) => {
    await fetch(`/api/copilot/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/copilot/sessions/${id}`, { method: "DELETE" })
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining[0]?.id)
    }
  }, [activeSessionId, sessions, setActiveSessionId])

  const handlePickModel = useCallback(async (id: string) => {
    setModelId(id)
    if (activeSessionId) {
      await fetch(`/api/copilot/sessions/${activeSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: id }),
      })
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, model_id: id } : s))
    }
  }, [activeSessionId])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX
    const startW = width
    // rAF 合帧：panel 是 main 的 flex 兄弟，每次 setWidth 都让 main 整棵子树
    // relayout + 玻璃全量重绘，mousemove 裸调一拖就是每事件一次整页重排
    let raf: number | null = null
    let lastX = startX
    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        setWidth(startW + (startX - lastX))
      })
    }
    const onUp = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
      setWidth(startW + (startX - lastX))
      setResizing(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const tag = (document.activeElement?.tagName ?? "").toLowerCase()
        if (tag !== "input" && tag !== "textarea") setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  // 首次加载若 sessionStorage 里残留 contexts（说明是刷新场景），提示一次。mask 由 ContextMask 自行处理 DOM 重查询。
  // deps 故意只放 mounted：store init effect 把 setContexts(parsed) + setMounted(true) 同帧批量提交，mounted 翻 true 那次
  // 跑就能读到 hydrated contexts；若把 contexts 也放 deps，新会话首次圈选（contexts 0→1）会误触发这条「刷新提示」。
  useEffect(() => {
    if (!mounted || reloadToastShown.current) return
    reloadToastShown.current = true
    if (contexts.length > 0) {
      toast(t("copilot.context_reload_toast", { n: contexts.length }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上方注释：只在 mount 时读一次 hydrated contexts，后续 add/remove 不重触发
  }, [mounted])

  const effectiveOpen = mounted && open
  const panelWidth = effectiveOpen ? width : 0

  return (
    <>
      <RouteChangeObserver />
      {/* 边缘 Toggle —— 吸附在 panel 左边缘（= main 右边缘）。开/关用同一位置，对称 */}
      {/* 没有 transition：width 过渡 + glow 的 blur 合成每帧 rasterize 21MB 会卡 */}
      {mounted && (
        <button
          onClick={toggleOpen}
          title={effectiveOpen ? t("copilot.close_btn") + "  (⌘K)" : t("copilot.toggle_btn") + "  (⌘K)"}
          style={{ right: `${panelWidth}px` }}
          className="fixed top-1/2 -translate-y-1/2 z-30 h-16 w-6 rounded-l-md bg-primary text-primary-foreground shadow-md hover:w-8 hover:bg-primary/90 flex items-center justify-center"
          aria-label={effectiveOpen ? t("copilot.close_btn") : t("copilot.toggle_btn")}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={effectiveOpen ? "rotate-180" : ""}
          >
            <path d="M8 3L4 6l4 3" />
          </svg>
        </button>
      )}

      <aside
        data-copilot-panel
        className="sticky top-0 h-screen shrink-0 overflow-hidden border-l border-border bg-background flex flex-col"
        style={{ width: `${panelWidth}px` }}
        aria-hidden={!effectiveOpen}
      >
        {effectiveOpen && (
          <div className="copilot-panel-enter flex flex-col h-full">
            <div
              onMouseDown={startResize}
              className={`absolute left-0 top-0 h-full w-1 cursor-col-resize z-10 ${resizing ? "bg-primary/40" : "hover:bg-primary/20"}`}
              title={t("copilot.resize_hint")}
            />

            <div className="flex items-center gap-1 pl-3 pr-2 py-2 border-b border-border/60">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0 pr-1">
                {t("copilot.title")}
              </span>
              <div className="flex-1 min-w-0">
                <SessionList
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelect={setActiveSessionId}
                  onCreate={handleCreate}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              </div>
            </div>

            <ChatView
              sessionId={activeSessionId}
              selectedModelId={modelId}
              onPickModel={handlePickModel}
            />
          </div>
        )}
      </aside>
    </>
  )
}
