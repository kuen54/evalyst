"use client"

import { useEffect, useState, use } from "react"
import { useT } from "@/lib/i18n/provider"
import { RubricFormPage } from "@/components/settings/rubric-form-page"
import type { Rubric } from "@/lib/schema/types"

export default function EditRubricPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT()
  const { id } = use(params)
  const [rubric, setRubric] = useState<Rubric | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/rubrics/${id}`).then(r => {
      if (r.status === 404) { setNotFound(true); return null }
      return r.json()
    }).then(r => r && setRubric(r))
  }, [id])

  if (notFound) return <div className="text-muted-foreground py-8">{t("common.not_found")}</div>
  if (!rubric) return <div className="text-muted-foreground py-8">{t("common.loading")}</div>
  return <RubricFormPage mode="edit" initial={rubric} />
}
