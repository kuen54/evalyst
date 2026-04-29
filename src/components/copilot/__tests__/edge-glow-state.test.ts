import { describe, it, expect } from "vitest"
import { computeTarget, springStep, computeFlash, FLASH_DURATION_MS, type GlowSignals } from "../edge-glow-state"

function baseSignals(overrides: Partial<GlowSignals> = {}): GlowSignals {
  return {
    typing: false,
    inspecting: false,
    busy: false,
    flashActive: false,
    nowMs: 0,
    ...overrides,
  }
}

describe("computeTarget", () => {
  it("IDLE: V2.1 values (intensity 0.40, thickness 30, amplitude 4)", () => {
    const t = computeTarget(baseSignals())
    expect(t.intensity).toBe(0.40)
    expect(t.thicknessPx).toBe(30)
    expect(t.noiseSpeed).toBe(0.15)
    expect(t.amplitude).toBe(4)
  })

  it("TYPING overrides IDLE (intensity 0.55, thickness 40, amplitude 6)", () => {
    const t = computeTarget(baseSignals({ typing: true }))
    expect(t.intensity).toBe(0.55)
    expect(t.thicknessPx).toBe(40)
    expect(t.amplitude).toBe(6)
  })

  it("INSPECTING overrides TYPING (intensity 0.70, thickness 50, amplitude 10, colorPhase 0.25)", () => {
    const t = computeTarget(baseSignals({ typing: true, inspecting: true }))
    expect(t.intensity).toBe(0.70)
    expect(t.thicknessPx).toBe(50)
    expect(t.amplitude).toBe(10)
    expect(t.colorPhase).toBe(0.25)
  })

  it("PROCESSING (busy) overrides INSPECTING (intensity 0.95, thickness 70, amplitude 20, noiseSpeed 1.4)", () => {
    const t = computeTarget(baseSignals({ busy: true, inspecting: true }))
    expect(t.intensity).toBe(0.95)
    expect(t.thicknessPx).toBe(70)
    expect(t.noiseSpeed).toBe(1.40)
    expect(t.amplitude).toBe(20)
  })

  it("FLASH overrides everything (uses PROCESSING-level targets)", () => {
    const t = computeTarget(baseSignals({ flashActive: true }))
    expect(t.intensity).toBe(0.95)
    expect(t.thicknessPx).toBe(70)
    expect(t.amplitude).toBe(20)
  })

  it("IDLE colorPhase oscillates with nowMs", () => {
    const a = computeTarget(baseSignals({ nowMs: 0 }))
    const b = computeTarget(baseSignals({ nowMs: 3000 }))
    expect(a.colorPhase).not.toBe(b.colorPhase)
    expect(a.colorPhase).toBeGreaterThanOrEqual(0.2)
    expect(a.colorPhase).toBeLessThanOrEqual(0.8)
    expect(b.colorPhase).toBeGreaterThanOrEqual(0.2)
    expect(b.colorPhase).toBeLessThanOrEqual(0.8)
  })

  it("PROCESSING colorPhase wraps 0..1 via mod", () => {
    for (const nowMs of [0, 500, 1500, 5000, 10000]) {
      const t = computeTarget(baseSignals({ busy: true, nowMs }))
      expect(t.colorPhase).toBeGreaterThanOrEqual(0)
      expect(t.colorPhase).toBeLessThan(1)
    }
  })
})

describe("springStep", () => {
  it("converges from 0 toward 1 within 50 frames at 60fps", () => {
    let value = 0
    let velocity = 0
    const dt = 1 / 60
    for (let i = 0; i < 50; i++) {
      ;[value, velocity] = springStep(value, velocity, 1, dt)
    }
    expect(value).toBeGreaterThan(0.99)
    expect(value).toBeLessThan(1.01)
  })

  it("does not overshoot (critically damped)", () => {
    let value = 0
    let velocity = 0
    let maxValue = 0
    for (let i = 0; i < 120; i++) {
      ;[value, velocity] = springStep(value, velocity, 1, 1 / 60)
      if (value > maxValue) maxValue = value
    }
    // critically damped: max should not exceed target by more than 0.5%
    expect(maxValue).toBeLessThan(1.005)
  })

  it("holds at target (no drift when value === target and velocity=0)", () => {
    const [v1, vel1] = springStep(1, 0, 1, 1 / 60)
    expect(v1).toBeCloseTo(1, 6)
    expect(vel1).toBeCloseTo(0, 6)
  })

  it("handles downward transition (target 0 from value 1)", () => {
    let value = 1
    let velocity = 0
    for (let i = 0; i < 60; i++) {
      ;[value, velocity] = springStep(value, velocity, 0, 1 / 60)
    }
    expect(value).toBeLessThan(0.05)
  })
})

describe("computeFlash", () => {
  it("returns 0 when flashStartMs is null", () => {
    expect(computeFlash(null, 1000)).toBe(0)
  })

  it("returns 1 at t=0", () => {
    expect(computeFlash(500, 500)).toBeCloseTo(1, 4)
  })

  it("decays exponentially at t=400ms", () => {
    // exp(-5 * 0.4) = exp(-2) ~ 0.1353
    expect(computeFlash(0, 400)).toBeCloseTo(Math.exp(-2), 3)
  })

  it("returns 0 after 800ms window closes", () => {
    expect(computeFlash(0, FLASH_DURATION_MS + 1)).toBe(0)
    expect(computeFlash(0, 2000)).toBe(0)
  })

  it("exports FLASH_DURATION_MS as 800", () => {
    expect(FLASH_DURATION_MS).toBe(800)
  })
})
