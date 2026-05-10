// ---------- 从 output_schema 推导展示字段 ----------

import type { JsonPropDef, JsonSchemaDef } from "@/lib/schema/types"

interface OutputField {
  name: string
  type: JsonPropDef["type"]
  required: boolean
  items?: JsonPropDef | JsonSchemaDef
  properties?: Record<string, JsonPropDef>
}

/** 取 output_schema 的顶层字段列表 */
export function getOutputFields(schema: JsonSchemaDef): OutputField[] {
  if (!schema.properties) return []
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, p]) => ({
    name,
    type: p.type,
    required: required.has(name),
    ...(p.items !== undefined ? { items: p.items } : {}),
    ...(p.properties !== undefined ? { properties: p.properties } : {}),
  }))
}

/** 推断某个字段用什么 renderField type 展示 */
export function inferFieldRenderType(
  field: OutputField,
  sampleValue?: unknown,
): "text" | "image" | "badge" | "json" {
  // 显式 image 类型 → image（最高优先级）
  if (field.type === "image_url" || field.type === "image_url_list") return "image"
  // 名字启发式 → badge
  if (/tag|label|category|status/i.test(field.name)) return "badge"
  // URL 启发式 → image (fallback for legacy schemas without image_url type)
  if (typeof sampleValue === "string" && /^https?:\/\//.test(sampleValue) && /(url|image|pic|img|photo)/i.test(field.name)) {
    return "image"
  }
  // 非字符串/数字/布尔 → json
  if (field.type === "object" || field.type === "array" || field.type === "tuple:number[]") return "json"
  return "text"
}

/** 找 output 里「bubble 列表」类型的字段（array of object，含 tuple:number[] 字段） */
export function findBubbleArrayField(schema: JsonSchemaDef): OutputField | null {
  const fields = getOutputFields(schema)
  for (const f of fields) {
    if (f.type !== "array" || !f.items) continue
    const items = f.items as JsonPropDef
    if (items.type === "object" && items.properties) {
      for (const p of Object.values(items.properties)) {
        if (p.type === "tuple:number[]") return f
      }
    }
  }
  return null
}

/** 从 bubble items 结构里找坐标字段名（如 "element_position"） */
export function findCoordinateFieldName(bubbleField: OutputField): string | null {
  if (!bubbleField.items) return null
  const items = bubbleField.items as JsonPropDef
  if (items.type !== "object" || !items.properties) return null
  for (const [name, p] of Object.entries(items.properties)) {
    if (p.type === "tuple:number[]") return name
  }
  return null
}

/** 找 bubble items 里的文本/emoji 字段 */
export function findBubbleTextField(bubbleField: OutputField): { text?: string; emoji?: string } {
  if (!bubbleField.items) return {}
  const items = bubbleField.items as JsonPropDef
  if (items.type !== "object" || !items.properties) return {}
  const names = Object.keys(items.properties)
  const text = names.find(n => /text|label|name|title|word/i.test(n)) ?? names.find(n => {
    const p = items.properties![n]
    return p?.type === "string"
  })
  const emoji = names.find(n => /emoji|icon/i.test(n))
  return { ...(text !== undefined ? { text } : {}), ...(emoji !== undefined ? { emoji } : {}) }
}
