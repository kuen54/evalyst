import { describe, it, expect } from "vitest"
import { getGlassStyleForVariant } from "../shell"

/**
 * Test the pure glass style generator function.
 * Copilot glass system 7 variants: thin / regular / thick / tinted
 * + semantic: success / warning / danger.
 *
 * (上下方向 sticky-chrome 阴影之前是 9 档玻璃中的两档，R2 #T3 已 inline 到 sticky-chrome.tsx；
 *  Sticky 组件内部的方向阴影测试如有需求加在 sticky-chrome.test.ts。)
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
