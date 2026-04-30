import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 750 at right edge (centerXvw = 100) — wave-lead offset", () => {
    expect(computeRevealDelay(100)).toBe(750)
  })

  it("returns ~1375 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(1372)
    expect(v).toBeLessThanOrEqual(1378)
  })

  it("returns 2000 at left edge (centerXvw = 0) — formula hits clamp exactly", () => {
    expect(computeRevealDelay(0)).toBe(2000)
  })

  it("clamps to 2000 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(2000)
    expect(computeRevealDelay(-100)).toBe(2000)
  })

  it("clamps to 0 floor when centerXvw is far past right edge", () => {
    expect(computeRevealDelay(200)).toBe(0)
    expect(computeRevealDelay(500)).toBe(0)
  })
})
