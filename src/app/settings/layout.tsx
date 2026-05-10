"use client"

import { useT } from "@/lib/i18n/provider"
import { RelationDiagram } from "@/components/settings/relation-diagram"
import { AgentHintBanner } from "@/components/settings/agent-hint-banner"
import { GlassRegular } from "@/copilot/components/shell"

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="px-6 py-4">
      <GlassRegular className="p-6">
        <h2 className="text-lg font-semibold tracking-tight mb-2">{t("settings.title")}</h2>
        <p className="text-sm text-muted-foreground mb-3">
          {t("settings.intro")}
        </p>

        <AgentHintBanner
          slashCommand="evalyst"
          title={t("app.agent_hint_title")}
          bodyPrefix={t("app.agent_hint_body_prefix")}
          bodySuffix={t("app.agent_hint_body_suffix")}
        />

        <RelationDiagram />

        <div className="border-b border-border mb-6" />

        <div>{children}</div>
      </GlassRegular>
    </div>
  )
}
