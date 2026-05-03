import { describe, it, expect } from "vitest"
import { confirmGateHook } from "../hooks"
import type { AnyToolDescriptor } from "../registry"

function makeTool(metadata: AnyToolDescriptor["metadata"]): AnyToolDescriptor {
  return {
    name: "t",
    description: "",
    inputSchema: {},
    metadata,
    call: async () => ({}),
  }
}

describe("confirmGateHook", () => {
  it("read-only non-destructive → proceed", async () => {
    const tool = makeTool({ isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 })
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" })
    expect(r.action).toBe("proceed")
  })

  it("destructive → require_confirm", async () => {
    const tool = makeTool({ isReadOnly: false, isDestructive: true, maxResultSizeChars: 1000 })
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" })
    expect(r.action).toBe("require_confirm")
  })

  it("requiresConfirm: false overrides destructive", async () => {
    const tool = makeTool({
      isReadOnly: false,
      isDestructive: true,
      requiresConfirm: false,
      maxResultSizeChars: 1000,
    })
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" })
    expect(r.action).toBe("proceed")
  })

  it("requiresConfirm: true overrides non-destructive", async () => {
    const tool = makeTool({
      isReadOnly: true,
      isDestructive: false,
      requiresConfirm: true,
      maxResultSizeChars: 1000,
    })
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" })
    expect(r.action).toBe("require_confirm")
  })
})
