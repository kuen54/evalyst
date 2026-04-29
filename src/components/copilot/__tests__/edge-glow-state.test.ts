import { describe, it, expect } from "vitest"
import { computeTarget, type GlowSignals } from "../edge-glow-state"

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
