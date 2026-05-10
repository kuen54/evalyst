# Copilot V1 → V2 → V2.5 演进复盘

**日期**：2026-05-09
**版本范围**：v0.6.x（V1 末期）→ v0.7.0（V2 落地）→ v0.9.0–v0.9.4（V2.5 系列）
**关联材料**：[CHANGELOG.md](../CHANGELOG.md) · `docs/superpowers/specs/` 下 12+ 份 spec · 对应 plan

---

## 0. 演进时间线

```
                  ┌─ V1 时代 ────────┬─ V2 ──┬─── V2.5 系列 ────────────────────┐
                  │                  │       │                                    │
   v0.6.0  ─────  audit cleanup（架构/约定/race fix 收尾）
   v0.6.x  ─────  copilot 雏形（hardcoded + jsonl append-only）
                  │                  │
   v0.7.0  ─────  ★ Copilot V2：tool calling + 上下文工具系统重构
                                     │
   v0.9.0  ─────  ★ V2.5 M1+M2+M3：context 收敛 + boundary + cache 遥测 + alwaysAllow
   v0.9.1  ─────  V2.5 P0 二轮采纳（CCB / hermes / openclaw 三 repo 调研落地 4 条）
   v0.9.2  ─────  V2.5 P1a：4-breakpoint cache_control + head+tail preview
   v0.9.3  ─────  V2.5 P1b + P2：cache 观测进阶 + tool error recovery + per-route gating
   v0.9.4  ─────  子系统级 audit polish（架构小债 + loop detector 回归防御）
                  └────────┴───────────────────────────────────────────────────┘
                  2 个月：从「LLM RPC 调用器」到「协作 agent 子系统」
```

每个里程碑都不是凭空起的 —— v0.7.0 V2 是 PR-3 tool calling 引爆的协议化第一步；v0.9.0 V2.5 三件套是 V2 落地 1 个月后基于真实流量复盘；v0.9.1 P0 是 V2.5 ship 后再调研三 repo 原代码（不是只读 round-1 brief，是抓 GitHub 源码）发现"当时砍掉的不全对"；v0.9.2 v0.9.3 是 P0 上线后继续按真实使用反馈打磨；v0.9.4 是子系统体量到 14K LOC 后做一轮架构 audit 收小债。

---

## 1. V1 长什么样

### V1 模块架构（v0.6.x，约 5K LOC）

```
┌─ Copilot V1 模块架构 ──────────────────────────────┐
│                                                    │
│  API routes（app/api/copilot/）                    │
│  ┌──────────────────────────────────┐             │
│  │ sessions/.../chat                │             │
│  │ contexts/resolve                 │             │
│  └──────────────────────────────────┘             │
│                  │                                 │
│                  ▼                                 │
│  Lib 层（lib/copilot/）                            │
│  ┌──────────────────────────────────┐             │
│  │ session-store.ts (jsonl)         │             │
│  │ resolve-context.ts （全 dump）   │             │
│  │ build-llm-messages.ts            │             │
│  │ llm-stream.ts                    │             │
│  └──────────────────────────────────┘             │
│                                                    │
│  特征：                                            │
│  · 扁平 API 调用层，无 hook 系统                   │
│  · 无 metadata-first tool descriptor               │
│  · 无 cache observer                               │
│  · 无 transcript boundary                          │
│  · 无 alwaysAllow（每次写工具弹 Confirm）          │
│  · 无 per-route gating（工具列表不分场景）          │
│  · 无 chain cap 或硬数 5 步                        │
│  · 无结构化 ToolError（throw + 字符串）            │
│  · 无 progressive disclosure（圈选全 dump）        │
└────────────────────────────────────────────────────┘
```

V1 心智很简单：**LLM 是 RPC 端点**。messages 进、response 出，所有 context 管理靠用户脑补。

### V1 的痛点（用户视角）

**痛点 1 · 圈一下就是一坨 JSON**：圈选一个 task_result，chip 展开是整个 5KB `GenericResultRecord`（含 `input_preview` / `input_refs` / `output` / `metrics` / `model` 一堆元数据）。敏感字段（`prompt_template` / `notes` / `api_config`）默认全发给 LLM，token 成本承担了。

