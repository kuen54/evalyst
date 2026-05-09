"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useT } from "@/lib/i18n/provider"
import { GlassRegular, GlassCard } from "@/components/copilot/shell"
import type { TaskSchema, DatasetDef, Display } from "@/lib/schema/types"
import type { ExperimentConfig } from "@/lib/types"
import { inferDisplayBuiltinId } from "@/lib/display-inference"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"

export default function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const confirm = useConfirm()
  const t = useT()
  const [schema, setSchema] = useState<TaskSchema | null>(null)
  const [datasets, setDatasets] = useState<DatasetDef[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [experiments, setExperiments] = useState<ExperimentConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/schemas/${id}`).then(r => r.ok ? r.json() : null).then(s => { setSchema(s); setLoading(false) })
    fetch("/api/datasets").then(r => r.json()).then(setDatasets)
    fetch("/api/displays").then(r => r.json()).then(setDisplays)
    fetch(`/api/experiments?schema_id=${id}`).then(r => r.json()).then(setExperiments)
  }, [id])

  useRegisterPageContext(() => ({
    route_type: 'template_detail',
    path: `/settings/templates/${id}`,
    summary: schema ? {
      id: schema.id,
      name: schema.label ?? schema.id,
      version: schema.version ?? 1,
      input_aliases: schema.inputs?.map(i => i.alias) ?? [],
      output_field_names: Object.keys(schema.output_schema?.properties ?? {}),
      prompt_length: (schema.default_prompt ?? '').length,
    } : {},
    timestamp: new Date().toISOString(),
  }), [schema, id])

  const handleDelete = async () => {
    const refCount = experiments.length
    const ok = await confirm({
      title: t("settings.templates.delete_title_schema", { name: schema?.label ?? id }),
      description: refCount > 0
        ? t("settings.templates.delete_desc_refs", { n: refCount })
        : t("settings.templates.delete_desc_builtin"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/schemas/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(t("settings.templates.deleted_toast", { name: schema?.label ?? id }))
      router.push("/settings/templates")
    } else {
      toast.error(t("common.delete_failed"))
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>
  if (!schema) return <div className="p-8 text-muted-foreground text-sm">{t("common.not_found_body")}</div>

  const inferredId = inferDisplayBuiltinId(schema)
  const effectiveDisplayId = schema.display_id || inferredId
  const effectiveDisplay = displays.find(d => d.id === effectiveDisplayId)

  return (
    <div
      className="space-y-6"
      data-copilot-context="template"
      data-copilot-context-id={schema.id}
      data-copilot-context-summary={schema.label ?? schema.id}
    >
      {/* 头部 */}
      <div>
        <Link href="/settings/templates" className="text-xs text-muted-foreground hover:text-foreground">
          {t("settings.templates.detail.back")}
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{schema.label}</h3>
              <Badge variant="outline" className="text-[11px] font-mono">{schema.id}</Badge>
            </div>
            {schema.description && <p className="text-sm text-muted-foreground mt-1">{schema.description}</p>}
          </div>
          <div className="flex gap-2">
            <Link href={`/settings/templates/new?from=${schema.id}`}>
              <Button size="sm" variant="outline">{t("settings.templates.detail.copy_btn")}</Button>
            </Link>
            <Link href={`/settings/templates/${schema.id}/edit`}>
              <Button size="sm">{t("common.edit")}</Button>
            </Link>
            <Button size="sm" variant="outline" onClick={handleDelete}>{t("common.delete")}</Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* 基本信息 */}
      <Section title={t("settings.templates.detail.basic_info")}>
        <Field label={t("common.id")}><code className="text-xs">{schema.id}</code></Field>
        <Field label={t("settings.templates.detail.version")}>{schema.version}</Field>
        {schema.compare_group && <Field label={t("settings.templates.detail.compare_group")}><code className="text-xs">{schema.compare_group}</code></Field>}
      </Section>

      {/* Inputs */}
      <Section title={t("settings.templates.detail.inputs_title", { n: schema.inputs.length })}>
        {schema.inputs.map((inp, i) => {
          const ds = datasets.find(d => d.id === inp.dataset_id)
          return (
            <GlassRegular key={i} className="p-3 space-y-1.5 text-sm text-card-foreground overflow-hidden">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">{inp.alias}</Badge>
                <span className="text-sm">{ds?.name ?? inp.dataset_id}</span>
                <Badge variant="outline" className="text-[10px] font-mono">{inp.dataset_id}</Badge>
              </div>
              {inp.dedupe_by?.length && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Dedupe by: </span>
                  {inp.dedupe_by.map(f => <code key={f} className="mr-1">{f}</code>)}
                </div>
              )}
              {inp.hard_filter && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Hard filter: </span>
                  <code>{inp.hard_filter.field} = {String(inp.hard_filter.equals)}</code>
                </div>
              )}
              {inp.filters && inp.filters.length > 0 && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Filters: </span>
                  {inp.filters.map((f, j) => <Badge key={j} variant="outline" className="text-[10px] mr-1">{f.kind}: {f.key}</Badge>)}
                </div>
              )}
            </GlassRegular>
          )
        })}
      </Section>

      {/* Variables */}
      <Section title={t("settings.templates.detail.variables_title", { n: schema.variables.length })}>
        {schema.variables.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.templates.detail.no_variables")}</p>
        ) : (
          <div className="space-y-1">
            {schema.variables.map((v, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs py-1 border-b">
                <code className="font-mono">{v.name}</code>
                <code className="font-mono text-muted-foreground">{v.source}</code>
                <div>
                  {v.transform?.length ? <Badge variant="outline" className="text-[9px]">{t("settings.templates.detail.n_transforms", { n: v.transform.length })}</Badge> : null}
                  {v.fallback && <span className="text-[10px] text-muted-foreground ml-1">fallback: {v.fallback}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Prompt */}
      <Section title={t("settings.templates.detail.prompt_title")}>
        <GlassCard><CardContent className="pt-4">
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">{schema.default_prompt}</pre>
        </CardContent></GlassCard>
        {schema.message_builder.user_template && (
          <div className="text-xs">
            <span className="text-muted-foreground">{t("settings.templates.detail.user_prefix")}</span>
            <code>{schema.message_builder.user_template}</code>
          </div>
        )}
        {schema.message_builder.image && (
          <div className="text-xs">
            <span className="text-muted-foreground">{t("settings.templates.detail.image_prefix")}</span>
            <code>{schema.message_builder.image.field}</code>
          </div>
        )}
      </Section>

      {/* Output */}
      <Section title={t("settings.templates.detail.output_title")}>
        <div className="space-y-0.5">
          {Object.entries(schema.output_schema.properties ?? {}).map(([name, p]) => (
            <div key={name} className="grid grid-cols-[1fr_120px_60px] gap-2 text-xs py-1">
              <code className="font-mono">{name}</code>
              <Badge variant="outline" className="text-[10px] justify-self-start">{p.type}</Badge>
              {(schema.output_schema.required ?? []).includes(name) && <Badge variant="secondary" className="text-[10px]">{t("settings.templates.detail.required_badge")}</Badge>}
            </div>
          ))}
        </div>
      </Section>

      {/* Display dimensions */}
      <Section title={t("settings.templates.detail.dimensions_title", { n: schema.display_dimensions?.length ?? 0 })}>
        {schema.display_dimensions?.length ? (
          <div className="space-y-1">
            {schema.display_dimensions.map((d, i) => (
              <div key={i} className="text-xs py-1 border-b">
                <Badge variant="outline" className="text-[10px] mr-2">#{i}</Badge>
                <code className="font-mono">{d.field}</code>
                {d.label && <span className="text-muted-foreground ml-2">{d.label}</span>}
                {d.value_labels && <Badge variant="outline" className="text-[9px] ml-2">{t("settings.templates.detail.n_labels", { n: Object.keys(d.value_labels).length })}</Badge>}
                {d.order && <Badge variant="outline" className="text-[9px] ml-1">{t("settings.templates.detail.ordered")}</Badge>}
                {d.header_fields && d.header_fields.length > 0 && (
                  <Badge variant="outline" className="text-[9px] ml-1">{t("settings.templates.detail.n_header", { n: d.header_fields.length })}</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("settings.templates.detail.no_dimensions")}</p>
        )}
        <div className="text-xs bg-muted/50 p-2 rounded">
          <span className="text-muted-foreground">{t("settings.templates.detail.inferred_display")}</span>
          <code className="font-mono">{inferredId}</code>
          {schema.display_id && (
            <>
              <span className="text-muted-foreground ml-3">{t("settings.templates.detail.overridden_as")}</span>
              <code className="font-mono">{schema.display_id}</code>
            </>
          )}
          {effectiveDisplay && <span className="text-muted-foreground ml-2">· {effectiveDisplay.name}</span>}
        </div>
      </Section>

      {/* 关联实验 */}
      <Section title={t("settings.templates.detail.experiments_title", { n: experiments.length })}>
        {experiments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.templates.detail.no_experiments")}</p>
        ) : (
          <div className="space-y-1">
            {experiments.slice(0, 10).map(e => (
              <Link key={e.id} href={`/experiments/${e.id}`} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/50">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                {e.run_stats && <span className="text-muted-foreground text-[11px]">{e.run_stats.completed_tasks}/{e.run_stats.total_tasks}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{e.model}</span>
              </Link>
            ))}
            {experiments.length > 10 && <p className="text-xs text-muted-foreground">{t("settings.templates.detail.more_experiments", { n: experiments.length - 10 })}</p>}
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
