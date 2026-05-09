"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"
import { GlassCard } from "@/components/copilot/shell"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"
import type { TaskSchema } from "@/lib/schema/types"

export default function SettingsTemplatesPage() {
  const t = useT()
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/schemas").then(r => r.json()).then((s: TaskSchema[]) => {
      setSchemas(s)
      setLoading(false)
    })
  }, [])

  useRegisterPageContext(() => ({
    route_type: 'templates_list',
    path: '/settings/templates',
    summary: {
      count: schemas.length,
      items: schemas.slice(0, 20).map(s => ({
        id: s.id,
        name: s.label ?? s.id,
        version: s.version ?? 1,
      })),
    },
    timestamp: new Date().toISOString(),
  }), [schemas])

  if (loading) return <div className="text-muted-foreground py-8">{t("common.loading")}</div>

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <p className="text-sm text-muted-foreground">{t("settings.templates.intro_full")}</p>
        <Link href="/settings/templates/new">
          <Button size="sm">{t("settings.templates.new_btn")}</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {schemas.map(s => (
          <Link key={s.id} href={`/settings/templates/${s.id}`} className="block">
            <GlassCard className="transition-colors hover:border-foreground/30 hover:bg-muted/20 cursor-pointer h-full">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-snug">{s.label}</CardTitle>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{s.id}</div>
              </CardHeader>
              <CardContent className="pb-3 px-4 pt-0 space-y-2">
                {s.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{s.description}</p>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {t("settings.templates.card_stats", {
                    inputs: s.inputs.length,
                    variables: s.variables.length,
                    dimensions: s.display_dimensions?.length ?? 0,
                  })}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {s.inputs.map(inp => (
                    <Badge key={inp.alias} variant="outline" className="text-[10px] font-mono font-normal">
                      {inp.alias}={inp.dataset_id}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  )
}
