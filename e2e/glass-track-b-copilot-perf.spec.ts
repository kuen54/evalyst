import { test, expect, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * glass-track-b-copilot-perf.spec.ts — the "重灾区": glass UI + a FAT copilot history.
 *
 * Two things to prove after Track B:
 *  1) The heavy-history zone is healthy: /experiments/perf_fixture (heavier-blur GlassHero,
 *     NOT refraction) + 300 result rows + the copilot panel open on a 200-message session
 *     (un-virtualized chat list, react-markdown per assistant row). Idle + page-scroll stay
 *     ~60fps; the message-list scroll cost is the PRE-EXISTING un-virtualized markdown cost.
 *     ZERO url() refraction nodes exist on this page (full-page hero refraction was cut — it
 *     re-rasterized the whole viewport every frame, ~15fps idle; see git history of this file).
 *  2) The remaining refraction (small static PORTALS) is CHEAP: opening a refracting Dialog
 *     over the fat history keeps idle ~60fps — the opposite of the full-page hero lens.
 *
 * PERF_STRICT=1 gates the stable signals; loose mode records + asserts no pageerror (CI-safe).
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control"
const STRICT = process.env.PERF_STRICT === "1"
const EXP_ID = "perf_fixture"
const SESSION_ID = "perf_copilot_fixture"
const MSGS = 200

type Frames = { frameCount: number; p50: number; p95: number; max: number; jank: number; stall: number }

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Number(sorted[idx]!.toFixed(2))
}

function ensureFixtures() {
  const cwd = process.cwd()
  const exp = path.join(cwd, "data", "experiments", `${EXP_ID}.json`)
  if (!fs.existsSync(exp)) execFileSync("npx", ["tsx", "scripts/perf-fixture.ts"], { cwd, stdio: "inherit" })
  const sess = path.join(cwd, "data", "copilot", "sessions", `${SESSION_ID}.jsonl`)
  const enough = fs.existsSync(sess) && fs.readFileSync(sess, "utf-8").trim().split("\n").length >= MSGS - 5
  if (!enough) execFileSync("npx", ["tsx", "scripts/gen-copilot-fixture.ts", String(MSGS)], { cwd, stdio: "inherit" })
}

async function startRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pf?: { t: number[]; raf: number; last: number } }
    const s = { t: [] as number[], raf: 0, last: performance.now() }
    w.__pf = s
    const tick = (t: number) => { s.t.push(t - s.last); s.last = t; s.raf = requestAnimationFrame(tick) }
    s.raf = requestAnimationFrame(tick)
  })
}
async function stopRecorder(page: Page): Promise<Frames> {
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __pf?: { t: number[]; raf: number } }
    const s = w.__pf; if (!s) return [] as number[]
    cancelAnimationFrame(s.raf); return s.t.slice(1)
  })
  const sorted = [...raw].sort((a, b) => a - b)
  return {
    frameCount: raw.length, p50: pct(sorted, 50), p95: pct(sorted, 95),
    max: Number((raw.length ? Math.max(...raw) : 0).toFixed(2)),
    jank: raw.filter((x) => x > 50).length, stall: raw.filter((x) => x > 100).length,
  }
}
async function scrollTarget(page: Page, target: string, duration: number) {
  await page.evaluate(async ({ target, duration }) => {
    const el: Element = target === "window"
      ? (document.scrollingElement || document.documentElement)
      : (document.querySelector(target) || document.scrollingElement || document.documentElement)
    const max = Math.max(1, el.scrollHeight - el.clientHeight)
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const step = () => {
        const e = performance.now() - start
        const frac = Math.min(1, e / duration)
        el.scrollTop = Math.round((0.5 - 0.5 * Math.cos(frac * Math.PI * 2)) * max)
        if (e < duration) requestAnimationFrame(step); else resolve()
      }
      requestAnimationFrame(step)
    })
  }, { target, duration })
}
async function measure(page: Page, target: string): Promise<Frames> {
  await page.evaluate((t) => {
    const el: Element = t === "window" ? (document.scrollingElement || document.documentElement) : (document.querySelector(t) || document.documentElement)
    el.scrollTop = 0
  }, target)
  await startRecorder(page)
  await scrollTarget(page, target, 1600)
  return stopRecorder(page)
}
async function idleMeasure(page: Page): Promise<Frames> {
  await startRecorder(page)
  await page.waitForTimeout(1200)
  return stopRecorder(page)
}
async function urlNodeCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("*")).filter((el) => getComputedStyle(el).backdropFilter.includes("url(")).length,
  )
}
async function openCopilotOn(page: Page, url: string) {
  await page.addInitScript((sid) => {
    try { localStorage.setItem("copilot.active_session", sid); localStorage.removeItem("copilot.panel_open") } catch { /* ignore */ }
  }, SESSION_ID)
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: /打开 Copilot|Open Copilot/i })).toBeVisible({ timeout: 12_000 })
  await page.keyboard.press(`${MOD}+k`)
  await expect(page.locator("aside[data-copilot-panel]")).toHaveAttribute("aria-hidden", "false", { timeout: 8_000 })
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-copilot-open")), { timeout: 8_000 }).toBe("true")
  await expect.poll(() => page.locator(".copilot-chat-list > *").count(), { timeout: 12_000 }).toBeGreaterThan(80)
}

