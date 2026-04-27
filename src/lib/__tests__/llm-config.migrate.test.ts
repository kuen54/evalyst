import { describe, it, expect, afterEach, beforeEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { getLlmConfig, pickModel, findPricing, isLlmConfigured } from "@/lib/llm-config"
import type { LlmConfig } from "@/lib/llm-config"

/**
 * getLlmConfig 读 process.cwd()/data/llm-config.json；
 * 每个 case chdir 到新临时目录，写不同 shape 再读。
 */
let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-cfg-"))
  fs.mkdirSync(path.join(tmp, "data"))
  process.chdir(tmp)
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeCfg(obj: unknown) {
  fs.writeFileSync(path.join(tmp, "data", "llm-config.json"), JSON.stringify(obj, null, 2))
}

describe("getLlmConfig migrate", () => {
  it("handles no file (empty config)", () => {
    const cfg = getLlmConfig()
    expect(cfg.models).toEqual([])
    expect(cfg.active_model_id).toBeUndefined()
  })

  it("V1 legacy single-instance → 1 model + pricing for default_model picked up", () => {
    writeCfg({
      api_format: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-x",
      default_model: "gpt-4o-mini",
      default_temperature: 0.5,
      default_max_tokens: 2048,
      pricing: {
        "gpt-4o-mini": { input_per_mtok: 0.15, output_per_mtok: 0.60, currency: "USD" },
        "other-model": { input_per_mtok: 1, output_per_mtok: 2 },
      },
    })
    const cfg = getLlmConfig()
    expect(cfg.models).toHaveLength(1)
    expect(cfg.active_model_id).toBe("default")
    const m = cfg.models[0]
    expect(m.id).toBe("default")
    expect(m.name).toBe("Default")
    expect(m.model).toBe("gpt-4o-mini")
    expect(m.base_url).toBe("https://api.openai.com/v1")
    expect(m.api_format).toBe("openai")
    expect(m.default_temperature).toBe(0.5)
    expect(m.pricing?.input_per_mtok).toBe(0.15)
    expect(m.pricing?.currency).toBe("USD")
  })

  it("V2 providers shape → models, ids preserved, pricing picked per default_model", () => {
    writeCfg({
      providers: [
        {
          id: "prov-1",
          name: "OpenAI",
          api_format: "openai",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-1",
          default_model: "gpt-4o-mini",
          pricing: { "gpt-4o-mini": { input_per_mtok: 0.15, output_per_mtok: 0.60 } },
        },
        {
          id: "prov-2",
          name: "DeepSeek",
          api_format: "openai",
          base_url: "https://api.deepseek.com",
          api_key: "sk-2",
          default_model: "deepseek-chat",
        },
      ],
      active_provider_id: "prov-2",
      pricing: {
        "deepseek-chat": { input_per_mtok: 1, output_per_mtok: 2, currency: "CNY" },
      },
    })
    const cfg = getLlmConfig()
    expect(cfg.models).toHaveLength(2)
    expect(cfg.active_model_id).toBe("prov-2")
    expect(cfg.models[0].id).toBe("prov-1")
    expect(cfg.models[0].pricing?.input_per_mtok).toBe(0.15)
    expect(cfg.models[1].id).toBe("prov-2")
    expect(cfg.models[1].pricing?.currency).toBe("CNY")
  })

  it("V3 models shape → pass-through", () => {
    writeCfg({
      models: [
        { id: "m1", name: "M1", model: "gpt-4o", api_format: "openai", base_url: "x", api_key: "k" },
      ],
      active_model_id: "m1",
    })
    const cfg = getLlmConfig()
    expect(cfg.models).toHaveLength(1)
    expect(cfg.models[0].id).toBe("m1")
    expect(cfg.active_model_id).toBe("m1")
  })

  it("preserves copilot_enabled flag through migration", () => {
    writeCfg({
      models: [
        { id: "m1", name: "M1", model: "gpt-4o", api_format: "openai", base_url: "x", api_key: "k", copilot_enabled: true },
        { id: "m2", name: "M2", model: "claude", api_format: "anthropic", base_url: "y", api_key: "k2" },
      ],
      active_model_id: "m1",
    })
    const cfg = getLlmConfig()
    expect(cfg.models[0].copilot_enabled).toBe(true)
    expect(cfg.models[1].copilot_enabled).toBeUndefined()
  })
})

describe("pickModel", () => {
  it("picks by id first", () => {
    const cfg: LlmConfig = {
      models: [
        { id: "a", name: "A", model: "ma", api_format: "openai", base_url: "", api_key: "" },
        { id: "b", name: "B", model: "mb", api_format: "openai", base_url: "", api_key: "" },
      ],
      active_model_id: "b",
    }
    expect(pickModel(cfg, "a")?.id).toBe("a")
  })
  it("falls back to active_model_id", () => {
    const cfg: LlmConfig = {
      models: [
        { id: "a", name: "A", model: "ma", api_format: "openai", base_url: "", api_key: "" },
        { id: "b", name: "B", model: "mb", api_format: "openai", base_url: "", api_key: "" },
      ],
      active_model_id: "b",
    }
    expect(pickModel(cfg)?.id).toBe("b")
  })
  it("falls back to models[0]", () => {
    const cfg: LlmConfig = {
      models: [{ id: "a", name: "A", model: "ma", api_format: "openai", base_url: "", api_key: "" }],
    }
    expect(pickModel(cfg)?.id).toBe("a")
  })
  it("returns undefined when empty", () => {
    expect(pickModel({ models: [] })).toBeUndefined()
  })
})

describe("findPricing", () => {
  const cfg: LlmConfig = {
    models: [
      { id: "a", name: "A", model: "gpt-4o", api_format: "openai", base_url: "", api_key: "", pricing: { input_per_mtok: 1, output_per_mtok: 2 } },
      { id: "b", name: "B", model: "other", api_format: "openai", base_url: "", api_key: "" },
    ],
  }
  it("finds by model_id", () => {
    expect(findPricing(cfg, "gpt-4o", "a")?.input_per_mtok).toBe(1)
  })
  it("falls back to model name search", () => {
    expect(findPricing(cfg, "gpt-4o")?.input_per_mtok).toBe(1)
  })
  it("returns undefined for unknown model", () => {
    expect(findPricing(cfg, "unknown")).toBeUndefined()
  })
  it("returns undefined when given model_id doesn't have pricing", () => {
    expect(findPricing(cfg, "other", "b")).toBeUndefined()
  })
})

describe("isLlmConfigured", () => {
  it("true with complete model", () => {
    const cfg: LlmConfig = {
      models: [{ id: "a", name: "A", model: "gpt", api_format: "openai", base_url: "x", api_key: "k" }],
    }
    expect(isLlmConfigured(cfg)).toBe(true)
  })
  it("false with empty", () => {
    expect(isLlmConfigured({ models: [] })).toBe(false)
  })
  it("false with missing api_key", () => {
    const cfg: LlmConfig = {
      models: [{ id: "a", name: "A", model: "gpt", api_format: "openai", base_url: "x", api_key: "" }],
    }
    expect(isLlmConfigured(cfg)).toBe(false)
  })
})
