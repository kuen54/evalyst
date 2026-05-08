// src/lib/copilot/session-allow.ts
//
// spec §8: 会话级 alwaysAllow。
// - `isSessionAllowed`：纯函数，client + server 共用（服务端 confirmGateHook 防御层）
// - `getSessionAllowList` / `addSessionAllow`：sessionStorage helpers，仅客户端（SSR / server 调用会直接 no-op）
//
// 隐私默认：sessionStorage 是 per-tab + 会话关即清，完全不持久化跨 session / 跨 tab。
// spec §8.3 明确不做 4 源 / alwaysDeny / alwaysAsk / pattern 匹配。

const KEY = (sessionId: string) => `evalyst-copilot-allow-${sessionId}`

/**
 * 纯函数：client 和 server 都用。
 * 服务端 `confirmGateHook` 从 body.session_allow_list 收到数组后调这个判断；
 * 客户端 SSE handler 把 sessionStorage 读出来调这个判断。
 */
export function isSessionAllowed(
  allowList: string[] | undefined,
  toolName: string,
): boolean {
  return Array.isArray(allowList) && allowList.includes(toolName)
}

// ---------- sessionStorage helpers（client only）----------

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

export function getSessionAllowList(sessionId: string): string[] {
  if (!isBrowser()) return []
  try {
    const raw = sessionStorage.getItem(KEY(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

export function addSessionAllow(sessionId: string, toolName: string): void {
  if (!isBrowser()) return
  try {
    const current = getSessionAllowList(sessionId)
    if (current.includes(toolName)) return
    const next = [...current, toolName]
    sessionStorage.setItem(KEY(sessionId), JSON.stringify(next))
  } catch {
    // 静默失败：隐私模式 / quota 满 / 其他异常都不影响主流程
  }
}
