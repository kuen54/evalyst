"use client"

import { use, useEffect, useState } from "react"
import { TemplateFormPage } from "@/components/template-builder/template-form-page"
import { useT } from "@/lib/i18n/provider"
import type { TaskSchema } from "@/lib/schema/types"

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useT()
  const [schema, setSchema] = useState<TaskSchema | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/schemas/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(s => { setSchema(s); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-muted-foreground text-sm">{t("common.loading")}</div>
  if (!schema) return <div className="p-8 text-muted-foreground text-sm">{t("common.not_found_body")}</div>

  const readOnly = false

  return <TemplateFormPage mode="edit" initialSchema={schema} readOnly={readOnly} />
}
