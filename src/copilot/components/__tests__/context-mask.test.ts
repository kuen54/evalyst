import { describe, expect, it } from "vitest"
import { maskMotionStyle, rectsEqual, type MaskRect } from "../context-mask"

// 最小 DOMRect mock：maskMotionStyle / rectsEqual 只读 top/left/width/height。
function rect(top: number, left: number, width: number, height: number): DOMRect {
  return { top, left, width, height } as DOMRect
}

function maskRect(elementKey: string, tag: number, r: DOMRect | null): MaskRect {
  return { elementKey, tag, rect: r }
}

describe("maskMotionStyle", () => {
  it("uses translate3d with -2px offset and +4px size padding", () => {
    const style = maskMotionStyle(rect(100, 50, 200, 30))
    expect(style.transform).toBe("translate3d(48px, 98px, 0)")
    expect(style.width).toBe(204)
    expect(style.height).toBe(34)
  })

  it("returns no top/left key (composites via transform, not layout)", () => {
    const style = maskMotionStyle(rect(100, 50, 200, 30))
    expect(Object.prototype.hasOwnProperty.call(style, "top")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(style, "left")).toBe(false)
  })

  it("handles 0,0 origin with negative -2px offset", () => {
    const style = maskMotionStyle(rect(0, 0, 120, 40))
    expect(style.transform).toBe("translate3d(-2px, -2px, 0)")
    expect(style.width).toBe(124)
    expect(style.height).toBe(44)
  })
})

describe("rectsEqual", () => {
  it("(a) two arrays with same structure + same four-value rects → true", () => {
    const prev = [maskRect("k1", 1, rect(10, 20, 100, 50)), maskRect("k2", 2, rect(0, 0, 30, 30))]
    const next = [maskRect("k1", 1, rect(10, 20, 100, 50)), maskRect("k2", 2, rect(0, 0, 30, 30))]
    expect(rectsEqual(prev, next)).toBe(true)
  })

  it("(b) only rect.top differs by 1px → false", () => {
    const prev = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    const next = [maskRect("k1", 1, rect(11, 20, 100, 50))]
    expect(rectsEqual(prev, next)).toBe(false)
  })

  it("(c) only tag differs → false", () => {
    const prev = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    const next = [maskRect("k1", 2, rect(10, 20, 100, 50))]
    expect(rectsEqual(prev, next)).toBe(false)
  })

  it("(c') only elementKey differs → false", () => {
    const prev = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    const next = [maskRect("k2", 1, rect(10, 20, 100, 50))]
    expect(rectsEqual(prev, next)).toBe(false)
  })

  it("(d) different length → false", () => {
    const prev = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    const next = [maskRect("k1", 1, rect(10, 20, 100, 50)), maskRect("k2", 2, rect(0, 0, 30, 30))]
    expect(rectsEqual(prev, next)).toBe(false)
  })

  it("(e) prev=null → false", () => {
    const next = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    expect(rectsEqual(null, next)).toBe(false)
  })

  it("(f) both rects null (text_selection) with same key/tag → true", () => {
    const prev = [maskRect("sel:1", 3, null)]
    const next = [maskRect("sel:1", 3, null)]
    expect(rectsEqual(prev, next)).toBe(true)
  })

  it("(g) one side rect null, other non-null → false", () => {
    const prev = [maskRect("k1", 1, null)]
    const next = [maskRect("k1", 1, rect(10, 20, 100, 50))]
    expect(rectsEqual(prev, next)).toBe(false)
    expect(rectsEqual(next, prev)).toBe(false)
  })

  it("(h) empty array vs empty array → true", () => {
    expect(rectsEqual([], [])).toBe(true)
  })
})
