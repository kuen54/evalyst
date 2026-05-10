import { describe, it, expect } from "vitest"
import { parseResponse } from "@/lib/result-parser"
import type { TaskSchema, JsonSchemaDef } from "@/lib/schema/types"

// parseResponse 只读 schema.output_schema + schema.raw_text_output；
// 其余 TaskSchema 字段是噪音，单 cast 在 fixture 边界即可，不污染 prod。
function makeSchema(output_schema: JsonSchemaDef, raw_text_output?: boolean): TaskSchema {
  const base: Partial<TaskSchema> = { output_schema }
  if (raw_text_output !== undefined) base.raw_text_output = raw_text_output
  return base as TaskSchema
}

const ANSWER_SCHEMA: JsonSchemaDef = {
  type: "object",
  required: ["answer"],
  properties: { answer: { type: "string" } },
}

describe("parseResponse · JSON extraction paths", () => {
  it("path #1: parses raw JSON directly when whole response is JSON", () => {
    const r = parseResponse('{"answer":"42"}', makeSchema(ANSWER_SCHEMA))
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ answer: "42" })
  })

  it("path #2: extracts from ```json fenced block AND ``` no-lang fenced block", () => {
    const fenced = parseResponse(
      'preamble text\n```json\n{"answer":"hello"}\n```\ntrailing',
      makeSchema(ANSWER_SCHEMA),
    )
    expect(fenced.success).toBe(true)
    expect(fenced.data).toEqual({ answer: "hello" })

    const noLang = parseResponse(
      'thinking aloud\n```\n{"answer":"plain"}\n```',
      makeSchema(ANSWER_SCHEMA),
    )
    expect(noLang.success).toBe(true)
    expect(noLang.data).toEqual({ answer: "plain" })
  })

  it("path #3: brace fallback extracts {...} from wrapping prose", () => {
    const wrapped = parseResponse(
      'Here is my answer: {"answer":"yes"} hope it helps!',
      makeSchema(ANSWER_SCHEMA),
    )
    expect(wrapped.success).toBe(true)
    expect(wrapped.data).toEqual({ answer: "yes" })
  })

  it("strips <think>...</think> before JSON extraction (case-insensitive)", () => {
    const r = parseResponse(
      '<think>let me consider...</think>\n```json\n{"answer":"final"}\n```',
      makeSchema(ANSWER_SCHEMA),
    )
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ answer: "final" })

    const upper = parseResponse(
      '<THINK>upper case tag</THINK>{"answer":"x"}',
      makeSchema(ANSWER_SCHEMA),
    )
    expect(upper.success).toBe(true)
    expect(upper.data).toEqual({ answer: "x" })
  })

  it("returns 'Failed to extract JSON' when no path matches", () => {
    const r = parseResponse("just words, no braces at all", makeSchema(ANSWER_SCHEMA))
    expect(r.success).toBe(false)
    expect(r.error).toBe("Failed to extract JSON from response")
  })

  it("returns 'Schema mismatch: ...' when extracted JSON fails validation", () => {
    const r = parseResponse('{"wrong_key":"oops"}', makeSchema(ANSWER_SCHEMA))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/^Schema mismatch:/)
    expect(r.error).toContain("missing required field")
  })
})

describe("parseResponse · raw_text_output mode", () => {
  it("happy: strips <think> and assigns the entire remaining text to required[0]", () => {
    const r = parseResponse(
      "<think>internal</think>\nThe sky is blue because of Rayleigh scattering.",
      makeSchema(ANSWER_SCHEMA, true),
    )
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ answer: "The sky is blue because of Rayleigh scattering." })
  })

  it("returns 'Empty response' when stripped text is empty", () => {
    const r = parseResponse("<think>only thinking</think>   ", makeSchema(ANSWER_SCHEMA, true))
    expect(r.success).toBe(false)
    expect(r.error).toBe("Empty response")
  })

  it("falls back to properties[0] when required is absent; errors when both missing", () => {
    // required 缺，properties 兜底命中
    const propOnly: JsonSchemaDef = { type: "object", properties: { text: { type: "string" } } }
    const r = parseResponse("hello", makeSchema(propOnly, true))
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ text: "hello" })

    // required + properties 都缺 → 报 raw_text_output guard 错
    const empty: JsonSchemaDef = { type: "object" }
    const r2 = parseResponse("hello", makeSchema(empty, true))
    expect(r2.success).toBe(false)
    expect(r2.error).toBe("raw_text_output requires at least one property in output_schema")
  })
})
