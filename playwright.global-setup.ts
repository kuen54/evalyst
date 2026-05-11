import { chromium, type FullConfig } from "@playwright/test"

/**
 * Pre-compile the routes whose first hit otherwise races a 5 s spec timeout
 * under fullyParallel + multi-worker pressure. Without this, on macOS local
 * dev `npm run test:e2e` can flake on the 4 specs listed below — under
 * suite-wide concurrent cold-compile contention each route's compile lands
 * within ~100 ms of the spec's `waitForURL` / `toBeVisible` timeout.
 *
 * A curl-style prewarm only compiles the **server bundle** for each route;
 * Next.js dev compiles the **client chunks** lazily on browser request, and
 * `page.waitForURL` defaults to `waitUntil: "load"` which waits for those
 * chunks. A real browser visit forces both to compile.
 *
 * Defence-in-depth: with `workers: 1` (the primary fix), CI-style serial
 * compile already keeps things tame; this prewarm is the safety net if
 * anyone later relaxes the worker cap.
 *
 * Routes:
 * - `/experiments/new`           — page hit by 4 specs
 * - `/experiments/__prewarm__`   — compiles dynamic `[id]/page.tsx` + chunks
 * - `/settings/displays/new`     — only audit-cleanup-coverage hits this cold
 * - `/settings/templates/new`    — only audit-cleanup-coverage hits this cold
 */

const PREWARM_ROUTES = [
  "/experiments/new",
  "/experiments/__prewarm__",
  "/settings/displays/new",
  "/settings/templates/new",
] as const

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL
  if (!baseURL) return

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  try {
    for (const route of PREWARM_ROUTES) {
      // tolerate transient hiccups; specs themselves still surface real
      // breakage. timeout is generous because we're paying compile cost
      // here once instead of in every spec's tight 5 s budget.
      await page.goto(route, { waitUntil: "load", timeout: 60_000 }).catch(() => {})
    }
  } finally {
    await browser.close()
  }
}
