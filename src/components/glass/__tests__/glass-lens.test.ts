import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  computeRefractionAllowed,
  computeLensFilter,
  THICK_BLUR_LITERAL,
  REFRACTION_FILTER_ID,
} from "../glass-lens"
import { getGlassHeroStyle, getGlassStyleForVariant } from "../shell"
import { lensRefractionSupported, __resetLensProbeCacheForTests } from "../glass-lens-probe"

/**
 * Track B · GlassLens pure decision logic. Repo rule = test pure functions only
 * (mirrors shell.test.ts). The React hooks just feed these helpers store/matchMedia
 * state; the live-render path is covered by Playwright + CDP e2e.
 */
describe("computeRefractionAllowed · a11y + inspector + probe gate", () => {
  it("allows refraction only when probe passes AND no a11y veto AND not inspecting", () => {
    expect(computeRefractionAllowed(false, false, true)).toBe(true)
  })

  it("blocks when any a11y query matches (reduced-transparency/motion/contrast/forced-colors)", () => {
    expect(computeRefractionAllowed(true, false, true)).toBe(false)
  })

  it("blocks while the copilot inspector is active", () => {
    expect(computeRefractionAllowed(false, true, true)).toBe(false)
  })

  it("blocks when the probe fails (non-Blink / embedded webview)", () => {
    expect(computeRefractionAllowed(false, false, false)).toBe(false)
  })
})

describe("computeLensFilter · fallback returns {} , live emits url()", () => {
  it("returns {} when copilot closed", () => {
    expect(computeLensFilter(false, true)).toEqual({})
  })

  it("returns {} when not allowed (any a11y / inspector / probe-fail)", () => {
    expect(computeLensFilter(true, false)).toEqual({})
  })

  it("live path: standard backdropFilter carries url(#evalyst-glass-refraction)", () => {
    const s = computeLensFilter(true, true)
    expect(s.backdropFilter).toContain(`url(#${REFRACTION_FILTER_ID})`)
    expect(s.backdropFilter).toContain("blur(40px)")
  })

  it("Safari-never-url invariant: WebkitBackdropFilter is exactly the blur literal, NO url(", () => {
    const s = computeLensFilter(true, true)
    expect(s.WebkitBackdropFilter).toBe(THICK_BLUR_LITERAL)
    expect(s.WebkitBackdropFilter).not.toContain("url(")
  })
})

describe("zero-regression: spreading the fallback lens on the thick recipe is a no-op", () => {
  // Proves non-Blink / probe-fail / a11y users get byte-identical TODAY's thick glass.
  it("{ ...thick(open), ...fallbackLens } deep-equals thick(open)", () => {
    const thick = getGlassStyleForVariant("thick", true)
    const fallback = computeLensFilter(true, false) // not allowed -> {}
    expect({ ...thick, ...fallback }).toEqual(thick)
  })

  it("the fallback lens never injects url() into the thick recipe", () => {
    const thick = getGlassStyleForVariant("thick", true)
    const merged = { ...thick, ...computeLensFilter(true, false) }
    expect(merged.backdropFilter).not.toContain("url(")
    expect(merged.WebkitBackdropFilter).not.toContain("url(")
  })
})

describe("getGlassHeroStyle · hero page-shell recipe (heavier blur, NO refraction)", () => {
  it("closed: transition-only, no backdrop / no url()", () => {
    const r = getGlassHeroStyle(false)
    expect(r.backdropFilter).toBeUndefined()
    expect(r.backgroundColor).toBeUndefined()
    expect(r.transition).toContain("background-color")
  })

  it("open: heavier blur(40) literal — NEVER url() (full-page refraction was cut: it tanked idle to ~15fps)", () => {
    const r = getGlassHeroStyle(true)
    expect(r.backdropFilter).toBe("blur(40px) saturate(1.3)")
    expect(r.WebkitBackdropFilter).toBe("blur(40px) saturate(1.3)")
    expect(r.backdropFilter).not.toContain("url(")
    expect(r.WebkitBackdropFilter).not.toContain("url(")
    // thick-weight rim + drop shadow; NO fringe / sweep at page scale (over-decorated)
    expect(r.boxShadow).toContain("0 30px 60px -15px")
    expect(r.backgroundImage).toBeUndefined()
  })

  it("open: slightly more opaque (40% card) than regular (35%) for big-shell legibility", () => {
    const r = getGlassHeroStyle(true)
    expect(r.backgroundColor).toContain("var(--card) 40%")
  })
})

describe("lensRefractionSupported · SSR-guarded + memoized", () => {
  beforeEach(() => {
    __resetLensProbeCacheForTests()
  })
  afterEach(() => {
    __resetLensProbeCacheForTests()
    // ensure no leaked globals between tests
    // @ts-expect-error test cleanup
    delete globalThis.window
    // @ts-expect-error test cleanup
    delete globalThis.document
  })

  it("returns false under SSR (no window/document)", () => {
    expect(typeof window).toBe("undefined")
    expect(lensRefractionSupported()).toBe(false)
  })

  it("memoizes: call 1 reaches the canvas readback, call 2 does ZERO createElement (cache short-circuits)", () => {
    // Stub a full browser env so the probe runs the WHOLE readback once. We simulate a
    // non-Blink engine: the displaced pixel comes back un-warped (B channel ~0) -> false,
    // which is also the Safari/Firefox behaviour the probe must reject.
    const fakeCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      filter: "",
      drawImage: vi.fn(),
      // left edge stays pure red (no blue pulled in) -> un-warped -> probe returns false
      getImageData: () => ({ data: [255, 0, 0, 255] }),
    }
    const makeCanvas = () => ({ width: 0, height: 0, getContext: () => fakeCtx })
    const fakeBody = { appendChild: vi.fn(), removeChild: vi.fn() }
    const createElement = vi.fn((tag: string) => {
      if (tag === "canvas") return makeCanvas()
      return { setAttribute: vi.fn(), style: { cssText: "" }, innerHTML: "" } // the hidden host div
    })
    const fakeWindow = { CSS: { supports: () => true } } // baseline blur supported
    const fakeDocument = { createElement, body: fakeBody }
    // @ts-expect-error test stub
    globalThis.window = fakeWindow
    // @ts-expect-error test stub
    globalThis.document = fakeDocument

    const first = lensRefractionSupported()
    expect(first).toBe(false) // un-warped pixel -> not supported
    const callsAfterFirst = createElement.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0) // call 1 actually exercised the readback

    const second = lensRefractionSupported()
    expect(second).toBe(false)
    // memoized: createElement count did NOT grow on the second call
    expect(createElement.mock.calls.length).toBe(callsAfterFirst)
  })
})
