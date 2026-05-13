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
