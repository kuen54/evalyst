# Copilot Edge Glow (WebGL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Copilot edge-glow WebGL effect specified in `docs/superpowers/specs/2026-04-29-copilot-edge-glow-webgl-design.md` — a shader-driven inner-edge glow band around `<main>` content that reacts to copilot interaction state.

**Architecture:** Three pure function modules (state machine / spring / flash decay) unit-tested in isolation, plus one React client component that owns the `<canvas>`, WebGL context, RAF loop, and bridges store signals to shader uniforms. Raw WebGL — no new deps. Mounts in `layout.tsx` inside the existing `<main>` (same layer as `<GlowOverlay/>`).

**Tech Stack:** TypeScript · React 19 Client Component · WebGL 2 (falls back to WebGL 1) · GLSL (Ashima Simplex noise + Inigo Quilez SDF rounded-box) · vitest for pure-function tests · existing `useCopilotStore` hook (`src/components/copilot/store.tsx`) for state signals.

---

## Reference

- **Spec**: `docs/superpowers/specs/2026-04-29-copilot-edge-glow-webgl-design.md`
- **Store signals used** (all already exist in `src/components/copilot/store.tsx`):
  - `open: boolean` — activation gate
  - `inspectorActive: boolean` — INSPECTING state
  - `busy: boolean` — PROCESSING state
  - `typingSignal: number` — TYPING state (debounced counter bumped by chat textarea)
- **Layer**: canvas mounts inside `<main>` in `src/app/layout.tsx:49-52` as a sibling to the existing `<GlowOverlay/>`.

---

## File structure

Created:
- `src/components/copilot/edge-glow-state.ts` — pure: types, target functions, `computeTarget`, `springStep`, `computeFlash`
- `src/components/copilot/edge-glow-shader.ts` — pure: vertex + fragment GLSL source strings
- `src/components/copilot/edge-glow.tsx` — client component: canvas, GL lifecycle, RAF loop
- `src/components/copilot/__tests__/edge-glow-state.test.ts` — vitest unit tests

Modified:
- `src/app/layout.tsx` — import + mount `<EdgeGlow/>` inside `<main>` (one added element)

Not touched: `src/app/globals.css`, `src/components/copilot/glow-overlay.tsx`, any other file.

---

## Task 1: State module — types + computeTarget + priority

**Files:**
- Create: `src/components/copilot/edge-glow-state.ts`
- Create: `src/components/copilot/__tests__/edge-glow-state.test.ts`

- [ ] **Step 1: Write failing tests for computeTarget priority and outputs**

Create `src/components/copilot/__tests__/edge-glow-state.test.ts` with this content:

```ts
import { describe, it, expect } from "vitest"
import { computeTarget, type GlowSignals } from "../edge-glow-state"

function baseSignals(overrides: Partial<GlowSignals> = {}): GlowSignals {
  return {
    typing: false,
    inspecting: false,
    busy: false,
    flashActive: false,
    nowMs: 0,
    ...overrides,
  }
}

describe("computeTarget", () => {
  it("IDLE: low intensity, thin band", () => {
    const t = computeTarget(baseSignals())
    expect(t.intensity).toBe(0.22)
    expect(t.thicknessPx).toBe(3)
    expect(t.noiseSpeed).toBe(0.15)
  })

  it("TYPING overrides IDLE", () => {
    const t = computeTarget(baseSignals({ typing: true }))
    expect(t.intensity).toBe(0.35)
    expect(t.thicknessPx).toBe(5)
  })

  it("INSPECTING overrides TYPING", () => {
    const t = computeTarget(baseSignals({ typing: true, inspecting: true }))
    expect(t.intensity).toBe(0.50)
    expect(t.thicknessPx).toBe(7)
    expect(t.colorPhase).toBe(0.30)
  })

  it("PROCESSING (busy) overrides INSPECTING", () => {
    const t = computeTarget(baseSignals({ busy: true, inspecting: true }))
    expect(t.intensity).toBe(0.90)
    expect(t.thicknessPx).toBe(11)
    expect(t.noiseSpeed).toBe(1.40)
  })

  it("FLASH overrides everything (keeps PROCESSING-level targets)", () => {
    const t = computeTarget(baseSignals({ flashActive: true }))
    expect(t.intensity).toBe(0.90)
    expect(t.thicknessPx).toBe(11)
  })

  it("IDLE colorPhase oscillates with nowMs", () => {
    const a = computeTarget(baseSignals({ nowMs: 0 }))
    const b = computeTarget(baseSignals({ nowMs: 3000 }))
    expect(a.colorPhase).not.toBe(b.colorPhase)
    // bounded 0.2..0.8 (0.5 ± 0.3)
    expect(a.colorPhase).toBeGreaterThanOrEqual(0.2)
    expect(a.colorPhase).toBeLessThanOrEqual(0.8)
    expect(b.colorPhase).toBeGreaterThanOrEqual(0.2)
    expect(b.colorPhase).toBeLessThanOrEqual(0.8)
  })

  it("PROCESSING colorPhase wraps 0..1 via mod", () => {
    for (const nowMs of [0, 500, 1500, 5000, 10000]) {
      const t = computeTarget(baseSignals({ busy: true, nowMs }))
      expect(t.colorPhase).toBeGreaterThanOrEqual(0)
      expect(t.colorPhase).toBeLessThan(1)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- edge-glow-state`
