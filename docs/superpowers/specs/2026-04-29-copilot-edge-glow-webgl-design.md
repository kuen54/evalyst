# Copilot Edge Glow (WebGL) · Design Spec

**Date**: 2026-04-29
**Status**: Draft, awaiting user approval before plan
**Supersedes**: `2026-04-28-copilot-page-context-ambient-border-design.md` §5.3 (P2 DEFERRED)

## 1. Background

前一次尝试（PR-4 P2）用 3 轮 CSS/SVG 做 "ambient border glow" 都没达到 Apple Intelligence 的 screen edges glow 观感（已在上一份 spec 中 defer）。本 spec 改用 WebGL fragment shader（SDF + Simplex noise）重做，并重新界定范围：

- 保留 `.copilot-glow` 背景完全不动
- 新光效只覆盖 `<main>` 中间内容区的内侧边缘
- 由 Copilot 交互状态机驱动（idle / typing / inspecting / processing / flash）

## 2. Goals

- **G1** — 在中间内容区的内侧边缘出现一圈有机、流体、非机械的光带，视觉上与 Apple Intelligence 唤起后的 screen edges glow 气质对齐
- **G2** — 由 Copilot 会话状态驱动：输入、圈选、思考、完成分别映射到不同 intensity / color / motion
- **G3** — 不破坏 `.copilot-glow` 背景，不碰 PR-4 已落地的 page_context / read_page 等后端
- **G4** — 0 新依赖（raw WebGL，不引 OGL/Three.js）
- **G5** — 关闭 copilot panel 时完全不渲染、释放 GL context

## 3. Non-goals

- 不实现手机端 layout
- 不做 fallback CSS 光效（失败即静默隐藏）
- 不实现 WebGL context restore（罕见 + 复杂，不值得）
- 不考虑 audio-reactive 模态
- 不在 copilot 关闭时提供"平台气质"的低亮呼吸（仅 copilot 开时渲染）

## 4. Architecture

### 4.1 Layering (inside `<main>`)

```
<main className="... relative">          z-stack:
  <GlowOverlay/>                          z=0   背景 .copilot-glow（不动）
  <EdgeGlow/>                             z=0   新 WebGL canvas（本 spec）
  <div className="relative z-[1]">        z=1   children 业务内容
    {children}
  </div>
</main>
```

Canvas 用 `position: absolute; inset: 0; pointer-events: none`，铺满 `<main>`。

与 `.copilot-glow` 同 z=0：shader 内部 alpha=0 的像素让背景透出；边缘 alpha>0 的像素以直 alpha 混合叠加。**不用** `mix-blend-mode: screen`（PR-4 尝试过，在纯白卡面上不可见）。

### 4.2 Activation

- 仅 `useCopilotStore().open === true` 时挂载组件
- 关 panel → component unmount → `cleanup()` 释放 buffers、program、删 canvas
- `prefers-reduced-motion: reduce` → 不挂载
- 无 WebGL（getContext 返 null）→ 不挂载
- Shader 编译失败 → 不挂载
- `webglcontextlost` 事件 → 设 `enabled=false`，canvas 隐藏（不尝试 restore）

### 4.3 Rendering

- 单 fullscreen quad（`[-1,-1]~[1,1]` 两个三角形 6 个顶点）
- 单次 `drawArrays(TRIANGLES)` 每帧
- 固定循环 `requestAnimationFrame`
- DPR 上限 2（Retina 2× 够，3× 不必要）
- `ResizeObserver` 观察 `<main>` 尺寸变化 → 重设 canvas.width/height、`u_resolution`
- 不用 texture，不开 mipmaps

## 5. State machine

### 5.1 State signals (from `useCopilotStore`)

| Signal | 源 | 用途 |
|---|---|---|
| `open` | localStorage 持久 | 挂载门禁 |
| `typingSignal` | bumpTypingSignal，debounced 250ms | TYPING beat trigger |
| `inspectorActive` | setInspectorActive | INSPECTING 持续态 |
| `busy` | chat-view 在 stream 期间 set true | PROCESSING 持续态 |
| busy falling edge (true→false) | 组件内 `useEffect` 探测 | FLASH 触发 |