**痛点 2 · 聊得越久越慢**：每轮把整条 active branch 喂回去，10 轮后尾巴越来越长。cache 全靠 provider 5m 兜底，不显式 `cache_control`，Anthropic 实测 hit rate 长期 < 50%。第 5 轮之后明显变慢、input cost 线性增长。

**痛点 3 · 写工具节奏断**：每次让 LLM 改模板或重启实验都弹 Confirm 卡，10 轮里 5 次弹窗。session 级"我信这个工具"机制完全没有。

**痛点 4 · 错调死循环**：LLM 用错 id 调 `read_resource` 时只看到字符串 `{"error": "not found"}`，分不清是参数格式错还是资源真不在。可能换 5 个错 id 才放弃；当时只有硬 chain cap = 5 防御 —— 但正常 4 read + 1 edit 任务刚好撞 5 线被误 429。

**痛点 5 · 消费完全黑箱**：cache 这次命中没？这次贵在哪？改 system prompt 加一行字下次 cache 全断 —— 没数据说哪里破了。

### 当时为什么这样设计

V1 不是因为偷懒。当时 Anthropic SDK / Claude Code 还在快速演进，`cache_control` 是 beta 字段、`is_error` 还没 GA、ContextEnginePromptCacheInfo 风格的观测设计也还在 bleeding edge。**V1 时代的合理选择是「先做能用的 RPC 调用器」**——等真实流量跑出来、协议字段 GA、社区有了三 repo 这种参考实现，再升级到协议化层。

---

## 2. 三个先进 agent 各自的实现

调研 CCB / hermes / openclaw 这三个 repo 的时候发现它们其实在各自解决不同的问题，不能一锅炖。这一节只讲他们怎么做。

### CCB（claude-code-best）—— 渐进披露 + 元数据先行

CCB 的核心想法是：**LLM 不需要一开始就看全部数据，它知道自己缺什么会自己来要**。

具体怎么做的：

- **工具 metadata 决定一切**：每个工具自带 `isReadOnly` / `isDestructive` / `maxResultSizeChars` / `requiresConfirm` 这套元数据。Confirm 弹不弹、payload 落不落盘、result 怎么截断、是否参与 microCompact —— 全靠 metadata 驱动，不写在 UI、不写在 system prompt
- **大 payload 落盘 + ref 回捞**：超过 `maxResultSizeChars` 阈值的 tool output 落 `data/copilot/tool-results/{sid}/tr_xxx.json`，transcript 里只放 500 字 preview + ref URL。LLM 想看完整版自己调 `read_tool_result(ref)`
- **`SnipTool` / `CtxInspectTool` 让 LLM 主动管 context**：模型自己决定哪段历史不重要可以裁、哪个 context 节点要展开看
- **`ToolPermissionContext` 4 源矩阵**：policy / plugin / project / user 四级权限叠加，配 `alwaysAllow` / `alwaysDeny` / `alwaysAsk` 三选项
- **`autoCompact` 全量 summary**：长 session 触发条件后整体摘要 → 用 boundary message 切，老历史不再重发

**一句话**：让 LLM 当主体，不是当数据漏斗的下游。

### hermes（NousResearch/hermes-agent）—— 长跑不糊涂

hermes 关心的是另一件事：**多轮对话怎么保证 LLM 不慢、不忘、不死循环**。

具体三招（每招都有具体代码出处）：

- **`prompt_caching.py:41-72` 四 breakpoint cache_control**：73 行核心逻辑，无条件开。1 个 breakpoint 在 system prompt 末尾、3 个滚动放在最近 3 条非 system 消息上。Anthropic 协议 GA 字段，5m TTL，二次相同 prefix 请求 cache_read 直接命中。**他们不做 cost gate**——不看 hit rate 阈值再决定开不开，直接拿收益
- **`tool_guardrails.py:71` 三档失败检测**：替代硬步数 cap 的方案。
  - `exact_failure: warn=2, block=5`（同 `(toolName, argsHash)` 失败 2 次警告、5 次 block）
  - `same_tool_failure: warn=3, halt=8`（同工具任意 args 失败 3 次警告、8 次 halt）
  - `no_progress: warn=2, block=5`（同 args 成功但输出 identical，2 次警告、5 次 block —— 防 idempotent tool 反复打捞同 ref）
  - 哲学：**失败是模式**，模式比计数更准