Expected: FAIL with `Cannot find module '../edge-glow-state'`

- [ ] **Step 3: Create `edge-glow-state.ts` with types + computeTarget**

Create `src/components/copilot/edge-glow-state.ts` with this content:

```ts
/**
 * Edge-glow state machine (pure functions).
 *
 * `computeTarget` maps the current signal snapshot to the target uniform values
 * the WebGL fragment shader should render at. The actual rendered values are
 * reached via `springStep` per-frame in the render loop (see below in this file
 * for springStep and computeFlash).
 *
 * Priority order (highest to lowest): FLASH > PROCESSING > INSPECTING > TYPING > IDLE.
 *
 * `nowMs` is required even for priority determination because IDLE / TYPING /
 * PROCESSING have a time-varying colorPhase target. Callers pass performance.now().
 */

export interface GlowSignals {
  /** User typing in copilot textarea within last ~400ms */
  typing: boolean
  /** Copilot inspector mode active (element-picker on) */
  inspecting: boolean
  /** LLM stream in progress (covers chat + tool round-trips) */
  busy: boolean
  /** Inside the 800ms flash window after busy fell from true to false */
  flashActive: boolean
  /** performance.now() for time-driven colorPhase drift */
  nowMs: number
}

export interface GlowTargets {
  /** 0..1 multiplier on band alpha */
  intensity: number
  /** Inset distance from canvas edge in pixels */
  thicknessPx: number
  /** Noise time scrolling speed */
  noiseSpeed: number
  /** Palette mix phase, 0..1 — see shader for mapping */
  colorPhase: number
}

// State-specific target builders.
function idleTargets(nowMs: number): GlowTargets {
  return {
    intensity: 0.22,
    thicknessPx: 3,
    noiseSpeed: 0.15,
    colorPhase: 0.5 + 0.3 * Math.sin((nowMs / 1000) * 0.25),
  }
}

function typingTargets(nowMs: number): GlowTargets {
  return {
    intensity: 0.35,
    thicknessPx: 5,
    noiseSpeed: 0.30,
    colorPhase: 0.5 + 0.3 * Math.sin((nowMs / 1000) * 0.25 * 1.8),
  }
}

const INSPECTING_TARGETS: GlowTargets = {
  intensity: 0.50,
  thicknessPx: 7,
  noiseSpeed: 0.45,
  colorPhase: 0.30, // sky-blue-ish zone
}

function processingTargets(nowMs: number): GlowTargets {
  return {
    intensity: 0.90,
    thicknessPx: 11,
    noiseSpeed: 1.40,
    colorPhase: ((nowMs / 1000) * 0.8) % 1.0,
  }
}

export function computeTarget(signals: GlowSignals): GlowTargets {
  // FLASH keeps targets at PROCESSING-level; visible "pop" comes from the
  // separate u_flash uniform computed by computeFlash, not from the target.
  if (signals.flashActive) return processingTargets(signals.nowMs)
  if (signals.busy) return processingTargets(signals.nowMs)
  if (signals.inspecting) return INSPECTING_TARGETS
  if (signals.typing) return typingTargets(signals.nowMs)
  return idleTargets(signals.nowMs)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- edge-glow-state`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/edge-glow-state.ts src/components/copilot/__tests__/edge-glow-state.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow state machine — computeTarget + types