注意：`tool_use pending` 不作为独立信号——`busy` 覆盖整个 chat round (user→assistant→tool→assistant)，工具调用期间仍然 busy=true。简化状态机。

### 5.2 States & uniform targets

| State | `u_intensity` | `u_thickness_px` | `u_noise_speed` | `u_color_phase` 行为 | `u_flash` |
|---|---|---|---|---|---|
| IDLE | 0.22 | 3 | 0.15 | `0.5 + 0.3 * sin(t * 0.25)` 慢振荡（violet↔cyan） | 0 |
| TYPING (400ms window after latest bump) | 0.35 | 5 | 0.30 | 同 IDLE 振荡公式，`t` 乘 1.8 加速 | 0 |
| INSPECTING (inspectorActive=true) | 0.50 | 7 | 0.45 | 锁常量 0.30（cyan 偏蓝，呼应 --copilot-accent） | 0 |
| PROCESSING (busy=true) | 0.90 | 11 | 1.40 | `mod(t * 0.8, 1.0)` 快速单向流转 | 0 |
| FLASH (800ms after busy ↓) | 1.0 → 0 | 14 → 11 | 1.8 → 0.15 | 保持 PROCESSING 最后相位 | 1 → 0 (exp decay) |

其中 `t` 是自组件挂载起的累计秒数（渲染循环中的 `u_time`，由 RAF 累加，pause 时冻结）。`u_color_phase` 由 state 模块每帧计算 target 后再走 spring；INSPECTING 锁常量意味着 spring 拉向 0.30，其他态 target 是时间函数。

### 5.3 State composition

多个信号可同时为真。优先级（高到低）：

1. FLASH（800ms 定时）
2. PROCESSING（busy=true）
3. INSPECTING（inspectorActive=true）
4. TYPING（typingSignal 在 200ms 窗口内）
5. IDLE

例：用户开着 inspector 发送消息 → 立即 PROCESSING 覆盖 INSPECTING；stream 结束 → 进入 FLASH；FLASH 结束 → 若 inspector 仍开则回 INSPECTING，否则 IDLE。

### 5.4 Spring dynamics

每帧实际 uniform 值不直接 snap 到 target，而是 critically-damped spring 迭代：

```ts
function springStep(current: number, target: number, velocity: number, dt: number): [number, number] {
  const stiffness = 180
  const damping = 22
  const acceleration = stiffness * (target - current) - damping * velocity
  const newVelocity = velocity + acceleration * dt
  const newCurrent = current + newVelocity * dt
  return [newCurrent, newVelocity]
}
```

独立对 `intensity / thicknessPx / noiseSpeed / colorPhase / flash` 每个 uniform 维护 (value, velocity) 对。

FLASH 是例外：先 snap 到 1.0，然后以 exp decay 衰减到 0（不是 spring，因为要精确 800ms 时长）。

## 6. Shader

### 6.1 Vertex

```glsl
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

### 6.2 Fragment

```glsl
precision highp float;

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

