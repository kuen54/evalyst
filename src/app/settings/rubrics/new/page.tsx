"use client"

import { RubricFormPage } from "@/components/settings/rubric-form-page"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"

export default function NewRubricPage() {
  useRegisterPageContext(() => ({
    route_type: 'rubric_new',
    path: '/settings/rubrics/new',
    summary: {},
    timestamp: new Date().toISOString(),
  }), [])
  return <RubricFormPage mode="create" />
}