Pure function: maps (typing/inspecting/busy/flashActive/nowMs) signals
to (intensity/thicknessPx/noiseSpeed/colorPhase) uniform targets.
Priority FLASH > PROCESSING > INSPECTING > TYPING > IDLE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: springStep pure function

**Files:**
- Modify: `src/components/copilot/edge-glow-state.ts` (append)
- Modify: `src/components/copilot/__tests__/edge-glow-state.test.ts` (append describe block)

- [ ] **Step 1: Append failing tests for springStep**

Append to `src/components/copilot/__tests__/edge-glow-state.test.ts`:

```ts
import { springStep } from "../edge-glow-state"

describe("springStep", () => {
  it("converges from 0 toward 1 within 50 frames at 60fps", () => {
    let value = 0
    let velocity = 0
    const dt = 1 / 60
    for (let i = 0; i < 50; i++) {
      ;[value, velocity] = springStep(value, velocity, 1, dt)
    }
    expect(value).toBeGreaterThan(0.99)
    expect(value).toBeLessThan(1.01)
  })

  it("does not overshoot (critically damped)", () => {
    let value = 0
    let velocity = 0
    let maxValue = 0
    for (let i = 0; i < 120; i++) {
      ;[value, velocity] = springStep(value, velocity, 1, 1 / 60)
      if (value > maxValue) maxValue = value
    }
    // critically damped: max should not exceed target by more than 0.5%
    expect(maxValue).toBeLessThan(1.005)
  })

  it("holds at target (no drift when value === target and velocity=0)", () => {
    const [v1, vel1] = springStep(1, 0, 1, 1 / 60)
    expect(v1).toBeCloseTo(1, 6)
    expect(vel1).toBeCloseTo(0, 6)
  })

  it("handles downward transition (target 0 from value 1)", () => {
    let value = 1
    let velocity = 0
    for (let i = 0; i < 60; i++) {
      ;[value, velocity] = springStep(value, velocity, 0, 1 / 60)
    }
    expect(value).toBeLessThan(0.05)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- edge-glow-state`
Expected: FAIL with `springStep is not exported from ../edge-glow-state`

- [ ] **Step 3: Append springStep to edge-glow-state.ts**

Append to `src/components/copilot/edge-glow-state.ts`:

```ts
/**
 * Critically-damped spring integrator.
 *
 * Returns [newValue, newVelocity] after stepping forward by `dt` seconds.
 * Tuned for ~300ms to target with no overshoot at dt=1/60.
 */
const SPRING_STIFFNESS = 180
const SPRING_DAMPING = 22

export function springStep(
  value: number,
  velocity: number,
  target: number,
  dt: number,
): [number, number] {
  const acceleration = SPRING_STIFFNESS * (target - value) - SPRING_DAMPING * velocity
  const newVelocity = velocity + acceleration * dt
  const newValue = value + newVelocity * dt
  return [newValue, newVelocity]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- edge-glow-state`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/edge-glow-state.ts src/components/copilot/__tests__/edge-glow-state.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow springStep integrator

Critically damped spring (stiffness 180, damping 22). Converges to
target in ~50 frames at 60fps with no overshoot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: computeFlash pure function

**Files:**
- Modify: `src/components/copilot/edge-glow-state.ts` (append)
- Modify: `src/components/copilot/__tests__/edge-glow-state.test.ts` (append describe block)

- [ ] **Step 1: Append failing tests for computeFlash**

Append to `src/components/copilot/__tests__/edge-glow-state.test.ts`:

