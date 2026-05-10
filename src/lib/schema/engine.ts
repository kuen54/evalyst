// ---------- Schema-driven Task Engine ----------
// 核心：generateTasks / extractVars / buildMessages / renderTemplate。
// 把整个 pipeline 从 switch(copyType) 变成「读 schema 跑」。

import type {
  TaskSchema,
  FilterDef,
  FilterValues,
  InputSourceDef,
} from './types'
import { readPath, applyTransforms } from './transform'
import type { LlmMessage } from '../llm-client'
import { getDataset } from '../datasets'

export interface Task {
  task_id: string
  inputs: Record<string, Record<string, unknown>>   // { qa: {...}, user: {...} }
}

/** Default cartesian product cap. Above this, generateTasks throws TooManyTasksError. */
export const DEFAULT_MAX_TASKS = 100_000

export class TooManyTasksError extends Error {
  readonly code = 'TOO_MANY_TASKS'
  constructor(public readonly taskCount: number, public readonly maxTasks: number) {
    super(`TOO_MANY_TASKS: estimated ${taskCount} tasks exceeds cap of ${maxTasks}`)
    this.name = 'TooManyTasksError'
  }
}

interface FilteredAlias {
  alias: string
  records: Record<string, unknown>[]
  idField: string
}

function getFilteredAlias(
  input: InputSourceDef,
  filterValues: FilterValues,
  datasetBindings: Record<string, string>,
): FilteredAlias {
  const dsId = datasetBindings[input.alias] ?? input.dataset_id
  const { records, def } = getDataset(dsId)
  let filtered = applyHardFilter(records, input.hard_filter)
  filtered = applyFilters(filtered, input.filters, filterValues)
  filtered = applyDedupe(filtered, input.dedupe_by)
  return { alias: input.alias, records: filtered, idField: def.id_field }
}

/**
 * Pure count of cartesian product without materializing the array.
 * Used by /api/estimate so huge configs don't OOM the server.
 */
export function estimateTaskCount(
  schema: TaskSchema,
  filterValues: FilterValues,
  datasetBindings: Record<string, string> = {},
): number {
  let product = 1
  for (const input of schema.inputs) {
    const f = getFilteredAlias(input, filterValues, datasetBindings)
    if (f.records.length === 0) return 0
    product *= f.records.length
  }
  return product
}

// --- Step 1: generate tasks from schema + filter values ---

export function generateTasks(
  schema: TaskSchema,
  filterValues: FilterValues,
  datasetBindings: Record<string, string> = {},
  opts: { maxTasks?: number } = {},
): Task[] {
  const maxTasks = opts.maxTasks ?? DEFAULT_MAX_TASKS
  const perAlias: FilteredAlias[] = schema.inputs.map(input =>
    getFilteredAlias(input, filterValues, datasetBindings),
  )

  // Count check before materializing — prevents OOM on accidental huge carts
  let count = 1
  for (const p of perAlias) {
    if (p.records.length === 0) { count = 0; break }
    count *= p.records.length
  }
  if (count > maxTasks) {
    throw new TooManyTasksError(count, maxTasks)
  }

  // 笛卡尔积
  let combos: Array<Record<string, Record<string, unknown>>> = [{}]
  for (const p of perAlias) {
    const next: typeof combos = []
    for (const base of combos) {
      for (const r of p.records) {
        next.push({ ...base, [p.alias]: r })
      }
    }
    combos = next
  }

  return combos.map(combo => ({
    task_id: perAlias
      .map(p => `${p.alias}:${(combo[p.alias] as Record<string, unknown>)[p.idField]}`)
      .join('|'),
    inputs: combo,
  }))
}

function applyHardFilter(
  records: Record<string, unknown>[],
  hard: InputSourceDef['hard_filter'],
): Record<string, unknown>[] {
  if (!hard) return records
  return records.filter(r => r[hard.field] === hard.equals)
}

