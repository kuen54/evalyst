import { describe, it, expect } from "vitest"
import { aggregateResults } from "@/lib/results-aggregate"
import type { GenericResultRecord } from "@/lib/schema/types"

function mk(overrides: Partial<GenericResultRecord> = {}): GenericResultRecord {
  return {
    schema_id: "s",
    schema_version: 1,
    task_id: "t",
    experiment_id: "e",
    input_refs: {},
    input_preview: {},
    status: "success",
    latency_ms: 100,
    model: "m",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("aggregateResults", () => {
  it("returns zeros on empty", () => {
    const a = aggregateResults([])
    expect(a.total_input_tokens).toBe(0)
    expect(a.total_output_tokens).toBe(0)
    expect(a.total_cost_by_currency).toEqual({})
    expect(a.has_token_data).toBe(false)
    expect(a.has_cost_data).toBe(false)
  })

  it("sums tokens", () => {
    const a = aggregateResults([
      mk({ task_id: "a", input_tokens: 100, output_tokens: 20 }),
      mk({ task_id: "b", input_tokens: 200, output_tokens: 30 }),
    ])
    expect(a.total_input_tokens).toBe(300)
    expect(a.total_output_tokens).toBe(50)
    expect(a.has_token_data).toBe(true)
  })

  it("buckets cost by currency", () => {
    const a = aggregateResults([
      mk({ task_id: "a", cost_value: 0.01, cost_currency: "USD" }),
      mk({ task_id: "b", cost_value: 0.02, cost_currency: "USD" }),
      mk({ task_id: "c", cost_value: 5.5, cost_currency: "CNY" }),
    ])
    expect(a.total_cost_by_currency.USD).toBeCloseTo(0.03, 5)
    expect(a.total_cost_by_currency.CNY).toBeCloseTo(5.5, 5)
    expect(a.has_cost_data).toBe(true)
  })

  it("defaults currency to USD when cost_value present without currency", () => {
    const a = aggregateResults([
      mk({ task_id: "a", cost_value: 0.01 }),
    ])
    expect(a.total_cost_by_currency.USD).toBeCloseTo(0.01, 5)
  })

  it("has_cost_data false when no cost fields", () => {
    const a = aggregateResults([mk({ task_id: "a", input_tokens: 10 })])
    expect(a.has_cost_data).toBe(false)
    expect(a.has_token_data).toBe(true)
  })

  it("partial records don't contribute", () => {
    const a = aggregateResults([mk({ task_id: "a" })])
    expect(a.total_input_tokens).toBe(0)
    expect(a.has_token_data).toBe(false)
  })
})