```ts
import { computeFlash, FLASH_DURATION_MS } from "../edge-glow-state"

describe("computeFlash", () => {
  it("returns 0 when flashStartMs is null", () => {
    expect(computeFlash(null, 1000)).toBe(0)
  })

  it("returns 1 at t=0", () => {
    expect(computeFlash(500, 500)).toBeCloseTo(1, 4)
  })

  it("decays exponentially at t=400ms", () => {
    // exp(-5 * 0.4) = exp(-2) ~ 0.1353
    expect(computeFlash(0, 400)).toBeCloseTo(Math.exp(-2), 3)
  })

  it("returns 0 after 800ms window closes", () => {
    expect(computeFlash(0, FLASH_DURATION_MS + 1)).toBe(0)
    expect(computeFlash(0, 2000)).toBe(0)
  })

  it("exports FLASH_DURATION_MS as 800", () => {
    expect(FLASH_DURATION_MS).toBe(800)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- edge-glow-state`
Expected: FAIL with `computeFlash is not exported`

- [ ] **Step 3: Append computeFlash to edge-glow-state.ts**

Append to `src/components/copilot/edge-glow-state.ts`:

```ts
/**
 * Flash envelope — exponential decay over 800ms window.
 * Returns 0..1 value driving the `u_flash` uniform (white mix-in factor).
 *
 * Component sets flashStartMs when busy falls from true to false, clears
 * (sets to null) after the window closes OR sets a new value on the next
 * falling edge. The 800ms boundary is the hard cutoff.
 */
export const FLASH_DURATION_MS = 800

export function computeFlash(flashStartMs: number | null, nowMs: number): number {
  if (flashStartMs === null) return 0
  const dt = nowMs - flashStartMs
  if (dt < 0) return 0
  if (dt >= FLASH_DURATION_MS) return 0
  return Math.exp(-5 * (dt / 1000))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- edge-glow-state`
Expected: PASS (16 tests total in file)

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/edge-glow-state.ts src/components/copilot/__tests__/edge-glow-state.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow computeFlash exp decay

u_flash uniform envelope: 1 → 0 over 800ms via exp(-5t). Triggered by
busy falling edge in the component layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Shader source module

**Files:**
- Create: `src/components/copilot/edge-glow-shader.ts`

Note: Shader source is just exported string constants. No test — the shader correctness is verified visually in later tasks.

- [ ] **Step 1: Create `edge-glow-shader.ts` with vertex + fragment source**

Create `src/components/copilot/edge-glow-shader.ts` with this content:

```ts
/**
 * GLSL source for the edge-glow fragment shader.
 *
 * Fragment responsibility:
 *   1. Compute SDF to a rounded rect inset by u_thickness_px from canvas edge.
 *   2. Create a 1-pixel-wide smoothstep "band" centered on the SDF zero.
 *   3. Modulate the band with Ashima simplex 2D noise scrolling by u_time.
 *   4. Mix violet / cyan / pink palette by u_color_phase + noise offset.
 *   5. White-mix-in by u_flash for the burst pop.
 *   6. Output premultiplied-alpha color; transparent pixels let background
 *      .copilot-glow show through, colored edge pixels stack above.
 *
 * Targets WebGL 1.0 `#version 100` syntax for maximum compatibility; the
 * component will prefer WebGL 2 context but fall back to WebGL 1 without
 * changing the source.
 */

export const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_thickness_px;
uniform float u_noise_speed;
uniform float u_color_phase;
uniform float u_flash;
uniform float u_corner_px;

