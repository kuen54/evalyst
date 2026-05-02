// Client-safe tool metadata（无 fs / store 依赖）。
// "use client" 组件（tool-call-card / chat-view）只需 name + requiresConfirm + isDestructive / isReadOnly，
// 不能直接 import `./tools/registry.ts`（链路带 `@/lib/store` → fs）。此文件手动镜像。
//
// 增/删工具时：修改 `src/lib/copilot/tools/*.ts` 的 metadata 后，同步在此 array 加/删条目。
// 测试 `src/lib/copilot/tools/__tests__/metadata-client-sync.test.ts` 会强制两边对齐。

export interface ClientToolMetadata {
  name: string
  isReadOnly: boolean
  isDestructive: boolean
  /** 若 undefined，fallback 到 isDestructive */
  requiresConfirm?: boolean
}

export const CLIENT_TOOL_METADATA: ClientToolMetadata[] = [
  { name: "list_experiments", isReadOnly: true, isDestructive: false },
  { name: "read_experiment_results", isReadOnly: true, isDestructive: false },
  { name: "restart_experiment", isReadOnly: false, isDestructive: true },
  { name: "read_page", isReadOnly: true, isDestructive: false },
  { name: "read_tool_result", isReadOnly: true, isDestructive: false },
  { name: "read_context", isReadOnly: true, isDestructive: false },
]

export function findClientToolMetadata(name: string): ClientToolMetadata | null {
  return CLIENT_TOOL_METADATA.find((t) => t.name === name) ?? null
}

/** UI 判断：这个工具调用是否需要用户点 Confirm */
export function needsConfirm(name: string): boolean {
  const meta = findClientToolMetadata(name)
  if (!meta) return false
  return meta.requiresConfirm ?? meta.isDestructive
}
