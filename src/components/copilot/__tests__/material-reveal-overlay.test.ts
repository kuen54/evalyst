import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 300 at right edge (centerXvw = 100) — wave-lead offset", () => {
    expect(computeRevealDelay(100)).toBe(300)
  })

  it("returns ~925 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(922)
    expect(v).toBeLessThanOrEqual(928)
  })

  it("returns 1550 at left edge (centerXvw = 0) — formula hits clamp exactly", () => {
    expect(computeRevealDelay(0)).toBe(1550)
  })

  it("clamps to 1550 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(1550)
    expect(computeRevealDelay(-100)).toBe(1550)
  })

  it("clamps to 0 floor when centerXvw is far past right edge", () => {
    expect(computeRevealDelay(200)).toBe(0)
    expect(computeRevealDelay(500)).toBe(0)
  })
})