// ----- Inigo Quilez rounded box SDF -----
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// ----- Ashima simplex 2D noise -----
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                 + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                          dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = gl_FragCoord.xy;
  vec2 center = u_resolution * 0.5;
  vec2 half_ = u_resolution * 0.5 - u_thickness_px;
  float sdf = sdRoundedBox(uv - center, half_, u_corner_px);

  // Band: only pixels within thickness range of the edge get alpha.
  float band_outer = smoothstep(u_thickness_px * 2.0, 0.0, sdf);
  float band_inner = smoothstep(-u_thickness_px * 3.0, 0.0, sdf);
  float band = band_outer * band_inner;

  // Noise modulation for organic fluid motion.
  float n = snoise(uv * 0.003 + vec2(u_time * u_noise_speed * 0.5, 0.0));
  n = 0.5 + 0.5 * n;

  // Palette: violet / cyan / pink.
  vec3 violet = vec3(0.62, 0.42, 0.95);
  vec3 cyan   = vec3(0.45, 0.85, 0.98);
  vec3 pink   = vec3(0.97, 0.65, 0.88);
  float phase = mod(u_color_phase + n * 0.3, 1.0);
  vec3 col = mix(violet, cyan, smoothstep(0.0, 0.5, phase));
  col = mix(col, pink, smoothstep(0.5, 1.0, phase));
  col = mix(col, vec3(1.0), u_flash);

  float alpha = band * n * u_intensity;
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied alpha
}
`
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors related to edge-glow files.

- [ ] **Step 3: Commit**

```bash
git add src/components/copilot/edge-glow-shader.ts
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow GLSL shader source

Vertex (fullscreen quad passthrough) + fragment (SDF rounded box +
Ashima simplex noise + violet/cyan/pink palette + flash white-mix).
Premultiplied alpha output.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: EdgeGlow component — activation gates (returns null paths)

**Files:**
- Create: `src/components/copilot/edge-glow.tsx`

This task establishes the component shell with all early-return paths working. No WebGL code yet — next task wires that in.

- [ ] **Step 1: Create `edge-glow.tsx` with activation gates**

Create `src/components/copilot/edge-glow.tsx` with this content:

```tsx
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
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: succeeds (component is unused but exports cleanly; React doesn't flag it).

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/edge-glow.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow component shell with activation gates

Renders nothing unless panel open + motion allowed + WebGL works.
GL init wires up in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: WebGL init + static first draw

**Files:**
- Modify: `src/components/copilot/edge-glow.tsx`
- Modify: `src/app/layout.tsx`

This task wires up the WebGL context, compiles the shader, and renders a single static frame. We temporarily mount the component in layout.tsx so we can visually verify the band appears. The RAF loop and state integration come in later tasks — for now uniforms are hard-coded.

- [ ] **Step 1: Rewrite `edge-glow.tsx` with GL init and static draw**

Replace the contents of `src/components/copilot/edge-glow.tsx` with:

```tsx
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
```

- [ ] **Step 2: Temporarily mount `<EdgeGlow/>` in layout.tsx for visual verification**

Edit `src/app/layout.tsx`:

Add import after line 13 (`import { GlowOverlay } ...`):

```tsx
import { EdgeGlow } from "@/components/copilot/edge-glow"
```

Change the `<main>` block (currently lines 49-52):

```tsx
<main className="flex-1 h-screen flex flex-col overflow-hidden relative">
  <GlowOverlay />
  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
</main>
```

to:

```tsx
<main className="flex-1 h-screen flex flex-col overflow-hidden relative">
  <GlowOverlay />
  <EdgeGlow />
  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