test.describe("Track B · glass + heavy copilot history perf", () => {
  test.beforeAll(() => ensureFixtures())

  test("heavy history + GlassHero page: idle / page-scroll / message-list-scroll stay healthy", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
    // Resource 404s are network noise (the synthetic perf_fixture has no run-status record →
    // the detail page's /run poll 404s; present on main too). We care about JS health here.
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`) })

    await openCopilotOn(page, `/experiments/${EXP_ID}`)
    const chatRows = await page.locator(".copilot-chat-list > *").count()
    const resultRows = await page.locator('[data-copilot-context="task_result"]').count()

    // The data-dense + heavy-history page must carry ZERO url() refraction (hero is blur now).
    expect(await urlNodeCount(page), "no url() refraction nodes on the heavy page").toBe(0)

    // Let the un-virtualized markdown list settle before measuring STEADY-STATE idle. The
    // first-mount cost (react-markdown parsing ~80 assistant rows) is a pre-existing
    // un-virtualized-list cost, NOT Track B — it bleeds into a too-early idle sample.
    await page.waitForTimeout(1200)
    const idle = await idleMeasure(page)
    const pageScroll = await measure(page, "window")
    const listScroll = await measure(page, ".copilot-chat-list")

    console.log("\n===== GLASS_TRACKB_COPILOT_PERF =====\n" + JSON.stringify({
      chatRows, resultRows, mode: STRICT ? "strict" : "loose", idle, pageScroll, listScroll,
    }, null, 2) + "\n===== /GLASS_TRACKB_COPILOT_PERF =====\n")

    expect(errors, "no pageerror/console-error (run-status 404 filtered)").toEqual([])
    expect(idle.max, "idle must not repaint heavily (no ~1s frame)").toBeLessThan(1000)

    if (STRICT) {
      // Idle + page-scroll stay ~60fps (no full-page refraction churning the compositor).
      expect(idle.p50, "idle median ~60fps").toBeLessThan(20)
      expect(idle.stall, "no idle stalls").toBe(0)
      expect(pageScroll.p50, "page-scroll median ~60fps").toBeLessThan(20)
      expect(pageScroll.stall, "no page-scroll stalls").toBe(0)
      // Message-list scroll is the PRE-EXISTING un-virtualized markdown cost (present on main):
      // ~30fps median is tolerated, but it must not fully stall.
      expect(listScroll.p50, "message-list median (pre-existing markdown cost) < 40ms").toBeLessThan(40)
      expect(listScroll.stall, "message-list no >100ms stalls").toBe(0)
    }
  })

  test("portal refraction is CHEAP: a refracting Dialog over the fat history keeps idle ~60fps", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))

    await openCopilotOn(page, "/settings/datasets")

    // Baseline idle (no dialog) with the fat history.
    const idleBase = await idleMeasure(page)

    // Open a refracting Dialog (small static portal) over the fat history.
    const deleteButton = page.getByRole("button", { name: /^删除$|^Delete$/ }).first()
    await expect(deleteButton).toBeVisible({ timeout: 8_000 })
    await deleteButton.click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 4_000 })
    await expect(dialog).toHaveAttribute("data-glass-variant", "thick")
    const bf = await dialog.evaluate((el) => getComputedStyle(el).backdropFilter)
    expect(bf, `dialog refracts (url): ${bf}`).toContain("url(")
    expect(await urlNodeCount(page), "exactly one refracting node (the dialog)").toBe(1)

    const idleDialog = await idleMeasure(page)

    console.log("\n===== GLASS_TRACKB_PORTAL_PERF =====\n" + JSON.stringify({
      idleBase, idleDialog, idleDelta: { p50: +(idleDialog.p50 - idleBase.p50).toFixed(2), max: +(idleDialog.max - idleBase.max).toFixed(2) },
    }, null, 2) + "\n===== /GLASS_TRACKB_PORTAL_PERF =====\n")

    await page.getByRole("button", { name: /^取消$|^Cancel$/ }).click()
    expect(errors, "no pageerror").toEqual([])
    expect(idleDialog.max, "dialog-open idle no ~1s freeze").toBeLessThan(1000)

    if (STRICT) {
      // The decisive contrast: a SMALL static portal refraction keeps idle ~60fps,
      // unlike the full-page hero lens which tanked idle to ~15fps (66ms p50).
      expect(idleDialog.p50, "small-portal refraction keeps idle ~60fps (p50 < 20ms)").toBeLessThan(20)
      expect(idleDialog.stall, "no idle stalls with a refracting dialog open").toBe(0)
    }
  })
})
