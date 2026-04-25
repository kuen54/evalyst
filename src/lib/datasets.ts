// ---------- 数据集：统一走文件系统 ----------
// 所有数据集都存在 data/datasets/{id}.{meta.json, jsonl}。
// 内置示例（boxes / users）通过 src/lib/seeds/ 的 seed 机制写入，见 seed.ts。

import fs from 'fs'
import path from 'path'
import type { DatasetDef, FieldDef } from './schema/types'
import { ensureSeeds } from './seed'
import { ensureDir, writeAtomic } from './fs-utils'

const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets')

// --- 核心 API ---

export function getDataset(id: string): { records: Record<string, unknown>[]; def: DatasetDef } {
  ensureSeeds()
  const meta = readDatasetMeta(id)
  if (!meta) throw new Error(`Dataset not found: ${id}`)
  const jsonlPath = path.join(DATASETS_DIR, `${id}.jsonl`)
  if (!fs.existsSync(jsonlPath)) throw new Error(`Dataset file missing: ${jsonlPath}`)
  const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
  return { records: lines.map(l => JSON.parse(l)), def: meta }
}

export function listDatasets(): DatasetDef[] {
  ensureSeeds()
  ensureDir(DATASETS_DIR)
  const files = fs.readdirSync(DATASETS_DIR).filter(f => f.endsWith('.meta.json'))
  return files.map(f => {
    const raw = fs.readFileSync(path.join(DATASETS_DIR, f), 'utf-8')
    const def = JSON.parse(raw) as DatasetDef
    // 附加 record_count：快速扫 .jsonl 行数
    const jsonlPath = path.join(DATASETS_DIR, `${def.id}.jsonl`)
    if (fs.existsSync(jsonlPath)) {
      const content = fs.readFileSync(jsonlPath, 'utf-8')
      def.record_count = content.split('\n').filter(l => l.trim()).length
    }
    return def
  })
}

export function getDatasetSummary(id: string): {
  def: DatasetDef
  record_count: number
  sample: Record<string, unknown>[]
} {
  const { records, def } = getDataset(id)
  return { def, record_count: records.length, sample: records.slice(0, 5) }
}

// --- CRUD ---

function readDatasetMeta(id: string): DatasetDef | null {
  const p = path.join(DATASETS_DIR, `${id}.meta.json`)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

/** 从 meta-prompt 产出的 JSON 对象创建数据集：含显式 id 和 records 数组。 */
export function createDatasetFromJson(data: {
  id: string
  name: string
  description?: string
  id_field: string
  fields: FieldDef[]
  records: Record<string, unknown>[]
}): DatasetDef {
  ensureDir(DATASETS_DIR)
  if (!/^[a-z][a-z0-9_]*$/.test(data.id)) {
    throw new Error(`Invalid id: ${data.id} (lowercase letters/digits/underscores, start with letter)`)
  }
  const existingMeta = readDatasetMeta(data.id)
  if (existingMeta) {
    throw new Error(`ID already exists: ${data.id}`)
  }
  if (!data.fields.some(f => f.key === data.id_field)) {
    throw new Error(`id_field "${data.id_field}" not in fields list`)
  }
  const def: DatasetDef = {
    id: data.id,
    name: data.name,
    source: 'upload',
    id_field: data.id_field,
    fields: data.fields,
    path: `data/datasets/${data.id}.jsonl`,
    created_at: new Date().toISOString(),
    description: data.description,
  }
  const jsonl = data.records.map(r => JSON.stringify(r)).join('\n') + '\n'
  writeAtomic(path.join(DATASETS_DIR, `${data.id}.jsonl`), jsonl)
  writeAtomic(path.join(DATASETS_DIR, `${data.id}.meta.json`), JSON.stringify(def, null, 2))
  return def
}

export function validateDatasetJson(d: unknown): { ok: boolean; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = []
  if (typeof d !== 'object' || d === null) {
    return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] }
  }
  const x = d as Record<string, unknown>
  if (typeof x.id !== 'string' || !x.id) errors.push({ field: 'id', message: 'required string' })
  if (typeof x.name !== 'string' || !x.name) errors.push({ field: 'name', message: 'required string' })
  if (typeof x.id_field !== 'string' || !x.id_field) errors.push({ field: 'id_field', message: 'required string' })
  if (!Array.isArray(x.fields) || x.fields.length === 0) errors.push({ field: 'fields', message: 'required non-empty array' })
  if (!Array.isArray(x.records) || x.records.length === 0) errors.push({ field: 'records', message: 'required non-empty array' })
  return { ok: errors.length === 0, errors }
}