- **`context_compressor.py:692` head+tail 双端夹**：长文本截断不只取 head。hermes 经验：error stack 的 root cause 常在末尾。head 4000 + sep + tail 1500，两头都保
- **`context_compressor.py:65 _IMAGE_TOKEN_ESTIMATE = 1600`**：每张图固定加 1600 tokens 估算
- **`microCompact` 双阈值**：原版用"时间 + token 双阈值"

**一句话**：LLM 跑长了别糊涂，cache + 错误 + 截断三件事都是显式协议，不靠运气。

### openclaw —— agent 行为可观察

openclaw 假设 agent 是个生产系统，**行为必须有数据**。

具体表现：

- **`prompt-cache-observability.ts:51` cache 命中率追踪**：每次 LLM 调用从 response 抽 `cache_creation_input_tokens` / `cache_read_input_tokens`（Anthropic）+ `prompt_tokens_details.cached_tokens`（OpenAI）落 jsonl
- **noise floor 防小抖动假阳**：`MIN_CACHE_BREAK_TOKEN_DROP = 1000` + `MAX_CACHE_BREAK_RATIO = 0.95` 双阈值，drop ≥ 1000 tokens 且 ratio < 0.95 才算 break。否则就是正常波动
- **6 种 break reason 检测**：`model / cacheRetention / transport / streamStrategy / systemPrompt / tools` —— digest 比对前后两次的不同维度，直接告诉用户"这次贵在哪"
- **`session-token-cap` 止损**：累计 token 超阈值 → emit system_compact_boundary + 拒绝下一轮 LLM call。防失控烧钱
- **`ToolPermissionContext` 4 源矩阵**：和 CCB 同一思路（独立设计）
- **`rewriteTranscriptEntries`**：持久化压缩 —— 历史消息可以 in-place 重写

**一句话**：别把 agent 当黑箱，命中率、break、token 都得能看见、能调。

---

## 3. 我们最终的设计

如果非要总结这三家的共性：从「LLM 是 black-box endpoint」到「LLM 是协作 agent」。具体到工程层面就是三个协议化：**上下文协议化、工具 contract 化、行为可观察化**。evalyst 在 v0.7.0 → v0.9.4 这两个月按这三条主线落地，不按版本拆，按主题整体讲。

### 模块架构（v0.9.4，约 14K LOC）

