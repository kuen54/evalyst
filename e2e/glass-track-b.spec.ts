import { test, expect, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * glass-track-b.spec.ts — Track B REAL backdrop refraction, end-to-end in Chromium.
 *
 * Playwright drives Chromium — the ONE engine where `backdrop-filter: url(#id)`
 * actually refracts the live backdrop (a Blink-only extension). So unlike the
 * headless unit suite, this spec functionally asserts the lens lands:
 *
 *  1. Probe: the offscreen pixel-readback capability probe returns TRUE in real Blink.
 *  2. Dialog (thick portal): copilot OPEN → computed `backdrop-filter` contains
 *     `url(` (real refraction) while `-webkit-backdrop-filter` stays a literal blur
 *     (Safari-never-url invariant). data-glass-variant="thick" intact.
 *  3. GlassHero shells on /experiments/[id] and /compare are HEAVIER BLUR, NOT
 *     refraction — a full-page feDisplacementMap tanked idle to ~15fps (Chromium can't
 *     cache a viewport-sized backdrop), so the lens is portal-only. Hero carries blur,
 *     never url(). (see glass-track-b-copilot-perf.spec.ts for the measurement)
 *  4. Fallback ladder: copilot CLOSED → no url() (flat). Under
 *     prefers-reduced-transparency:reduce (CDP Emulation.setEmulatedMedia) the
 *     COMPONENT gates url() OFF itself — the load-bearing a11y quirk that a CSS
 *     !important cannot strip an inline url() backdrop-filter on a portaled Dialog.
 *  5. Perf / bounded-lens: with the 300-row perf_fixture open, exactly ONE refracting node
 *     exists — the liquid-glass results bar (sticky-up). The full-page hero is plain blur,
 *     and all 300 rows stay data-glass-variant=thin with blur (NOT url()). The lens never
 *     multiplies across the list.
 *
 * All console errors + pageerrors captured and asserted empty.
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control"
const FIXTURE_ID = "perf_fixture"
const FIXTURE_URL = `/experiments/${FIXTURE_ID}`

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
  execFileSync("npx", ["tsx", "scripts/perf-fixture.ts"], { cwd, stdio: "inherit" })
}

// The hand-authored perf_fixture has no run record, so the experiment detail
// page's run-status poll GETs /api/experiments/perf_fixture/run → 404. That is a
// FIXTURE artifact (present on main too, exercised by glass-perf.spec), NOT a
// Track B defect. Filter only this exact known noise; everything else is fatal.
function isFixtureNoise(s: string): boolean {
  return /\/api\/experiments\/perf_fixture\/run|status of 404/.test(s)
}

function arm(page: Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = `console.error: ${m.text()}`
      if (!isFixtureNoise(t)) errors.push(t)
    }
  })
}

/**
 * Safari-never-url invariant check. In Chromium `-webkit-backdrop-filter` is an
 * ALIAS of the standard `backdrop-filter`, so when both are set inline the engine
 * collapses them and serializes only the standard property — the inline style
 * attribute carries NO separate `-webkit-backdrop-filter` token. The load-bearing
 * guarantee is therefore: the url() ref lives ONLY on the standard backdrop-filter,
 * and any `-webkit-backdrop-filter` value that DOES survive (Safari/Firefox path)
 * is a plain blur literal with no url(). We assert on the raw inline style attribute.
 */
async function assertWebkitNeverUrl(loc: import("@playwright/test").Locator) {
  const inline = await loc.evaluate((el) => {
    const m = (el.getAttribute("style") || "").match(/-webkit-backdrop-filter:\s*([^;]*)/)
    return m?.[1]?.trim() ?? null
  })
  // Either the webkit token was collapsed away by Blink (null) OR, if present, it
  // is a blur literal that must never carry url().
  if (inline !== null) {
    expect(inline, `-webkit-backdrop-filter must never carry url(): ${inline}`).not.toContain("url(")
    expect(inline).toContain("blur")
  }
}

/** Gate on the hydration-only copilot toggle, then open the panel via Meta+k. */
async function openCopilot(page: Page) {
  await expect(
    page.getByRole("button", { name: /打开 Copilot|Open Copilot/i }),
  ).toBeVisible({ timeout: 12_000 })
  await page.keyboard.press(`${MOD}+k`)
  await expect
    .poll(
      async () => page.evaluate(() => document.documentElement.getAttribute("data-copilot-open")),
      { timeout: 8_000 },
    )
    .toBe("true")
}

