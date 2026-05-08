# Copilot v2.5 P0 二轮采纳（CCB / hermes / openclaw）Design

**Status**: Design draft, awaiting user approval before writing plan
**Date**: 2026-05-08
**Scope**: v0.9.0 shipped 后基于三 repo（CCB / hermes / openclaw）原代码深入调研得出的 4 条 P0 必改项。每条都是独立的小改动，合起来一个 PR。
**Reference**:
- v0.9.0 已 ship：CHANGELOG `[0.9.0]` · Copilot v2.5 (M1+M2+M3) + Bedrock SSE fix
- 二轮调研：3 个并行 agent 抓 `claude-code-best/claude-code` · `NousResearch/hermes-agent` · `openclaw/openclaw` 三 repo 原代码
- 上一轮 spec：`docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md`（v2.5 M1/M2/M3 落地）

---

## 1. 为什么做这个

v0.9.0 ship 后基于三 repo 源代码复盘，发现上一轮 spec 里有 3 条判断需要修正：

| 上一轮 spec 原判断 | 实测真相 | 本轮修正 |
|---|---|---|
| "openclaw 6 break 原因码实施复杂度大" | 原代码 216 行两个纯函数 + Map，复杂度低 | 抄 2 个最有价值的（留到 PR2） |
| "openclaw 4 源权限矩阵，单机过重" | 4 源矩阵实际不存在；真实是 2 层 + allow/deny/ask 3 选项 | 我们缺 **deny** 对称（本 PR） |
| "hermes 4-breakpoint 低使用量不值得" | hermes 73 行无条件开，不看 hit rate 门槛 | 直接做简化版（留到 PR2） |

同时新发现几个 v0.9.0 参数取值不合理：

| 参数 | v0.9.0 现状 | 问题 | 源 |
|---|---|---|---|
| `approxTokens = len / 4` | 一刀切 | JSON tool_result 低估 2 倍；中文 char 低估 2-3 倍 | CCB `tokenEstimation.ts:227` + hermes `model_metadata.py:1445` |
| `aggregateCacheHitRate` | 无 noise floor | 每次 retry 小抖动都被当 break，用户误判 | openclaw `prompt-cache-observability.ts:51` |
| `session_allow_list` | 只有 allow | 用户想永久禁某工具只能改代码 | CCB `alwaysDenyRules` + openclaw allow-once/always/deny 三选项 |
| chain cap = 5 | 硬数步 cap | 正常 4 次 read_context + 1 次 edit 就撞线 | CCB 无 cap + hermes `tool_guardrails.py:71` 用重复检测 + openclaw `before-tool-call.ts:437` tool-loop detector |

## 2. 非目标（明确不做）

本 PR 只做"参数修正 + 小机制调整"，以下留到 PR2 或后续：

- ❌ Anthropic 4-breakpoint `cache_control` 显式控制（→ PR2）
- ❌ `systemPrompt + toolDigest` 两个 break 原因码（→ PR2）
- ❌ `SnipTool` / `CtxInspectTool` 给 LLM 主动管理 context（→ 观察一周后再定）
- ❌ openclaw 风格的持久化 `rewriteTranscriptEntries`（→ 改 append-only 语义需慎重，观察后再定）
- ❌ 文件级 `data/copilot/permissions.json` 持久化（本 PR 只加 sessionStorage deny，持久化层留到 PR3）
- ❌ image 补偿 1600 tokens / tool schemas 计入 request tokens（v0.9.0 我们还不支持 image；tool schemas 计入是 system-header 的事，改动大，推迟）
- ❌ head+tail 双端夹截断（hermes 模式，留到 PR2 顺带）

## 3. Scope：4 条变更

### 3.1 `approxTokens` 分三层分岔 — 来源 CCB + 经验

**现状**：`src/lib/copilot/micro-compact.ts:57`
```ts
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}
```