```
┌─ Copilot V2 + V2.5 协议化中枢（lib/copilot/，33 source）─────┐
│                                                                │
│  ┌── Context 管道 ──────┐    ┌── Tool 管道 ───────────┐      │
│  │ manifest.ts          │    │ tools/registry.ts       │      │
│  │   （9 type shaper）  │    │ tools/types.ts          │      │
│  │ resolve-context.ts   │    │ tools/tool-result.ts    │      │
│  │ system-header.ts     │    │   （9 ToolErrorCode）   │      │
│  │ boundary.ts          │    │ tools/hooks.ts          │      │
│  │   （sliceAfter）     │    │   （pre/post pipeline） │      │
│  │ micro-compact.ts     │    │ tools/route-gating.ts   │      │
│  │   （双阈值）         │    │   （per-route 暴露）    │      │
│  │ context-registry.ts  │    │ tools/metadata-client   │      │
│  │ snapshot-cache.ts    │    │ tool-runtime.ts         │      │
│  └──────────────────────┘    │   （4 kind dispatch）   │      │
│           │                  │ tool-loop-detector.ts   │      │
│           │                  │   （hermes 三档）       │      │
│           │                  └─────────────────────────┘      │
│           ▼                                │                   │
│  ┌── 聚合点：build-llm-messages ─────────────┐                │
│  │ + Anthropic 4-breakpoint cache_control     │                │
│  │   (anthropic-cache-control.ts)             │                │
│  └────────────────────────────────────────────┘                │
│                          │                                     │
│  ┌── llm-stream.ts ──────────────────────────┐                │
│  │ SSE 归一化（OpenAI + Anthropic）           │                │
│  │ + cache token 抽取                         │                │
│  └────────────────────────────────────────────┘                │
│                          │                                     │
│  ┌── stream-response.ts ─────────────────────┐                │
│  │ runToolAwareLlmStream（chat + tool-result │                │
│  │   两 route 共用）                          │                │
│  └────────────────────────────────────────────┘                │
│                          │                                     │
│  ┌── Observer 层（jsonl 三件套 + 拆分 3 文件）─────────┐      │
│  │ session-store.ts        (sessions/{id}.jsonl)      │      │
│  │ tool-result-store.ts    (tool-results/{sid}/)      │      │
│  │ cache-stats-store.ts    (cache-stats.jsonl io)     │      │
│  │   ├── cache-aggregate.ts    (hit-rate + counts)    │      │
│  │   └── cache-break-detect.ts (digest + reasons)     │      │
│  │ instrumentation.ts      (startup retention prune)  │      │
│  └─────────────────────────────────────────────────────┘      │
│                                                                │
│  特征：                                                        │
│  · Hook pipeline（pre/post tool call 各 2 hook）              │
│  · Metadata-first tool descriptor（每 tool 自带元数据）        │
│  · ref-only system header（progressive disclosure）            │
│  · transcript boundary（O(n) → O(since-boundary)）             │
│  · 4-breakpoint cache_control（5m TTL）                        │
│  · per-session sessionStorage allow/deny                       │
│  · per-route 工具 gating（5-9 个工具按 route）                 │
│  · 三档 chain detector（exact-fail / same-tool / no-progress） │
│  · 9 ToolErrorCode + Anthropic is_error 协议透传              │
│  · cache observer（命中率 + break reason + 末尾 200 char diff）│
└────────────────────────────────────────────────────────────────┘
```

### 三 repo 思想 → evalyst 落地映射

```
CCB 渐进披露 ─────┬→ manifest（9 type shaper，≤300 char）
                   ├→ ToolResult metadata-first contract
                   ├→ ref 落盘 + read_tool_result 回捞
                   ├→ per-route tool gating
                   └→ alwaysAllow checkbox（CCB alwaysAllow 简化版）

hermes 长跑 ──────┬→ 4-breakpoint cache_control（system_and_3 直抄）
                   ├→ head+tail preview（双端夹）
                   ├→ tool-loop-detector（exact-fail/same-tool/no-progress 三档）
                   ├→ microCompact 双阈值（数量 + token）
                   └→ image 1600 token 补偿

openclaw 可观察 ──┬→ cache-stats.jsonl + chip
                   ├→ noise floor（drop ≥1000 + ratio < 0.95）
                   ├→ break reason（systemPrompt + tools，6 选 2）
                   ├→ digest preview 末尾 200 char diff
                   ├→ retention prune（30d + N=10000）
                   └→ alwaysDeny per-session（4 源矩阵简化到 1 源）
```

### 主题 A · 上下文协议化

来源：CCB 渐进披露思路 + hermes ContextEngine 双阈值压缩。痛点 1 + 痛点 2 都指向同一件事 —— 上下文不能"拷一坨给 LLM"，必须有协议。

落地分三层：

**Manifest 化的卡片层**。`manifest.ts` 抽 9 个 type shaper（experiment / task_result / task_field / text_selection / template / dataset / display / rubric / rubric_stats），每张卡 ≤300 char。圈选时只把卡片塞进 system header（`route_type + path + active_contexts[{id, type, ref, summary, within}]`），原始数据放在 9 个工具背后让 LLM 按需调用。`resolveContextSelf` / `resolveContextById` / `read_page` 三条路径共用 manifest，敏感字段（`input_preview` / `default_prompt` / JSX 源码 / `prompt_template` / `api_config`）默认就不出现。Progressive disclosure 落地：圈选 → 看卡 → 想细节就调 `read_context(ctx_N, scope)` / `read_resource(type, id, fields)` / `read_dataset_records`（按需 limit ≤ 20）。

