// Capability probe for Track B backdrop refraction.
//
// `backdrop-filter: url(#svg)` is a Blink-ONLY extension. We must return TRUE only where it
// ACTUALLY renders, and bias HARD toward false: a false-NEGATIVE just yields today's blur
// glass (fine); a false-POSITIVE emits a url() backdrop-filter on an engine that can't apply
// it, which can leave the surface WORSE than the blur fallback (e.g. Safari collapsing the
// prefixed/standard alias and dropping the whole url()-bearing declaration → bare panel).
//
// Two gates, BOTH required:
//  1) Blink-family — `navigator.userAgentData` (UA-Client-Hints) exists ONLY in Blink
//     (Chrome/Edge/Brave/Arc/Electron/Android-WebView). Safari/Firefox/iOS-WebKit don't
//     implement it. We test its mere EXISTENCE (not its contents → nothing to spoof). This is
//     the decisive gate: WebKit supports url() on canvas/element `filter` but NOT on
//     `backdrop-filter`, so the pixel readback below ALONE would false-positive on Safari.
//  2) feDisplacementMap actually renders — offscreen readback via the regular `filter`
//     property (same SVG primitive; the only surface we can sample, since a live
//     backdrop-filter cannot be read back via canvas). Catches a Blink with SVG filters off.

let cached: boolean | null = null

export function lensRefractionSupported(): boolean {
  if (cached !== null) return cached
  if (typeof window === "undefined" || typeof document === "undefined") return false // SSR
  try {
    // baseline: backdrop-filter blur must exist at all
    const hasBlur =
      (window.CSS?.supports?.("backdrop-filter", "blur(1px)") ?? false) ||
      (window.CSS?.supports?.("-webkit-backdrop-filter", "blur(1px)") ?? false)
    if (!hasBlur) return (cached = false)

    // Offscreen scene: a half-red / half-blue source, displaced hard in +x by a flat
    // R=255 map. If feDisplacementMap actually ran, the LEFT pixel pulls blue in from
    // the right (B channel rises). Safari/FF ignore the SVG-ref filter -> left stays red.
    const SIZE = 8
    const src = document.createElement("canvas"); src.width = src.height = SIZE
    const sx = src.getContext("2d", { willReadFrequently: true })
    if (!sx) return (cached = false)
    sx.fillStyle = "#ff0000"; sx.fillRect(0, 0, SIZE / 2, SIZE)
    sx.fillStyle = "#0000ff"; sx.fillRect(SIZE / 2, 0, SIZE / 2, SIZE)

    // hidden inline <svg> filter: constant R=255 (=> max +x shift), G=128 (no y shift)
    const flatMap =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'>" +
          "<rect width='2' height='2' fill='rgb(255,128,128)'/></svg>"
      )
    const host = document.createElement("div")
    host.setAttribute("aria-hidden", "true")
    host.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden"
    host.innerHTML =
      '<svg width="0" height="0"><filter id="evalyst-probe" color-interpolation-filters="sRGB">' +
      `<feImage href="${flatMap}" result="m" preserveAspectRatio="none" x="0" y="0" width="${SIZE}" height="${SIZE}"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="m" scale="${SIZE}" xChannelSelector="R" yChannelSelector="G"/>` +
      "</filter></svg>"
    document.body.appendChild(host)

    const out = document.createElement("canvas"); out.width = out.height = SIZE
    const ox = out.getContext("2d", { willReadFrequently: true })
    if (!ox) { document.body.removeChild(host); return (cached = false) }
    ox.filter = "url(#evalyst-probe)"   // SVG filter primitive renders here iff the engine supports SVG-ref filters
    ox.drawImage(src, 0, 0)
    const left = ox.getImageData(0, 0, 1, 1).data // sample left edge
    document.body.removeChild(host)

    // Blink warped blue in -> B channel rises well above 0; Safari/FF leave pure red (B~0).
    const warped = (left[2] ?? 0) > 40

    // Decisive Blink-family gate (see header): WebKit passes the readback above (it supports
    // url() on canvas `filter`) but cannot apply url() on backdrop-filter — so the readback
    // alone would false-positive on Safari. userAgentData exists only in Blink; gating on it
    // excludes WebKit/Gecko. Bias to false-negative: a non-Blink browser gets today's blur glass.
    const isBlink =
      typeof navigator !== "undefined" &&
      !!(navigator as Navigator & { userAgentData?: unknown }).userAgentData

    return (cached = warped && isBlink)
  } catch {
    return (cached = false)
  }
}

/** Test-only: reset the module-level memo. NOT for production use. */
export function __resetLensProbeCacheForTests() {
  cached = null
}