// ----- Ashima simplex 2D noise (inline, standard 40-line impl) -----
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
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
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                          dot(x12.zw,x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
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

  // Band: 只在边框附近像素 alpha>0
  float band_outer = smoothstep(u_thickness_px * 2.0, 0.0, sdf);
  float band_inner = smoothstep(-u_thickness_px * 3.0, 0.0, sdf);
  float band = band_outer * band_inner;

  // Simplex noise 调制
  float n = snoise(uv * 0.003 + vec2(u_time * u_noise_speed * 0.5, 0.0));
  n = 0.5 + 0.5 * n;

  // Palette mixing
  vec3 violet = vec3(0.62, 0.42, 0.95);
  vec3 cyan   = vec3(0.45, 0.85, 0.98);
  vec3 pink   = vec3(0.97, 0.65, 0.88);
  float phase = mod(u_color_phase + n * 0.3, 1.0);
  vec3 col = mix(violet, cyan, smoothstep(0.0, 0.5, phase));
  col = mix(col, pink, smoothstep(0.5, 1.0, phase));
  col = mix(col, vec3(1.0), u_flash);

  float alpha = band * n * u_intensity;
  gl_FragColor = vec4(col, alpha);
}
```

### 6.3 Precision compatibility

`precision highp float` 在桌面 GPU 全支持。老移动端 GPU 有可能降到 mediump，肉眼基本无差；不额外处理。

### 6.4 Corner radius

固定 `u_corner_px = 16`，对齐 shadcn `--radius-lg`。不随状态变化。

## 7. File structure

```
src/components/copilot/edge-glow.tsx               ← main client component
src/components/copilot/edge-glow-shader.ts         ← 顶点+片段 GLSL 常量字符串
src/components/copilot/edge-glow-state.ts          ← 纯函数：computeTarget + springStep + flash decay
src/components/copilot/__tests__/edge-glow-state.test.ts  ← 状态转移 / spring 收敛 / flash 衰减
src/app/layout.tsx                                  ← +1 行挂 <EdgeGlow/>
```

不新增、不修改：
- `src/app/globals.css`（完全不动）
- `.copilot-glow` 背景、`<GlowOverlay>` 组件
- 其他任何 copilot 组件

## 8. Lifecycle & Integration

### 8.1 Mount gate

`<EdgeGlow>` 内部根据 `useCopilotStore().open` + media query + WebGL 支持判断，任一失败 return null。

layout.tsx 无条件挂 `<EdgeGlow/>`，组件内部自己决定是否渲染（类似 `<GlowOverlay>` 现有模式）。

### 8.2 Canvas init

```
1. getContext('webgl2') ?? getContext('webgl')
2. 编译 vertex shader + fragment shader
3. link program
4. createBuffer + uploadGeometry (6 顶点 fullscreen quad)
5. lookupUniformLocations
6. ResizeObserver 启动
7. RAF loop 启动
```

### 8.3 RAF loop

```
每帧:
  dt = (now - lastTime) / 1000   // 秒，clamp ≤ 1/30 防止 tab 回切大跳
  signals = snapshot from store refs (不订阅 re-render)
  targets = computeTarget(signals, nowMs)
  currentState = springStep(currentState, targets, dt)
  gl.useProgram; setUniforms; gl.drawArrays
