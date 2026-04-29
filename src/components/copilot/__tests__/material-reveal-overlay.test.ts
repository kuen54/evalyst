import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 0 at right edge (centerXvw = 100)", () => {
    expect(computeRevealDelay(100)).toBe(0)
  })

  it("returns 625 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(622)
    expect(v).toBeLessThanOrEqual(628)
  })

  it("returns 1250 at left edge (centerXvw = 0) — formula hits clamp exactly", () => {
    expect(computeRevealDelay(0)).toBe(1250)
  })

  it("clamps to 1250 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(1250)
    expect(computeRevealDelay(-100)).toBe(1250)
  })

  it("clamps to 0 floor when centerXvw > 100 (off-screen right)", () => {
    expect(computeRevealDelay(120)).toBe(0)
    expect(computeRevealDelay(200)).toBe(0)
  })
})
