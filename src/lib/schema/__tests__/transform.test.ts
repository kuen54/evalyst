import { describe, it, expect } from "vitest"
import { applyTransforms, readPath } from "@/lib/schema/transform"

const ctx = { vars: {} }

describe("applyTransforms", () => {
  it("returns stringified value when no steps", () => {
    expect(applyTransforms("hi", undefined, ctx)).toBe("hi")
    expect(applyTransforms(42, [], ctx)).toBe("42")
    expect(applyTransforms([1, 2], undefined, ctx)).toBe("1,2")
    expect(applyTransforms({ a: 1 }, undefined, ctx)).toBe('{"a":1}')
    expect(applyTransforms(null, undefined, ctx)).toBe("")
    expect(applyTransforms(undefined, undefined, ctx)).toBe("")
  })

  describe("join", () => {
    it("joins arrays", () => {
      expect(applyTransforms([1, 2, 3], [{ op: "join", sep: "、" }], ctx)).toBe("1、2、3")
    })
    it("passes through non-arrays", () => {
      expect(applyTransforms("abc", [{ op: "join", sep: "," }], ctx)).toBe("abc")
    })
  })

  describe("truncate", () => {
    it("leaves short strings alone", () => {
      expect(applyTransforms("abc", [{ op: "truncate", max: 10 }], ctx)).toBe("abc")
    })
    it("truncates with default suffix", () => {
      expect(applyTransforms("abcdefghij", [{ op: "truncate", max: 5 }], ctx)).toBe("abcde...")
    })
    it("truncates with custom suffix", () => {
      expect(applyTransforms("abcdefghij", [{ op: "truncate", max: 4, suffix: "…" }], ctx)).toBe("abcd…")
    })
  })

  describe("slice", () => {
    it("slices arrays", () => {
      expect(applyTransforms([1, 2, 3, 4], [{ op: "slice", start: 1, end: 3 }], ctx)).toBe("2,3")
    })
    it("slices strings", () => {
      expect(applyTransforms("abcdef", [{ op: "slice", start: 1, end: 4 }], ctx)).toBe("bcd")
    })
  })

  describe("eq", () => {
    it("returns 'true' when matching", () => {
      expect(applyTransforms("fallback", [{ op: "eq", value: "fallback" }], ctx)).toBe("true")
    })
    it("returns empty string otherwise", () => {
      expect(applyTransforms("x", [{ op: "eq", value: "fallback" }], ctx)).toBe("")
    })
  })

  describe("notEmpty", () => {
    it.each<[unknown, string]>([
      ["hello", "true"],
      ["", ""],
      [null, ""],
      [undefined, ""],
      [0, "true"],
    ])("%p → %p", (input, expected) => {
      expect(applyTransforms(input, [{ op: "notEmpty" }], ctx)).toBe(expected)
    })
  })

  describe("default", () => {
    it("uses default when empty", () => {
      expect(applyTransforms(null, [{ op: "default", value: "fallback" }], ctx)).toBe("fallback")
      expect(applyTransforms("", [{ op: "default", value: "fallback" }], ctx)).toBe("fallback")
    })
    it("keeps value otherwise", () => {
      expect(applyTransforms("actual", [{ op: "default", value: "fallback" }], ctx)).toBe("actual")
    })
  })

  describe("map", () => {
    it("maps by key", () => {
      expect(applyTransforms("young", [{ op: "map", mapping: { young: "Student" } }], ctx)).toBe("Student")
    })
    it("returns empty when key missing", () => {
      expect(applyTransforms("unknown", [{ op: "map", mapping: { young: "Student" } }], ctx)).toBe("")
    })
    it("returns empty for null", () => {
      expect(applyTransforms(null, [{ op: "map", mapping: { young: "Student" } }], ctx)).toBe("")
    })
  })

  describe("prompt_excerpt", () => {
    it("returns original short prompt", () => {
      expect(applyTransforms("short", [{ op: "prompt_excerpt" }], ctx)).toBe("short")
    })
    it("extracts sections 1-2 when numbered list present", () => {
      const prompt = "intro\n1、first section\n2、second section\n3、third section"
      const out = applyTransforms(prompt, [{ op: "prompt_excerpt" }], ctx)
      expect(out).toContain("first section")
      expect(out).toContain("second section")
      expect(out).not.toContain("third section")
    })
    it("respects custom maxLen", () => {
      const long = "a".repeat(800)
      const out = applyTransforms(long, [{ op: "prompt_excerpt", maxLen: 50 }], ctx)
      expect(out.length).toBeLessThanOrEqual(53) // 50 + "..."
    })
  })

  describe("spu_desc_list", () => {
    it("formats object with spus array", () => {
      const v = { spus: [{ spu_name: "A", description: "desc A" }, { spu_name: "B", description: "desc B" }] }
      expect(applyTransforms(v, [{ op: "spu_desc_list" }], ctx)).toBe("A: desc A\nB: desc B")
    })
    it("skips spus without description", () => {
      const v = { spus: [{ spu_name: "A", description: null }, { spu_name: "B", description: "B" }] }
      expect(applyTransforms(v, [{ op: "spu_desc_list" }], ctx)).toBe("B: B")
    })
    it("respects maxSpus", () => {
      const v = { spus: [1, 2, 3, 4, 5].map(i => ({ spu_name: `n${i}`, description: `d${i}` })) }
      const out = applyTransforms(v, [{ op: "spu_desc_list", maxSpus: 2 }], ctx)
      expect(out.split("\n")).toHaveLength(2)
    })
    it("truncates description to maxCharsPerSpu", () => {
      const v = { spus: [{ spu_name: "a", description: "x".repeat(500) }] }
      const out = applyTransforms(v, [{ op: "spu_desc_list", maxCharsPerSpu: 10 }], ctx)
      expect(out).toBe("a: xxxxxxxxxx")
    })
    it("returns empty for missing spus", () => {
      expect(applyTransforms(null, [{ op: "spu_desc_list" }], ctx)).toBe("")
      expect(applyTransforms({}, [{ op: "spu_desc_list" }], ctx)).toBe("")
    })
  })

  describe("js", () => {
    it("runs custom fn", () => {
      expect(applyTransforms(5, [{ op: "js", fn: "return v * 2" }], ctx)).toBe("10")
    })
    it("returns empty on error", () => {
      expect(applyTransforms(5, [{ op: "js", fn: "throw new Error('x')" }], ctx)).toBe("")
    })
  })

  it("chains multiple steps", () => {
    const out = applyTransforms([1, 2, 3, 4, 5], [
      { op: "slice", start: 0, end: 3 },
      { op: "join", sep: "-" },
      { op: "truncate", max: 4 },
    ], ctx)
    expect(out).toBe("1-2-...")
  })
})

describe("readPath", () => {
  it("reads literals", () => {
    expect(readPath({}, "literal:hello")).toBe("hello")
    expect(readPath({}, "literal:")).toBe("")
  })
  it("reads nested path from alias", () => {
    const inputs = { qa: { question: "What?", nested: { deep: 42 } } }
    expect(readPath(inputs, "qa.question")).toBe("What?")
    expect(readPath(inputs, "qa.nested.deep")).toBe(42)
  })
  it("returns undefined for missing alias", () => {
    expect(readPath({}, "qa.field")).toBeUndefined()
  })
  it("returns undefined for missing intermediate", () => {
    expect(readPath({ qa: {} }, "qa.nested.deep")).toBeUndefined()
  })
  it("reads top-level alias object", () => {
    const inputs = { qa: { question: "x" } }
    expect(readPath(inputs, "qa")).toEqual({ question: "x" })
  })
})
