import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { buildRequestBodyForTest } from "@/lib/llm-client"
import type { CallLlmParams } from "@/lib/llm-client"

const baseTextMessages: CallLlmParams["messages"] = [
  { role: "user", content: "hi" },
]

function openaiParams(overrides: Partial<CallLlmParams> = {}): CallLlmParams {
  return {
    messages: baseTextMessages,
    config: {
      api_format: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-test",
    },
    model: "gpt-4o-mini",
    temperature: 1,
    max_tokens: 4096,
    ...overrides,
  }
}

function anthropicParams(overrides: Partial<CallLlmParams> = {}): CallLlmParams {
  return {
    messages: baseTextMessages,
    config: {
      api_format: "anthropic",
      base_url: "https://api.anthropic.com/v1",
      api_key: "sk-ant-test",
    },
    model: "claude-opus",
    temperature: 1,
    max_tokens: 4096,
    ...overrides,
  }
}

describe("OpenAI seed transparently passed", () => {
  it("seed: 42 → body.seed === 42 (numeric value flows through)", () => {
    const body = buildRequestBodyForTest(openaiParams({ seed: 42 }))
    expect(body.seed).toBe(42)
  })

  it("seed: 0 → body.seed === 0 (zero is a legal seed; not coerced to falsy-skip)", () => {
    const body = buildRequestBodyForTest(openaiParams({ seed: 0 }))
    expect(body.seed).toBe(0)
  })

  it("seed: undefined → 'seed' key is OMITTED from body (not present as undefined)", () => {
    // Some OpenAI-compatible gateways reject `{"seed": null}` or `{"seed": undefined}`
    // payloads. The contract: when caller doesn't set seed, the request must look
    // exactly like before this feature shipped.
    const body = buildRequestBodyForTest(openaiParams({ seed: undefined } as unknown as Partial<CallLlmParams>))
    expect("seed" in body).toBe(false)
  })

  it("seed not passed → 'seed' key is OMITTED from body (golden path)", () => {
    const body = buildRequestBodyForTest(openaiParams())
    expect("seed" in body).toBe(false)
  })
})

describe("Anthropic does not support seed → drop with warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("seed: 42 → 'seed' key is OMITTED from body + console.warn fired once", () => {
    const body = buildRequestBodyForTest(anthropicParams({ seed: 42 }))
    expect("seed" in body).toBe(false)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "")
    // Message must mention seed (so logs are searchable) and the value (so the
    // user sees what was dropped) — exact wording can change, the assertions
    // here are deliberately loose.
    expect(msg).toMatch(/seed/i)
    expect(msg).toMatch(/42/)
  })

  it("seed: undefined → no warn; key not in body (golden path, no log spam)", () => {
    const body = buildRequestBodyForTest(anthropicParams({ seed: undefined } as unknown as Partial<CallLlmParams>))
    expect("seed" in body).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("seed: 0 (legal seed) is also dropped + warned (Anthropic is consistent across values)", () => {
    const body = buildRequestBodyForTest(anthropicParams({ seed: 0 }))
    expect("seed" in body).toBe(false)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe("seed does not interact with other body fields", () => {
  it("OpenAI: existing fields (model / temperature / max_tokens / messages / stream) preserved", () => {
    const body = buildRequestBodyForTest(openaiParams({ seed: 7 }))
    expect(body.model).toBe("gpt-4o-mini")
    expect(body.temperature).toBe(1)
    expect(body.max_tokens).toBe(4096)
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual(baseTextMessages)
  })

  it("Anthropic: system + messages still split as expected when seed is dropped", () => {
    const params = anthropicParams({
      seed: 42,
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
      ],
    })
    const body = buildRequestBodyForTest(params)
    expect(body.system).toBe("be helpful")
    expect(body.messages).toEqual([{ role: "user", content: "hi" }])
    expect("seed" in body).toBe(false)
  })
})
