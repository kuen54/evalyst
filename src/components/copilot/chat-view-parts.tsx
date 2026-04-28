"use client"

import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { CopilotContextRef } from "@/lib/copilot/types"

/**
 * 聊天视图内部的消息形态。PR-3 扩成 discriminated union，覆盖 tool_use / tool_result：
 *  - user / assistant：有 content 文本，assistant 可能 streaming=true
 *  - tool_use：LLM 发出的工具调用，call_id / tool_name / tool_input 必填
 *  - tool_result：工具执行结果，content 装 JSON string；denied=true 表示用户拒绝
 *
 * tool_use / tool_result 由 chat-view 顶层 map 路由到 ToolCallCard 组件渲染；
 * MessageRow 只处理 user / assistant 两种文本气泡（见 MessageRow 顶部的 narrowing）。
 */
export type UiMessage =
  | { role: "user"; id?: string; content: string; contexts?: CopilotContextRef[]; streaming?: undefined }
  | { role: "assistant"; id?: string; content: string; streaming?: boolean }
  | { role: "tool_use"; id?: string; call_id: string; tool_name: string; tool_input: Record<string, unknown>; streaming?: boolean }
  | { role: "tool_result"; id?: string; call_id: string; tool_name: string; content: string; denied?: boolean; reason?: string }

interface MessageRowProps {
  msg: UiMessage
  editing: boolean
  editDraft: string
  onEditDraftChange: (v: string) => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
  onEditCancel: () => void
  onEditCommit: () => void
}

/** 单条聊天消息：user（primary 色块右对齐）/ assistant（muted 色块左对齐）+ hover 出工具条。
 *  tool_use / tool_result 由 chat-view 顶层路由到 ToolCallCard，这里直接 return null。 */
export function MessageRow({ msg, editing, editDraft, onEditDraftChange, onCopy, onEdit, onDelete, onEditCancel, onEditCommit }: MessageRowProps) {
  const t = useT()
  if (msg.role !== "user" && msg.role !== "assistant") return null
  const isUser = msg.role === "user"
  // 空 assistant 气泡（LLM 这轮只发了 tool_use、没发文本）不渲染空壳；
  // streaming 期间保留以显示 ThinkingDots
  if (msg.role === "assistant" && !msg.streaming && !msg.content) return null
  // 下方 TS 将 msg narrow 到 user | assistant 两支
  const canEdit = isUser && !!msg.id && !msg.streaming
  const canDelete = !!msg.id && !msg.streaming

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[90%] space-y-1.5">
          <Textarea
            value={editDraft}
            onChange={e => onEditDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onEditCommit() }
              if (e.key === "Escape") { e.preventDefault(); onEditCancel() }
            }}
            rows={3}
            autoFocus
            className="text-[13px] resize-none"
          />
          <div className="flex items-center gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onEditCancel}>{t("copilot.edit_cancel")}</Button>
            <Button size="sm" onClick={onEditCommit}>{t("copilot.edit_resend")}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`group flex gap-1.5 items-start ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className={`max-w-[90%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed break-words bg-muted text-foreground border border-border/60`}>
          {msg.content
            ? <MarkdownBody text={msg.content} />
            : msg.streaming ? <ThinkingDots /> : null}
          {msg.streaming && msg.content && <span className="inline-block w-1.5 h-3 ml-0.5 bg-current opacity-60 animate-pulse align-middle" />}
        </div>
      )}
      {isUser && (
        <div className="max-w-[90%] rounded-md px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words bg-primary text-primary-foreground">
          {msg.content}
          {msg.contexts && msg.contexts.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-primary-foreground/20">
              {msg.contexts.map(c => (
                <span
                  key={`${c.type}:${c.id}:${c.tag}`}
                  className="inline-flex items-center gap-0.5 text-[9px] rounded bg-primary-foreground/15 px-1 py-0.5"
                  title={`${c.type}#${c.id}`}
                >
                  <span className="font-bold">#{c.tag}</span>
                  <span className="opacity-80">{c.type}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hover 工具条（消息气泡外侧） */}
      <div className={`flex gap-0.5 items-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "order-first" : ""}`}>
        <IconButton title={t("copilot.copy")} onClick={onCopy}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
            <path d="M2 7V2.5A1 1 0 0 1 3 1.5h4.5" />
          </svg>
        </IconButton>
        {canEdit && (
          <IconButton title={t("copilot.edit_message")} onClick={onEdit}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1.5 10.5h2l6-6-2-2-6 6v2z" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
        {canDelete && (
          <IconButton title={t("copilot.delete_message")} onClick={onDelete} danger>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2 3.5h8M5 3.5V2h2v1.5M3 3.5l.7 7h4.6l.7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  )
}

function IconButton({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded hover:bg-accent text-muted-foreground ${danger ? "hover:text-destructive" : "hover:text-foreground"} transition-colors`}
    >
      {children}
    </button>
  )
}

/** 三个交替弹跳的圆点，用于 LLM 回复未开始前的等待状态（Gemini with thinking 常见 10s+ 静默） */
export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="thinking-dot" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "180ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "360ms" }} />
    </span>
  )
}

/** Assistant 消息走 markdown；code / pre / table 等做基础样式，外层父用 .prose 兼容 tailwind typography。 */
export const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="copilot-md space-y-2 [&_p]:my-0 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:text-[13.5px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-medium [&_hr]:my-2 [&_hr]:border-border/50 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_table]:text-[11px] [&_th]:px-1 [&_th]:py-0.5 [&_td]:px-1 [&_td]:py-0.5 [&_th]:border [&_td]:border [&_th]:border-border/60 [&_td]:border-border/60">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">{children}</a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = typeof className === "string" && className.startsWith("language-")
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>
            }
            return <code className="bg-background/60 border border-border/60 rounded px-1 py-[1px] text-[11.5px] font-mono">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="bg-background/60 border border-border/60 rounded p-2 overflow-x-auto text-[11.5px] font-mono leading-relaxed">{children}</pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
