// ---------- Mock GenericResultRecord 生成（用于表单右栏预览） ----------
//
// 不跑 LLM，只生成"形状正确 + 看起来有内容"的假结果。
// 用 dataset 前若干条真实 record 作为 input_preview，output 按 schema 生成占位值。

import type {
  TaskSchema,
  JsonPropDef,
  JsonSchemaDef,
  GenericResultRecord,
  DatasetDef,
} from "./schema/types"

/** 按 output_schema 生成一个占位 output */
function mockOutput(schema: JsonSchemaDef, seed = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!schema.properties) return out
  let idx = 0
  for (const [name, prop] of Object.entries(schema.properties)) {
    out[name] = mockValue(prop, `${name}_${seed}_${idx++}`)
  }
  return out
}

function mockValue(prop: JsonPropDef, seedKey: string): unknown {
  switch (prop.type) {
    case "string":
      // 给一些"看起来像那个字段会返回的内容"
      if (/tag|scene|label|category|status/i.test(seedKey)) return "示例标签"
      if (/url|image|pic/i.test(seedKey)) return "https://via.placeholder.com/200"
      return "示例文本内容"
    case "string|null":
      return "示例"
    case "number":
      return 0
    case "boolean":
      return true
    case "tuple:number[]":
      // 给不同位置的坐标避免全部重叠
      const hash = seedKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
      return [0.3 + (hash % 40) / 100, 0.3 + ((hash * 7) % 40) / 100]
    case "image_url":
      // Inline gray SVG placeholder so preview works without network
      return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23e5e7eb'/><text x='120' y='90' font-family='monospace' font-size='14' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image_url</text></svg>"
    case "image_url_list":
      return [
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23e5e7eb'/><text x='120' y='90' font-family='monospace' font-size='12' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image[0]</text></svg>",
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23d1d5db'/><text x='120' y='90' font-family='monospace' font-size='12' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image[1]</text></svg>",
      ]
    case "object":
      if (prop.properties) {
        const nested: Record<string, unknown> = {}
        for (const [k, p] of Object.entries(prop.properties)) {
          nested[k] = mockValue(p, k)
        }
        return nested
      }
      return {}
    case "array":
      if (prop.items) {
        const item = prop.items as JsonPropDef
        const count = 3
        return Array.from({ length: count }, (_, i) => mockValue(item, `${seedKey}_${i}`))
      }
      return []
  }
}

/** 给定 schema + 可用 datasets，生成 mock results 用于预览 */
export function generateMockResults(
  schema: TaskSchema,
  datasets: DatasetDef[],
  datasetRecordsMap: Record<string, Record<string, unknown>[]>,
  maxCombos = 3,
): GenericResultRecord[] {
  const inputs = schema.inputs ?? []
  if (inputs.length === 0) return []

  // 收集每个 input 可用的 record（最多前 3 条）
  const perInput: Array<{ alias: string; idField: string; records: Record<string, unknown>[] }> = []
  for (const input of inputs) {
    const ds = datasets.find(d => d.id === input.dataset_id)
    if (!ds) continue
    const records = datasetRecordsMap[input.dataset_id] ?? []
    if (records.length === 0) continue
    perInput.push({ alias: input.alias, idField: ds.id_field, records: records.slice(0, 3) })
  }
  if (perInput.length === 0) return []

  // 笛卡尔积（每维最多 2 条 + 总数上限）
  let combos: Array<Record<string, Record<string, unknown>>> = [{}]
  for (const p of perInput) {
    const next: typeof combos = []
    const recs = p.records.slice(0, 2)
    for (const base of combos) {
      for (const r of recs) {
        next.push({ ...base, [p.alias]: r })
        if (next.length >= maxCombos) break
      }
      if (next.length >= maxCombos) break
    }
    combos = next
  }
  combos = combos.slice(0, maxCombos)

  // 构造 mock GenericResultRecord
  const results: GenericResultRecord[] = combos.map((combo, i) => {
    const input_refs: Record<string, string | number> = {}
    const input_preview: Record<string, unknown> = {}
    for (const p of perInput) {
      const rec = combo[p.alias]
      if (!rec) continue
      const id = rec[p.idField]
      if (typeof id === "string" || typeof id === "number") {
        input_refs[p.alias] = id
      }
      for (const [k, v] of Object.entries(rec)) {
        if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          input_preview[`${p.alias}.${k}`] = v
        } else if (Array.isArray(v) && v.length <= 10 && v.every(x => typeof x === "string" || typeof x === "number")) {
          input_preview[`${p.alias}.${k}`] = v
        }
      }
    }

    const task_id = perInput
      .map(p => `${p.alias}:${combo[p.alias]?.[p.idField]}`)
      .join("|")

    return {
      schema_id: schema.id,
      schema_version: schema.version,
      task_id,
      experiment_id: "__preview__",
      input_refs,
      input_preview,
      output: mockOutput(schema.output_schema, i),
      status: "success",
      latency_ms: 0,
      model: "__mock__",
      timestamp: new Date().toISOString(),
    }
  })

  return results
}
