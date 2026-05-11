import type { TaskSchema } from './schema/types'
import { validateJson } from './schema/validate'

interface ParseResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

type ParserSchema = Pick<TaskSchema, 'raw_text_output' | 'output_schema'>

export function parseResponse(raw: string, schema: ParserSchema): ParseResult {
  if (schema.raw_text_output) return parseAsRawText(raw, schema)

  const json = extractJson(raw)
  if (!json) {
    return { success: false, error: 'Failed to extract JSON from response' }
  }
  const v = validateJson(json, schema.output_schema)
  if (!v.ok) return { success: false, error: `Schema mismatch: ${v.error}` }
  return { success: true, data: json }
}

function parseAsRawText(raw: string, schema: ParserSchema): ParseResult {
  const text = stripThinkingTags(raw)
  if (!text) return { success: false, error: 'Empty response' }

  const field =
    schema.output_schema.required?.[0] ??
    (schema.output_schema.properties && Object.keys(schema.output_schema.properties)[0])
  if (!field) {
    return { success: false, error: 'raw_text_output requires at least one property in output_schema' }
  }
  const data = { [field]: text }
  const v = validateJson(data, schema.output_schema)
  if (!v.ok) return { success: false, error: `Schema mismatch: ${v.error}` }
  return { success: true, data }
}

function stripThinkingTags(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = stripThinkingTags(raw)

  // 1. 直接解析
  try {
    const parsed = JSON.parse(cleaned.trim())
    if (typeof parsed === 'object' && parsed !== null) return parsed
  } catch { /* continue */ }

  // 2. 代码块提取
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]!.trim())
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch { /* continue */ }
  }

  // 3. 首尾花括号
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch { /* continue */ }
  }

  return null
}
