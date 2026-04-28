"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useT } from "@/lib/i18n/provider"
import { GlassCard } from "@/components/copilot/shell"
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
import type { DatasetDef } from "@/lib/schema/types"

export default function SettingsDatasetsPage() {
  const t = useT()
  const [datasets, setDatasets] = useState<DatasetDef[]>([])
  const [loading, setLoading] = useState(true)
  const confirm = useConfirm()

  const fetchAll = () => {
    fetch("/api/datasets").then(r => r.json()).then((d: DatasetDef[]) => {
      setDatasets(d)
      setLoading(false)
    })
  }

  useEffect(() => { fetchAll() }, [])

  useRegisterPageContext(() => ({
    route_type: 'datasets_list',
    path: '/settings/datasets',
    summary: {
      count: datasets.length,
      items: datasets.slice(0, 20).map(d => ({
        id: d.id,
        name: d.name,
        record_count: d.record_count ?? 0,
      })),
    },
    timestamp: new Date().toISOString(),
  }), [datasets])

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: t("settings.datasets.delete_title", { name }),
      description: t("settings.datasets.delete_desc_simple"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(t("settings.datasets.deleted_toast", { name }))
      fetchAll()
    } else {
      toast.error(t("common.delete_failed"))
    }
  }

  if (loading) return <div className="text-muted-foreground py-8">{t("common.loading")}</div>

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <p className="text-sm text-muted-foreground">{t("settings.datasets.intro")}</p>
        <Link href="/settings/datasets/new">
          <Button size="sm">{t("settings.datasets.new_btn")}</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {datasets.map(ds => (
          <Link key={ds.id} href={`/settings/datasets/${ds.id}`} className="block">
            <GlassCard className="transition-colors hover:border-foreground/30 hover:bg-muted/20 h-full">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium leading-snug">{ds.name}</CardTitle>
                <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{ds.id}</div>
              </CardHeader>
              <CardContent className="pb-3 px-4 pt-0 space-y-2">
                {ds.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{ds.description}</p>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {t("settings.datasets.card.id_field")}: <span className="font-mono">{ds.id_field}</span> · {t("settings.datasets.card.fields_count", { n: ds.fields.length })}
                  {ds.record_count != null && <> · {t("settings.datasets.card.records_count", { n: ds.record_count })}</>}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {ds.fields.slice(0, 6).map(f => (
                    <Badge key={f.key} variant="outline" className="text-[10px] font-mono font-normal">
                      {f.key}
                    </Badge>
                  ))}
                  {ds.fields.length > 6 && (
                    <Badge variant="outline" className="text-[10px] font-normal">+{ds.fields.length - 6}</Badge>
                  )}
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    className="text-[11px] text-muted-foreground hover:text-red-500"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handleDelete(ds.id, ds.name) }}
                  >{t("common.delete")}</button>
                </div>
              </CardContent>
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  )
}
