import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? 3000)
const BASE_URL = `http://localhost:${PORT}`

/**
 * Playwright config for end-to-end smoke tests.
 *
 * - Reuses an already-running dev server if one is up on PORT (faster local
 *   iteration); otherwise boots `npm run dev` itself.
 * - Only chromium for now — the smoke suite is browser-agnostic.
 * - Separate from vitest (vitest watches `src/**\/*.test.ts`, Playwright
 *   lives in `e2e/`).
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./playwright.global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // workers: 1 always — local matches CI. macOS multi-worker browser
  // contexts contend for CPU/IO during cold-route navigation; workers=2
  // measured 33 % flake on the 4 cold-compile-prone specs, while workers=1
  // is stable. CI was already workers=1; this aligns local behaviour.
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