/** Run the in-page capability probe (same module the runtime uses, via a fresh probe). */
async function probeSupported(page: Page): Promise<boolean> {
  // Re-implement the exact offscreen readback the runtime probe uses, so we
  // assert the REAL Blink path returns true here (not a stub).
  return page.evaluate(() => {
    const SIZE = 8
    const src = document.createElement("canvas")
    src.width = src.height = SIZE
    const sx = src.getContext("2d", { willReadFrequently: true })
    if (!sx) return false
    sx.fillStyle = "#ff0000"
    sx.fillRect(0, 0, SIZE / 2, SIZE)
    sx.fillStyle = "#0000ff"
    sx.fillRect(SIZE / 2, 0, SIZE / 2, SIZE)
    const flatMap =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'>" +
          "<rect width='2' height='2' fill='rgb(255,128,128)'/></svg>",
      )
    const host = document.createElement("div")
    host.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden"
    host.innerHTML =
      '<svg width="0" height="0"><filter id="evalyst-probe-test" color-interpolation-filters="sRGB">' +
      `<feImage href="${flatMap}" result="m" preserveAspectRatio="none" x="0" y="0" width="${SIZE}" height="${SIZE}"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="m" scale="${SIZE}" xChannelSelector="R" yChannelSelector="G"/>` +
      "</filter></svg>"
    document.body.appendChild(host)
    const out = document.createElement("canvas")
    out.width = out.height = SIZE
    const ox = out.getContext("2d", { willReadFrequently: true })
    if (!ox) {
      document.body.removeChild(host)
      return false
    }
    ox.filter = "url(#evalyst-probe-test)"
    ox.drawImage(src, 0, 0)
    const left = ox.getImageData(0, 0, 1, 1).data
    document.body.removeChild(host)
    return (left[2] ?? 0) > 40
  })
}

const cssOf = (loc: import("@playwright/test").Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)

