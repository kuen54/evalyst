import { test, expect, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * glass-perf.spec.ts — Track A premium-edge scroll-cost measurement.
 *
 * Methodology (the key trick): we measure the SAME production build twice —
 * once with the copilot panel CLOSED (no glass: data-glass-variant absent,
 * shadcn flat) and once with it OPEN (glass on: directional rim all tiers,
 * thin cards in the long results list). Comparing open-minus-closed isolates
 * the glass/copilot paint cost WITHOUT a git checkout of the pre-Track-A
 * commit. Track A only changed box-shadow / background-image (blur radii are
 * UNCHANGED 16/28/40), so any scroll regression would show up as a delta here.
 *
 * Per measurement we:
 *   1. inject a requestAnimationFrame interval recorder,
 *   2. programmatically scroll the page in small steps over ~1.8s,
 *   3. read back frame intervals → frameCount, p50, p95, jank(>50ms), stall(>100ms),
 *   4. snapshot CDP Performance.getMetrics before/after for
 *      LayoutCount / RecalcStyleCount / LayoutDuration / RecalcStyleDuration deltas.
 *
 * Numbers are console.log'd as a labeled JSON block so a human can read
 * authoritative figures off a PRODUCTION run. Hard budgets only fire under
 * PERF_STRICT=1 — dev-mode overhead (HMR, unminified React) makes dev numbers
 * non-authoritative, so dev CI never trips them.
 *
 * For authoritative numbers run against a prod build:
 *   npm run build
 *   E2E_PORT=3100 PERF_STRICT=1 \
 *     npx playwright test e2e/glass-perf.spec.ts --reporter=line
 *   (point webServer at `npm run start` for a true prod server — see report.)
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control"
const STRICT = process.env.PERF_STRICT === "1"
const FIXTURE_ID = "perf_fixture"
const FIXTURE_URL = `/experiments/${FIXTURE_ID}`

type Frames = {
  frameCount: number
  p50: number
  p95: number
  max: number
  jank: number // frames > 50ms
  stall: number // frames > 100ms
}

type CdpDelta = {
  LayoutCount: number
  RecalcStyleCount: number
  LayoutDuration: number
  RecalcStyleDuration: number
}

type Measurement = { frames: Frames; cdp: CdpDelta }

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Number(sorted[idx]!.toFixed(2))
}

/** Ensure the data-dense fixture exists; generate it if missing. */
function ensureFixture() {
  const cwd = process.cwd()
  const exp = path.join(cwd, "data", "experiments", `${FIXTURE_ID}.json`)
  const res = path.join(cwd, "data", "results", FIXTURE_ID, "results.jsonl")
  const ok =
    fs.existsSync(exp) &&
    fs.existsSync(res) &&
    fs.readFileSync(res, "utf-8").trim().split("\n").length >= 250
  if (ok) return
  execFileSync("npx", ["tsx", "scripts/perf-fixture.ts"], {
    cwd,
    stdio: "inherit",
  })
}

/** Inject an rAF interval recorder; returns nothing (state stashed on window). */
async function startFrameRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __perf?: { times: number[]; raf: number; last: number } }
    const state = { times: [] as number[], raf: 0, last: performance.now() }
    w.__perf = state
    const tick = (t: number) => {
      state.times.push(t - state.last)
      state.last = t
      state.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  })
}

/** Programmatically scroll the page's main scroll container in small steps. */
async function scrollOverTime(page: Page, durationMs: number) {
  await page.evaluate(async (duration) => {
    // Pick the tallest scrollable ancestor: prefer the document scrollingElement
    // (the experiment detail page scrolls the window, not an inner div).
    const el = document.scrollingElement || document.documentElement
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight)
    const start = performance.now()
    return await new Promise<void>((resolve) => {
      const step = () => {
        const elapsed = performance.now() - start
        const frac = Math.min(1, elapsed / duration)
        // ease in/out so we sweep down then settle — small per-frame deltas
        const eased = 0.5 - 0.5 * Math.cos(frac * Math.PI * 2)
        el.scrollTop = Math.round(eased * maxScroll)
        if (elapsed < duration) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }, durationMs)
}

/** Stop the recorder and compute frame stats. */
async function stopFrameRecorder(page: Page): Promise<Frames> {
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __perf?: { times: number[]; raf: number } }
    const s = w.__perf
    if (!s) return [] as number[]
    cancelAnimationFrame(s.raf)
    // Drop the first interval (recorder warm-up) which is noisy.
    return s.times.slice(1)
  })
  const sorted = [...raw].sort((a, b) => a - b)
  return {
    frameCount: raw.length,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: Number((raw.length ? Math.max(...raw) : 0).toFixed(2)),
    jank: raw.filter((x) => x > 50).length,
    stall: raw.filter((x) => x > 100).length,
  }
}