**Boundary 化的切片层**。`boundary.ts` 在 transcript 加 `role: 'system', kind: 'compact_boundary'` 消息。`microCompact` 完成且真有压缩时插一条，`buildLlmMessages` 用 `sliceAfterBoundary` 跳过 boundary 之前的历史 —— 复杂度从 O(n) 降到 O(since-boundary)，5 轮以后的尾巴效应消失。

**Compact 化的折叠层**。`micro-compact.ts` 双阈值（数量阈值 + token 阈值，hermes 砍掉时间维度），老的 tool_result 压成 `compacted summary` 保最近 N 条。配合 `tool-result-store.ts` 的 ref 落盘 —— 超 `maxResultSizeChars` 的 output 落 `data/copilot/tool-results/{sid}/tr_xxx.json`，transcript 留 head 400 + sep + tail 100（hermes `context_compressor.py:692` 双端夹直抄，error stack root cause 常在末尾，head-only 会切掉），LLM 想看全调 `read_tool_result(ref)` 回捞。

### 主题 B · 工具 contract 化

来源：CCB metadata-first + hermes 三档失败检测 + Anthropic `is_error` 协议 GA。痛点 3 + 痛点 4 都指向工具接口需要 schema —— 不仅是 input schema，还要有 output / error / 行为 metadata。

`tools/types.ts` 的 `ToolDescriptor` 把每个工具表达成 contract：name / description / inputSchema / call + 一组 metadata（`isReadOnly` / `isDestructive` / `maxResultSizeChars` / 可选 `requiresConfirm`）。这套 metadata 自动驱动 4 件事：UI 弹不弹 Confirm 卡（preToolCall `confirmGateHook` 读 `isDestructive`）/ 大 payload 自动落盘（postToolCall `payloadGuardHook` 读 `maxResultSizeChars`）/ 是否参与 microCompact 压缩（读工具参与，写工具保留）/ tool-call-card 视觉 variant（context / resource / retrieval / write / default 路由）。Registry 两处登记（`tools/registry.ts` 服务端 + `tools/metadata-client.ts` 客户端镜像），`metadata-client-sync.test.ts` 强制对齐。

错误也是 contract。`tools/tool-result.ts` 定义 9 种 ToolErrorCode（`INVALID_INPUT / NOT_FOUND / UNAUTHORIZED / CONFLICT / RATE_LIMIT / NETWORK / USER_DENIED / AWAITING_CONFIRM / INTERNAL`）+ `{ ok, value | error: { code, message, hint?, retry_safe? } }` 结构 + `ok()` / `err()` / `isToolErrorShape()` helpers。Anthropic 协议 `is_error: true` 透传到 content block，LLM 看到的 error 是结构化的而不是字符串。`retry_safe` 字段告诉 LLM "这个错你换参数能成"还是"换啥都不行别试了"。tool-call-card 用 red alpha tinted 渲染 error（code/message/hint/retry_safe 分别展示）。

**Per-route gating** 防误调。`tools/route-gating.ts` 的 5 个 always 工具 + 18 种 RouteType 的 ROUTE_EXTRA mapping：dashboard 看 5 个；experiment_detail 看 8 个；template_detail 看 6 个。LLM 在 dashboard 看不到 `edit_template` —— 既减少 token 占用，又避免误调。

**chain cap 换成模式检测**。`tool-loop-detector.ts` 191 行实现 hermes `tool_guardrails.py:71` 三档（exact-fail 2/5、same-tool 3/8、no-progress 2/5），替代硬数步 5。哲学差别：失败是模式，模式比计数更准。`SystemNoticeBubble` 在 warn 时友好提示、block 时硬拒。原 4 read + 1 edit 撞 5 线被误 429 的问题消失。

**cache_control 直抄 hermes**。`anthropic-cache-control.ts` 在 `buildStreamingRequestBody` 的 anthropic 分支后置 mutate body：1 个 breakpoint 注入 system 末尾 + 3 个滚动注入最近 3 条 messages 末尾 content block，5m TTL。无条件开不做 cost gate。实测 cache hit rate 从 ~40-50% 涨到首次 3 轮 25%、长 session 70-90%；多轮 input cost 预期降 60-80%。Sankuai / Bedrock gateway 实测兼容（`cache_creation_input_tokens` 在 message_start 都按预期落非 0）。

