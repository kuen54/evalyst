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

describe("confirmGateHook session allow list short-circuit (v2.5 M3)", () => {
  const destructiveTool = makeTool({
    isReadOnly: false,
    isDestructive: true,
    maxResultSizeChars: 1000,
  })

  it("require_confirm when session_allow_list undefined", async () => {
    const r = await confirmGateHook({
      tool: destructiveTool, input: {}, session_id: "s", session_allow_list: undefined,
    })
    expect(r.action).toBe("require_confirm")
  })

  it("require_confirm when tool not in allow list", async () => {
    const r = await confirmGateHook({
      tool: destructiveTool, input: {}, session_id: "s",
      session_allow_list: ["restart_experiment"],
    })
    expect(r.action).toBe("require_confirm")
  })

  it("proceed when tool IS in allow list (short-circuit)", async () => {
    // makeTool uses name "t"; allow "t" explicitly
    const r = await confirmGateHook({
      tool: destructiveTool, input: {}, session_id: "s",
      session_allow_list: ["t"],
    })
    expect(r.action).toBe("proceed")
  })

  it("proceed for read-only tool regardless of allow list", async () => {
    const readOnly = makeTool({ isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 })
    const r = await confirmGateHook({
      tool: readOnly, input: {}, session_id: "s", session_allow_list: [],
    })
    expect(r.action).toBe("proceed")
  })
})

describe("confirmGateHook deny short-circuit (v2.5 P0 §3.3)", () => {
  const writeTool = makeTool({ isReadOnly: false, isDestructive: true, maxResultSizeChars: 1000 })

  it("deny when tool in deny_list (action: 'deny')", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_deny_list: ["t"],
    })
    expect(r.action).toBe("deny")
    if (r.action === "deny") expect(r.reason.toLowerCase()).toContain("denied")
  })

  it("require_confirm when tool not in deny_list (destructive default)", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_deny_list: ["other_tool"],
    })
    expect(r.action).toBe("require_confirm")
  })

  it("deny > allow priority: in both lists → deny wins", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_allow_list: ["t"],
      session_deny_list: ["t"],
    })
    expect(r.action).toBe("deny")
  })

  it("deny_list undefined: allow short-circuit still works", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_allow_list: ["t"],
      // no deny list
    })
    expect(r.action).toBe("proceed")
  })
})