**问题**：
1. tool_result content 永远是 `JSON.stringify(ToolResultContent)`，JSON 里大量单字符 token（`{ } [ ] , : "` 占比 15-25%），CCB `tokenEstimation.ts:227` 实测 JSON 应该用 `bytesPerToken = 2` —— 我们**低估 2 倍**。`maxTotalReplayableTokens = 4000` 实际卡在 8000 tokens，保护失效。
2. 中文主流场景下 1 char ≈ 1 Claude/GPT token，我们 `/4` **低估 4 倍**。evalyst 中文数据集为主。

**变更**：
```ts
function approxTokens(s: string): number {
  if (!s) return 0
  // 按 Claude/GPT BPE 经验：
  // - JSON 结构化内容（tool_result 都是）：~2 chars/token（大量单字符 brace/bracket token）
  // - 中文 heavy（>30% CJK 字符）：~1.5 chars/token（常见 2-3 char 词）
  // - 其他（英文 / 代码）：~4 chars/token
  const looksLikeJson = /^\s*[\[{]/.test(s) && /[\]}]\s*$/.test(s)
  if (looksLikeJson) return Math.ceil(s.length / 2)

  const cjkCount = (s.match(/[一-鿿]/g) ?? []).length
  if (cjkCount > s.length * 0.3) return Math.ceil(s.length / 1.5)

  return Math.ceil(s.length / 4)
}
```

**Image 补偿**（来源 hermes `context_compressor.py:65 _IMAGE_TOKEN_ESTIMATE = 1600`）：

```ts
export const IMAGE_TOKEN_COST = 1600

// 匹配 image url（http/s + 常见图片扩展名）和 data URL；不区分大小写
const IMAGE_URL_PATTERN =
  /(["'])(https?:\/\/[^"'\s]*\.(?:png|jpe?g|webp|gif|bmp)(?:\?[^"'\s]*)?)\1|data:image\/[a-z]+;base64,/gi

function approxTokens(s: string): number {
  if (!s) return 0

  // Image url 补偿（每张图固定 1600 tokens，与文本估算独立加和）
  const imageCount = (s.match(IMAGE_URL_PATTERN) ?? []).length
  const imageTokens = imageCount * IMAGE_TOKEN_COST

  // 文本部分按 content type 分岔
  const looksLikeJson = /^\s*[\[{]/.test(s) && /[\]}]\s*$/.test(s)
  if (looksLikeJson) return Math.ceil(s.length / 2) + imageTokens

  const cjkCount = (s.match(/[一-鿿]/g) ?? []).length
  if (cjkCount > s.length * 0.3) return Math.ceil(s.length / 1.5) + imageTokens

  return Math.ceil(s.length / 4) + imageTokens
}
```

**不做**：
- 不把 tool schemas 算进 request tokens（那是 system-header 的事，本 PR 不碰）
- 不换真正的 tokenizer（`tiktoken` / `@anthropic-ai/tokenizer`）— 加 dep + 异步化，YAGNI

**收益**：`maxTotalReplayableTokens = 4000` 回到真的 4K tokens 护栏；中文 / JSON / 含图 task_result 场景都不再低估。

### 3.2 `aggregateCacheHitRate` 加 noise floor — 来源 openclaw

**现状**：`src/lib/copilot/cache-stats-store.ts:64` 算 hit_rate = `totalCacheRead / totalDenom`，无抖动保护。

**问题**：
- 一次 `restart_experiment` 重跑 → cache_read 小幅下降；chip 显示的是**聚合**的（过去 7 天），小抖动对 `0.95 → 0.88` 已经是视觉上的明显掉。
- openclaw 只在 `previousCacheRead - cacheRead >= 1000 tokens AND ratio < 95%` 才算 "break"。

**变更**：
- `aggregateCacheHitRate` 保持不变（仍算平均 rate），但是 chip 的 "最近一次 break" 判断引入 noise floor。
- 新增函数 `detectCacheBreak(prev, curr)` → 是否算 break。
- chip 显示还是直观的 hit rate 百分比，但加第二个指标 "recent breaks: N"，用 noise-filtered 的计数。

