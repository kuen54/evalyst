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
