"use client"

import type { ReactNode } from "react"
import { Download, Lightbulb } from "lucide-react"
import { GlassWarning } from "@/copilot/components/shell"
import { useT } from "@/lib/i18n/provider"

interface Props {
  slashCommand: string
  /** 可选：覆盖默认标题（默认 `new_res.agent_hint_title`） */
  title?: ReactNode
  /** 可选：覆盖默认正文前缀（默认 `new_res.agent_hint_body_prefix`） */
  bodyPrefix?: ReactNode
  /** 可选：覆盖默认正文后缀（默认 `new_res.agent_hint_body_suffix`） */
  bodySuffix?: ReactNode
}

/**
 * 引导用户优先走 Claude Code + skill 流程。
 * 默认文案聚焦「创建单个资源」；Dashboard / Settings 顶栏可传 title / bodyPrefix / bodySuffix 覆盖。
 */
export function AgentHintBanner({ slashCommand, title, bodyPrefix, bodySuffix }: Props) {
  const t = useT()
  return (
    <GlassWarning className="mb-4 border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/20">
      <div className="flex items-start gap-3 p-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 text-sm">
          <div className="font-medium">{title ?? t("new_res.agent_hint_title")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {bodyPrefix ?? t("new_res.agent_hint_body_prefix")}
            <code className="mx-1 rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              /{slashCommand}
            </code>
            {bodySuffix ?? t("new_res.agent_hint_body_suffix")}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <a
              href={`/api/skills/${slashCommand}`}
              download="SKILL.md"
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-card px-2 py-1 text-foreground hover:bg-amber-500/15 transition-colors"
            >
              <Download className="h-3 w-3" />
              {t("new_res.agent_hint_download")}
            </a>
            <span className="text-muted-foreground">
              {t("new_res.agent_hint_install_hint", { name: slashCommand })}
            </span>
          </div>
        </div>
      </div>
    </GlassWarning>
  )
}
