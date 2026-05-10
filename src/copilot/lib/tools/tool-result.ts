export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'USER_DENIED'
  | 'AWAITING_CONFIRM'
  | 'INTERNAL'

export interface ToolError {
  code: ToolErrorCode
  message: string
  hint?: string
  retry_safe?: boolean
}

export type ToolResult<Output> =
  | { ok: true; value: Output }
  | { ok: false; error: ToolError }

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

export function err(
  code: ToolErrorCode,
  message: string,
  opts?: { hint?: string; retry_safe?: boolean },
): { ok: false; error: ToolError } {
  return { ok: false, error: { code, message, ...opts } }
}

/**
 * 谓词：检测一段已序列化的 tool_result 对象是否 error shape。
 *
 * 覆盖 5 种形态：
 *   - 新 ToolResult err: { ok: false, error: {...} }
 *   - 新 ToolResult ok: { ok: true, value: ... } → false
 *   - 旧 ad-hoc: { error: <string|object> }
 *   - 旧 deny: { denied: true, reason }
 *   - 普通 object → false
 */
export function isToolErrorShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.ok === false && typeof obj.error === 'object' && obj.error !== null) return true
  if (obj.ok === true) return false
  if ('error' in obj) return true
  if (obj.denied === true) return true
  return false
}
