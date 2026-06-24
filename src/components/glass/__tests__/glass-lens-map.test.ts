import { describe, it, expect } from "vitest"
import { inflateSync } from "node:zlib"
import { GLASS_LENS_MAP } from "../glass-lens-map.generated"

/**
 * Track B · baked displacement-map artifact. The runtime imports this string only —
 * there is no mount-time canvas (static-filter-buffer contract). These assertions pin
 * the committed artifact so a drift (param change without regen) is caught here in
 * addition to the CI `gen:glass-map --check` byte guard.
 */
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

function decode(dataUri: string) {
  const b64 = dataUri.replace(/^data:image\/png;base64,/, "")
  const png = Buffer.from(b64, "base64")
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  let off = 8
  let idat = Buffer.alloc(0)
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString("latin1", off + 4, off + 8)
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)])
    off += 12 + len
  }
  const raw = inflateSync(idat)
  const stride = 1 + w * 4
  const px = (x: number, y: number): [number, number, number, number] => {
    const i = y * stride + 1 + x * 4
    return [raw[i] ?? 0, raw[i + 1] ?? 0, raw[i + 2] ?? 0, raw[i + 3] ?? 0]
  }
  return { png, w, h, px }
}

describe("GLASS_LENS_MAP artifact", () => {
  it("is a base64 PNG data-URI", () => {
    expect(GLASS_LENS_MAP.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("decodes to the 8-byte PNG signature", () => {
    const { png } = decode(GLASS_LENS_MAP)
    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIG)
  })

  it("is a 256x256 image", () => {
    const { w, h } = decode(GLASS_LENS_MAP)
    expect([w, h]).toEqual([256, 256])
  })

  it("center pixel is neutral (R==G==128, no displacement deep inside)", () => {
    const { px } = decode(GLASS_LENS_MAP)
    const [r, g, b, a] = px(128, 128)
    expect(r).toBe(128)
    expect(g).toBe(128)
    expect(b).toBe(128)
    expect(a).toBe(255)
  })

  it("rim pixels bend inward (R or G shifts off neutral at the edge band)", () => {
    const { px } = decode(GLASS_LENS_MAP)
    const left = px(8, 128) // left rim -> R pushes +x (inward)
    const top = px(128, 8) // top rim -> G pushes +y (inward)
    expect(left[0]).toBeGreaterThan(128)
    expect(top[1]).toBeGreaterThan(128)
  })

  it("is symmetric: right/bottom rims mirror left/top about neutral 128", () => {
    const { px } = decode(GLASS_LENS_MAP)
    const left = px(8, 128)[0]
    const right = px(247, 128)[0]
    const top = px(128, 8)[1]
    const bottom = px(128, 247)[1]
    // mirrored channel = 256 - value (e.g. 209 <-> 47)
    expect(left + right).toBe(256)
    expect(top + bottom).toBe(256)
  })
})
