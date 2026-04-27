"use client"

import { useEffect, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useT } from "@/lib/i18n/provider"
import type { ModelConfig, LlmConfig } from "@/lib/llm-config"

interface Props {
  selectedModelId?: string
  onChange: (modelId: string) => void
}

export function ModelPicker({ selectedModelId, onChange }: Props) {
  const t = useT()
  const [models, setModels] = useState<ModelConfig[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/llm-config")
      .then(r => r.json())
      .then((cfg: LlmConfig) => {
        setModels((cfg.models ?? []).filter(m => m.copilot_enabled && m.base_url && m.api_key))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return <div className="text-[11px] text-muted-foreground">{t("common.loading")}</div>
  }

  if (models.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground leading-snug">
        {t("copilot.no_model_hint")}{" "}
        <a href="/settings/llm" className="underline hover:text-foreground">{t("copilot.go_settings_llm")}</a>
      </div>
    )
  }

  // base-ui Select.Value 在这个项目里对 select item 的 render label 识别不稳定（会只显示 raw value=model id 而不是 name），
  // 干脆绕开 SelectValue，直接在 trigger 里渲染当前选中模型的显示文本。
  const selected = models.find(m => m.id === selectedModelId)
  const display = selected
    ? (selected.name || selected.model)
    : t("copilot.model_picker_placeholder")

  return (
    <Select
      value={selectedModelId ?? ""}
      onValueChange={v => { if (v) onChange(v) }}
    >
      <SelectTrigger className="h-7 text-[12px] max-w-full">
        <span className="truncate text-left">{display}</span>
      </SelectTrigger>
      <SelectContent>
        {models.map(m => (
          <SelectItem key={m.id} value={m.id} className="text-[12px]">
            {m.name || m.model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
