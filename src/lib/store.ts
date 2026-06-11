import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { ExperimentConfig, CreateExperimentRequest, ProgressState } from './types'
import type { GenericResultRecord } from './schema/types'
import { getLlmConfig, pickModel } from './llm-config'
import { ensureDir, writeAtomic } from './fs-utils'

// 惰性解析：每次调用都按当前 process.cwd() 重新计算，便于测试 chdir。
// 生产 cwd 固定，无副作用。对齐 llm-config.ts / annotation-store.ts 约定。
function dataDir() { return path.join(process.cwd(), 'data') }
function experimentsDir() { return path.join(dataDir(), 'experiments') }
function resultsDir() { return path.join(dataDir(), 'results') }

// --- Migration helpers (in-memory only; never writes back) ---

/** run_stats.total_cost_usd → total_cost_by_currency.USD (pre-currency experiments) */
export function migrateExperimentInMemory(cfg: ExperimentConfig): ExperimentConfig {
  if (!cfg.run_stats) return cfg
  const rs = cfg.run_stats as typeof cfg.run_stats & { total_cost_usd?: number }
  if (rs.total_cost_usd == null || rs.total_cost_by_currency) return cfg
  return { ...cfg, run_stats: { ...rs, total_cost_by_currency: { USD: rs.total_cost_usd } } }
}

/**
 * Result 迁移：没有 schema_id（不可识别的极老数据）塞个占位 'unknown'，
 * 展示层走 json_default 兜底。
 */
function migrateResultInMemory(raw: Record<string, unknown>): GenericResultRecord {
  if (raw.schema_id) return raw as unknown as GenericResultRecord

  return {
    schema_id: 'unknown',
    schema_version: 0,
    task_id: (raw.task_id as string) ?? 'unknown',
    experiment_id: (raw.experiment_id as string) ?? '',
    input_refs: {},
    input_preview: { ...raw },
    ...(raw.output !== undefined ? { output: raw.output as Record<string, unknown> } : {}),
    status: (raw.status as GenericResultRecord['status']) ?? 'error',
    ...(raw.error !== undefined ? { error: raw.error as string } : {}),
    ...(raw.raw_response !== undefined ? { raw_response: raw.raw_response as string } : {}),
    latency_ms: (raw.latency_ms as number) ?? 0,
    model: (raw.model as string) ?? '',
    timestamp: (raw.timestamp as string) ?? '',
  }
}

// --- Experiments ---

