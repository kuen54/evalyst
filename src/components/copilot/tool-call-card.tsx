"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useT } from "@/lib/i18n/provider"
import type { CopilotMessage } from "@/lib/copilot/types"
import { findClientToolMetadata, needsConfirm } from "@/lib/copilot/tools/metadata-client"
import { colorForTag } from "./context-mask"

interface Props {
  toolUse: CopilotMessage
  toolResult?: CopilotMessage
  onConfirm: (alwaysAllow: boolean) => void
  onDeny: (reason: string, alwaysDeny: boolean) => void
  pending: boolean
}

type Variant = "context" | "resource" | "retrieval" | "write" | "default"

const VARIANT_BY_TOOL: Record<string, Variant> = {
  read_context: "context",
  read_resource: "resource",
  read_tool_result: "retrieval",
  read_dataset_records: "retrieval",
  edit_template: "write",
  restart_experiment: "write",
}

/**
 * Pick a variant for the tool-call-card based on tool name, falling back
 * to metadata.isDestructive → write, otherwise default.
 */
export function pickVariant(toolName: string): Variant {
  const explicit = VARIANT_BY_TOOL[toolName]
  if (explicit) return explicit
  const meta = findClientToolMetadata(toolName)
  if (meta?.isDestructive) return "write"
  return "default"
}

/**
 * In-chat bubble for a single tool call. Routes to per-variant render to
 * surface semantics:
 *  - `context`  read_context → echo circled #N + scope
 *  - `resource` read_resource → type/id with detail-page link
 *  - `retrieval` read_tool_result → ref rehydration
 *  - `write` destructive tools → amber border + Confirm/Deny + write badge
 *  - `default` other reads → existing summary + expand-raw pattern
 *
 * Design constraints (AGENTS.md Copilot Glass UI):
 *  - copilot panel is flat; no glass here
 *  - use shadcn `bg-card / bg-muted/...` realistic surfaces
 *  - i18n keys under `copilot.tool.*`
 */
export function ToolCallCard({ toolUse, toolResult, onConfirm, onDeny, pending }: Props) {
  const toolName = toolUse.tool_name ?? ""
  const variant = pickVariant(toolName)

  if (variant === "write") {
    return (
      <WriteVariant
        toolUse={toolUse}
        toolResult={toolResult}
        onConfirm={onConfirm}
        onDeny={onDeny}
        pending={pending}
      />
    )
  }

  if (variant === "context") {
    return <ContextVariant toolUse={toolUse} toolResult={toolResult} />
  }

  if (variant === "resource") {
    return <ResourceVariant toolUse={toolUse} toolResult={toolResult} />
  }

  if (variant === "retrieval") {
    return <RetrievalVariant toolUse={toolUse} toolResult={toolResult} />
  }

  return <DefaultVariant toolUse={toolUse} toolResult={toolResult} />
}

// ---------- helpers shared across variants ----------

function parseResultContent(toolResult?: CopilotMessage): unknown {
  if (!toolResult) return null
  try {
    return toolResult.content ? JSON.parse(toolResult.content) : null
  } catch {
    return null
  }
}

/**
 * v2 tool_result content is a ToolResultContent union:
 *   { kind: "inline", value }
 *   { kind: "ref", ref, preview }
 *   { kind: "compacted", summary, ref? }
 *
 * v1 fallback: unwrapped object is returned as-is as displayValue.
 */
function unwrapV2Content(parsed: unknown): { displayValue: unknown; previewText: string | null } {
  if (parsed && typeof parsed === "object" && "kind" in parsed) {
    const p = parsed as { kind: string; value?: unknown; ref?: string; preview?: string; summary?: string }
    if (p.kind === "inline") {
      return {
        displayValue: p.value ?? null,
        previewText: p.value !== undefined ? JSON.stringify(p.value, null, 2) : null,
      }
    }
    if (p.kind === "ref") {
      return {
        displayValue: null,
        previewText: `${p.preview ?? ""}\n\n[Full result available via read_tool_result("${p.ref}")]`,
      }
    }
    if (p.kind === "compacted") {
      return {
        displayValue: null,
        previewText: p.summary ?? "",
      }
    }
  }
  return {
    displayValue: parsed,
    previewText: parsed !== null ? JSON.stringify(parsed, null, 2) : null,
  }
}