**新增**（`cache-stats-store.ts`）：
```ts
/** v2.5 P0 §3.2: 与 openclaw `hasCacheReadDropped` 对齐的 noise floor。
 *  小波动不视为 break；避免"重启一次实验就让 chip 抖一下"。
 */
export const CACHE_BREAK_MIN_DROP_TOKENS = 1000
export const CACHE_BREAK_MAX_RATIO = 0.95

export function detectCacheBreak(
  prev: CacheUsageStat | undefined,
  curr: CacheUsageStat,
): boolean {
  if (!prev) return false
  const prevRead = prev.cache_read_tokens ?? 0
  const currRead = curr.cache_read_tokens ?? 0
  const drop = prevRead - currRead
  if (drop < CACHE_BREAK_MIN_DROP_TOKENS) return false
  if (prevRead === 0) return false  // 从 0 出发谈不上"掉"
  const ratio = currRead / prevRead
  return ratio < CACHE_BREAK_MAX_RATIO
}

export interface CacheBreaksSummary {
  recent_breaks: number
  total_pairs_considered: number
}
export function countRecentBreaks(stats: CacheUsageStat[]): CacheBreaksSummary {
  let breaks = 0
  for (let i = 1; i < stats.length; i++) {
    if (detectCacheBreak(stats[i - 1], stats[i])) breaks++
  }
  return { recent_breaks: breaks, total_pairs_considered: Math.max(0, stats.length - 1) }
}
```

**UI 变更**（`cache-stats-chip.tsx`）：chip 右侧多加 `· N breaks (past 7d)` 段，hover tooltip 解释 noise floor。`recent_breaks === 0` 时段不显示（避免视觉噪声）。

**不做**：
- 不做 openclaw 的 6 种 break reason（`model / retention / transport / streamStrategy / systemPrompt / tools`）—— PR2 做 2 个最有价值的（systemPrompt + tools digest），本 PR 只做"量级检测"。
- 不自动 action（不做 rewriteTranscript 之类的）。

### 3.3 `session_deny_list` 对称到 sessionStorage — 来源 CCB + openclaw

**现状**：`src/lib/copilot/session-allow.ts` 只有 allow-list 三个函数：
- `isSessionAllowed(allowList, toolName)`
- `getSessionAllowList(sessionId)` / `addSessionAllow(sessionId, toolName)`

`confirmGateHook` 只走 allow 短路（hooks.ts:45）。

**问题**：用户场景"我永远不想让 Copilot 跑 `restart_experiment`"只能改源码。CCB `alwaysDenyRules` 就是这个诉求；openclaw UI 有 allow-once / always / deny 三选项。

**变更**：对称地加 deny 侧（本 PR 只加 sessionStorage；文件级持久化留到 PR3）。

**新增**（`session-allow.ts`）：
```ts
const DENY_KEY = (sessionId: string) => `evalyst-copilot-deny-${sessionId}`

export function isSessionDenied(
  denyList: string[] | undefined,
  toolName: string,
): boolean {
  return Array.isArray(denyList) && denyList.includes(toolName)
}

export function getSessionDenyList(sessionId: string): string[] {
  // （逻辑和 getSessionAllowList 对称，不同的 key）
}

export function addSessionDeny(sessionId: string, toolName: string): void {
  // （逻辑和 addSessionAllow 对称）
}
```

**`confirmGateHook` 变更**（hooks.ts:45）：
```ts
export interface PreToolCallCtx {
  // ... 已有字段
  session_allow_list?: string[]
  session_deny_list?: string[]  // 新增
}

export const confirmGateHook: PreToolCallHook = async ({ tool, session_allow_list, session_deny_list }) => {
  // 先 check deny（最高优先级，防越权）
  if (isSessionDenied(session_deny_list, tool.name)) {
    return { action: "deny", reason: "user-denied for this session" }
  }
  // allow 短路
  if (isSessionAllowed(session_allow_list, tool.name)) {
    return { action: "proceed" }
  }
  // 原有逻辑
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}
```

