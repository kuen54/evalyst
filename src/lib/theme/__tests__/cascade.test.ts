/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyThemeCascade, clearThemeCascade } from "../cascade"

function createGlassCard(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("data-glass-variant", "regular")
  el.getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: 0,
    left: rect.left ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 100),
    width: rect.width ?? 100,
    top: 0,
    bottom: 100,
    height: 100,
    toJSON: () => ({}),
  }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe("applyThemeCascade + clearThemeCascade", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    delete document.documentElement.dataset.themeCascading
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true, writable: true })
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    )
  })

  it("copilot closed: sets flag but writes no delay (all 0 = synchronous crossfade)", () => {
    const el = createGlassCard({ left: 500, width: 100 })
    applyThemeCascade(false, 0)
    expect(document.documentElement.dataset.themeCascading).toBe("true")
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
  })

  it("copilot open: writes per-element delay by x-position (rightmost 0, leftmost ~ startVw*10)", () => {
    // viewport=1000, panel=200px -> startVw=80
    // Right card: left=900 width=100 -> center cx=95 -> delay = (80-95)*10 = -150 -> clamp to 0
    const right = createGlassCard({ left: 900, width: 100 })
    // Left card: left=0 width=100 -> center cx=5 -> delay = (80-5)*10 = 750ms
    const left = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    expect(document.documentElement.dataset.themeCascading).toBe("true")
    expect(right.style.getPropertyValue("--theme-cascade-delay")).toBe("0ms")
    expect(left.style.getPropertyValue("--theme-cascade-delay")).toBe("750ms")
  })

  it("prefers-reduced-motion: no flag, no delay (caller still runs applyThemeClass for 0-delay snap)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    const el = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
  })

  it("clearThemeCascade: removes delays and flag, idempotent", () => {
    const el = createGlassCard({ left: 0, width: 100 })
    el.style.setProperty("--theme-cascade-delay", "500ms")
    document.documentElement.dataset.themeCascading = "true"
    clearThemeCascade()
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()

    // idempotent second call
    clearThemeCascade()
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()
  })
})