/**
 * Compress a result object into a one-line summary. Recognized shapes:
 *  - { error } → string
 *  - { triggered: true, message } → message or "done"
 *  - { returned, total_matching } → per-tool translated counts
 */
function summarizeResult(
  toolName: string,
  content: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>
    if ("error" in obj) return String(obj.error ?? "")
    if ("triggered" in obj) return String(obj.message ?? "done")
    if (typeof obj.returned === "number" && typeof obj.total_matching === "number") {
      const total = obj.total_matching
      if (toolName === "list_experiments") {
        return t("copilot.tool.summary.list_experiments", { total })
      }
      if (toolName === "read_experiment_results") {
        return t("copilot.tool.summary.read_experiment_results", { total })
      }
      return `${obj.returned}/${obj.total_matching}`
    }
  }
  return ""
}

function displayNameFor(
  toolName: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const key = `copilot.tool.name.${toolName}`
  const translated = t(key)
  return translated === key ? toolName : translated
}

function linkForResource(type: string, id: string): string | null {
  switch (type) {
    case "template": return `/settings/templates/${id}`
    case "dataset": return `/settings/datasets/${id}`
    case "display": return `/settings/displays/${id}`
    case "rubric": return `/settings/rubrics/${id}`
    case "experiment": return `/experiments/${id}`
    default: return null
  }
}

// ---------- Default (existing pattern) ----------

function DefaultVariant({ toolUse, toolResult }: { toolUse: CopilotMessage; toolResult?: CopilotMessage }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const toolName = toolUse.tool_name ?? ""
  const requiresConfirm = needsConfirm(toolName)
  const displayName = displayNameFor(toolName, t)

  if (toolResult) {
    const denied = toolResult.denied === true
    const parsed = parseResultContent(toolResult)
    const unwrapped = unwrapV2Content(parsed)
    const summary = denied
      ? t("copilot.tool.denied_summary", { reason: toolResult.reason ?? "" })
      : summarizeResult(toolName, unwrapped.displayValue, t)
    return (
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          denied ? "bg-muted/40 text-muted-foreground" : "bg-muted/20"
        }`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden>{denied ? "🚫" : "✅"}</span>
          <span className="font-medium">{displayName}</span>
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
            {unwrapped.previewText ?? (toolResult.content ?? "")}
          </pre>
        )}
      </div>
    )
  }

  // In-flight read
  if (!requiresConfirm) {
    return (
      <div className="rounded-md border px-3 py-2 text-xs bg-muted/10">
        <div className="flex items-center gap-2">
          <span aria-hidden>🔍</span>
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground">{t("copilot.tool.loading")}</span>
        </div>
      </div>
    )
  }

  // Fallback: write-style awaiting confirm but without explicit variant
  // (shouldn't normally hit — pickVariant routes destructive through WriteVariant).
  return (
    <div className="rounded-md border bg-card px-3 py-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span aria-hidden>⚙️</span>
        <span className="font-medium">{displayName}</span>
      </div>
    </div>
  )
}

// ---------- ContextVariant (read_context) ----------

function ContextVariant({ toolUse, toolResult }: { toolUse: CopilotMessage; toolResult?: CopilotMessage }) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const input = (toolUse.tool_input ?? {}) as { id?: string; scope?: string; tag?: number }
  const scope = input.scope ?? "self"
  // ctx id could be `ctx_N` slug or raw tag; if it starts with `ctx_` we trim the prefix
  // for a compact `#N` badge. Otherwise fallback to the id string.
  const chipNumber = (() => {
    if (typeof input.tag === "number") return String(input.tag)
    const m = (input.id ?? "").match(/^ctx_?(\d+)$/i)
    return m ? m[1] : (input.id ?? "?")
  })()
  const chipTag = Number.isFinite(Number(chipNumber)) ? Number(chipNumber) : 0
  const parsed = parseResultContent(toolResult)
  const unwrapped = unwrapV2Content(parsed)

  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2 text-xs" data-tool-variant="context">
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-4 h-4 rounded-full text-[10px] font-bold text-white text-center leading-4"
          style={{ backgroundColor: chipTag > 0 ? colorForTag(chipTag) : "var(--muted-foreground)" }}
          aria-hidden
        >
          {chipNumber}
        </span>
        <span className="font-medium">{t("copilot.tool.read_context.title")}</span>
        <span className="text-muted-foreground">#{chipNumber}</span>
        <span className="text-muted-foreground">· scope: {scope}</span>
        {toolResult ? (
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("copilot.tool.collapse") : t("copilot.tool.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="ml-auto text-muted-foreground">{t("copilot.tool.loading")}</span>
        )}
      </div>
      {toolResult && expanded && (
        <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap bg-background/60 p-2 rounded max-h-60 overflow-auto">
          {unwrapped.previewText ?? (toolResult.content ?? "")}
        </pre>
      )}
    </div>
  )
}

// ---------- ResourceVariant (read_resource) ----------

function ResourceVariant({ toolUse, toolResult }: { toolUse: CopilotMessage; toolResult?: CopilotMessage }) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const input = (toolUse.tool_input ?? {}) as { type?: string; id?: string; fields?: string[] }
  const type = input.type ?? "?"
  const id = input.id ?? "?"
  const href = linkForResource(type, id)
  const parsed = parseResultContent(toolResult)
  const unwrapped = unwrapV2Content(parsed)

  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2 text-xs" data-tool-variant="resource">
      <div className="flex items-center gap-2 flex-wrap">
        <span aria-hidden>🔗</span>
        <span className="font-medium">{t("copilot.tool.read_resource.title")}</span>
        <span className="text-muted-foreground">{type}/</span>
        {href ? (
          <a href={href} className="text-foreground underline underline-offset-2 hover:text-primary">
            {id}
          </a>
        ) : (
          <span className="text-foreground">{id}</span>
        )}
        {input.fields && input.fields.length > 0 && (
          <span className="text-muted-foreground">· fields: {input.fields.join(", ")}</span>
        )}
        {toolResult ? (
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("copilot.tool.collapse") : t("copilot.tool.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="ml-auto text-muted-foreground">{t("copilot.tool.loading")}</span>
        )}
      </div>
      {toolResult && expanded && (
        <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap bg-background/60 p-2 rounded max-h-60 overflow-auto">
          {unwrapped.previewText ?? (toolResult.content ?? "")}
        </pre>
      )}
    </div>
  )
}

