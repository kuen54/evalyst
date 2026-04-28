"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useT, useLocale } from "@/lib/i18n/provider"
import { GlassRegular } from "@/components/copilot/shell"
import { formatDate } from "@/lib/i18n/format"
import type { DatasetDef, TaskSchema } from "@/lib/schema/types"

interface DatasetDetail {
  def: DatasetDef
  record_count: number
  sample: Record<string, unknown>[]
}

interface DatasetFull {
  def: DatasetDef
  record_count: number
  records: Record<string, unknown>[]
}

export default function DatasetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const confirm = useConfirm()
  const t = useT()
  const { locale } = useLocale()
  const [data, setData] = useState<DatasetDetail | null>(null)
  const [schemas, setSchemas] = useState<TaskSchema[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [full, setFull] = useState<DatasetFull | null>(null)

  useEffect(() => {
    fetch(`/api/datasets/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: DatasetDetail) => { setData(d); setLoading(false) })
      .catch(() => { setNotFound(true); setLoading(false) })
    fetch("/api/schemas").then(r => r.json()).then(setSchemas)
  }, [id])

  const isSeeded = data?.def.source === "builtin" || id === "boxes" || id === "users"
  const relatedSchemas = useMemo(
    () => schemas.filter(s => s.inputs.some(inp => inp.dataset_id === id)),
    [schemas, id],
  )

  const handleDelete = async () => {
    const refCount = relatedSchemas.length
    const description = [
      refCount > 0
        ? t("settings.datasets.delete_desc_refs", { n: refCount })
        : isSeeded ? "" : t("settings.datasets.delete_desc_irreversible"),
      isSeeded ? t("settings.datasets.delete_desc_seeded_extra") : "",
    ].filter(Boolean).join(" ")

    const ok = await confirm({
      title: t("settings.datasets.delete_title", { name: data?.def.name ?? id }),
      description: description || t("settings.datasets.delete_desc_simple"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(t("settings.datasets.deleted_toast", { name: data?.def.name ?? id }))
      router.push("/settings/datasets")
    } else {
      toast.error(t("common.delete_failed"))
    }
  }

  const handleShowAll = async () => {
    if (full) { setShowAll(true); return }
    const res = await fetch(`/api/datasets/${id}?full=1`)
    if (!res.ok) { toast.error(t("common.load_failed")); return }
    const d = await res.json() as DatasetFull
    setFull(d)
    setShowAll(true)
  }

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>
  if (notFound || !data) return <div className="p-8 text-muted-foreground text-sm">{t("common.not_found_body")}</div>

  const def = data.def
  const recordsToShow = showAll && full ? full.records : data.sample
  const totalCount = data.record_count

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div>
        <Link href="/settings/datasets" className="text-xs text-muted-foreground hover:text-foreground">
          {t("settings.datasets.detail.back")}
        </Link>
        <div className="flex items-start justify-between mt-2 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold">{def.name}</h3>
              <Badge variant="outline" className="text-[11px] font-mono">{def.id}</Badge>
              <Badge variant={isSeeded ? "outline" : "secondary"} className="text-[11px]">
                {isSeeded ? t("common.builtin") : t("common.custom")}
              </Badge>
            </div>
            {def.description && <p className="text-sm text-muted-foreground mt-1">{def.description}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href={`/settings/datasets/${id}/edit`}>
              <Button size="sm">{t("common.edit")}</Button>
            </Link>
            <Button size="sm" variant="outline" onClick={handleDelete}>{t("common.delete")}</Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* 基本信息 */}
      <Section title={t("settings.datasets.detail.basic_info")}>
        <Field label={t("settings.datasets.detail.id_field")}><code className="font-mono text-xs">{def.id_field}</code></Field>
        <Field label={t("settings.datasets.detail.records_count")}>{totalCount}</Field>
        {def.created_at && <Field label={t("settings.datasets.detail.created_at")}>{formatDate(def.created_at, locale)}</Field>}
        <Field label={t("settings.datasets.detail.source")}>{def.source}</Field>
      </Section>

      {/* 字段定义 */}
      <Section title={t("settings.datasets.detail.fields_title", { n: def.fields.length })}>
        <GlassRegular className="p-0 overflow-hidden text-sm text-card-foreground ring-1 ring-foreground/10">
          <table className="text-xs w-full">
            <thead className="bg-muted/50">
              <tr className="text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-normal">{t("settings.datasets.detail.field_key")}</th>
                <th className="px-3 py-1.5 text-left font-normal">{t("settings.datasets.detail.field_type")}</th>
                <th className="px-3 py-1.5 text-left font-normal">{t("settings.datasets.detail.field_label")}</th>
                <th className="px-3 py-1.5 text-left font-normal">{t("settings.datasets.detail.field_description")}</th>
              </tr>
            </thead>
            <tbody>
              {def.fields.map(f => (
                <tr key={f.key} className="border-t">
                  <td className="px-3 py-1.5 font-mono">
                    {f.key}
                    {f.key === def.id_field && <span className="text-muted-foreground ml-1">🔑</span>}
                  </td>
                  <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px] font-mono">{f.type ?? "string"}</Badge></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{f.label ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{f.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassRegular>
      </Section>

      {/* 记录预览 */}
      <Section
        title={showAll
          ? t("settings.datasets.detail.preview_title_full", { sample: recordsToShow.length, total: totalCount })
          : t("settings.datasets.detail.preview_title", { sample: recordsToShow.length, total: totalCount })}
      >
        {!showAll && totalCount > recordsToShow.length && (
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onClick={handleShowAll}
          >{t("settings.datasets.detail.show_all", { n: totalCount })}</button>
        )}
        <GlassRegular className="p-0 overflow-x-auto text-sm text-card-foreground ring-1 ring-foreground/10">
          <table className="text-[11px] w-full">
            <thead className="bg-muted/50">
              <tr className="text-muted-foreground">
                {def.fields.map(f => (
                  <th key={f.key} className="px-2 py-1.5 text-left font-mono font-normal whitespace-nowrap">{f.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recordsToShow.map((r, i) => (
                <tr key={i} className="border-t">
                  {def.fields.map(f => (
                    <td key={f.key} className="px-2 py-1.5 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                      {formatCell(r[f.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </GlassRegular>
      </Section>

      {/* 被引用 */}
      <Section title={t("settings.datasets.detail.refs_title", { n: relatedSchemas.length })}>
        {relatedSchemas.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.datasets.detail.no_refs")}</p>
        ) : (
          <div className="space-y-1">
            {relatedSchemas.map(s => {
              const aliases = s.inputs.filter(i => i.dataset_id === id).map(i => i.alias)
              return (
                <Link key={s.id} href={`/settings/templates/${s.id}`} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/50">
                  <span className="font-medium">{s.label}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{s.id}</Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    alias: {aliases.map(a => <code key={a} className="mx-0.5 font-mono">{a}</code>)}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs text-muted-foreground uppercase tracking-wider">{title}</h4>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground min-w-[80px]">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "string") return v.length > 48 ? v.slice(0, 48) + "…" : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const s = JSON.stringify(v)
    return s.length > 48 ? s.slice(0, 48) + "…" : s
  }
  const s = JSON.stringify(v)
  return s.length > 48 ? s.slice(0, 48) + "…" : s
}
