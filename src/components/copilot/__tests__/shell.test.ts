import { describe, it, expect } from "vitest"
import { getGlassStyleForVariant } from "../shell"

/**
 * Test the pure glass style generator function.
 * Copilot glass system 9 variants: thin / regular / thick / tinted / chrome-up / chrome-down
 * + semantic: success / warning / danger
 */
describe("getGlassStyleForVariant", () => {
  it("returns transparent transition-only style when copilot closed", () => {
    const result = getGlassStyleForVariant("regular", false)
    expect(result.backdropFilter).toBeUndefined()
    expect(result.backgroundColor).toBeUndefined()
    expect(result.transition).toContain("background-color")
  })

  it("thin variant: blur 16px, transparent background", () => {
    const result = getGlassStyleForVariant("thin", true)
    expect(result.backdropFilter).toContain("blur(16px)")
    expect(result.backgroundColor).toContain("var(--card) 8%")
  })

  it("regular variant: blur 28px, ~35% card bg", () => {
    const result = getGlassStyleForVariant("regular", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 35%")
    expect(result.boxShadow).toContain("0 20px 50px -20px")
  })

  it("thick variant: blur 40px, ~55% card bg, heavier shadow", () => {
    const result = getGlassStyleForVariant("thick", true)
    expect(result.backdropFilter).toContain("blur(40px)")
    expect(result.backgroundColor).toContain("var(--card) 55%")
    expect(result.boxShadow).toContain("0 30px 60px -15px")
  })

  it("tinted variant: single-layer accent 14% bg + accent border + accent ambient shadow (aligned with GlassSegmentedItem active)", () => {
    const result = getGlassStyleForVariant("tinted", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    // 单层 accent bg（不再是 card 30% + gradient 双层）
    expect(result.backgroundColor).toContain("var(--copilot-accent)")
    expect(result.backgroundColor).toContain("14%")
    expect(result.backgroundImage).toBeUndefined()
    // accent 发光边
    expect(result.borderColor).toContain("var(--copilot-accent)")
    expect(result.borderColor).toContain("55%")
    // accent ambient 外光（40% accent）
    expect(result.boxShadow).toMatch(/0 3px 10px -2px color-mix\(in oklab, var\(--copilot-accent\) 40%/)
  })

  it("chrome-up variant: regular material + top edge highlight + downward shadow", () => {
    const result = getGlassStyleForVariant("chrome-up", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 35%")
    // 顶部切边高光（第一条 inset shadow，y = +1px）
    expect(result.boxShadow).toMatch(/inset 0 1px 0 oklch\(1 0 0 \/ 0\.6\)/)
    // 向下投影（正 y 偏移）
    expect(result.boxShadow).toMatch(/0 8px 24px -12px/)
  })

  it("chrome-down variant: regular material + bottom edge highlight + upward shadow", () => {
    const result = getGlassStyleForVariant("chrome-down", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 35%")
    // 底部切边高光（第一条 inset shadow，y = -1px）
    expect(result.boxShadow).toMatch(/inset 0 -1px 0 oklch\(1 0 0 \/ 0\.6\)/)
    // 向上投影（负 y 偏移）
    expect(result.boxShadow).toMatch(/0 -8px 24px -12px/)
  })

  it("success variant: regular material + emerald border + emerald ambient shadow", () => {
    const result = getGlassStyleForVariant("success", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 35%")
    // emerald-500 border (oklch 0.696 0.17 162.48)
    expect(result.borderColor).toContain("oklch(0.696 0.17 162.48)")
    // ambient shadow 也用 emerald 色 mix
    expect(result.boxShadow).toMatch(/oklch\(0\.696 0\.17 162\.48\)/)
  })

  it("warning variant: regular material + amber border + amber ambient shadow", () => {
    const result = getGlassStyleForVariant("warning", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    // amber-500 border (oklch 0.769 0.188 70.08)
    expect(result.borderColor).toContain("oklch(0.769 0.188 70.08)")
    expect(result.boxShadow).toMatch(/oklch\(0\.769 0\.188 70\.08\)/)
  })

  it("danger variant: regular material + red border + red ambient shadow", () => {
    const result = getGlassStyleForVariant("danger", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    // red-500 border (oklch 0.637 0.237 25.33)
    expect(result.borderColor).toContain("oklch(0.637 0.237 25.33)")
    expect(result.boxShadow).toMatch(/oklch\(0\.637 0\.237 25\.33\)/)
  })
})
