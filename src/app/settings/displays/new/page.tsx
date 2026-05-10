"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DISPLAY_META_PROMPT } from "@/lib/meta-prompts/display"
import { MetaPromptPane } from "@/components/settings/meta-prompt-pane"
import { JsonPastePane } from "@/components/settings/json-paste-pane"
import { DisplayFormPage } from "@/components/settings/display-form-page"
import { useT } from "@/lib/i18n/provider"
import { useRegisterPageContext } from "@/copilot/components/use-page-context"

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
    if (!["table", "grouped_grid", "jsx"].includes(x.mode as string)) {
      errors.push({ field: "mode", message: t("new_res.mode_invalid") })
    }
    if (x.mode === "table") {
      const tbl = x.table as { columns?: unknown[] } | undefined
      if (!tbl || !Array.isArray(tbl.columns) || tbl.columns.length === 0) {
        errors.push({ field: "table.columns", message: t("new_res.at_least_one_column") })
      }
    }
    if (x.mode === "grouped_grid") {
      const g = x.grouped_grid as Record<string, unknown> | undefined
      if (!g) errors.push({ field: "grouped_grid", message: t("new_res.must_exist") })
      else {
        if (!g.primary_group) errors.push({ field: "grouped_grid.primary_group", message: t("new_res.must_exist") })
        if (!g.secondary_group) errors.push({ field: "grouped_grid.secondary_group", message: t("new_res.must_exist") })
        if (!Array.isArray(g.cell_columns) || g.cell_columns.length === 0) {
          errors.push({ field: "grouped_grid.cell_columns", message: t("new_res.at_least_one_column") })
        }
      }
    }
    if (x.mode === "jsx") {
      const j = x.jsx as { source?: unknown } | undefined
      if (!j || typeof j.source !== "string" || !j.source.trim()) {
        errors.push({ field: "jsx.source", message: t("new_res.jsx_source_required") })
      }
    }
    return { ok: errors.length === 0, errors }
  }
}

export default function NewDisplayPage() {
  const t = useT()
  useRegisterPageContext(() => ({
    route_type: 'display_new',
    path: '/settings/displays/new',
    summary: {},
    timestamp: new Date().toISOString(),
  }), [])
  return (
    <Tabs defaultValue="form">
      <TabsList className="mb-4">
        <TabsTrigger value="form">{t("new_res.tab_form")}</TabsTrigger>
        <TabsTrigger value="json">{t("new_res.tab_json")}</TabsTrigger>
      </TabsList>
      <TabsContent value="form">
        <DisplayFormPage />
      </TabsContent>
      <TabsContent value="json">
        <p className="text-xs text-muted-foreground mb-3">
          {t("new_res.display_json_intro")}
        </p>
        <div className="grid grid-cols-2 gap-6" style={{ height: "calc(100vh - 340px)", minHeight: "500px" }}>
          <MetaPromptPane promptText={DISPLAY_META_PROMPT} title={t("new_res.copy_prompt_title")} />
          <JsonPastePane
            title={t("new_res.paste_json_title")}
            validate={makeValidate(t)}
            submitEndpoint="/api/displays"
            onSuccessRedirect={() => "/settings/displays"}
          />
        </div>
      </TabsContent>
    </Tabs>
  )
}
