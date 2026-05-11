type SessionProbeResult = "exists" | "not_found" | "unknown"

/**
 * Probe whether a session id is still resolvable on the server.
 *
 * Three-state result instead of boolean:
 * - "exists"     200/2xx — caller may safely use the id
 * - "not_found"  404 — definitive evidence; caller should clear stale LS
 * - "unknown"    5xx / network error — ambiguous; caller MUST NOT clear LS
 *                (transient blip would otherwise erase the user's last session pointer)
 */
export async function probeSessionExists(sessionId: string): Promise<SessionProbeResult> {
  try {
    const r = await fetch(`/api/copilot/sessions/${sessionId}`)
    if (r.ok) return "exists"
    if (r.status === 404) return "not_found"
    return "unknown"
  } catch {
    return "unknown"
  }
}
