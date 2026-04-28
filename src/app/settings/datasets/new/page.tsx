"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DATASET_META_PROMPT } from "@/lib/meta-prompts/dataset"
import { MetaPromptPane } from "@/components/settings/meta-prompt-pane"
import { JsonPastePane } from "@/components/settings/json-paste-pane"
import { DatasetFormPage } from "@/components/settings/dataset-form-page"
import { AgentHintBanner } from "@/components/settings/agent-hint-banner"
import { useT } from "@/lib/i18n/provider"
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"

function makeValidate(t: (k: string, v?: Record<string, string | number>) => string) {
  return (parsed: unknown): { ok: boolean; errors: Array<{ field: string; message: string }> } => {
    const errors: Array<{ field: string; message: string }> = []
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, errors: [{ field: "$", message: t("new_res.json_must_be_object") }] }
    }
    const x = parsed as Record<string, unknown>
    if (typeof x.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(x.id)) {
      errors.push({ field: "id", message: t("new_res.id_invalid") })
    }
    if (typeof x.name !== "string" || !x.name) errors.push({ field: "name", message: t("new_res.must_be_nonempty_string") })
    if (typeof x.id_field !== "string" || !x.id_field) errors.push({ field: "id_field", message: t("new_res.must_be_nonempty_string") })
    if (!Array.isArray(x.fields) || x.fields.length === 0) errors.push({ field: "fields", message: t("new_res.fields_at_least_one") })
    if (!Array.isArray(x.records) || x.records.length === 0) errors.push({ field: "records", message: t("new_res.records_at_least_one") })
    return { ok: errors.length === 0, errors }
  }
}

export default function NewDatasetPage() {
  const t = useT()
  useRegisterPageContext(() => ({
    route_type: 'dataset_new',
    path: '/settings/datasets/new',
    summary: {},
    timestamp: new Date().toISOString(),
  }), [])
  return (
    <>
      <AgentHintBanner slashCommand="evalyst-dataset" />
      <Tabs defaultValue="form">
        <TabsList className="mb-4">
          <TabsTrigger value="form">{t("new_res.tab_csv_import")}</TabsTrigger>
          <TabsTrigger value="json">{t("new_res.tab_json")}</TabsTrigger>
        </TabsList>
        <TabsContent value="form">
          <DatasetFormPage />
        </TabsContent>
        <TabsContent value="json">
          <p className="text-xs text-muted-foreground mb-3">
            {t("new_res.json_intro")}
          </p>
          <div className="grid grid-cols-2 gap-6" style={{ height: "calc(100vh - 340px)", minHeight: "500px" }}>
            <MetaPromptPane promptText={DATASET_META_PROMPT} title={t("new_res.copy_prompt_title")} />
            <JsonPastePane
              title={t("new_res.paste_json_title")}
              validate={makeValidate(t)}
              submitEndpoint="/api/datasets"
              onSuccessRedirect={() => "/settings/datasets"}
            />
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}
