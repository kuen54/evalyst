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
<main className="... relative">           z-stack:
  <GlowOverlay/>                           z=0     背景 .copilot-glow（不动）
  <div className="relative z-[1]">         z=1     children 业务内容
    {children}
  </div>
  <EdgeGlow/>                              z=999   WebGL 边缘光（本 spec，顶层画框）
</main>
```

Canvas 用 `position: absolute; inset: 0; pointer-events: none; z-index: 999`，铺满 `<main>`。

**关键决策（V2 2026-04-29）**：canvas 置于 UI 内容之上（"画框"效果），不是之下。Apple Intelligence 的 screen edges glow 是覆盖在屏幕 UI 之上的，让边缘像被光环包裹。因为 shader 中心区域 alpha=0（band 只在边缘），只有边缘像素遮盖 UI，内部 UI 完全可见且可交互（`pointer-events-none` 让点击穿透）。

与 `.copilot-glow` 背景互不干扰（.copilot-glow 在 z=0，中心依然透过 canvas 中心可见）。**不用** `mix-blend-mode: screen`（PR-4 尝试过，在纯白卡面上不可见；且会让整个中间区域蒙上白雾）。

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

**V2.1 (2026-04-29 late)**：`u_thickness_px` 语义变更为"向内**延伸**距离"（不再是 band 中心线的 inset）。值显著上调让光效在中等尺寸 `<main>` 上清晰可见。

| State | `u_intensity` | `u_thickness_px` (inward reach) | `u_noise_speed` | `u_amplitude` | `u_color_phase` 行为 | `u_flash` |
|---|---|---|---|---|---|---|
| IDLE | 0.40 | 30 | 0.15 | 4 | `0.5 + 0.3 * sin(t * 0.25)` 慢振荡（indigo↔cyan） | 0 |
| TYPING (400ms window after latest bump) | 0.55 | 40 | 0.30 | 6 | 同 IDLE 振荡公式，`t` 乘 1.8 加速 | 0 |
| INSPECTING (inspectorActive=true) | 0.70 | 50 | 0.45 | 10 | 锁常量 0.25（pure cyan，呼应 --copilot-accent sky blue） | 0 |
| PROCESSING (busy=true) | 0.95 | 70 | 1.40 | 20 | `mod(t * 0.8, 1.0)` 快速单向流转（indigo → cyan → magenta → amber） | 0 |
| FLASH (800ms after busy ↓) | 1.0 → 0 | 90 → 70 | 1.8 → 0.15 | 24 → 20 | 保持 PROCESSING 最后相位 | 1 → 0 (exp decay) |

**语义说明**：
- `u_thickness_px` = 从 canvas 物理边缘向内的光晕渐隐距离（px，backing buffer 坐标；在 DPR=2 时 CSS 可感知距离 = thickness / 2）。Processing 态 70 backing px = 35 CSS px 的柔和光带，有可见存在感但不压盖内容。
- `u_amplitude` = noise 驱动的内边界摆动幅度。Processing 态 20 backing px 意味着光晕内边界在 `-90px ~ -50px` 之间呼吸（thickness ± amplitude），产生火焰舔舐感。
- 边缘本身（sdf=0 处）**始终** alpha=1 × intensity，无 v1 的边缘衰减问题。

其中 `t` 是自组件挂载起的累计秒数（渲染循环中的 `u_time`，由 RAF 累加，pause 时冻结）。`u_color_phase` 由 state 模块每帧计算 target 后再走 spring；INSPECTING 锁常量意味着 spring 拉向 0.25，其他态 target 是时间函数。

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

**V2.1 (2026-04-29 late)**：根本修复 v1 / v2 的"光晕不达边缘"问题。v1/v2 的 `half_ = resolution/2 - thickness` 把 SDF 零等值面**内缩**了 `thickness` 像素，导致光晕峰值落在边缘**内侧** thickness 像素处，canvas 物理边缘反而只是衰减中段（~50% alpha）——用户看到的"glow 只在顶部出现、不覆盖完整边框"的根源。V2.1 丢弃 inset，SDF 零等值面与 canvas 物理边缘完全重合。

```glsl
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_thickness_px;   // V2.1: inward reach distance (px)
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

