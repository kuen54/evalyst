"use client"

import { useEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"
import { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE } from "./edge-glow-shader"
import {
  computeTarget,
  computeFlash,
  springStep,
  FLASH_DURATION_MS,
  type GlowTargets,
} from "./edge-glow-state"

interface GlContext {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  uniforms: {
    u_resolution: WebGLUniformLocation | null
    u_time: WebGLUniformLocation | null
    u_intensity: WebGLUniformLocation | null
    u_thickness_px: WebGLUniformLocation | null
    u_noise_speed: WebGLUniformLocation | null
    u_color_phase: WebGLUniformLocation | null
    u_flash: WebGLUniformLocation | null
    u_corner_px: WebGLUniformLocation | null
    u_amplitude: WebGLUniformLocation | null
  }
}

function compileShader(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[EdgeGlow] shader compile failed:", gl.getShaderInfoLog(shader))
    }
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function initGl(canvas: HTMLCanvasElement): GlContext | null {
  const gl = (canvas.getContext("webgl2") ??
    canvas.getContext("webgl")) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  if (!gl) return null

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (!vs || !fs) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[EdgeGlow] program link failed:", gl.getProgramInfoLog(program))
    }
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )

  const posLoc = gl.getAttribLocation(program, "a_position")
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.useProgram(program)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  return {
    gl,
    program,
    buffer,
    uniforms: {
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_time: gl.getUniformLocation(program, "u_time"),
      u_intensity: gl.getUniformLocation(program, "u_intensity"),
      u_thickness_px: gl.getUniformLocation(program, "u_thickness_px"),
      u_noise_speed: gl.getUniformLocation(program, "u_noise_speed"),
      u_color_phase: gl.getUniformLocation(program, "u_color_phase"),
      u_flash: gl.getUniformLocation(program, "u_flash"),
      u_corner_px: gl.getUniformLocation(program, "u_corner_px"),
      u_amplitude: gl.getUniformLocation(program, "u_amplitude"),
    },
  }
}

function destroyGl(ctx: GlContext) {
  ctx.gl.deleteBuffer(ctx.buffer)
  ctx.gl.deleteProgram(ctx.program)
}

