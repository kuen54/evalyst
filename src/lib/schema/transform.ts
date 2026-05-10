// ---------- Variable transform 引擎 ----------
// 串联应用 TransformStep[]，从原始字段 → 最终字符串。
// 所有 op 的输入/输出语义见 types.ts 的 TransformStep 联合。

import type { TransformStep } from './types'

type Ctx = { vars: Record<string, string> }

export function applyTransforms(value: unknown, steps: TransformStep[] | undefined, ctx: Ctx): string {
  if (!steps || steps.length === 0) return toStr(value)
  let v: unknown = value
  for (const step of steps) v = applyOne(v, step, ctx)
  return toStr(v)
}

function applyOne(v: unknown, step: TransformStep, _ctx: Ctx): unknown {
  // Runtime guard for the removed `js` op (PR fix/auth-gate-rce, v0.11):
  // type union no longer includes it, but data/schemas/*.json may still
  // carry it from older configs. Refuse with a friendly error rather than
  // silently falling through the switch.
  if ((step as { op: string }).op === 'js') {
    throw new Error(
      'INVALID_TRANSFORM_OP: "js" transform op was removed for security reasons. Edit the schema to remove this step.',
    )
  }
  switch (step.op) {
    case 'join':
      return Array.isArray(v) ? v.join(step.sep) : v

    case 'truncate': {
      const s = toStr(v)
      if (s.length <= step.max) return s
      return s.slice(0, step.max) + (step.suffix ?? '...')
    }

    case 'slice':
      if (Array.isArray(v)) return v.slice(step.start ?? 0, step.end)
      if (typeof v === 'string') return v.slice(step.start ?? 0, step.end)
      return v

    case 'eq':
      return v === step.value ? 'true' : ''

    case 'notEmpty':
      return v != null && v !== '' ? 'true' : ''

    case 'default':
      return v == null || v === '' ? step.value : v

    case 'map':
      if (v == null) return ''
      return step.mapping[String(v)] ?? ''

    case 'prompt_excerpt': {
      const s = toStr(v)
      if (!s) return ''
      const max = step.maxLen ?? 600
      // 复用老 truncatePrompt 的逻辑：按 "\n{数字}、/." 切 section，取 2-3 段
      const parts = s.split(/\n\d+[、.]/g)
      if (parts.length >= 3) {
        const e = parts.slice(1, 3).join('\n').trim()
        return e.length > max ? e.slice(0, max) + '...' : e
      }
      return s.length > max ? s.slice(0, max) + '...' : s
    }

    case 'spu_desc_list': {
      type Spu = { spu_name: string; description: string | null }
      const obj = v as { spus?: Spu[] } | null | undefined
      if (!obj?.spus) return ''
      const maxSpus = step.maxSpus ?? 3
      const maxCharsPerSpu = step.maxCharsPerSpu ?? 200
      const desc = obj.spus.filter(s => s.description).slice(0, maxSpus)
      return desc
        .map(s => `${s.spu_name}: ${s.description!.slice(0, maxCharsPerSpu)}`)
        .join('\n')
    }

    default: {
      // Defensive exhaustive check — TS currently satisfied by TransformStep
      // union, but guards against future case additions silently returning
      // undefined. Per Phase D plan §4.
      const _exhaustive: never = step
      throw new Error(`unknown TransformStep.op: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function toStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 从 combo 中按 'alias.path.to.field' 取值。支持 'literal:xxx' 字面量。 */
export function readPath(
  inputs: Record<string, Record<string, unknown>>,
  source: string,
): unknown {
  if (source.startsWith('literal:')) return source.slice('literal:'.length)
  const parts = source.split('.')
  const alias = parts[0]!
  let cur: unknown = inputs[alias]
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[parts[i]!]
  }
  return cur
}
