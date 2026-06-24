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

/**
 * Track A「premium edge」不变量。核心保证：边缘光学升级 NOT 改 filter buffer
 * （blur 半径全档逐字节不变 = 不引入新 backdrop-filter paint 成本，详情页 N 行列表安全），
 * 且色散 fringe / 镜面扫光严格只挂 thick（用户钦定 fringe 仅 thick/hero，数据密集档不挂）。
 */
describe("getGlassStyleForVariant · Track A premium edge", () => {
  const ALL = ["thin", "regular", "thick", "tinted", "success", "warning", "danger"] as const
  const FILTER: Record<(typeof ALL)[number], string> = {
    thin: "blur(16px) saturate(1.2)",
    regular: "blur(28px) saturate(1.25)",
    thick: "blur(40px) saturate(1.3)",
    tinted: "blur(28px) saturate(1.25)",
    success: "blur(28px) saturate(1.25)",
    warning: "blur(28px) saturate(1.25)",
    danger: "blur(28px) saturate(1.25)",
  }

  it("filter-buffer lock: every variant keeps its exact blur radius and never uses url()", () => {
    for (const v of ALL) {
      const r = getGlassStyleForVariant(v, true)
      // 逐字节锁定 —— 任何改 blur 的回归都会在这里炸（防止误以为"顺手调一下更糊"）
      expect(r.backdropFilter).toBe(FILTER[v])
      expect(r.WebkitBackdropFilter).toBe(FILTER[v])
      // Safari 一旦看到 url() 会整条丢掉 backdrop-filter —— -webkit 永远是 blur 字面量
      expect(r.WebkitBackdropFilter).not.toContain("url(")
      expect(r.backdropFilter).not.toContain("url(")
    }
  })

  it("directional rim: all open variants carry top-left bright / bottom-right dark inset bevel", () => {
    for (const v of ALL) {
      const shadow = getGlassStyleForVariant(v, true).boxShadow ?? ""
      // thick 用 1.5px，其余用 1px；统一断言"存在左上正向 + 右下负向 inset"
      expect(shadow).toMatch(/inset 1(?:\.5)?px 1(?:\.5)?px 0/)
      expect(shadow).toMatch(/inset -1(?:\.5)?px -1(?:\.5)?px 0/)
    }
  })

  it("chromatic fringe is thick-only (no color edge on data-dense tiers)", () => {
    const thick = getGlassStyleForVariant("thick", true).boxShadow ?? ""
    expect(thick).toMatch(/0\.62 0\.21 25/) // 暖红左缘
    expect(thick).toMatch(/0\.66 0\.17 255/) // 冷蓝右缘
    for (const v of ["thin", "regular", "tinted", "success", "warning", "danger"] as const) {
      const shadow = getGlassStyleForVariant(v, true).boxShadow ?? ""
      expect(shadow).not.toMatch(/0\.21 25/)
      expect(shadow).not.toMatch(/0\.17 255/)
    }
  })

  it("specular sweep backgroundImage is thick-only", () => {
    expect(getGlassStyleForVariant("thick", true).backgroundImage).toContain("linear-gradient(135deg")
    for (const v of ["thin", "regular", "tinted", "success", "warning", "danger"] as const) {
      expect(getGlassStyleForVariant(v, true).backgroundImage).toBeUndefined()
    }
  })

  it("closed state carries no edge optics (transition only)", () => {
    for (const v of ALL) {
      const r = getGlassStyleForVariant(v, false)
      expect(r.boxShadow).toBeUndefined()
      expect(r.backgroundImage).toBeUndefined()
    }
  })
})
