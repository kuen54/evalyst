"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useT } from "@/lib/i18n/provider"
import type { Rubric } from "@/lib/schema/types"
import type { ExperimentConfig } from "@/lib/types"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"

const TYPE_LABELS: Record<string, string> = {
  pass_fail: "pass/fail",
  likert_1_5: "1-5",
  score_0_100: "0-100",
}

export default function RubricDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const confirm = useConfirm()
  const t = useT()
  const [rubric, setRubric] = useState<Rubric | null>(null)
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/rubrics/${id}`).then(r => r.ok ? r.json() : null).then(r => { setRubric(r); setLoading(false) })
    fetch(`/api/experiments`).then(r => r.json()).then((all: ExperimentConfig[]) => {
      setExperiments(all.filter(e => e.rubric_id === id))
    })
  }, [id])

  useRegisterPageContext(() => ({
    route_type: 'rubric_detail',
    path: `/settings/rubrics/${id}`,
    summary: rubric ? {
      id: rubric.id,
      name: rubric.name,
      criteria_count: rubric.criteria?.length ?? 0,
      criteria_kinds: rubric.criteria?.map(c => c.type) ?? [],
    } : {},
    timestamp: new Date().toISOString(),
  }), [rubric, id])

  const handleDelete = async () => {
    const refCount = experiments.length
    const ok = await confirm({
      title: t("settings.rubrics.detail.delete_title", { name: rubric?.name ?? id }),
      description: refCount > 0
        ? t("settings.rubrics.detail.delete_desc_refs", { n: refCount })
        : t("settings.rubrics.detail.delete_desc"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/rubrics/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(t("settings.rubrics.form.deleted_toast"))
      router.push("/settings/rubrics")
    } else {
      toast.error(t("common.delete_failed"))
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>
  if (!rubric) return <div className="p-8 text-muted-foreground text-sm">{t("common.not_found_body")}</div>

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/rubrics" className="text-xs text-muted-foreground hover:text-foreground">
          {t("settings.rubrics.detail.back")}
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{rubric.name}</h3>
              <Badge variant="outline" className="text-[11px] font-mono">{rubric.id}</Badge>
              {rubric.source === "builtin" && <Badge variant="outline" className="text-[10px]">builtin</Badge>}
            </div>
            {rubric.description && <p className="text-sm text-muted-foreground mt-1">{rubric.description}</p>}
          </div>
          <div className="flex gap-2">
            <Link href={`/settings/rubrics/${rubric.id}/edit`}>
              <Button size="sm">{t("common.edit")}</Button>
            </Link>
            <Button size="sm" variant="outline" onClick={handleDelete}>{t("common.delete")}</Button>
          </div>
        </div>
      </div>

      <Separator />

      <Section title={t("settings.rubrics.detail.criteria_title", { n: rubric.criteria.length })}>
        <div className="space-y-1">
          {rubric.criteria.map((c, i) => (
            <div key={c.key} className="grid grid-cols-[auto_1fr_2fr_auto] gap-3 text-xs py-2 border-b items-start">
              <Badge variant="outline" className="text-[10px]">#{i + 1}</Badge>
              <div className="flex flex-col gap-0.5">
                <code className="font-mono text-[11px]">{c.key}</code>
                <Badge variant="secondary" className="text-[10px] w-fit">{TYPE_LABELS[c.type] ?? c.type}</Badge>
              </div>
              <div>
                <div className="font-medium">{c.label}</div>
                {c.description && <div className="text-muted-foreground text-[11px] mt-0.5">{c.description}</div>}
              </div>
              <div className="shrink-0">
                {c.required && <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">{t("settings.rubrics.detail.required")}</Badge>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("settings.rubrics.detail.experiments_title", { n: experiments.length })}>
        {experiments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.rubrics.detail.no_experiments")}</p>
        ) : (
          <div className="space-y-1">
            {experiments.slice(0, 20).map(e => (
              <Link key={e.id} href={`/experiments/${e.id}`} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/50">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                {e.run_stats && <span className="text-muted-foreground text-[11px]">{e.run_stats.completed_tasks}/{e.run_stats.total_tasks}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{e.model}</span>
              </Link>
            ))}
            {experiments.length > 20 && <p className="text-xs text-muted-foreground">{t("settings.rubrics.detail.more_experiments", { n: experiments.length - 20 })}</p>}
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
