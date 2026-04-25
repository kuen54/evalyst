"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useT } from "@/lib/i18n/provider"
import type { Display } from "@/lib/schema/types"

export default function SettingsDisplaysPage() {
  const t = useT()
  const [displays, setDisplays] = useState<Display[]>([])
  const [loading, setLoading] = useState(true)
  const confirm = useConfirm()

  const fetchAll = () => {
    fetch("/api/displays").then(r => r.json()).then((d: Display[]) => {
      setDisplays(d)
      setLoading(false)
    })
  }

  useEffect(() => { fetchAll() }, [])

  const modeLabel = (mode: string) => {
    const key = `settings.displays.mode_${mode}`
    const v = t(key)
    return v === key ? mode : v
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: t("settings.displays.delete_title", { name }),
      description: t("settings.displays.delete_desc"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/displays/${id}`, { method: "DELETE" })
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
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t("settings.displays.intro_full_html")}
        </p>
        <Link href="/settings/displays/new">
          <Button size="sm">{t("settings.displays.new_btn")}</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {displays.map(d => (
          <Card key={d.id} className="transition-colors hover:border-foreground/30 hover:bg-muted/20 h-full">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-medium leading-snug">{d.name}</CardTitle>
                <Badge variant={d.source === "builtin" ? "outline" : "secondary"} className="text-[11px] shrink-0">
                  {d.source === "builtin" ? t("settings.displays.builtin_label") : t("settings.displays.custom_label")}
                </Badge>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{d.id}</div>
            </CardHeader>
            <CardContent className="pb-3 px-4 pt-0 space-y-2">
              {d.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{d.description}</p>
              )}
              <div>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {modeLabel(d.mode)}
                </Badge>
              </div>
              {d.source === "user" && (
                <div className="flex justify-end pt-1">
                  <button
                    className="text-[11px] text-muted-foreground hover:text-red-500"
                    onClick={() => handleDelete(d.id, d.name)}
                  >{t("common.delete")}</button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
