import { describe, it, expect } from "vitest"
import { TOOLS } from "../server-registry"
import { CLIENT_TOOLS } from "../client-registry"

/**
 * Plan §6 R1 — verify server descriptor.metadata is THE SAME object reference
 * as the client metadata. Each {name}.server.ts spreads the metadata from
 * {name}.metadata.ts via shallow copy (`{ ...xxxMetadata, call: ... }`), so
 * the nested `metadata` field stays as the same reference. If a future
 * refactor inadvertently deep-copies (e.g. via JSON.parse(JSON.stringify(...)))
 * this test fails immediately — prevents drift between server runtime gating
 * and client UI gating.
 */
describe("tools metadata identity", () => {
  it("server and client agree on the set of tool names", () => {
    const serverNames = new Set(TOOLS.map((t) => t.name))
    const clientNames = new Set(CLIENT_TOOLS.map((t) => t.name))
    expect(clientNames).toEqual(serverNames)
  })

  it("server descriptor.metadata === client metadata.metadata (same reference)", () => {
    for (const clientMeta of CLIENT_TOOLS) {
      const serverTool = TOOLS.find((t) => t.name === clientMeta.name)
      expect(serverTool, `tool ${clientMeta.name} missing from server registry`).toBeDefined()
      // Reference equality, not structural — proves no deep copy in the spread chain.
      expect(serverTool!.metadata).toBe(clientMeta.metadata)
    }
  })

  it("server descriptor and client metadata agree on inputSchema (same reference)", () => {
    for (const clientMeta of CLIENT_TOOLS) {
      const serverTool = TOOLS.find((t) => t.name === clientMeta.name)
      expect(serverTool!.inputSchema).toBe(clientMeta.inputSchema)
    }
  })
})
