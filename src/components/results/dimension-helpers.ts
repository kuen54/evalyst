// ---------- 读 display_dimensions 的辅助函数 ----------

import type { DisplayDimension, TaskSchema, GenericResultRecord } from "@/lib/schema/types"
import { readField } from "./view-helpers"

/** 读 result 在某个 dimension 上的值（string/number/null） */
export function readDimensionValue(result: GenericResultRecord, dim: DisplayDimension): string | number | null {
  const v = readField(result, dim.field)
  if (v == null) return null
  if (typeof v === "string" || typeof v === "number") return v
  return String(v)
}

/** 把 dimension 的原始值映射成展示 label */
export function labelFor(dim: DisplayDimension, value: string | number | null): string {
  if (value == null) return "-"
  if (dim.value_labels && dim.value_labels[String(value)]) return dim.value_labels[String(value)]!
  return String(value)
}

/** 收集某个 dimension 在所有 result 中出现的值（按 order 排序；未在 order 的追加末尾） */
export function collectDimensionValues(
  results: GenericResultRecord[],
  dim: DisplayDimension,
): Array<string | number> {
  const set = new Set<string | number>()
  for (const r of results) {
    const v = readDimensionValue(r, dim)
    if (v != null) set.add(v)
  }
  const all = Array.from(set)
  if (!dim.order || dim.order.length === 0) {
    // 尝试按数字升序，否则按字符串升序
    all.sort((a, b) => {
      const an = Number(a)
      const bn = Number(b)
      if (!isNaN(an) && !isNaN(bn)) return an - bn
      return String(a).localeCompare(String(b))
    })
    return all
  }
  const ordered: Array<string | number> = []
  for (const o of dim.order) {
    if (set.has(o)) { ordered.push(o); set.delete(o) }
  }
  // 剩下的（order 未覆盖的）也追加
  ordered.push(...Array.from(set))
  return ordered
}

/** 按 dimension 给 results 分组，返回 Map<value, results[]> */
export function groupByDimension(
  results: GenericResultRecord[],
  dim: DisplayDimension,
): Map<string | number | null, GenericResultRecord[]> {
  const map = new Map<string | number | null, GenericResultRecord[]>()
  for (const r of results) {
    const v = readDimensionValue(r, dim)
    if (!map.has(v)) map.set(v, [])
    map.get(v)!.push(r)
  }
  return map
}

/** schema.display_dimensions 的安全访问 */
export function dimensionsOf(schema: TaskSchema | undefined): DisplayDimension[] {
  return schema?.display_dimensions ?? []
}