**UI 变更**（`tool-call-card.tsx`）：Deny 按钮旁新增 "Always deny in this session" checkbox（和 "Always allow" 对称）。点击时如果 `alwaysDeny=true` 则同时 `addSessionDeny(sessionId, toolName)`。

**wire format**：`/chat` + `/tool-result` POST body 新增 `session_deny_list?: string[]`，和 `session_allow_list` 对称。`use-chat-stream.ts` 发 body 时把两个 list 都读出来带上。

**优先级约束**：deny > allow。如果用户同时 allow 和 deny 了同一工具（正常 UI 流程不会发生，只可能手改 sessionStorage），confirmGateHook 按 deny 生效。

### 3.4 Chain cap 从硬数步 5 换成 hermes 三档阈值 — 来源 hermes

**现状**：`src/lib/copilot/tool-result/route.ts`（或对应 chain 判断处，本 PR 需先定位）硬编 `trailing tool_use+tool_result pair >= 5 → 429`。正常"4 次 read_context + 1 次 edit_template 验证"就撞 5 线。

**问题**：
- CCB 根本没 cap，靠模型自停
- hermes 用"重复检测 + 失败阈值"`tool_guardrails.py:71`：
  - `exact_failure: warn_after=2, block_after=5`（同 args 失败 2 次 warn，5 次 block）
  - `same_tool_failure: warn_after=3, halt_after=8`（同工具失败 3 次 warn，8 次 halt）
  - `no_progress: warn_after=2, block_after=5`（idempotent 无进展 2 次 warn，5 次 block）

**变更**：

新增 `src/lib/copilot/tool-loop-detector.ts`（纯函数）：
```ts
import type { CopilotMessage } from "./types"

export interface ToolLoopDetectorConfig {
  exactFailureWarn: number      // 2
  exactFailureBlock: number     // 5
  sameToolFailureWarn: number   // 3
  sameToolFailureHalt: number   // 8
  noProgressWarn: number        // 2
  noProgressBlock: number       // 5
}

export const DEFAULT_LOOP_CONFIG: ToolLoopDetectorConfig = {
  exactFailureWarn: 2, exactFailureBlock: 5,
  sameToolFailureWarn: 3, sameToolFailureHalt: 8,
  noProgressWarn: 2, noProgressBlock: 5,
}

export type ToolLoopDecision =
  | { action: "proceed" }
  | { action: "warn"; reason: string }
  | { action: "block"; reason: string }

/**
 * 分析 branch 尾部连续的 tool_use+tool_result pair，决定下一次 tool_use 是否被 block。
 * 规则（从严到宽）：
 * 1. 最近 N 对同 (tool_name, argsHash) 都失败 → exact-failure block
 * 2. 最近 N 对同 tool_name（参数可不同）都失败 → same-tool halt
 * 3. 最近 N 对同 (tool_name, argsHash) 成功但输出 identical → no-progress block
 *    （idempotent tool 反复打捞同 ref 视为 no-progress）
 * 其余 → proceed
 */
export function analyzeToolLoop(
  branch: CopilotMessage[],
  nextToolName: string,
  nextToolInput: Record<string, unknown>,
  config: ToolLoopDetectorConfig = DEFAULT_LOOP_CONFIG,
): ToolLoopDecision {
  // 实现细节在 plan Task 里
}
```

**替换**：原 chain cap 5 改成 analyzeToolLoop；完全移除"连续工具调用数"硬 cap。`/tool-result` route 在 runTool 之前调 analyzeToolLoop，block 则返 `{ action: "denied", reason }`，复用已有 denial surface（ToolCallCard write variant 显示）。

**i18n**：新加 3 条错误文案 key：
- `copilot.loop.exact_failure` / `copilot.loop.same_tool` / `copilot.loop.no_progress`

**不做**：不做 warn stage 的 **block**（warn 只是提示，LLM 仍可进）。但 **warn 要有 UI 反馈**（下一段）。

