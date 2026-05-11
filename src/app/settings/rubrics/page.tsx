"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"
import { GlassCard } from "@/components/glass/shell"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"
import type { Rubric } from "@/lib/schema/types"

const TYPE_LABELS: Record<string, string> = {
  pass_fail: "pass/fail",
  likert_1_5: "1-5",
  score_0_100: "0-100",
}

export default function SettingsRubricsPage() {
  const t = useT()
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/rubrics").then(r => r.json()).then((rs: Rubric[]) => {
      setRubrics(rs)
      setLoading(false)
    })
  }, [])

  useRegisterPageContext(() => ({
    route_type: 'rubrics_list',
    path: '/settings/rubrics',
    summary: {
      count: rubrics.length,
      items: rubrics.slice(0, 20).map(r => ({
        id: r.id,
        name: r.name,
        criteria_count: r.criteria?.length ?? 0,
      })),
    },
    timestamp: new Date().toISOString(),
  }), [rubrics])

  if (loading) return <div className="text-muted-foreground py-8">{t("common.loading")}</div>

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <p className="text-sm text-muted-foreground">{t("settings.rubrics.intro")}</p>
        <Link href="/settings/rubrics/new">
          <Button size="sm">{t("settings.rubrics.new_btn")}</Button>
        </Link>
      </div>

      {rubrics.length === 0 && (
        <p className="text-sm text-muted-foreground py-8">{t("settings.rubrics.empty")}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rubrics.map(r => (
          <Link key={r.id} href={`/settings/rubrics/${r.id}`} className="block">
            <GlassCard className="transition-colors hover:border-foreground/30 hover:bg-muted/20 cursor-pointer h-full">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-snug">{r.name}</CardTitle>
                  {r.source === "builtin" && <Badge variant="outline" className="text-[10px]">builtin</Badge>}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{r.id}</div>
              </CardHeader>
              <CardContent className="pb-3 px-4 pt-0 space-y-2">
                {r.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{r.description}</p>
                )}
                <div className="flex flex-wrap gap-1 pt-1">
                  {r.criteria.map(c => (
                    <Badge key={c.key} variant="outline" className="text-[10px] font-mono font-normal">
                      {c.key} · {TYPE_LABELS[c.type] ?? c.type}
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
