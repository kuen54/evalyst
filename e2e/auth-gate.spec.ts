import { test, expect } from "@playwright/test"

/**
 * Auth gate regression suite — exercises the middleware introduced
 * in fix/auth-gate-rce. The middleware uses Sec-Fetch-Site to allow
 * first-party requests and rejects cross-site requests unless the
 * origin appears in EVALYST_ALLOW_ORIGIN.
 *
 * Notes:
 *   - Playwright's `request` fixture does NOT send Sec-Fetch-Site by
 *     default, which the middleware treats as a non-browser caller
 *     (curl / agent). That gives us the "same-origin / curl" baseline
 *     for free.
 *   - Cross-site is simulated by setting the header explicitly.
 *   - The fourth scenario (EVALYST_ALLOW_ORIGIN allowlist) is checked
 *     by hand locally — overriding env on the running dev server from
 *     a single Playwright spec is fragile across reuseExistingServer
 *     scenarios. The header pathway it exercises is identical to the
 *     cross-site reject path (just an additional includes() check).
 */

test("api request without Sec-Fetch-Site is allowed (curl / agent baseline)", async ({ request }) => {
  const resp = await request.get("/api/datasets")
  expect(resp.status()).toBeLessThan(400)
})

test("cross-site api request is rejected with 403", async ({ request }) => {
  const resp = await request.get("/api/datasets", {
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.com",
    },
  })
  expect(resp.status()).toBe(403)
})

test("/api/skills/[name] is public even from cross-site origins", async ({ request }) => {
  const resp = await request.get("/api/skills/evalyst-dataset", {
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://anything.example.com",
    },
  })
  expect(resp.status()).toBe(200)
  expect(resp.headers()["content-type"]).toContain("text/markdown")
})

test("same-origin sec-fetch-site is allowed", async ({ request }) => {
  const resp = await request.get("/api/datasets", {
    headers: { "sec-fetch-site": "same-origin" },
  })
  expect(resp.status()).toBeLessThan(400)
})

test("/api/llm-config GET returns masked api_key (no plaintext leak)", async ({ request }) => {
  const resp = await request.get("/api/llm-config")
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  // Either there are no models configured (empty test env) or every
  // returned model has a masked key — we never want to see plaintext.
  for (const m of body.models ?? []) {
    if (m.api_key) {
      expect(m.api_key).toMatch(/^sk-\*\*\*.{0,4}$/)
    }
  }
})
