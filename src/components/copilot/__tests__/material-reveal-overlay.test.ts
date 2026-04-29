import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 0 at right edge (centerXvw = 100)", () => {
    expect(computeRevealDelay(100)).toBe(0)
  })

  it("returns ~404 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(402)
    expect(v).toBeLessThanOrEqual(407)
  })

  it("returns ~808 at left edge (centerXvw = 0)", () => {
    const v = computeRevealDelay(0)
    expect(v).toBeGreaterThanOrEqual(805)
    expect(v).toBeLessThanOrEqual(812)
  })

  it("clamps to 900 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(900)
    expect(computeRevealDelay(-100)).toBe(900)
  })

  it("clamps to 0 floor when centerXvw > 100 (off-screen right)", () => {
    expect(computeRevealDelay(120)).toBe(0)
    expect(computeRevealDelay(200)).toBe(0)
  })
})