test.describe("Track A glass premium-edge · scroll perf", () => {
  test.beforeAll(() => {
    ensureFixture()
  })

  // Baseline pass requires copilot to start CLOSED; open state persists in
  // localStorage, so clear it before navigation for a deterministic baseline.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("copilot.panel_open")
      } catch {
        /* ignore */
      }
    })
  })

  test("scroll cost: copilot closed (baseline) vs open (glass on)", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))

    // CDP Performance domain for layout/recalc counters.
    const session = await page.context().newCDPSession(page)
    await session.send("Performance.enable")
    const readMetrics = async (): Promise<Record<string, number>> => {
      const { metrics } = await session.send("Performance.getMetrics")
      const out: Record<string, number> = {}
      for (const m of metrics) out[m.name] = m.value
      return out
    }
    const cdpDelta = (before: Record<string, number>, after: Record<string, number>): CdpDelta => ({
      LayoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
      RecalcStyleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
      LayoutDuration: Number(((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)).toFixed(4)),
      RecalcStyleDuration: Number(
        ((after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0)).toFixed(4),
      ),
    })

    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" })

    // Hydration gate: toggle renders only after CopilotStoreProvider mount
    // effect (same effect that registers Meta+k). Pressing earlier is a race.
    await expect(
      page.getByRole("button", { name: /打开 Copilot|Open Copilot/i }),
    ).toBeVisible({ timeout: 12_000 })

    // The long results list must render. SingleListResults emits one card per
    // row carrying data-copilot-context="task_result"; assert a healthy count.
    const rowCards = page.locator('[data-copilot-context="task_result"]')
    await expect(rowCards.first()).toBeVisible({ timeout: 12_000 })
    const rowCount = await rowCards.count()
    expect(rowCount, "data-dense list rendered").toBeGreaterThan(200)

    const measure = async (): Promise<Measurement> => {
      // settle layout before measuring
      await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTo(0, 0))
      const before = await readMetrics()
      await startFrameRecorder(page)
      await scrollOverTime(page, 1800)
      const frames = await stopFrameRecorder(page)
      const after = await readMetrics()
      return { frames, cdp: cdpDelta(before, after) }
    }

    // ── Pass 1 — copilot CLOSED (no glass) ──
    const closed = await measure()
    expect(
      await page.evaluate(() => document.documentElement.getAttribute("data-copilot-open")),
      "copilot should be closed for baseline pass",
    ).not.toBe("true")

    // ── Open copilot → glass on ──
    await page.keyboard.press(`${MOD}+k`)
    const panel = page.locator("aside[data-copilot-panel]")
    await expect(panel).toHaveAttribute("aria-hidden", "false", { timeout: 6_000 })
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-copilot-open")), {
        timeout: 6_000,
      })
      .toBe("true")
    // Glass actually applied: at least one row card now carries the variant attr.
    await expect(rowCards.first()).toHaveAttribute("data-glass-variant", "thin")

    // ── Pass 2 — copilot OPEN (glass on) ──
    const open = await measure()

    const delta = {
      p50: Number((open.frames.p50 - closed.frames.p50).toFixed(2)),
      p95: Number((open.frames.p95 - closed.frames.p95).toFixed(2)),
      jank: open.frames.jank - closed.frames.jank,
      stall: open.frames.stall - closed.frames.stall,
      LayoutCount: open.cdp.LayoutCount - closed.cdp.LayoutCount,
      RecalcStyleCount: open.cdp.RecalcStyleCount - closed.cdp.RecalcStyleCount,
    }

    // Authoritative-on-prod, labeled block.
    console.log(
      "\n===== GLASS_PERF_RESULT =====\n" +
        JSON.stringify(
          {
            mode: STRICT ? "strict(prod-intent)" : "loose(dev-overhead, non-authoritative)",
            rowCount,
            closed,
            open,
            openMinusClosed: delta,
          },
          null,
          2,
        ) +
        "\n===== /GLASS_PERF_RESULT =====\n",
    )

    // ── Always-on assertions (safe in dev / contended CI) ──
    expect(errors, "no pageerror during perf measurement").toEqual([])
    expect(open.frames.frameCount, "rAF recorder captured frames while open").toBeGreaterThan(10)
    // True-freeze guard: a full ~1s blocked frame is a real hang regardless of
    // dev overhead / CI contention. Kept generous so a loaded CI runner won't
    // flake; the tight 300ms / p95 / delta budgets live under PERF_STRICT.
    expect(open.frames.max, "no ~1s freeze while glass open").toBeLessThan(1000)

    // ── Hard budgets (prod, PERF_STRICT=1 — calibrated for a production build) ──
    if (STRICT) {
      expect(open.frames.max, "no single >300ms frame while glass open").toBeLessThan(300)
      expect(open.frames.p95, "open p95 frame interval < 24ms").toBeLessThan(24)
      expect(open.frames.stall, "zero >100ms stalls while open").toBe(0)
      expect(
        delta.p95,
        "Track A must not worsen scroll p95 vs copilot-open baseline by >8ms",
      ).toBeLessThan(8)
    }
  })
})
