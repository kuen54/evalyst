import { describe, it, expect } from "vitest"
import { computeTarget, type GlowSignals } from "../edge-glow-state"
import { springStep } from "../edge-glow-state"

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
  it("IDLE: low intensity, thin band", () => {
    const t = computeTarget(baseSignals())
    expect(t.intensity).toBe(0.22)
    expect(t.thicknessPx).toBe(3)
    expect(t.noiseSpeed).toBe(0.15)
  })

  it("TYPING overrides IDLE", () => {
    const t = computeTarget(baseSignals({ typing: true }))
    expect(t.intensity).toBe(0.35)
    expect(t.thicknessPx).toBe(5)
  })

  it("INSPECTING overrides TYPING", () => {
    const t = computeTarget(baseSignals({ typing: true, inspecting: true }))
    expect(t.intensity).toBe(0.50)
    expect(t.thicknessPx).toBe(7)
    expect(t.colorPhase).toBe(0.30)
  })

  it("PROCESSING (busy) overrides INSPECTING", () => {
    const t = computeTarget(baseSignals({ busy: true, inspecting: true }))
    expect(t.intensity).toBe(0.90)
    expect(t.thicknessPx).toBe(11)
    expect(t.noiseSpeed).toBe(1.40)
  })

  it("FLASH overrides everything (keeps PROCESSING-level targets)", () => {
    const t = computeTarget(baseSignals({ flashActive: true }))
    expect(t.intensity).toBe(0.90)
    expect(t.thicknessPx).toBe(11)
  })

  it("IDLE colorPhase oscillates with nowMs", () => {
    const a = computeTarget(baseSignals({ nowMs: 0 }))
    const b = computeTarget(baseSignals({ nowMs: 3000 }))
    expect(a.colorPhase).not.toBe(b.colorPhase)
    // bounded 0.2..0.8 (0.5 ± 0.3)
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
