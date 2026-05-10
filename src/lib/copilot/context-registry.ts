// ---------- Copilot Context Registry ----------
// 前端 util：从 DOM 元素里读 data-copilot-context* 属性，得到一个结构化 CapturedContext。
// 服务端 resolve 在 /api/copilot/contexts/resolve 里按 type 路由到真正的 store。
//
// 约定：每个可被圈选的 DOM 节点必须有 data-copilot-context="<type>" + data-copilot-context-id="<id>"。
// 可选：data-copilot-context-extra（JSON 字符串，例如 task_result 的 experiment_id）。
// 可选：data-copilot-context-summary（一句话摘要，纯展示用）。

import type { CopilotContextRef } from './types'

/** 已知 context 类型白名单（前后端都必须能认）。新增一种要三处改：这里 + resolve route + 对应页面 data-attr 布点。 */
export const KNOWN_CONTEXT_TYPES = [
  'experiment',
  'task_result',
  'task_field',
  'text_selection',
  'template',
  'dataset',
  'display',
  'rubric',
  'rubric_stats',
] as const

export type KnownContextType = (typeof KNOWN_CONTEXT_TYPES)[number]

export interface CapturedFromDom {
  type: string
  id: string
  extra?: Record<string, unknown>
  summary?: string
  elementKey: string // "type:id"，跨路由重建 mask 用
}

/** 从 DOM Element 捕获 context；找不到合法 type+id 返回 null。 */
export function captureFromElement(el: Element | null): CapturedFromDom | null {
  if (!el) return null
  const host = el.closest('[data-copilot-context]') as HTMLElement | null
  if (!host) return null
  const type = host.dataset.copilotContext
  const id = host.dataset.copilotContextId
  if (!type || !id) return null
  if (!(KNOWN_CONTEXT_TYPES as readonly string[]).includes(type)) return null

  let extra: Record<string, unknown> | undefined
  const rawExtra = host.dataset.copilotContextExtra
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra)
      if (parsed && typeof parsed === 'object') extra = parsed as Record<string, unknown>
    } catch { /* ignore malformed */ }
  }

  const summary = host.dataset.copilotContextSummary

  return {
    type,
    id,
    ...(extra !== undefined ? { extra } : {}),
    ...(summary !== undefined ? { summary } : {}),
    elementKey: elementKey(type, id, extra),
  }
}

/**
 * 跨路由重建 mask 用的稳定 key。
 * task_result / task_field 是 per-experiment 的：compare 页两个实验会共享 task_id，
 * elementKey 必须带 experiment_id 才能让两张卡片当成不同 context（否则去重/查询都会错位）。
 */
export function elementKey(type: string, id: string, extra?: Record<string, unknown>): string {
  if (type === 'task_result' || type === 'task_field') {
    const expId = (extra as { experiment_id?: string } | undefined)?.experiment_id
    if (expId) return `${type}:${expId}/${id}`
  }
  return `${type}:${id}`
}

/** 沿 DOM 向上收集所有 data-copilot-context 祖先（内到外顺序）。常用于"我选了这个文本，它属于哪张卡、哪个实验"这类层级关系。
 *
 *  @param el 起点。会从 el 的 parentElement 开始向上找；如果想包含 el 自身，传 el 的父元素。
 *  @returns 内到外的链（数组第一项是最近祖先，最后一项是最外层）。
 */
export function collectAncestorChain(el: Element | null): Array<{ type: string; id: string; extra?: Record<string, unknown> }> {
  const chain: Array<{ type: string; id: string; extra?: Record<string, unknown> }> = []
  if (!el) return chain
  let cur: HTMLElement | null = el.closest('[data-copilot-context]') as HTMLElement | null
  const seen = new Set<HTMLElement>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const type = cur.dataset.copilotContext
    const id = cur.dataset.copilotContextId
    if (!type || !id) break
    if (!(KNOWN_CONTEXT_TYPES as readonly string[]).includes(type)) break
    let extra: Record<string, unknown> | undefined
    const raw = cur.dataset.copilotContextExtra
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') extra = parsed as Record<string, unknown>
      } catch { /* ignore */ }
    }
    chain.push({ type, id, ...(extra !== undefined ? { extra } : {}) })
    cur = cur.parentElement?.closest('[data-copilot-context]') as HTMLElement | null
  }
  return chain
}

/** 解析 elementKey 回来（兼容老格式，含新增的 expId 前缀） */
export function parseElementKey(key: string): { type: string; id: string; extra?: Record<string, unknown> } | null {
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  const type = key.slice(0, idx)
  const rest = key.slice(idx + 1)
  if ((type === 'task_result' || type === 'task_field') && rest.includes('/')) {
    const slash = rest.indexOf('/')
    return {
      type,
      id: rest.slice(slash + 1),
      extra: { experiment_id: rest.slice(0, slash) },
    }
  }
  return { type, id: rest }
}

/**
 * 在当前文档里找回被圈元素（路由切换后 re-mount 时用）。
 * task_result / task_field 跨实验共享 task_id：传 extra.experiment_id 过滤拿到正确那张。
 */
export function queryContextElement(
  type: string,
  id: string,
  extra?: Record<string, unknown>,
): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const expId = (extra as { experiment_id?: string } | undefined)?.experiment_id
  if ((type === 'task_result' || type === 'task_field') && expId) {
    const candidates = document.querySelectorAll<HTMLElement>(
      `[data-copilot-context="${cssEscape(type)}"][data-copilot-context-id="${cssEscape(id)}"]`,
    )
    for (const el of Array.from(candidates)) {
      const raw = el.dataset.copilotContextExtra
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as { experiment_id?: string }
        if (parsed.experiment_id === expId) return el
      } catch { /* ignore */ }
    }
    return (candidates[0] as HTMLElement | undefined) ?? null
  }
  return document.querySelector<HTMLElement>(
    `[data-copilot-context="${cssEscape(type)}"][data-copilot-context-id="${cssEscape(id)}"]`,
  )
}

/** CSS.escape polyfill —— 大多数浏览器内置了，用 any 绕过类型 */
function cssEscape(v: string): string {
  if (typeof window !== 'undefined' && typeof (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === 'function') {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(v)
  }
  // 简化版：只转义反斜杠 + 引号
  return v.replace(/["\\]/g, '\\$&')
}

/** captured → 发给后端的 ref（strip UI 专用字段） */
export function toContextRef(c: CapturedFromDom & { tag: number }): CopilotContextRef {
  return {
    tag: c.tag,
    type: c.type,
    id: c.id,
    ...(c.extra !== undefined ? { extra: c.extra } : {}),
  }
}