</main>
```

- [ ] **Step 3: Run tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 4: Manual visual verification**

Start dev server (`npm run dev`) and open http://localhost:3000. Open copilot panel with ⌘K.
Expected: a static colored band appears along the inner edge of the main content area (violet/cyan tones, no animation yet). Band is 11px wide at 90% intensity. The `.copilot-glow` background is unchanged underneath. Close panel → canvas unmounts, band disappears.

If no band appears: check browser devtools console for shader errors. Check `<main>` has `position: relative` and `<EdgeGlow/>` canvas has non-zero width/height.

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/edge-glow.tsx src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow WebGL init + static first draw

Context creation, shader compile/link, fullscreen-quad buffer, static
draw with fixed processing-state uniforms. Mounted inside <main>
sibling to <GlowOverlay>. RAF + state integration in following commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ResizeObserver + DPR-aware resize

**Files:**
- Modify: `src/components/copilot/edge-glow.tsx`

- [ ] **Step 1: Add ResizeObserver handling to edge-glow.tsx**

In `src/components/copilot/edge-glow.tsx`, replace the single-shot sizing block

```tsx
    // Size canvas to its displayed box with DPR cap 2 (ResizeObserver in Task 7).
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio ?? 1)
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
```

with a reusable `resizeCanvas` function + ResizeObserver that redraws on size change. Update the effect body:

```tsx
    // Size canvas to its displayed box; ResizeObserver re-fires on parent changes.
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio ?? 1)
      // Clamp DPR so canvas.width <= MAX_TEXTURE_SIZE in the rare edge case of
      // extremely tall/wide viewports (guards against Safari bailing out).
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

    // Draw one static frame now so user sees the band before RAF is wired.
    const drawStatic = () => {
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
    }
    drawStatic()

    // Observe size changes on the canvas's parent (the <main> element).
    const resizeObs = new ResizeObserver(() => {
      resizeCanvas()
      drawStatic()
    })
    const parent = canvas.parentElement
    if (parent) resizeObs.observe(parent)

    // Handle context loss: hide on loss, no restore attempt.
    const onLost = (e: Event) => {
      e.preventDefault()
      setWebglFailed(true)
    }
    canvas.addEventListener("webglcontextlost", onLost)

    return () => {
      resizeObs.disconnect()
      canvas.removeEventListener("webglcontextlost", onLost)
      if (glCtxRef.current) {
        destroyGl(glCtxRef.current)
        glCtxRef.current = null
      }
    }
```

The full useEffect dependency array stays `[open, reducedMotion, webglFailed]`.

- [ ] **Step 2: Run tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 3: Manual visual verification**

Open http://localhost:3000 with copilot panel open. Resize the browser window — the band should re-render at the new dimensions without distortion or black gaps. Open / close sidebar (if toggleable) — band reflows to new `<main>` width. Zoom in / out (⌘+ / ⌘−) — band stays sharp.

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/edge-glow.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow ResizeObserver + DPR clamp

Canvas resizes with <main>; DPR capped at 2 with further safety clamp
against MAX_TEXTURE_SIZE. Redraws on every observed size change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: RAF loop + state integration + FLASH trigger

**Files:**
- Modify: `src/components/copilot/edge-glow.tsx`

Because changes span imports, component-top hooks, and the useEffect body, this task replaces the **entire** file contents rather than describing patches. Copy-paste the full file below.

- [ ] **Step 1: Replace contents of `src/components/copilot/edge-glow.tsx`**

Overwrite `src/components/copilot/edge-glow.tsx` with this full file:

```tsx
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
  useEffect(() => { lastTypingMsRef.current = performance.now() }, [typingSignal])

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
      intensity: { value: 0.22, velocity: 0 },
      thicknessPx: { value: 3, velocity: 0 },
      noiseSpeed: { value: 0.15, velocity: 0 },
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
      gl.uniform1f(uniforms.u_corner_px, 16)
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
      style={{ zIndex: 0 }}
    />
  )
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run vitest**

Run: `npm test`
Expected: all tests pass (edge-glow-state tests still green; no tests added this task).

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual visual verification — all 5 states**

Open http://localhost:3000, ⌘K to open copilot panel.

| Behavior | Expected visual |
|---|---|
| Panel open, no activity | IDLE: thin (~3px) low-intensity band, slow violet↔cyan drift |
| Type in copilot textarea | TYPING: band brightens slightly and palette motion speeds up, reverts ~400ms after last keystroke |
| Click Inspector button | INSPECTING: band jumps to sky-blue-ish and gets noticeably thicker (~7px); stays until inspector off |
| Send a message | PROCESSING: band bursts to thick (~11px), high intensity, palette rotates violet→cyan→pink fast |
| Message completes | FLASH: brief white bloom (~800ms) then spring-decay back to IDLE |

Verify `prefers-reduced-motion: reduce` via DevTools → Rendering panel → Emulate CSS media feature → canvas disappears.

- [ ] **Step 6: Commit**

