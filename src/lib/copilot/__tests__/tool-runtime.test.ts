import { describe, it, expect } from "vitest"
import { truncateJsonSemantic } from "../tool-runtime"

describe("truncateJsonSemantic", () => {
  it("leaves short strings untouched", () => {
    expect(truncateJsonSemantic("hello", 100)).toBe("hello")
  })

  it("truncates long strings with marker", () => {
    const long = "x".repeat(300)
    const result = truncateJsonSemantic(long, 100) as string
    expect(result.startsWith("x".repeat(100))).toBe(true)
    expect(result).toContain("truncated")
  })

  it("recurses into arrays", () => {
    const input = ["x".repeat(200), "y"]
    const result = truncateJsonSemantic(input, 50) as string[]
    expect(result[0]).toContain("truncated")
    expect(result[1]).toBe("y")
  })

  it("recurses into objects", () => {
    const input = { body: "a".repeat(500), id: 1 }
    const result = truncateJsonSemantic(input, 100) as { body: string; id: number }
    expect(result.body).toContain("truncated")
    expect(result.id).toBe(1)
  })

  it("passes numbers / booleans / null through", () => {
    expect(truncateJsonSemantic(42, 10)).toBe(42)
    expect(truncateJsonSemantic(true, 10)).toBe(true)
    expect(truncateJsonSemantic(null, 10)).toBe(null)
  })

  it("handles nested structures", () => {
    const input = { items: [{ text: "z".repeat(300) }] }
    const result = truncateJsonSemantic(input, 100) as { items: { text: string }[] }
    expect(result.items[0].text).toContain("truncated")
  })
})
