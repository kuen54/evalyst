import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { payloadGuardHook } from "../hooks"
import type { AnyToolDescriptor } from "../registry"
import type { ImageRef, ToolResultContent } from "../../types"

function makeTool(
  metadata: Partial<AnyToolDescriptor["metadata"]> = {},
): AnyToolDescriptor {
  return {
    name: "t",
    description: "",
    inputSchema: {},
    metadata: {
      isReadOnly: true,
      isDestructive: false,
      maxResultSizeChars: 1000,
      ...metadata,
    },
    call: async () => ({}),
  } as AnyToolDescriptor
}

const ref1: ImageRef = { url: "/api/results/exp_1/images/a.png", source_label: "task_result#t1 · field=image_url" }
const ref2: ImageRef = { url: "/api/results/exp_1/images/b.png", source_label: "task_result#t2 · field=image_url" }

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-att-"))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("payloadGuardHook · _attachments lift", () => {
  it("inline path: small payload with _attachments → wrapper {kind:'inline', value (stripped), attachments}", async () => {
    const tool = makeTool({ maxResultSizeChars: 10000 })
    const output = { foo: 1, _attachments: [ref1, ref2] }
    const r = (await payloadGuardHook({
      tool,
      input: {},
      output,
      session_id: "s_inline",
    })) as { output: ToolResultContent }
    expect(r.output.kind).toBe("inline")
    if (r.output.kind !== "inline") throw new Error("expected inline")
    expect(r.output.value).toEqual({ foo: 1 })
    expect(r.output.attachments).toEqual([ref1, ref2])
  })

  it("ref path: huge payload with _attachments → wrapper {kind:'ref', preview, ref, attachments}; persisted file has stripped value", async () => {
    const tool = makeTool({ maxResultSizeChars: 100 })
    const big = "x".repeat(5000)
    const output = { body: big, _attachments: [ref1] }
    const r = (await payloadGuardHook({
      tool,
      input: {},
      output,
      session_id: "s_ref",
    })) as { output: ToolResultContent }
    expect(r.output.kind).toBe("ref")
    if (r.output.kind !== "ref") throw new Error("expected ref")
    expect(r.output.attachments).toEqual([ref1])
    expect(r.output.ref.startsWith("ref://tool-result/")).toBe(true)
    expect(typeof r.output.preview).toBe("string")

    // Persisted file has stripped value
    const id = r.output.ref.replace("ref://tool-result/", "")
    const file = path.join(tmpDir, "data", "copilot", "tool-results", "s_ref", `${id}.json`)
    const text = await fs.readFile(file, "utf-8")
    const parsed = JSON.parse(text)
    expect(parsed.body).toBe(big)
    expect(parsed._attachments).toBeUndefined()
  })

  it("no _attachments → unchanged behaviour (no attachments key on wrapper)", async () => {
    const tool = makeTool({ maxResultSizeChars: 10000 })
    const output = { foo: 1 }
    const r = (await payloadGuardHook({
      tool,
      input: {},
      output,
      session_id: "s_plain",
    })) as { output: ToolResultContent }
    expect(r.output.kind).toBe("inline")
    if (r.output.kind !== "inline") throw new Error("expected inline")
    expect(r.output.value).toEqual({ foo: 1 })
    expect(r.output.attachments).toBeUndefined()
  })

  it("non-object output (e.g. string) → no lift attempted, wrapper has no attachments", async () => {
    const tool = makeTool({ maxResultSizeChars: 10000 })
    const r = (await payloadGuardHook({
      tool,
      input: {},
      output: "just a string",
      session_id: "s_str",
    })) as { output: ToolResultContent }
    expect(r.output.kind).toBe("inline")
    if (r.output.kind !== "inline") throw new Error("expected inline")
    expect(r.output.value).toBe("just a string")
    expect(r.output.attachments).toBeUndefined()
  })

  it("_attachments present but not an array → ignored (no lift, value untouched)", async () => {
    const tool = makeTool({ maxResultSizeChars: 10000 })
    const output = { foo: 1, _attachments: "not-an-array" }
    const r = (await payloadGuardHook({
      tool,
      input: {},
      output,
      session_id: "s_bad_att",
    })) as { output: ToolResultContent }
    expect(r.output.kind).toBe("inline")
    if (r.output.kind !== "inline") throw new Error("expected inline")
    expect(r.output.value).toEqual({ foo: 1, _attachments: "not-an-array" })
    expect(r.output.attachments).toBeUndefined()
  })
})
