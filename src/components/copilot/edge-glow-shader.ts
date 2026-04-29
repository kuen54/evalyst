/**
 * GLSL source for the edge-glow fragment shader.
 *
 * V2 (2026-04-29): neon chroma palette (indigo/cyan/magenta/amber) + noise-
 * driven SDF displacement so band edges wobble inward like flames licking the
 * content area (instead of v1's alpha-only pastel shimmer).
 *
 * Fragment responsibility:
 *   1. Compute SDF to a square rect inset by u_thickness_px from canvas edge.
 *   2. Perturb SDF by multi-scale simplex noise * u_amplitude (inward wave).
 *   3. smoothstep band profile from perturbed SDF — crisp outer, soft inner.
 *   4. 4-color neon palette mixed by u_color_phase + small noise phase jitter.
 *   5. u_flash white-mixin for the burst pop.
 *   6. Premultiplied-alpha output; transparent pixels let background
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
uniform float u_amplitude;

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

// ----- Neon chroma palette -----
// 4 stops, equal-phase segments: indigo -> cyan -> magenta -> amber -> indigo.
vec3 palette(float phase) {
  vec3 indigo  = vec3(0.29, 0.00, 0.88);
  vec3 cyan    = vec3(0.00, 1.00, 1.00);
  vec3 magenta = vec3(1.00, 0.00, 0.498);
  vec3 amber   = vec3(1.00, 0.478, 0.00);
  float p = mod(phase, 1.0);
  if (p < 0.25) return mix(indigo,  cyan,    p * 4.0);
  if (p < 0.5)  return mix(cyan,    magenta, (p - 0.25) * 4.0);
  if (p < 0.75) return mix(magenta, amber,   (p - 0.5) * 4.0);
                return mix(amber,   indigo,  (p - 0.75) * 4.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy;
  vec2 center = u_resolution * 0.5;
  // V2.1: NO inset — SDF zero-line aligns to canvas physical edge.
  vec2 half_ = u_resolution * 0.5;
  float sdf = sdRoundedBox(uv - center, half_, u_corner_px);
  // sdf = 0 exactly on canvas edge; negative inward; outside = clipped.

  // Multi-scale noise for organic turbulence.
  float n_lo = snoise(uv * 0.0025 + vec2(u_time * u_noise_speed * 0.4, 0.0));
  float n_hi = snoise(uv * 0.008  + vec2(0.0, u_time * u_noise_speed * 0.6));
  float n = n_lo * 0.7 + n_hi * 0.3; // [-1, 1]

  // Inner cutoff wobbles inward — flames licking toward center.
  // At edge (sdf=0), band = 1 ALWAYS (glow anchored to physical edge).
  float inner_cutoff = -u_thickness_px + n * u_amplitude;
  float band = smoothstep(inner_cutoff, 0.0, sdf);

  // Palette with small noise-driven phase jitter.
  vec3 col = palette(u_color_phase + n * 0.15);
  col = mix(col, vec3(1.0), u_flash); // flash: white pop

  // Alpha: band * intensity only (V1 multiplied by noise → edge flicker).
  float alpha = band * u_intensity;
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied alpha
}
`