### 主题 C · 行为可观察化

来源：openclaw `prompt-cache-observability.ts` + alwaysAllow / alwaysDeny 三选项。痛点 5 直接对应 —— agent 是生产系统，行为必须有数据。

**cache 命中率落 jsonl + chip 显示**。每次 LLM 调用从 response 抽 `cache_creation_input_tokens` / `cache_read_input_tokens`（Anthropic）+ `prompt_tokens_details.cached_tokens`（OpenAI）落 `data/copilot/cache-stats.jsonl`。`cache-aggregate.ts` 聚合"本 session X% · 近 7 天 Y% · N breaks"渲染到 chip。

**noise floor 防假阳**。`MIN_CACHE_BREAK_TOKEN_DROP = 1000` + `MAX_CACHE_BREAK_RATIO = 0.95` 双阈值（openclaw 直抄），drop ≥ 1000 tokens 且 ratio < 0.95 才算 break，否则当作正常波动不计 break。

**break reason + diff preview**。`cache-break-detect.ts` 在 noise floor 命中后比对前后两次的 `system_prompt_digest` / `tool_digest`（sha256 前 16 字符），给出 `['system_prompt']` / `['tools']` / `['unknown']` reason。`CacheUsageStat` 同时存 `system_prompt_preview` / `tool_preview` 200 char 末尾片段，chip tooltip 在 break reason 命中时追加 before/after 两行（前缀 `...`），让用户能定位"具体哪几个字符变了"。openclaw 6 reason 我们只挑 2 个最常见。

**alwaysAllow / alwaysDeny per-session**。Confirm 卡加「本次会话信任此工具」checkbox，sessionStorage per-tab + per-session 持久化。双层短路：客户端 SSE handler 在 `tool_use_end` 处先查 sessionStorage 命中直接 push 到 auto-run 队列；服务端 `confirmGateHook` 同时读 body.session_allow_list 短路。`session_deny_list` 对称（CCB `alwaysDenyRules` + openclaw 三选项），优先级 deny > allow > 默认 confirm。

**retention prune**。`cache-stats.jsonl` 双阈值（30d + N=10000 行）+ `instrumentation.ts` 启动钩子调用一次。基于 openclaw retention 思路加 startup 触发。

### 3.5 · 故意不抄的清单

evalyst 是 LLM-as-feature，不是 LLM-as-platform —— 三 repo 提供的设计很多看着诱人，但 scope creep 最大的来源就是「借鉴时贪多嚼不烂」。每条「不抄」都对应明确的触发条件，等真撞到痛点再回来做。下面按 repo 分组列出 V2 / V2.5 落地时显式不采用的件，每条说清原项 + 不抄理由。

**来自 CCB（claude-code-best）**

- ❌ `SnipTool` / `CtxInspectTool` —— 让 LLM 主动管 context。先观察一周 LLM 实际行为再说，目前 manifest + ref 已覆盖 90% 场景
- ❌ `autoCompact` 全量 summary —— session 短不需要整体摘要，boundary + microCompact 双阈值已够
- ❌ 跨 session feedback memory（4 类 taxonomy）—— 没出现过用户反复教 copilot 同一件事的信号
- ❌ `cache_edits` beta API —— 依赖 Anthropic 4.x beta，跨 provider 不通用
- ❌ 4 源 policy matrix（policy / plugin / project / user）—— 单人 web 工具用不上 plugin / project / user 那套，evalyst 只保留 per-session allow / deny 1 源

**来自 hermes（NousResearch/hermes-agent）**

- ❌ `ContextEngine` 可插拔抽象 —— 单 engine 用不到策略切换
- ❌ 1h cache TTL —— session 活跃片段几分钟，5m 够
- ❌ preview 4000+1500 字符量级 —— transcript context budget 紧，evalyst 自己缩到 head 400 + tail 100
- ❌ 自动 retry on validation fail —— 让 LLM 看 `retry_safe` 字段自己决定，比黑盒 retry 透明

**来自 openclaw**

