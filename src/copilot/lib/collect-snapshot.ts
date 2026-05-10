// Client-side: scan the DOM for all [data-copilot-context] elements and build a
// lightweight ViewportIndexEntry[] snapshot. Paired with getPageContext() from
// the route's useRegisterPageContext call to form a full ClientSnapshot, sent
// to the server with every /chat and /tool-result POST.

import { captureFromElement } from './context-registry'
import type { ClientSnapshot, PageContext, ViewportIndexEntry } from './types'

const PREVIEW_MAX = 200

/** Collapse whitespace + truncate to PREVIEW_MAX chars with ellipsis. */
export function truncatePreview(s: string): string {
  const norm = s.replace(/\s+/g, ' ').trim()
  if (norm.length <= PREVIEW_MAX) return norm
  return norm.slice(0, PREVIEW_MAX - 3) + '…'
}

function collectAncestorKeys(el: HTMLElement | null): string[] {
  const keys: string[] = []
  let cur: HTMLElement | null = el
  while (cur) {
    const captured = captureFromElement(cur)
    if (captured) keys.push(captured.elementKey)
    cur = cur.parentElement
  }
  return keys
}

/** Scan the current DOM for context nodes and build a snapshot. */
export function collectClientSnapshot(
  sessionId: string,
  pageContext: PageContext,
): ClientSnapshot {
  const viewport_index: ViewportIndexEntry[] = []
  if (typeof document !== 'undefined') {
    const nodes = document.querySelectorAll<HTMLElement>('[data-copilot-context][data-copilot-context-id]')
    for (const el of Array.from(nodes)) {
      const captured = captureFromElement(el)
      if (!captured) continue
      const preview_text = truncatePreview(el.textContent ?? '')
      const ancestors = collectAncestorKeys(el.parentElement)
      viewport_index.push({
        key: captured.elementKey,
        type: captured.type,
        preview_text,
        ...(ancestors.length > 0 ? { ancestors } : {}),
      })
    }
  }
  return {
    session_id: sessionId,
    route_type: pageContext.route_type,
    path: pageContext.path,
    ...(pageContext.search_params !== undefined ? { search_params: pageContext.search_params } : {}),
    page_context: pageContext,
    viewport_index,
    timestamp: new Date().toISOString(),
  }
}
