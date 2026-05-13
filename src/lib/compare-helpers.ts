// ---------- "对比"入口辅助函数 ----------
// 给 /experiments/{id} 详情页的"对比"按钮 + /compare 页的预选逻辑用。
// 提取成纯函数便于单测；不依赖 React。

import type { ExperimentConfig } from './types'
import type { TaskSchema } from './schema/types'

/** 取一个 schema 的 compare_group；未声明时 fallback 到 schema id（兼容旧数据）。 */
export function compareGroupOf(schema: Pick<TaskSchema, 'id' | 'compare_group'> | undefined): string | undefined {
  if (!schema) return undefined
  return schema.compare_group ?? schema.id
}

/**
 * 找出所有"能跟 current experiment 一起对比"的其他 experiments。
 *
 * 规则：
 *   - schema 的 compare_group 一致（未声明 compare_group 时 fallback 到 schema id）
 *   - id !== current.id（自己不算）
 *   - 调用方应已 pre-filter status=completed/paused（本函数不再过滤 status）
 *
 * 不知道 current experiment 的 schema_id 或者 schemas 里查不到时返回空数组。
 */
export function findComparableExperiments(
  current: Pick<ExperimentConfig, 'id' | 'schema_id'>,
  schemas: Array<Pick<TaskSchema, 'id' | 'compare_group'>>,
  pool: Array<Pick<ExperimentConfig, 'id' | 'schema_id'>>,
): Array<Pick<ExperimentConfig, 'id' | 'schema_id'>> {
  const schemaById = new Map(schemas.map(s => [s.id, s]))
  const currentSchema = schemaById.get(current.schema_id ?? '')
  const currentGroup = compareGroupOf(currentSchema) ?? current.schema_id
  if (!currentGroup) return []
  return pool.filter(e => {
    if (e.id === current.id) return false
    const otherSchema = schemaById.get(e.schema_id ?? '')
    const otherGroup = compareGroupOf(otherSchema) ?? e.schema_id
    return otherGroup === currentGroup
  })
}

/**
 * 构造 `/compare?ids=...` URL；current 永远在头部，comparable 按入参顺序追加。
 * comparable 为空时返回 null，调用方据此把按钮 disable。
 */
export function buildCompareHref(
  current: { id: string },
  comparable: Array<{ id: string }>,
): string | null {
  if (comparable.length === 0) return null
  const ids = [current.id, ...comparable.map(e => e.id)].join(',')
  return `/compare?ids=${ids}`
}

/**
 * /compare 页 row label：优先读 schema.display_dimensions[].header_fields
 * 显式声明（闭环 lessons §6.4 #3 "看不到题目，只有结果"），fallback 到第一个
 * 非 ID 类字段。
 *
 * 当 schema 配置 header_fields 时，每个 field 用 "label: value" 格式拼接，
 * 避免显示 "p#prod_001 · prod_001" 这种 id 字段值等于 ref id 的退化。
 */
export function rowLabel(
  refs: Record<string, string | number>,
  preview: Record<string, unknown>,
  schema?: Pick<TaskSchema, 'display_dimensions'>,
): string {
  const headerFields = (schema?.display_dimensions ?? []).flatMap(d => d.header_fields ?? [])
  if (headerFields.length > 0) {
    const parts: string[] = []
    for (const hf of headerFields) {
      const v = readHeaderFieldValue(preview, hf.field)
      if (v == null || v === '') continue
      const display = Array.isArray(v) ? v.join('、') : String(v)
      const trimmed = display.length > 60 ? display.slice(0, 60) + '…' : display
      parts.push(hf.label ? `${hf.label}: ${trimmed}` : trimmed)
    }
    if (parts.length > 0) return parts.join('  ·  ')
  }

  // Fallback: 找 input_preview 里第一个非空字符串字段。
  // 跳过值与 ref id 相等的字段（避免 pid/qid/vid 这种"id-like"字段被取出导致
  // 退化成 "p#prod_001 · prod_001"）。
  const parts: string[] = []
  for (const alias of Object.keys(refs).sort()) {
    const id = refs[alias]
    const labelEntry = Object.entries(preview).find(([k, v]) =>
      k.startsWith(`${alias}.`) &&
      String(v) !== String(id) &&
      (typeof v === 'string' || typeof v === 'number') &&
      String(v).length > 0 &&
      String(v).length < 60,
    )
    const label = labelEntry ? String(labelEntry[1]) : ''
    parts.push(label ? `${alias}#${id} · ${label}` : `${alias}#${id}`)
  }
  return parts.join('  /  ')
}

/**
 * 读 header_field 路径的值。schema 写 "input_preview.p.name" 也接受裸 "p.name"。
 * input_preview 是扁平字典，key 形如 "p.name"——直接 lookup；不存在时回退到嵌套
 * 解析（兼容偶发的 nested object preview）。
 */
function readHeaderFieldValue(preview: Record<string, unknown>, field: string): unknown {
  const path = field.startsWith('input_preview.') ? field.slice('input_preview.'.length) : field
  if (path in preview) return preview[path]
  const parts = path.split('.')
  let cur: unknown = preview
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}