- ❌ 另外 4 个 break reason（`model / cacheRetention / transport / streamStrategy`）—— 单 provider 单 session 用不上，evalyst 只挑 `systemPrompt + tools` 2 个最常见
- ❌ `ContextEnginePromptCacheInfo.observation.broke` 的 engine 反应逻辑 —— 只观测、不自动 rewrite
- ❌ `rewriteTranscriptEntries` 持久化压缩 —— 改 append-only 语义需慎重
- ❌ `session-token-cap` 强制止损 —— 没观察到真实溢出，先做遥测看一周再决定（gap 分析的 P1 候选，触发条件未到）
- ❌ multi-session agent runner —— evalyst copilot 是「圈选 → 改 → 关掉」工作流，单 session 串行够用
- ❌ 4 源 policy matrix —— 同 CCB

scope 节制不是抠门，是把「能力边界」当成一等的设计决策：每条「我们不做 X」的明确论证比每条「我们做 Y」的 spec 更值钱。

---

## 4. 教训：过程里学到了什么

### 4.1 三 repo 调研的两轮节奏

第一轮（V2 时）调研三 repo，砍了 12 项「显式不采用」清单，理由都看着合理（"复杂度大"、"单 session 不需要"、"低使用量不值得"等）。

第二轮（V2.5 时）回头复盘那 12 项，发现至少 6 项**"当时砍是因为没看清"**：

| 当时砍掉的项 | 当时砍的理由 | 二轮真相 |
|---|---|---|
| `CompactBoundaryMessage` | "session 不长不需要" | session 不长仍需要 boundary 来切 build-llm-messages 边界（O(n) → O(since-boundary)）|
| `ContextEnginePromptCacheInfo` | "实施复杂度大" | 原代码 216 行两个纯函数 + Map，复杂度低；只观测不反应几乎免费 |
| hermes 4-breakpoint | "低使用量不值得" | 73 行无条件开，hermes 不做 cost gate 直接拿收益 |
| openclaw `alwaysDenyRules` | "单机不需要" | 用户场景"我永远不想 LLM 跑 restart_experiment"只能改源码 |
| hermes 三档失败检测 | "硬 cap 5 够用" | 4 次 read_context + 1 次 edit 撞 5 线被误 429 |
| openclaw 6 break reason | "过度工程" | 挑 2 个最常见（systemPrompt + tools）就覆盖大多数场景 |

**教训**：调研第一轮看 brief 容易高估实施复杂度 / 低估真实价值；ship 一段看真实流量，再回头查 source 比理论判断更准。

### 4.2 hot-fix 暴露的 spec 盲区

v0.9.1 P0 ship 后 immediate regression：`analyzeToolLoop` 在产线上**实际不触发**。原因是 V2.5 M2 引入的 `system_compact_boundary` + `/tool-result` POST 时的 hanging tool_use 让原 `collectTrailingPairs` "末端必须 tool_result + pair 之间无任何消息"的简化模型完全失效。

spec 单测构造的是合成 branch（没有 boundary 也没 hanging tool_use），所以 unit 全绿但 integration 完全失效。

**教训**：纯函数 unit 测过不代表 integration 对。**跨子系统形态在 spec 里不可见**，只能靠手动回归发现。后续 spec 都会显式列「跨子系统兼容性 checklist」（boundary 联动 / route handler 时序等）。

### 4.3 6 轮 review 后还有 false alarm

v0.9.3 后期做 code audit，1 个 reviewer agent 报告 P0 真 bug：`tool-loop-detector.isFailure()` 不识别 v2.5 P2 ToolError shape `{ ok: false, error: { code, message } }`。

这个报告读起来很合理（spec gap 完整、行号准确、影响面清晰）。

实际 verify 时发现 audit 是 **false alarm**：`{ ok: false, error: { code, message } }` 含 `'error'` key，原 `"error" in obj` 仍命中，loop detector 实际工作。

audit 误报根源是 reviewer agent 在另一个分支的 dirty worktree 里跑测试，看到的是回退状态。

**教训**：review 报告本身也要 verify，不要因为"看起来合理"就直接修。"真 bug" 标 P0 时尤其要先跑一遍最小复现，**evidence before assertions** 是 superpowers 系列的口号原话，这次又印证了一次。

### 4.4 "故意不抄"纪律

