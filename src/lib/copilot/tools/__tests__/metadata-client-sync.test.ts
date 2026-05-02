import { describe, it, expect } from "vitest"
import { TOOLS } from "../registry"
import { CLIENT_TOOL_METADATA } from "../metadata-client"

describe("metadata-client <-> registry sync", () => {
  it("has same set of tool names on both sides", () => {
    const serverNames = new Set(TOOLS.map((t) => t.name))
    const clientNames = new Set(CLIENT_TOOL_METADATA.map((t) => t.name))
    expect(clientNames).toEqual(serverNames)
  })

  it("isReadOnly / isDestructive match per tool", () => {
    for (const clientMeta of CLIENT_TOOL_METADATA) {
      const serverTool = TOOLS.find((t) => t.name === clientMeta.name)
      expect(serverTool, `tool ${clientMeta.name} missing from server registry`).toBeDefined()
      expect(serverTool!.metadata.isReadOnly).toBe(clientMeta.isReadOnly)
      expect(serverTool!.metadata.isDestructive).toBe(clientMeta.isDestructive)
      expect(serverTool!.metadata.requiresConfirm).toBe(clientMeta.requiresConfirm)
    }
  })
})
