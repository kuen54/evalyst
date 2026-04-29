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