**warn UI 设计**（遵循 `CLAUDE.md` / `AGENTS.md` Copilot Glass UI 约定）：

- `analyzeToolLoop` 返回 `{ action: "warn"; reason }` 时，`/tool-result` route 在 SSE 流里 emit 一个新事件 `kind: "loop_warn"; call_id; reason_key; reason_vars`
- `use-chat-stream.ts` 的 makeSseHandler 收到后 push 一条新 UiMessage：`{ role: "system_notice"; kind: "loop_warn"; reason_key; reason_vars }`
- `chat-view-parts` / `chat-view.tsx` 按 `role === "system_notice"` 分支渲染成一个独立的 **GlassWarning 档气泡**（import from `@/components/copilot/shell`），amber border + ambient shadow，i18n 文案
- Copilot panel **是扁平区**（AGENTS.md 约定），所以这里不用 `<GlassWarning>`（那是中间内容区规则）；panel 内部用 shadcn 扁平 + 轻量 tinted 表面（`bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300`，AGENTS.md "轻量 tinted 表面"章节）

```tsx
// chat-view 里新增 SystemNoticeBubble 组件（简化示意）
function LoopWarnBubble({ reasonKey, reasonVars }: { reasonKey: string; reasonVars: Record<string, string | number> }) {
  const t = useT()
  return (
    <div className="rounded-md px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-2">
      <span aria-hidden>⚠️</span>
      <span>{t(reasonKey, reasonVars)}</span>
    </div>
  )
}
```

i18n key（`src/lib/i18n/zh.ts` + `en.ts`）：

```ts
// zh.ts
"copilot.loop.warn.exact_failure": "工具 {{tool}} 以相同参数连续失败 {{count}} 次，下一次相同调用将被中止",
"copilot.loop.warn.same_tool": "工具 {{tool}} 连续失败 {{count}} 次，可能陷入死循环",
"copilot.loop.warn.no_progress": "工具 {{tool}} 以相同参数重复 {{count}} 次但输出相同，可能无进展",
"copilot.loop.block.exact_failure": "阻止：工具 {{tool}} 以相同参数连续失败 {{count}} 次",
"copilot.loop.block.same_tool": "阻止：工具 {{tool}} 连续失败 {{count}} 次",
"copilot.loop.block.no_progress": "阻止：工具 {{tool}} 重复调用但输出相同 {{count}} 次",
```

## 4. 文件结构

### 新增
- `src/lib/copilot/tool-loop-detector.ts` — 纯函数 analyzeToolLoop + 配置常量
- `src/lib/copilot/__tests__/tool-loop-detector.test.ts` — 3 档阈值各覆盖 warn / block / proceed

### 修改
- `src/lib/copilot/micro-compact.ts` — approxTokens 分三层分岔 + image 补偿
- `src/lib/copilot/cache-stats-store.ts` — 加 detectCacheBreak / countRecentBreaks + 常量
- `src/lib/copilot/session-allow.ts` — 对称 deny 函数
- `src/lib/copilot/tools/hooks.ts` — confirmGateHook deny 短路
- `src/app/api/copilot/sessions/[id]/tool-result/route.ts` — 移除硬 cap，插 analyzeToolLoop + emit `loop_warn` SSE 事件
- `src/app/api/copilot/sessions/[id]/chat/route.ts` — 读 session_deny_list from body 传给 hook
- `src/app/api/copilot/cache-stats/route.ts` — response 加 `breaks` 字段
- `src/components/copilot/use-chat-stream.ts` — body 带 session_deny_list；handler 处理 `loop_warn` 事件 push system_notice
- `src/components/copilot/chat-view.tsx` 或 `chat-view-parts.tsx` — 新增 LoopWarnBubble 组件 + system_notice 分支
- `src/components/copilot/tool-call-card.tsx` — Deny 侧加 alwaysDeny checkbox
- `src/components/copilot/cache-stats-chip.tsx` — 第三段 `· N breaks (past 7d)` 显示
- `src/lib/i18n/zh.ts` + `en.ts` — 新 i18n key（loop warn/block × 3 reason + cache breaks 1 条）
- `src/lib/copilot/__tests__/micro-compact.test.ts` — 补 approxTokens 三档 case + image 补偿
- `src/lib/copilot/__tests__/cache-stats-store.test.ts` — 补 detectCacheBreak / countRecentBreaks case
- `src/lib/copilot/__tests__/session-allow.test.ts` — 补 deny 对称 case
- `src/lib/copilot/tools/__tests__/hooks.test.ts` — 补 deny 短路 case + deny > allow 优先级