// ----- Neon chroma palette -----
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
  vec2 half_ = u_resolution * 0.5;       // V2.1: NO inset — SDF 零面 = canvas 物理边缘
  float sdf = sdRoundedBox(uv - center, half_, u_corner_px);
  // sdf = 0 exactly at canvas edge; negative (toward canvas center); positive (outside — clipped).

  // Multi-scale noise for organic turbulence.
  float n_lo = snoise(uv * 0.0025 + vec2(u_time * u_noise_speed * 0.4, 0.0));
  float n_hi = snoise(uv * 0.008  + vec2(0.0, u_time * u_noise_speed * 0.6));
  float n = n_lo * 0.7 + n_hi * 0.3;     // [-1, 1]

  // Inner cutoff — the "inward reach" end of the glow band. Noise-modulated
  // so the inner boundary breathes inward/outward (flames licking center).
  float inner_cutoff = -u_thickness_px + n * u_amplitude;
  float band = smoothstep(inner_cutoff, 0.0, sdf);
  // At edge (sdf=0): band = 1 ALWAYS (glow anchored to physical edge).
  // At sdf = inner_cutoff: band = 0 (glow faded out).
  // In between: smooth falloff.

  // Palette with small noise-driven phase jitter.
  vec3 col = palette(u_color_phase + n * 0.15);
  col = mix(col, vec3(1.0), u_flash);

  // Alpha does NOT multiply noise (v1 flicker fix).
  float alpha = band * u_intensity;
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied alpha
}
```

**V2.1 核心修复**：

| 项 | v1 / v2 | V2.1 |
|---|---|---|
| `half_` | `resolution/2 - thickness` (inset box) | `resolution/2` (full canvas box) |
| Band 峰值位置 | 距 canvas 边缘 thickness px 内 | **canvas 边缘本身** |
| Band 形状 | 双 smoothstep 产品（ring） | 单 smoothstep（从边缘向内衰减） |
| Alpha 调制 | `band × noise × intensity` | `band × intensity`（noise 只驱动位移） |
| 边缘覆盖率 | ~50% alpha at edge | **100% alpha at edge** |

配合 §5.2 中 thickness 值上调（IDLE 30 / PROCESSING 70 等），光带在 CSS 尺度上清晰可见：Processing 态光从物理边缘向内延伸 ~35 CSS px，足以被用户感知为包裹中间区域的"画框"。

### 6.2.1 Canvas bounding box 注意事项

Shader 假定 canvas 的 backing buffer (`u_resolution`) 精确等于其 CSS 显示尺寸 × DPR。因为 Band 紧贴 canvas 边缘，**任何 canvas bbox 与预期容器不符的偏差都会直接可见**（如 v1 的"只有顶部可见"正是此问题 + inset 叠加）。

组件实现须保证：
1. `<canvas>` 用 `absolute inset-0`（或等效定位）**完全覆盖**可见的 `<main>` 区域（sidebar 右缘到 copilot panel 左缘、viewport 上下缘）；
2. `resizeCanvas()` 每次 ResizeObserver fire 时都读 `canvas.getBoundingClientRect()` 并按 `dpr` 更新 `canvas.width / canvas.height`；
3. 每帧 renderFrame 中 `gl.viewport(0, 0, canvas.width, canvas.height)` 与 `gl.uniform2f(u_resolution, canvas.width, canvas.height)` 保持同步。

如果 `<main>` 因为 flex 布局问题导致 bbox 偏离预期，首选解决方案是修 flex 布局，而非在 shader 中补偿。当前 layout（body flex + sidebar/main/panel 同级）已验证正确：copilot 打开时 panel shrink-0 占宽导致 main 自动 shrink。

### 6.3 Precision compatibility

`precision highp float` 在桌面 GPU 全支持。老移动端 GPU 可能只支持 mediump，用 `#ifdef GL_FRAGMENT_PRECISION_HIGH` guard 自动回退；mediump 下 Ashima noise 的长浮点常量可能出现轻微 banding，可接受。

### 6.4 Blend mode

Shader 输出 **premultiplied alpha**（`vec4(col * alpha, alpha)`）。Task 6 GL init 必须用 `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)` 匹配，避免半透明边缘出现黑色 halo。

### 6.5 Corner radius

