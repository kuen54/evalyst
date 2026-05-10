// In-memory per-session snapshot cache (server-only).
// Lifetime: latest snapshot per session; overwritten on every /chat or /tool-result POST.
// Cleared when session is DELETE'd. Lost on process restart — read_page returns "no snapshot" gracefully.
// For single-process local dev. Multi-process (e.g. Vercel) would need Redis; out of scope for v1.

import type { ClientSnapshot } from './types'

const cache = new Map<string, ClientSnapshot>()

export function setSnapshot(sessionId: string, snapshot: ClientSnapshot): void {
  cache.set(sessionId, snapshot)
}

export function getSnapshot(sessionId: string): ClientSnapshot | undefined {
  return cache.get(sessionId)
}

export function deleteSnapshot(sessionId: string): void {
  cache.delete(sessionId)
}
