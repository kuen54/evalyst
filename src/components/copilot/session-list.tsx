"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import { useGlassStyle } from "@/components/copilot/shell"
import { useCopilotStore } from "@/components/copilot/store"
import { segmentedItem } from "@/lib/segmented"
import type { CopilotSessionMeta } from "@/lib/copilot/types"

interface Props {
  sessions: CopilotSessionMeta[]
  activeSessionId?: string
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** 顶部 session bar：显示当前 session 标题 + 下拉切换 + 新建 + 重命名 + 删除 */
export function SessionList({ sessions, activeSessionId, onSelect, onCreate, onRename, onDelete }: Props) {
  const t = useT()
  const { open: copilotOpen } = useCopilotStore()
  const glassStyle = useGlassStyle("thick")
  const tintedStyle = useGlassStyle("tinted")
  const [listOpen, setListOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [editValue, setEditValue] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const active = sessions.find(s => s.id === activeSessionId)

  // 点击外部关闭列表
  useEffect(() => {
    if (!listOpen) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setListOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [listOpen])

  const startEdit = (s: CopilotSessionMeta) => {
    setEditingId(s.id)
    setEditValue(s.title)
  }

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(undefined)
  }

  const handleDelete = (s: CopilotSessionMeta) => {
    if (!confirm(t("copilot.delete_confirm", { title: s.title }))) return
    onDelete(s.id)
    toast.success(t("copilot.session_deleted_toast"))
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setListOpen(v => !v)}
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent/60 transition-colors text-left"
          title={t("copilot.session_switcher")}
        >
          <span className="truncate text-[12px] text-foreground/90">
            {active?.title ?? t("copilot.no_active_session")}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-muted-foreground shrink-0">
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCreate} title={t("copilot.new_session")}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Button>
      </div>

      {listOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded border border-border bg-popover shadow-md max-h-80 overflow-y-auto" style={copilotOpen ? { ...glassStyle } : undefined} data-glass-variant={copilotOpen ? "thick" : undefined}>
          {sessions.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
              {t("copilot.no_sessions")}
            </div>
          ) : (
            <ul className="py-1">
              {sessions.map(s => (
                <li key={s.id} className="group">
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1 px-2 py-1">
                      <Input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitEdit()
                          if (e.key === "Escape") setEditingId(undefined)
                        }}
                        onBlur={commitEdit}
                        className="h-7 text-[12px]"
                      />
                    </div>
                  ) : (
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded-sm cursor-pointer transition-colors ${segmentedItem(s.id === activeSessionId)}`}
                      style={copilotOpen && s.id === activeSessionId ? tintedStyle : undefined}
                      data-glass-variant={copilotOpen && s.id === activeSessionId ? "tinted" : undefined}
                      onClick={() => {
                        onSelect(s.id)
                        setListOpen(false)
                      }}
                    >
                      <span className="flex-1 truncate text-[12px]">{s.title}</span>
                      <button
                        onClick={e => { e.stopPropagation(); startEdit(s) }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity"
                        title={t("copilot.rename")}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <path d="M1.5 8.5h2l5-5-2-2-5 5v2z" />
                        </svg>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(s) }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-opacity"
                        title={t("copilot.delete")}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <path d="M2 3h6M4 3V2h2v1M3 3l.5 5.5h3L7 3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
