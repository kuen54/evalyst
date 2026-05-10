"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { useT } from "@/lib/i18n/provider"
import { GlassCard } from "@/copilot/components/shell"
import type { ModelConfig, ApiFormat, ModelPricing } from "@/lib/llm-config"
import { buildApiRequest } from "@/lib/llm-client"

type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string }

interface Props {
  entry: ModelConfig
  isDefault: boolean
  onChange: (next: ModelConfig) => void
  onSetDefault: () => void
  onDelete: () => void
}

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD ($)" },
  { value: "CNY", label: "CNY (¥)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "JPY", label: "JPY (¥)" },
]

export function ModelCard({ entry, isDefault, onChange, onSetDefault, onDelete }: Props) {
  const t = useT()
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: "idle" })

  const set = <K extends keyof ModelConfig>(key: K, val: ModelConfig[K]) => {
    onChange({ ...entry, [key]: val })
  }

  const updatePricing = (field: keyof ModelPricing, val: string | number) => {
    const current = entry.pricing ?? { input_per_mtok: 0, output_per_mtok: 0, currency: "USD" }
    onChange({ ...entry, pricing: { ...current, [field]: val } })
  }

  const isAnthropic = entry.api_format === "anthropic"
  const isComplete = !!(entry.base_url && entry.api_key && entry.model)

  const handleTest = async () => {
    setTest({ status: "testing" })
    try {
      const body = isAnthropic
        ? {
            model: entry.model || "claude-3-haiku-20240307",
            max_tokens: 5,
            messages: [{ role: "user", content: "ping" }],
          }
        : {
            model: entry.model || "gpt-4o-mini",
            max_tokens: 5,
            messages: [{ role: "user", content: "ping" }],
            stream: false,
          }
      const req = buildApiRequest(
        { api_format: entry.api_format, base_url: entry.base_url, api_key: entry.api_key },
        body,
      )
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
      })
      if (res.ok) setTest({ status: "ok", message: `HTTP ${res.status}` })
      else {
        const text = await res.text().catch(() => "")
        setTest({ status: "fail", message: `HTTP ${res.status}: ${text.slice(0, 120)}` })
      }
    } catch (e) {
      setTest({ status: "fail", message: (e as Error).message })
    }
  }

  const pricing = entry.pricing

  return (
    <GlassCard >
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>{t("settings.llm.model_name_label")}</Label>
            <Input
              value={entry.name}
              onChange={e => set("name", e.target.value)}
              placeholder={t("settings.llm.model_name_placeholder")}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end">
            {isDefault ? (
              <Badge variant="default" className="text-[11px]">{t("settings.llm.model_default_badge")}</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={onSetDefault} disabled={!isComplete}>
                {t("settings.llm.set_default")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { if (confirm(t("settings.llm.delete_model_confirm"))) onDelete() }}
              className="text-muted-foreground hover:text-destructive"
            >
              {t("settings.llm.delete_model")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("settings.llm.api_format_label")} <span className="text-red-500">*</span></Label>
            <Select value={entry.api_format} onValueChange={v => { if (v) set("api_format", v as ApiFormat) }}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t("settings.llm.format_openai")}</SelectItem>
                <SelectItem value="anthropic">{t("settings.llm.format_anthropic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.llm.model_id_label")} <span className="text-red-500">*</span></Label>
            <Input
              value={entry.model}
              onChange={e => set("model", e.target.value)}
              placeholder={isAnthropic ? "claude-haiku-4-5" : "gpt-4o-mini"}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.llm.base_url_label")} <span className="text-red-500">*</span></Label>
          <Input
            value={entry.base_url}
            onChange={e => set("base_url", e.target.value)}
            placeholder={isAnthropic ? t("settings.llm.base_url_placeholder_anthropic") : t("settings.llm.base_url_placeholder_openai")}
            className="font-mono text-xs h-8"
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.llm.api_key_label")} <span className="text-red-500">*</span></Label>
          <div className="flex gap-2">
            <Input
              type={showKey ? "text" : "password"}
              value={entry.api_key}
              onChange={e => set("api_key", e.target.value)}
              placeholder={isAnthropic ? t("settings.llm.api_key_placeholder_anthropic") : t("settings.llm.api_key_placeholder_openai")}
              className="font-mono text-xs h-8"
              autoComplete="off"
            />
            <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)}>
              {showKey ? t("settings.llm.hide") : t("settings.llm.show")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("settings.llm.default_temperature_label", { value: entry.default_temperature ?? 1 })}</Label>
            <Slider
              value={[entry.default_temperature ?? 1]}
              onValueChange={v => set("default_temperature", Array.isArray(v) ? v[0] : v)}
              min={0}
              max={2}
              step={0.1}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.llm.default_max_tokens_label")}</Label>
            <Input
              type="number"
              value={entry.default_max_tokens ?? 4096}
              onChange={e => set("default_max_tokens", parseInt(e.target.value) || 4096)}
              className="h-8"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={!entry.base_url || !entry.api_key || test.status === "testing"}
          >
            {test.status === "testing" ? t("settings.llm.testing") : t("settings.llm.test_connection")}
          </Button>
          {test.status === "ok" && (
            <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
              {t("settings.llm.conn_ok", { message: test.message ?? "" })}
            </Badge>
          )}
          {test.status === "fail" && (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              ✗ {test.message}
            </Badge>
          )}
          {!isComplete && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              {t("settings.llm.model_incomplete_hint")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 py-1">
          <Checkbox
            id={`copilot-enabled-${entry.id}`}
            checked={!!entry.copilot_enabled}
            onCheckedChange={v => set("copilot_enabled", !!v)}
          />
          <Label htmlFor={`copilot-enabled-${entry.id}`} className="text-[13px] font-normal cursor-pointer">
            {t("settings.llm.copilot_enabled_label")}
          </Label>
          <span className="text-[11px] text-muted-foreground ml-1">
            {t("settings.llm.copilot_enabled_hint")}
          </span>
        </div>

        <div className="flex items-center gap-2 py-1">
          <Checkbox
            id={`vision-capable-${entry.id}`}
            checked={!!entry.vision_capable}
            onCheckedChange={v => set("vision_capable", !!v)}
          />
          <Label htmlFor={`vision-capable-${entry.id}`} className="text-[13px] font-normal cursor-pointer">
            {t("settings.llm.vision_capable_label")}
          </Label>
          <span className="text-[11px] text-muted-foreground ml-1">
            {t("settings.llm.vision_capable_desc")}
          </span>
        </div>

        <Separator />

        <div className="space-y-2">
          <div>
            <Label className="text-sm">{t("settings.llm.pricing_title")}</Label>
            <p className="text-[11px] text-muted-foreground mt-1">{t("settings.llm.pricing_hint_model")}</p>
          </div>
          <div className="grid grid-cols-[minmax(0,90px)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 text-[11px] text-muted-foreground px-1">
            <span>{t("settings.llm.pricing_col_currency")}</span>
            <span>{t("settings.llm.pricing_col_input")}</span>
            <span>{t("settings.llm.pricing_col_output")}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,90px)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
            <Select
              value={pricing?.currency || "USD"}
              onValueChange={v => { if (v) updatePricing("currency", v) }}
            >
              <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value} className="text-[11px]">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={String(pricing?.input_per_mtok ?? 0)}
              onChange={e => updatePricing("input_per_mtok", Number(e.target.value) || 0)}
              className="h-7 text-[11px] text-right"
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              value={String(pricing?.output_per_mtok ?? 0)}
              onChange={e => updatePricing("output_per_mtok", Number(e.target.value) || 0)}
              className="h-7 text-[11px] text-right"
            />
          </div>
        </div>
      </CardContent>
    </GlassCard>
  )
}
