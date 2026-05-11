import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { probeSessionExists } from "../probe-session"

describe("probeSessionExists", () => {
  const realFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('returns "exists" on 200', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 })
    expect(await probeSessionExists("sess_abc")).toBe("exists")
    expect(global.fetch).toHaveBeenCalledWith("/api/copilot/sessions/sess_abc")
  })

  it('returns "not_found" on 404 — caller should clear stale LS', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 })
    expect(await probeSessionExists("stale_xxx")).toBe("not_found")
  })

  it('returns "unknown" on 500 — transient server error, do NOT clear LS', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })
    expect(await probeSessionExists("sess_abc")).toBe("unknown")
  })

  it('returns "unknown" on network error / fetch throw — do NOT clear LS', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("network"))
    expect(await probeSessionExists("sess_abc")).toBe("unknown")
  })
})
