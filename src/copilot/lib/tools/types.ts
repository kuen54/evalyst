// Copilot v2 tool descriptor 类型。每个工具文件 export 一个 ToolDescriptor。
// Registry 手动 array 聚合（见 registry.ts）。metadata 字段参与 Confirm gate、落盘阈值、micro-compact。

import type { ToolResult } from "./tool-result"

export interface ToolMetadata {
  /** 读工具为 true，参与 micro-compact（旧结果可压成 summary + ref） */
  isReadOnly: boolean
  /** 写 / 破坏性工具为 true，默认触发 preToolCall Confirm */
  isDestructive: boolean
  /** 显式覆盖 isDestructive 的默认 Confirm 策略（undefined = 跟 isDestructive） */
  requiresConfirm?: boolean
  /** 序列化后超过这个字节走 maybePersistToolResult 落盘 + ref */
  maxResultSizeChars: number
  /** 预留：并行 dispatch 是否安全。当前不消费 */
  isConcurrencySafe?: boolean
}

/**
 * Client-safe slice of a ToolDescriptor — name + description + inputSchema +
 * metadata. `.metadata.ts` files export this shape; `client-registry.ts`
 * consolidates them so UI components can render Confirm gates, badges, etc.
 * without pulling server-only dependencies (fs / store / etc.).
 */
export type ToolMetadataDescriptor = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  metadata: ToolMetadata
}

export interface ToolContext {
  /** 当前 copilot session id，工具实现通过它访问 snapshot-cache / tool-result-store */
  session_id: string
  /** request-scoped abort，长跑工具应监听 */
  signal: AbortSignal
}

export interface ToolDescriptor<Input = unknown, Output = unknown> {
  name: string
  description: string
  /** JSON Schema 子集，用于 LLM tool 声明与参数校验 */
  inputSchema: Record<string, unknown>
  /** 可选；未来做输出类型校验用 */
  outputSchema?: Record<string, unknown>
  metadata: ToolMetadata
  /**
   * v2.5 P2: 推荐返 `ToolResult<Output>`（显式 ok/err）。
   * **向后兼容**：直接返 `Output`（被视为 ok）；`throw Error` 被 runTool wrap 成 INTERNAL error。
   */
  call: (input: Input, ctx: ToolContext) => Promise<Output | ToolResult<Output>>
}
