import { describe, it, expect } from "vitest"
import { migrateExperimentInMemory } from "@/lib/store"
import type { ExperimentConfig } from "@/lib/types"

function baseExp(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    id: "e1",
    name: "E1",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    schema_id: "s1",
    model: "gpt",
    temperature: 1,
    max_tokens: 100,
    api_config: { base_url: "", api_key: "" },
    prompt_template: "",
    status: "completed",
    ...overrides,
  }
}

describe("migrateExperimentInMemory", () => {
  it("pass-through when nothing to migrate", () => {
    const exp = baseExp()
    expect(migrateExperimentInMemory(exp)).toEqual(exp)
  })

  it("migrates run_stats.total_cost_usd → total_cost_by_currency.USD", () => {
    const exp = baseExp({
      run_stats: {
        total_tasks: 10,
        completed_tasks: 10,
        failed_tasks: 0,
        started_at: "2026-01-01",
        // @ts-expect-error legacy field
        total_cost_usd: 0.05,
      },
    })
    const m = migrateExperimentInMemory(exp)
    expect(m.run_stats?.total_cost_by_currency).toEqual({ USD: 0.05 })
  })

  it("preserves existing total_cost_by_currency without overwriting", () => {
    const exp = baseExp({
      run_stats: {
        total_tasks: 1,
        completed_tasks: 1,
        failed_tasks: 0,
        started_at: "2026-01-01",
        total_cost_by_currency: { CNY: 3 },
        // @ts-expect-error legacy field that should be ignored
        total_cost_usd: 99,
      },
    })
    const m = migrateExperimentInMemory(exp)
    expect(m.run_stats?.total_cost_by_currency).toEqual({ CNY: 3 })
  })
})
