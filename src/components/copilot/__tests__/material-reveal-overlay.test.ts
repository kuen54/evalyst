import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 0 at right edge (centerXvw = 100)", () => {
    expect(computeRevealDelay(100)).toBe(0)
  })

  it("returns ~292 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(290)
    expect(v).toBeLessThanOrEqual(295)
  })

  it("returns ~583 at left edge (centerXvw = 0)", () => {
    const v = computeRevealDelay(0)
    expect(v).toBeGreaterThanOrEqual(580)
    expect(v).toBeLessThanOrEqual(585)
  })

  it("clamps to 600 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(600)
    expect(computeRevealDelay(-100)).toBe(600)
  })

  it("clamps to 0 floor when centerXvw > 100 (off-screen right)", () => {
    expect(computeRevealDelay(120)).toBe(0)
    expect(computeRevealDelay(200)).toBe(0)
  })
})