```

Store signals 通过 `useRef` 镜像，avoid re-subscribing on every state change.

### 8.4 Cleanup

```ts
useEffect(() => {
  // setup
  return () => {
    cancelAnimationFrame(rafId)
    resizeObs.disconnect()
    gl.deleteProgram(program)
    gl.deleteShader(vs); gl.deleteShader(fs)
    gl.deleteBuffer(buf)
    // canvas DOM 自动被 React 卸载
  }
}, [])
```

## 9. Performance budget

| 指标 | 目标 |
|---|---|
| 单帧 GPU 时间 | < 0.5ms（M1 Pro 测） |
| 单帧 CPU 时间 (RAF handler) | < 0.2ms |
| 稳态帧率 | 60fps |
| DPR cap | 2 |
| Shader ALU 估算 | snoise ~80 ops + SDF ~15 ops + palette mix ~10 ops ≈ 100 ops/pixel，1920×1080×2×2 DPR 约 2GFLOPS/frame，现代 GPU 不费力 |

## 10. Failure modes

| 场景 | 行为 |
|---|---|
| `getContext()` 返 null | `return null`，不挂载 canvas |
| Shader 编译失败 | 读 `getShaderInfoLog`，开发态 `console.warn`；prod 静默 |
| Link 失败 | 同上 |
| `webglcontextlost` | 事件监听置 enabled=false、canvas 隐藏 |
| `prefers-reduced-motion: reduce` | `return null` |
| DPR × size 超过 max_texture_size | 降 DPR 到 `min(2, gl.MAX_TEXTURE_SIZE / max(w, h))` |

## 11. Testing

### 11.1 Unit (vitest, `edge-glow-state.test.ts`)

- `computeTarget` 各状态优先级：PROCESSING > INSPECTING > TYPING > IDLE
- FLASH 仅在 busy ↓ 瞬间后 800ms 内激活
- `springStep` 从 0 趋近 1，50 帧（dt=1/60）内收敛至 ε=0.01
- `springStep` 无 overshoot（critically damped 参数校准）
- TYPING window 400ms：single bump 后 → 在 400ms 内 computeTarget 返 TYPING 档位；>400ms 后自动 fall back 到 IDLE

不测：WebGL 渲染本身（vitest 跑不了），shader 正确性（视觉验证）

### 11.2 E2E smoke

不加新 case（canvas 内容不可见 query，pixel check 脆）。依赖 `npm run build` 通过 + 手动视觉验证。

### 11.3 手动验证清单

- 开面板 → canvas 出现，idle 呼吸可见
- 在 textarea 打字 → 光带轻微加强（typing beat）
- 开 inspector → 锁蓝色，light up
- 发消息 → burst 到 processing 色流转
- 消息完成瞬间 → flash 白 → 回 idle
- 关面板 → 完全消失（DOM 里无 canvas）
- DevTools → Rendering → Emulate CSS media `prefers-reduced-motion: reduce` → 不渲染
- DevTools → Layers → canvas 层存在且 pointer-events=none
- Chrome chrome://gpu → 确认 WebGL 启用

## 12. Decisions log

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| 1 | 挂载位置 | `<main>` 内侧 | 语义清晰（中间内容区）；边缘跟 sidebar/panel 无缝贴合 |
| 2 | 渲染技术 | Raw WebGL fragment shader | 0 依赖；Apple Intelligence 的 SDF+noise 必须 shader；OGL 加依赖没带来实质便利 |
| 3 | 激活条件 | 仅 copilot panel 开 | 与现有 `.copilot-glow` 语义一致；关时彻底释放 GL |
| 4 | 状态机信号 | open + typingSignal + inspectorActive + busy + busy 下沿 flash | 覆盖 Copilot 交互全周期；tool_use pending 归 busy，不独立 |
| 5 | Fallback | 无，失败静默 | 3 轮 CSS 已验证无法达到期望；CSS fallback 无价值；用户明确表态"A" |
| 6 | mix-blend-mode | 不用 | PR-4 尝试过 `screen` 在白底不可见；直 alpha 混合更可控 |
| 7 | DPR 上限 | 2 | Retina 2× 够用；3× 无视觉收益，GPU 负担翻倍 |
| 8 | 背景光改不改 | 完全不改 | 用户明确要求保留 PR-4-pre 原样；光效独立叠加 |
| 9 | 颜色 palette | violet / cyan / pink | 与 `.copilot-glow` 的 glow-a/b/c 同族；INSPECTING 锁 sky-blue 呼应 `--copilot-accent` |
| 10 | Context restore | 不实现 | webglcontextlost 罕见；restore 代码复杂；隐藏更安全 |
| 11 | Corner radius | 固定 16px | 对齐 shadcn `--radius-lg`；状态机已经有 4 个 uniform 动，corner 再动会太复杂 |
| 12 | Spring 参数 | stiffness 180 / damping 22 | 临界阻尼，无 overshoot；典型 UI 感过渡 300-400ms |
| 13 | tool_use pending 独立态 | 合并进 PROCESSING | busy 已覆盖 chat + tool round trip；独立态增益小 |
| 14 | audio-reactive | 不做 | 产品范围外，用户未要求 |
| 15 | mobile layout | 不做 | Evalyst 是桌面工具，无移动端 |

## 13. Open questions

- 是否需要针对 `.dark` 主题单独调色？— 暂定共用 palette；实际跑起来如果暗色下太糙再加 `prefers-color-scheme` 分支
- Spring 参数可能需要 visual tuning；spec 给了起点值，实际开发过程中允许 ±30% 调整

## 14. Rollout

- 单独 commit，不在 `feat/copilot-page-context-ambient-border` 分支（该分支 P2 已 defer）
- 建议新 branch `feat/copilot-edge-glow-webgl`
- PR 描述带 before/after 截图/录屏

## 15. Related docs

- Previous attempt: `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md` §5.3（已 DEFERRED）
- Copilot Glass System: `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`
- CLAUDE.md Copilot 章节
