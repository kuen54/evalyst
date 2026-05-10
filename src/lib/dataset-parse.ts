import type { TFn } from "@/lib/i18n/provider"
import type { FieldDef } from "@/lib/schema/types"

type FieldType = NonNullable<FieldDef["type"]>

/**
 * CSV 单行值类型 coerce：number / true / false / 保留字符串。
 * 空字符串 → null；"0123" / "0.5" 这种保留为字符串（带前导 0 的数字常见于 id）。
 */
export function coerceCsvRow(row: Record<string, string>, headers: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const h of headers) {
    const raw = row[h]
    if (raw == null || raw === "") { out[h] = null; continue }
    const trimmed = raw.trim()
    if (trimmed === "") { out[h] = ""; continue }
    if (/^-?\d+(\.\d+)?$/.test(trimmed) && !/^0\d/.test(trimmed)) {
      const n = Number(trimmed)
      if (Number.isFinite(n)) { out[h] = n; continue }
    }
    if (trimmed === "true") { out[h] = true; continue }
    if (trimmed === "false") { out[h] = false; continue }
    out[h] = raw
  }
  return out
}

/**
 * 从前 50 条 records 推断每个 header 的字段类型：
 * 见到任何字符串 → string（最宽）；全都 url 开头 → url；全 number → number；全 boolean → boolean
 */
export function inferFieldsFromCsv(records: Record<string, unknown>[], headers: string[]): FieldDef[] {
  return headers.map(key => {
    let type: FieldType = "string"
    let sawNumber = false
    let sawBool = false
    let sawUrl = false
    let sawString = false
    for (const r of records.slice(0, 50)) {
      const v = r[key]
      if (v == null || v === "") continue
      if (typeof v === "number") { sawNumber = true; continue }
      if (typeof v === "boolean") { sawBool = true; continue }
      if (typeof v === "string") {
        if (/^https?:\/\//.test(v)) sawUrl = true
        else sawString = true
      }
    }
    if (sawString) type = "string"
    else if (sawUrl) type = "url"
    else if (sawNumber && !sawBool) type = "number"
    else if (sawBool && !sawNumber) type = "boolean"
    return { key, type }
  })
}

/**
 * 按列顺序找「所有记录都非空、且值都互不相同」的第一个字段，作为默认 id_field。
 * 都找不到就返回 null，交给调用方兜底。
 */
export function detectIdField(records: Record<string, unknown>[], headers: string[]): string | null {
  if (records.length === 0) return null
  for (const h of headers) {
    const seen = new Set<string>()
    let allUniqueAndFilled = true
    for (const r of records) {
      const v = r[h]
      if (v == null || v === "") { allUniqueAndFilled = false; break }
      const k = typeof v === "string" ? v : JSON.stringify(v)
      if (seen.has(k)) { allUniqueAndFilled = false; break }
      seen.add(k)
    }
    if (allUniqueAndFilled) return h
  }
  return null
}

/**
 * 支持两种文本形态：
 * - `[` 开头 → 整段 JSON 数组
 * - 否则一行一条 JSONL
 * 任一行解析失败携带行号 + 原始错误信息返回。
 */
export function tryParseRecords(text: string, t: TFn): { records: Record<string, unknown>[]; error: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { records: [], error: null }
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed)
      if (!Array.isArray(arr)) return { records: [], error: t("settings.datasets.form.records_not_array") }
      return { records: arr, error: null }
    } catch (e) {
      return { records: [], error: t("settings.datasets.form.records_json_array_parse", { message: (e as Error).message }) }
    }
  }
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim())
  const records: Record<string, unknown>[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]!)
      if (typeof obj !== "object" || obj === null) {
        return { records: [], error: t("settings.datasets.form.records_line_not_object", { line: i + 1 }) }
      }
      records.push(obj)
    } catch (e) {
      return { records: [], error: t("settings.datasets.form.records_line_json_fail", { line: i + 1, message: (e as Error).message }) }
    }
  }
  return { records, error: null }
}
