// ---------- Display 自动推断 ----------
// 根据 schema 的 display_dimensions 数量 + output_schema 结构，
// 决定用哪个内置 display 组件。
//
// 显式 display_id 的优先级更高，本模块只在 display_id 未指定时被调用。

import type { TaskSchema, JsonPropDef, JsonSchemaDef } from './schema/types'

type Builtin4Id =
  | 'builtin_single_list'
  | 'builtin_dual_list'
  | 'builtin_triple_grid'
  | 'builtin_bubble_overlay'
  | 'builtin_json_default'

/**
 * 找出 schema 最合适的内置 display ID。
 * 规则：
 *   1. output_schema 含 tuple:number[] 字段 + inputs 中有 url 类字段 → bubble_overlay
 *   2. 否则按 display_dimensions.length 分发：
 *      0 | 1 → single_list
 *      2     → dual_list
 *      3     → triple_grid
 *      ≥ 4   → single_list（header 合并所有维度值）
 *   3. 如果连 display_dimensions / output_schema 都不合法 → json_default
 */
export function inferDisplayBuiltinId(schema: TaskSchema): Builtin4Id {
  // 防御：schema 本身坏掉 → json_default
  if (!schema || !schema.output_schema) return 'builtin_json_default'

  // 1. 检查是否是 bubble 场景
  if (hasCoordinateField(schema.output_schema) && hasImageField(schema)) {
    return 'builtin_bubble_overlay'
  }

  // 2. 按维度数
  const n = schema.display_dimensions?.length ?? 0
  if (n === 0) return 'builtin_single_list'
  if (n === 1) return 'builtin_single_list'
  if (n === 2) return 'builtin_dual_list'
  if (n === 3) return 'builtin_triple_grid'
  return 'builtin_single_list'           // ≥ 4 也走 single_list
}

/** 递归检查 output schema 是否包含 tuple:number[] 类型字段 */
function hasCoordinateField(schema: JsonSchemaDef): boolean {
  if (!schema.properties) return false
  for (const prop of Object.values(schema.properties)) {
    if (propHasCoordinate(prop)) return true
  }
  return false
}

function propHasCoordinate(prop: JsonPropDef): boolean {
  if (prop.type === 'tuple:number[]') return true
  if (prop.type === 'array' && prop.items) {
    if ('type' in prop.items) {
      return propHasCoordinate(prop.items as JsonPropDef)
    }
  }
  if (prop.type === 'object' && prop.properties) {
    for (const p of Object.values(prop.properties)) {
      if (propHasCoordinate(p)) return true
    }
  }
  return false
}

/** 检查 inputs 中是否存在 url 类字段（能作为图片源） */
function hasImageField(schema: TaskSchema): boolean {
  // 不能拿到运行时的 dataset meta，这里用启发式：
  // 1. 看是否有 message_builder.image 声明（最权威）
  if (schema.message_builder?.image?.field) return true
  // 2. 看变量声明里有没有 *_url 模式
  for (const v of schema.variables ?? []) {
    const lowerSource = v.source.toLowerCase()
    if (lowerSource.endsWith('.image_url') || lowerSource.endsWith('_url')) {
      return true
    }
  }
  return false
}
