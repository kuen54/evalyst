import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGlassStyleForVariant } from "../shell"

/**
 * Test the pure glass style generator function.
 * Copilot glass system 4 variants: thin / regular / thick / tinted
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
    expect(result.backgroundColor).toBe("transparent")
  })

  it("regular variant: blur 28px, ~35% card bg", () => {
    const result = getGlassStyleForVariant("regular", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 35%")
  })

  it("thick variant: blur 40px, ~55% card bg, heavier shadow", () => {
    const result = getGlassStyleForVariant("thick", true)
    expect(result.backdropFilter).toContain("blur(40px)")
    expect(result.backgroundColor).toContain("var(--card) 55%")
    expect(result.boxShadow).toContain("30px")
  })

  it("tinted variant: blur 28px with primary color-mix overlay", () => {
    const result = getGlassStyleForVariant("tinted", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundImage).toContain("var(--primary)")
  })
})
