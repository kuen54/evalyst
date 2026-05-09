# Changelog

按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格记录。版本号是松散里程碑，不是 semver —— 这是一个持续演化的工具，不是承诺 API 稳定的库。

Tag 打在特性**稳定且短期不再改**的点上（不是每次 PR merge 都打）。Polish 迭代应攒到 `[Unreleased]` 里，整合后再一起 tag。详细规范见 `AGENTS.md` §Tag + 版本号 / §CHANGELOG 规范。

每个版本对应的 git tag 见 [Releases](https://github.com/kuen54/evalyst/releases)；每个条目的 commit 范围可以在 `Compare <prev>...<this>` 里看到完整 diff。

---

## [Unreleased]

## [0.10.0] — 2026-05-09 · 评测平台进入多模态：生图评测 v1 + Copilot × Image Vision (PR #52–54)

evalyst 此前是 text-in / text-out 的 LLM 评测平台。v0.10.0 把多模态纳入一等公民，分两个互补子系统打通端到端：

- **生图评测 v1（PR #52）** — 让平台能跑 text-in / image-out 模型。LLM client 提取 `message.images[]`，batch-runner 落盘到 `data/results/{exp}/images/`，`image_url` schema 类型 + `<ImageLightbox>` UI + HEIM 5 题 seed rubric + 三件套 seed（数据集 / schema / rubric）。参考 gateway：sankuai `aigc.sankuai.com/v1/openai/native` + `gemini-3.1-flash-image-preview`。
- **Copilot × Image Vision（PR #53 + 修复 PR #54）** — 让 Copilot 能"看见"那批生成的图。圈选含图 task_result / task_field → 至多 5 张图（按 URL dedupe）以 base64 内联进 user message multimodal content；3 层 vision 防御（model picker + chat route 入口校验 + build-llm-messages 兜底 strip）；Anthropic 序列化器修复 data URL → `source.type='base64'`。

设计目标：manual 评测全链路（auto-eval VLM-as-judge / pairwise ranking / 专用 reward model 留 v2）。OSS 调研借鉴 Stanford HEIM `ImageCritiqueMetric` 5 题（alignment / subject_clarity / aesthetic / originality / safety）。图像存盘走 HEIM / T2I-CompBench filesystem-path 风格，JSONL 永远只存 `/api/results/.../images/...` 绝对 URL。

### 体验

- **生图（Image Generation）评测 v1 完备支持** — text-in / image-out 评测端到端。
  - LLM client：扩 `LlmResponse.images?`，`parseResponse` OpenAI 分支提取
    `choices[0].message.images[]`（OpenRouter / sankuai 等 gateway 约定的
    非标字段）。请求侧零改动（沿用 `api_format='openai'`）
  - 图像存储：data URL 解码 → `data/results/{exp_id}/images/{task_id}_{idx}.{ext}`，
    JSONL 里只存绝对 API URL `/api/results/{exp_id}/images/...`
  - Schema：`JsonFieldType` 加 `image_url` / `image_url_list`，validate 跟上
  - UI：全局 `ImageLightboxProvider` 挂 RootLayout；`renderField` image case
    走 `<ClickableImage>` → 点击进 Lightbox；RubricAnnotator 弹窗 image 类
    schema 自动展示双栏 preview
  - 三件套 seed：`image_prompts_v1` 数据集（20 prompt × 5 类别）+
    `image_gen_v1` schema + `image_quality_v1` rubric（HEIM 5 题改编）
  - Skill 文档：`evalyst` + `evalyst-task` 加生图章节
  - 验证：sankuai `gemini-3.1-flash-image-preview` 实跑通，5 单测组 +
    1 e2e smoke

- Spec: `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-image-generation-eval.md`

### Copilot × Image Vision

让 Evalyst Copilot 在用户圈选含图 task_result / task_field 时真正"看见"图像。视觉评测闭环（"为什么这张图主体偏左"、"对比 #1 和 #2 哪张更清晰"）从被迫复制图链接到另开 Claude Code 网页，变成圈选 → 自然语言反馈 → 编辑 prompt template → 重跑实验。

#### 体验

- **圈选驱动的视觉对话**：含图 task_result（声明 `image_url` / `image_url_list` 字段）或单独的 image task_field 被圈选时，最多 5 张图（按 URL dedupe）以 base64 内联进 user message multimodal content array
- **3 层 vision 防御**：(1) ModelPicker 隐藏非 `vision_capable` 模型并显示 amber warning；(2) chat route 入口校验；(3) `build-llm-messages` 兜底 strip 图块 + 注入 system note `[Image attachments dropped: model not vision_capable]`
- **`vision_capable` 模型标记**：`/settings/llm` 一行 checkbox；旧 config 默认 undefined（≈ false），无需迁移
- **Chip 缩略图**：context-chip-rail 展开时识别图像 URL（`/api/results/`、`data:image/`、http(s) 图片扩展名）→ 渲染 120×120 缩略图，点击进 `ImageLightbox`
- **超额提示**：圈超 5 张图时 system note `{n} image(s) not attached (per-turn cap is 5)`

#### 架构

- **新模块** `src/lib/copilot/image-attach.ts`：`collectImageRefs`（schema-aware + heuristic + dedup + cap=5，用户优先 vs 工具优先）+ `readImageBytes`（fs.readFile + base64 + path traversal 防御 + mime-by-ext）+ `extractImageRefsFromOutput`（tool 复用助手）
- **单点改造** `build-llm-messages.ts`：sync → async；新 `materializeImagePlan` 把圈选 refs → multimodal blocks；user message 重写为 `[(text,image)*N, text(原内容)]` 数组；其余链路（stream-response）只跟 await 一下
- **Anthropic 序列化器修复**：`source.type='url'` 不接 data URL；新 `imageBlockForAnthropic` helper 检测 data URL → `source.type='base64'` + parsed media_type；HTTP URL 走 `source.type='url'`。`llm-client.ts`（非流式）+ `llm-stream.ts`（流式）两条路径都覆盖
- **工具 forward-compat**：`read_experiment_results` / `read_context` / `read_resource` 的 output 在含图 schema 下挂 `_attachments: ImageRef[]`；`payloadGuardHook` 把 `_attachments`（值层带下划线）提到 `ToolResultContent.attachments`（wrapper 层无下划线）；落盘自动 round-trip
- **结果组件 task_field 注入** `field_type`：`single-list-results` / `dual-list-results` / `triple-grid-results` 6 处 callsite，让 chat-view 能算 `imageContextCount` 决定 ModelPicker 是否 require vision

#### v1 选项 A 限制

工具返回的 `_attachments` 在 v1 **不进入 LLM 多模态消息**（`build-llm-messages` 不消费 `tool_blocks_by_call_id`）。原因：
- Task 0 探针发现 sankuai OpenAI-compat 拒绝 `image_url` in `tool` role 消息（"An 'image_url' 'content' object element is unsupported for a(n) 'tool' message."）
- Anthropic 协议 user/assistant 严格交替，无法在 `tool_result` 后追加 `user` 消息携带图

LLM 只在用户**主动圈选**时看到图——这是用户主诉求的核心场景。"让 LLM 自驱看一批图整体评估"这种用例延后到 v2，等 sankuai 解禁或做 provider-specific 分支（Anthropic 内嵌 / OpenAI 用户消息追加）。Tools 仍发 `_attachments`、payloadGuardHook 仍 lift——翻一个 `if` 即可启用，零下游改动。

#### 测试

- 新增 ~7 组 vitest（image-attach × 2、build-llm-messages.image、llm-stream.anthropic-data-url、llm-client.anthropic-data-url、hooks.attachments-lift、read-context.image / read-experiment-results.image / read-resource.image），约 35+ case
- 既有测试全绿；`tsc --noEmit` / `build` / `e2e smoke` 均通过
- 手动 checklist 留给 PR merge 前/后真机跑（含 sankuai claude-sonnet vision_capable=true 实跑）

- Spec: `docs/superpowers/specs/2026-05-09-copilot-image-vision-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-copilot-image-vision.md`
- Branch A→B finding: `docs/superpowers/plans/findings/2026-05-09-tool-result-content-array.md`


## [0.9.4] — 2026-05-09 · Copilot 架构 polish + loop detector 回归防御 (PR #50–51)

v0.9.3 ship 后做了一轮**子系统级 code audit**（架构 / 模块边界 / 循环依赖 / 大文件拆分 / 重复代码 / 死代码 / 注释 drift / 类型一致性 8 维度并行 review），发现 1 个 audit 误报 + 7 条结构性 polish 候选。本版没有功能变更，只是把 v0.9.3 ship 后捞到的"架构小债"清掉，让 v0.9.x 后续如果再加 feature（parallel tool dispatch / streaming partial recovery / token cap 遥测）时基础更稳。

### 回归防御 (PR #50)

- **`tool-loop-detector.isFailure()` 对 v2.5 P2 ToolError shape 加 2 条回归测**：audit 报告该函数不识别 `{ ok: false, error: { code, message } }` 形态。实测发现因为 `"error" in obj` 仍命中（key 名相同），audit 是 false alarm —— **生产代码无需改**。但加 2 条测当未来防御：万一某轮重构收紧了 `isFailure` 的 shape 检测，连续 5 次 INVALID_INPUT/NOT_FOUND 不被识别为失败这条 regression 会立刻被捞到。`tool-loop-detector.test.ts` 17 → 19 cases。

### 架构 polish (PR #51)

7 个独立 commit，每个 1 task：

- **B1 切循环依赖** `material-reveal-overlay ↔ store`：抽 `applyRevealCascade` / `clearRevealCascade` 到 `material-reveal-cascade.ts`（无 React 依赖纯 DOM 模块），overlay 文件只 import store 读 `lastOpenedAt`，store 只 import cascade 函数。`madge --circular src/components/copilot/` 从 1 cycle → 0 cycle。
- **B2 修层级违规**：`src/lib/copilot/use-page-context.ts` 是 lib/ 唯一 `"use client"` + import `@/components/copilot/store` —— 违反"lib 不应反向依赖 components"约定。`git mv` 到 `src/components/copilot/use-page-context.ts`，16 处 caller import path 同步更新。零行为变化。
- **B3 拆 cache-stats-store.ts 三件套**（348 行 → 3 个文件，单向依赖链）：
  - `cache-stats-store.ts` 留 jsonl io + appendCacheStat / readCacheStats / pruneCacheStats + `CacheUsageStat` type
  - 新建 `cache-aggregate.ts`：aggregateCacheHitRate / countRecentBreaks
  - 新建 `cache-break-detect.ts`：detectCacheBreak / detectCacheBreakWithReasons / collectRecentBreakReasons / findLatestBreakPair / 6 个 digest+preview helpers + extractSystemPromptString + 全部 BreakReason / BreakInfo / BreakPair types
  - 收益：未来加 per-session token cap 遥测时新 reducer 进 `cache-aggregate.ts` 不再撑大 store；break detection 模块独立后扩 reason 维度（如未来加 model digest）也不影响 io 层
- **B4 修 stale tools 测试断言**：`tools.test.ts:67` 和 `registry.test.ts:30` 都断言 "the 4 migrated tools" 但实际 9 个工具。合并到 `registry.test.ts` 一处 `expect(names.sort()).toEqual([...9 tool names].sort())`，删 `tools.test.ts` 冗余 4-tool 段。
- **B5 收敛 RunToolResult 'denied' kind 进 'error'**：4 kind union 实际是 3 kind 语义（`'denied'` 仅来自 `confirmGateHook` deny，唯一 caller 立即包成 `USER_DENIED` ToolError）。`confirmGateHook` 改成直接返 `{ kind: "error", error: { code: "USER_DENIED", retry_safe: false, ... } }`，删除 `RunToolResult.kind = 'denied'`。3 kind 收尾更干净，新 caller 写 dispatch 不容易漏分支。
- **B6 抽 streamSseResponse helper**：`/chat` 和 `/tool-result` route 各 ~50 行 SSE 脚手架（`ReadableStream` + `write` 吞 controller-closed + done emit + error catch + headers）完全重复。新建 `src/lib/copilot/sse-response.ts` 统一封装，两 route 只写各自的"前置校验 + initialEvents + startParentId 选择"。race-fix 注释（"客户端已 abort / 流已关时 controller.enqueue 会抛 ... 吞掉"）挪到 helper 内同一处。
- **B7 删 `truncateJsonSemantic` 死代码**：17 行函数 + 6 个测试 case，源注释承诺"防止 LLM 产出过长参数把 provider 拒掉"但 `runTool` 全链路无 caller。git 历史保留可恢复，未来若要接入 pre-hook（按 `truncateInputFieldChars` metadata 配额）可从 commit 5d4b3cd 反向 cherry-pick。

### 测试 / 验证

- 全套 614/614 pass（基线 621 − 6 [B7 删 truncate 测] − 1 [B4 合并 stale 断言] + 0 [PR #50 也是 +2 但同一基线] = 614）
- `npx tsc --noEmit` 0 error / `npm run lint` 0 新 warning / `npm run build` success
- `madge --circular --extensions ts,tsx src/components/copilot/` reports **0 cycles**

### 不动（充分理由）

audit 还点了 4 处大文件 / 5 处对称重复 / 3 处独立 path.join 但都判定**不动**：`llm-stream.ts` (671 行) 两 provider parser 共享 `ToolUseState.index` 状态机拆开反增 import 边界；`use-chat-stream.ts` (573 行) 5 个 ref 都是 race-fix 关键路径（PR-3 调试轮次专门修过）；`resolve-context.ts` (467 行) per-type case 已委托 manifest shaper 复杂度被 cap；`store.tsx` (344 行) 多 context 引入 N×N 订阅协调反不如单 context + memo。

### 关于 v0.9.4 这个版本号

v0.9.4 是顺序递增的版本号，不代表"v0.9.4 feature work"已经做。gap 分析推荐的三件 P1 feature（parallel tool dispatch / streaming partial recovery / per-session token cap 遥测）**当前判定不必做**——v0.9.3 已把"看得见的体验缺陷"清干净，三条 P1 没有"现在卡住用户"的痛点。等真撞到痛点再回来开 v0.9.5 / v0.10.0。

## [0.9.3] — 2026-05-09 · Copilot v2.5 P1b/P2 · cache 观测进阶 + tool error recovery + per-route gating (PR #44–48)

v0.9.2 (P1a) 之后两批改动合一起打 0.9.3：前一批 P1b 完成 cache 观测层 + 存储卫生收尾；后一批 P2 三件事基于 v0.9.x 三 PR 后的 code review，把"二轮采纳"系列里漏掉的几条体验 gap 补齐 —— 用户看 cache break 不止知道哪类变了还能看到末尾 diff、LLM 看 tool error 按 enum 而非文案做决策、不同 route 暴露不同工具集减少 LLM 误调。

### Copilot (v2.5 P1b · cache 观测层 + 存储卫生 — PR #44)

基于 openclaw `prompt-cache-observability.ts:51` 6 break reason 设计调研，挑最实际 2 个落地：

- **systemPrompt + tools digest 检测 cache break 原因**：`CacheUsageStat` 扩 `system_prompt_digest` / `tool_digest` 两个 sha256 前 16 字符 digest 字段（每条 jsonl 多 ~70 字节，10K 条 ~700KB —— 半压 jsonl 自然碰撞）。`detectCacheBreakWithReasons` 在 PR1 P0 noise floor 基础上对比 digest，给出 `['system_prompt']` / `['tools']` / `['unknown']` reason 列表；旧 jsonl 行没 digest 时走 `'unknown'` 兼容分支。`/api/copilot/cache-stats` 的 `weekly` 段新增 `recent_break_reasons`；chip tooltip 在 `recent_breaks > 0` 时按 reason 分类展示，让用户一眼看出"上次 break 是改 system 还是动了 tools"。openclaw 另外 4 个 reason（model / retention / transport / streamStrategy）对单 provider 单 session 用不上，故意不抄。
- **`cache-stats.jsonl` startup retention**（30d + N=10000 双阈值）：`pruneCacheStats` 删 ts > 30 天的行（含 malformed JSON）+ 行数 > 10K 时额外从头 trim 到 5K（保最近暖数据）；走项目 `writeAtomic` helper 原子 tmp+rename 写。Next.js `instrumentation.ts` 启动钩子调用一次（`NEXT_RUNTIME === 'nodejs'` 守卫，try/catch warn-swallow，启动失败不挂服务）。避免评测平台跑久了 jsonl 积几十万行拖慢 chip fetch。

新增 25 测试 case：`cache-stats-store.test.ts` 18（digest helpers 8 + detectCacheBreakWithReasons 6 + collectRecentBreakReasons 3 + appendCacheStat round-trip 1）+ `cache-stats-prune.test.ts` 7 新文件。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p1b-cache-break-detection-retention-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p1b-cache-break-detection-retention.md

### Copilot (v2.5 P2 · cache break diff 工具 — PR #46)

P1b 已经能识别"system_prompt 变了"或"tools 变了"，但 tooltip 只能告诉用户"哪一类变了"，定位不到"具体哪几个字符"。本 PR 在 `CacheUsageStat` 加 200 char preview 字段，break 时 tooltip 直接展示 prev/curr 末尾片段对比。

- **`CacheUsageStat` 扩 preview 字段**（`system_prompt_preview` / `tool_preview`，optional，旧 jsonl 行 graceful undefined）+ `computeSystemPromptPreview` / `computeToolPreview` helper（末尾 200 char）+ `findLatestBreakPair` 反向扫最近一对 break。
- **`appendCacheStat` 调用点同步写 preview**（`stream-response.ts` 与 digest 一对落盘）+ `/api/copilot/cache-stats` 的 weekly 段加 `latest_break_pair` 字段。
- **chip tooltip diff 展示**：命中 `system_prompt` / `tools` reason 时追加 before/after 两行（前缀 `...` 标记是末尾片段），4 个新 i18n key（zh + en 成对）。

新增 16 测试 case；`tool_preview` 极端长（>200 char）也走 200 char 截尾保上限，避免某 tool 名特别长 + 工具数多时 tooltip 行炸。

### Copilot (v2.5 P2 · per-route tool gating — PR #47)

把"每次请求塞全部 9 个 tool schema"改成按 `route_type` 动态 gating：

- **按 route_type 暴露工具子集**（新文件 `src/lib/copilot/tools/route-gating.ts`）：5 个 always 工具（`read_context` / `read_resource` / `read_page` / `read_tool_result` / `list_experiments`）+ 按 route 增量。`experiment_detail` / `compare` 加实验工具；`settings/templates` 加 `edit_template`；`settings/datasets` 加 `read_dataset_records`；其余 route 仅 always 集。pageContext 缺失或未识别 route_type 时 fallback always 集，不破。
- **stream-response.ts 调用点 wire**：chat + tool-result 两处 `runToolAwareLlmStream` 传 `visibleToolsForRoute(TOOLS, route_type)` 替代全量 TOOLS；`pageContext` 参数本身不变（gating 只过滤 advertise 的工具数组，不影响 SystemHeader 渲染）。
- **预期行为变化**：（1）LLM 在 dashboard 看不到 `edit_template`，避免误调；（2）跨 route 切换会自然破 cache（tool_digest 变 → P1b chip tooltip 显示 reason='tools'）—— 这是预期，spec §6 说明；同 route 内多轮对话 cache 持续 hit（P1a 4-breakpoint cache 主要受益场景）。

新增 18 测试 case：`route-gating.test.ts` 14 unit + `route-gating.integration.test.ts` 4 integration（dashboard / experiment_detail / template_detail / unknown route 在 Anthropic + OpenAI 两 provider 下 outgoing body.tools shape）。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p2-per-route-tool-gating-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p2-per-route-tool-gating.md

### Copilot (v2.5 P2 · tool error recovery — PR #48)

基于 v0.9.x 三 PR 后的 code review，修正"LLM 看 tool error 全靠 message 文案 prompt"的脆弱性，把 ad-hoc error 路径升级成结构化 contract：

- **结构化 ToolResult contract**（新文件 `src/lib/copilot/tools/tool-result.ts`）：tool 推荐返 `{ ok: true, value } | { ok: false, error: { code, message, hint?, retry_safe? } }`。9 种 ToolErrorCode 标准化（`INVALID_INPUT / NOT_FOUND / UNAUTHORIZED / CONFLICT / RATE_LIMIT / NETWORK / USER_DENIED / AWAITING_CONFIRM / INTERNAL`）。LLM 行为按 enum 而非文案 prompt，更稳定。
- **runTool 兼容封装**：旧 tool（直接返 raw / throw Error）继续 work；throw 兜底成 `INTERNAL` 错误。新 tool 鼓励显式 `ok()/err()` helpers。`RunToolResult` 加 `kind: 'error'`。`isToolResultShape` 收紧到 `ok===true && 'value' in obj` 或 `ok===false && error 是 object`，避免 legacy fixture `{ ok: 1 }` 误判。
- **Anthropic `is_error: true` 协议透传**：`LlmMessage.tool_result` 加 optional `is_error?: boolean`；`build-llm-messages` 用 `isToolErrorShape` 在 inline kind 检测时设字段；`serializeAnthropicNonAssistant` 在 tool_result content block 透传。让 Claude/Sonnet 一眼分清 success vs failure。OpenAI 路径不动（协议无该字段）。
- **7 个 tool 的 input validation 改 explicit err()**：`restart_experiment / read_resource / edit_template / read_dataset_records / read_tool_result / read_experiment_results / read_context` 入口 throw 改 `err('INVALID_INPUT' | 'NOT_FOUND', msg, { hint })`。成功路径 `ok()` 包装。业务 throw（fs read 失败 / loadPersistedToolResult 找不到 ref 等）保留兜底成 INTERNAL。
- **`/tool-result` route handler 简化**：去 try/catch 和字符串拼接（`'tool denied by server hook:'`），按 `RunToolResult.kind` dispatch；error 路径统一 `{ ok: false, error: { code, message, hint?, retry_safe? } }` 形态。`USER_DENIED` / `AWAITING_CONFIRM` 用 `as const` 窄化保留 ToolErrorCode 联合类型。P0 tool-loop-detector 逻辑（warn/block + loop_warn SSE）零变动。
- **ToolCallCard error 渲染**：red alpha tinted 表面（`bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300`，遵循 AGENTS.md 轻量 tinted 表面约定）+ `[CODE] · 中文标签` + 可选 Hint + 可选 retry_safe 小标签（amber alpha）+ `role="alert"` for screen readers。`parseToolError` helper 兼容 3 种 jsonl 形态（new ok/false / 旧 deny / 旧 ad-hoc），ErrorRender 在 5 个 variant（Default / Context / Resource / Retrieval / Write）的 toolResult 分支早返回。

新增 ~38 测试 case；全套 583 → 621/621 pass（rebase 后基线含 PR #47 per-route gating 测试）。

向后兼容：ToolDescriptor.call 返回类型扩 union，旧 tool 不改也 work；jsonl 旧形态（`{ error: msg }` / `{ denied: true }`）由 `isToolErrorShape` 全 cover，UI 由 `parseToolError` 解析后走 INTERNAL / USER_DENIED 显示；`LlmMessage.is_error` optional，OpenAI 序列化按 falsy 不带，Anthropic 网关 `is_error: true` 是 GA 字段。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p2-tool-error-recovery-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p2-tool-error-recovery.md

### Cleanup (PR #45)

v0.9.2 ship 后 code review 捞到的 4 条小瑕疵：删 `detectCacheBreakWithReasons` 内 `if (!prev)` 死代码、`extractSystemPromptString` 加 4 个 edge case 单测、`llm-stream.ts` 内联 `AnthropicBody` cast 换成 import type、`tool-result-store.ts` preview budget 注释统一标注（19 sep + 100 tail = 519 worst-case）。无功能变更。


## [0.9.2] — 2026-05-08 · Copilot v2.5 P1a · Anthropic 4-breakpoint cache_control + head+tail preview (PR #43)

基于 v0.9.0 ship 后对 hermes `prompt_caching.py` 和 `context_compressor.py` 的深入调研，把"cache 播放流核心"两条改动合进 v2.5。

### 体验

- **Anthropic 4-breakpoint cache_control**（hermes `prompt_caching.py:41-72` system_and_3 策略）：在 `buildStreamingRequestBody` 的 anthropic 分支后置 mutate 请求 body，给 `system` 尾 + 最后 3 条 `messages` 尾 content block 注入 `cache_control: { type: 'ephemeral' }` 5m TTL。native Claude / Bedrock / Sankuai Anthropic gateway 三个 provider 共享 api_format='anthropic' 分支。**Sankuai/Bedrock 实测验证**（aws.claude-opus-4.6 via `/v1/anthropic/v1` Bearer）：3 轮真实对话从 0% 涨到 **本 session 25% · 近 7 天 7%**，cache_creation/cache_read 在 message_start 都按预期落非 0；网关接受字段不返 4xx。OpenAI 分支零影响（integration test + server-side probe 双重验证 body JSON 不含 `cache_control` / `ephemeral` 字符串）。
- **Tool result preview head+tail 双端夹**（hermes `context_compressor.py:692`）：`maybePersistToolResult` 的 preview 从 `slice(0,500)` 改成 head(400) + `\n...[truncated]...\n` + tail(100)，总 budget 不变（≤519 字符）。**用户感知**：错误 stack 的 root cause（常在末尾）保留，LLM 多数场景不再需要回捞 `read_tool_result` 看 error 字段，少一轮调用。

### 测试

- 新增 20 测试 case：`anthropic-cache-control.test.ts` 13（system 各形态 / 最后 3 条 / 4-breakpoint 上限 / 幂等 / 各 content shape / 空 content 防御）+ `tool-result-store.test.ts` 5 新（含 error stack tail 关键 regression）+ `llm-stream-serialize.test.ts` 2 integration（Anthropic body 含 cache_control / OpenAI body 完全无）；全套从 500 涨到 520 case
- Playwright 实机 E2E 三组：Anthropic 3 轮 cache hit rate（25%）/ OpenAI 防回归（双分支 console.log probe 计数 0 vs 2）/ head+tail preview 在 ToolCallCard pre 渲染长度 602（519 双端夹 + 83 ref footer）

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p1a-anthropic-cache-control-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p1a-anthropic-cache-control.md

## [0.9.1] — 2026-05-08 · Copilot v2.5 P0 二轮采纳（CCB / hermes / openclaw）+ loop detector hotfix (PR #41–42)

基于 v0.9.0 ship 后对 CCB / hermes / openclaw 三 repo 原代码的深入调研，对 v2.5 参数和机制做 4 处修正；外加 manual regression 时捞出的 loop detector 与 v2.5 M2 compact_boundary 联动 bug。

### 修正

- **approxTokens 分三层分岔 + image 补偿**（CCB `tokenEstimation.ts:227` + hermes `context_compressor.py:65`）：JSON content `÷2`、中文 heavy(>30% CJK) `÷1.5`、其他 `÷4`；每张图片 url 补偿 1600 tokens。修复 `microCompact maxTotalReplayableTokens=4000` 在 JSON tool_result 上被低估 2 倍的漏洞。
- **aggregateCacheHitRate noise floor**（openclaw `prompt-cache-observability.ts:51`）：drop ≥ 1000 tokens 且 ratio < 0.95 才算 break。chip 新增 `· N breaks` 段（仅 >0 时显示），hover tooltip 解释 noise floor。
- **session_deny_list 对称到 alwaysAllow**（CCB `alwaysDenyRules` + openclaw allow-once/always/deny UI）：Deny 卡新增 "Always deny in this session" checkbox。confirmGate 优先级 deny > allow > 默认 confirm；客户端 `use-chat-stream` 镜像 alwaysAllow 的 line 242 auto-run，加 `pendingAutoDenyRef` 自动 deny 队列，让 UI label 真正生效。
- **chain cap 机制从硬数步 5 换成 hermes 三档重复检测**（`tool_guardrails.py:71`）：原硬 cap 移除，替换为 exact-failure 2/5、same-tool 3/8、no-progress 2/5 的 `analyzeToolLoop`。新增 `SystemNoticeBubble` UI（panel 扁平 + 轻量 alpha tinted amber/red）渲染 warn / block 提示。**用户感知**：以前 4 次 read_context + 1 次 edit 撞 429 的情况现在 proceed；新增"重复失败 / 无进展" block 场景。

### Hotfix

- **loop detector 跨 v2.5 M2 compact_boundary**（PR #42）：上面的 `analyzeToolLoop` 在产线上实际**不会触发**——`/tool-result` POST 时 `branchBefore` 末端是 hanging tool_use（result 还在算），且 v2.5 M2 microCompact 在每个 tool_result 后插一条 `system_compact_boundary`，原 `collectTrailingPairs` 见到这两种结构都会 break。修：先跳过末尾 hanging tool_use / system，找到第一个 tool_result 再扫；扫描中间 hop over system 消息。assistant / user text 仍然打断扫描（intentional：策略变更）。手动 Playwright 回归（同参数 read_resource 连失 5 次 → 3 条 amber SystemNoticeBubble 顺序渲染）证明 hotfix 后端到端 ok。

### 测试

- 新增 30+ 单测 case + 1 integration test + 4 真实 branch 形态 case；全套从 462 涨到 500 case，1.5s 跑完
- Manual regression 6 项全过：deny UI / allow UI / loop warn / loop block 结构 / cache chip / approxTokens 间接

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md

## [0.9.0] — 2026-05-08 · Copilot v2.5 · context 收敛 + compact_boundary + cache 遥测 + alwaysAllow (PR #37–40)

Copilot v2 合进来之后第一个大的演进：三条独立 minor 子系统（context 默认收敛 / transcript 硬边界 + cache 遥测 / 会话级 alwaysAllow）合一起打 0.9.0，加一个 soak 测试捞出来的 Sankuai/Bedrock cache 字段 fix。整体目标是把 copilot 从 v2 的"能用"推向"好用"——上下文默认不泄漏、长对话不无限增长、重复确认有跳过开关。

### 架构

- **Copilot v2.5 M1：默认 context 收敛 + read_dataset_records 工具 + microCompact token 阈值**

  v2 的 context 处理是"默认全 dump"——圈选 / `read_page` / `read_context` 三条路径直接把 `GenericResultRecord` / `TaskSchema` / `Display` / JSX 源码原样塞给 LLM；导致 chip preview 一展开就是 5KB JSON，激进会把上下文窗口压满。v2.5 M1 把默认形态从"全 dump"换成"≤300 chars manifest"，按需取详细数据走专用工具。
  - **manifest 化**：抽 `src/lib/copilot/manifest.ts` 公共纯函数（7 个 shaper：experiment / task_result / task_field / dataset / template / display / rubric），`resolveContextSelf` / `resolveContextById` / `read_page` 三条路径共用调用。`input_preview` / `default_prompt` / JSX 源码 / `notes` / `prompt_template` / `api_config` 默认不再泄漏
  - **新工具 `read_dataset_records(dataset_id, task_id?, limit≤20, offset)`**：read-only，`maxResultSizeChars=8000`。`task_id` 走 `dataset.id_field` 单条快路径；`limit/offset` 分页；`limit` 默认 5 max 20
  - **`microCompact` 加 `maxTotalReplayableTokens`**（build-llm-messages 默认 4000 tokens）：双阈值——最近 N 条 + 累计 token 反向遍历 break。防御 3 条 read_resource 各 5KB inline 的累加场景。`undefined` 时回退老行为（数量阈值 only），向后兼容
  - **划线降权**：Inspector 模式下 TextSelector 关闭（`enabled = open && !inspectorActive`），删 inspector-overlay 的 drag-select 让位 4 行——互斥后无需让位。`text_selection` chip 主语换成 `text in {hostType}#{hostId}`，文本变副语；展开面板拆三段（context chain / selected text / context anchor）+ 指向 `read_context(ctx_N, scope='parent')` 拉完整字段值

- **Copilot v2.5 M2：CompactBoundaryMessage + cache 遥测**

  v2 是"transcript 永远向前组装"——每轮 LLM 调用都把整条 active branch 喂回去，相当于线性增长。M2 加了硬边界（boundary 之前的消息默认不参与组装）+ provider 级 prompt-cache 命中率观测。
  - **Transcript 加 `role: 'system', kind: 'compact_boundary'` 消息**（`src/lib/copilot/boundary.ts`）：`microCompact` 完成且真有消息被压时，在当前 head 之后追加一条 boundary；`buildLlmMessages` 组装前先 `sliceAfterBoundary`，只看 boundary 之后的历史。老 session 无 boundary 时行为等价 v2 现状（`sliceAfterBoundary` 无匹配返原 branch 引用）
  - **`microCompact` 返 `{messages, didCompact}`**：仅 1 个生产 caller（`build-llm-messages.ts`），breaking 但测试调整成本可控；`didCompact` 是判定是否落 boundary 的唯一信号
  - **方案 A**（boundary 接 parent 链 + head 跟）：复用 `appendMessage` 的 `fs.appendFileSync` 原子 append + `updateSession` 原子写；多分支语义自然继承（不同分支各自的 boundary 链互不干扰）
  - **Cache 遥测**（`src/lib/copilot/cache-stats-store.ts`）：每次 LLM 调用抽 `cache_creation_input_tokens` / `cache_read_input_tokens`（Anthropic）+ `prompt_tokens_details.cached_tokens`（OpenAI / 兼容层），落 `data/copilot/cache-stats.jsonl`（append-only，独立于 `message.usage`，session jsonl 形态不变）；hit rate **按 provider 分桶**——Anthropic 分母 = `input + cache_read + cache_creation`，OpenAI 分母 = `input_tokens`（已含 cached）
  - **Chat-view 顶部新增 `CacheStatsChip`**：`本 session X% · 近 7 天 Y%`，10s 自动刷新，hover 原生 tooltip 看最近调用的 model + input + cache_read + cache_create 数字。0 calls 时不渲染。GET `/api/copilot/cache-stats?session_id=` 聚合返 `{session, weekly}`

- **Copilot v2.5 M3：会话级 alwaysAllow**

  v2 的写工具（`edit_template` / `restart_experiment`）每次调用都弹 Confirm 卡，节奏被打断。M3 给 Confirm 卡加一个"本次会话信任此工具"的 checkbox，勾选后该工具下次自动跑——只针对当前 tab + 当前会话，关闭 tab 即清，零持久化。
  - **新 `session-allow.ts`**：sessionStorage helper（client）+ 纯函数 `isSessionAllowed(allowList, toolName)`（client + server 共用）。key `evalyst-copilot-allow-${sid}` 存 `string[]` 工具名数组，per-tab + per-session
  - **Confirm 卡加 Checkbox**（`tool-call-card.tsx` WriteVariant）：`Props.onConfirm` 签名改 `(alwaysAllow: boolean) => void`；勾选 + 点确认 → `useChatStream.confirmTool` 先 `addSessionAllow(sid, tool_name)` 再发 `/tool-result`
  - **双层短路**：
    - **客户端（实际生效层）**：`use-chat-stream.ts` 的 SSE `tool_use_end` handler 在 `needsConfirm()` 处加 `|| isSessionAllowed(getSessionAllowList(sid), tool_name)`，命中直接 push 到 auto-run 队列，跳过 ToolCallCard 渲染
    - **服务端（防御层）**：`PreToolCallCtx` 扩 `session_allow_list?: string[]`；`confirmGateHook` 命中 allow list 直接 proceed；`/chat` 和 `/tool-result` body 都加字段透传
  - **spec §8.5 澄清**：spec 原文写"短路位置在 confirmGateHook"是理论描述；evalyst 当前架构 `/tool-result` `skipConfirm: true` 下 hook 是死代码，实际生效层在客户端。服务端层留好钩子给未来 `/chat` 内执行工具的架构升级（plan 偏差 #10）
  - **隐私默认**：sessionStorage（不是 localStorage / 不写 jsonl）→ 不跨 tab、不持久化、F12 可见可清；spec §8.6 明确不做 alwaysDeny / alwaysAsk / pattern 匹配
  - **e2e 自动化**：`e2e/copilot-v25.spec.ts` 覆盖 spec §10.3 两条断言——chip 展开看到 manifest 形态（`input_preview` / `input_refs` 不出现）+ cache hit rate chip 渲染（seed `data/copilot/cache-stats.jsonl` 后 chip 文字含 `%`）。另两条（active_contexts 不含 input_preview / alwaysAllow 勾选后不弹）需 mock LLM SSE，工程量过大留作手动回归

### Tuning / 修复

- **Sankuai/Bedrock Anthropic SSE cache 字段**（PR #40，打 tag 前 soak 测试捞出来）：Sankuai 走 AWS Bedrock 代理的 Anthropic SSE 和 native Anthropic 有两处差异——`input_tokens` / `output_tokens` 集中在 `message_delta.usage`（native 在 message_start），`cache_creation` 是嵌套对象 `{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}`（native 是扁平 `cache_creation_input_tokens`）。没这个 fix 之前 `claude-opus-4.6` 用户的 cache stats 永远全 0，chip 永远显示 `本 session —`。parseAnthropicEvent 两个分支都加了 nested cache_creation 的 sum；llm-stream-cache 测 4 → 6 cases 锁定

- Spec: docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md（§3 / §4 / §5 / §6 / §8）
- Plan: docs/superpowers/plans/2026-05-07-copilot-v25-m1-context-collapse.md（Task 1-22）

## [0.8.2] — 2026-05-08 · v0.8.1 "alpha 配方"规范尾扫 (PR #36)

v0.8.1 把 `bg-{color}-50` 一刀切成 alpha 配方后，尾扫剩下的幸存者。范围：两类位置——一是 AgentHintBanner 内部的 chip + download 按钮（v0.8.1 没看 banner 内部），二是 4 个 result 组件的失败格 border（v0.8.1 grep 只捞 `bg-X-50` 共现的，裸 border 漏掉）。零架构变更，纯 className 替换。

### 体验

- **暗色模式 polish 续集**：v0.8.1 收口的"alpha 配方"规范向其余幸存者扫尾。
  - `AgentHintBanner` 的 `<code>/evalyst</code>` chip 原用 `bg-background`，dark mode 下黄色玻璃卡里嵌一颗黑底深米粒；改 `bg-foreground/5` 既不抢色又能看清。同 banner 的「Download SKILL.md」按钮原 `border-amber-300 bg-background hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/30` 双轨写法收成 `border-amber-500/40 bg-card hover:bg-amber-500/15` 单轨
  - 4 处 result 组件失败格还留着裸 `border-red-200`（无 bg，不在 v0.8.1 扫描范围）：`single-list-results` / `json-default-results` / `bubble-auto-results` / `display-jsx` 的 fallback 卡。统一翻成 `border-red-500/40` 与新规范对齐 —— dark mode 下浅粉描边在暗玻璃卡上识别度低的小 bug 修了

## [0.8.1] — 2026-05-07 · v0.8.0 后五波 polish (PR #31–35)

v0.8.0 把 copilot 玻璃 UI 系统从 4 档重做成 9 档之后的一轮 polish —— 都是用户实测发现的"差一口气"的 visual bug，不改任何架构。内容涵盖：tinted CTA 可读性、Inspector hint 文案/居中/层级、sticky chrome 关态 fallback 扁平化、compare 两列贯穿布局 + sticky bleed 修复、暗色模式下轻量 tinted 表面统一规范。期间也收口了 2 条设计规范（"一页一个 tinted 名额"的续写 + 轻量 tinted 表面的 alpha 配方），防止后续位置再重踩同样的坑。

### 体验

- **暗色模式下 tinted 表面修复（badge / 错误格 / 软提示）**：Schema 徽章（dashboard 卡片右上角色标）+ compare 错误格（`error: fetch failed` 那种）+ JSON paste / template 表单里的红绿小提示框，过去一律用 `bg-{color}-50 border-{color}-200 text-{color}-700`，亮色模式下是柔和淡彩，**暗色模式下直接变成一块块刺眼的亮色贴纸**（底色 `*-50` 是近白 hex 常量，`dark:` 没兜底）。现在统一换成 alpha 配方 `bg-{color}-500/10 border-{color}-500/30–40 text-{color}-700 dark:text-{color}-300` —— alpha 叠在 `bg-card` 之上，两边模式下都柔和。顺手修掉 compare 错误格"关 copilot 更刺眼"的症状（原先 copilot 开时 GlassThin inline bg 覆盖了 className，关时 `bg-red-50` 接管）。CLAUDE.md / AGENTS.md 的 Glass UI 章节加小节「轻量 tinted 表面」明确规范，禁止后续新位置再写 `bg-{color}-50`
- **Compare 页两列贯穿 + 标题进左列**：`/compare` 原本顶部 "实验对比" 标题独占一行，左右两列从下面才开始切，左/右上角各空一大块。现在标题和左列折叠按钮并排放进**左列顶部**（折叠时一起隐藏），右列从大卡片最顶端开始（输入/V4-fortune-2/V4-fortune-1 sticky header 直接顶到顶），两列之间的竖向 border 一通到底。`GlassRegular` 去掉 `p-6`，padding 内移到两列各自，分割线贯穿整张大卡。信息密度 ↑、视觉重量 ↓
- **Compare 右列 sticky header bleed 修复**：PR34 把 padding 从外层 GlassRegular 挪到右列 `overflow-auto p-6` 后，sticky header 上方留了 24px 顶 padding 属于滚动区，滚动时内容从这 24px 缝冒到表头上方。copilot 开态被 chrome-up 的 blur + 投影糊成虚影还算正常；copilot 关态 fallback 到扁平 `bg-card`，header 只覆盖自身 box，缝透明，内容硬生生露出。现在右列 padding-top 跟 `useCopilotStore().open` 联动：关 → pt-0 顶到大卡顶无缝；开 → pt-6 让 chrome 浮在 24px 留白里，bleed 被 blur 接管成玻璃层级表现。transition-[padding] 300ms 同步 baseTransition
- **Sticky chrome 关 copilot 时回归 shadcn 扁平**：`GlassStickyHeader` / `GlassStickyFooter` 在 copilot 关闭态原本仍带 `rounded-xl`，配合 `bg-background border-t/b` 出现"半截药丸"——四角圆角但只有单边 border。现在 `rounded-xl` 收敛进 copilot 开态分支；关闭态变成 `bg-card border-{t,b}` 的直角扁平条（暗色下 `--background` 比 `--card` 深一档，与外层卡面错色，所以挑 card 与卡面齐平、只靠 border 划分）。影响：`/compare` 顶栏 + `/settings/**` 表单底部 StickySaveBar
- **Inspector hint banner 文案简化 + 中间内容区居中**：
  - 文案：「点击页面任意带下划线的区块把它加入 Copilot 视野；Esc 退出」→「点击页面任意区域和 Copilot 展开聊聊」
  - 位置：从相对 viewport 居中（`left-1/2`）→ 相对 `<main>` 居中（ResizeObserver 跟踪 main bbox 动态更新）。sidebar 折叠 / copilot panel resize / 窗口 resize 都会自动重算。不再因 copilot panel 占 420px 让 banner 往左偏
- **Compare prompt preview popover 层级上浮到 inspector 之上**：`PreviewCard.Positioner` z-index `50 → 10000`，在 context-mask (9996) / inspector hover 框 (9997) / inspector hint (9998) 之上。原来用户截图里"Prompt 模板"弹窗被已圈选的 task_field mask 盖住，现在修复
- **Tinted CTA 可读性修复**：`Button variant="tinted"` 在 copilot 开态下白天模式出现"白底白字"（`text-primary-foreground` 近白色 + 旧 tinted 配方 `card 30% + accent 22% gradient` 偏浅）。现在文字 fallthrough 到 `text-foreground`（自适应深/浅色），配方简化为单层 `accent 14% bg + accent 55% border + accent ambient shadow`，视觉和 `GlassSegmentedItem` active tab 完全对齐 —— 全局"主 CTA / active tab 都是同一种发光带"

### 架构

- `useGlassStyle("tinted")` 配方调整：去掉 `card 30%` 双层 + `accent 22% gradient`，改成单层 `accent 14% bg`；border `50% → 55%`；boxShadow accent ambient `30% → 40%`，inset 环 `20% → 25%`。和 `GlassSegmentedItem` active 视觉一致
- `Button` tinted class 加 `data-[copilot-tinted=on]:text-foreground` 让 copilot 开态文字自适应；`data-[copilot-tinted=on]:hover:bg-transparent` 防止 hover 时 `bg-primary/80` 破坏玻璃透明感
- `InspectorOverlay` 加 `hintCenterPx` state + ResizeObserver 跟踪 `<main>` 位置动态更新 hint banner 水平位置

## [0.8.0] — 2026-05-07 · Copilot glass system v2 (4 档 → 9 档 + 4 个 pattern 组件 + 主 CTA 规则)

PR #28 / #29 / #30 三轮把 copilot 玻璃 UI 系统从"4 档 + 一堆每处手搓的 inline style 三件套"重做成"9 档 + 4 个一等 pattern 组件 + 一条页面级视觉规则"。起因是用户发现 compare 表头和 StickySaveBar 的玻璃质感差（"边缘直角 / 字贴边 / 材质浑浊 / 缺 elevation / 缺边缘高光"），定位是档位选错 + 缺方向性投影 + mask fade 语义反，进而引出"还有哪些角色应该是 variant 但没有"的系统性扫描，最终拢合三波 PR 一次定型。

### 体验

- **Compare 页 prompt preview popup 修复被遮**：表头 hover info icon 的 prompt 弹窗从 `absolute z-50` 手写换成 `base-ui` 的 `PreviewCard`（portal 到 body + Floating UI flip/shift），逃出 sticky header 的 stacking context（Chromium 对 sticky + backdrop-filter 绘制顺序的 quirk）
- **Compare 表头 + StickySaveBar 升玻璃悬浮条**：原 `GlassThin + pb-3 / -mx-6 px-6 border-t bg-background + copilot-scroll-edge-*` 拼凑档位错；改用专用 sticky chrome 档（rounded / padding / 方向性阴影 / 切边高光 / 材质厚度）
- **Scoring / FailedPanel / AgentHintBanner 统一成"玻璃 + 语义"**：原"semantic 色 > 装饰 → 不玻璃"约定废除。三个语义卡都升玻璃档（`GlassSuccess` / `GlassDanger` / `GlassWarning`），配方 = Regular 材质 + 语义 border + 弱语义 ambient shadow。copilot 关态 fallback 到 shadcn 扁平
- **Segmented 控件 3 处视觉统一**：RelationDiagram / display mode picker / experiments/new task picker 原本各处手写 `useGlassStyle("thin/tinted") + segmentedItem(active, copilotOpen)` 三件套；现在都走 `<GlassSegmentedItem active render={...}>` 一行组件
- **评测任务表单吸底栏升玻璃**：`template-form-page.tsx` 原手写 `<div sticky bottom-0 bg-background>`（PR #28 漏扫），现迁移到 `StickySaveBar` 与 4 个其它表单一致
- **数据集表单内容不再溢出容器**：`grid-cols-[1fr_380px]` 在 copilot 开 main 变窄时把内容推出容器（`1fr` = `minmax(auto, 1fr)`，auto 下限 = 输入框 min-width）。改成 `minmax(0, 1fr)` 允许左列收缩
- **主 CTA 视觉分配规则**：约定"**一页一个 tinted 名额**"，`GlassSegmentedItem` active 项占名额，sidebar 硬编不占，互斥按钮共享名额。落地：dashboard 顶栏新建 tinted、空态 outline；experiment detail Run / Resume tinted；`/settings/**` 全部按钮保持 default（RelationDiagram tab 已吃名额）

### 架构

- **Copilot 玻璃梯度系统 4 档 → 9 档（6 primitive + 3 semantic）**：
  - 新 primitive 2 档：`chrome-up` / `chrome-down`（Regular 材质 + 方向性投影 + 方向切边高光）
  - 新 semantic 3 档：`success` / `warning` / `danger`（Regular 材质 + tailwind-500 oklch border + 弱语义 ambient shadow）
- **新 pattern 组件 4 个**：
  - `GlassStickyHeader` / `GlassStickyFooter`（`src/components/copilot/sticky-chrome.tsx`）：sticky 定位 + rounded + padding + copilot 开/关 fallback
  - `GlassSegmentedItem`（`src/components/copilot/glass-segmented.tsx`）：render prop 支持 button / Link / a，自动 thin ↔ tinted 切换
- **新 Card-style 组件 3 个**：`GlassSuccess` / `GlassWarning` / `GlassDanger`，由 `makeGlass(variant, SHADCN_CARD_DEFAULTS)` 工厂导出，和 `GlassCard` 同构
- **删 `copilot-scroll-edge-*` CSS 死代码**：mask 渐变方向相反于"悬浮"语义，被 sticky chrome 的 drop shadow 替代。两条 CSS + `prefers-reduced-motion` 降级 selector 一起清
- **`src/lib/segmented.ts` 瘦身**：copilot 开态分支搬进 `GlassSegmentedItem`，签名 `segmentedItem(active, copilotOpen)` → `segmentedItem(active)`。仅给 sidebar / session-list 这种"永远不走玻璃"的位置用

### 测试

- `getGlassStyleForVariant` unit test 从 5 个补到 10 个（chrome-up/down 切边高光 + 投影方向 + 3 档 semantic 的 border 色和 ambient shadow assert）
- 8 处调用点迁移：compare 表头、StickySaveBar、template-form 吸底、display-form / relation-diagram / experiments-new 三处 segmented、Scoring Collapsible / FailedPanel / AgentHintBanner 三处 semantic
- Playwright 两态实测：copilot 开态各 variant 配方正确；关态 fallback 到 shadcn 扁平
- vitest 376 → 381，e2e 9/10（既有 flaky `copilot-v2.spec.ts:12` 单跑通过）

### 文档 / 记忆

- CLAUDE.md §Copilot Glass UI 系统：4 档 → 9 档对照表 + 玻璃作用域规则更新（"semantic 可玻璃"例外）+ Segmented 选中态从 helper 描述改成 `GlassSegmentedItem` 用法
- AGENTS.md §玻璃档位选择：重写档位表覆盖 sticky chrome / segmented / semantic 三类组件化入口；新增 §主 CTA 约定（规则 + 占名额表 + 决策流）
- feedback memory `feedback_copilot_glass_scope.md`：原"amber banner 不玻璃"规则改成"semantic 可玻璃"；新增"sticky chrome / segmented / semantic 不手写三件套，用专用组件"规则；同步 `segmentedItem(active)` 新签名

- Spec: `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`
- 关联 PR: #28 (sticky chrome) / #29 (semantic + segmented) / #30 (polish-1)


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