export function EdgeGlow() {
  const { open, busy, inspectorActive, typingSignal } = useCopilotStore()
  const [reducedMotion, setReducedMotion] = useState<boolean>(false)
  const [webglFailed, setWebglFailed] = useState<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCtxRef = useRef<GlContext | null>(null)

  // Signal refs: mutated by store-subscribing effects, read from RAF loop.
  // Keeps the heavy init effect out of the dependency-churn cycle.
  const busyRef = useRef(busy)
  const inspectorRef = useRef(inspectorActive)
  const lastTypingMsRef = useRef<number>(-Infinity)
  const flashStartRef = useRef<number | null>(null)
  const prevBusyRef = useRef(busy)

  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { inspectorRef.current = inspectorActive }, [inspectorActive])

  // typingSignal bump → record timestamp; RAF checks 400ms window.
  // Gate on > 0 so the initial render (typingSignal=0) doesn't register as typing.
  useEffect(() => {
    if (typingSignal > 0) lastTypingMsRef.current = performance.now()
  }, [typingSignal])

  // Detect busy falling edge → start flash window.
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      flashStartRef.current = performance.now()
    }
    prevBusyRef.current = busy
  }, [busy])

  // Reactive prefers-reduced-motion tracking.
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // GL lifecycle: init on mount (gated), tear down on gate change / unmount.
  useEffect(() => {
    if (!open || reducedMotion || webglFailed) return
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio ?? 1)
      const ctx = glCtxRef.current
      if (ctx) {
        const maxTex = ctx.gl.getParameter(ctx.gl.MAX_TEXTURE_SIZE) as number
        const longest = Math.max(rect.width, rect.height)
        const safeDpr = longest * dpr > maxTex ? Math.max(1, maxTex / longest) : dpr
        canvas.width = Math.max(1, Math.floor(rect.width * safeDpr))
        canvas.height = Math.max(1, Math.floor(rect.height * safeDpr))
      } else {
        canvas.width = Math.max(1, Math.floor(rect.width * dpr))
        canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      }
    }
    resizeCanvas()

    const ctx = initGl(canvas)
    if (!ctx) {
      setWebglFailed(true)
      return
    }
    glCtxRef.current = ctx

    // Spring-integrated uniform state.
    const anim = {
      intensity: { value: 0.40, velocity: 0 },
      thicknessPx: { value: 30, velocity: 0 },
      noiseSpeed: { value: 0.15, velocity: 0 },
      amplitude: { value: 4, velocity: 0 },
      colorPhase: { value: 0.5, velocity: 0 },
    }

    let rafId = 0
    let lastFrameMs = performance.now()

    const renderFrame = () => {
      const nowMs = performance.now()
      // Clamp dt to 1/30s so tab-switch stalls don't spring-overshoot.
      const dtSec = Math.min((nowMs - lastFrameMs) / 1000, 1 / 30)
      lastFrameMs = nowMs

      // Clear flash marker once window closes so a subsequent busy-drop can re-trigger.
      if (
        flashStartRef.current !== null &&
        nowMs - flashStartRef.current >= FLASH_DURATION_MS
      ) {
        flashStartRef.current = null
      }

      const signals = {
        typing: nowMs - lastTypingMsRef.current < 400,
        inspecting: inspectorRef.current,
        busy: busyRef.current,
        flashActive: flashStartRef.current !== null,
        nowMs,
      }
      const target: GlowTargets = computeTarget(signals)
      const flash = computeFlash(flashStartRef.current, nowMs)

      ;[anim.intensity.value, anim.intensity.velocity] = springStep(
        anim.intensity.value, anim.intensity.velocity, target.intensity, dtSec,
      )
      ;[anim.thicknessPx.value, anim.thicknessPx.velocity] = springStep(
        anim.thicknessPx.value, anim.thicknessPx.velocity, target.thicknessPx, dtSec,
      )
      ;[anim.noiseSpeed.value, anim.noiseSpeed.velocity] = springStep(
        anim.noiseSpeed.value, anim.noiseSpeed.velocity, target.noiseSpeed, dtSec,
      )
      ;[anim.amplitude.value, anim.amplitude.velocity] = springStep(
        anim.amplitude.value, anim.amplitude.velocity, target.amplitude, dtSec,
      )
      ;[anim.colorPhase.value, anim.colorPhase.velocity] = springStep(
        anim.colorPhase.value, anim.colorPhase.velocity, target.colorPhase, dtSec,
      )

      const { gl, uniforms } = ctx
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
      gl.uniform1f(uniforms.u_time, nowMs / 1000)
      gl.uniform1f(uniforms.u_intensity, anim.intensity.value)
      gl.uniform1f(uniforms.u_thickness_px, anim.thicknessPx.value)
      gl.uniform1f(uniforms.u_noise_speed, anim.noiseSpeed.value)
      gl.uniform1f(uniforms.u_color_phase, anim.colorPhase.value)
      gl.uniform1f(uniforms.u_flash, flash)
      gl.uniform1f(uniforms.u_corner_px, 0)
      gl.uniform1f(uniforms.u_amplitude, anim.amplitude.value)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      rafId = requestAnimationFrame(renderFrame)
    }
    rafId = requestAnimationFrame(renderFrame)

    // Resize redraws happen naturally on next RAF tick; only need to resize canvas.
    const resizeObs = new ResizeObserver(() => { resizeCanvas() })
    const parent = canvas.parentElement
    if (parent) resizeObs.observe(parent)

    const onLost = (e: Event) => {
      e.preventDefault()
      setWebglFailed(true)
    }
    canvas.addEventListener("webglcontextlost", onLost)

    return () => {
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      canvas.removeEventListener("webglcontextlost", onLost)
      if (glCtxRef.current) {
        destroyGl(glCtxRef.current)
        glCtxRef.current = null
      }
    }
  }, [open, reducedMotion, webglFailed])

  if (!open) return null
  if (reducedMotion) return null
  if (webglFailed) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 999 }}
    />
  )
}