**V2 (2026-04-29)**：`u_corner_px = 0`（直角）。`<main>` 容器没有 `rounded-*` class，是纯直角矩形；光效外边缘必须精确对齐到矩形边缘，否则会在四角处出现"光被圆角遮住、背景矩形角落露出"的漏风（gap artifact）。

内部的圆滑感来自 `smoothstep` 对 SDF 的羽化（不是 `u_corner_px` 的 SDF 圆角参数）—— 随着像素远离边缘，band 在数学上自然衰减、视觉上呈现"光带柔和包裹"效果，不靠硬圆角裁切。

如果未来 `<main>` 本身改挂 `rounded-*` class，此值应改为对应像素值（shadcn `--radius-lg` = 8px，对应 `u_corner_px = 8`）。

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
| 9 ~~v1~~ | ~~violet / cyan / pink pastel~~ | **V2: indigo / cyan / magenta / amber neon** | v1 用户反馈"发灰、washed out、毫无能量感"；v2 换高饱和 neon chroma（Apple Intelligence 真实色规范） |
| 10 | Context restore | 不实现 | webglcontextlost 罕见；restore 代码复杂；隐藏更安全 |
| 11 ~~v1~~ | ~~固定 16px~~ | **V2: 固定 0（直角）** | v1 在方角 `<main>` 上强加 16px 圆角 → 四角漏风 gap；v2 外边缘对齐容器，圆滑感由 smoothstep 羽化提供 |
| 12 | Spring 参数 | stiffness 180 / damping 22 | 临界阻尼，无 overshoot；典型 UI 感过渡 300-400ms |
| 13 | tool_use pending 独立态 | 合并进 PROCESSING | busy 已覆盖 chat + tool round trip；独立态增益小 |
| 14 | audio-reactive | 不做 | 产品范围外，用户未要求 |
| 15 | mobile layout | 不做 | Evalyst 是桌面工具，无移动端 |
| **16 (V2)** | Z-index | canvas z-index **999**（原 0） | v1 canvas 在 UI 之下 → 内容卡覆盖 glow → 边缘断裂；v2 canvas 在 UI 之上形成"画框"包裹感。pointer-events-none 保证交互不被遮挡 |
| **17 (V2)** | 运动方式 | noise 驱动 SDF 位移 `distorted_d = sdf + n * u_amplitude`（原：noise 调 alpha） | v1 的 band 原地闪烁像水波纹；v2 band 本身向内波浪冲击，火焰舔舐中心 |
| **18 (V2)** | 新增 uniform `u_amplitude` | 每态值 IDLE 2 / TYPING 4 / INSPECTING 6 / PROCESSING 14 / FLASH 18→14 | 与 intensity / thickness 解耦，独立控制"波浪幅度"语义，映射 Copilot 算力强度 |
| **19 (V2)** | 整体 intensity/thickness 上调 | intensity 0.22→0.35 起步，thickness 3→14 起步 | v1 所有数值太保守，看不出光效；v2 显著提高以匹配 Apple Intelligence 浓烈观感 |
| **20 (V2.1)** | SDF inset 去除 | `half_ = resolution/2`（原 `resolution/2 - thickness`） | v1/v2 的 SDF 零等值面内缩 thickness px，glow 峰值落在边缘内侧，canvas 物理边缘只剩 ~50% alpha（噪声调制后更暗）→ 用户看到"glow 只在顶部出现、未覆盖完整边框"。V2.1 让 SDF 零面与 canvas 边缘重合，边缘 band=1 始终达峰 |
| **21 (V2.1)** | `u_thickness_px` 语义 | 从"band-peak inset"改为"inward reach"；所有态值重标（IDLE 14→30、PROCESSING 32→70） | 配合 decision 20，thickness 现在表示向内延伸距离；原数值在新语义下过小，体积感不足 |
| **22 (V2.1)** | band 公式简化 | 单 smoothstep `smoothstep(-thickness + n*amplitude, 0, sdf)` | v2 的双 smoothstep (band_outer × band_inner) 在去除 inset 后冗余；单 smoothstep 清晰表达"边缘 1 → 内部 0" |
| **23 (V2.1)** | alpha 去 noise | `alpha = band × intensity`（原 `band × n × intensity`） | noise 已经驱动 inner_cutoff 位移（空间维度），再调 alpha 会让边缘"忽明忽暗"；固定 alpha 让边缘稳定、波浪只体现在 depth |

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
