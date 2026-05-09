"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { LlmConfig, ModelConfig } from "@/lib/llm-config"
import { StickySaveBar } from "@/components/ui/sticky-save-bar"
import { ModelCard } from "@/components/settings/model-card"
import { useT, useLocale } from "@/lib/i18n/provider"
import { LOCALE_BCP47 } from "@/lib/i18n/types"
import { useRegisterPageContext } from "@/components/copilot/use-page-context"

function randomId(): string {
  return Math.random().toString(36).slice(2, 8)
}

function emptyModel(): ModelConfig {
  return {
    id: randomId(),
    name: "",
    model: "",
    api_format: "openai",
    base_url: "",
    api_key: "",
    default_temperature: 1,
    default_max_tokens: 4096,
  }
}

export default function LlmConfigPage() {
  const t = useT()
  const { locale } = useLocale()
  const [cfg, setCfg] = useState<LlmConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    fetch("/api/llm-config")
      .then(r => r.json())
      .then((c: LlmConfig) => { setCfg(c); setLoading(false) })
  }, [])

  useRegisterPageContext(() => ({
    route_type: 'models_list',
    path: '/settings/llm',
    summary: {
      models: (cfg?.models ?? []).map(m => ({
        id: m.id,
        name: m.name,
        provider: m.api_format,
        copilot_enabled: m.copilot_enabled ?? false,
      })),
    },
    timestamp: new Date().toISOString(),
  }), [cfg])

  if (loading || !cfg) return <div className="text-muted-foreground text-sm py-8">{t("common.loading")}</div>

  const isConfigured = cfg.models.some(m => !!(m.base_url && m.api_key && m.model))
  const hasAnyModel = cfg.models.length > 0

  const updateModel = (idx: number, next: ModelConfig) => {
    const models = cfg.models.slice()
    models[idx] = next
    setCfg({ ...cfg, models })
  }

  const addModel = () => {
    const m = emptyModel()
    const models = [...cfg.models, m]
    setCfg({ ...cfg, models, active_model_id: cfg.active_model_id ?? m.id })
  }

  const deleteModel = (idx: number) => {
    const toRemove = cfg.models[idx]
    const models = cfg.models.filter((_, i) => i !== idx)
    const active = cfg.active_model_id === toRemove.id
      ? models[0]?.id
      : cfg.active_model_id
    setCfg({ ...cfg, models, active_model_id: active })
  }

  const setDefaultModel = (id: string) => {
    setCfg({ ...cfg, active_model_id: id })
  }

  const handleSave = async () => {
    setSaving(true)
    setSavedAt(null)
    const res = await fetch("/api/llm-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    })
    if (res.ok) {
      const saved = await res.json()
      setCfg(saved)
      setSavedAt(new Date())
      toast.success(t("settings.llm.saved_toast"))
    } else {
      toast.error(t("settings.llm.save_fail_toast"))
    }
    setSaving(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {t("settings.llm.intro_full")}
        </p>
        {!hasAnyModel && (
          <div className="mt-3 p-3 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800">
            {t("settings.llm.no_model_warn")}
          </div>
        )}
        {hasAnyModel && !isConfigured && (
          <div className="mt-3 p-3 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800">
            {t("settings.llm.not_configured_warn")}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <Label className="text-sm">{t("settings.llm.models_title")}</Label>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">{t("settings.llm.models_hint")}</p>

        <div className="space-y-3">
          {cfg.models.map((m, i) => (
            <ModelCard
              key={m.id}
              entry={m}
              isDefault={m.id === cfg.active_model_id}
              onChange={next => updateModel(i, next)}
              onSetDefault={() => setDefaultModel(m.id)}
              onDelete={() => deleteModel(i)}
            />
          ))}

          <Button size="sm" variant="outline" onClick={addModel} className="w-full">
            {t("settings.llm.add_model")}
          </Button>
        </div>
      </div>

      <StickySaveBar
        onSave={handleSave}
        submitting={saving}
        saveLabel={t("settings.llm.save_btn")}
      />
      {savedAt && <p className="text-xs text-muted-foreground">{t("settings.llm.saved_at", { time: savedAt.toLocaleTimeString(LOCALE_BCP47[locale]) })}</p>}
    </div>
  )
}
