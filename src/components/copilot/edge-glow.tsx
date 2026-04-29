"use client"

import { useEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"
import { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE } from "./edge-glow-shader"

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

  // Fullscreen quad: 2 triangles in clip space.
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

  // Premultiplied alpha blend (shader outputs vec4(col*alpha, alpha)).
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
    },
  }
}

function destroyGl(ctx: GlContext) {
  ctx.gl.deleteBuffer(ctx.buffer)
  ctx.gl.deleteProgram(ctx.program)
}

export function EdgeGlow() {
  const { open } = useCopilotStore()
  const [reducedMotion, setReducedMotion] = useState<boolean>(false)
  const [webglFailed, setWebglFailed] = useState<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCtxRef = useRef<GlContext | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // One-shot GL init + static draw (placeholder until Task 8 adds RAF).
  useEffect(() => {
    if (!open || reducedMotion || webglFailed) return
    const canvas = canvasRef.current
    if (!canvas) return

    // Size canvas to its displayed box with DPR cap 2 (ResizeObserver in Task 7).
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio ?? 1)
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))

    const ctx = initGl(canvas)
    if (!ctx) {
      setWebglFailed(true)
      return
    }
    glCtxRef.current = ctx

    // One static draw with "processing" uniforms to verify pipeline.
    const { gl, uniforms } = ctx
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
    gl.uniform1f(uniforms.u_time, 0)
    gl.uniform1f(uniforms.u_intensity, 0.9)
    gl.uniform1f(uniforms.u_thickness_px, 11)
    gl.uniform1f(uniforms.u_noise_speed, 1.4)
    gl.uniform1f(uniforms.u_color_phase, 0.3)
    gl.uniform1f(uniforms.u_flash, 0)
    gl.uniform1f(uniforms.u_corner_px, 16)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Handle context loss: hide on loss, no restore attempt.
    const onLost = (e: Event) => {
      e.preventDefault()
      setWebglFailed(true)
    }
    canvas.addEventListener("webglcontextlost", onLost)

    return () => {
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
      style={{ zIndex: 0 }}
    />
  )
}
