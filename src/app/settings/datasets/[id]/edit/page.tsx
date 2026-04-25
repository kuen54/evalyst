"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { DatasetFormPage } from "@/components/settings/dataset-form-page"
import { useT } from "@/lib/i18n/provider"
import type { DatasetDef } from "@/lib/schema/types"

interface DatasetFull {
  def: DatasetDef
  record_count: number
  records: Record<string, unknown>[]
}

export default function DatasetEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useT()
  const [data, setData] = useState<DatasetFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/datasets/${id}?full=1`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: DatasetFull) => { setData(d); setLoading(false) })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [id])

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>
  if (notFound || !data) return <div className="p-8 text-muted-foreground text-sm">{t("common.not_found_body")}</div>

  return (
    <div className="space-y-4">
      <Link href={`/settings/datasets/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
        {t("settings.datasets.edit.back")}
      </Link>
      <h3 className="text-base font-semibold">{t("settings.datasets.edit.title", { name: data.def.name })}</h3>
      <DatasetFormPage mode="edit" initial={{ def: data.def, records: data.records }} />
    </div>
  )
}