function applyFilters(
  records: Record<string, unknown>[],
  filters: FilterDef[] | undefined,
  values: FilterValues,
): Record<string, unknown>[] {
  if (!filters) return records
  let out = records

  for (const f of filters) {
    const v = values[f.key]

    // 跳过未设置或空值（保持「不过滤」语义）
    if (f.kind === 'multiselect' || f.kind === 'literal_set') {
      if (!Array.isArray(v) || v.length === 0) continue
    } else if (f.kind === 'text_in') {
      if (!v || v === '') continue
    } else if (f.kind === 'checkbox') {
      // checkbox 即便是 false 也要按语义执行
    } else if (f.kind === 'number') {
      if (v == null || v === '') continue
    }

    switch (f.kind) {
      case 'multiselect': {
        const set = new Set(v as Array<string | number>)
        out = out.filter(r => {
          const rv = r[f.field] as string | number | null | undefined
          if (f.include_null && rv == null) return true
          return set.has(rv as string | number)
        })
        break
      }
      case 'literal_set': {
        const vs = v as unknown[]
        out = out.filter(r => vs.includes(r[f.field]))
        break
      }
      case 'checkbox': {
        // 未勾选 → 过滤掉 field === truthy 的记录；勾选 → 全部保留
        if (!v) {
          out = out.filter(r => r[f.field] !== f.truthy)
        }
        break
      }
      case 'text_in': {
        const needle = String(v)
        out = out.filter(r => String(r[f.field] ?? '').includes(needle))
        break
      }
      case 'number': {
        if (f.role === 'min' && f.field) {
          const n = Number(v)
          out = out.filter(r => (r[f.field!] as number) >= n)
        } else if (f.role === 'max' && f.field) {
          const n = Number(v)
          out = out.filter(r => (r[f.field!] as number) <= n)
        }
        break
      }
    }
  }

  // limit 最后处理（直接切片）
  for (const f of filters) {
    if (f.kind === 'number' && f.role === 'limit') {
      const v = values[f.key]
      if (typeof v === 'number' && v > 0) {
        out = out.slice(0, v)
      }
    }
  }

  return out
}

function applyDedupe(
  records: Record<string, unknown>[],
  keys: string[] | undefined,
): Record<string, unknown>[] {
  if (!keys || keys.length === 0) return records
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const r of records) {
    const k = keys.map(f => JSON.stringify(r[f] ?? null)).join('|')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

// --- Step 2: extract variables from a task combo ---

function extractVars(
  schema: TaskSchema,
  combo: Record<string, Record<string, unknown>>,
): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const def of schema.variables) {
    const raw = readPath(combo, def.source)
    let s = applyTransforms(raw, def.transform, { vars })
    if ((s === '' || s == null) && def.fallback !== undefined) {
      s = def.fallback
    }
    vars[def.name] = s
  }
  return vars
}

// --- Step 3: template rendering ---

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template
  // {{#cond}}...{{/cond}} 条件块：变量渲染后非空即保留，否则删除整块
  out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, c) => {
    return vars[k] ? c : ''
  })
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v)
  }
  return out
}

// --- Step 4: build LlmMessage[] from schema ---

export function buildMessages(
  schema: TaskSchema,
  systemPrompt: string,
  combo: Record<string, Record<string, unknown>>,
): LlmMessage[] {
  const vars = extractVars(schema, combo)
  const system = renderTemplate(systemPrompt, vars)

  // 选 user template：按条件匹配第一个命中的，否则用默认
  let userTpl = schema.message_builder.user_template ?? '请输出 JSON。'
  if (schema.message_builder.user_templates_by_cond) {
    for (const cond of schema.message_builder.user_templates_by_cond) {
      if (vars[cond.when]) {
        userTpl = cond.template
        break
      }
    }
  }
  const userText = renderTemplate(userTpl, vars)

  // 图片：从 combo 按路径取
  if (schema.message_builder.image) {
    const imgUrl = readPath(combo, schema.message_builder.image.field) as string | null | undefined
    if (imgUrl) {
      return [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imgUrl } },
          ],
        },
      ]
    }
    // required=true 但无图？仍然继续（只是没图），让 LLM 自己决定能否完成
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ]
}

// --- Input preview：把 combo 的关键字段冗余到 result 里 ---

export function buildInputPreview(
  combo: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [alias, rec] of Object.entries(combo)) {
    for (const [key, val] of Object.entries(rec)) {
      // 跳过嵌套对象（太大），保留原始类型
      if (val == null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[`${alias}.${key}`] = val
      } else if (Array.isArray(val)) {
        // 数组：只保留短的（原料这类数组），大数组（spus）跳过
        if (val.length <= 10 && val.every(x => typeof x === 'string' || typeof x === 'number')) {
          out[`${alias}.${key}`] = val
        }
      }
    }
  }
  return out
}

export function buildInputRefs(
  schema: TaskSchema,
  combo: Record<string, Record<string, unknown>>,
  datasetBindings: Record<string, string> = {},
): Record<string, string | number> {
  const refs: Record<string, string | number> = {}
  for (const input of schema.inputs) {
    const dsId = datasetBindings[input.alias] ?? input.dataset_id
    const { def } = getDataset(dsId)
    const rec = combo[input.alias]
    if (!rec) continue
    const id = (rec as Record<string, unknown>)[def.id_field]
    if (typeof id === 'string' || typeof id === 'number') {
      refs[input.alias] = id
    }
  }
  return refs
}
