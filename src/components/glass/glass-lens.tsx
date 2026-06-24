"use client"

// Track B · GlassLens — REAL backdrop refraction (feDisplacementMap) on a few hero
// surfaces only. Chromium-only by physics (backdrop-filter:url() is a Blink extension);
// everyone else degrades to TODAY's thick blur glass — never a broken/transparent surface.
//
// HARD RULES (do NOT relax):
// - Only SMALL, STATIC, open-on-demand `thick` portals may take the lens: Dialog content +
//   the compare detail popover (both mount when opened, unmount when closed). NEVER a
//   data-dense thin/regular tier, NEVER the full-page hero shell (viewport-sized refraction
//   re-rasterizes every frame → ~15fps idle, cut), NEVER Select (stays mounted-when-closed +
//   shared with the copilot panel's flat model picker), NEVER the tinted CTA / copilot toggle.
//   The hook type only accepts 'thick' for this reason.
// - The standard `backdrop-filter` carries url(); `-webkit-backdrop-filter` stays a LITERAL
//   blur string forever (Safari reads -webkit and drops the whole property if handed url()).
// - The COMPONENT gates url() OFF itself under any a11y/inspector condition. CSS !important
//   provably CANNOT strip an inline url() backdrop-filter on a portaled Dialog (the
//   load-bearing Track A asymmetry) — so correctness lives here, not in the stylesheet.

import * as React from "react"
import type { CSSProperties } from "react"
import { useCopilotOpen } from "./copilot-context"
import { lensRefractionSupported } from "./glass-lens-probe"

/** Matches getGlassStyleForVariant("thick") frost; hero reuses the same 40px base. */
export const THICK_BLUR_LITERAL = "blur(40px) saturate(1.3)"
/** Namespaced filter id (not bare #glass-refraction) to avoid collision. */
export const REFRACTION_FILTER_ID = "evalyst-glass-refraction"

/**
 * CLEAR lens: LOW blur (so the refraction is actually VISIBLE — a heavy frost erases the
 * displacement detail) + a turbulence-based all-over liquid warp. For the one place real
 * refraction reads in a calm data tool: a thin "liquid glass" BAR with sharp content
 * (result rows) scrolling UNDER it, so the rows visibly ripple through the bar. A thin bar
 * re-warps a small area on scroll (≈6% of a full-page hero) — affordable; idle is static.
 */
export const LENS_STRONG_FILTER_ID = "evalyst-glass-lens-strong"
const CLEAR_BLUR_LITERAL = "blur(6px) saturate(1.35)"

const A11Y_QUERIES = [
  "(prefers-reduced-transparency: reduce)",
  "(prefers-reduced-motion: reduce)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
] as const

// ---- Pure decision helpers (unit-tested directly; the hooks below just wire React state) ----
// Mirrors the codebase pattern where useGlassStyle delegates to the pure getGlassStyleForVariant.

/** Pure: refraction may emit url() only when probe passes AND no a11y veto AND not inspecting. */
export function computeRefractionAllowed(
  a11yBlocked: boolean,
  inspecting: boolean,
  probeSupported: boolean
): boolean {
  return !a11yBlocked && !inspecting && probeSupported
}

/**
 * Pure: the inline filter override. {} on every fallback rung (closed / not-allowed) — so
 * spreading it on the verbatim recipe is a no-op (zero regression). url() only when live.
 * Safari-never-url invariant: WebkitBackdropFilter is ALWAYS the literal blur.
 */
export function computeLensFilter(open: boolean, allowed: boolean): CSSProperties {
  if (!open || !allowed) return {}
  return {
    backdropFilter: `${THICK_BLUR_LITERAL} url(#${REFRACTION_FILTER_ID})`,
    WebkitBackdropFilter: THICK_BLUR_LITERAL,
  }
}

/**
 * Pure: the CLEAR-lens override (low blur + strong turbulence warp). {} on every fallback
 * rung — spreading it on the sticky-chrome recipe is a no-op (chrome keeps its blur). url()
 * only when live. Safari-never-url: WebkitBackdropFilter is the low-blur literal, no url().
 */