## 5. 测试策略（用户选的）

用户选了：**单测全覆盖（必须）+ integration（chain cap 必要）+ 手动回归（必须）**；Playwright e2e 可选跳过。

### 5.1 单测覆盖

每条变更的纯函数对应测试，至少覆盖：
- **approxTokens**：JSON content（`{...}` / `[...]` / trim + pad 变体）、中文 heavy（>30% CJK）、混合（<30% CJK）、空字符串、纯英文
- **detectCacheBreak**：prev undefined、drop <1000、drop ≥1000 但 ratio ≥ 0.95、drop ≥1000 且 ratio < 0.95（算 break）、prev.read = 0、curr 先 undefined
- **countRecentBreaks**：0 条 / 1 条 / 连续 3 对 pairs
- **isSessionDenied**：对称 isSessionAllowed 的 5 个 case（undefined / 空 / 命中 / 未命中 / 精确匹配）
- **analyzeToolLoop**：每档阈值各有 proceed / warn / block / halt 4 case，合 12 case；argsHash 判定、empty branch、混合 success/fail

### 5.2 Integration 测试

`src/lib/copilot/__tests__/tool-loop-detector.integration.test.ts`：跑真实 runTool pipeline + preToolCallHooks，构造 4 种场景：
1. 正常 chain 5 次 read_context → 全部 proceed（证明原 cap 已经不再生效）
2. 连续 5 次 `read_context(id=ctx_1)` 全部失败 → 第 5 次 block
3. 连续 8 次不同 input 调 same tool 全部失败 → 第 8 次 halt
4. 连续 5 次 `read_tool_result(ref=same)` 成功但输出相同 → 第 5 次 block（no-progress）

`src/lib/copilot/tools/__tests__/hooks.test.ts`：补 deny > allow 优先级（同时 allow 和 deny → deny 生效）。

### 5.3 手动回归（ship 前必过）

1. `npm run dev` 启本地
2. 打开 Copilot panel（⌘K）
3. 测 deny UI：点 `restart_experiment` → "Always deny in this session" checkbox → deny → 再次尝试 → 直接 denied
4. 测 allow UI：点 `edit_template` → "Always allow in this session" → confirm → 再次 edit → 直接 proceed
5. 测 chain loop：造一个连续 5 次让 LLM 用同 ref 调 `read_tool_result` 的对话 → 第 5 次看到 block 反馈
6. 测 cache chip：跑 2 轮 copilot 对话，观察 `· N breaks (past 7d)` 段文字

## 6. 向后兼容

| 变更 | 影响面 | 兼容策略 |
|---|---|---|
| approxTokens 分岔 | 内部纯函数，无外部 API | 无 |
| detectCacheBreak 新增 | 纯加法 | 无 |
| session_deny_list 加到 hooks 参数 | `PreToolCallCtx.session_deny_list?: string[]` optional | 旧 caller 不传 → 视作 undefined → `isSessionDenied` 返 false → 和原行为等价 |
| wire format body 加 session_deny_list | `/chat` `/tool-result` route 读 body 字段 optional | 旧 client 不发 → 视作 undefined → 行为兼容 |
| chain cap 机制变更 | 硬 cap 移除 → 可能出现原本 429 的场景现在 proceed | **用户感知变化**：以前撞 429 的长任务现在能继续；新增 block 场景是失败循环。写进 CHANGELOG `[Unreleased]` |
| sessionStorage `evalyst-copilot-deny-{sid}` 新 key | 新 key，不冲突 | 无 |