// ---------- RetrievalVariant (read_tool_result) ----------

function RetrievalVariant({ toolUse, toolResult }: { toolUse: CopilotMessage; toolResult?: CopilotMessage }) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const input = (toolUse.tool_input ?? {}) as { ref?: string }
  const refStr = input.ref ?? "?"
  // extract tr_xxx from ref://tool-result/tr_xxx
  const shortRef = (() => {
    const m = refStr.match(/tool-result\/(.+)$/)
    return m ? m[1] : refStr
  })()
  const parsed = parseResultContent(toolResult)
  const unwrapped = unwrapV2Content(parsed)

  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2 text-xs" data-tool-variant="retrieval">
      <div className="flex items-center gap-2">
        <span aria-hidden>↻</span>
        <span className="font-medium">{t("copilot.tool.read_tool_result.title")}</span>
        <span className="text-muted-foreground font-mono text-[10px]">{shortRef}</span>
        {toolResult ? (
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("copilot.tool.collapse") : t("copilot.tool.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="ml-auto text-muted-foreground">{t("copilot.tool.loading")}</span>
        )}
      </div>
      {toolResult && expanded && (
        <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap bg-background/60 p-2 rounded max-h-60 overflow-auto">
          {unwrapped.previewText ?? (toolResult.content ?? "")}
        </pre>
      )}
    </div>
  )
}

// ---------- WriteVariant (destructive + confirm-gated) ----------

