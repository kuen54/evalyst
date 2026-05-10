"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { TemplateFormPage } from "@/components/template-builder/template-form-page"
import { useT } from "@/lib/i18n/provider"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"
import type { TaskSchema } from "@/lib/schema/types"

function NewTemplateInner() {
  const t = useT()
  const searchParams = useSearchParams()
  const fromId = searchParams.get("from")
  const [initialSchema, setInitialSchema] = useState<TaskSchema | null>(null)
  const [loading, setLoading] = useState(!!fromId)

  useEffect(() => {
    if (!fromId) return
    fetch(`/api/schemas/${fromId}`)
      .then(r => r.ok ? r.json() : null)
      .then(s => { setInitialSchema(s); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fromId])

  useRegisterPageContext(() => ({
    route_type: 'template_new',
    path: '/settings/templates/new',
    summary: {},
    timestamp: new Date().toISOString(),
  }), [])

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>

  return (
    <TemplateFormPage
      mode="create"
      {...(initialSchema ? { initialSchema } : {})}
      {...(fromId ? { fromId } : {})}
    />
  )
}

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground text-sm">…</div>}>
      <NewTemplateInner />
    </Suspense>
  )
}
