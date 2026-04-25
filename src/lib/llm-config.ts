// ---------- LLM 全局配置（模型列表） ----------
// 敏感字段（url / key / model）不内置默认值——用户必须显式配置，避免误用预置 key。

import fs from 'fs'
import path from 'path'
import { ensureDir, writeAtomic } from './fs-utils'

// 惰性解析：每次调用都按当前 process.cwd() 重新计算，便于测试 chdir。
// 生产环境 cwd 固定，无副作用。
function configDir() { return path.join(process.cwd(), 'data') }
function configPath() { return path.join(configDir(), 'llm-config.json') }

export type ApiFormat = 'openai' | 'anthropic'

export interface ModelPricing {
  input_per_mtok: number    // 单价（单位见 currency，每 1M input tokens）
  output_per_mtok: number   // 单价（单位见 currency，每 1M output tokens）
  currency?: string         // 'USD' | 'CNY' | 其他 ISO 4217 code；省略默认 'USD'
}

/** 单个可用的「模型」：一条完整的可调用配置（模型标识 + endpoint + key + 默认参数 + 定价） */
export interface ModelConfig {
  id: string                     // slug，稳定引用；nanoid(6) 或迁移保留的 'default'
  name: string                   // 展示名（可留空；UI fallback 用 model）
  model: string                  // 模型标识，如 'gpt-4o-mini' / 'claude-haiku-4-5' / 'deepseek-chat'
  api_format: ApiFormat
  base_url: string
  api_key: string
  default_temperature?: number
  default_max_tokens?: number
  pricing?: ModelPricing         // 该模型的定价（单条）
}

export interface LlmConfig {
  models: ModelConfig[]
  active_model_id?: string       // 新建实验时默认选中；为空取 models[0]
}

const EMPTY: LlmConfig = {
  models: [],
  active_model_id: undefined,
}

// 老单例 shape
type LegacyV1 = {
  api_format?: ApiFormat
  base_url?: string
  api_key?: string
  default_model?: string
  default_temperature?: number
  default_max_tokens?: number
  pricing?: Record<string, ModelPricing>
}

// 中间版 providers shape
type LegacyV2Provider = {
  id: string
  name: string
  api_format: ApiFormat
  base_url: string
  api_key: string
  default_model: string
  default_temperature?: number
  default_max_tokens?: number
  pricing?: Record<string, ModelPricing>
}
type LegacyV2 = {
  providers?: LegacyV2Provider[]
  active_provider_id?: string
  pricing?: Record<string, ModelPricing>
}

function migrate(parsed: unknown): LlmConfig {
  const raw = (parsed ?? {}) as Partial<LlmConfig> & LegacyV1 & LegacyV2

  // 已经是新 shape
  if (Array.isArray(raw.models)) {
    return { ...EMPTY, active_model_id: raw.active_model_id, models: raw.models }
  }

  // 中间版：providers → models（每个 provider 变一个 model，用其 default_model 作为 model 标识，
  // 从 pricing map 里取 default_model 对应的那一条；其余 pricing entry 丢弃，因为新 shape 下每 model 单条价）
  if (Array.isArray(raw.providers)) {
    const models: ModelConfig[] = raw.providers.map(p => ({
      id: p.id,
      name: p.name,
      model: p.default_model,
      api_format: p.api_format,
      base_url: p.base_url,
      api_key: p.api_key,
      default_temperature: p.default_temperature,
      default_max_tokens: p.default_max_tokens,
      pricing: p.pricing?.[p.default_model] ?? raw.pricing?.[p.default_model],
    }))
    return { models, active_model_id: raw.active_provider_id ?? models[0]?.id }
  }

  // 老单例 shape → 合成一个 model
  const legacy = raw as LegacyV1
  const hasAnyField = !!(legacy.api_format || legacy.base_url || legacy.api_key || legacy.default_model)
  if (!hasAnyField) return { ...EMPTY }
  const modelName = legacy.default_model ?? ''
  const model: ModelConfig = {
    id: 'default',
    name: 'Default',
    model: modelName,
    api_format: legacy.api_format ?? 'openai',
    base_url: legacy.base_url ?? '',
    api_key: legacy.api_key ?? '',
    default_temperature: legacy.default_temperature,
    default_max_tokens: legacy.default_max_tokens,
    pricing: modelName ? legacy.pricing?.[modelName] : undefined,
  }
  return {
    models: [model],
    active_model_id: 'default',
  }
}

export function getLlmConfig(): LlmConfig {
  if (!fs.existsSync(configPath())) return { ...EMPTY }
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    return migrate(JSON.parse(raw))
  } catch {
    return { ...EMPTY }
  }
}

/** 从 config 挑一个 model：优先给定 id，fallback 到 active，再 fallback models[0] */
export function pickModel(cfg: LlmConfig, preferredId?: string): ModelConfig | undefined {
  if (preferredId) {
    const match = cfg.models.find(m => m.id === preferredId)
    if (match) return match
  }
  if (cfg.active_model_id) {
    const match = cfg.models.find(m => m.id === cfg.active_model_id)
    if (match) return match
  }
  return cfg.models[0]
}

/**
 * 找模型的定价：优先按 model_id 直查；找不到则按 model 名字在所有 entries 里搜（
 * 老实验没有 model_id 时兜底）。
 */
export function findPricing(cfg: LlmConfig, model: string, modelId?: string): ModelPricing | undefined {
  if (modelId) {
    const entry = cfg.models.find(m => m.id === modelId)
    if (entry?.pricing) return entry.pricing
  }
  const byName = cfg.models.find(m => m.model === model && m.pricing)
  return byName?.pricing
}

/** 至少有一个 model 的 base_url + api_key + model 非空 */
export function isLlmConfigured(cfg?: LlmConfig): boolean {
  const c = cfg ?? getLlmConfig()
  return c.models.some(m => !!(m.base_url && m.api_key && m.model))
}

export function saveLlmConfig(cfg: Partial<LlmConfig>): LlmConfig {
  ensureDir(configDir())
  const current = getLlmConfig()
  const merged: LlmConfig = { ...current, ...cfg }
  // 规整 active_model_id：指向不存在的 id 时自动纠正到 models[0]
  if (!merged.models.some(m => m.id === merged.active_model_id)) {
    merged.active_model_id = merged.models[0]?.id
  }
  writeAtomic(configPath(), JSON.stringify(merged, null, 2))
  return merged
}
