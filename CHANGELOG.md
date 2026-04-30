# Changelog

按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格记录。版本号是松散里程碑，不是 semver —— 这是一个持续演化的工具，不是承诺 API 稳定的库。

每个版本对应的 git tag 见 [Releases](https://github.com/kuen54/evalyst/releases)；每个条目的 commit 范围可以在 `Compare <prev>...<this>` 里看到完整 diff。

---

## [Unreleased]

## [0.5.3] — 2026-04-30 · Copilot 打开体验三件套（扫光降饱和 + panel 弹性 + 扫光从 panel 边缘起）

围绕 Material Reveal 的打开动效做三项互相独立但衔接到位的改进。主题切换 cascade 仍在调试中，不在本版本。

### 浅色扫光降饱和

- 新增 `--copilot-wave-core-light: oklch(0.82 0.08 230)`——比 `--copilot-accent`（oklch 0.7 0.15 230）亮度 +0.12 / chroma 砍半，专门给浅色 reveal wave 的中心 peak 用
- 浅色 wave 所有 stop 用 `var(--copilot-wave-core-light)` 取代 `var(--copilot-accent)`，中心 peak alpha 95% → 80%，halo 35/60% → 30/50%
- 视觉上从"饱和天蓝"变成"柔和浅蓝"，不再有"饱和刺眼"观感；暗色主题完全不动

### Panel 弹性弹出

- 新增 `@keyframes copilot-panel-enter`（translateX `100%` → `0` + opacity `0` → `1`）+ `.copilot-panel-enter` 类，450ms `cubic-bezier(0.16, 1, 0.3, 1)`（easeOutExpo）
- `panel.tsx` 把 panel 内容 wrapper 加该类，每次 `effectiveOpen` rising edge 重新 mount，CSS animation 自动重播
- 刻意**无 overshoot**：早先 easeOutBack 12% overshoot 叠加 aside `overflow-hidden` 裁切，内容尾部被切会读作"弹来弹去"。easeOutExpo 单向滑入，内部元素不晃
- 关闭无动画保持不变（content 直接 unmount + width 瞬间归零）
- `prefers-reduced-motion: reduce` 关掉动画

### 扫光从 panel 左边缘起 + 三动画节奏错开

- `.copilot-reveal-wave` / `.copilot-reveal-tail` 加 `right: var(--copilot-panel-width, 0px)` — wave overlay 不再覆盖 panel 本体
- Gradient 中心从 `circle at 150vw 50%` 改成 `circle at calc(150vw - var(--copilot-panel-width, 0px)) 50%` — 亮峰 `center - 50vw` 在 t=0 恰好落在 panel 左边缘（= overlay 右沿 = `100vw - panelWidth`）。Panel 关时 var 默认 0 视觉等同原版
- Wave + tail animations 加 `200ms` / `340ms` `animation-delay` —— 让三个动画错开：panel spring 先走 0-450ms，wave 200ms 起步，cascade 紧跟。消除"衔接太挤"
- Wave / tail 默认 `opacity: 0`，fade keyframe 改成 `0%→10% opacity 0→1`——否则 200ms animation-delay 期间 wave 会静止在 panel 边缘 200ms 读作"起点卡一下"
- `computeRevealDelay(centerXvw, startVw=100)` 新增 `startVw` 参数，delay 公式按 panel 宽度调整；`waitForWaveOffsetMs` 350 → 750（含 wave 自己的 200ms delay + 550ms wait-for-wave gap）；clamp 上限 1600 → 2000；overlay cleanup 2000 → 2400ms
- `store.setOpen` / `toggleOpen` rising edge 同步把 panel 宽度写到 `html.style.--copilot-panel-width`，确保 `applyRevealCascade` 读到一致的值；`open/width` effect 进一步同步 resize 期间的变化

### 架构落地

- `src/app/globals.css`：新增 `--copilot-wave-core-light` 变量 + `@keyframes copilot-panel-enter` + `.copilot-panel-enter` 类；改写浅色 wave 配色；wave/tail 基础 rule 加 `right` 和 `opacity: 0` 默认
- `src/components/copilot/material-reveal-overlay.tsx`：`computeRevealDelay` 签名扩展接受 `startVw`；`applyRevealCascade` 读 `--copilot-panel-width` 算 panelVw
- `src/components/copilot/store.tsx`：新增 `widthRef` 同步追踪 panel 宽度；`setOpen` / `toggleOpen` 在 `applyRevealCascade` 之前同步写 `--copilot-panel-width`；`open/width` effect 把 resize 同步到 CSS var
- `src/components/copilot/panel.tsx`：panel 内容 wrapper 加 `.copilot-panel-enter` 类

### 测试

- vitest `computeRevealDelay` 5 case 更新期望值（新 offset 750 + clamp 2000）
- 其它测试不受影响；TS `tsc --noEmit` clean

### 已知限制

- 主题切换仍走 next-themes 原生的 `disableTransitionOnChange`（所有元素 snap）；R→L cascade 的主题切换仍在调试，下版本解决

## [0.5.2] — 2026-04-30 · Light Theme Reveal Wave Tuning

Iteration pass on the `0.5.1` Material Reveal light theme wave after user feedback that the cyan band read as "塑料布罩 UI"（saturated plastic sheet over UI）and didn't match dark theme's 高级 aesthetic.

### 光色重构 —— Symmetric mirror of dark

- 浅色 `.copilot-reveal-wave` 从 `0.5.1` 的"accent-soft 侧翼 + accent 中心 @ multiply blend + saturate(2) contrast(1.3)"重构为**严格镜像 dark 主题的 9-stop symmetric 结构**：
  | r | Dark | Light |
  |---|---|---|
  | 38-62vw | transparent edges | transparent edges（同） |
  | 42/58vw | accent 25% alpha | **off-white rgba(218, 225, 242) 35% alpha** |
  | 46/54vw | accent 50% | **off-white 60%** |
  | 48/52vw | white 70% | **accent 70%** |
  | **50vw PEAK** | **white 95%** | **accent 95%** |
- `mix-blend-mode: screen` → **`normal`**（在近白底上和 multiply 数学等价，语义更清楚为"纯 alpha 叠加不和底色做物理 blend"）
- 所有其他实现（`position/inset/z-index/pointer-events/filter: blur(16px)/contain: layout style paint/animation`）**继承 base rule，完全对齐 dark**
- 尾浪 `.copilot-reveal-tail` 同步简化：砍掉 `saturate(2) contrast(1.3)` filter，blend mode `multiply → normal`，band 30-70vw → **40-60vw**（收紧 20vw 让 radial arc 曲率读得出来，不被宽度稀释成垂直条）
- 删除 `0.5.1` 浅色主题 override 里的 `mix-blend-mode: multiply` + 额外 filter saturate/contrast
- **Off-white 选 `rgba(218, 225, 242)` cool-tinted light gray**：用户反馈 transparent 不行、必须"一点点灰但要有颜色"；在 page bg oklch(0.995) 上 normal blend @ 0.35/0.60 alpha 输出可见冷调浅灰

### 探索过程中被 drop 的方案（全部在 git log 里）

17 轮 tuning commits，尝试过但最终 revert 的方向：
- 双 pseudo-element layered blends（`::before` multiply 蓝 body + `::after` plus-lighter / screen 白核）—— spindle 形状、harsh edges、层间 blend 隔离问题多
- `mask-image` + `backdrop-filter: blur(3px) brightness(1.05)` 做 Contrast Gleam + Iridescent Sheer lens effect —— 结构复杂且辅助层时序和主波对不齐
- Asymmetric 单层 peak 偏外/内半径 —— 无法同时达到"白有色"和"蓝显形"
- Flat-top 4-6vw peak 抗 blur 稀释 —— peak 值守住了但和 ::before 宽度接近时产生纺锤感

最终收敛到"**严格对齐 dark 结构 + 颜色互换 + 浅冷灰白 rgba**"是最干净的答案。

### 架构落地

- `src/app/globals.css`：只改 `:root:not(.dark) .copilot-reveal-wave` + `:root:not(.dark) .copilot-reveal-tail` 两个 override block。完全不动 dark 主题 base rule、pseudo-element 结构（其实没用）、animation、parent 继承链
- **没有新文件**，**没有新测试**，**没有 JS 改动**——纯 CSS tuning 迭代

### 测试

- vitest 209 case 全绿（`material-reveal-overlay` `computeRevealDelay` 5 case 不受 CSS 改动影响）
- e2e smoke 9 case 不受影响（no-crash routing + sidebar render）
- TS `tsc --noEmit` clean

- 相关 commits: `cf8b27d` → `5b484cb`（17 轮迭代，PR #10）

## [0.5.1] — 2026-04-30 · Copilot Material Reveal

### Copilot Material Reveal（一次性唤起动效，替代已 DROP 的 edge glow）

- **触发**：copilot 面板 `open: false → true` rising-edge。⌘K / toggle 按钮均触发。关闭不播；刷新恢复 open=true 不播（首次 mount 屏蔽）
- **视觉**：`radial-gradient` 圆弧扫光从屏外右侧（`circle at 150vw 50%`，band 半径 ~50vw）扫入 viewport；动画 1250ms，`transform: translateX(0 → -100vw)` 单段 `cubic-bezier` + 独立 `opacity` 在末段 50→100% linear 淡出（避免末尾 `radial center` 进 viewport 的"幽灵双弧"）；尾浪 140ms 延后 + 同轨迹。`filter: blur(16px)` 让 wave 读作光晕
- **两套主题色**：
  - **暗色**：accent 侧翼 + 白色 hot core (95% alpha)，`mix-blend-mode: screen`（永远变亮）
  - **浅色**：白色侧翼 + `--copilot-accent-soft` (sky blue L=0.88) halos + `--copilot-accent` 中心 (50% alpha)，`mix-blend-mode: multiply`（反向变成浅蓝光束扫过）
- **Cascade**：`store.setOpen/toggleOpen` 检测 rising edge **同步**调 `applyRevealCascade`，先写 `--reveal-delay` CSS var + `data-copilot-revealing="true"` flag **再**让 React commit shell.tsx 新 inline style——否则浏览器会用 shell 的 inline 320ms 先起跑，后写的 delay 不作用于 in-flight transition。每卡 delay = 300ms offset + `((100 - cardX) / 100) * 1250`，clamp `[0, 1550]`。`html[data-copilot-revealing="true"]` override 用 `!important` 覆盖 shell 的 inline transition
- **清理**：`MaterialRevealOverlay` useLayoutEffect 挂 1950ms setTimeout，setTimeout 或 store.setOpen(false) 时调 `clearRevealCascade` 清所有 `--reveal-delay` + `data-copilot-revealing`。effect return fn 只 `clearTimeout` 不调 cleanup（否则下次 rising-edge React 跑旧 cleanup 会擦掉新写的 delay）
- **A11y**：`prefers-reduced-motion: reduce` 关 overlay、cascade 均匀 200ms；`prefers-reduced-transparency: reduce` 关 overlay（玻璃自身走既有降级）

**架构落地**：
- `src/components/copilot/material-reveal-overlay.tsx` 新增：`computeRevealDelay` 纯函数 + `applyRevealCascade` / `clearRevealCascade` 同步 DOM 助手 + `MaterialRevealOverlay` React 组件（渲染 `.copilot-reveal-wave` + `.copilot-reveal-tail` 两层 overlay）
- `src/components/copilot/store.tsx` 扩展：新字段 `lastOpenedAt: number` rising-edge 时间戳 + `openRef` 同步读当前 open（state 异步）；`setOpen` / `toggleOpen` 在 `setOpenState` 之前同步调 `applyRevealCascade`（rising）或 `clearRevealCascade`（falling）
- `src/app/globals.css` 追加：双 `@keyframes`（`copilot-reveal-wave-translate` + `copilot-reveal-wave-fade` + `copilot-reveal-tail-fade`）+ `.copilot-reveal-wave` / `.copilot-reveal-tail` radial-gradient + `:root:not(.dark)` 亮色主题 override + `html[data-copilot-revealing]` 高优先级 `!important` transition override + a11y 降级
- `src/app/layout.tsx` 挂 `<MaterialRevealOverlay />` 于 `CopilotStoreProvider` 子树内，与 `<GlowOverlay />` 同级

**测试**：
- vitest：204 → 209（新增 computeRevealDelay 5 case，覆盖右边缘 / 中线 / 左边缘 / 负坐标钳位 / 超屏钳位）
- e2e smoke：9 case（未增）

- Spec: `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`
- Plan: `docs/superpowers/plans/2026-04-29-copilot-material-reveal.md`

## [0.5.0] — 2026-04-29 · Copilot page context + UI polish

### Page Context + Viewport Tool（PR-4；P2 Ambient Border Glow DEFERRED）

- **自动 page context**：开 copilot 即向 LLM 注入当前页面摘要（15 种 `route_type` × 每页自定义 summary 字段，e.g. experiment_detail 含 id / name / status / progress / cost_by_currency / rubric_id）。不走 chip rail，仅在系统消息顶部渲染，"预览 LLM 将看到的 context"面板里对用户可见
- **`read_page(query)` 工具**：LLM 可按自然语言 query 查找当前页面可见数据，服务端对 `viewport_index` 做 token 子串打分、top-5 命中复用既有 `resolveContexts()` hydrate 成 tree 返回；`requiresConfirm: false` auto-run；空 token fallback 到整句匹配，resolveContexts 异常时返回部分结果
- **~~Apple Intelligence 风 ambient border glow（screen edges glow · 路线 A CSS 近似）~~ DEFERRED（2026-04-29）**：3 轮 CSS 尝试（inset bloom / conic-gradient mask-composite ring / 5-blob pastel inset）都无法达到用户期望的 Apple Intelligence screen edges glow 观感。真实实现需要 SDF + Simplex noise fragment shader，CSS 做不到。代码 revert，`.copilot-glow` 背景 radial drift 保持 PR-4 前原状。留给未来路线 B（WebGL `<canvas>` + shader）单独立 PR。详见 spec §5.3
- **~~路线 B WebGL edge glow（SDF + Simplex noise + 5 状态机）~~ DROPPED（2026-04-29 晚）**：同日完整实现了路线 B（19 commits，5 states + Inigo Quilez rounded box SDF + Ashima simplex + neon 调色板 + critically-damped spring + premultiplied alpha），但用户体感"太眼花缭乱"整体 drop，不是再 defer。代码 + spec + plan 完整保存在 `archive/edge-glow-webgl` 分支，不合 main，仅作技术参考
- **切页清空 + banner**：`RouteChangeObserver` 监听 `usePathname`+`useSearchParams`，路由变化即清空 manual contexts（inspector / text_selection），session 有 messages 时顶部弹 amber `RouteChangeBanner` 提示"开启新对话"/"继续当前对话"（不阻断切换）
- **统一 client→server snapshot 机制**：`/chat` + `/tool-result` POST body 新增 `client_snapshot = { page_context, viewport_index, ... }`；server 缓存到 per-session Map（`snapshot-cache.ts`），`read_page` 工具按 `sessionId` 取 snapshot；DELETE session 同步清 cache

**架构落地**：
- `src/lib/copilot/` 新增: `use-page-context.ts` hook / `collect-snapshot.ts`（DOM 扫描 + truncate 200 chars + ancestors chain）/ `snapshot-cache.ts`（in-memory Map）
- `src/lib/copilot/tools.ts` 扩展：`CopilotToolContext { sessionId }` 接口 + `read_page` 工具
- `src/lib/copilot/resolve-context.ts` `formatContextsForLlm` 支持 `pageContext` 参数，输出顶部 `# 当前页面` markdown 块
- `src/components/copilot/` 新增: `route-change-banner.tsx` / `route-change-observer.tsx`（Suspense wrapper）
- `src/components/copilot/store.tsx` 扩展：`pageContext` / `typingSignal`（debounced 250ms）/ `routeChangeBanner` / `clearManualContexts`
- 13 个 page 文件补 `useRegisterPageContext()`（dashboard、experiment new/detail、compare、settings list ×5、settings detail ×4、settings new ×4）
- `src/app/globals.css` + `src/app/layout.tsx`：**未动**（P2 border glow DEFERRED；`.copilot-glow` 保持原状）

**测试**：
- vitest：179 → 204（新增 snapshot-cache 5 + read-page-tool 9 + collect-snapshot 7 + resolve-context 扩展 4）
- e2e smoke：9 case（未增；border glow e2e 随 P2 一并 deferred）
- jsdom 加入 devDependencies（collect-snapshot 测试需要 DOM）

**决策记录**（spec §11）：
| # | 决策 | 最终 |
|---|---|---|
| 1 | page_context 粒度 | 每页自定义 getter |
| 2 | page_context UI 展示 | 只在 preview panel，不走 chip |
| 3 | read_page 返回 | 结构化 tree (JSON), preview markdown 渲染 |
| 4 | ~~Border vs 背景光~~ | **DEFERRED**（P2 整体 defer） |
| 5 | 切页 context 行为 | 清所有 + banner（不阻断） |
| 6 | 切页 session 行为 | 保留（A），banner 提供"开启新对话" |
| 7 | read_page 签名 | `query: string` 自然语言 |
| 8 | Snapshot 持久化 | in-memory Map，进程重启丢失 |
| 10 | ~~边框光技术~~ | **DROPPED**（2026-04-29 晚：路线 B WebGL 实现完成后用户体感"太眼花缭乱"整体放弃，代码保存在 `archive/edge-glow-webgl`） |

**Defer / Open Questions**（spec §13）：
- **整个 P2 ambient border glow → 最终 DROPPED**：2026-04-29 先 defer CSS（路线 A），同日晚实现 WebGL（路线 B）后用户体感"太眼花缭乱"整体放弃；代码 + spec + plan 完整保存在 `archive/edge-glow-webgl` 分支（19 commits），未来若重做请另起新 spec
- read_page 对 `task_result:exp_id/task_id` 形 elementKey 的 experiment_id 提取：v1 简化处理，实际命中率待观察
- Firefox < 128 降级 SVG stroke：v1 不做
- 移动端 layout：v1 不做

- Spec: `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-copilot-page-context-ambient-border.md`

### UI polish（PR #5 + #6）

- **卡片线条统一 1px**：`GlassCard` / `GlassCardThin` 的 `SHADCN_CARD_DEFAULTS` 去掉 `ring-1 ring-foreground/10`（原来 border 1px + ring 1px 视觉 2px）；清掉 6 处 `GlassRegular` 手工叠加的 ring-1（experiments/[id] 进度卡、settings/datasets/[id] ×2、settings/templates/[id]、display/dataset form preview）。失败任务卡自然只剩红 border
- **Copilot 背景光节奏**：`.copilot-glow::before` + `.copilot-glow-flow` 都 8s（active/streaming 态 4s）；昼/夜共用 keyframes，轨迹完全一样，只调速度
- **点击 spawn 光点整个删除**：不再在点击位置生成柔光，背景光始终保持漂移本色 —— 用户明确要求"不要有点击后变色的效果，统一浅色"。相关清理：`glow-overlay.tsx` 的 SpawnLayer / SPAWN_COLORS / click listener / throttle / state 全部删；`globals.css` 的 `.copilot-glow-spawn` + `@keyframes copilot-glow-spawn` + 对应 reduced-motion 分支删

## [0.4.0] — 2026-04-28 · Copilot 工具调用闭环

Copilot 装上"手"，能调 3 个工具直接读实验数据 + 触发重跑：
- `list_experiments(filter?)` — 发现相关实验（read，no-confirm）
- `read_experiment_results(experiment_id, task_ids?, status?)` — 读结果 / 扫失败（read，no-confirm）
- `restart_experiment(experiment_id, task_ids?)` — 重跑（write，**必 confirm**）

两阶段 streaming 对话（LLM tool_use → 前端暂停渲染卡片 → read 工具无感执行 / write 工具 Confirm/Deny → 前端 POST 结果 → 服务端 append + 再调 LLM），链式上限 5 次。

**架构落地**：
- `src/lib/copilot/tools.ts` + `tool-metadata.ts`（server/client 分层）+ `tool-registry.ts` + `tool-adapters.ts`
- `src/lib/copilot/llm-stream.ts` 扩展：`callLlmStreaming` 接受 `tools` 参数；解析 OpenAI `tool_calls[]` + Anthropic `content_block_start/delta/stop` 流式，归一化 `tool_use_start/delta/end` 事件；`serializeMessagesForProvider` 处理 tool_use / tool_result 消息 + 合并相邻 assistant+tool_use 保证 Anthropic alternation
- `src/lib/copilot/build-llm-messages.ts` 从 chat/route 抽出，复用给 /tool-result
- `src/app/api/copilot/sessions/[id]/tool-result/route.ts` 新端点 —— confirm/deny → run tool → append result → 再流 LLM，chain cap 5 (429)
- `src/components/copilot/tool-call-card.tsx` 3 态卡（loading / confirm / result-collapsed）
- `src/components/copilot/chat-view.tsx` UiMessage 扩为 4 变体 discriminated union；抽 `consumeSseStream`；auto-run read 工具

**测试**：172 → 177 vitest（新增工具 impl + 格式适配 + 消息序列化 + 合并 assistant turn）；e2e smoke 9/9。

`edit_template` **defer**（决策记录见 spec §9）—— 现阶段改 prompt 仍需用户手动到 template 编辑页改。等 3 工具跑稳一轮再加回来。

- Spec: `docs/superpowers/specs/2026-04-28-copilot-pr3-tool-calling-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-copilot-pr3-tool-calling.md`
- PRs: #3（功能落地）+ #4（pipeline 时序 debug race fixes）

### 后续调试轮次修复（已并入本版本）

- **appendMessage 并发写丢消息**：read-modify-writeAtomic 改成 `fs.appendFileSync`（OS 层原子 append）
- **Auto-run 读工具并行风暴**：一轮 N 个 read tool_use_end 改成 async IIFE 串行 await
- **abortRef 覆写不 abort 旧的**：`doStreamSend` 和 `postToolResult` 覆写前先 `abortRef.current?.abort()`
- **SSE `controller.enqueue` 在流关后抛**：`write` helper 包 try/catch 吞掉
- **手动 Confirm/Deny race**：ToolCallCard 按钮在 `tool_use.id`（服务端 `done` 事件回填）到之前 disabled
- **Auto-run read 工具 race**：pendingAutoRunRef 延后到 `done` 事件再 fire，避免 server append tool_use 之前 `/tool-result` 抢跑导致 parent_id 错链
- **`/tool-result` 孤儿 tool_result**：model 校验移到 `appendMessage` 之前
- **tool_result 内容通过 SSE 回传**：`tool_result_message` 事件带 `content` + `denied` + `reason`，摘要能渲 "找到 21 个实验" / "共 3 条结果"
- **client bundle 炸 fs**：split tool metadata 到独立文件，UI 不再透过 `tools.ts` 把 `@/lib/store` 拖进浏览器

### 决策记录（spec §9）

| # | 决策 | 最终 |
|---|---|---|
| 1 | Read 工具是否 confirm | 无感执行 |
| 2 | `edit_template` 粒度 | **整体 defer**（改 prompt 仍走 template 编辑页，3 工具跑稳一轮再加回来） |
| 3 | 链式调用上限 | 5 |
| 4 | tool_use + tool_result 是否持久化 | 持久化 jsonl |
| 5 | Deny 行为 | 继续对话 |
| 6 | Fork 时 pending tool call | 作废 |

### 未验证 / 等配额

- Anthropic-compat（Claude-on-Vertex）live 路径没跑过
- Spec §8 四个人工端到端场景（A 查失败并重跑 / B 发现新实验 / C Deny / D 链式上限）待 Vertex 配额恢复后人工跑一遍

## [0.3.0] — 2026-04-28 · Copilot Glass System

把 copilot 模式的 UI 统一成 4 档玻璃设计系统（Thin / Regular / Thick / Tinted）。目标：打开 copilot 是一种"模式切换"，不是局部改色 —— 中间内容区整体切到玻璃语言，左右 chrome 保持 shadcn 扁平。

### 新增

- `src/components/copilot/shell.tsx` — 4 档玻璃（`GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted`）+ `useGlassStyle(variant)` hook
- `src/lib/segmented.ts` — 统一选中/激活态 design token `segmentedItem(active, copilotOpen)`，支持 copilot 开/关两套样式
- `--copilot-accent` CSS 变量（sky blue `oklch(0.76 0.16 225)`）—— 专用"发光"信号色，避开项目 `--primary` 的暗褐色
- 可访问性降级（`prefers-reduced-transparency` / `prefers-contrast: more` / `prefers-reduced-motion`）
- `copilot-scroll-edge-top/bottom` 软边 mask 工具类
- JSX display helpers：`helpers.glassStyle(variant)` + `helpers.glassAttr(variant)`，让用户自建 display 兼容 copilot 态
- Button `variant="tinted"` —— 会感知 copilot 态的 primary CTA

### 变更

- Dashboard / experiments / compare / settings / detail 页的所有内容卡 + 外壳迁到 Glass 组件
- Copilot glow 合并 idle/busy 色度（打开就一直"活的"，busy 只是动画更快）
- 浮层（Dialog / Select / 自建 popover）在 copilot 开时自动玻璃
- Compare sticky 表头 + StickySaveBar 加 scroll-edge mask

### 明确不玻璃（故意）

- Sidebar（左 chrome）—— 永远扁平
- Copilot panel 自身（右 chrome）—— 永远扁平
- Panel 内控件（session list / chat button / textarea）—— 永远扁平
- Toast / agent-hint 通知 banner —— semantic 色码信号优先

### 文档

- `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md` —— 完整设计 spec，含 Apple HIG + MD3 权衡
- `docs/superpowers/plans/2026-04-28-copilot-glass-system.md` —— 12-task 实施计划 + 首轮验证后 5 处调整

## [0.2.0] — 2026-04-27 · Copilot（sidebar AI 助手）

内嵌右侧对话面板，能看到用户屏幕上的东西，准备后续直接代用户改模板 + 触发重跑。

### 新增

**Panel + 会话 + 流式**
- Slide-in 面板（360–720px 可 resize），pin 在右侧
- 会话 CRUD + fork 分支（基于 jsonl append-only + prune-descendants）
- 流式对话（OpenAI + Anthropic SSE 归一化）
- `copilot_enabled` 模型白名单 flag
- ⌘K 开关 / ⌘Enter 发送 / Esc 关闭 / sidebar 自动折叠

**Share Context + Inspector**
- Chrome DevTools 风格元素圈选（Inspector mode）
- 彩色蒙层 + 数字徽章 + 右上角 × 移除（ContextMask）
- 9 种已知 context 类型（experiment / task_result / task_field / text_selection / template / dataset / display / rubric / rubric_stats）
- 划线选中文本 → "+加入 Copilot" 胶囊；常驻高亮重建（TextSelectionMask）
- Context 祖先链（ancestor chain）：`within: task_field:X → task_result:Y → experiment:Z`
- `/api/copilot/contexts/resolve` 批量 resolver + LLM-facing markdown system message
- Stale context 视觉：fade + strikethrough + `!` 警告
- "预览 LLM 将看到的 context" 按钮（markdown 渲染）

**液态玻璃 + UI 打磨（首代 shell）**
- `<CopilotShell>` / `<GlassSurface>` 包装器（0.3 用 4 档系统替代）
- 光晕（`.copilot-glow`）—— 双层 radial gradient 漂移，点击 spawn 光点融入
- Chat 底部重排：model picker + send 按钮同行，kbd 内联
- 可展开 textarea（右上角 expand 按钮，3 → 18 行）
- Fortune v4 display 全面挂 `task_field` 颗粒度
- Compare 对比页 cross-card context 消歧（elementKey 带 `experiment_id` 前缀）

**测试**
- 151 vitest 单测全绿（含 shell / session-store / context-registry / resolve-context）
- 9 e2e smoke 全绿

## [0.1.0] — 2026-04-26 · Evalyst 核心平台

通用 LLM prompt 批量评测平台。四件套（Model / Dataset / TaskSchema / Display）+ Rubric / Annotation，全文件存储，无数据库。

### 平台能力

- LLM 模型列表（OpenAI / Anthropic 双协议归一化 `llm-client.ts`，每模型独立 `pricing` 设置）
- 数据集（JSONL / JSON / CSV 三种上传，`papaparse` 带字段类型推断）
- 评测任务（TaskSchema）：结构化 form + 10 种 transform op + 5 种 filter kind；`{{var}}` 占位 + 条件块 `{{#cond}}...{{/cond}}`
- 实验：批量执行 + 断点续跑 + 单条 retry + per-currency cost 聚合
- 展示模板：自动推断（`single-list` / `dual-list` / `triple-grid` / `bubble-overlay` / `json-default`）+ 用户 JSON 自建（`table` / `grouped_grid` / `jsx`）
- 评分系统：Rubric 定义（pass_fail / likert_1_5 / score_0_100 三种 criterion）+ Annotation append-only + 聚合
- 实验对比页（跨实验按 input_refs 对齐）
- Claude Code skill 集成（平台级 `evalyst` + 资源级 `evalyst-dataset` / `evalyst-task`），下载入口 + 页面引导

### 技术栈

Next.js 16 App Router (Turbopack) · React 19 · TypeScript · shadcn/ui v4 · Tailwind CSS v4 · next-themes · 自建轻量 i18n · `@babel/standalone` 浏览器 JSX 编译 · vitest · Playwright

### 测试 + CI

- 110 vitest 单测（纯函数）
- Playwright E2E smoke（9 case，覆盖每条路由 + skills 下载端点）
- GitHub Actions 两 job：`verify`（tsc → lint → test → build）+ `e2e`（Playwright + 失败上传 HTML report）

---

## 约定

- **功能开发走 feature branch + PR**（见 `CONTRIBUTING.md` §提交流程）
- Commit 前缀：`feat(x):` / `fix(x):` / `refactor(x):` / `docs:` / `chore:` / `test:`
- 每个 version 对应一个 git tag；细节见 Releases 页
