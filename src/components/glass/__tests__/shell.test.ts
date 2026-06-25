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

  it("thin variant: blur 14px, light-dark bg (light 6% / dark 3% card)", () => {
    const result = getGlassStyleForVariant("thin", true)
    expect(result.backdropFilter).toContain("blur(14px)")
    // mode-aware fill: light branch = clean restrained white frost, dark branch = more transparent
    expect(result.backgroundColor).toContain("light-dark(")
    expect(result.backgroundColor).toContain("var(--card) 6%") // light fill (clean white, restrained)
    expect(result.backgroundColor).toContain("var(--card) 3%") // R7 dark fill (unchanged)
  })

  it("regular variant: blur 20px, light-dark bg (light 20% / dark 11% card)", () => {
    const result = getGlassStyleForVariant("regular", true)
    expect(result.backdropFilter).toContain("blur(20px)")
    expect(result.backgroundColor).toContain("var(--card) 20%") // light fill (clean white, restrained)
    expect(result.backgroundColor).toContain("var(--card) 11%") // R7 dark fill (unchanged)
    expect(result.boxShadow).toContain("0 20px 50px -20px")
  })

  it("thick variant: blur 28px, light-dark bg (light 30% / dark 19% card), heavier shadow", () => {
    const result = getGlassStyleForVariant("thick", true)
    expect(result.backdropFilter).toContain("blur(28px)")
    expect(result.backgroundColor).toContain("var(--card) 30%") // light fill (clean white, restrained)
    expect(result.backgroundColor).toContain("var(--card) 19%") // R7 dark fill (unchanged)
    expect(result.boxShadow).toContain("0 30px 60px -15px")
  })

  it("tinted variant: single-layer accent bg (light accent 13% / dark 9%) + accent border + accent ambient shadow (aligned with GlassSegmentedItem active)", () => {
    const result = getGlassStyleForVariant("tinted", true)
    expect(result.backdropFilter).toContain("blur(20px)")
    // 单层 accent bg（不再是 card 30% + gradient 双层），mode-aware light-dark()
    expect(result.backgroundColor).toContain("var(--copilot-accent)")
    expect(result.backgroundColor).toContain("var(--copilot-accent) 13%") // light accent fill (restrained)
    expect(result.backgroundColor).toContain("var(--copilot-accent) 9%") // R7 dark accent fill (unchanged)
    expect(result.backgroundImage).toBeUndefined()
    // accent 发光边
    expect(result.borderColor).toContain("var(--copilot-accent)")
    expect(result.borderColor).toContain("55%")
    // accent ambient 外光（42% accent）
    expect(result.boxShadow).toMatch(/0 3px 10px -2px color-mix\(in oklab, var\(--copilot-accent\) 42%/)
  })

  it("success variant: regular material (light-dark bg light 20% / dark 11%) + emerald border + emerald ambient shadow", () => {
    const result = getGlassStyleForVariant("success", true)
    expect(result.backdropFilter).toContain("blur(20px)")
    expect(result.backgroundColor).toContain("var(--card) 20%") // light fill (clean white, restrained)
    expect(result.backgroundColor).toContain("var(--card) 11%") // R7 dark fill (unchanged)
    // emerald-500 border (oklch 0.696 0.17 162.48)
    expect(result.borderColor).toContain("oklch(0.696 0.17 162.48)")
    // ambient shadow 也用 emerald 色 mix
    expect(result.boxShadow).toMatch(/oklch\(0\.696 0\.17 162\.48\)/)
  })

  it("warning variant: regular material + amber border + amber ambient shadow", () => {
    const result = getGlassStyleForVariant("warning", true)
    expect(result.backdropFilter).toContain("blur(20px)")
    // amber-500 border (oklch 0.769 0.188 70.08)
    expect(result.borderColor).toContain("oklch(0.769 0.188 70.08)")
    expect(result.boxShadow).toMatch(/oklch\(0\.769 0\.188 70\.08\)/)
  })

  it("danger variant: regular material + red border + red ambient shadow", () => {
    const result = getGlassStyleForVariant("danger", true)
    expect(result.backdropFilter).toContain("blur(20px)")
    // red-500 border (oklch 0.637 0.237 25.33)
    expect(result.borderColor).toContain("oklch(0.637 0.237 25.33)")
    expect(result.boxShadow).toMatch(/oklch\(0\.637 0\.237 25\.33\)/)
  })
})

/**
 * Track A「premium edge」不变量。2026-06 透亮 + HAIRLINE 边 R7：blur 半径与 luminance 旋钮全档 HOLD R6
 * 字面量（thin 14 / regular 20 / thick 28）—— blur=paint 成本只降不升，R7 只动 fill% 与 rim；filter buffer
 * 仍逐字节受测，任何意外漂移都会炸。色散 fringe / 镜面扫光严格只挂 thick（用户钦定 fringe 仅 thick/hero，
 * 数据密集档不挂；本轮仍明确 NOT 给 regular 加 SWEEP_SOFT/FRINGE_SOFT，下面两条 thick-only 测试不变）。
 * regular/semantic brightness 按暗模式 legibility 钳制收在 1.08（让 contrast(1.04) 担可读性主力）；thick 1.12。
 */
describe("getGlassStyleForVariant · Track A premium edge", () => {
  const ALL = ["thin", "regular", "thick", "tinted", "success", "warning", "danger"] as const
  const FILTER: Record<(typeof ALL)[number], string> = {
    thin: "blur(14px) saturate(1.25) brightness(1.07)",
    regular: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
    thick: "blur(28px) saturate(1.35) brightness(1.12) contrast(1.05)",
    tinted: "blur(20px) saturate(1.3) brightness(1.08)",
    success: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
    warning: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
    danger: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
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

  it("directional rim: all open variants carry the top-left bright inset bevel (load-bearing edge)", () => {
    for (const v of ALL) {
      const shadow = getGlassStyleForVariant(v, true).boxShadow ?? ""
      // 左上提亮 bevel 是全档共有的「玻璃斜切边吃光」主光线（光源左上）。
      // R5 起 feather 成 1-2px 模糊内描（软化生硬），不锁 0-blur 半径，只断言方向 offset 存在。
      expect(shadow).toMatch(/inset 1(?:\.5)?px 1(?:\.5)?px/)
    }
  })

  it("R7 hairline: regular/thick/tinted/semantic drop the faint bottom-right dark bevel; only thin keeps it", () => {
    // R7「边缘还可以薄一些」：regular 系 + thick + tinted 把最弱的右下暗 inset 收掉，rim 收成
    // 「左上提亮 + 白顶线 + 白底落地线」hairline 软光 —— 卡片轮廓改由 border + drop-shadow 兜底。
    // 只有 thin（数据密集，无白底落地线、需第三条 offset 闭合 corner）保留它自己的右下暗 inset。
    for (const v of ["regular", "thick", "tinted", "success", "warning", "danger"] as const) {
      const shadow = getGlassStyleForVariant(v, true).boxShadow ?? ""
      expect(shadow).not.toMatch(/inset -1(?:\.5)?px -1(?:\.5)?px/)
    }
    const thin = getGlassStyleForVariant("thin", true).boxShadow ?? ""
    expect(thin).toMatch(/inset -1px -1px/)
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