function WriteVariant({ toolUse, toolResult, onConfirm, onDeny, pending }: Props) {
  const t = useT()
  const [denyReason, setDenyReason] = useState("")
  const [denyOpen, setDenyOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  const [alwaysDeny, setAlwaysDeny] = useState(false)

  const toolName = toolUse.tool_name ?? ""
  const toolInput = (toolUse.tool_input ?? {}) as Record<string, unknown>
  const displayName = displayNameFor(toolName, t)

  // After execution: show result with amber accent retained.
  if (toolResult) {
    const denied = toolResult.denied === true
    const parsed = parseResultContent(toolResult)
    const unwrapped = unwrapV2Content(parsed)
    const summary = denied
      ? t("copilot.tool.denied_summary", { reason: toolResult.reason ?? "" })
      : summarizeResult(toolName, unwrapped.displayValue, t)
    return (
      <div
        className={`rounded-md border-2 px-3 py-2 text-xs ${
          denied ? "border-border bg-muted/40 text-muted-foreground" : "border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/20"
        }`}
        data-tool-variant="write"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden>{denied ? "🚫" : "✅"}</span>
          <span className="font-medium">{displayName}</span>
          <Badge variant="outline" className="text-[10px] border-amber-500/60">
            {t("copilot.tool.write.badge")}
          </Badge>
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
            {unwrapped.previewText ?? (toolResult.content ?? "")}
          </pre>
        )}
      </div>
    )
  }

  // Awaiting confirm: amber border, write badge, payload preview, Confirm/Deny.
  return (
    <div
      className="rounded-md border-2 border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-3 text-xs space-y-2"
      data-tool-variant="write"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>⚠️</span>
        <span className="font-medium">{displayName}</span>
        <Badge variant="outline" className="text-[10px] border-amber-500/60">
          {t("copilot.tool.write.badge")}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {t("copilot.tool.requires_confirm")}
        </Badge>
      </div>
      <WritePayloadPreview toolName={toolName} toolInput={toolInput} />
      {denyOpen ? (
        <div className="space-y-1.5">
          <Input
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder={t("copilot.tool.deny_reason_placeholder")}
            className="h-7 text-xs"
            disabled={pending}
          />
          <div className="flex items-start gap-2">
            <Checkbox
              id={`always-deny-${toolUse.call_id ?? toolUse.id}`}
              checked={alwaysDeny}
              onCheckedChange={(v) => setAlwaysDeny(v === true)}
              disabled={pending}
            />
            <label
              htmlFor={`always-deny-${toolUse.call_id ?? toolUse.id}`}
              className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none"
              title={t("copilot.tool.always_deny_hint")}
            >
              {t("copilot.tool.always_deny")}
            </label>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => onDeny(denyReason, alwaysDeny)} disabled={pending}>
              {t("copilot.tool.deny_confirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDenyOpen(false)
                setDenyReason("")
                setAlwaysDeny(false)
              }}
              disabled={pending}
            >
              {t("copilot.tool.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 mt-3 mb-2">
            <Checkbox
              id={`always-allow-${toolUse.call_id ?? toolUse.id}`}
              checked={alwaysAllow}
              onCheckedChange={(v) => setAlwaysAllow(v === true)}
            />
            <label
              htmlFor={`always-allow-${toolUse.call_id ?? toolUse.id}`}
              className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none"
              title={t("copilot.tool.always_allow_hint")}
            >
              {t("copilot.tool.always_allow")}
            </label>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => onConfirm(alwaysAllow)} disabled={pending}>
              {t("copilot.tool.confirm")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDenyOpen(true)} disabled={pending}>
              {t("copilot.tool.deny")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Per-tool payload preview for the confirm stage.
 *  - `edit_template` shows the patch (what fields will change)
 *  - `restart_experiment` highlights task_ids (which tasks will re-run)
 *  - other destructive tools fall back to the raw JSON input
 */
function WritePayloadPreview({
  toolName,
  toolInput,
}: {
  toolName: string
  toolInput: Record<string, unknown>
}) {
  if (toolName === "edit_template") {
    const patch = (toolInput.patch ?? {}) as Record<string, unknown>
    const schemaId = String(toolInput.schema_id ?? "")
    return (
      <div className="space-y-1">
        {schemaId && (
          <div className="text-muted-foreground">
            schema_id: <span className="text-foreground font-mono">{schemaId}</span>
          </div>
        )}
        <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-2 rounded max-h-40 overflow-auto">
{JSON.stringify(patch, null, 2)}
        </pre>
      </div>
    )
  }
  if (toolName === "restart_experiment") {
    const expId = String(toolInput.experiment_id ?? "")
    const taskIds = Array.isArray(toolInput.task_ids) ? toolInput.task_ids as string[] : []
    return (
      <div className="space-y-1">
        {expId && (
          <div className="text-muted-foreground">
            experiment_id: <span className="text-foreground font-mono">{expId}</span>
          </div>
        )}
        <div className="text-muted-foreground">
          task_ids ({taskIds.length}):{" "}
          <span className="text-foreground font-mono">
            {taskIds.length === 0 ? "(all)" : taskIds.join(", ")}
          </span>
        </div>
      </div>
    )
  }
  return (
    <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-2 rounded max-h-40 overflow-auto">
{JSON.stringify(toolInput, null, 2)}
    </pre>
  )
}