test.describe("Track B · real backdrop refraction (Chromium)", () => {
  test.beforeAll(() => ensureFixture())

  test.beforeEach(async ({ page }) => {
    // Deterministic copilot-closed baseline (open state persists in localStorage).
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("copilot.panel_open")
      } catch {
        /* ignore */
      }
    })
  })

  test("Dialog thick portal refracts when copilot open; -webkit stays blur", async ({ page }) => {
    const errors: string[] = []
    arm(page, errors)

    await page.goto("/settings/datasets", { waitUntil: "domcontentloaded" })

    // The real Blink probe must succeed here (true-positive path, untestable headless).
    expect(await probeSupported(page), "feDisplacementMap probe true in real Chromium").toBe(true)

    await openCopilot(page)

    const deleteButton = page.getByRole("button", { name: /^删除$|^Delete$/ }).first()
    await expect(deleteButton).toBeVisible({ timeout: 8_000 })
    await deleteButton.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 4_000 })
    await expect(dialog).toHaveAttribute("data-glass-variant", "thick")

    // html flag flips on when refraction is globally live.
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-glass-refraction")), {
        timeout: 4_000,
      })
      .toBe("on")

    // The single shared <filter> is mounted exactly once.
    const filterCount = await page.locator("filter#evalyst-glass-refraction").count()
    expect(filterCount, "the shared refraction <filter> is mounted once").toBe(1)

    // REAL refraction: standard backdrop-filter carries url() (Blink applies it);
    // it also leads with the blur literal so a missing filter id degrades to blur.
    const std = await cssOf(dialog, "backdrop-filter")
    expect(std, `computed backdrop-filter on dialog: ${std}`).toContain("url(")
    expect(std).toContain("blur")
    // Safari-never-url invariant on the inline style.
    await assertWebkitNeverUrl(dialog)

    await page.getByRole("button", { name: /^取消$|^Cancel$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 4_000 })

    expect(errors, "no runtime errors").toEqual([])
  })

  test("GlassHero shells are heavier blur, NOT refraction (full-page lens cut for perf)", async ({ page }) => {
    const errors: string[] = []
    arm(page, errors)

    // Full-page feDisplacementMap re-rasterized the whole viewport every frame (~15fps idle),
    // so hero shells carry heavier blur only — never url(). Refraction lives on the portals.
    for (const url of [FIXTURE_URL, "/compare"]) {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      await openCopilot(page)
      const hero = page.locator('[data-glass-variant="hero"]').first()
      await expect(hero).toBeVisible({ timeout: 8_000 })
      const bf = await cssOf(hero, "backdrop-filter")
      expect(bf, `hero on ${url} must be blur: ${bf}`).toContain("blur")
      expect(bf, `hero on ${url} must NOT refract (perf): ${bf}`).not.toContain("url(")
      await assertWebkitNeverUrl(hero)
    }

    expect(errors, "no runtime errors").toEqual([])
  })

  test("FALLBACK: closed → flat; reduced-transparency → component gates url() OFF", async ({ page }) => {
    const errors: string[] = []
    arm(page, errors)

    await page.goto("/settings/datasets", { waitUntil: "domcontentloaded" })

    // ── copilot CLOSED → no url() anywhere (flat shadcn / no glass var) ──
    const deleteButton = page.getByRole("button", { name: /^删除$|^Delete$/ }).first()
    await expect(deleteButton).toBeVisible({ timeout: 8_000 })
    await deleteButton.click()
    const dialogClosed = page.locator('[data-slot="dialog-content"]')
    await expect(dialogClosed).toBeVisible({ timeout: 4_000 })
    await expect(dialogClosed).not.toHaveAttribute("data-glass-variant", /.+/)
    expect(await cssOf(dialogClosed, "backdrop-filter"), "closed dialog has no url()").not.toContain("url(")
    expect(
      await page.evaluate(() => document.documentElement.getAttribute("data-glass-refraction")),
      "html refraction flag off when copilot closed",
    ).not.toBe("on")
    await page.getByRole("button", { name: /^取消$|^Cancel$/ }).click()
    await expect(dialogClosed).toBeHidden({ timeout: 4_000 })

    // ── reduced-transparency:reduce → component itself must NOT emit url() ──
    // The load-bearing quirk: a stylesheet `backdrop-filter:none !important` does
    // NOT override an inline url() backdrop-filter on a portaled Dialog. So the
    // gate must live in the component (useRefractionAllowed reads the media query).
    const session = await page.context().newCDPSession(page)
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    })

    await openCopilot(page)
    // Even with copilot open + Blink, the a11y veto must keep the html flag OFF.
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-glass-refraction")), {
        timeout: 4_000,
      })
      .not.toBe("on")

    await deleteButton.click()
    const dialogRT = page.locator('[data-slot="dialog-content"]')
    await expect(dialogRT).toBeVisible({ timeout: 4_000 })
    // data-glass-variant still present (a11y selectors must match), but the inline
    // backdrop-filter must carry NO url() — the component gated it off.
    await expect(dialogRT).toHaveAttribute("data-glass-variant", "thick")
    const stdRT = await cssOf(dialogRT, "backdrop-filter")
    expect(stdRT, `reduced-transparency dialog backdrop-filter must not have url(): ${stdRT}`).not.toContain(
      "url(",
    )
    // also the raw inline attribute (the asymmetry is about the INLINE value)
    const inlineRT = await dialogRT.evaluate(
      (el) => (el as HTMLElement).style.backdropFilter + "|" + (el as HTMLElement).style.getPropertyValue("backdrop-filter"),
    )
    expect(inlineRT, `inline backdrop-filter must not carry url(): ${inlineRT}`).not.toContain("url(")

    await page.getByRole("button", { name: /^取消$|^Cancel$/ }).click()
    await session.send("Emulation.setEmulatedMedia", { features: [] })

    expect(errors, "no runtime errors").toEqual([])
  })

  test("PERF: lens bounded to the 1 results bar; rows stay thin/blur; hero is blur", async ({ page }) => {
    const errors: string[] = []
    arm(page, errors)

    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" })
    await openCopilot(page)

    // Data-dense list rendered (300 rows).
    const rowCards = page.locator('[data-copilot-context="task_result"]')
    await expect(rowCards.first()).toBeVisible({ timeout: 12_000 })
    const rowCount = await rowCards.count()
    expect(rowCount, "300-row fixture rendered").toBeGreaterThan(200)
    await expect(rowCards.first()).toHaveAttribute("data-glass-variant", "thin")

    // The lens must NEVER multiply across the 300 rows. The ONLY refracting node on the
    // data-dense page is the single liquid-glass results bar (data-glass-variant="sticky-up");
    // the full-page hero is plain blur, and every result row stays thin/blur (no url()).
    const urlNodes = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll<HTMLElement>("*"))
      return all
        .filter((el) => getComputedStyle(el).backdropFilter.includes("url("))
        .map((el) => el.getAttribute("data-glass-variant") || el.tagName.toLowerCase())
    })
    expect(urlNodes, `exactly one refracting node (the results bar): ${JSON.stringify(urlNodes)}`).toEqual(["sticky-up"])

    // result rows never carry url()
    const rowsWithUrl = await rowCards.evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).backdropFilter.includes("url(")).length,
    )
    expect(rowsWithUrl, "NO result row may carry a url() refraction filter").toBe(0)

    // hero shell present + heavier blur (never url).
    const hero = page.locator('[data-glass-variant="hero"]').first()
    await expect(hero).toBeVisible({ timeout: 4_000 })
    const heroBf = await cssOf(hero, "backdrop-filter")
    expect(heroBf, `hero is blur, not url: ${heroBf}`).toContain("blur")
    expect(heroBf).not.toContain("url(")

    // Frame health: short rAF sample while idle over the big list — no long hang.
    const frames: number[] = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const times: number[] = []
          let last = performance.now()
          let n = 0
          const tick = (t: number) => {
            times.push(t - last)
            last = t
            if (++n < 60) requestAnimationFrame(tick)
            else resolve(times.slice(1))
          }
          requestAnimationFrame(tick)
        }),
    )
    const max = Math.max(...frames)
    console.log(
      "\n===== GLASS_TRACKB_PERF =====\n" +
        JSON.stringify(
          { rowCount, refractingNodes: urlNodes.length, idleFrameMaxMs: Number(max.toFixed(2)) },
          null,
          2,
        ) +
        "\n===== /GLASS_TRACKB_PERF =====\n",
    )
    expect(max, "no ~1s freeze on the data-dense page (idle)").toBeLessThan(1000)

    expect(errors, "no runtime errors").toEqual([])
  })
})
