"use client"

import { useEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

/**
 * EdgeGlow — WebGL-driven inner-edge glow band around <main>.
 *
 * Rendering only happens when ALL of:
 *   - copilot panel is open
 *   - prefers-reduced-motion is not "reduce"
 *   - WebGL context creation + shader compile succeed
 *
 * When any gate fails the component returns null (no canvas, no GL context).
 *
 * See docs/superpowers/specs/2026-04-29-copilot-edge-glow-webgl-design.md.
 */
export function EdgeGlow() {
  const { open } = useCopilotStore()
  const [reducedMotion, setReducedMotion] = useState<boolean>(false)
  const [webglFailed, setWebglFailed] = useState<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Track prefers-reduced-motion reactively.
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  if (!open) return null
  if (reducedMotion) return null
  if (webglFailed) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 0 }}
    />
  )
}