export function updateCustomDataset(id: string, patch: {
  name?: string
  description?: string
  id_field?: string
  fields?: FieldDef[]
  records?: Record<string, unknown>[]
}): DatasetDef {
  ensureDir(DATASETS_DIR)
  const existing = readDatasetMeta(id)
  if (!existing) throw new Error(`Dataset not found: ${id}`)

  const nextFields = patch.fields ?? existing.fields
  const nextIdField = patch.id_field ?? existing.id_field

  if (!nextFields.length) {
    throw new Error('fields must be non-empty')
  }
  const keySet = new Set<string>()
  for (const f of nextFields) {
    if (!f.key) throw new Error('field key required')
    if (keySet.has(f.key)) throw new Error(`duplicate field key: ${f.key}`)
    keySet.add(f.key)
  }
  if (!keySet.has(nextIdField)) {
    throw new Error(`id_field "${nextIdField}" not in fields list`)
  }

  const next: DatasetDef = {
    ...existing,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    id_field: nextIdField,
    fields: nextFields,
  }
  writeAtomic(path.join(DATASETS_DIR, `${id}.meta.json`), JSON.stringify(next, null, 2))

  if (patch.records) {
    if (patch.records.length === 0) throw new Error('records must be non-empty')
    const jsonl = patch.records.map(r => JSON.stringify(r)).join('\n') + '\n'
    writeAtomic(path.join(DATASETS_DIR, `${id}.jsonl`), jsonl)
  }

  return next
}

export function deleteCustomDataset(id: string): boolean {
  const jsonl = path.join(DATASETS_DIR, `${id}.jsonl`)
  const meta = path.join(DATASETS_DIR, `${id}.meta.json`)
  let ok = false
  if (fs.existsSync(jsonl)) { fs.rmSync(jsonl); ok = true }
  if (fs.existsSync(meta)) { fs.rmSync(meta); ok = true }
  return ok
}

/** 扫前 N 行自动识别字段（给上传 UI 用） */
export function inferFieldsFromJsonl(
  jsonl: string,
  sampleSize = 10,
): { fields: FieldDef[]; preview: Record<string, unknown>[]; total_lines: number; error?: string } {
  const allLines = jsonl.split('\n').filter(l => l.trim())
  const total = allLines.length
  const lines = allLines.slice(0, sampleSize)
  const samples: Record<string, unknown>[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i])
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        samples.push(parsed as Record<string, unknown>)
      }
    } catch (e) {
      return { fields: [], preview: [], total_lines: total, error: `Line ${i + 1}: ${(e as Error).message}` }
    }
  }
  if (samples.length === 0) return { fields: [], preview: [], total_lines: total, error: 'No valid JSON objects found' }

  const keys = new Set<string>()
  for (const s of samples) Object.keys(s).forEach(k => keys.add(k))

  const fields: FieldDef[] = Array.from(keys).map(key => {
    const sample = samples.find(s => s[key] != null)?.[key]
    let type: FieldDef['type'] = 'string'
    if (Array.isArray(sample)) type = 'array'
    else if (typeof sample === 'number') type = 'number'
    else if (typeof sample === 'boolean') type = 'boolean'
    else if (typeof sample === 'object' && sample !== null) type = 'object'
    else if (typeof sample === 'string' && /^https?:\/\//.test(sample)) type = 'url'
    return { key, type }
  })

  return { fields, preview: samples, total_lines: total }
}