```bash
git add src/components/copilot/edge-glow.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): edge-glow RAF loop + signal integration

Per-frame: computeTarget + springStep for 4 animated uniforms,
computeFlash for u_flash. Store signals routed via refs (no RAF
churn on typingSignal bumps). Busy falling edge triggers 800ms flash.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final integration verify

**Files:**
- Read-only: `src/app/layout.tsx` (already mounted in Task 6)

Full test suite + build + manual smoke confirms no regressions in PR-4 features (page_context / read_page / route change banner).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all existing tests green; edge-glow-state tests (16 cases) green. Total ≥ 220 tests passing (204 before + 16 new).

- [ ] **Step 2: E2E smoke**

Run: `npm run test:e2e`
Expected: 9 cases green (unchanged — no new e2e added per spec §11.2).

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: clean, 27 static pages (unchanged from before).

- [ ] **Step 5: Manual regression smoke for PR-4 features**

With dev server + copilot panel open:

1. Navigate between pages (dashboard → experiments/[id] → settings/templates)
   - Edge glow stays visible across routes
   - Route change banner appears when there's a conversation, manual contexts cleared
   - Page context block "# 当前页面" appears in copilot preview
2. Trigger `read_page` tool via asking copilot something about current page — tool runs
3. Use Inspector mode to圈选元素 — context added, INSPECTING state visible in glow
4. Reduced-motion check: DevTools → Emulate → prefers-reduced-motion: reduce → canvas gone; `.copilot-glow` background still there

- [ ] **Step 6: No commit needed**

This task is verification only. Task 6's commit already mounted the component.

---

## Self-Review Checklist

Before handing off, confirm the plan covers every spec requirement.

**Spec §2 Goals:**
- G1 (organic fluid glow at inner edge) — Task 4 shader + Task 8 state integration ✓
- G2 (state-driven) — Tasks 1+8 ✓
- G3 (no regressions on .copilot-glow / PR-4 backend) — Task 9 step 5 ✓
- G4 (0 new deps) — verified: only added files and layout edit ✓
- G5 (release GL on panel close) — Task 6 cleanup callback ✓

**Spec §5 State machine:**
- All 5 states IDLE/TYPING/INSPECTING/PROCESSING/FLASH — Tasks 1, 3 ✓
- Priority ordering — Task 1 Step 1 test ✓
- Spring dynamics — Task 2 ✓
- Flash exp decay — Task 3 ✓

**Spec §6 Shader:**
- Vertex + fragment GLSL — Task 4 ✓
- SDF rounded box — included ✓
- Ashima simplex — included ✓
- Palette + flash mix — included ✓
- highp/mediump fallback — included ✓

**Spec §8 Lifecycle:**
- WebGL2 preferred, WebGL1 fallback — Task 6 initGl ✓
- ResizeObserver — Task 7 ✓
- Context loss handling — Task 6 onLost ✓
- Cleanup — Task 6+8 cleanup ✓

**Spec §10 Failure modes:**
- getContext null → return null — Task 5+6 ✓
- Shader compile fail → return null — Task 6 initGl ✓
- webglcontextlost → hide — Task 6 ✓
- prefers-reduced-motion → return null — Task 5 ✓
- DPR × size > MAX_TEXTURE_SIZE — Task 7 ✓

**Spec §11 Testing:**
- Unit tests for state module — Tasks 1-3 ✓
- Manual verification clear steps — Task 8 Step 5, Task 9 Step 5 ✓

Placeholder scan — no TBD/TODO/"similar to"/"handle edge cases" blocks.

Type consistency — `GlowTargets`, `GlowSignals`, `computeTarget`, `springStep`, `computeFlash`, `FLASH_DURATION_MS`, `GlContext`, `initGl`, `destroyGl`, `VERTEX_SHADER_SOURCE`, `FRAGMENT_SHADER_SOURCE`, `EdgeGlow` — all consistent across tasks.

---

## Rollout notes

- This plan is implementable on either `feat/copilot-page-context-ambient-border` (current branch) or a fresh `feat/copilot-edge-glow-webgl` branch. Spec §14 recommends the fresh branch but the PR for the current branch can also carry it since P2 was DEFERRED with no other changes outstanding.
- PR description should include before/after screen recordings for the 5 states.
