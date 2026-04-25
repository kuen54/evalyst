// ---------- 用户 schema 的 JSON 存储 + 校验 ----------

import fs from 'fs'
import path from 'path'
import type { TaskSchema } from './types'
import { ensureDir, writeAtomic } from '../fs-utils'

const SCHEMAS_DIR = path.join(process.cwd(), 'data', 'schemas')

export function listUserSchemas(): TaskSchema[] {
  ensureDir(SCHEMAS_DIR)
  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'))
  const out: TaskSchema[] = []
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(SCHEMAS_DIR, f), 'utf-8')
      const d = JSON.parse(raw) as TaskSchema
      out.push({ ...d, source: 'user' })
    } catch {
      // skip
    }
  }
  return out
}

export function getUserSchema(id: string): TaskSchema | null {
  const p = path.join(SCHEMAS_DIR, `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as TaskSchema
    return { ...d, source: 'user' }
  } catch {
    return null
  }
}

export function createUserSchema(schema: TaskSchema): TaskSchema {
  ensureDir(SCHEMAS_DIR)
  if (!/^[a-z][a-z0-9_]*$/.test(schema.id)) {
    throw new Error(`Invalid id: ${schema.id} (lowercase letters/digits/underscores, start with letter)`)
  }
  const toWrite = { ...schema, source: undefined }
  delete (toWrite as Record<string, unknown>).source
  writeAtomic(path.join(SCHEMAS_DIR, `${schema.id}.json`), JSON.stringify(toWrite, null, 2))
  return { ...schema, source: 'user' }
}

export function deleteUserSchema(id: string): boolean {
  const p = path.join(SCHEMAS_DIR, `${id}.json`)
  if (!fs.existsSync(p)) return false
  fs.rmSync(p)
  return true
}

// --- Validator ---

export interface SchemaValidationError {
  field: string
  message: string
}

export function validateUserSchema(d: unknown): { ok: boolean; errors: SchemaValidationError[] } {
  const errors: SchemaValidationError[] = []
  if (typeof d !== 'object' || d === null) {
    return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] }
  }
  const x = d as Record<string, unknown>

  if (typeof x.id !== 'string' || !x.id) errors.push({ field: 'id', message: 'required string' })
  if (typeof x.label !== 'string' || !x.label) errors.push({ field: 'label', message: 'required string' })
  if (typeof x.version !== 'number') errors.push({ field: 'version', message: 'required number' })

  if (!Array.isArray(x.inputs) || x.inputs.length === 0) {
    errors.push({ field: 'inputs', message: 'required non-empty array' })
  } else {
    for (let i = 0; i < x.inputs.length; i++) {
      const inp = x.inputs[i] as Record<string, unknown>
      if (typeof inp.alias !== 'string') errors.push({ field: `inputs[${i}].alias`, message: 'required string' })
      if (typeof inp.dataset_id !== 'string') errors.push({ field: `inputs[${i}].dataset_id`, message: 'required string' })
    }
  }

  if (!Array.isArray(x.variables)) errors.push({ field: 'variables', message: 'required array' })

  if (typeof x.default_prompt !== 'string') errors.push({ field: 'default_prompt', message: 'required string' })

  if (typeof x.message_builder !== 'object' || x.message_builder === null) {
    errors.push({ field: 'message_builder', message: 'required object' })
  }

  if (typeof x.output_schema !== 'object' || x.output_schema === null) {
    errors.push({ field: 'output_schema', message: 'required object' })
  }

  return { ok: errors.length === 0, errors }
}
