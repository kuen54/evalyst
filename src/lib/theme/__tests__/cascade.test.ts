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

  it("copilot open: writes per-element delay with 300ms offset (rightmost=300, leftmost=300+stagger)", () => {
    // viewport=1000, panel=200px -> startVw=80
    // Right card: left=900 width=100 -> center cx=95 -> stagger = max(0, min(1400, (80-95)*14)) = 0
    //   total delay = 300 (offset) + 0 = 300ms
    const right = createGlassCard({ left: 900, width: 100 })
    // Left card: left=0 width=100 -> center cx=5 -> stagger = min(1400, (80-5)*14) = 1050
    //   total delay = 300 (offset) + 1050 = 1350ms
    const left = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    expect(document.documentElement.dataset.themeCascading).toBe("true")
    expect(right.style.getPropertyValue("--theme-cascade-delay")).toBe("300ms")
    expect(left.style.getPropertyValue("--theme-cascade-delay")).toBe("1350ms")
  })

  it("prefers-reduced-motion: sets flag but writes no delay (uniform snap via reduced-motion media rule)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    const el = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    // Flag IS set so that the @media (prefers-reduced-motion: reduce) override
    // (transition: none !important) matches and kills both glass inline transition
    // and chrome crossfade → uniform snap, per spec decision 15.
    expect(document.documentElement.dataset.themeCascading).toBe("true")
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
