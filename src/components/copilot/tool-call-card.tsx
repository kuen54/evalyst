"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import type { CopilotMessage } from "@/lib/copilot/types"
import { findToolMetadata } from "@/lib/copilot/tool-metadata"

interface Props {
  toolUse: CopilotMessage
  toolResult?: CopilotMessage
  onConfirm: () => void
  onDeny: (reason: string) => void
  pending: boolean
}

/**
 * 在 chat bubble 内渲染单次工具调用。3 个视觉状态：
 *  1. Read tool in-flight（requiresConfirm=false 且无 result） → 单行 loading
 *  2. Write tool awaiting confirmation（requiresConfirm=true 且无 result） → 展开参数 + Confirm/Deny
 *  3. Has result（或 denied） → 折叠一行摘要 + 展开按钮（raw JSON）
 *
 * 设计约束：
 *  - 本组件渲染在 Copilot panel 内，**不走玻璃系统**（panel 明确扁平，见 CLAUDE.md 的 Copilot Glass UI 章节）
 *  - 使用 shadcn `bg-card / bg-muted/...` 实底背景
 *  - i18n key 走 `copilot.tool.*` 命名空间，具体条目由 Task 9 落地到 zh.ts + en.ts
 */
export function ToolCallCard({ toolUse, toolResult, onConfirm, onDeny, pending }: Props) {
  const t = useT()
  const [denyReason, setDenyReason] = useState("")
  const [denyOpen, setDenyOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const toolName = toolUse.tool_name ?? ""
  const toolInput = toolUse.tool_input ?? {}
  const tool = findToolMetadata(toolName)
  const requiresConfirm = tool?.requiresConfirm ?? false

  // === State 3: has result (success or denied) ===
  if (toolResult) {
    const denied = toolResult.denied === true
    let content: unknown = null
    try {
      content = toolResult.content ? JSON.parse(toolResult.content) : null
    } catch {
      /* content 解析失败时保持 null，展开时 fallback 到原始字符串 */
    }
    const summary = denied
      ? t("copilot.tool.denied_summary", { reason: toolResult.reason ?? "" })
      : summarizeResult(content)
    return (
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          denied ? "bg-muted/40 text-muted-foreground" : "bg-muted/20"
        }`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden>{denied ? "🚫" : "✅"}</span>
          <code className="font-mono">{toolName}</code>
          {summary ? <span className="text-muted-foreground">{summary}</span> : null}
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("copilot.tool.collapse") : t("copilot.tool.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </div>
        {expanded && (
          <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap bg-background/60 p-2 rounded max-h-60 overflow-auto">
            {content !== null ? JSON.stringify(content, null, 2) : (toolResult.content ?? "")}
          </pre>
        )}
      </div>
    )
  }

  // === State 1: read tool in-flight ===
  if (!requiresConfirm) {
    return (
      <div className="rounded-md border px-3 py-2 text-xs bg-muted/10">
        <div className="flex items-center gap-2">
          <span aria-hidden>🔍</span>
          <code className="font-mono">{toolName}</code>
          <span className="text-muted-foreground">{t("copilot.tool.loading")}</span>
        </div>
      </div>
    )
  }

  // === State 2: write tool awaiting confirm ===
  return (
    <div className="rounded-md border bg-card px-3 py-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span aria-hidden>⚙️</span>
        <code className="font-mono font-medium">{toolName}</code>
        <Badge variant="outline" className="text-[10px]">
          {t("copilot.tool.requires_confirm")}
        </Badge>
      </div>
      <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-2 rounded max-h-40 overflow-auto">
        {JSON.stringify(toolInput, null, 2)}
      </pre>
      {denyOpen ? (
        <div className="space-y-1.5">
          <Input
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder={t("copilot.tool.deny_reason_placeholder")}
            className="h-7 text-xs"
            disabled={pending}
          />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => onDeny(denyReason)} disabled={pending}>
              {t("copilot.tool.deny_confirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDenyOpen(false)
                setDenyReason("")
              }}
              disabled={pending}
            >
              {t("copilot.tool.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={onConfirm} disabled={pending}>
            {t("copilot.tool.confirm")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDenyOpen(true)} disabled={pending}>
            {t("copilot.tool.deny")}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * 把结果对象压缩成一句话摘要。识别约定：
 *  - { error: ... } → 直接显示 error 字符串
 *  - { triggered: true, message } → 写操作成功，显示 message（fallback "done"）
 *  - { returned, total_matching } → 读操作，显示 "{返回}/{命中}"
 *  - 其他 → 空串（摘要位不显示）
 */
function summarizeResult(content: unknown): string {
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>
    if ("error" in obj) return String(obj.error ?? "")
    if ("triggered" in obj) return String(obj.message ?? "done")
    if (typeof obj.returned === "number" && typeof obj.total_matching === "number") {
      return `${obj.returned}/${obj.total_matching}`
    }
  }
  return ""
}
