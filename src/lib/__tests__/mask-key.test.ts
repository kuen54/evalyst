import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { maskKey, getLlmConfig, saveLlmConfig } from "../llm-config"

describe("maskKey", () => {
  it("keeps last 4 chars of long key", () => {
    expect(maskKey("sk-proj-abc1234567890XYZW")).toBe("sk-***XYZW")
  })

  it("masks short key (still keeps last 4)", () => {
    expect(maskKey("abcd")).toBe("sk-***abcd")
    expect(maskKey("abc")).toBe("sk-***abc")
  })

  it("returns empty for empty / nullish input", () => {
    expect(maskKey("")).toBe("")
    expect(maskKey(undefined)).toBe("")
    expect(maskKey(null)).toBe("")
  })

  it("masked output round-trips through saveLlmConfig (real key preserved)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-maskkey-"))
    const oldCwd = process.cwd()
    process.chdir(tmp)
    try {
      // Seed an initial real key on disk.
      saveLlmConfig({
        models: [
          {
            id: "m1",
            name: "Test",
            model: "test-model",
            api_format: "openai",
            base_url: "https://api.example.com",
            api_key: "sk-real-secret-1234",
          },
        ],
        active_model_id: "m1",
      })

      // Simulate the UI round-trip: client GET-ed mask, edited an unrelated
      // field, PUT the whole cfg back. The api_key field still carries the
      // mask placeholder.
      const masked = maskKey("sk-real-secret-1234") // 'sk-***1234'
      saveLlmConfig({
        models: [
          {
            id: "m1",
            name: "Test (renamed)",  // unrelated field changed
            model: "test-model",
            api_format: "openai",
            base_url: "https://api.example.com",
            api_key: masked,
          },
        ],
        active_model_id: "m1",
      })

      const after = getLlmConfig()
      expect(after.models[0].api_key).toBe("sk-real-secret-1234")
      expect(after.models[0].name).toBe("Test (renamed)")
    } finally {
      process.chdir(oldCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("explicit plaintext key overwrites the stored one", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-maskkey-"))
    const oldCwd = process.cwd()
    process.chdir(tmp)
    try {
      saveLlmConfig({
        models: [
          { id: "m1", name: "T", model: "x", api_format: "openai", base_url: "https://x", api_key: "sk-old" },
        ],
        active_model_id: "m1",
      })
      saveLlmConfig({
        models: [
          { id: "m1", name: "T", model: "x", api_format: "openai", base_url: "https://x", api_key: "sk-new-explicit" },
        ],
        active_model_id: "m1",
      })
      expect(getLlmConfig().models[0].api_key).toBe("sk-new-explicit")
    } finally {
      process.chdir(oldCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("explicit empty string clears the stored key", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-maskkey-"))
    const oldCwd = process.cwd()
    process.chdir(tmp)
    try {
      saveLlmConfig({
        models: [
          { id: "m1", name: "T", model: "x", api_format: "openai", base_url: "https://x", api_key: "sk-old" },
        ],
        active_model_id: "m1",
      })
      saveLlmConfig({
        models: [
          { id: "m1", name: "T", model: "x", api_format: "openai", base_url: "https://x", api_key: "" },
        ],
        active_model_id: "m1",
      })
      expect(getLlmConfig().models[0].api_key).toBe("")
    } finally {
      process.chdir(oldCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