export function listExperiments(): ExperimentConfig[] {
  ensureDir(experimentsDir())
  const files = fs.readdirSync(experimentsDir()).filter(f => f.endsWith('.json'))
  return files
    .map(f => {
      const data = fs.readFileSync(path.join(experimentsDir(), f), 'utf-8')
      return migrateExperimentInMemory(JSON.parse(data) as ExperimentConfig)
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getExperiment(id: string): ExperimentConfig | null {
  const filePath = path.join(experimentsDir(), `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  return migrateExperimentInMemory(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
}

export function createExperiment(req: CreateExperimentRequest): ExperimentConfig {
  ensureDir(experimentsDir())
  const now = new Date().toISOString()
  const llmCfg = getLlmConfig()
  const selected = pickModel(llmCfg, req.model_id)
  if (!selected) throw new Error('No LLM model configured; set one up in /settings/llm')
  const config: ExperimentConfig = {
    id: `exp_${nanoid(8)}`,
    name: req.name,
    created_at: now,
    updated_at: now,
    schema_id: req.schema_id,
    ...(req.filter_values !== undefined ? { filter_values: req.filter_values } : {}),
    ...(req.dataset_bindings !== undefined ? { dataset_bindings: req.dataset_bindings } : {}),
    ...(req.display_id !== undefined ? { display_id: req.display_id } : {}),
    model_id: selected.id,
    ...(req.rubric_id !== undefined ? { rubric_id: req.rubric_id } : {}),
    model: req.model || selected.model,
    temperature: req.temperature ?? selected.default_temperature ?? 1,
    max_tokens: req.max_tokens ?? selected.default_max_tokens ?? 4096,
    ...(typeof req.seed === 'number' ? { seed: req.seed } : {}),
    api_config: { api_format: selected.api_format, base_url: selected.base_url, api_key: selected.api_key },
    prompt_template: req.prompt_template,
    status: 'draft',
    ...(req.notes !== undefined ? { notes: req.notes } : {}),
  }
  writeExperiment(config)
  return config
}

export function updateExperiment(id: string, updates: Partial<ExperimentConfig>): ExperimentConfig | null {
  const config = getExperiment(id)
  if (!config) return null
  const updated = { ...config, ...updates, updated_at: new Date().toISOString() }
  writeExperiment(updated)
  return updated
}

export function deleteExperiment(id: string): boolean {
  const filePath = path.join(experimentsDir(), `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  const expResultsDir = path.join(resultsDir(), id)
  if (fs.existsSync(expResultsDir)) {
    fs.rmSync(expResultsDir, { recursive: true })
  }
  return true
}

function writeExperiment(config: ExperimentConfig) {
  ensureDir(experimentsDir())
  writeAtomic(path.join(experimentsDir(), `${config.id}.json`), JSON.stringify(config, null, 2))
}

// --- Results (JSONL) ---

export function appendResult(experimentId: string, result: GenericResultRecord) {
  const dir = path.join(resultsDir(), experimentId)
  ensureDir(dir)
  const filePath = path.join(dir, 'results.jsonl')
  fs.appendFileSync(filePath, JSON.stringify(result) + '\n')
}

// readResults 缓存：results.jsonl 是 append-only（mtime + size 单调增），用
// (mtimeMs, size) 当版本号即可可靠判失效。详情页运行中每 1s poll 一次、compare
// 页一次读 N 个实验，原来每次都全量重 parse + 重建去重 Map。缓存值视为只读
// （调用方都只 map/filter/find，不 mutate）。
const resultsCache = new Map<string, { mtimeMs: number; size: number; value: GenericResultRecord[] }>()

export function readResults(experimentId: string): GenericResultRecord[] {
  const filePath = path.join(resultsDir(), experimentId, 'results.jsonl')
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    resultsCache.delete(filePath)
    return []
  }
  const cached = resultsCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.value
  }
  const content = fs.readFileSync(filePath, 'utf-8').trim()
  if (!content) {
    resultsCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value: [] })
    return []
  }
  // Skip corrupt lines instead of throwing — a single half-written entry
  // (process crash / power loss mid-appendFileSync) would otherwise make
  // the entire experiment unreadable. Matches the per-line tolerance in
  // copilot session-store.ts:readAllMessages for the same append-only
  // jsonl pattern.
  const all: GenericResultRecord[] = []
  for (const line of content.split('\n')) {
    if (!line) continue
    try {
      all.push(migrateResultInMemory(JSON.parse(line)))
    } catch (e) {
      console.warn(`[store] readResults: skipping corrupt line in ${filePath}: ${(e as Error).message}`)
    }
  }
  // Deduplicate: last entry per task_id wins (retries replace old failures)
  const map = new Map<string, GenericResultRecord>()
  for (const r of all) map.set(r.task_id, r)
  const value = Array.from(map.values())
  resultsCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return value
}

// --- Progress ---

export function getProgress(experimentId: string): ProgressState | null {
  const filePath = path.join(resultsDir(), experimentId, 'progress.json')
  if (!fs.existsSync(filePath)) return null
  // 损坏的 progress.json 当作不存在：resume 会从头重跑，appendResult 按 task_id
  // 去重是幂等的。与 readResults 的 per-line 容错对齐，避免一个坏文件把 run() 炸掉。
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function writeProgress(progress: ProgressState) {
  const dir = path.join(resultsDir(), progress.experiment_id)
  ensureDir(dir)
  writeAtomic(path.join(dir, 'progress.json'), JSON.stringify(progress, null, 2))
}