12+ 份 spec 都有「故意不抄清单」 —— 三 repo 提供的设计很多，但 evalyst 是 LLM-as-feature 不是 LLM-as-platform，能力边界要明确。

从最早 V2 spec 开始就坚持的 pattern：每条改动都要写：
- 来源（哪个 repo 哪个文件哪个行号）
- 理由（解决什么问题）
- 故意不抄什么（节制 scope）
- 触发条件（什么时候考虑做）

这套纪律让 evalyst Copilot 在 2 个月内从 5K LOC 涨到 14K LOC 没有过度工程化，所有"看起来很酷但其实用不到"的件（`SnipTool` / `ContextEngine` / 4 源 policy / 跨 session feedback memory / 1h cache TTL / `rewriteTranscript` / `cache_edits` beta / multi-session agent runner）全部明确不做。

**教训**：scope creep 最大的来源不是新需求，是**借鉴时贪多嚼不烂**。每条"我们不做 X"的明确论证比每条"我们做 Y"的 spec 更值钱。

---

## 5. 总结：心智转向

V1 把 Copilot 当 **LLM RPC 调用器**：messages 进、response 出、用户自己消化。

V2 + V2.5 把 Copilot 当 **协作 agent 子系统**：

- **上下文是协议**：manifest 卡 ≤300 char + boundary 切边界 + microCompact 双阈值 + progressive disclosure（按需调工具）
- **工具是 contract**：metadata-first（isReadOnly / isDestructive / maxResultSizeChars）+ 9 ToolErrorCode enum + Anthropic `is_error: true` 透传 + per-route gating
- **行为是数据**：cache hit rate / break reason / token usage / session permission 全部落 jsonl，用户能看见、能调

这背后映射的是协议层的演进 —— Anthropic 的 `cache_control` / `is_error` 在 2025-2026 期间从 beta 转 GA，OpenAI 的 `prompt_tokens_details.cached_tokens` 在 SDK 里铺开，三 repo 是先行者把这些字段用起来。evalyst Copilot 在 v0.7.0 → v0.9.4 这两个月按"故意不抄整套，挑最值的子集"的纪律把它们落地到 ~14K LOC 子系统里。

### 当前能力边界（不做什么 + 为什么）

evalyst 是 LLM-as-feature，停在「让圈选 → 改 → 重跑这条评测工作流变顺」的层级。以下 8 件三 repo 有但我们显式不做：

- ❌ **跨 session feedback memory**（CCB 4 类 taxonomy）—— 没出现过用户反复教 copilot 同一件事的信号
- ❌ **`SnipTool` / `CtxInspectTool`**（CCB 让 LLM 主动管 context）—— 观察一周 LLM 实际行为再说
- ❌ **4 源 policy matrix**（CCB / openclaw 都有）—— 单人 web 工具用不上 plugin / project / user 那套
- ❌ **`ContextEngine` 可插拔抽象**（hermes）—— 单 engine 用不到策略切换
- ❌ **`rewriteTranscriptEntries` 持久化压缩**（openclaw）—— 改 append-only 语义需慎重
- ❌ **`cache_edits` beta API**（CCB）—— 依赖 Anthropic 4.x beta，跨 provider 不通用
- ❌ **multi-session agent runner**（openclaw）—— evalyst copilot 是"圈选 → 改 → 关掉"工作流，单 session 串行够用
- ❌ **1h cache TTL**（hermes）—— session 活跃片段几分钟，5m 够

每条"不做"都对应明确触发条件 —— 等出现了再考虑做。

### 当前真实使用反馈

v0.9.4 ship 后的 gap analysis 推荐三件 P1 feature（parallel tool dispatch / streaming partial recovery / per-session token cap 遥测），但综合判断**不必现在做**。理由：v0.9.3 已经把"看得见的体验缺陷"清干净，三条 P1 没有"现在卡住用户"的痛点。等真撞到痛点（"为啥要等这么久" / "丢了 5 分钟对话" / "账单异常"）再回来做。

**v0.9.x 系列的演进哲学最后总结一句话**：先让协议化基础设施稳，再按真实痛点驱动做新功能 —— 不要为了优雅而做。
