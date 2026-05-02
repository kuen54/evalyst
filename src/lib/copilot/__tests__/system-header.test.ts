import { describe, it, expect } from "vitest"
import {
  buildSystemHeader,
  shouldInlineContext,
  DEFAULT_INLINE_LIMITS,
} from "../system-header"
import type { CopilotContextRef } from "../types"

describe("shouldInlineContext", () => {
  const limits = { maxContexts: 3, maxTokensPerContext: 1000, maxTotalTokens: 2000 }

  it("inlines when count ≤ maxContexts and size OK", () => {
    expect(shouldInlineContext({ serialized_tokens: 500 }, 1, 500, limits)).toBe(true)
  })

  it("blocks inline when count > maxContexts", () => {
    expect(shouldInlineContext({ serialized_tokens: 500 }, 5, 500, limits)).toBe(false)
  })

  it("blocks inline when single context > per-context limit", () => {
    expect(shouldInlineContext({ serialized_tokens: 1500 }, 2, 0, limits)).toBe(false)
  })

  it("blocks inline when accumulated > total limit", () => {
    expect(shouldInlineContext({ serialized_tokens: 500 }, 2, 1700, limits)).toBe(false)
  })
})

describe("buildSystemHeader", () => {
  const expRef: CopilotContextRef = { tag: 1, type: "experiment", id: "exp_A" }
  const taskFieldRef: CopilotContextRef = {
    tag: 2,
    type: "task_field",
    id: "output.answer",
    extra: { experiment_id: "exp_A", task_id: "task_A1" },
  }

  it("produces route_type + path + ctx_N ids", () => {
    const header = buildSystemHeader({
      route_type: "compare",
      path: "/compare?a=exp_A",
      contexts: [expRef],
    })
    expect(header.route_type).toBe("compare")
    expect(header.path).toBe("/compare?a=exp_A")
    expect(header.active_contexts).toHaveLength(1)
    expect(header.active_contexts[0].id).toBe("ctx_1")
    expect(header.active_contexts[0].type).toBe("experiment")
    expect(header.active_contexts[0].ref).toBe("exp_A")
  })

  it("drops inline when no resolver", () => {
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts: [expRef],
    })
    expect(header.active_contexts[0].inline).toBeUndefined()
  })

  it("surfaces ctx.extra as within for task_field", () => {
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts: [taskFieldRef],
    })
    expect(header.active_contexts[0].within).toEqual({
      experiment_id: "exp_A",
      task_id: "task_A1",
    })
  })

  it("inlines small values when resolver provided", () => {
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts: [expRef],
      resolveInline: () => ({ id: "exp_A", name: "Exp A" }),
    })
    expect(header.active_contexts[0].inline).toEqual({ id: "exp_A", name: "Exp A" })
  })

  it("falls back to ref-only when single ctx exceeds per-context limit", () => {
    const huge = { body: "x".repeat(5000) }
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts: [expRef],
      resolveInline: () => huge,
    })
    expect(header.active_contexts[0].inline).toBeUndefined()
  })

  it("all-ref-only when count > maxContexts", () => {
    const contexts: CopilotContextRef[] = Array.from({ length: 5 }, (_, i) => ({
      tag: i + 1,
      type: "experiment",
      id: `exp_${i}`,
    }))
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts,
      resolveInline: () => ({ small: 1 }),
    })
    expect(header.active_contexts.every((c) => c.inline === undefined)).toBe(true)
  })

  it("accumulated cap falls back later contexts to ref-only", () => {
    const mid = { body: "y".repeat(3200) } // ~800 tokens each
    const contexts: CopilotContextRef[] = [
      { tag: 1, type: "experiment", id: "a" },
      { tag: 2, type: "experiment", id: "b" },
      { tag: 3, type: "experiment", id: "c" },
    ]
    const header = buildSystemHeader({
      route_type: "r",
      path: "/p",
      contexts,
      resolveInline: () => mid,
    })
    // First few should inline; once accumulated > 2000 tokens, later go ref-only
    const inlinedCount = header.active_contexts.filter((c) => c.inline !== undefined).length
    expect(inlinedCount).toBeLessThan(3)
  })

  it("falls back route_type/path to page_context when not provided explicitly", () => {
    const header = buildSystemHeader({
      contexts: [],
      page_context: {
        route_type: "experiment_detail",
        path: "/experiments/x",
        summary: {},
        timestamp: "t",
      },
    })
    expect(header.route_type).toBe("experiment_detail")
    expect(header.path).toBe("/experiments/x")
  })

  it("default limits are sensible", () => {
    expect(DEFAULT_INLINE_LIMITS.maxContexts).toBe(3)
    expect(DEFAULT_INLINE_LIMITS.maxTokensPerContext).toBe(1000)
    expect(DEFAULT_INLINE_LIMITS.maxTotalTokens).toBe(2000)
  })
})
