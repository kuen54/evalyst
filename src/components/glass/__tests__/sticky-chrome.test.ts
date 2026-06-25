import { describe, it, expect } from "vitest"
import { stickyChromeStyle } from "../sticky-chrome"

/**
 * Sticky 顶/底结构条的纯样式生成器测试。
 *
 * Track A premium-edge 给 sticky-up / sticky-down 两档加了方向性 rim —— 这两条是 Track A 唯一
 * 没被 shell.test.ts filter-buffer lock 覆盖的代码路径。核心保证同 shell：blur 字面锁定
 * （HAIRLINE R7 HOLD R6 的 20px saturate(1.3) brightness(1.06) contrast(1.05)，blur 只降不升；
 * brightness/contrast 按暗模式 legibility 钳制——让 contrast 担可读性主力）、永不出现 url()
 * （Safari 见 url() 会整条丢掉 backdrop-filter）、up/down 共享统一左上光源、只靠外投影方向区分顶/底。
 * R7 hairline：STICKY_RIM mirror RIM_REGULAR —— DROP 右下黑切边层，只剩左上高光 + 底缘白落地线。
 */
describe("stickyChromeStyle", () => {
  it("returns transition-only style when copilot closed", () => {
    const r = stickyChromeStyle("up", false)
    expect(r.backdropFilter).toBeUndefined()
    expect(r.backgroundColor).toBeUndefined()
    expect(r.transition).toContain("background-color")
  })

  it("filter-buffer lock: both directions keep blur(20px) saturate(1.3) brightness(1.06) contrast(1.05) and never use url()", () => {
    for (const dir of ["up", "down"] as const) {
      const r = stickyChromeStyle(dir, true)
      expect(r.backdropFilter).toBe("blur(20px) saturate(1.3) brightness(1.06) contrast(1.05)")
      expect(r.WebkitBackdropFilter).toBe("blur(20px) saturate(1.3) brightness(1.06) contrast(1.05)")
      expect(r.WebkitBackdropFilter).not.toContain("url(")
      expect(r.backdropFilter).not.toContain("url(")
      // mode-aware light-dark bg; sticky stays a tier above regular in both branches (light 26% > regular 20%, dark 17% > regular 11%)
      expect(r.backgroundColor).toContain("var(--card) 26%") // light fill (clean white frost)
      expect(r.backgroundColor).toContain("var(--card) 17%") // dark fill (more transparent)
    }
  })

  it("unified top-left light source: up and down share identical rim insets (hairline: dark corner dropped)", () => {
    const up = stickyChromeStyle("up", true).boxShadow ?? ""
    const down = stickyChromeStyle("down", true).boxShadow ?? ""
    for (const shadow of [up, down]) {
      expect(shadow).toContain("inset 1px 1px 1px") // 左上提亮（R7 仍 1px spread feather）
      expect(shadow).toContain("inset 0 -1px 1px oklch(1 0 0 / 0.1)") // 底缘淡白落地线（暗模式落地沿，R7 α 0.13→0.1，与 RIM_REGULAR 同步）
      // R7 hairline：mirror RIM_REGULAR，DROP 右下黑切边层 —— sticky 独立性靠方向 drop-shadow + 高一档 fill，不靠右下暗角
      expect(shadow).not.toMatch(/inset -1px -1px/)
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
