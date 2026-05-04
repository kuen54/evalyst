# Changelog

按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格记录。版本号是松散里程碑，不是 semver —— 这是一个持续演化的工具，不是承诺 API 稳定的库。

Tag 打在特性**稳定且短期不再改**的点上（不是每次 PR merge 都打）。Polish 迭代应攒到 `[Unreleased]` 里，整合后再一起 tag。详细规范见 `AGENTS.md` §Tag + 版本号 / §CHANGELOG 规范。

每个版本对应的 git tag 见 [Releases](https://github.com/kuen54/evalyst/releases)；每个条目的 commit 范围可以在 `Compare <prev>...<this>` 里看到完整 diff。

---

## [Unreleased]

## [0.7.1] — 2026-05-04 · 实验详情页性能清扫 + Anthropic Bearer gateway

Playwright 驱动的两轮实验详情页优化（PR #26 + #27），把重实验下 config Collapsible 的 click-to-paint 从 169ms（含 151ms long task）砍到 14ms（0 long task），-92%。守住 copilot 玻璃一致性 —— round 1 曾把 `GlassCard` → `Card` 拿来省 backdrop-filter 成本，round 2 被用户纠正后全部回退，改用 `startTransition` + `useMemo` 等纯 React 手段达到更好效果。顺手加一条 LLM client 的 Bearer gateway 适配（PR #25）。

### 体验（最终态）

- **config / scoring / FailedPanel Collapsible**：三处 `onOpenChange` 包 `startTransition` → Collapsible 状态切换变 non-urgent transition，click-to-paint 关键路径只剩 state 提交；`contain: layout paint` 在 CollapsibleContent 和 Collapsible 外层保底切反流传播
- **ViewComp 不再每次 toggle 都 diff 104 项**：`viewBundle`（schema/display/view/ViewComp 派生链）+ `resultsNode`（`<ViewComp />` 节点）抽 `useMemo`，父组件因 `configOpen` 状态变更重渲染时 React element 引用稳定，跳过 ~2K 虚拟 DOM diff
- **Running polling 增量化**：原来每秒盲拉 `experiment + progress + results`，results 单次 547KB；改为每秒只拉 `experiment + progress`，仅在 `completed_tasks / failed_tasks` 变化时增量拉 results。空转秒从 547KB 降到 ~10KB
- **其他 memoization 清扫**：`statsAgg`（原在 early return 之后每次 render 跑 `aggregateResults`）上移 `useMemo`；`FailedPanel` 外层 `React.memo` + 内部 `failed` `useMemo`；`handleRun / handleRetryTask / handleStop` 改 `useCallback`
- **prompt 源码 `<pre>`**：抽 `ExperimentPromptPreview` `React.memo` 子组件，不随父 state 重渲染

### 架构

- **LLM client**：`buildApiRequest` 的 Anthropic 分支支持 `Authorization: Bearer` 网关场景 —— `api_key` 以 `"Bearer "` 开头时切到 `Authorization` header 不再发 `x-api-key`；官方 Anthropic API `sk-ant-...` key 行为不变。美团 `aigc.sankuai.com/v1/anthropic/v1` 这类 gateway 可直接用。PR #25
- **`/api/experiments/[id]/results`**：加 `?exclude=field,field` 顶层字段裁剪参数，默认不改向后兼容。当前 polling 改动暂未用，留给前端后续按需瘦身

### 验证

- Playwright 实测：config Collapsible toggle 5 次稳定 **12-21ms / 0 long task**（vs baseline 169ms / 151ms long task）
- 6 维深度 debug（D1 代码 re-review / D2 重实验完整回归 / D3 Rubric scoring / D4 状态边界 / D5 跨页面 smoke / D6 copilot context）全过，0 runtime error
- 全套回归：tsc + vitest 376/376 + build + e2e smoke 10/10（copilot-v2.spec 冷编首次偶发 flake，retry 稳）

### 注意事项（教训）

- **禁止拿 `GlassCard → Card` swap 换微性能**。round 1 里那处 swap 破坏了跨 Collapsible 的玻璃视觉一致性，被用户纠正后在 round 2 全部回退。perf 优化必须用 containment / memo / transition / lazy mount 等非视觉手段。细节见记忆 `feedback_glass_over_perf.md`

- Report: `docs/perf-report-2026-05-03.md`

## [0.7.0] — 2026-05-03 · Copilot v2：上下文 + 工具系统重构

从"一次性 context 注入 + 硬编码 4 工具"重构为"progressive disclosure：system prompt 恒定小 + LLM 按需 tool 拉详情"。三个参考 repo（claude-code-best / hermes-agent / openclaw）综合借鉴，但不做 subagent / 跨 session 记忆 / MCP / 可插拔 ContextEngine（主动划边界避免过度设计）。

- **Tool system**：`ToolDescriptor` + metadata + manual array registry（`src/lib/copilot/tools/`）。每工具一文件；`isDestructive` / `requiresConfirm` / `maxResultSizeChars` / `isReadOnly` 四字段元数据驱动 Confirm gate / 落盘护栏 / micro-compact
- **Hooks**：`preToolCall`（confirmGate + auditLog）+ `postToolCall`（payloadGuard + telemetry）。Confirm 完全从 UI 搬到 metadata，runTool 主入口串链
- **Tool result 护栏**：超 `maxResultSizeChars` 的 output 自动落盘到 `data/copilot/tool-results/{sid}/{tr_xxx}.json`，transcript 只留 500 字 preview + `ref://tool-result/tr_xxx`。`ToolResultContent` = inline | ref | compacted 三态 union；`normalizeToolResult` 读时兼容老 jsonl（裸 JSON string 包装成 inline），`data/copilot/sessions/` 不需要迁移
- **Context 分层**：`SystemHeader` 只放 `route_type + path + active_contexts[{id, type, ref, summary, within}]`，LLM 看到 `ctx_N` 后按需调工具拉详情。原 `formatContextsForLlm` 的 markdown context 墙 + page snapshot 全部退出 system prompt，snapshot 留服务端 `snapshot-cache`
- **3 个新 read 工具**：
  - `read_context(id, scope?)` — 查用户圈选过的 ctx_N，`scope=self|parent|full` 按需升级（task_field parent 带整条 task）
  - `read_resource(type, id, fields?)` — 顺藤摸瓜查用户没圈但需要的资源（experiment/template/dataset/display/rubric），支持字段子集裁剪
  - `read_tool_result(ref)` — 按 ref 回捞落盘的大 tool output
- **Aggregation**：`read_experiment_results` 加 `group_by` (`error_type` / `score_bucket` / `task_id`) + `aggregate` (`count` / `pass_rate` / `avg_score` / `sample_ids`) + `filter` (`score_lt` / `score_gte` / `error_contains`)，让工具内置聚合代替主 LLM 遍历原始数据
- **Micro-compact**：`build-llm-messages` 组装前跑一次，老的可重放（read-only）tool_result 压成 `{kind:'compacted', summary, ref?}`，保最近 3 条；cache 前缀稳定，10 轮对话不再因老 tool_result 撑爆上下文
- **第一个写工具 `edit_template`**：`isDestructive: true` 自动走 Confirm；shallow-merge patch 到 schema，version 自动 +1。验证 metadata → Confirm → hook → 落盘全链路
- **UI 规格调整**：
  - 删除 "预览 LLM 将看到的 context" 折叠面板（v2 LLM 不再看这段 markdown，保留会误导）
  - Chip 本身可展开看详情（懒调 `/api/copilot/contexts/resolve`，component state 缓存），`×` 保持独立 remove 按钮
  - `tool-call-card` 按 tool name 路由 variant：`context` / `resource` / `retrieval` / `write` / `default`，写操作带 amber 边框 + "写操作" badge，`read_resource` 的 type/id 可点击跳详情页
- **JSON 语义截断**：`truncateJsonSemantic`（搬自 hermes `_truncate_tool_call_args_json`），预留给 tool args / preview 防 provider reject
- **破坏性 / 迁移**：**无**。既有 `data/copilot/sessions/*.jsonl` 的 `tool_result.content`（裸 JSON string）被 `normalizeToolResult` 读时包装为 `{kind:'inline', value:...}`；`role: 'tool_use' | 'tool_result'` 保留不动。老会话零改动继续可用

### 测试 / 验证

- 新增约 100 test case（vitest 265 → 364）：types / truncate / registry / hooks / runTool / tool-result-store / read-tool-result / system-header / resolve-context-by-id / read-context / read-resource / read-experiment-results aggregation / micro-compact / build-llm-messages（v2 三 kind + header + compact）/ edit-template / metadata-client-sync
- E2E smoke `e2e/copilot-v2.spec.ts`：root HTTP 200 + 无 pageerror + `/api/copilot/sessions` 正常 + 预览面板不存在
- 全量：`tsc --noEmit` + 364 vitest + 27 路由 build + 1 playwright chromium，全绿

### 参考来源对照

- 借鉴：claude-code-best `buildTool` + `toolResultStorage` + `microCompact` + `useCanUseTool`；hermes-agent `_truncate_tool_call_args_json` + `session_search` 聚合精神；openclaw `before/after-tool-call` 钩子位
- 不做：subagent / AgentTool、跨 session 记忆（四类 taxonomy）、MCP 生态、ContextEngine 可插拔、`autoCompact` 全量 summary、四源权限矩阵、FTS5 session 搜索、Active Memory + LanceDB

- Spec: `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`
- Plan: `docs/superpowers/plans/2026-05-03-copilot-context-tool-v2.md`

## [0.6.0] — 2026-05-02 · audit cleanup M1-M5：核心重构 + 约定对齐 + race fix

2026-05-01 的系统性代码审计定位到 19 条 finding（必须改 3 / 值得改 6 / 可以不改 / 不要改）。本版本把"一周全面"路径的 9 条 + 一条 regression 过程中捞到的 chained tool UX race 全部清掉，分 6 个 PR（#18-#23）落地。

### 约定对齐 / 用户侧（M1 · PR #18）

- **F1** `refactor(fs)`：6 个 fs 存储模块（`store / rubric-store / seed / displays / datasets / schema/user-schema-store`）的顶层 `const XXX_DIR = path.join(process.cwd(), ...)` → 惰性函数 `xxxDir()`。对齐 AGENTS.md §测试约定 + 已有正确范例 `llm-config.ts` / `annotation-store.ts` / `copilot/session-store.ts`
- **F2** `i18n(copilot)`：`context-mask.tsx` 硬编中文 "移除" 走 `t("copilot.context_remove_title")`。zh + en 成对加 key
- **F3** `docs`：CLAUDE.md（3 处）+ README Q&A 测试数字 110 → 221（反映实际 vitest count）
- **F7** `feat(llm-client)`：OpenAI `Authorization` header 自动加 `Bearer ` 前缀（`startsWith("Bearer ")` 保留已有 workaround 值），新增 4 条 `buildApiRequest` 单测
  > **破坏性候选**：明确不要 Bearer 的 OpenAI-compat gateway 会开始失败。实测 Sankuai AIGC 网关接受 Bearer 前缀（既有用户配置 + M5 批量跑 + copilot 工具调用全链路通）。如有需求开 issue 加 `ModelConfig.auth_no_bearer_prefix`
- **F9** `docs(readme)`：删 "开源前会补 token 机制" 过期 footnote，改成当前现状（跨网暴露自己加反代）

### 纯函数测试补完（M2 · PR #19）

- **F8** `test(template-builder)`：给 `form-state.ts` 270 行纯函数加 `__tests__`，30 cases 覆盖 empty helpers + `parseEqualsValue` 5 种输入（间接）+ `buildSchemaFromForm` happy path + 10 条 validation 分支 + `formFromSchema` + **round-trip 幂等**（`formFromSchema(buildSchemaFromForm(f).schema!) === f`）。217 → 247（+30）

### Copilot 架构重构（M3-M4 · PR #20-21）

- **F4** `refactor(copilot)` · 抽 `runToolAwareLlmStream` helper：新 `src/lib/copilot/stream-response.ts`（158 行）封装 "调 callLlmStreaming + 累 text/tool_use + 后置按顺序 appendMessage"。`/chat/route.ts` 207 → 131（−76），`/tool-result/route.ts` 275 → 186（−89）。逐字保留 [0.4.0] 的 5 条 PR-3 race fix（appendFileSync 原子 append · controller.enqueue 流关后抛 try/catch · tool_use 落盘先于 emit done · abort signal 透传 · serializeMessagesForProvider alternation 合并）
- **F5** `refactor(copilot)` · `chat-view.tsx` 拆分：812 → **300** 行。新 `use-chat-stream.ts`（497 行）= SSE 解析 + messages state + send/confirmTool/denyTool/deleteMessage/editUserMessage；新 `context-chip-rail.tsx`（113 行）= 圈选按钮 + chip 行 + preview 面板。toast / i18n 通过 props 注入 hook（`onError` + `tI18nXxx`），hook 内不 import sonner / useT —— 解耦 + 未来可测

### Batch-runner 机制替换（M5 · PR #22）

- **F6** `refactor(batch-runner)`：`BatchRunner.run` 从 "N workers × while-loop × running counter × 100ms polling × 二段收尾" 换成标准 Promise pool（`inFlight Set + Promise.race + Promise.all`）。314 → 306 行。保留 100% byte-identical：`stop()` + resume 分支 + 精准 retry (`taskIds` filter) + 每 task 完成 `writeProgress` 节奏 + 最终 `paused`/`completed` status + `executeTask` + `globalThis.__activeRunners` 单例/HMR

### UX race fix（PR #23）

- **observed during M3 regression**：实时流 Copilot tool use 的 Confirm/Deny 按钮会 stale disabled，直到刷新页面才恢复
- **根因**：`useChatStream` 的 `done` handler 在 `setMessages` 的 functional updater 里读 `streamToolUseOrderRef.current`，updater 外紧跟着清 ref。React 19 concurrent 下 updater 可能在 commit 阶段异步运行 —— 此时 ref 已 = `[]` → for-loop 零迭代 → tool_use 的 `m.id` 永远不回填 → `persistedOnServer: false` → 按钮 disabled。Page reload 从服务端拉真 id 才恢复
- **Fix**（14 行）：capture-before-mutate —— 先同步把 ref 值捕获到 local snapshot 再清 ref；updater 用 snapshot

### 验证

- vitest：217 → 251（+34，F7 +4、F8 +30）
- tsc：clean · build：全 27 路由产出正常 · e2e smoke：9/9
- lint：45 问题全部 pre-existing（CI `continue-on-error`，本轮未引入新问题）
- 手动回归：M3 tool chain 3/3（normal chat / auto-run read / confirm-or-deny）· M4 chat-view UI 5/5（session load / input expand / send / edit user msg / chip rail）· M5 单条 retry + pause→resume 3/3 · UX race fix 实测修复前 `confirmDisabled:true` / 修复后 `confirmEnabled:true,denyEnabled:true` 立即可用

### 文档

- Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md`
- Plan: `docs/superpowers/plans/2026-05-01-audit-cleanup-m1-m5.md`

### Pre-existing 观察（非本版本引入，留记录）

- `completed_tasks` 可能超 `total_tasks`：experiment schema 版本变更导致 task_id 格式改变时（如 `X_user_pref` ↔ `box:X|user:Y`），resume 后老 `completedIds` 不匹配新 tasks → 新 task 全 pending → counter 超 total。batch-runner 初始化段 M5 完全没动，这是 PR-3 时代数据迁移缺陷
- Lint 45 问题：`react-hooks/set-state-in-effect`（i18n provider / 多数 pages 的 loadData effect / material-reveal-overlay 等）+ `transform.ts:72` `Unused eslint-disable directive`。ESLint 9 升级后更严格的 hooks 规则命中，CI 目前 `continue-on-error`

## [0.5.7] — 2026-05-01 · audit cleanup：reduced-motion uniform snap + dead code

v0.5.6 ship 后做的一轮系统性 debug 捡到的四个 finding。

### Reduced-motion 行为修正（a11y）

`applyThemeCascade` 之前在 `prefers-reduced-motion: reduce` 下 early-return 不设 `data-theme-cascading` flag。后果：
- Glass card 仍走 inline 320ms transition（useGlassStyle 提供的 baseline）
- Chrome（body / aside / main）没有 transition → snap
- 两者节奏不同，违反 spec 决策 15"uniform snap for reduced-motion"

**Fix**：reduced-motion 下依然设 flag，只跳过 delay 计算。`@media (prefers-reduced-motion: reduce)` 规则此时匹配，`transition: none !important` 覆盖 glass inline transition 和 chrome crossfade → 两者都 snap，一致。

test case 同步更新："prefers-reduced-motion: sets flag but writes no delay (uniform snap via reduced-motion media rule)"。

### 代码清理

- **Dead CSS variable** `--copilot-wave-core-light`：v0.5.3 引入给浅色 wave peak 用，v0.5.6 浅色 wave 整体 `display:none` 后 declaration 成了唯一引用点。删除
- **Stale comment block** 在 `globals.css` 498 行附近描述已删除的浅色 9-stop wave gradient 结构。删除
- **`applyThemeClass` doc** 提"给 View Transition callback 用"是 v0.5.4 v1 遗留（View Transitions API 当时被放弃）。改为描述 theme cascade 的 pre-transition class toggle 用途

### 验证

- vitest 217/217 green
- tsc clean, build ok
- Playwright 实测 panel animation `animationDuration: 0.68s`、light/dark 模式 wave display:none/block 正确、cascade delay 21 张卡全部写对
- Dev console: 0 errors / 0 warnings

## [0.5.6] — 2026-05-01 · Copilot 打开 + 主题切换的时序打磨（panel 弹性更明显 / 白天去扫光 / 主题 cascade 对齐 reveal）

v0.5.5 hotfix cascade 后用户三条打磨反馈：

### 1. Panel 弹出更明显：450ms → 680ms

`.copilot-panel-enter` 动画时长从 450ms 拉到 680ms，仍走 easeOutExpo 无 overshoot。更"有实体感"的弹出 —— panel 内容不再"一闪就位"，用户能读到弹入轨迹。

其它配套动画（wave 起步 200ms、reveal cascade 首元素 750ms、glow 8s）全部保持不变 —— 它们相对 click 原点的绝对时序仍然合理：wave 在 panel 移动中段出现、reveal cascade 首元素紧跟 panel 落位（delta ~70ms）。

### 2. 白天模式关扫光

浅底扫光多轮 tuning（accent → off-white → wave-core-light 砍 chroma）仍然读作"饱和"或"幽灵"。接受浅底 screen-blend 扫光天然不适合，**彻底在 `:root:not(.dark)` 下 `display: none` `.copilot-reveal-wave` + `.copilot-reveal-tail`**。Dark 模式扫光不动。

Reveal Cascade 的 glass card R→L ripple **不依赖** wave overlay（是独立 CSS transition），所以浅底 panel 打开仍有"每张卡翻面"的感知，只是没有上面那条扫光。

### 3. 主题 cascade 起步加 offset（短停顿后起 ripple）

Copilot 开态切主题时，glass card stagger 全部加 **300ms offset**，让"点击 → cascade 启动"有一个可感知的小停顿：

- 旧公式：`stagger = clamp([0, 1400], (startVw - cx) / 100 * 1400)` → 最右卡 0ms 起跑
- 新公式：`delay = 300 + clamp([0, 1400], (startVw - cx) / 100 * 1400)` → 最右卡 300ms 起跑
- 最左卡最晚到 1700ms 起跑
- cleanup timeout 2000ms → **2300ms**（offset 300 + max stagger 1400 + duration 320 + 280 buffer）

（首轮 tune 给过 750ms 对齐 reveal cascade 首元素，实测读作"等太久"，降到 300ms）

节奏感：点击主题 → 300ms 短停顿 → R→L ripple 从最右起，约 2s 内完成。

### 测试

- vitest：`cascade.test.ts` "copilot open" case 更新 — rightmost 从 0ms 改 750ms、leftmost 从 1050ms 改 1800ms；217/217 tests green
- Playwright 实测：computed `transitionDelay` 按位置落在 [0.925s, 1.528s] 的 observed range，offset 生效

## [0.5.5] — 2026-05-01 · hotfix：theme cascade CSS 从 globals.css 挪到 inline `<style>` 绕过 Turbopack 吞规则

v0.5.4 ship 后用户报"copilot 开态中间区域没有 R→L cascade"。排查发现：

**Turbopack/LightningCSS 静默吞了 globals.css 文末追加的 Theme cascade section**——compiled `.next/dev/static/chunks/...css` 里 0 条匹配 `theme-cascading` 的规则，尽管上面 reveal cascade（结构几乎完全一致）正常。JS 层 `applyThemeCascade` 写 `--theme-cascade-delay` 和 flag 都对，但 CSS override 规则根本不存在，所以 computed `transition-delay` 全是 `0s`。

同一失效模式 v0.5.4 v1（View Transitions API）踩过：LightningCSS 1.32 遇到某些它不完全理解的规则会直接 drop 整块，无 warning。

**Fix**：把 3 条 cascade CSS 规则（glass shorthand override + chrome 320ms + reduced-motion）搬到 `src/app/layout.tsx` 里 `<head>` 的 `<style dangerouslySetInnerHTML>`，绕开整条 CSS pipeline。规则内容零改动，只换注入路径。

- `src/app/layout.tsx` 新增 `THEME_CASCADE_CSS` 常量 + `<style>` 标签挂 `<head>`
- `src/app/globals.css` 原 Theme switch cascade section 替换为引导注释指向 layout.tsx

### 验证

- vitest 217/217 green（helper 逻辑未变）
- Playwright 实测：点主题按钮后 `--theme-cascade-delay` 正确写到每张 glass card，computed `transitionDelay` 读出 `0.646s / 0.235s` 等 stagger 值，`transitionTimingFunction: ease-out` 确认 CSS override 规则匹配并赢得优先级
- 目视 R→L ripple 在 copilot 开态可见

## [0.5.4] — 2026-04-30 · 主题切换 cascade（glass 镜像 reveal + chrome breathing）

> **Note (2026-05-01)**：该版本 ship 时 cascade 在运行时实际不工作（Turbopack/LightningCSS 静默吞了 globals.css 里的 cascade 规则）。**git tag `v0.5.4` 已删除**；首个实际可用的 cascade build 是 v0.5.5。条目保留作为设计/实现的历史记录。

v0.5.3 deferred、v0.5.4 v1（View Transitions API）被放弃（视觉是"扫描线"不是"每元素自己变"）后的第三次尝试。回到 element-level CSS transition 路线——但这次**镜像已经在产稳定的 reveal cascade 机制**做 glass 卡片，同时给非 glass 大块背景（body / aside / main）加一条无 stagger 的 breathing crossfade，整体有呼吸感。

### 体验

- **copilot 关**：所有 glass card 以 0 delay 同步 320ms transition；body / sidebar / panel bg 同步 320ms crossfade —— 一次全屏统一 crossfade，glass 和 chrome 同节奏
- **copilot 开**：glass card R→L 错峰 stagger 0-1400ms（复用 reveal cascade 公式）；body / sidebar / panel bg 同时走 320ms 无 stagger crossfade —— 前景 card 依次翻面 + 背景同时快速到位

### 架构

- `src/lib/theme/cascade.ts` 新增 `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()`
  - 关态：只设 `html.dataset.themeCascading="true"` flag；不写 delay（全 0）
  - 开态：遍历 `[data-glass-variant]`，按 x 位置 + `panelPx` 换算 `(startVw - cx) / 100 * 1400` clamp [0, 1400] 写 `--theme-cascade-delay`
  - `prefers-reduced-motion: reduce`：不写 delay、不设 flag → 调用方仍 class swap 但无动画 scope
- `src/components/sidebar.tsx` `cycleTheme` 重构：`applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 2000)`；`cascadeTimeoutRef` 防连点残留；unmount useEffect 清 timeout + DOM flag
- `src/app/layout.tsx` **移除 `disableTransitionOnChange`** from `<ThemeProvider>`——它注入 `<style>* { transition: none !important }</style>` 吞所有 transition；初次加载 flash 由 next-themes inline script（正交机制）保护，无影响
- `src/app/globals.css` 新增两段：
  - Glass rule：镜像 reveal cascade 结构（完整 shorthand + delay var + 5 个 property + !important）
  - Chrome rule：body / aside / main 320ms crossfade，无 stagger（和 glass baseline 同节奏）

### Tuning

首轮 smoke 后根据反馈调整：
- 关态：chrome 500ms → **320ms**，和 glass 同步。原设计有意"breathing"差节奏，用户反馈感到刺眼；统一更干净
- 开态：glass stagger 上限 1000ms → **1400ms**，R→L 节奏更缓，陈列感更明显
- cleanup timeout 1500ms → **2000ms**（max delay 1400 + duration 320 + 280 buffer）

### 相对 v0.5.3 + v0.5.4 v1 的定位

| 尝试 | 方案 | 结果 |
|---|---|---|
| v0.5.3 | Element-level + stagger + shorthand override + **`*` 全选** + 遇 `disableTransitionOnChange` 吞 | 失败：cleanup flicker + paint 风暴 |
| v0.5.4 v1 | View Transitions API + clip-path wipe/radial | 被放弃：视觉是"扫描线" |
| v0.5.4 v2.1 | Glass 镜像 reveal cascade + chrome breathing crossfade + 删 disableTransitionOnChange | 当前方案 |

**关键修正**：
1. Scope 从 `*` → `[data-glass-variant]`（glass）+ 手写 4 个 chrome selector；不再扫全页
2. 删 `disableTransitionOnChange`——v0.5.3 的第二个根因
3. Chrome 独立 crossfade，避免"card stagger / 背景 snap"割裂感

### 测试

- vitest: `applyThemeCascade` + `clearThemeCascade` 4 case（关态 / 开态 / reduced-motion / 幂等 cleanup）；`applyThemeClass` 4 case 继承
- 全量 217/217 tests green；tsc + build 通过
- 手动 checklist：Chrome 关态 / 开态 × 3 cycle + reduced-motion bypass

### 归档

- v0.5.4 v1（View Transitions API）完整代码 + spec 保存在 `archive/theme-view-transitions` 分支；PR #12 closed 不合并

- Spec: `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-theme-cascade.md`

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
