import type { CopilotTool } from "./tools"

export function findTool(tools: CopilotTool[], name: string): CopilotTool | null {
  return tools.find(t => t.name === name) ?? null
}

export function assertKnownTool(tools: CopilotTool[], name: string): CopilotTool {
  const t = findTool(tools, name)
  if (!t) throw new Error(`Unknown tool: ${name}. Allowed: ${tools.map(x => x.name).join(", ")}`)
  return t
}
