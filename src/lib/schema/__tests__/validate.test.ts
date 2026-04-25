import { describe, it, expect } from "vitest"
import { validateJson } from "@/lib/schema/validate"
import type { JsonSchemaDef } from "@/lib/schema/types"

describe("validateJson", () => {
  it("rejects non-object top-level", () => {
    expect(validateJson(null, { type: "object" }).ok).toBe(false)
    expect(validateJson([], { type: "object" }).ok).toBe(false)
    expect(validateJson("x", { type: "object" }).ok).toBe(false)
  })

  it("enforces required", () => {
    const schema: JsonSchemaDef = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "string" } },
    }
    expect(validateJson({ a: "x" }, schema).ok).toBe(true)
    expect(validateJson({ b: "x" }, schema).ok).toBe(false)
  })

  describe("string", () => {
    const schema: JsonSchemaDef = { properties: { s: { type: "string", min_length: 2, max_length: 5 } } }
    it("accepts in-range strings", () => {
      expect(validateJson({ s: "abc" }, schema).ok).toBe(true)
    })
    it("rejects too-short", () => {
      expect(validateJson({ s: "a" }, schema).ok).toBe(false)
    })
    it("rejects too-long", () => {
      expect(validateJson({ s: "abcdef" }, schema).ok).toBe(false)
    })
    it("rejects non-string", () => {
      expect(validateJson({ s: 1 }, schema).ok).toBe(false)
    })
    it("enforces enum", () => {
      const s: JsonSchemaDef = { properties: { s: { type: "string", enum: ["a", "b"] } } }
      expect(validateJson({ s: "a" }, s).ok).toBe(true)
      expect(validateJson({ s: "c" }, s).ok).toBe(false)
    })
  })

  describe("number", () => {
    const schema: JsonSchemaDef = { properties: { n: { type: "number", enum: [1, 2, 3] } } }
    it("accepts enum values", () => {
      expect(validateJson({ n: 2 }, schema).ok).toBe(true)
    })
    it("rejects out-of-enum", () => {
      expect(validateJson({ n: 5 }, schema).ok).toBe(false)
    })
    it("rejects non-number", () => {
      expect(validateJson({ n: "1" }, schema).ok).toBe(false)
    })
  })

  describe("boolean", () => {
    const schema: JsonSchemaDef = { properties: { b: { type: "boolean" } } }
    it("accepts bool", () => {
      expect(validateJson({ b: true }, schema).ok).toBe(true)
      expect(validateJson({ b: false }, schema).ok).toBe(true)
    })
    it("rejects non-bool", () => {
      expect(validateJson({ b: 1 }, schema).ok).toBe(false)
    })
  })

  describe("string|null", () => {
    const schema: JsonSchemaDef = { properties: { s: { type: "string|null" } } }
    it("accepts null", () => {
      expect(validateJson({ s: null }, schema).ok).toBe(true)
    })
    it("accepts string", () => {
      expect(validateJson({ s: "x" }, schema).ok).toBe(true)
    })
    it("rejects number", () => {
      expect(validateJson({ s: 1 }, schema).ok).toBe(false)
    })
  })

  describe("tuple:number[]", () => {
    const schema: JsonSchemaDef = { properties: { p: { type: "tuple:number[]", tuple_len: 2 } } }
    it("accepts matching length", () => {
      expect(validateJson({ p: [1, 2] }, schema).ok).toBe(true)
    })
    it("rejects wrong length", () => {
      expect(validateJson({ p: [1] }, schema).ok).toBe(false)
      expect(validateJson({ p: [1, 2, 3] }, schema).ok).toBe(false)
    })
    it("rejects non-array", () => {
      expect(validateJson({ p: "ab" }, schema).ok).toBe(false)
    })
    it("rejects non-number item", () => {
      expect(validateJson({ p: [1, "x"] }, schema).ok).toBe(false)
    })
  })

  describe("array", () => {
    const schema: JsonSchemaDef = { properties: { a: { type: "array", items: { type: "string" } } } }
    it("accepts matching items", () => {
      expect(validateJson({ a: ["x", "y"] }, schema).ok).toBe(true)
    })
    it("rejects bad item", () => {
      expect(validateJson({ a: ["x", 1] }, schema).ok).toBe(false)
    })
    it("accepts empty array", () => {
      expect(validateJson({ a: [] }, schema).ok).toBe(true)
    })
  })

  describe("object (nested)", () => {
    const schema: JsonSchemaDef = {
      type: "object",
      required: ["titles"],
      properties: {
        titles: {
          type: "object",
          required: ["a", "b"],
          properties: {
            a: { type: "string" },
            b: { type: "string" },
          },
        },
      },
    }
    it("accepts full nested", () => {
      expect(validateJson({ titles: { a: "x", b: "y" } }, schema).ok).toBe(true)
    })
    it("rejects missing nested required", () => {
      expect(validateJson({ titles: { a: "x" } }, schema).ok).toBe(false)
    })
    it("rejects non-object nested", () => {
      expect(validateJson({ titles: "x" }, schema).ok).toBe(false)
    })
  })
})