export function computeClearLens(open: boolean, allowed: boolean): CSSProperties {
  if (!open || !allowed) return {}
  return {
    backdropFilter: `${CLEAR_BLUR_LITERAL} url(#${LENS_STRONG_FILTER_ID})`,
    WebkitBackdropFilter: CLEAR_BLUR_LITERAL,
  }
}

/**
 * true only when refraction may emit url(): probe pass AND none of the four a11y queries
 * AND not inspecting. Live-subscribed so any DevTools/OS toggle re-renders and drops url()
 * immediately. The inspector signal is a body class (copilot-inspector-active) toggled by
 * inspector-overlay.tsx; globals.css line 428 strips backdrop-filter during inspect and that
 * strip hits the SAME inline-url()-on-portal asymmetry — so it MUST be in the component gate.
 */
function useRefractionAllowed(): boolean {
  const [allowed, setAllowed] = React.useState(false)
  React.useEffect(() => {
    const mqs = A11Y_QUERIES.map((q) => window.matchMedia(q))
    const compute = () => {
      const a11yBlocked = mqs.some((m) => m.matches)
      const inspecting = document.body.classList.contains("copilot-inspector-active")
      setAllowed(computeRefractionAllowed(a11yBlocked, inspecting, lensRefractionSupported()))
    }
    compute()
    mqs.forEach((m) => m.addEventListener("change", compute))
    // inspector toggles a body class (inspector-overlay.tsx) -> observe it so the lens drops url() live
    const mo = new MutationObserver(compute)
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] })
    return () => {
      mqs.forEach((m) => m.removeEventListener("change", compute))
      mo.disconnect()
    }
  }, [])
  return allowed
}

/**
 * globally live = allowed AND copilot open. Drives the <GlassRefractionDefs/> mount and sets
 * html[data-glass-refraction=on] purely as a "refraction is live" marker (for e2e assertions
 * + debugging) — there is no CSS consumer of the flag (the full-page hero refraction that used
 * the --glass-hero-filter CSS var was cut; the lens is now component-inline only).
 */
export function useLensGloballyLive(): boolean {
  const open = useCopilotOpen()
  const allowed = useRefractionAllowed()
  const live = open && allowed
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const html = document.documentElement
    if (live) html.dataset.glassRefraction = "on"
    else delete html.dataset.glassRefraction
    return () => {
      // on unmount of the last consumer, make sure the flag doesn't linger
      if (typeof document !== "undefined") delete document.documentElement.dataset.glassRefraction
    }
  }, [live])
  return live
}

/**
 * THE shared hook. Returns {} on EVERY fallback rung (closed / non-Blink / probe-fail /
 * any a11y / inspector) so spreading it on top of the verbatim recipe is a no-op — zero
 * regression. Returns the url() override ONLY when copilot open + Blink + probe-pass +
 * no a11y/inspector gate.
 *
 * @param _variant accepts only 'thick' — a type-level guard against ever lensing a
 *   data-dense tier, the hero shell (full-page refraction was cut), or the tinted CTA.
 */
export function useLensFilter(_variant: "thick"): CSSProperties {
  const open = useCopilotOpen()
  const allowed = useRefractionAllowed() // probe + 4 a11y queries + inspector signal
  // Blink reads the standard backdrop-filter and prefers it; the trailing url() refracts.
  // The leading literal blur means a (defensively) missing filter id degrades to blur, never
  // transparent. Safari reads -webkit- ONLY -> always the literal blur, never url().
  return computeLensFilter(open, allowed)
}

/**
 * The CLEAR-lens hook for the liquid-glass BAR (sticky header over scrolling content). Same
 * gating as useLensFilter; returns {} on every fallback rung so spreading it on the
 * sticky-chrome recipe is a no-op (the bar keeps its normal blur on non-Blink / a11y).
 */
export function useClearLens(): CSSProperties {
  const open = useCopilotOpen()
  const allowed = useRefractionAllowed()
  return computeClearLens(open, allowed)
}
