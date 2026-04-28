import type { CopilotTool } from "./tools"

export function toOpenaiTools(tools: CopilotTool[]) {
  return tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

export function toAnthropicTools(tools: CopilotTool[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}
