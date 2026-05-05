import { describe, it, expect } from "vitest"
import { getGlassStyleForVariant } from "../shell"

/**
 * Test the pure glass style generator function.
 * Copilot glass system 6 variants: thin / regular / thick / tinted / chrome-up / chrome-down
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

  it("tinted variant: blur 28px with copilot-accent color-mix overlay", () => {
    const result = getGlassStyleForVariant("tinted", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundImage).toContain("var(--copilot-accent)")
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
})
