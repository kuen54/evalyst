"use client"

// Track B · the single shared SVG <filter> for backdrop refraction.
// Mounted ONCE, visually-hidden, inside CopilotShellProvider (store.tsx) — sibling region
// to GlowOverlay, co-located with useCopilotOpen. Returns null unless refraction is actually
// live (probe pass + copilot open + no a11y/inspector gate), so Safari/Firefox/forced-colors/
// inspector never mount an unused filter and nothing references #evalyst-glass-refraction there.
//
// color-interpolation-filters="sRGB" is LOAD-BEARING (without it Blink warps in linearRGB and
// 128=neutral drifts → visible offset at rest). feSpecularLighting from the canonical spec is
// DELIBERATELY dropped — Track A's RIM box-shadow already supplies the bright edge.

import { GLASS_LENS_MAP } from "./glass-lens-map.generated"
import { useLensGloballyLive, REFRACTION_FILTER_ID, LENS_STRONG_FILTER_ID } from "./glass-lens"

export function GlassRefractionDefs() {
  const live = useLensGloballyLive()
  if (!live) return null
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <defs>
        <filter
          id={REFRACTION_FILTER_ID}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
          filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse"
        >
          {/* (1) baked rounded-rect displacement map, stretched to the lens box.
                 R = horizontal fetch offset, G = vertical, 128 = neutral (no shift). */}
          <feImage href={GLASS_LENS_MAP} preserveAspectRatio="none" result="map" x="0%" y="0%" width="100%" height="100%" />
          {/* (2) chromatic aberration: SAME map, 3 scales R>G>B, keep one channel each, screen-recombine.
                 medium intensity: 26/23/20 -> subtle rim fringe, content behind stays legible. */}
          <feDisplacementMap in="SourceGraphic" in2="map" scale="26" xChannelSelector="R" yChannelSelector="G" result="warpR" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="23" xChannelSelector="R" yChannelSelector="G" result="warpG" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="20" xChannelSelector="R" yChannelSelector="G" result="warpB" />
          <feColorMatrix in="warpR" result="onlyR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feColorMatrix in="warpG" result="onlyG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feColorMatrix in="warpB" result="onlyB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          <feBlend in="onlyR" in2="onlyG" mode="screen" result="rg" />
          <feBlend in="rg" in2="onlyB" mode="screen" result="aberrated" />
          {/* (3) gentle frost over the refracted backdrop; low stdDeviation keeps refraction detail. */}
          <feGaussianBlur in="aberrated" stdDeviation="2" result="frosted" />
          <feMerge>
            <feMergeNode in="frosted" />
          </feMerge>
        </filter>

        {/* CLEAR / strong lens for the liquid-glass BAR (sticky header over scrolling rows):
            an all-over fractal warp so SHARP content (result rows) visibly ripples through the
            thin bar. Params verified in a side-by-side demo over real evalyst-style rows. */}
        <filter
          id={LENS_STRONG_FILTER_ID}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.014" numOctaves="2" seed="4" result="n" />
          <feGaussianBlur in="n" stdDeviation="1.1" result="sn" />
          {/* chroma: R>G>B at different scales, keep one channel each, screen-recombine */}
          <feDisplacementMap in="SourceGraphic" in2="sn" scale="22" xChannelSelector="R" yChannelSelector="G" result="cr" />
          <feDisplacementMap in="SourceGraphic" in2="sn" scale="18" xChannelSelector="R" yChannelSelector="G" result="cg" />
          <feDisplacementMap in="SourceGraphic" in2="sn" scale="14" xChannelSelector="R" yChannelSelector="G" result="cb" />
          <feColorMatrix in="cr" result="cor" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feColorMatrix in="cg" result="cog" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feColorMatrix in="cb" result="cob" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          <feBlend in="cor" in2="cog" mode="screen" result="crg" />
          <feBlend in="crg" in2="cob" mode="screen" />
        </filter>
      </defs>
    </svg>
  )
}
