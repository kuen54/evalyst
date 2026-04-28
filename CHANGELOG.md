# Changelog

按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格记录。版本号是松散里程碑，不是 semver —— 这是一个持续演化的工具，不是承诺 API 稳定的库。

每个版本对应的 git tag 见 [Releases](https://github.com/kuen54/evalyst/releases)；每个条目的 commit 范围可以在 `Compare <prev>...<this>` 里看到完整 diff。

---

## [Unreleased]

### UI polish（PR #5）

- **卡片线条统一 1px**：`GlassCard` / `GlassCardThin` 的 `SHADCN_CARD_DEFAULTS` 去掉 `ring-1 ring-foreground/10`（原来 border 1px + ring 1px 视觉 2px）；清掉 6 处 `GlassRegular` 手工叠加的 ring-1（experiments/[id] 进度卡、settings/datasets/[id] ×2、settings/templates/[id]、display/dataset form preview）。失败任务卡自然只剩红 border
- **Copilot 背景光更轻柔**：`.copilot-glow::before` 6s → 18s、`.copilot-glow-flow` 7s → 22s，`data-state="active"` 3s/4s → 11s/13s；昼/夜共用 keyframes，轨迹完全一样，只是改慢
- **点击 spawn 不再突然变深**：`copilot-glow-spawn` opacity 峰值 0.9/0.72/0.55 → 0.4/0.34/0.28，radial color-mix 55% → 32%，和 baseline 同档亮度

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
