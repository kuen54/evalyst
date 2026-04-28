// 客户端安全的工具元数据（无 fs 依赖）。
// 服务器端 `./tools.ts` 额外挂 `run()` 实现，不能在 "use client" 组件里 import。
// UI（tool-call-card / chat-view）只需 `name` + `requiresConfirm`，从这里拿。

export interface ToolMetadata {
  name: string
  requiresConfirm: boolean
}

export const toolMetadata: ToolMetadata[] = [
  { name: "list_experiments", requiresConfirm: false },
  { name: "read_experiment_results", requiresConfirm: false },
  { name: "read_page", requiresConfirm: false },
  { name: "restart_experiment", requiresConfirm: true },
]

export function findToolMetadata(name: string): ToolMetadata | null {
  return toolMetadata.find(t => t.name === name) ?? null
}
