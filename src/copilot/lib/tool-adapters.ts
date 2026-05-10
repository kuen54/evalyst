import type { AnyToolDescriptor } from "./tools/registry"

export function toOpenaiTools(tools: readonly AnyToolDescriptor[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

export function toAnthropicTools(tools: readonly AnyToolDescriptor[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}
