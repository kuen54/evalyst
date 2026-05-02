import { describe, it, expect } from "vitest"
import { toOpenaiTools, toAnthropicTools } from "../tool-adapters"
import { TOOLS } from "../tools/registry"

describe("toOpenaiTools", () => {
  it("wraps each tool in OpenAI function schema", () => {
    const out = toOpenaiTools(TOOLS)
    expect(out).toHaveLength(TOOLS.length)
    expect(out[0]).toMatchObject({
      type: "function",
      function: { name: expect.any(String), description: expect.any(String), parameters: expect.any(Object) },
    })
  })
})

describe("toAnthropicTools", () => {
  it("exposes name/description/input_schema directly", () => {
    const out = toAnthropicTools(TOOLS)
    expect(out).toHaveLength(TOOLS.length)
    expect(out[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      input_schema: expect.any(Object),
    })
  })
})
