import { describe, it, expect } from "vitest"
import { formatCost, formatCostMap, formatTokens } from "@/lib/format"

describe("formatCost", () => {
  it("returns em dash for null/undefined", () => {
    expect(formatCost(null)).toBe("—")
    expect(formatCost(undefined)).toBe("—")
  })
  it("returns 0 symbol for 0", () => {
    expect(formatCost(0)).toBe("$0")
    expect(formatCost(0, "CNY")).toBe("¥0")
  })
  it("formats ≥1 with 2 decimals", () => {
    expect(formatCost(1.234)).toBe("$1.23")
    expect(formatCost(100.5)).toBe("$100.50")
  })
  it("formats ≥0.01 with 3 decimals", () => {
    expect(formatCost(0.0123)).toBe("$0.012")
    expect(formatCost(0.5)).toBe("$0.500")
  })
  it("formats <0.01 with 5 decimals", () => {
    expect(formatCost(0.000123)).toBe("$0.00012")
  })
  it("uses CNY ¥ symbol", () => {
    expect(formatCost(1.5, "CNY")).toBe("¥1.50")
  })
  it("uses EUR € symbol", () => {
    expect(formatCost(1.5, "EUR")).toBe("€1.50")
  })
  it("falls back to code + space for unknown currency", () => {
    expect(formatCost(1.5, "HKD")).toBe("HKD 1.50")
  })
  it("is case-insensitive for currency lookup", () => {
    expect(formatCost(1.5, "usd")).toBe("$1.50")
  })
})

describe("formatCostMap", () => {
  it("returns em dash for empty/null", () => {
    expect(formatCostMap(null)).toBe("—")
    expect(formatCostMap({})).toBe("—")
    expect(formatCostMap({ USD: 0, CNY: 0 })).toBe("—")
  })
  it("formats single currency", () => {
    expect(formatCostMap({ USD: 1.5 })).toBe("$1.50")
  })
  it("joins multiple currencies with ' + '", () => {
    const out = formatCostMap({ USD: 0.045, CNY: 1.23 })
    expect(out).toContain("$0.045")
    expect(out).toContain("¥1.23")
    expect(out).toContain(" + ")
  })
  it("skips zero/negative currencies", () => {
    expect(formatCostMap({ USD: 1.5, CNY: 0 })).toBe("$1.50")
  })
})

describe("formatTokens", () => {
  it("returns em dash for null", () => {
    expect(formatTokens(null)).toBe("—")
    expect(formatTokens(undefined)).toBe("—")
  })
  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500")
    expect(formatTokens(999)).toBe("999")
  })
  it("formats k for >=1000", () => {
    expect(formatTokens(1500)).toBe("1.5k")
    expect(formatTokens(12300)).toBe("12.3k")
  })
  it("formats M for >=1M", () => {
    expect(formatTokens(1500000)).toBe("1.5M")
  })
})
