import { describe, it, expect } from "vitest"
import { stickyChromeStyle } from "../sticky-chrome"

/**
 * Sticky 顶/底结构条的纯样式生成器测试。
 *
 * Track A premium-edge 给 sticky-up / sticky-down 两档加了方向性 rim —— 这两条是 Track A 唯一
 * 没被 shell.test.ts filter-buffer lock 覆盖的代码路径。核心保证同 shell：blur 半径不变（28px）、
 * 永不出现 url()（Safari 见 url() 会整条丢掉 backdrop-filter）、up/down 共享统一左上光源、
 * 只靠外投影方向区分顶/底。
 */
describe("stickyChromeStyle", () => {
  it("returns transition-only style when copilot closed", () => {
    const r = stickyChromeStyle("up", false)
    expect(r.backdropFilter).toBeUndefined()
    expect(r.backgroundColor).toBeUndefined()
    expect(r.transition).toContain("background-color")
  })

  it("filter-buffer lock: both directions keep blur(28px) saturate(1.25) and never use url()", () => {
    for (const dir of ["up", "down"] as const) {
      const r = stickyChromeStyle(dir, true)
      expect(r.backdropFilter).toBe("blur(28px) saturate(1.25)")
      expect(r.WebkitBackdropFilter).toBe("blur(28px) saturate(1.25)")
      expect(r.WebkitBackdropFilter).not.toContain("url(")
      expect(r.backdropFilter).not.toContain("url(")
      // sticky 比 regular 高一档：45% bg
      expect(r.backgroundColor).toContain("var(--card) 45%")
    }
  })

  it("unified top-left light source: up and down share identical rim insets", () => {
    const up = stickyChromeStyle("up", true).boxShadow ?? ""
    const down = stickyChromeStyle("down", true).boxShadow ?? ""
    for (const shadow of [up, down]) {
      expect(shadow).toContain("inset 1px 1px 0") // 左上提亮
      expect(shadow).toContain("inset 0 -1px 0 oklch(1 0 0 / 0.08)") // 底缘淡白线（暗模式落地沿）
      expect(shadow).toContain("inset -1px -1px 0") // 右下压暗
    }
  })

  it("direction differs only in outer drop shadow", () => {
    const up = stickyChromeStyle("up", true).boxShadow ?? ""
    const down = stickyChromeStyle("down", true).boxShadow ?? ""
    expect(up).toContain("0 8px 24px -12px") // 向下投
    expect(up).not.toContain("0 -8px 24px")
    expect(down).toContain("0 -8px 24px -12px") // 向上投
    expect(down).not.toContain("0 8px 24px -12px")
  })
})