## 7. CHANGELOG 条目（draft）

```md
## [Unreleased]

### Copilot (v2.5 P0 二轮采纳)

基于 CCB / hermes / openclaw 原代码深入调研，对 v2.5 参数做 4 处修正：

- **approxTokens 分三层分岔**（CCB `tokenEstimation.ts:227` + 中文经验）：JSON content ÷2、中文 heavy ÷1.5、其他 ÷4。修复 microCompact `maxTotalReplayableTokens=4000` 被低估 2 倍的漏洞。
- **aggregateCacheHitRate noise floor**（openclaw `prompt-cache-observability.ts:51`）：drop ≥ 1000 tokens 且 ratio < 95% 才算 break。chip 新增 `· N breaks (past 7d)` 指标。
- **session_deny_list 对称到 allow**（CCB `alwaysDenyRules` + openclaw allow-once/always/deny UI）：Deny 卡新增 "Always deny in this session" checkbox。confirmGate 优先级 deny > allow > 默认 confirm。
- **chain cap 机制从硬数步换成 hermes 三档重复检测**（`tool_guardrails.py:71`）：原 `chain=5` 硬限制移除，替换为 exact-failure 2/5、same-tool 3/8、no-progress 2/5 的 analyzeToolLoop。正常多步 LLM 任务不再被误 429。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md
```

## 8. 故意不抄（对照三 repo 的清单）

| 来源 | 未采纳 | 理由 |
|---|---|---|
| CCB | `cache_edits` beta API | 依赖 Anthropic 4.x beta，跨 provider 不通 |
| CCB | 8 源权限矩阵 | 单人 web copilot 用不上 policy settings |
| CCB | `SnipTool` / `CtxInspectTool` 主动管理工具 | 观察一周再决定 |
| CCB | `DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000` 全局 cap | 我们偏保守，落盘当常态不符合 evalyst context budget |
| hermes | `ContextEngine` 可插拔抽象 | 单 engine YAGNI 仍成立 |
| hermes | `SUMMARY_PREFIX` handoff framing | 当前 session 短，boundary 不需要 summary |
| hermes | image 补偿 1600 tokens | v0.9.0 没 image 流量 |
| hermes | 4-breakpoint 显式 cache_control | 留 PR2 做 |
| openclaw | 另外 4 个 break reason（model/retention/transport/streamStrategy） | 单 provider 单 session 用不上 |
| openclaw | `rewriteTranscriptEntries` 持久化压缩 | 改 append-only 语义需慎重，观察后再定 |
| openclaw | 文件级 `data/copilot/permissions.json` | PR3 做（本 PR 只 sessionStorage） |
| openclaw | `alwaysAsk` 规则类型 | YAGNI，默认行为已经是 ask on destructive |

## 9. 完成标准

- [ ] 所有新增测试绿（单测 + integration）
- [ ] `npx tsc --noEmit` 零 error
- [ ] `npm run lint` 零 warning（新代码）
- [ ] `npm run build` 成功
- [ ] `npm test` 全部 221+N 条通过（N = 本 PR 新增 case 数）
- [ ] 手动回归 §5.3 六条全过
- [ ] CHANGELOG `[Unreleased]` 段补好
- [ ] PR description 含 "改了什么 / 为什么 / 怎么验证 / 向后兼容风险" 四段

## 10. 预估工时

- approxTokens 分岔 + image 补偿：45 min
- detectCacheBreak + UI chip 第三段：60 min
- session_deny_list 对称 + hook 短路 + UI checkbox：75 min
- chain cap 机制替换 + warn UI（SSE 事件 + system_notice bubble + i18n）：120 min
- 测试 + 手动回归 + PR：60 min
- **合计 ~6 小时**（warn UI 是新出来的额外 scope）
