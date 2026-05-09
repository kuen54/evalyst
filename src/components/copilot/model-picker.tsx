"use client"

import { useEffect, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useT } from "@/lib/i18n/provider"
import type { ModelConfig, LlmConfig } from "@/lib/llm-config"

interface Props {
  selectedModelId?: string
  onChange: (modelId: string) => void
  /** When true, also require m.vision_capable. Set by chat-view based on circled contexts. */
  requireVision?: boolean
}

export function ModelPicker({ selectedModelId, onChange, requireVision }: Props) {
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

  // Apply vision filter at render time so dropdown shrinks/grows live with circled contexts.
  const visibleModels = requireVision
    ? models.filter(m => m.vision_capable)
    : models
  const selectedModelStillVisible = !!visibleModels.find(m => m.id === selectedModelId)
  const showVisionWarn = requireVision && !!selectedModelId && !selectedModelStillVisible

  if (visibleModels.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground leading-snug">
        {requireVision
          ? t("copilot.model_picker_vision_required")
          : t("copilot.no_model_hint")}{" "}
        <a href="/settings/llm" className="underline hover:text-foreground">{t("copilot.go_settings_llm")}</a>
      </div>
    )
  }

  // base-ui Select.Value 在这个项目里对 select item 的 render label 识别不稳定（会只显示 raw value=model id 而不是 name），
  // 干脆绕开 SelectValue，直接在 trigger 里渲染当前选中模型的显示文本。
  const selected = visibleModels.find(m => m.id === selectedModelId)
  const display = selected
    ? (selected.name || selected.model)
    : t("copilot.model_picker_placeholder")

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={selectedModelId ?? ""}
        onValueChange={v => { if (v) onChange(v) }}
      >
        <SelectTrigger className="h-7 text-[12px] max-w-full">
          <span className="truncate text-left">{display}</span>
        </SelectTrigger>
        <SelectContent>
          {visibleModels.map(m => (
            <SelectItem key={m.id} value={m.id} className="text-[12px]">
              {m.name || m.model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showVisionWarn && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
          {t("copilot.model_picker_vision_required")}
        </div>
      )}
    </div>
  )
}
