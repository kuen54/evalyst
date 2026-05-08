// ---------- Mini JSON Schema 校验 ----------
// 只覆盖本项目用到的形态：object + nested properties、string/number/boolean/array、
// tuple:number[]（用于 element_position [x,y]）、string|null（optional string）。
// 不装 ajv/zod；复杂度失控时再换。

import type { JsonSchemaDef, JsonPropDef } from './types'

export interface ValidateResult {
  ok: boolean
  error?: string
}

export function validateJson(data: unknown, schema: JsonSchemaDef): ValidateResult {
  return validateObject(data, schema, '$')
}

function validateObject(data: unknown, schema: JsonSchemaDef, path: string): ValidateResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `${path}: expected object` }
  }
  const obj = data as Record<string, unknown>
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in obj)) return { ok: false, error: `${path}.${key}: missing required field` }
    }
  }
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in obj) {
        const r = validateProp(obj[key], prop, `${path}.${key}`)
        if (!r.ok) return r
      }
    }
  }
  return { ok: true }
}

function validateProp(data: unknown, prop: JsonPropDef, path: string): ValidateResult {
  switch (prop.type) {
    case 'string':
      if (typeof data !== 'string') return { ok: false, error: `${path}: expected string` }
      if (prop.min_length != null && data.length < prop.min_length) return { ok: false, error: `${path}: length < ${prop.min_length}` }
      if (prop.max_length != null && data.length > prop.max_length) return { ok: false, error: `${path}: length > ${prop.max_length}` }
      if (prop.enum && !prop.enum.includes(data)) return { ok: false, error: `${path}: not in enum` }
      return { ok: true }

    case 'string|null':
      if (data !== null && typeof data !== 'string') return { ok: false, error: `${path}: expected string or null` }
      return { ok: true }

    case 'number':
      if (typeof data !== 'number') return { ok: false, error: `${path}: expected number` }
      if (prop.enum && !prop.enum.includes(data)) return { ok: false, error: `${path}: not in enum` }
      return { ok: true }

    case 'boolean':
      if (typeof data !== 'boolean') return { ok: false, error: `${path}: expected boolean` }
      return { ok: true }

    case 'tuple:number[]':
      if (!Array.isArray(data)) return { ok: false, error: `${path}: expected array` }
      if (prop.tuple_len != null && data.length !== prop.tuple_len) {
        return { ok: false, error: `${path}: expected length ${prop.tuple_len}, got ${data.length}` }
      }
      for (let i = 0; i < data.length; i++) {
        if (typeof data[i] !== 'number') return { ok: false, error: `${path}[${i}]: expected number` }
      }
      return { ok: true }

    case 'array':
      if (!Array.isArray(data)) return { ok: false, error: `${path}: expected array` }
      if (prop.items) {
        for (let i = 0; i < data.length; i++) {
          const itemSchema = prop.items as JsonPropDef | JsonSchemaDef
          // items 可以是 PropDef 或 SchemaDef（nested object shape）
          if ('type' in itemSchema && typeof itemSchema.type === 'string') {
            const r = validateProp(data[i], itemSchema as JsonPropDef, `${path}[${i}]`)
            if (!r.ok) return r
          } else {
            const r = validateObject(data[i], itemSchema as JsonSchemaDef, `${path}[${i}]`)
            if (!r.ok) return r
          }
        }
      }
      return { ok: true }

    case 'object':
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false, error: `${path}: expected object` }
      }
      if (prop.required) {
        for (const key of prop.required) {
          if (!(key in (data as Record<string, unknown>))) {
            return { ok: false, error: `${path}.${key}: missing required field` }
          }
        }
      }
      if (prop.properties) {
        for (const [k, p] of Object.entries(prop.properties)) {
          const obj = data as Record<string, unknown>
          if (k in obj) {
            const r = validateProp(obj[k], p, `${path}.${k}`)
            if (!r.ok) return r
          }
        }
      }
      return { ok: true }

    case 'image_url':
      if (typeof data !== 'string') return { ok: false, error: `${path}: expected image_url (string)` }
      if (data.length === 0) return { ok: false, error: `${path}: image_url must be non-empty` }
      return { ok: true }

    case 'image_url_list':
      if (!Array.isArray(data)) return { ok: false, error: `${path}: expected image_url_list (array)` }
      for (let i = 0; i < data.length; i++) {
        if (typeof data[i] !== 'string') return { ok: false, error: `${path}[${i}]: expected string` }
        if ((data[i] as string).length === 0) return { ok: false, error: `${path}[${i}]: must be non-empty` }
      }
      return { ok: true }
  }
}
