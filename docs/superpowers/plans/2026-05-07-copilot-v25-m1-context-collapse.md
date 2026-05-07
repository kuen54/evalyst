# Copilot v2.5 · M1 Context 收敛 + M2 压缩边界 & cache 遥测 + M3 alwaysAllow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **PR 边界**：M1（Task 1-9）/ M2（Task 10-17）/ M3（Task 18-21）是三个独立 PR。M2 依赖 M1 已落 main（Task 11 改 `microCompact` 返回签名，基于 M1 Task 8 的 token 阈值版本）。M3 独立于 M1/M2，但建议放在最后（顺路 polish UX）。**Task 22**（e2e 务实子集）可在 M3 PR 末尾顺带合入，或单独一个 `test/` 小 PR。

**Goal:**
- **M1 · Context 收敛**：让 Copilot 圈选 / `read_page` / `read_context` 三条路径默认返回结构化 manifest（≤300 chars），不再 dump `input_preview` / `prompt_template` / JSX 源码；新加 `read_dataset_records` 工具供 LLM 按需拉数据集 records；划线降权改成 Inspector 模式互斥 + chip 主语换成 host；microCompact 增加 token 阈值。
- **M2 · 压缩边界 & cache 遥测**：transcript 引入 `role: 'system', kind: 'compact_boundary'` 消息，build-llm-messages 切到 boundary 之后组装（O(n) → O(since-boundary)）；每次 LLM 调用抽 `cache_creation / cache_read` 落盘 `data/copilot/cache-stats.jsonl`，chat-view 顶部加 mini chip 显示「本 session X% · 近 7 天 Y%」。
- **M3 · 会话级 alwaysAllow**：Confirm 卡加「本次会话信任此工具」checkbox，sessionStorage 持久化（per-tab，per-session）；勾选 + 确认后同工具下次调用不再弹 Confirm，直接 auto-run。**双层短路**：客户端 SSE handler 在 `needsConfirm()` 处先查 sessionStorage（实际生效层）；服务端 `confirmGateHook` 同时读 body.`session_allow_list` 短路（防御层 + 未来 `/chat` 内执行工具时立刻生效）。

**Architecture:**
- **M1**：抽公共 `manifest.ts`（per-type 纯函数）作为 self / parent 形态的真理来源，圈选路径（`resolveContextSelf` + `resolveContextById`）和查询路径（`read_page`）共享调用。`read_dataset_records` 走标准 v2 ToolDescriptor 模式（read-only，不弹 Confirm，metadata.maxResultSizeChars=8000）。`microCompact` 在最近 N 条之外加 token 累积阈值，签名向后兼容。划线降权改 4 行 + 删 4 行 + chip 渲染重构。
- **M2**：新 `boundary.ts` 导出纯函数 `sliceAfterBoundary(branch)`；`microCompact` 返回签名改为 `{messages, didCompact}`（breaking，仅 1 个生产 caller）；`session-store.ts` 加 `appendCompactBoundary` 复用 `appendMessage`（方案 A：boundary 接 parent 链 + head 跟，多分支语义自然继承）；`buildLlmMessages` 加可选 `opts.sessionId`，仅生产时触发 boundary 落盘，测试路径保持纯函数。Cache 遥测独立 `cache-stats-store.ts`（append-only jsonl + 按 provider 分桶的 hit rate 聚合），chat-view 顶部挂 `CacheStatsChip` 组件，GET `/api/copilot/cache-stats` 聚合返 `{session, weekly}`。
- **M3**：新 `session-allow.ts` 纯函数模块（`getSessionAllowList` / `addSessionAllow` 客户端 only + `isSessionAllowed` 客户端 + 服务端共用纯函数）。客户端：`tool-call-card.tsx` 的 `WriteVariant` 加 `<Checkbox>`，`onConfirm` 签名改 `(alwaysAllow: boolean) => void`；`use-chat-stream.ts` 的 `confirmTool` 签名扩 `alwaysAllow`，勾选时先 `addSessionAllow`；SSE handler 的 `tool_use_end` 处加 `isSessionAllowed` 短路（关键 UX）；`postToolResult` / `send` body 加 `session_allow_list: getSessionAllowList(sid)`（每次重读，spec 一致）。服务端：`PreToolCallCtx` 扩 `session_allow_list?: string[]`；`confirmGateHook` 命中 allow list 直接 proceed（防御层，当前 `/tool-result` 走 `skipConfirm: true` 不读，留给未来）。

**Tech Stack:** TypeScript / Next.js 16 (App Router) / vitest（纯函数单测）/ shadcn/ui v4 + Tailwind v4 / 自建 i18n（`useT()`）。

**Spec:** `docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md` §3 / §4（M1）+ §5 / §6（M2）+ §8（M3）。

---

## File Structure

### M1 · Context 收敛

**新建：**
- `src/lib/copilot/manifest.ts` — 9 种 context type 的 self / parent manifest 纯函数 + dispatcher
- `src/lib/copilot/__tests__/manifest.test.ts` — manifest 表驱动单测
- `src/lib/copilot/tools/read-dataset-records.ts` — 新工具，读 dataset records（按 task_id 单条 / 分页）
- `src/lib/copilot/tools/__tests__/read-dataset-records.test.ts` — 工具单测

**修改：**
- `src/lib/copilot/resolve-context.ts` — `resolveContextSelf` + `resolveContextById` 改用 manifest（圈选路径 / read_context 工具路径）
- `src/lib/copilot/tools/read-page.ts` — `matches[].content_tree` 改用 manifest（查询路径）
- `src/lib/copilot/tools/registry.ts` — 注册 `readDatasetRecordsTool`
- `src/lib/copilot/tools/metadata-client.ts` — 镜像新工具 metadata
- `src/components/copilot/tool-call-card.tsx` — `VARIANT_BY_TOOL` 加 `read_dataset_records: 'retrieval'`
- `src/lib/copilot/micro-compact.ts` — 新增 `maxTotalReplayableTokens` 选项
- `src/lib/copilot/__tests__/micro-compact.test.ts` — token 阈值新测
- `src/components/copilot/text-selector.tsx` — 解构 `inspectorActive`，`enabled = open && !inspectorActive`
- `src/components/copilot/inspector-overlay.tsx` — 删 drag-select 让位 4 行
- `src/components/copilot/context-chip-rail.tsx` — `text_selection` chip 主语换成 host
- `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts` — 新 chip i18n key
- `src/lib/copilot/__tests__/read-context.test.ts` — task_field/task_result 的 self/parent 形态断言更新（manifest 化）
- `src/lib/copilot/tools/__tests__/read-page.test.ts`（如存在）— `content_tree` shape 改成 manifest
- `CHANGELOG.md` — `[Unreleased]` 段加 v2.5 M1 条目

### M2 · 压缩边界 & cache 遥测

**新建：**
- `src/lib/copilot/boundary.ts` — `sliceAfterBoundary(branch)` 纯函数
- `src/lib/copilot/__tests__/boundary.test.ts` — sliceAfterBoundary 单测
- `src/lib/copilot/cache-stats-store.ts` — `CacheUsageStat` 类型 + `appendCacheStat` + `readCacheStats` + `aggregateCacheHitRate`
- `src/lib/copilot/__tests__/cache-stats-store.test.ts` — 落盘 / 聚合纯函数单测
- `src/app/api/copilot/cache-stats/route.ts` — GET 聚合 `{session, weekly}` API
- `src/components/copilot/cache-stats-chip.tsx` — 顶部 mini chip（本 session · 近 7 天 · hover tooltip）

**修改：**
- `src/lib/copilot/types.ts` — `CopilotRole` 加 `'system'`；`CopilotMessage` 加可选 `kind` / `at` / `reason`；`StreamEvent.done.usage` 扩 `cache_creation_tokens?` / `cache_read_tokens?`
- `src/lib/copilot/session-store.ts` — `AppendMessageInput` 扩 `kind/at/reason`；`appendMessage` 写入；新增 `appendCompactBoundary(sessionId, opts?)` 薄包装
- `src/lib/copilot/micro-compact.ts` — 返回签名改 `{messages, didCompact}`（breaking）
- `src/lib/copilot/build-llm-messages.ts` — 加 `opts.sessionId`；集成 `sliceAfterBoundary` + 条件 `appendCompactBoundary`；for 循环加显式 `else if (m.role === 'system') continue`
- `src/lib/copilot/stream-response.ts` — `buildLlmMessages` 调用传 `sessionId`；append assistant 后调 `appendCacheStat`
- `src/lib/copilot/llm-stream.ts` — `parseAnthropicEvent` 抽 `cache_creation_input_tokens` / `cache_read_input_tokens`；`parseOpenaiEvent` 抽 `prompt_tokens_details.cached_tokens`；usage accumulator 扩
- `src/lib/copilot/__tests__/micro-compact.test.ts` — 9 existing + Task 8 新加 2 个 case 全部解构新返回
- `src/lib/copilot/__tests__/build-llm-messages.test.ts` — 新增 boundary 流 + sessionId 集成测
- `src/lib/copilot/__tests__/session-store.test.ts` — `appendCompactBoundary` 测
- `src/components/copilot/chat-view.tsx` — 顶部挂 `<CacheStatsChip sessionId={...} />`
- `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts` — 新增 `copilot.cache.*` 命名空间
- `CHANGELOG.md` — `[Unreleased]` M1 条目下新增 M2 子条目

### M3 · 会话级 alwaysAllow

**新建：**
- `src/lib/copilot/session-allow.ts` — sessionStorage helper（`getSessionAllowList` / `addSessionAllow` client only）+ 纯函数 `isSessionAllowed(allowList, toolName)`（client + server 共用）
- `src/lib/copilot/__tests__/session-allow.test.ts` — `isSessionAllowed` 纯函数测（`undefined` / 空数组 / 命中 / 不命中）

**修改：**
- `src/lib/copilot/tools/hooks.ts` — `PreToolCallCtx` 扩 `session_allow_list?: string[]`；`confirmGateHook` 命中 allow list 直接 proceed
- `src/lib/copilot/tool-runtime.ts` — `runTool` 的 `opts` 加 `sessionAllowList?: string[]`，构造 `PreToolCallCtx` 时透传
- `src/app/api/copilot/sessions/[id]/chat/route.ts` — body schema 加 `session_allow_list?: string[]`（spec 一致；当前 `/chat` 不调 runTool，写死 spec 接口为未来留 hook）
- `src/app/api/copilot/sessions/[id]/tool-result/route.ts` — body schema 加 `session_allow_list?: string[]`，`runTool` 调用时传给 opts
- `src/components/copilot/tool-call-card.tsx` — `WriteVariant` 加 `<Checkbox>` "本次会话信任此工具"，`Props.onConfirm` 签名改 `(alwaysAllow: boolean) => void`
- `src/components/copilot/use-chat-stream.ts` — `confirmTool` 签名扩 `alwaysAllow`，勾选时调 `addSessionAllow`；SSE `tool_use_end` 在 line 238 那处的 `if (!needsConfirm(...))` 改成 `if (!needsConfirm(...) || isSessionAllowed(getSessionAllowList(sid), tool_name))`（**核心客户端短路**）；`postToolResult` 和 `send` 的 fetch body 加 `session_allow_list: getSessionAllowList(sid)`
- `src/components/copilot/chat-view.tsx` — `confirmTool` prop 透传链路适配新签名
- `src/lib/copilot/tools/__tests__/hooks.test.ts`（如已存在）— `confirmGateHook` 命中 allow list 时返 proceed 的新测
- `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts` — 新加 `copilot.tool.always_allow` / `copilot.tool.always_allow_label` 等
- `CHANGELOG.md` — `[Unreleased]` M2 条目下追加 M3 子条目

**注意现状偏差（实施前先读）：**
1. spec §3.2 表写"8 种"实际有 **9 种**（多 `text_selection`，spec 自己最后一行也列了），manifest dispatcher 必须覆盖 9 个分支
2. spec §3.2 experiment manifest 写 `dataset_id` 字段，**ExperimentConfig 实际没这个字段**（dataset 通过 `schema.inputs[].dataset_id` 关联）。Plan 实施时 manifest 不放 `dataset_id`；如 LLM 需要，走 `read_resource("template", schema_id)` 拿 inputs 里的 dataset_id
3. `inspectorActive` 在 `src/components/copilot/store.tsx` line 37 / 274 已经存在，无需新增 store 字段
4. `formatContextsForLlm` 当前**仅** `/api/copilot/contexts/resolve` route 调用（chip preview），不再走 LLM messages 组装路径——manifest 改完 chip preview 自动同步，无需单独改 API route
5. `getDataset(id)` 文件缺失时**抛 Error 而非返 null**，参考 `tools/read-resource.ts:23-29` 的 try/catch 包法
6. **M2 方案 A**（boundary 接 parent 链 + head 跟）是设计关键选择：复用 `appendMessage` 全部已有 race fix（`fs.appendFileSync` 原子 append + `updateSession` 原子写），多分支语义自然继承。方案 B（boundary 不接 parent）会污染多分支语义且需要全表扫——**不采用**
7. **Cache hit rate 按 provider 分桶**：Anthropic 的 `input_tokens` 不含 `cache_read_input_tokens`，分母 = `input + cache_read + cache_creation`；OpenAI 的 `prompt_tokens`（映射为 `input_tokens`）已含 `cached_tokens`，分母 = `input_tokens`。一个公式套两端会把 OpenAI 的 hit rate 算小一倍
8. **`provider` 字段简化为 `'anthropic' | 'openai'`**（与 `api_format` 对齐，Gemini 走 OpenAI 兼容层。spec §6.1 写 `'gemini'` 是照抄三 repo 列表，落地降到 2 项足够）
9. chat-view **顶部没有现成 chip rail**（底部才有），spec §6.4 说的"顶部 chip rail 旁边"实际是**新增**顶部 mini status 区
10. **M3 spec §8.5 写"服务端 confirmGateHook 短路"实际是死代码**：`/tool-result` route 用 `skipConfirm: true`（避免 confirm 死锁），hook 当前根本不被调用。**实际生效层是客户端 `use-chat-stream.ts` SSE handler**（line ~238 的 `needsConfirm()` 判断处）。Plan 落"双层短路"：客户端为主（实际生效）+ 服务端 hook 为防御（spec 一致 + 未来 `/chat` 内执行工具时立刻生效）
11. **M3 没有独立 `tool-confirm` route**：confirm/deny 决策都通过 `/tool-result` 表达（Confirm = `denied:false`，Deny = `denied:true,reason:...`）。alwaysAllow 写入 sessionStorage 的时机在 `useChatStream.confirmTool` 内部，传入 `addSessionAllow(sid, tool_name)`，**不需要新加 route**
12. **shadcn `Checkbox` 组件**应已在 `src/components/ui/checkbox`；如缺失 `npx shadcn@latest add checkbox` 即可
13. **M1 spec §3.2 `metrics` 抽象被展平**：spec 表 `task_result` 和 `task_field` 的 self/parent 都写"metrics"作为聚合概念，但 `GenericResultRecord` 实际是**扁平字段** `latency_ms / input_tokens? / output_tokens? / cost_value? / cost_currency?`（不是嵌套 `cost: {value, currency}` / `usage: {input_tokens, output_tokens}`）。Plan Task 1 的 `TaskResultManifest` / `TaskFieldTaskMeta` 直接用扁平字段
14. **M1 spec §3.2 template manifest `model` 字段实际 TaskSchema 没有**（`model` 在 ExperimentConfig 上，不在 TaskSchema）。Plan Task 1 的 `TemplateManifest` 从 manifest 中 drop。同时 spec 写的 `prompt_template` 实际 TaskSchema 字段叫 **`default_prompt`**；`output_schema` 是 `JsonSchemaDef`，输出字段名在 `.properties` 子对象的 keys
15. **M1 spec §3.2 display 字段假设 `columns` / `dimensions` 顶层**，实际 `Display.mode` 是**4 种** union（`'builtin' | 'table' | 'grouped_grid' | 'jsx'`），columns 在 `display.table.columns`，grouped_grid 走 `display.grouped_grid.cell_columns`。Plan Task 1 的 `manifestDisplay` 按 mode 分支取 dimension_count；`'builtin' / 'jsx'` 返 0
16. **M3 spec §8.3 数据结构 `{tool_name, granted_at}` 简化为 `string[]`**：plan Task 18 的 sessionStorage 只存工具名数组，drop `granted_at` 时间戳（UI 不消费时间，spec 8.4 mock 也未展示）。如未来想做"信任 X 天后过期"才需要补
17. **M3 spec §8.5 `isSessionAllowed(session_id, tool_name)` 改为纯函数 `isSessionAllowed(allowList, toolName)`**：架构改进让 client + server 共用一个判断函数；服务端从 body.session_allow_list 读出后调，客户端从 sessionStorage 读出后调，纯函数无副作用。spec 字面签名是按 sid 查询，plan 按"已查到的数组"判断
18. **M2 spec §6.4 vs §9.3 内部矛盾**：§6.4 明确"不新建 `/settings/copilot` 路由（YAGNI）"，§9.3 又提"7 天趋势卡上线后从那一刻开始累计"。Plan 采纳 §6.4 方案——只做顶部 mini chip + hover tooltip，**不**做趋势卡 / 不新建路由。`/api/copilot/cache-stats` GET 返聚合数据足够 chip 消费
19. **Spec §12 Q2 manifest 放置策略微调**：spec 倾向"manifest 写在 `resolveContextSelf` 各 case 里直接构造"（Q2 答案）；plan 抽到独立 `src/lib/copilot/manifest.ts`（Task 1）作为公共纯函数，`resolveContextSelf` / `resolveContextById` / `read_page` 三条路径共用调用。理由：测试更好写 + DRY + `read_page` 与 resolve 路径语义对齐（spec §3.6 也要求 read_page 走同样 manifest）。这是实现优化，不是偏离设计意图
20. **Task 13 stream-response 局部类型联动**：`RunStreamResult.usage`（L49）+ helper 内部 `assistantUsage`（L67）的局部类型必须在 Task 13 Step 1 同步扩 cache 字段，否则 Task 15 Step 1 的 `assistantUsage?.cache_creation_tokens` 会 tsc fail（`StreamEvent.done.usage` 单独扩不够）。Task 13 Step 1 已包含这两处改动

---

## Commit Convention（适用于所有 Task 的 commit 步骤）

每个 Task 末尾的 `git commit` 步骤示例都用了**单行 `git commit -m "..."`**。落地时按本仓库 AGENTS.md 习惯统一改成 **HEREDOC 格式 + Co-Authored-By trailer**：

```bash
git commit -m "$(cat <<'EOF'
feat(copilot): <subject from plan>

<optional body explaining "why" rather than "what">

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Type prefixes**（来自 AGENTS.md 约定）：`feat` / `fix` / `refactor` / `tune` / `docs` / `chore` / `test` / `perf`。本 plan 22 个 commit 的 type 已经在每个 step 给定，落地时只需把单行改成 HEREDOC。

---

## Task 1: 抽 `manifestForType` 公共纯函数

**Files:**
- Create: `src/lib/copilot/manifest.ts`
- Create: `src/lib/copilot/__tests__/manifest.test.ts`

> **实现基于实际 TypeScript 类型定义（而非 spec §3.2 字面表）**。关键偏差在 plan 顶部"注意现状偏差 #2/#13/#14/#15"已明列：
> - `GenericResultRecord` 是**扁平字段** `input_tokens? / output_tokens? / cost_value? / cost_currency?`（不是嵌套 `cost: {value, currency}` / `usage: {...}`）—— spec §3.2 的 "metrics" 抽象展平成 5 个字段
> - `TaskSchema` 字段实际叫 **`default_prompt`**（不是 `prompt_template`）；**没有 `model` 字段**（model 在 ExperimentConfig 上）
> - `TaskSchema.output_schema` 是 `JsonSchemaDef { type?, required?, properties?, description? }`，输出字段名在 `.properties` 子对象的 keys，不是顶层 keys
> - `Display.mode` union 实际 **4 种** `'builtin' | 'table' | 'grouped_grid' | 'jsx'`；columns 在 `display.table.columns`，不在 `display.columns` 顶层；`grouped_grid` 走 `display.grouped_grid.cell_columns`
> - `ExperimentConfig.schema_id?: string`（optional），返回类型字段同步标 optional
> - `RunStats` 字段是 `total_tasks / completed_tasks / failed_tasks / started_at / ...`（非 `total/success/failed`）

- [ ] **Step 1: 写 failing test**

```typescript
// src/lib/copilot/__tests__/manifest.test.ts
import { describe, it, expect } from 'vitest'
import {
  manifestExperiment,
  manifestTaskResult,
  manifestTaskField,
  manifestDataset,
  manifestTemplate,
  manifestDisplay,
  manifestRubric,
} from '../manifest'
import type { ExperimentConfig } from '@/lib/types'
import type {
  GenericResultRecord,
  TaskSchema,
  Display,
  Rubric,
  DatasetDef,
} from '@/lib/schema/types'

describe('manifestExperiment', () => {
  it('drops prompt_template / notes / temperature / api_config / max_tokens', () => {
    const exp: ExperimentConfig = {
      id: 'exp_1', name: 'Exp',
      created_at: 't', updated_at: 't',
      status: 'completed',
      schema_id: 'sch_1', display_id: 'disp_1', rubric_id: 'rub_1',
      model_id: 'mod_1',
      model: 'gpt-4o', temperature: 0.7, max_tokens: 2000,
      api_config: { base_url: 'https://x', api_key: 'SECRET_KEY' },
      prompt_template: 'SECRET_PROMPT',
      run_stats: {
        total_tasks: 10, completed_tasks: 9, failed_tasks: 1,
        started_at: 't',
      },
      notes: 'SECRET_NOTES',
    }
    const out = manifestExperiment(exp)
    expect(out).toEqual({
      id: 'exp_1', name: 'Exp', status: 'completed',
      schema_id: 'sch_1', display_id: 'disp_1', rubric_id: 'rub_1',
      model: 'gpt-4o',
      run_stats: {
        total_tasks: 10, completed_tasks: 9, failed_tasks: 1,
        started_at: 't',
      },
    })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
})

describe('manifestTaskResult', () => {
  const found: GenericResultRecord = {
    schema_id: 'sch_1', schema_version: 1,
    task_id: 't1', experiment_id: 'exp_1',
    input_refs: { ds: 'r1' },
    input_preview: { qa: 'SENSITIVE_RAW' },
    status: 'success',
    output: { answer: 'yes' },
    latency_ms: 120,
    model: 'gpt-4o',
    timestamp: 't',
    input_tokens: 50, output_tokens: 10,
    cost_value: 0.001, cost_currency: 'USD',
  }

  it('self: flat metrics; drops input_preview / input_refs / raw_response / model', () => {
    const out = manifestTaskResult(found, 'self')
    expect(out).toEqual({
      task_id: 't1', status: 'success',
      output: { answer: 'yes' },
      latency_ms: 120,
      input_tokens: 50, output_tokens: 10,
      cost_value: 0.001, cost_currency: 'USD',
    })
    expect(JSON.stringify(out)).not.toContain('SENSITIVE_RAW')
  })

  it('self: failed task has error, no output', () => {
    const failed: GenericResultRecord = {
      ...found, status: 'error', output: undefined, error: 'boom',
    }
    const out = manifestTaskResult(failed, 'self')
    expect(out).toMatchObject({ task_id: 't1', status: 'error', error: 'boom' })
    expect((out as Record<string, unknown>).output).toBeUndefined()
  })

  it('parent: appends experiment summary (4 fields), not full exp', () => {
    const exp: ExperimentConfig = {
      id: 'exp_1', name: 'Exp',
      created_at: 't', updated_at: 't',
      status: 'completed', schema_id: 'sch_1',
      model: 'gpt-4o', temperature: 0.7, max_tokens: 2000,
      api_config: { base_url: 'https://x', api_key: 'secret' },
      prompt_template: 'SECRET_PROMPT',
    }
    const out = manifestTaskResult(found, 'parent', exp)
    expect((out as { experiment: unknown }).experiment).toEqual({
      id: 'exp_1', name: 'Exp', schema_id: 'sch_1', model: 'gpt-4o',
    })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
})

describe('manifestTaskField', () => {
  it('self only has targeted_field + targeted_value', () => {
    expect(manifestTaskField('output.answer', 'yes', 'self')).toEqual({
      targeted_field: 'output.answer', targeted_value: 'yes',
    })
  })

  it('parent appends flat task_meta, no input_preview', () => {
    const out = manifestTaskField('output.answer', 'yes', 'parent', {
      task_id: 't1', status: 'success',
      latency_ms: 120,
      input_tokens: 50, output_tokens: 10,
      cost_value: 0.001, cost_currency: 'USD',
    })
    expect(out).toEqual({
      targeted_field: 'output.answer', targeted_value: 'yes',
      task_meta: {
        task_id: 't1', status: 'success',
        latency_ms: 120,
        input_tokens: 50, output_tokens: 10,
        cost_value: 0.001, cost_currency: 'USD',
      },
    })
    expect(JSON.stringify(out)).not.toContain('input_preview')
  })
})

describe('manifestDataset', () => {
  it('returns id/name/fields/total_records, no sample', () => {
    const def: DatasetDef = {
      id: 'ds_1', name: 'QA',
      source: 'upload',
      id_field: 'qa',
      fields: [{ key: 'qa', type: 'string' }, { key: 'q', type: 'string' }],
    }
    expect(manifestDataset(def, 12)).toEqual({
      id: 'ds_1', name: 'QA',
      fields: [{ key: 'qa', type: 'string' }, { key: 'q', type: 'string' }],
      total_records: 12,
    })
  })
})

describe('manifestTemplate', () => {
  it('excerpt truncated to 300; variable_names from variables[].name; output fields from output_schema.properties', () => {
    const longPrompt = 'a'.repeat(500)
    const schema: TaskSchema = {
      id: 'sch_1', label: 'QA', description: 'desc', version: 1,
      inputs: [],
      variables: [
        { name: 'q', source: 'item.q' },
        { name: 'topic', source: 'item.topic' },
      ],
      default_prompt: longPrompt,
      message_builder: { user_template: 'user {{q}}' },
      output_schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    }
    const out = manifestTemplate(schema)
    expect(out.id).toBe('sch_1')
    expect(out.label).toBe('QA')
    expect(out.description).toBe('desc')
    expect(out.prompt_template_excerpt.length).toBe(300)
    expect(out.variable_names).toEqual(['q', 'topic'])
    expect(out.output_field_names).toEqual(['answer', 'confidence'])
    // TaskSchema 无 model 字段，manifest 不含
    expect(out).not.toHaveProperty('model')
    // 全量 prompt 不泄露
    expect(JSON.stringify(out)).not.toContain(longPrompt)
  })

  it('handles output_schema without properties (only type)', () => {
    const schema: TaskSchema = {
      id: 's', label: 'S', version: 1,
      inputs: [], variables: [],
      default_prompt: 'x',
      message_builder: {},
      output_schema: { type: 'object' },   // no properties
    }
    const out = manifestTemplate(schema)
    expect(out.output_field_names).toEqual([])
  })
})

describe('manifestDisplay', () => {
  it('table mode: dimension_count from table.columns', () => {
    const d: Display = {
      id: 'disp_1', name: 'Tbl', source: 'user', mode: 'table',
      table: {
        columns: [
          { field: 'a', label: 'A' },
          { field: 'b', label: 'B' },
          { field: 'c', label: 'C' },
        ],
      },
    }
    expect(manifestDisplay(d)).toEqual({
      id: 'disp_1', name: 'Tbl', mode: 'table', dimension_count: 3,
    })
  })

  it('grouped_grid mode: dimension_count from cell_columns', () => {
    const d: Display = {
      id: 'disp_2', name: 'GG', source: 'user', mode: 'grouped_grid',
      grouped_grid: {
        primary_group: { field: 'p' },
        secondary_group: { field: 's' },
        cell_columns: [
          { field: 'x', label: 'X' },
          { field: 'y', label: 'Y' },
        ],
      },
    }
    expect(manifestDisplay(d)).toMatchObject({ mode: 'grouped_grid', dimension_count: 2 })
  })

  it('jsx mode: source code not leaked; dimension_count 0', () => {
    const d: Display = {
      id: 'disp_3', name: 'Custom', source: 'user', mode: 'jsx',
      jsx: { source: 'SENSITIVE_JSX_FUNCTION_BODY' },
    }
    const out = manifestDisplay(d)
    expect(out).toEqual({ id: 'disp_3', name: 'Custom', mode: 'jsx', dimension_count: 0 })
    expect(JSON.stringify(out)).not.toContain('SENSITIVE')
  })

  it('builtin mode: dimension_count 0 (no columns concept)', () => {
    const d: Display = {
      id: 'disp_4', name: 'B', source: 'builtin', mode: 'builtin',
      builtin_component: 'single_list',
    }
    expect(manifestDisplay(d)).toMatchObject({ mode: 'builtin', dimension_count: 0 })
  })
})

describe('manifestRubric', () => {
  it('criteria_summary keeps only key/type/label, drops description/required', () => {
    const r: Rubric = {
      id: 'rub_1', name: 'Acc',
      criteria: [
        { key: 'correct', type: 'pass_fail', label: 'Correct', description: 'long...', required: true },
        { key: 'cal', type: 'likert_1_5', label: 'Cal', description: 'long...' },
      ],
    }
    expect(manifestRubric(r)).toEqual({
      id: 'rub_1', name: 'Acc',
      criteria_summary: [
        { key: 'correct', type: 'pass_fail', label: 'Correct' },
        { key: 'cal', type: 'likert_1_5', label: 'Cal' },
      ],
    })
  })
})
```

- [ ] **Step 2: 跑测试确认全部 fail**

```bash
npx vitest run src/lib/copilot/__tests__/manifest.test.ts
```

Expected: FAIL — `Cannot find module '../manifest'`。

- [ ] **Step 3: 写 manifest.ts**

```typescript
// src/lib/copilot/manifest.ts
//
// Per-type self/parent manifest 纯函数。spec §3.2 表的代码实质化。
// resolveContextSelf / resolveContextById / read_page 共享这一组 shaper。
//
// 设计原则（spec §3 第 3 条）：input_preview / prompt_template / JSX 源码等
// 大字段一律不进 manifest；LLM 想看走专用工具 (read_resource / read_dataset_records)。
//
// ---- 与 spec §3.2 的字段层面偏差（以实际 TypeScript 类型定义为准）----
// - task_result / task_field 的 "metrics" 抽象被展平为
//   latency_ms / input_tokens / output_tokens / cost_value / cost_currency
//   （GenericResultRecord 实际是扁平字段，非嵌套 cost/usage 对象）
// - template manifest 的 "model" 字段 drop（TaskSchema 无此字段；model 属于 ExperimentConfig）
// - experiment manifest 的 "dataset_id" drop（ExperimentConfig 无此字段；通过 schema.inputs[].dataset_id 关联）
// - display.mode 实际 4 种（builtin|table|grouped_grid|jsx），dimension_count 按 mode 分支取
//   table → table.columns.length; grouped_grid → grouped_grid.cell_columns.length; 其他 0

import type { ExperimentConfig, RunStats, ExperimentStatus } from '@/lib/types'
import type {
  GenericResultRecord,
  ResultStatus,
  TaskSchema,
  Display,
  DatasetDef,
  FieldDef,
  Rubric,
} from '@/lib/schema/types'

export type ManifestScope = 'self' | 'parent'

// ---------- experiment ----------

export interface ExperimentManifest {
  id: string
  name: string
  status: ExperimentStatus
  schema_id?: string        // ExperimentConfig.schema_id 是 optional
  display_id?: string
  rubric_id?: string
  model: string
  run_stats?: RunStats
}

export function manifestExperiment(exp: ExperimentConfig): ExperimentManifest {
  return {
    id: exp.id,
    name: exp.name,
    status: exp.status,
    schema_id: exp.schema_id,
    display_id: exp.display_id,
    rubric_id: exp.rubric_id,
    model: exp.model,
    run_stats: exp.run_stats,
  }
}

// ---------- task_result ----------

export interface TaskResultManifest {
  task_id: string
  status: ResultStatus
  output?: Record<string, unknown>
  error?: string
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  cost_value?: number
  cost_currency?: string
}

export interface TaskResultManifestParent extends TaskResultManifest {
  experiment: {
    id: string
    name: string
    schema_id?: string
    model: string
  }
}

export function manifestTaskResult(
  found: GenericResultRecord,
  scope: ManifestScope,
  experiment?: ExperimentConfig | null,
): TaskResultManifest | TaskResultManifestParent {
  const self: TaskResultManifest = {
    task_id: found.task_id,
    status: found.status,
    output: found.status === 'success' ? found.output : undefined,
    error: found.error,
    latency_ms: found.latency_ms,
    input_tokens: found.input_tokens,
    output_tokens: found.output_tokens,
    cost_value: found.cost_value,
    cost_currency: found.cost_currency,
  }
  if (scope === 'parent' && experiment) {
    return {
      ...self,
      experiment: {
        id: experiment.id,
        name: experiment.name,
        schema_id: experiment.schema_id,
        model: experiment.model,
      },
    }
  }
  return self
}

// ---------- task_field ----------

export interface TaskFieldTaskMeta {
  task_id: string
  status: ResultStatus
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  cost_value?: number
  cost_currency?: string
}

export interface TaskFieldManifest {
  targeted_field: string
  targeted_value: unknown
}

export interface TaskFieldManifestParent extends TaskFieldManifest {
  task_meta: TaskFieldTaskMeta
}

export function manifestTaskField(
  field: string,
  value: unknown,
  scope: ManifestScope,
  taskMeta?: TaskFieldTaskMeta,
): TaskFieldManifest | TaskFieldManifestParent {
  const self: TaskFieldManifest = { targeted_field: field, targeted_value: value }
  if (scope === 'parent' && taskMeta) {
    return { ...self, task_meta: taskMeta }
  }
  return self
}

// ---------- dataset ----------

export interface DatasetManifest {
  id: string
  name: string
  fields: FieldDef[]
  total_records: number
}

export function manifestDataset(def: DatasetDef, total_records: number): DatasetManifest {
  return {
    id: def.id,
    name: def.name,
    fields: def.fields,
    total_records,
  }
}

// ---------- template (TaskSchema) ----------

const PROMPT_EXCERPT_LIMIT = 300

export interface TemplateManifest {
  id: string
  label: string
  description?: string
  prompt_template_excerpt: string
  variable_names: string[]
  output_field_names: string[]
}

export function manifestTemplate(schema: TaskSchema): TemplateManifest {
  const prompt = schema.default_prompt ?? ''
  const variables = schema.variables ?? []
  const properties = schema.output_schema?.properties ?? {}
  return {
    id: schema.id,
    label: schema.label,
    description: schema.description,
    prompt_template_excerpt: prompt.slice(0, PROMPT_EXCERPT_LIMIT),
    variable_names: variables.map((v) => v.name),
    output_field_names: Object.keys(properties),
  }
}

// ---------- display ----------

export interface DisplayManifest {
  id: string
  name: string
  mode: Display['mode']
  dimension_count: number
}

export function manifestDisplay(d: Display): DisplayManifest {
  let dimension_count = 0
  if (d.mode === 'table') {
    dimension_count = d.table?.columns.length ?? 0
  } else if (d.mode === 'grouped_grid') {
    dimension_count = d.grouped_grid?.cell_columns.length ?? 0
  }
  // 'builtin' / 'jsx' 无 columns 概念，保持 0
  return {
    id: d.id,
    name: d.name,
    mode: d.mode,
    dimension_count,
  }
}

// ---------- rubric ----------

export interface RubricManifest {
  id: string
  name: string
  criteria_summary: Array<{
    key: string
    type: string
    label: string
  }>
}

export function manifestRubric(r: Rubric): RubricManifest {
  return {
    id: r.id,
    name: r.name,
    criteria_summary: r.criteria.map((c) => ({
      key: c.key,
      type: c.type,
      label: c.label,
    })),
  }
}
```

- [ ] **Step 4: 跑测试**

```bash
npx vitest run src/lib/copilot/__tests__/manifest.test.ts
```

Expected: 11 passed (manifestExperiment ×1, manifestTaskResult ×3, manifestTaskField ×2, manifestDataset ×1, manifestTemplate ×2, manifestDisplay ×4, manifestRubric ×1)。

- [ ] **Step 5: 跑 tsc + 提交**

```bash
npx tsc --noEmit
git add src/lib/copilot/manifest.ts src/lib/copilot/__tests__/manifest.test.ts
git commit -m "feat(copilot): add manifest.ts pure shapers for v2.5 context collapse"
```

---

## Task 2: `resolveContextSelf` 改用 manifest

**Files:**
- Modify: `src/lib/copilot/resolve-context.ts:25-180`

- [ ] **Step 1: 写一个先 fail 的集成测**

在 `src/lib/copilot/__tests__/resolve-context.test.ts` 末尾追加 describe block（保留现有 `formatContextsForLlm` 测）：

```typescript
// 追加到 src/lib/copilot/__tests__/resolve-context.test.ts 末尾
import { resolveContexts } from '../resolve-context'
import { vi } from 'vitest'

vi.mock('@/lib/store', () => ({
  getExperiment: (id: string) => id === 'exp_1' ? {
    id, name: 'E',
    created_at: 't', updated_at: 't',
    status: 'completed',
    schema_id: 'sch_1', display_id: 'disp_1', rubric_id: 'rub_1',
    model: 'gpt-4o', temperature: 0.7, max_tokens: 2000,
    api_config: { base_url: 'https://x', api_key: 'SECRET_KEY' },
    prompt_template: 'SECRET_PROMPT',
    run_stats: {
      total_tasks: 1, completed_tasks: 1, failed_tasks: 0,
      started_at: 't',
    },
    notes: 'SECRET_NOTES',
  } : null,
  readResults: (expId: string) => expId === 'exp_1' ? [{
    schema_id: 'sch_1', schema_version: 1,
    task_id: 't1', experiment_id: 'exp_1',
    input_refs: { ds: 'r1' },
    input_preview: { qa: 'SENSITIVE_RAW' },
    status: 'success',
    output: { answer: 'A' },
    latency_ms: 120,
    model: 'gpt-4o',
    timestamp: 't',
    input_tokens: 50, output_tokens: 10,
    cost_value: 0.001, cost_currency: 'USD',
  }] : [],
}))

describe('resolveContextSelf via resolveContexts (manifest form)', () => {
  it('experiment data omits prompt_template / notes / temperature', () => {
    const [r] = resolveContexts([{ tag: 1, type: 'experiment', id: 'exp_1' }])
    expect(r.status).toBe('ok')
    expect(JSON.stringify(r.data)).not.toContain('SECRET')
    expect(r.data).toMatchObject({
      id: 'exp_1', name: 'E', schema_id: 'sch_1', model: 'gpt-4o',
    })
    expect((r.data as Record<string, unknown>).prompt_template).toBeUndefined()
    expect((r.data as Record<string, unknown>).notes).toBeUndefined()
  })

  it('task_result data drops input_preview and input_refs', () => {
    const [r] = resolveContexts([{
      tag: 2, type: 'task_result', id: 't1',
      extra: { experiment_id: 'exp_1' },
    }])
    expect(r.status).toBe('ok')
    expect(JSON.stringify(r.data)).not.toContain('SENSITIVE_RAW')
    expect((r.data as Record<string, unknown>).input_preview).toBeUndefined()
    expect((r.data as Record<string, unknown>).input_refs).toBeUndefined()
    expect(r.data).toMatchObject({ task_id: 't1', status: 'success', output: { answer: 'A' } })
  })

  it('task_field data only has targeted_field + targeted_value', () => {
    const [r] = resolveContexts([{
      tag: 3, type: 'task_field', id: 't1#answer',
      extra: { experiment_id: 'exp_1', task_id: 't1', field: 'answer' },
    }])
    expect(r.status).toBe('ok')
    expect(r.data).toEqual({ targeted_field: 'answer', targeted_value: 'A' })
    expect(JSON.stringify(r.data)).not.toContain('SENSITIVE_RAW')
  })
})
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/resolve-context.test.ts
```

Expected: 3 new tests FAIL（`r.data` 仍含 `input_preview` / `prompt_template` 等）。原 12 个 `formatContextsForLlm` 测仍 pass。

- [ ] **Step 3: 改 `resolveContextSelf`**

在 `src/lib/copilot/resolve-context.ts` 顶部 import 区加：

```typescript
import {
  manifestExperiment,
  manifestTaskResult,
  manifestTaskField,
  manifestDataset,
  manifestTemplate,
  manifestDisplay,
  manifestRubric,
} from './manifest'
```

替换 5 个分支的 `data:` 字段（保留 case 头、`status`、`summary` 不变）：

```typescript
// experiment 分支（原 L30-51）
case 'experiment': {
  const exp = getExperiment(ref.id)
  if (!exp) return { ...base, status: 'missing' }
  return {
    ...base,
    status: 'ok',
    summary: `${exp.name} · ${exp.model} · ${exp.status}`,
    data: manifestExperiment(exp),
  }
}

// task_result 分支（原 L53-67）
case 'task_result': {
  const expId = (ref.extra as { experiment_id?: string } | undefined)?.experiment_id
  if (!expId) return { ...base, status: 'error', error: 'missing experiment_id in extra' }
  const results = readResults(expId)
  const found = results.find(r => r.task_id === ref.id)
  if (!found) return { ...base, status: 'missing' }
  return {
    ...base,
    status: 'ok',
    summary: found.status === 'success'
      ? summarizeOutput(found.output ?? {})
      : `[${found.status}] ${(found.error ?? '').slice(0, 60)}`,
    data: manifestTaskResult(found, 'self'),
  }
}

// task_field 分支（原 L69-95）
case 'task_field': {
  const extra = ref.extra as { experiment_id?: string; task_id?: string; field?: string } | undefined
  const expId = extra?.experiment_id
  const taskId = extra?.task_id
  const field = extra?.field
  if (!expId || !taskId || !field) {
    return { ...base, status: 'error', error: 'task_field requires extra.experiment_id / task_id / field' }
  }
  const results = readResults(expId)
  const found = results.find(r => r.task_id === taskId)
  if (!found) return { ...base, status: 'missing', error: `task ${taskId} not found` }
  const value = found.status === 'success'
    ? (found.output as Record<string, unknown> | undefined)?.[field]
    : undefined
  return {
    ...base,
    status: 'ok',
    summary: `${field} = ${String(value).slice(0, 60)}`,
    data: manifestTaskField(field, value, 'self'),
  }
}

// dataset 分支（原 L123-135）
case 'dataset': {
  try {
    const { def, records } = getDataset(ref.id)
    return {
      ...base,
      status: 'ok',
      summary: `${def.name} · ${records.length} records`,
      data: manifestDataset(def, records.length),
    }
  } catch {
    return { ...base, status: 'missing' }
  }
}

// template 分支（原 L112-121）
case 'template': {
  const schema = getSchema(ref.id)
  if (!schema) return { ...base, status: 'missing' }
  return {
    ...base,
    status: 'ok',
    summary: `${(schema as { label?: string }).label ?? schema.id}`,
    data: manifestTemplate(schema),
  }
}

// display 分支（原 L137-146）
case 'display': {
  const d = getDisplay(ref.id)
  if (!d) return { ...base, status: 'missing' }
  return {
    ...base,
    status: 'ok',
    summary: `${d.name}`,
    data: manifestDisplay(d),
  }
}

// rubric 分支（原 L148-157）
case 'rubric': {
  const r = getRubric(ref.id)
  if (!r) return { ...base, status: 'missing' }
  return {
    ...base,
    status: 'ok',
    summary: `${r.name} · ${r.criteria.length} criteria`,
    data: manifestRubric(r),
  }
}
```

`text_selection` / `rubric_stats` 分支不动（spec §3.2 明确这两种不变）。

- [ ] **Step 4: 跑全部 copilot 测**

```bash
npx vitest run src/lib/copilot
```

Expected: 3 new tests PASS；原 `formatContextsForLlm` 12 个测仍 PASS（formatContextsForLlm 是结构 dump，不依赖 data 内部字段，但 referenced entities 段会变成 manifest 形态，原测的 `data` 是手写 mock 不受影响）。

- [ ] **Step 5: 手动验证 chip preview**

```bash
npm run dev
```

打开 `localhost:3000/experiments/<某个 id>`，⌘K 开 copilot，圈选一个 task_result，chip 展开 → 应看到 manifest 形态（无 `input_preview` 字段）。如有偏差直接 Edit fix；preview 这条路径走 `/api/copilot/contexts/resolve`，自动消费 manifest。

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/resolve-context.ts src/lib/copilot/__tests__/resolve-context.test.ts
git commit -m "feat(copilot): switch resolveContextSelf to manifest forms (drops input_preview)"
```

---

## Task 3: `resolveContextById` 的 self / parent 也走 manifest

**Files:**
- Modify: `src/lib/copilot/resolve-context.ts:413-467`
- Modify: `src/lib/copilot/tools/__tests__/read-context.test.ts`

`resolveContextById` 是 `read_context` 工具的后端，scope=self/parent 走它。spec §5.10.4 表的 self/parent 形态在这里实质化。

- [ ] **Step 1: 读现有 read-context.test.ts 摸断言风格**

```bash
cat src/lib/copilot/tools/__tests__/read-context.test.ts
```

记下里面对 `task_field` / `task_result` 的 self/parent 期望字段。

- [ ] **Step 2: 写新断言（先 fail）**

替换或追加 `read-context.test.ts` 中 task_field/task_result 的相关断言（具体 patch 视现有测内容；以下是新增独立 describe 模板，原测保留不冲突时直接追加）：

```typescript
// 追加到 src/lib/copilot/tools/__tests__/read-context.test.ts
describe('resolveContextById manifest forms (v2.5)', () => {
  beforeEach(() => {
    // 用 vi.mock 装好 session-store / store / schema / dataset 等
    // 参考现有测的 mock pattern
  })

  it('task_field self only has targeted_field + targeted_value', () => {
    // mock active_contexts ctx_1 = task_field 圈选
    const r = resolveContextById('s1', 'ctx_1')
    expect(r?.self_value).toEqual({ targeted_field: 'answer', targeted_value: 'A' })
    expect(JSON.stringify(r?.self_value)).not.toContain('input_preview')
  })

  it('task_field parent attaches task_meta but no input_preview', () => {
    const r = resolveContextById('s1', 'ctx_1')
    expect(r?.parent_value).toMatchObject({
      targeted_field: 'answer',
      targeted_value: 'A',
      task_meta: { task_id: 't1', status: 'success' },
    })
    expect(JSON.stringify(r?.parent_value)).not.toContain('input_preview')
  })

  it('task_result self drops input_preview and input_refs', () => {
    const r = resolveContextById('s1', 'ctx_2')
    expect(r?.self_value).toMatchObject({ task_id: 't1', status: 'success' })
    expect(JSON.stringify(r?.self_value)).not.toContain('input_preview')
    expect(JSON.stringify(r?.self_value)).not.toContain('input_refs')
  })

  it('task_result parent has manifest task + manifest experiment summary, not raw exp', () => {
    const r = resolveContextById('s1', 'ctx_2')
    expect(r?.parent_value).toMatchObject({
      task_id: 't1',
      experiment: { id: 'exp_1', name: 'E', schema_id: 'sch_1', model: 'gpt-4o' },
    })
    // experiment 段不应含 prompt_template / notes / run_stats（manifest experiment 自己有 run_stats，但 task_result.parent 的 experiment 子结构按 spec §3.2 只 4 字段）
    expect((r?.parent_value as Record<string, unknown>).experiment).not.toHaveProperty('prompt_template')
  })
})
```

- [ ] **Step 3: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/tools/__tests__/read-context.test.ts
```

- [ ] **Step 4: 改 `resolveContextById`**

把 `src/lib/copilot/resolve-context.ts:427-467` 重写：

```typescript
  switch (ref.type) {
    case 'task_field': {
      const extra = (ref.extra ?? {}) as { experiment_id?: string; task_id?: string; field?: string }
      const field = extra.field ?? ref.id
      const taskId = extra.task_id
      const expId = extra.experiment_id
      if (!expId || !taskId) {
        return { type: ref.type, ref, self_value: manifestTaskField(field, undefined, 'self') }
      }
      const results = readResults(expId)
      const task = results.find((r) => r.task_id === taskId)
      const fieldValue = task && task.status === 'success'
        ? getByPath(task.output, field)
        : undefined
      const taskMeta = task ? {
        task_id: task.task_id,
        status: task.status,
        latency_ms: task.latency_ms,
        input_tokens: task.input_tokens,
        output_tokens: task.output_tokens,
        cost_value: task.cost_value,
        cost_currency: task.cost_currency,
      } : undefined
      return {
        type: ref.type,
        ref,
        self_value: manifestTaskField(field, fieldValue, 'self'),
        parent_value: manifestTaskField(field, fieldValue, 'parent', taskMeta),
      }
    }

    case 'task_result': {
      const extra = (ref.extra ?? {}) as { experiment_id?: string }
      const expId = extra.experiment_id
      if (!expId) return { type: ref.type, ref, self_value: resolved.data }
      const results = readResults(expId)
      const found = results.find((r) => r.task_id === ref.id)
      if (!found) return { type: ref.type, ref, self_value: resolved.data }
      const exp = getExperiment(expId)
      return {
        type: ref.type,
        ref,
        self_value: manifestTaskResult(found, 'self'),
        parent_value: exp ? manifestTaskResult(found, 'parent', exp) : undefined,
      }
    }

    // experiment / template / dataset / display / rubric / rubric_stats / text_selection
    default:
      return { type: ref.type, ref, self_value: resolved.data }
  }
```

> 注意 default 分支返 `resolved.data` —— 这是 Task 2 之后的 manifest 形态（不是老的全 dump），自然继承。

import 区在 Task 2 已经加了 manifest 函数；本 Task 复用。

- [ ] **Step 5: 跑测试**

```bash
npx vitest run src/lib/copilot/tools/__tests__/read-context.test.ts
npx vitest run src/lib/copilot
```

Expected: 新测全 PASS；其他既有测 PASS。

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/resolve-context.ts src/lib/copilot/tools/__tests__/read-context.test.ts
git commit -m "feat(copilot): manifest-driven self/parent in resolveContextById"
```

---

## Task 4: `read_page` 命中结果切 manifest

**Files:**
- Modify: `src/lib/copilot/tools/read-page.ts:64-73`
- Modify: `src/lib/copilot/tools/__tests__/read-page.test.ts`（如存在；若无则在本任务新建）

read_page 的 `matches[].content_tree` 当前调 `resolveContexts(refs)` 拿 `ResolvedContext.data`。Task 2 完成后 `data` 已经是 manifest 形态，**`read-page.ts` 表面上无需改**——但要补一个测明确锁定行为，并在测中确认 manifest 已经贯穿。

- [ ] **Step 1: 检查现有 read-page 测**

```bash
ls src/lib/copilot/tools/__tests__/ | grep read-page
```

如有，读完了解断言风格；如无下一步直接新建。

- [ ] **Step 2: 新建 / 追加测**

```typescript
// src/lib/copilot/tools/__tests__/read-page.test.ts （若无则新建）
import { describe, it, expect, vi } from 'vitest'
import { readPageTool } from '../read-page'

vi.mock('../../snapshot-cache', () => ({
  getSnapshot: () => ({
    viewport_index: [
      { key: 'template:sch_1', type: 'template', preview_text: 'QA template prompt template hello', ancestors: [] },
    ],
  }),
}))

vi.mock('@/lib/schema', () => ({
  getSchema: (id: string) => id === 'sch_1' ? {
    id, label: 'QA', description: 'd', version: 1,
    inputs: [], variables: [{ name: 'q', source: 'item.q' }],
    default_prompt: 'SECRET PROMPT BODY '.repeat(50),  // 真字段名是 default_prompt，不是 prompt_template
    message_builder: {},
    output_schema: { type: 'object', properties: { answer: { type: 'string' } } },
  } : null,
}))

const ctx = { session_id: 's', signal: new AbortController().signal }

describe('readPageTool returns manifest content_tree, not full schema', () => {
  it('template hit: content_tree has prompt_template_excerpt, no full default_prompt', async () => {
    const r = (await readPageTool.call({ query: 'template prompt' }, ctx)) as {
      matches: Array<{ key: string; content_tree: Record<string, unknown> | null }>
    }
    expect(r.matches.length).toBe(1)
    const tree = r.matches[0].content_tree!
    expect(tree.id).toBe('sch_1')
    // manifest 有 excerpt 字段（≤300 chars）
    expect(tree).toHaveProperty('prompt_template_excerpt')
    expect((tree.prompt_template_excerpt as string).length).toBe(300)
    // manifest 不暴露原 TaskSchema 字段名
    expect(tree).not.toHaveProperty('default_prompt')
    expect(tree).not.toHaveProperty('prompt_template')
    // 原长 prompt（50×"SECRET PROMPT BODY " = 950 chars）被截到 300，不应看到第 301 字符起的后续重复
    // 验证截断：excerpt 只含前 15 次重复左右（每次 19 chars，15×19=285，16×19=304）
    // 断"excerpt 长度恰好 300"已经锁定截断；再加一条 "excerpt 不含第 50 次重复后的部分"
    expect(JSON.stringify(tree)).not.toContain('SECRET PROMPT BODY '.repeat(20))
  })
})
```

- [ ] **Step 3: 跑确认 PASS（应该已经 pass，因 Task 2 已经把 data shape 改成 manifest）**

```bash
npx vitest run src/lib/copilot/tools/__tests__/read-page.test.ts
```

Expected: PASS。如 FAIL 说明 Task 2 没覆盖 template 分支，回 Task 2 修。

- [ ] **Step 4: read-page.ts 加注释锁定语义**

在 `src/lib/copilot/tools/read-page.ts:64-65` 上方加一行注释：

```typescript
    try {
      // resolveContexts(refs).data 走 manifest 形态（Task 2 后），等同于 spec §3.6 的
      // resolveContextsAsManifest(refs, 'self')。read_page 不再 dump 全量，避免泄漏
      // input_preview / prompt_template / JSX 源码。
      const resolved = resolveContexts(refs)
```

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/tools/read-page.ts src/lib/copilot/tools/__tests__/read-page.test.ts
git commit -m "test(copilot): lock read_page content_tree to manifest forms"
```

---

## Task 5: 新工具 `read_dataset_records`

**Files:**
- Create: `src/lib/copilot/tools/read-dataset-records.ts`
- Create: `src/lib/copilot/tools/__tests__/read-dataset-records.test.ts`
- Modify: `src/lib/copilot/tools/registry.ts`
- Modify: `src/lib/copilot/tools/metadata-client.ts`
- Modify: `src/components/copilot/tool-call-card.tsx`（VARIANT_BY_TOOL）
- Modify: `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts`（工具名 / summary key）

- [ ] **Step 1: 写工具单测（先 fail）**

```typescript
// src/lib/copilot/tools/__tests__/read-dataset-records.test.ts
import { describe, it, expect, vi } from 'vitest'
import { readDatasetRecordsTool } from '../read-dataset-records'

vi.mock('@/lib/datasets', () => ({
  getDataset: (id: string) => {
    if (id === 'ds_1') {
      return {
        def: {
          id: 'ds_1', name: 'QA', source: 'upload', path: '/tmp/x',
          fields: [{ key: 'qa_id', type: 'string' }, { key: 'q', type: 'string' }],
          id_field: 'qa_id',
        },
        records: Array.from({ length: 25 }, (_, i) => ({
          qa_id: `q${i + 1}`,
          q: `question ${i + 1}`,
        })),
      }
    }
    throw new Error('not found')
  },
}))

const ctx = { session_id: 's', signal: new AbortController().signal }

describe('readDatasetRecordsTool', () => {
  it('metadata: read-only, not destructive, max 8000', () => {
    expect(readDatasetRecordsTool.metadata.isReadOnly).toBe(true)
    expect(readDatasetRecordsTool.metadata.isDestructive).toBe(false)
    expect(readDatasetRecordsTool.metadata.maxResultSizeChars).toBe(8000)
  })

  it('default returns first 5 records, has_more=true', async () => {
    const r = await readDatasetRecordsTool.call({ dataset_id: 'ds_1' }, ctx)
    expect(r.records).toHaveLength(5)
    expect(r.records[0]).toMatchObject({ qa_id: 'q1' })
    expect(r.total).toBe(25)
    expect(r.has_more).toBe(true)
  })

  it('limit clamped to 20', async () => {
    const r = await readDatasetRecordsTool.call({ dataset_id: 'ds_1', limit: 100 }, ctx)
    expect(r.records).toHaveLength(20)
    expect(r.has_more).toBe(true)
  })

  it('offset + limit pagination', async () => {
    const r = await readDatasetRecordsTool.call({ dataset_id: 'ds_1', limit: 5, offset: 20 }, ctx)
    expect(r.records).toHaveLength(5)
    expect(r.records[0]).toMatchObject({ qa_id: 'q21' })
    expect(r.has_more).toBe(false)
  })

  it('task_id matches by id_field', async () => {
    const r = await readDatasetRecordsTool.call(
      { dataset_id: 'ds_1', task_id: 'q7' },
      ctx,
    )
    expect(r.records).toEqual([{ qa_id: 'q7', q: 'question 7' }])
    expect(r.has_more).toBe(false)
    expect(r.total).toBe(25)
  })

  it('task_id miss returns empty records, has_more=false', async () => {
    const r = await readDatasetRecordsTool.call(
      { dataset_id: 'ds_1', task_id: 'nope' },
      ctx,
    )
    expect(r.records).toEqual([])
    expect(r.total).toBe(25)
    expect(r.has_more).toBe(false)
  })

  it('throws when dataset not found', async () => {
    await expect(
      readDatasetRecordsTool.call({ dataset_id: 'nope' }, ctx),
    ).rejects.toThrow(/not found/)
  })

  it('throws when dataset_id missing', async () => {
    await expect(
      readDatasetRecordsTool.call({ dataset_id: '' as never }, ctx),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/tools/__tests__/read-dataset-records.test.ts
```

Expected: FAIL — `Cannot find module '../read-dataset-records'`。

- [ ] **Step 3: 写工具实现**

```typescript
// src/lib/copilot/tools/read-dataset-records.ts
import { getDataset } from '@/lib/datasets'
import type { ToolDescriptor } from './types'

interface Input {
  dataset_id: string
  task_id?: string
  limit?: number
  offset?: number
}

interface Output {
  records: Array<Record<string, unknown>>
  total: number
  has_more: boolean
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

export const readDatasetRecordsTool: ToolDescriptor<Input, Output> = {
  name: 'read_dataset_records',
  description:
    "Read raw records from a dataset. Use after read_resource(dataset) when the user's question needs actual record content. Pass task_id for one specific record (matched by dataset.id_field), or use limit/offset for pagination (limit defaults to 5, max 20).",
  inputSchema: {
    type: 'object',
    required: ['dataset_id'],
    properties: {
      dataset_id: { type: 'string', description: 'Dataset id (slug).' },
      task_id: {
        type: 'string',
        description:
          'Optional. When given, returns the single record whose dataset.id_field matches this value. Skip pagination.',
      },
      limit: {
        type: 'number',
        description: `How many records to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
      },
      offset: { type: 'number', description: 'Pagination offset (default 0).' },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 8000,
  },
  call: async ({ dataset_id, task_id, limit = DEFAULT_LIMIT, offset = 0 }) => {
    if (!dataset_id) throw new Error('dataset_id is required')

    let bundle: { def: { id_field: string; name: string }; records: Array<Record<string, unknown>> }
    try {
      bundle = getDataset(dataset_id) as typeof bundle
    } catch {
      throw new Error(`dataset ${dataset_id} not found`)
    }

    const { def, records } = bundle
    const total = records.length

    if (task_id) {
      const match = records.find((r) => r[def.id_field] === task_id)
      return {
        records: match ? [match] : [],
        total,
        has_more: false,
      }
    }

    const cap = Math.min(Math.max(0, limit), MAX_LIMIT)
    const start = Math.max(0, offset)
    const slice = records.slice(start, start + cap)
    return {
      records: slice,
      total,
      has_more: start + cap < total,
    }
  },
}
```

- [ ] **Step 4: 注册到 registry**

```typescript
// src/lib/copilot/tools/registry.ts
// 顶部 import 区追加：
import { readDatasetRecordsTool } from "./read-dataset-records"

// TOOLS 数组追加（顺序按读 > 写习惯，放 readResourceTool 后即可）：
export const TOOLS: ReadonlyArray<AnyToolDescriptor> = [
  listExperimentsTool,
  readExperimentResultsTool,
  restartExperimentTool,
  readPageTool,
  readToolResultTool,
  readContextTool,
  readResourceTool,
  readDatasetRecordsTool,    // ← new
  editTemplateTool,
] as const
```

- [ ] **Step 5: 镜像 client metadata**

```typescript
// src/lib/copilot/tools/metadata-client.ts
// CLIENT_TOOL_METADATA 数组追加：
{ name: 'read_dataset_records', isReadOnly: true, isDestructive: false },
```

- [ ] **Step 6: tool-call-card variant 映射**

```bash
grep -n "VARIANT_BY_TOOL" src/components/copilot/tool-call-card.tsx
```

定位映射表，在合适位置加：

```typescript
read_dataset_records: 'retrieval',
```

> 若 `VARIANT_BY_TOOL` 默认 fallback 是 `'retrieval'` / `'default'`，且新工具不需要特殊样式，可不加显式映射。具体看 grep 结果。

- [ ] **Step 7: i18n key（zh + en 成对）**

```typescript
// src/lib/i18n/zh.ts，"copilot.tool.name.*" 段加：
'copilot.tool.name.read_dataset_records': '读取数据集 records',
// "copilot.tool.summary.*" 段加：
'copilot.tool.summary.read_dataset_records': '从数据集 {dataset_id} 读取 records',
```

```typescript
// src/lib/i18n/en.ts 对应：
'copilot.tool.name.read_dataset_records': 'Read dataset records',
'copilot.tool.summary.read_dataset_records': 'Reading records from dataset {dataset_id}',
```

> 实施前先 grep 查 `'copilot.tool.name.read_resource'` 看现有 key 命名风格 + 用法（是否 i18n hook 在 tool-call-card 直接消费），保持一致即可。

- [ ] **Step 8: 跑全部 copilot 测，含 metadata-client-sync**

```bash
npx vitest run src/lib/copilot
```

Expected: 全 PASS（含 8 新测 + metadata-client-sync 通过）。如 sync 失败，对照 Step 4-5 检查 server / client 两边都加了。

- [ ] **Step 9: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/tools/read-dataset-records.ts \
        src/lib/copilot/tools/__tests__/read-dataset-records.test.ts \
        src/lib/copilot/tools/registry.ts \
        src/lib/copilot/tools/metadata-client.ts \
        src/components/copilot/tool-call-card.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(copilot): add read_dataset_records tool for paged record access"
```

---

## Task 6: 划线降权 — Inspector 模式互斥

**Files:**
- Modify: `src/components/copilot/text-selector.tsx:31-33`
- Modify: `src/components/copilot/inspector-overlay.tsx:153-156`（删 4 行）

- [ ] **Step 1: text-selector.tsx 改 enabled**

打开 `src/components/copilot/text-selector.tsx`，第 31-33 行附近：

```typescript
// 旧
const { open, addContext } = useCopilotStore()
const enabled = open

// 新
const { open, inspectorActive, addContext } = useCopilotStore()
const enabled = open && !inspectorActive
```

- [ ] **Step 2: inspector-overlay.tsx 删让位**

打开 `src/components/copilot/inspector-overlay.tsx`，第 153-156 行（spec §3.7.1 注明）：

```typescript
// 删除以下 4 行（原 onClick 内）：
      // 如果这次 click 是 drag-select 结束（有文字被选中）→ 让 TextSelector 接管，不抢捕获 context
      // 否则 inspector 会把用户原本想划线的动作抢走。
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim().length >= 2) return
```

> 删除后 onClick 直接进入 `pickTargetAt(e.clientX, e.clientY)`。Inspector 与 TextSelector 互斥后无需让位逻辑。spec §3.7.1 明确这是预期行为：用户 mouseup 抬起位置元素会被 inspector 捕获（不会再有划线浮按钮干扰）。

- [ ] **Step 3: tsc + 手动 e2e**

```bash
npx tsc --noEmit
npm run dev
```

打开任意 experiment 页：
1. ⌘K 开 copilot
2. 点 Inspector 按钮（chip rail 旁），进入圈选模式
3. 在页面上 drag-select 一段文字 → **不应该出现 "+加入" 浮按钮**（互斥生效）
4. 退出 Inspector（Esc 或 banner 的 exit）
5. 重新 drag-select → 应该出现 "+加入"

- [ ] **Step 4: commit**

```bash
git add src/components/copilot/text-selector.tsx src/components/copilot/inspector-overlay.tsx
git commit -m "feat(copilot): mutually exclusive inspector mode and text selection drag"
```

---

## Task 7: `text_selection` chip 主语换 host

**Files:**
- Modify: `src/components/copilot/context-chip-rail.tsx:101-104, 139-209`
- Modify: `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts`（chip 文案 key）

- [ ] **Step 1: 加 i18n key**

```typescript
// src/lib/i18n/zh.ts 在 copilot.chip.* 段加：
'copilot.chip.text_in_host': '在 {host} 中',
'copilot.chip.selected_text': '选中文本',
'copilot.chip.context_anchor': '上下文锚点',
'copilot.chip.anchor_taken_from': '取自 {hostType} {hostId}',
'copilot.chip.anchor_full_value_hint': "完整字段值走 read_context(ctx_{tag}, scope='parent')",
```

```typescript
// src/lib/i18n/en.ts 对应：
'copilot.chip.text_in_host': 'in {host}',
'copilot.chip.selected_text': 'Selected text',
'copilot.chip.context_anchor': 'Context anchor',
'copilot.chip.anchor_taken_from': 'taken from {hostType} {hostId}',
'copilot.chip.anchor_full_value_hint': "full field value via read_context(ctx_{tag}, scope='parent')",
```

> i18n provider 是否支持 `{tag}` 等插值，已经成熟（CLAUDE.md 提到 `t("k", { var })`）。如不支持嵌套引号 / 单引号请改成等价 unicode 引号。

- [ ] **Step 2: 重写 `ContextChip` 的 text_selection 分支**

打开 `src/components/copilot/context-chip-rail.tsx`，定位到 `isText` 判定（约 L101-104）。改成：

```typescript
const isText = ctx.type === "text_selection"
const hostType = isText ? (ctx.extra as { hostType?: string } | undefined)?.hostType : undefined
const hostId = isText ? (ctx.extra as { hostId?: string } | undefined)?.hostId : undefined
const hostHeader = isText && hostType
  ? `${hostType}${hostId ? '#' + hostId : ''}`
  : ''
const textBody = isText
  ? ((ctx.summary ?? '').replace(/…$/, ''))
  : ''
const label = isText
  ? (hostHeader ? t('copilot.chip.text_in_host', { host: hostHeader }) : `text`)
  : ctx.type
```

定位到 collapsed chip 渲染区（约 L139-166），text_selection 时呈现两行：

```tsx
{/* collapsed chip 内部 */}
<div className="flex flex-col gap-0.5 min-w-0 flex-1">
  {/* 第一行：tag + label + × */}
  <div className="flex items-center gap-2 min-w-0">
    <span className="...">#{ctx.tag}</span>
    <button onClick={toggleExpand}>...</button>
    <span className={`truncate ${isText ? 'italic' : ''}`}>{label}</span>
    <button onClick={() => removeContext(ctx.elementKey)}>×</button>
  </div>
  {/* 第二行（仅 text_selection）：副语 = 选中文本节选 */}
  {isText && textBody && (
    <div className="pl-6 text-xs text-muted-foreground italic truncate">
      └ &quot;{textBody}&quot;
    </div>
  )}
</div>
```

> 上面是结构示意，实际 className 与现有 collapsed chip 对齐（borderColor / px / py）。原 chip 单行布局对非 text_selection 类型不变。

定位到 expanded 区（约 L167-209），text_selection 时走专用模板：

```tsx
{isText ? (
  <div className="flex flex-col gap-2 px-3 py-2 text-sm">
    {/* 顶部祖先链：优先用 detail.context_chain（已 skip 选中文本本身），fallback 走 ctx.extra.ancestors.slice(1) */}
    {detail?.context_chain && detail.context_chain.length > 0 && (
      <div className="text-xs text-muted-foreground pl-6">
        └ in {detail.context_chain.map((a, i) => (
          <span key={`${a.type}:${a.id}:${i}`}>
            {i > 0 && ' / '}
            <span className="text-foreground">{a.type}</span>
            <span className="opacity-70">:{a.id}</span>
          </span>
        ))}
      </div>
    )}
    <div className="border-t border-border/40" />

    {/* Selected text */}
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {t('copilot.chip.selected_text')}:
      </div>
      <blockquote className="border-l-2 border-foreground/20 pl-3 text-foreground/90 italic">
        &quot;{textBody}&quot;
      </blockquote>
    </div>

    {/* Context anchor */}
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {t('copilot.chip.context_anchor')}:
      </div>
      <ul className="text-xs space-y-0.5 pl-3">
        {hostType && (
          <li>· {t('copilot.chip.anchor_taken_from', { hostType, hostId: hostId ?? '' })}</li>
        )}
        {detail?.context_chain && detail.context_chain.length > 0 && (
          <li>· {t('copilot.chip.within')} {detail.context_chain.map(a => `${a.type}:${a.id}`).join(' / ')}</li>
        )}
        <li className="text-muted-foreground/70">
          · {t('copilot.chip.anchor_full_value_hint', { tag: String(ctx.tag) })}
        </li>
      </ul>
    </div>
  </div>
) : (
  /* 原有非 text_selection expanded 区不动：Value / Metadata 两段 */
  <>
    {/* ... existing rendering ... */}
  </>
)}
```

> 调研报告指出：`detail.context_chain`（后端 resolve 返回，不含 host 自身）是祖先链的可信源。`ctx.extra.ancestors[0]` 是 host 自己，要 skip — 但 `context_chain` 已经为我们 skip 好了（resolveContext 的 ancestors 处理逻辑），直接用即可。如有边缘 case 用 `ctx.extra.ancestors?.slice(1)` 兜底。

- [ ] **Step 3: tsc + 手动 e2e**

```bash
npx tsc --noEmit
npm run dev
```

1. 打开 experiment 详情页，⌘K 开 copilot
2. 在某个 task_field 上 drag-select 一段文字，点 "+加入"
3. Chip rail 出现 chip：第一行 `#1 text in task_field#output.answer ×`，第二行 `└ "选中文本节选"`
4. 点展开 → 看到三段："└ in task_result:task_X / experiment:exp_1" + Selected text + Context anchor

- [ ] **Step 4: commit**

```bash
git add src/components/copilot/context-chip-rail.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(copilot): text_selection chip subject becomes host (chip preview redesign)"
```

---

## Task 8: `microCompact` 加 `maxTotalReplayableTokens` 阈值

**Files:**
- Modify: `src/lib/copilot/micro-compact.ts:37-87`
- Modify: `src/lib/copilot/__tests__/micro-compact.test.ts`（追加测）

- [ ] **Step 1: 写 failing test**

在 `src/lib/copilot/__tests__/micro-compact.test.ts` 末尾追加：

```typescript
describe('microCompact maxTotalReplayableTokens (v2.5)', () => {
  it('compacts oldest replayable when total tokens exceed threshold even within keepRecentN', () => {
    // 3 条 read tool_result，各装 ~5KB JSON（约 1250 token），keepRecent=3 但 total 阈值 4000
    // 期望：从老到新累加，第 1 条加进去 1250，第 2 条加进去 2500，第 3 条加进去后超 4000 → 最近的不再保
    // 注意：v2.5 实现是反向遍历（从最近到老），acc + tokens > maxTotal 就 break
    // → 最近的 N 条优先保，老的先压。本 case：keepRecent=3, 阈值 4000：
    //   reversed[0]: 1250, acc=1250 ≤ 4000 keep
    //   reversed[1]: 1250, acc=2500 ≤ 4000 keep
    //   reversed[2]: 1250, acc=3750 ≤ 4000 keep
    //   →3 条都保留（不到阈值）。改用大 payload：
    const big = 'x'.repeat(20_000) // ~5000 token
    const messages = [
      userMsg('u1', 'hi'),
      toolUseMsg('a1', 'c1', 'read_resource'),
      toolResultMsg('a1', 'c1', 'read_resource', { kind: 'inline', value: { x: big } }),
      toolUseMsg('a2', 'c2', 'read_resource'),
      toolResultMsg('a2', 'c2', 'read_resource', { kind: 'inline', value: { x: big } }),
      toolUseMsg('a3', 'c3', 'read_resource'),
      toolResultMsg('a3', 'c3', 'read_resource', { kind: 'inline', value: { x: big } }),
    ]
    const out = microCompact(messages, {
      keepRecentReadResults: 3,
      maxTotalReplayableTokens: 6000,
    })
    // 反向遍历：reversed[0]=最近的 ~5000 token，acc=5000 keep；
    //          reversed[1]=中间 ~5000 token，acc+5000=10000 > 6000 → break，不再 keep
    //          reversed[2]=最老 ~5000 token，已经在 break 之外，自然压
    const compacted = out.filter(m => m.role === 'tool_result' && JSON.parse(m.content).kind === 'compacted')
    const inlines = out.filter(m => m.role === 'tool_result' && JSON.parse(m.content).kind === 'inline')
    expect(inlines).toHaveLength(1)  // 最近的保
    expect(compacted).toHaveLength(2) // 老的两条压
  })

  it('threshold undefined falls back to old behavior', () => {
    const messages = [
      userMsg('u1', 'hi'),
      toolUseMsg('a1', 'c1', 'read_resource'),
      toolResultMsg('a1', 'c1', 'read_resource', { kind: 'inline', value: { x: 'a' } }),
      toolUseMsg('a2', 'c2', 'read_resource'),
      toolResultMsg('a2', 'c2', 'read_resource', { kind: 'inline', value: { x: 'b' } }),
    ]
    const out = microCompact(messages, { keepRecentReadResults: 1 })
    const inlines = out.filter(m => m.role === 'tool_result' && JSON.parse(m.content).kind === 'inline')
    expect(inlines).toHaveLength(1) // keep last only, old behavior intact
  })
})
```

- [ ] **Step 2: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/micro-compact.test.ts
```

Expected: 第一个新测 FAIL（无 token 阈值实现，3 条都被保留）；第二个新测 PASS（向后兼容）。

- [ ] **Step 3: 改 micro-compact.ts**

```typescript
// src/lib/copilot/micro-compact.ts
// 在 MicroCompactConfig 加字段：
export interface MicroCompactConfig {
  /** 保留最近 N 条可重放 tool_result 的完整形态；其余（更老的）压成 compacted。 */
  keepRecentReadResults: number
  /**
   * 累计 token 上限。从最近到老反向遍历可重放 tool_result，acc + tokens > 阈值
   * 时停止保留（即使在 keepRecentReadResults 窗内）。undefined 时只按数量。
   *
   * spec §4.2：防御 3 条 read_context 各 5KB 的极端累加。约 4 char ≈ 1 token 的
   * 朴素估算。
   */
  maxTotalReplayableTokens?: number
}

/** 4 char ≈ 1 token 的朴素估算，与 anthropic / openai tokenizer 偏差 < 30% 但够用 */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}
```

替换 `microCompact` 算法（原 L46-60）：

```typescript
export function microCompact(
  messages: CopilotMessage[],
  config: MicroCompactConfig,
): CopilotMessage[] {
  // 1. 找所有 replayable tool_result 的索引（保持现状）
  const replayableIdx: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "tool_result") continue
    if (!isReplayableTool(m.tool_name)) continue
    replayableIdx.push(i)
  }

  // 2. 决定保留哪些（从最近到老反向扫，受双阈值约束）
  const keep = Math.max(0, config.keepRecentReadResults)
  const tokenCap = config.maxTotalReplayableTokens
  const keepIdxs = new Set<number>()
  let acc = 0
  for (let pos = replayableIdx.length - 1; pos >= 0; pos--) {
    const reverseRank = replayableIdx.length - 1 - pos // 0 = 最近
    if (reverseRank >= keep) break
    const i = replayableIdx[pos]
    if (tokenCap !== undefined) {
      const tokens = approxTokens(messages[i].content)
      if (acc + tokens > tokenCap) break
      acc += tokens
    }
    keepIdxs.add(i)
  }

  const toCompact = new Set(replayableIdx.filter((i) => !keepIdxs.has(i)))
  if (toCompact.size === 0) return messages

  // 3. 替换（原逻辑保持）
  return messages.map((m, i) => {
    if (!toCompact.has(i)) return m

    const parsed = normalizeToolResult(m.content)
    let refId: string | undefined
    if (parsed.kind === "ref") refId = parseRefId(parsed.ref)
    else if (parsed.kind === "compacted") refId = parsed.ref ? parseRefId(parsed.ref) : undefined

    const newContent: ToolResultContent = refId
      ? {
          kind: "compacted",
          summary: `(archived tool result; retrieve via read_tool_result('ref://tool-result/${refId}') if needed)`,
          ref: `ref://tool-result/${refId}`,
        }
      : {
          kind: "compacted",
          summary: `(archived tool result; payload not persisted)`,
        }

    return { ...m, content: JSON.stringify(newContent) }
  })
}
```

- [ ] **Step 4: 跑测试**

```bash
npx vitest run src/lib/copilot/__tests__/micro-compact.test.ts
```

Expected: 现有 9 个测 + 2 新测 = 11 PASS。

- [ ] **Step 5: 调用方更新（在 build-llm-messages.ts 加 token 阈值）**

grep 看谁调 microCompact：

```bash
grep -rn "microCompact(" src/ --include="*.ts" --include="*.tsx"
```

预期就 `src/lib/copilot/build-llm-messages.ts` 一处。**保留现有 `keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS` 不动，只新增 `maxTotalReplayableTokens` 一行**：

```typescript
// 改前
const compacted = microCompact(branch, {
  keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
})

// 改后
const compacted = microCompact(branch, {
  keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
  maxTotalReplayableTokens: 4000,   // ← 新增
})
```

> 4000 是 spec §4.4 推荐初值（与 `read_resource.maxResultSizeChars` 同档）。
> 注意：Task 11 / Task 12 还会再次改这个调用点（解构 + sliceAfterBoundary + boundary 落盘），本 Task 只加阈值字段，其他保持。

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/copilot
git add src/lib/copilot/micro-compact.ts src/lib/copilot/__tests__/micro-compact.test.ts src/lib/copilot/build-llm-messages.ts
git commit -m "feat(copilot): microCompact maxTotalReplayableTokens guard against accumulated payload"
```

---

## Task 9: 集成验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md:[Unreleased]`

- [ ] **Step 1: 全量测**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: tsc 0 错误；vitest 全 PASS（应 230+ case，新增约 12-15 个）；next build 通过。

- [ ] **Step 2: e2e smoke（可选，如时间允许）**

```bash
npm run test:e2e
```

Expected: 9 case PASS（M1 不动路由层，e2e 应不破）。

- [ ] **Step 3: 手动验证四件事**

```bash
npm run dev
```

打开 `localhost:3000`：

1. **圈选 task_result**：进 experiment 详情，⌘K 开 copilot，圈选一行结果，chip 展开 → manifest 形态（无 input_preview / input_refs）
2. **read_dataset_records 工具可用**：在 copilot 输入栏问 "show me first 3 records of dataset qa_pairs"，LLM 应该调 `read_dataset_records({ dataset_id: 'qa_pairs', limit: 3 })`，返回 records 数组
3. **Inspector 互斥**：开 Inspector → drag-select → **不**应该出现 "+加入" 浮按钮；退出 Inspector → drag-select → 出现按钮
4. **text_selection chip 主语**：drag-select 一段 task field 文字 → chip 显示 `text in task_field#output.answer`，副语 `└ "..."`

任一不符直接 Edit fix；不属于本 plan 范围的 issue 记到 GH issue。

- [ ] **Step 4: 写 CHANGELOG `[Unreleased]` 条目**

打开 `CHANGELOG.md`，在 `## [Unreleased]` 段追加：

```markdown
### Architecture

- Copilot v2.5 M1：默认 context 收敛 + read_dataset_records 工具 + microCompact token 阈值
  - **manifest 化**：圈选 / `read_page` / `read_context` 三条路径默认返回 ≤300 chars 的结构化 manifest（per-type self/parent shaper 收敛在 `src/lib/copilot/manifest.ts`），不再 dump `input_preview` / `prompt_template` / JSX 源码 / rubric description。LLM 想看 raw data 走 `read_resource` / `read_dataset_records` 工具
  - **新工具 `read_dataset_records(dataset_id, task_id?, limit≤20, offset)`**：read-only，maxResultSizeChars=8000；`task_id` 走 `dataset.id_field` 单条快路径；`limit/offset` 分页
  - **`microCompact` 加 `maxTotalReplayableTokens`**（默认 4000）：防御 N 条 read_context 大 payload 累加；最近 N 条 + 累计 token 双阈值；undefined 时回退老行为
  - **划线降权**：Inspector 模式下关 TextSelector（`enabled = open && !inspectorActive`），删 inspector-overlay 的 drag-select 让位 4 行；text_selection chip 主语换成 `text in {hostType}#{hostId}`，文本变副语
- Spec: docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md（§3 / §4）
- Plan: docs/superpowers/plans/2026-05-07-copilot-v25-m1-context-collapse.md
```

- [ ] **Step 5: 最终 commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for v2.5 M1 default context collapse"
```

---

---

## Part 2 · M2 — CompactBoundaryMessage + Cache Telemetry

> **前置条件**：M1（Task 1-9）已合入 main。Task 10-17 构成独立 PR（或内部可拆 2 PR：boundary 一批 + cache 一批）。

---

## Task 10: `sliceAfterBoundary` 纯函数 + 类型扩

**Files:**
- Modify: `src/lib/copilot/types.ts:6, 37-71`
- Create: `src/lib/copilot/boundary.ts`
- Create: `src/lib/copilot/__tests__/boundary.test.ts`

- [ ] **Step 1: 写 failing test**

```typescript
// src/lib/copilot/__tests__/boundary.test.ts
import { describe, it, expect } from 'vitest'
import { sliceAfterBoundary } from '../boundary'
import type { CopilotMessage } from '../types'

function msg(
  id: string,
  role: CopilotMessage['role'],
  kind?: 'compact_boundary',
): CopilotMessage {
  return {
    id, session_id: 's', role,
    content: '', timestamp: '2026-05-07T00:00:00Z',
    ...(kind ? { kind } : {}),
  }
}

describe('sliceAfterBoundary', () => {
  it('no boundary: returns the same branch reference', () => {
    const b: CopilotMessage[] = [msg('a', 'user'), msg('b', 'assistant'), msg('c', 'user')]
    expect(sliceAfterBoundary(b)).toBe(b)
  })

  it('single boundary: returns slice after it', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('b', 'assistant'),
      msg('bd', 'system', 'compact_boundary'),
      msg('c', 'user'),
      msg('d', 'assistant'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['c', 'd'])
  })

  it('multiple boundaries: uses the latest (closest to end)', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('bd1', 'system', 'compact_boundary'),
      msg('c', 'user'),
      msg('bd2', 'system', 'compact_boundary'),
      msg('d', 'user'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['d'])
  })

  it('boundary at tail: returns empty array', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      msg('bd', 'system', 'compact_boundary'),
    ]
    expect(sliceAfterBoundary(b)).toEqual([])
  })

  it('empty branch: returns empty', () => {
    expect(sliceAfterBoundary([])).toEqual([])
  })

  it('system role without kind=compact_boundary is not treated as boundary', () => {
    const b: CopilotMessage[] = [
      msg('a', 'user'),
      { ...msg('sys', 'system'), kind: undefined as never },
      msg('c', 'user'),
    ]
    expect(sliceAfterBoundary(b).map((m) => m.id)).toEqual(['a', 'sys', 'c'])
  })
})
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/boundary.test.ts
```

Expected: FAIL — `Cannot find module '../boundary'`，且 `msg` 的 `role: 'system'` 导致 type error（Task 10 未扩类型前）。

- [ ] **Step 3: 扩 `types.ts`**

```typescript
// src/lib/copilot/types.ts line 6
export type CopilotRole = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
```

在 `CopilotMessage` interface 内（约 line 66-71 之间）加两个新可选字段，贴在文件注释"tool_use / tool_result 专用扩展"块之后。**注意**：`reason?: string` 字段**已存在**（L69-70 `/** tool_result：denied 的原因 */`），v2.5 boundary 直接**复用**它（同字段 cross-role 双用途，单 interface pattern 的代价），不再声明新 `reason?`——否则 TS 会 duplicate member 报错。

```typescript
  // ---------- v2.5 §5: compact_boundary 专用扩展（仅 role === 'system' 时填）----------
  /** 'compact_boundary' 表示这条 system 消息是 microCompact 完成后插入的边界标记 */
  kind?: 'compact_boundary'
  /** boundary 生成时的 ISO 时间戳 */
  at?: string
  // 注：压缩原因（可选）复用 L70 既有 `reason?: string` 字段，不新增
```

同步更新既有 `reason?: string` 的 JSDoc 注释，反映 cross-role 双用途：

```typescript
  /** tool_result：denied 的原因（可选）；或 compact_boundary：压缩触发原因（可选） */
  reason?: string
```

> PR-3 已决定 `CopilotMessage` 不拆 discriminated union（types.ts L23-27 注释说明），v2.5 继承此 pattern：加可选字段而非新 role type；同名字段 cross-role 复用是副作用。

- [ ] **Step 4: 写 `boundary.ts`**

```typescript
// src/lib/copilot/boundary.ts
import type { CopilotMessage } from './types'

/**
 * spec §5.4 build-llm-messages 组装前调用：找最近一条 compact_boundary，
 * 从 boundary 之后开始组装。无 boundary → 返原 branch（老 session 兼容，
 * 语义等价 v2 现状）。
 *
 * 时间复杂度：线性回扫到找到即停；boundary 越靠近末端越快。
 */
export function sliceAfterBoundary(branch: CopilotMessage[]): CopilotMessage[] {
  for (let i = branch.length - 1; i >= 0; i--) {
    const m = branch[i]
    if (m.role === 'system' && m.kind === 'compact_boundary') {
      return branch.slice(i + 1)
    }
  }
  return branch
}
```

- [ ] **Step 5: 跑 pass**

```bash
npx vitest run src/lib/copilot/__tests__/boundary.test.ts
npx tsc --noEmit
```

Expected: 6 PASS。tsc 可能因 `build-llm-messages.ts` / `session-store.ts` 里某些 `m.role === 'user'` switch 没 cover `'system'` 而 warn / error；Task 12 会补。若本步 tsc 立刻 break 主干，先**只扩 CopilotRole 不动 CopilotMessage**，或把 `CopilotRole = ... | 'system'` 暂时移到 Task 12；优先保 Task 10 能单独 commit。

- [ ] **Step 6: commit**

```bash
git add src/lib/copilot/types.ts src/lib/copilot/boundary.ts \
        src/lib/copilot/__tests__/boundary.test.ts
git commit -m "feat(copilot): add compact_boundary message type and sliceAfterBoundary helper"
```

---

## Task 11: `microCompact` 返回签名改 `{messages, didCompact}`

**Files:**
- Modify: `src/lib/copilot/micro-compact.ts:42-87`
- Modify: `src/lib/copilot/__tests__/micro-compact.test.ts`（9 现有 + Task 8 新加 2 个 case 全部解构）
- Modify: `src/lib/copilot/build-llm-messages.ts:67-69`（唯一生产 caller）

spec §5.3 要求"如果实际有消息被压缩"才插 boundary——`microCompact` 必须返回这个信号。

- [ ] **Step 1: 改返回类型**

```typescript
// src/lib/copilot/micro-compact.ts，顶部 export 加接口：
export interface MicroCompactResult {
  messages: CopilotMessage[]
  /** true 表示至少一条 replayable tool_result 被压成 compacted */
  didCompact: boolean
}
```

把函数末尾改成：

```typescript
export function microCompact(
  messages: CopilotMessage[],
  config: MicroCompactConfig,
): MicroCompactResult {
  // ... 现有收集 replayableIdx + 计算 keepIdxs / toCompact 的逻辑不动 ...

  if (toCompact.size === 0) return { messages, didCompact: false }

  const newMessages = messages.map((m, i) => {
    if (!toCompact.has(i)) return m
    // ... 现有 normalizeToolResult + 替换为 compacted 的逻辑不动 ...
    return { ...m, content: JSON.stringify(newContent) }
  })

  return { messages: newMessages, didCompact: true }
}
```

- [ ] **Step 2: 更新所有 micro-compact 测（共 11 个 case，每个解构调用）**

所有 `const out = microCompact(...)` 改成 `const { messages: out } = microCompact(...)`；所有 `microCompact(...)` 作为 `expect(...)` 实参的也同样解构。举例（现有 L86-103 的同引用透传测）：

```typescript
it('非 tool_result 消息透传同一引用', () => {
  const messages = [userMsg('u1', 'hi'), asstMsg('a1', 'u1', 'hi')]
  const { messages: out, didCompact } = microCompact(messages, { keepRecentReadResults: 1 })
  expect(out).toBe(messages)
  expect(didCompact).toBe(false)
})
```

**关键新测**：显式 assert `didCompact` flag（至少 2 case：一个 true 一个 false）。

```typescript
it('didCompact=true when 老 read-only tool_result 被压', () => {
  const messages = [/* 2 条 read_resource tool_result */]
  const { didCompact } = microCompact(messages, { keepRecentReadResults: 1 })
  expect(didCompact).toBe(true)
})

it('didCompact=false when 少于阈值', () => {
  const messages = [/* 1 条 read_resource tool_result */]
  const { didCompact } = microCompact(messages, { keepRecentReadResults: 3 })
  expect(didCompact).toBe(false)
})
```

- [ ] **Step 3: 改唯一 caller**

```typescript
// src/lib/copilot/build-llm-messages.ts L67-69
// 旧
const compacted = microCompact(branch, {
  keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
  maxTotalReplayableTokens: 4000,
})

// 新（本 Task 只改解构；didCompact 在 Task 12 才需要消费，
// 这里先不取，避免 tsc `noUnusedLocals` 警告）
const { messages: compacted } = microCompact(branch, {
  keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
  maxTotalReplayableTokens: 4000,
})
// 注：Task 12 Step 5 会把上式扩成 `const { messages: compacted, didCompact } = ...`
//     并在下方加 `if (didCompact && opts?.sessionId) appendCompactBoundary(...)`
```

- [ ] **Step 4: 跑全量 copilot 测**

```bash
npx vitest run src/lib/copilot
npx tsc --noEmit
```

Expected: 11 micro-compact case + 现有 build-llm-messages / session-store 等测全 PASS；tsc 0 错误。

- [ ] **Step 5: commit**

```bash
git add src/lib/copilot/micro-compact.ts \
        src/lib/copilot/__tests__/micro-compact.test.ts \
        src/lib/copilot/build-llm-messages.ts
git commit -m "refactor(copilot): microCompact returns {messages, didCompact} signal"
```

---

## Task 12: `appendCompactBoundary` + build-llm-messages 端到端集成

> **前置**：Task 10（`sliceAfterBoundary` + `CopilotRole` 加 `'system'` + `CopilotMessage` 加 `kind/at/reason`）+ Task 11（`microCompact` 返回签名 `{messages, didCompact}`）必须先完成——本 Task 同时消费 `sliceAfterBoundary`、解构返回值、写 boundary 用到的 `kind/at` 字段。

**Files:**
- Modify: `src/lib/copilot/session-store.ts`（AppendMessageInput 扩 + 新 helper）
- Modify: `src/lib/copilot/build-llm-messages.ts`（opts.sessionId + sliceAfter + 落盘）
- Modify: `src/lib/copilot/stream-response.ts`（buildLlmMessages 调用传 sessionId）
- Modify: `src/lib/copilot/__tests__/session-store.test.ts`（appendCompactBoundary 测）
- Modify: `src/lib/copilot/__tests__/build-llm-messages.test.ts`（boundary 集成测）

**方案 A**（调研报告定论）：boundary 接 parent 链，head 跟 boundary，复用 `appendMessage`。

- [ ] **Step 1: 先写失败集成测（session-store.test.ts）**

```typescript
// src/lib/copilot/__tests__/session-store.test.ts 末尾追加
import { appendCompactBoundary, getActiveBranch } from '../session-store'

describe('appendCompactBoundary', () => {
  it('writes a system/compact_boundary message and head follows', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'hi' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'hello', parent_id: m1.id })
    const bd = appendCompactBoundary(s.id, { reason: 'test' })

    expect(bd.role).toBe('system')
    expect(bd.kind).toBe('compact_boundary')
    expect(bd.parent_id).toBe(m2.id)
    expect(bd.at).toBeTruthy()
    expect(bd.reason).toBe('test')

    // head 跟到 boundary
    expect(getSession(s.id)?.head_message_id).toBe(bd.id)

    // getActiveBranch 把 boundary 串入
    const branch = getActiveBranch(s.id)
    expect(branch.map((m) => m.id)).toEqual([m1.id, m2.id, bd.id])
  })

  it('next append after boundary parents to boundary', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'hi' })
    const bd = appendCompactBoundary(s.id)
    // 后续 message 应该以 boundary 为 parent（调用方通常传 session.head_message_id）
    const m2 = appendMessage({
      session_id: s.id, role: 'user', content: 'next',
      parent_id: getSession(s.id)?.head_message_id,
    })
    expect(m2.parent_id).toBe(bd.id)
  })
})
```

- [ ] **Step 2: 写失败集成测（build-llm-messages.test.ts）**

```typescript
// src/lib/copilot/__tests__/build-llm-messages.test.ts 末尾追加
describe('buildLlmMessages with compact_boundary (v2.5)', () => {
  it('skips messages before boundary in output', () => {
    const branch: CopilotMessage[] = [
      userMsg('u1', 'old'),
      asstMsg('a1', 'u1', 'old reply'),
      {
        id: 'bd1', session_id: 's', role: 'system',
        content: '', timestamp: 't', kind: 'compact_boundary', at: 't',
      } as CopilotMessage,
      userMsg('u2', 'new question'),
    ]
    const out = buildLlmMessages(branch)
    // 只保 system prompt + 最新 user
    const userContent = out.filter((m) => m.role === 'user').map((m) => m.content)
    expect(userContent).toEqual(['new question'])
    const asstContent = out.filter((m) => m.role === 'assistant').map((m) => m.content)
    expect(asstContent).toEqual([]) // 老 assistant 不出现
  })

  it('old session without boundary: no behavior change', () => {
    const branch: CopilotMessage[] = [
      userMsg('u1', 'q1'), asstMsg('a1', 'u1', 'a1'),
      userMsg('u2', 'q2'),
    ]
    const out = buildLlmMessages(branch)
    const userContent = out.filter((m) => m.role === 'user').map((m) => m.content)
    expect(userContent).toEqual(['q1', 'q2'])
  })

  it('system role (non-boundary) silently skipped in LlmMessages loop', () => {
    const branch: CopilotMessage[] = [
      userMsg('u1', 'hi'),
      { id: 'sys', session_id: 's', role: 'system', content: 'ignored', timestamp: 't' } as CopilotMessage,
      userMsg('u2', 'ho'),
    ]
    const out = buildLlmMessages(branch)
    expect(out.filter((m) => m.content === 'ignored')).toEqual([])
  })
})
```

> 注意：**不测** "opts.sessionId 触发落盘" 这个副作用路径（需要 chdir + 真文件），放 Task 13 e2e 或 session-store.test.ts 的真实落盘 roundtrip 测里。

- [ ] **Step 3: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/session-store.test.ts \
               src/lib/copilot/__tests__/build-llm-messages.test.ts
```

Expected: 新增 5 测全 FAIL。

- [ ] **Step 4: 改 session-store.ts**

扩 `AppendMessageInput`（L164-181 附近）：

```typescript
export interface AppendMessageInput {
  session_id: string
  role: CopilotRole
  content: string
  parent_id?: string
  contexts?: CopilotContextRef[]
  usage?: CopilotMessage['usage']
  model_id?: string
  call_id?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  thought_signature?: string
  denied?: boolean
  reason?: string
  // v2.5 §5: compact_boundary 专用（仅 role === 'system' 时填）
  kind?: 'compact_boundary'
  at?: string
}
```

扩 `appendMessage` 消息构造（L184-200）：

```typescript
const msg: CopilotMessage = {
  id: nanoid(),
  session_id: input.session_id,
  parent_id: input.parent_id,
  role: input.role,
  content: input.content,
  contexts: input.contexts,
  timestamp: nowIso(),
  usage: input.usage,
  model_id: input.model_id,
  call_id: input.call_id,
  tool_name: input.tool_name,
  tool_input: input.tool_input,
  thought_signature: input.thought_signature,
  denied: input.denied,
  reason: input.reason,
  // v2.5
  kind: input.kind,
  at: input.at,
}
```

新增 helper（放在 appendMessage 之后）：

```typescript
/**
 * spec §5.3 方案 A：microCompact 完成后插 boundary。parent_id 默认取 session 当前 head，
 * 这样 boundary 串入 active branch；之后的 append 自然以 boundary 为 parent。
 */
export function appendCompactBoundary(
  sessionId: string,
  opts?: { reason?: string },
): CopilotMessage {
  const session = getSession(sessionId)
  return appendMessage({
    session_id: sessionId,
    role: 'system',
    content: '',
    parent_id: session?.head_message_id,
    kind: 'compact_boundary',
    at: nowIso(),
    reason: opts?.reason,
  })
}
```

- [ ] **Step 5: 改 build-llm-messages.ts**

```typescript
// 顶部 import 追加：
import { sliceAfterBoundary } from './boundary'
import { appendCompactBoundary } from './session-store'
```

签名 + 主体（**完整替换 buildLlmMessages 函数，L39 起到函数末尾 `}` 为止**，现状 build-llm-messages.ts 该函数约 L39-112）：

```typescript
export function buildLlmMessages(
  branch: CopilotMessage[],
  pageContext?: import('./types').PageContext | null,
  opts?: { sessionId?: string },
): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  // v2.5 §5.4: 找最近 boundary，之前的消息不参与本轮组装
  const usable = sliceAfterBoundary(branch)

  const lastUser = [...usable].reverse().find((m) => m.role === 'user')
  const refs = (lastUser?.contexts ?? []) as CopilotContextRef[]
  const header = buildSystemHeader({
    route_type: pageContext?.route_type,
    path: pageContext?.path,
    page_context: pageContext,
    contexts: refs,
  })
  if (refs.length > 0 || pageContext) {
    out.push({
      role: 'system',
      content: 'Session context (JSON):\n' + JSON.stringify(header, null, 2),
    })
  }

  // v2 §5.6 + v2.5 §4: microCompact 返 {messages, didCompact}
  const { messages: compacted, didCompact } = microCompact(usable, {
    keepRecentReadResults: MICRO_COMPACT_KEEP_RECENT_READ_RESULTS,
    maxTotalReplayableTokens: 4000,
  })

  // v2.5 §5.3: 只在生产（有 sessionId）且实际有压缩时落 boundary。测试调 buildLlmMessages
  // 不传 opts 保持纯函数语义。
  if (didCompact && opts?.sessionId) {
    appendCompactBoundary(opts.sessionId, { reason: 'micro-compact' })
  }

  for (const m of compacted) {
    // v2.5 §5: system 消息（含 boundary）不进 LlmMessages
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content })
    } else if (m.role === 'tool_use') {
      // ... 原有 tool_use / tool_result 分支不动
    } else if (m.role === 'tool_result') {
      // ...
    }
  }
  return out
}
```

- [ ] **Step 6: 改 stream-response.ts**

找到 `buildLlmMessages(...)` 的调用点（应在 `runToolAwareLlmStream` 内），改成：

```typescript
const llmMessages = buildLlmMessages(p.branch, p.pageContext, { sessionId: p.sessionId })
```

> 如果 `p` 里字段名不是 `sessionId`（可能是 `session_id`），按实际命名。

- [ ] **Step 7: 跑全量 + tsc**

```bash
npx vitest run src/lib/copilot
npx tsc --noEmit
```

Expected: 5 新测 + 全量既有 PASS。

- [ ] **Step 8: 手动 e2e 验证 boundary 落盘**

```bash
npm run dev
```

- 开一个新 session，连续发 ≥ 5 条要 LLM 调 read_resource / read_context 的消息（例如圈一个 experiment，然后连续问不同细节），触发 microCompact
- 查 `data/copilot/sessions/{sid}.jsonl` 末尾应出现 `{"role":"system","kind":"compact_boundary",...}` 行
- 再发一条消息 → 这次 buildLlmMessages 应只看到 boundary 之后的历史（观察后端 log，或在 `llm-stream.ts` 前加一行 `console.log(llmMessages.length)` 临时调试）

- [ ] **Step 9: commit**

```bash
git add src/lib/copilot/session-store.ts src/lib/copilot/build-llm-messages.ts \
        src/lib/copilot/stream-response.ts \
        src/lib/copilot/__tests__/session-store.test.ts \
        src/lib/copilot/__tests__/build-llm-messages.test.ts
git commit -m "feat(copilot): append compact_boundary after microCompact, slice on build"
```

---

## Task 13: `llm-stream` 抽 cache 字段

**Files:**
- Modify: `src/lib/copilot/types.ts`（StreamEvent.done.usage）
- Modify: `src/lib/copilot/llm-stream.ts:77, 303-357, 226-229, 282`
- Create/Modify: `src/lib/copilot/__tests__/llm-stream-cache.test.ts`（新测或并入 llm-stream-serialize.test.ts）

- [ ] **Step 1: 扩 `StreamEvent.done.usage` 类型 + stream-response 局部类型同步**

```typescript
// src/lib/copilot/types.ts
// 旧 line 106：
//   | { type: 'done'; usage?: { input_tokens: number; output_tokens: number }; stop_reason?: string }
// 新：
  | {
      type: 'done'
      usage?: {
        input_tokens: number
        output_tokens: number
        cache_creation_tokens?: number
        cache_read_tokens?: number
      }
      stop_reason?: string
    }
```

同步扩 `CopilotMessage.usage`（types.ts L45-48）——**不扩**。message.usage 保留 input/output 二字段，cache 走独立 `cache-stats.jsonl`（调研报告 §2 定论）。这样 session jsonl 形态不变，向后兼容最简。

**同 step 必须同步扩 `stream-response.ts` 两处局部类型**（否则 Task 15 Step 1 写 `assistantUsage?.cache_creation_tokens` 会 tsc fail）：

```typescript
// src/lib/copilot/stream-response.ts L49（RunStreamResult.usage）：
// 旧
//   usage?: { input_tokens: number; output_tokens: number }
// 新
usage?: {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
}

// L67（runToolAwareLlmStream 内部 assistantUsage 局部变量）：
// 旧
//   let assistantUsage: { input_tokens: number; output_tokens: number } | undefined
// 新
let assistantUsage: {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
} | undefined
```

L110 `assistantUsage = ev.usage` 自动继承 StreamEvent.done.usage 新字段；赋值兼容（cache 字段 optional）。

- [ ] **Step 2: 扩 llm-stream.ts usage accumulator + parser**

在 `callLlmStreaming` 内（L77 附近）：

```typescript
// 旧
const usage = { input_tokens: 0, output_tokens: 0 }

// 新（保留 cache 字段的 undefined 语义，区分"provider 没返数据"和"返了 0"）
const usage: {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
} = { input_tokens: 0, output_tokens: 0 }
```

`parseAnthropicEvent` 的 `message_start` 和 `message_delta`（L303-357）加 cache 字段读取：

```typescript
// message_start
case 'message_start': {
  const u = parsed.message?.usage
  if (u?.input_tokens) usage.input_tokens = u.input_tokens
  if (u?.output_tokens) usage.output_tokens = u.output_tokens
  if (u?.cache_creation_input_tokens !== undefined) {
    usage.cache_creation_tokens = u.cache_creation_input_tokens
  }
  if (u?.cache_read_input_tokens !== undefined) {
    usage.cache_read_tokens = u.cache_read_input_tokens
  }
  return
}

// message_delta
case 'message_delta': {
  if (parsed.delta?.stop_reason) setReason(parsed.delta.stop_reason)
  if (parsed.usage?.output_tokens) usage.output_tokens = parsed.usage.output_tokens
  // Anthropic 有时在 message_delta.usage 再给一次 cache 数（如首轮 message_start 只给 input）
  if (parsed.usage?.cache_creation_input_tokens !== undefined) {
    usage.cache_creation_tokens = parsed.usage.cache_creation_input_tokens
  }
  if (parsed.usage?.cache_read_input_tokens !== undefined) {
    usage.cache_read_tokens = parsed.usage.cache_read_input_tokens
  }
  return
}
```

扩 `AnthropicEvent` interface（L364-371）：

```typescript
interface AnthropicEvent {
  type?: string
  index?: number
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
  delta?: { type?: string; text?: string; stop_reason?: string; partial_json?: string }
  usage?: {
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}
```

`parseOpenaiEvent` usage（L226-229）：

```typescript
if (parsed.usage) {
  usage.input_tokens = parsed.usage.prompt_tokens ?? usage.input_tokens
  usage.output_tokens = parsed.usage.completion_tokens ?? usage.output_tokens
  // v2.5 §6: OpenAI prompt_tokens_details.cached_tokens（Sankuai / 兼容层通常也走这个字段）
  const cached = parsed.usage.prompt_tokens_details?.cached_tokens
  if (cached !== undefined) usage.cache_read_tokens = cached
  // v2.5 §6: 某些兼容层把 cache_read 放顶层，兜底
  const topLevelCacheRead = (parsed.usage as { cache_read_tokens?: number }).cache_read_tokens
  if (topLevelCacheRead !== undefined && usage.cache_read_tokens === undefined) {
    usage.cache_read_tokens = topLevelCacheRead
  }
}
```

扩 OpenAI usage type（L282）：

```typescript
usage?: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  cache_read_tokens?: number
}
```

- [ ] **Step 3: 写 parser 单测**

> **签名注意**：真实 `parseAnthropicEvent` / `parseOpenaiEvent` 是 5 / 3 参数函数（不是单参数 object dispatcher）。先在 `llm-stream.ts` 末尾 export `__testOnly = { parseAnthropicEvent, parseOpenaiEvent }`，测里用 raw SSE block 字符串 + `usage` 等完整参数调用。

```typescript
// src/lib/copilot/llm-stream.ts 末尾追加（若不存在）
export const __testOnly = { parseAnthropicEvent, parseOpenaiEvent }
```

```typescript
// src/lib/copilot/__tests__/llm-stream-cache.test.ts
import { describe, it, expect } from 'vitest'
import { __testOnly } from '../llm-stream'

type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
}

function sseBlock(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}`
}

describe('parseAnthropicEvent cache fields', () => {
  it('message_start: reads cache_creation_input_tokens + cache_read_input_tokens', () => {
    const usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseAnthropicEvent(
      sseBlock('message_start', {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 100, output_tokens: 0,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 50,
          },
        },
      }),
      () => {}, // onEvent
      usage,
      () => {}, // setReason
      new Map(), // toolState
    )
    expect(usage.cache_creation_tokens).toBe(200)
    expect(usage.cache_read_tokens).toBe(50)
    expect(usage.input_tokens).toBe(100)
  })

  it('message_delta: updates cache_read_tokens when present', () => {
    const usage: AnthropicUsage = {
      input_tokens: 100, output_tokens: 10, cache_read_tokens: 50,
    }
    __testOnly.parseAnthropicEvent(
      sseBlock('message_delta', {
        type: 'message_delta',
        delta: {},
        usage: { cache_read_input_tokens: 80 },
      }),
      () => {},
      usage,
      () => {},
      new Map(),
    )
    expect(usage.cache_read_tokens).toBe(80)
  })
})

describe('parseOpenaiEvent cache fields', () => {
  // parseOpenaiEvent 签名：(block: string, onEvent, usage, setReason, toolState) —— 与 Anthropic 对齐；
  // 若实际签名不同（如少了 toolState 等），先 grep `function parseOpenaiEvent` 核对后按真实签名传。
  it('reads prompt_tokens_details.cached_tokens', () => {
    const usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseOpenaiEvent(
      sseBlock('', {
        choices: [],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 80,
          prompt_tokens_details: { cached_tokens: 300 },
        },
      }),
      () => {},
      usage,
      () => {},
      new Map(),
    )
    expect(usage.cache_read_tokens).toBe(300)
  })

  it('falls back to top-level cache_read_tokens for non-standard compat layers', () => {
    const usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseOpenaiEvent(
      sseBlock('', {
        choices: [],
        usage: {
          prompt_tokens: 200, completion_tokens: 20,
          cache_read_tokens: 100,
        },
      }),
      () => {},
      usage,
      () => {},
      new Map(),
    )
    expect(usage.cache_read_tokens).toBe(100)
  })
})
```

> **落地必查**：若 `parseOpenaiEvent` 实际签名参数数量 / 顺序与 `parseAnthropicEvent` 不同（grep `function parseOpenaiEvent` 看真实 param list），按真实签名调整 arg 顺序；不要照搬 Anthropic 5-arg 模板。

- [ ] **Step 4: 跑 pass**

```bash
npx vitest run src/lib/copilot/__tests__/llm-stream-cache.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: commit**

```bash
git add src/lib/copilot/types.ts src/lib/copilot/llm-stream.ts \
        src/lib/copilot/stream-response.ts \
        src/lib/copilot/__tests__/llm-stream-cache.test.ts
git commit -m "feat(copilot): extract cache_creation/cache_read tokens from provider usage"
```

---

## Task 14: `cache-stats-store.ts`

**Files:**
- Create: `src/lib/copilot/cache-stats-store.ts`
- Create: `src/lib/copilot/__tests__/cache-stats-store.test.ts`

- [ ] **Step 1: 写 failing test**

```typescript
// src/lib/copilot/__tests__/cache-stats-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  appendCacheStat,
  readCacheStats,
  aggregateCacheHitRate,
  type CacheUsageStat,
} from '../cache-stats-store'

let tmp: string
let origCwd: string

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-cache-'))
  process.chdir(tmp)
})
afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function stat(overrides: Partial<CacheUsageStat> = {}): CacheUsageStat {
  return {
    session_id: 's1', message_id: 'm1', ts: new Date().toISOString(),
    input_tokens: 100, output_tokens: 20,
    provider: 'anthropic', model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('appendCacheStat + readCacheStats', () => {
  it('roundtrips across multiple appends', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats().map((s) => s.session_id)).toEqual(['a', 'b'])
  })

  it('session_id filter', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats({ session_id: 'a' })).toHaveLength(1)
  })

  it('since_ms filter', () => {
    const old = stat({ session_id: 'old', ts: new Date(Date.now() - 10 * 60_000).toISOString() })
    const recent = stat({ session_id: 'new', ts: new Date().toISOString() })
    appendCacheStat(old)
    appendCacheStat(recent)
    expect(readCacheStats({ since_ms: 5 * 60_000 }).map((s) => s.session_id)).toEqual(['new'])
  })

  it('skips malformed lines gracefully', () => {
    appendCacheStat(stat({ session_id: 'a' }))
    fs.appendFileSync(path.join(tmp, 'data/copilot/cache-stats.jsonl'), '{not json}\n')
    appendCacheStat(stat({ session_id: 'b' }))
    expect(readCacheStats().map((s) => s.session_id)).toEqual(['a', 'b'])
  })
})

describe('aggregateCacheHitRate by provider', () => {
  it('Anthropic: denom = input + cache_read + cache_creation', () => {
    // 2 calls: 1st creates cache (write 1000), 2nd reads it (read 900)
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, cache_creation_tokens: 1000, cache_read_tokens: 0, provider: 'anthropic' }),
      stat({ input_tokens: 100, cache_creation_tokens: 0,    cache_read_tokens: 900, provider: 'anthropic' }),
    ])
    // denom = (100+0+1000) + (100+900+0) = 2100; cache_read = 900
    expect(r.hit_rate).toBeCloseTo(900 / 2100, 3)
    expect(r.calls).toBe(2)
  })

  it('OpenAI: denom = input_tokens (already inclusive of cached)', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 1000, cache_read_tokens: 800, provider: 'openai' }),
      stat({ input_tokens: 500,  cache_read_tokens: 400, provider: 'openai' }),
    ])
    // denom = 1500; cache_read = 1200
    expect(r.hit_rate).toBeCloseTo(1200 / 1500, 3)
  })

  it('no cache fields (undefined): returns null hit_rate', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, provider: 'openai', cache_read_tokens: undefined }),
    ])
    expect(r.hit_rate).toBeNull()
    expect(r.calls).toBe(1)
  })

  it('empty stats: null rate, 0 calls', () => {
    const r = aggregateCacheHitRate([])
    expect(r.hit_rate).toBeNull()
    expect(r.calls).toBe(0)
  })

  it('mixed providers: Anthropic + OpenAI sum correctly', () => {
    const r = aggregateCacheHitRate([
      stat({ input_tokens: 100, cache_creation_tokens: 500, cache_read_tokens: 0, provider: 'anthropic' }),
      stat({ input_tokens: 600, cache_read_tokens: 400, provider: 'openai' }),
    ])
    // Anthropic denom: 100 + 0 + 500 = 600 ; OpenAI denom: 600; total denom = 1200
    // cache_read: 0 + 400 = 400
    expect(r.hit_rate).toBeCloseTo(400 / 1200, 3)
  })
})
```

- [ ] **Step 2: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/cache-stats-store.test.ts
```

- [ ] **Step 3: 写 cache-stats-store.ts**

```typescript
// src/lib/copilot/cache-stats-store.ts
import fs from 'fs'
import path from 'path'
import { ensureDir } from '../fs-utils'

export interface CacheUsageStat {
  session_id: string
  message_id: string
  ts: string                       // ISO 8601
  input_tokens: number             // Anthropic 语义：uncached only；OpenAI 语义：含 cached_tokens
  output_tokens: number
  cache_creation_tokens?: number   // Anthropic cache_creation_input_tokens（OpenAI 兼容层通常无）
  cache_read_tokens?: number       // Anthropic cache_read_input_tokens / OpenAI prompt_tokens_details.cached_tokens
  provider: 'anthropic' | 'openai'
  model: string
}

// 惰性路径，测试 chdir 有效
function copilotDir() { return path.join(process.cwd(), 'data', 'copilot') }
function cacheStatsPath() { return path.join(copilotDir(), 'cache-stats.jsonl') }

export function appendCacheStat(stat: CacheUsageStat): void {
  ensureDir(copilotDir())
  fs.appendFileSync(cacheStatsPath(), JSON.stringify(stat) + '\n')
}

export function readCacheStats(opts?: {
  since_ms?: number
  session_id?: string
}): CacheUsageStat[] {
  if (!fs.existsSync(cacheStatsPath())) return []
  const raw = fs.readFileSync(cacheStatsPath(), 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim())
  const cutoff = opts?.since_ms ? Date.now() - opts.since_ms : 0
  const out: CacheUsageStat[] = []
  for (const line of lines) {
    try {
      const s = JSON.parse(line) as CacheUsageStat
      if (cutoff && new Date(s.ts).getTime() < cutoff) continue
      if (opts?.session_id && s.session_id !== opts.session_id) continue
      out.push(s)
    } catch {
      // skip malformed
    }
  }
  return out
}

export interface CacheHitRateResult {
  hit_rate: number | null
  calls: number
  total_denom: number
  total_cache_read: number
  total_cache_creation: number
}

/**
 * spec §6 + 调研报告 §8：按 provider 分桶算分母。
 * - Anthropic: `input_tokens` 不含 cache_read/cache_creation → denom = input + cache_read + cache_creation
 * - OpenAI: `prompt_tokens` 映射到 `input_tokens`，已含 cached_tokens → denom = input_tokens
 *
 * 任何 stat 都没有 cache 字段时返 null（区分"不支持 cache 观测"与"0% 命中"）。
 */
export function aggregateCacheHitRate(stats: CacheUsageStat[]): CacheHitRateResult {
  if (stats.length === 0) {
    return { hit_rate: null, calls: 0, total_denom: 0, total_cache_read: 0, total_cache_creation: 0 }
  }
  let totalDenom = 0
  let totalCacheRead = 0
  let totalCacheCreate = 0
  let hasAnyCache = false
  for (const s of stats) {
    const cr = s.cache_read_tokens ?? 0
    const cc = s.cache_creation_tokens ?? 0
    if (s.cache_read_tokens !== undefined || s.cache_creation_tokens !== undefined) {
      hasAnyCache = true
    }
    totalCacheRead += cr
    totalCacheCreate += cc
    if (s.provider === 'anthropic') {
      totalDenom += s.input_tokens + cr + cc
    } else {
      totalDenom += s.input_tokens
    }
  }
  return {
    hit_rate: hasAnyCache && totalDenom > 0 ? totalCacheRead / totalDenom : hasAnyCache ? 0 : null,
    calls: stats.length,
    total_denom: totalDenom,
    total_cache_read: totalCacheRead,
    total_cache_creation: totalCacheCreate,
  }
}
```

- [ ] **Step 4: 跑 pass**

```bash
npx vitest run src/lib/copilot/__tests__/cache-stats-store.test.ts
npx tsc --noEmit
```

Expected: 9 PASS。

- [ ] **Step 5: commit**

```bash
git add src/lib/copilot/cache-stats-store.ts \
        src/lib/copilot/__tests__/cache-stats-store.test.ts
git commit -m "feat(copilot): cache-stats-store with provider-bucketed hit rate aggregation"
```

---

## Task 15: `runToolAwareLlmStream` 落盘 + GET API

**Files:**
- Modify: `src/lib/copilot/stream-response.ts`（落 cache stat）
- Create: `src/app/api/copilot/cache-stats/route.ts`

- [ ] **Step 1: stream-response.ts 落盘**

顶部 import：

```typescript
import { appendCacheStat } from './cache-stats-store'
```

**位置：在 `pendingToolUses` for 循环之后**（L150 附近）、`return { assistantMessageId, toolUseMessageIds, ... }` 之前（L152）。**必须放在这个位置**——因为 messageId fallback 需要 `toolUseMessageIds[0]` 已填。

```typescript
// src/lib/copilot/stream-response.ts
// 在 `for (const tu of pendingToolUses) { ... }` 循环结束之后、`return {...}` 之前插入：

// v2.5 §6: 每次 LLM 调用落一条 cache stat，独立 jsonl 文件。
// - assistantMessageId 来自 helper 顶部的 `let assistantMessageId: string | undefined`（L121）
//   —— 只有 assistantText.trim().length > 0 时才被赋值（见 L131 `assistantMessageId = asst.id`）
// - 若本轮 LLM 只 emit tool_use 没 text，assistantMessageId 为 undefined，fallback 到 toolUseMessageIds[0]
// - 两者都没（纯错误 / 空响应），留空字符串——orphan stat，聚合仍可用。
const messageId = assistantMessageId ?? toolUseMessageIds[0] ?? ''
appendCacheStat({
  session_id: p.sessionId,
  message_id: messageId,
  ts: new Date().toISOString(),
  input_tokens: assistantUsage?.input_tokens ?? 0,
  output_tokens: assistantUsage?.output_tokens ?? 0,
  cache_creation_tokens: assistantUsage?.cache_creation_tokens,
  cache_read_tokens: assistantUsage?.cache_read_tokens,
  provider: p.model.api_format === 'anthropic' ? 'anthropic' : 'openai',
  model: p.model.model,
})
```

> **依赖 Task 13**：`assistantUsage?.cache_creation_tokens` 要求 Task 13 Step 1 已把局部 `assistantUsage` 类型扩到含 cache 字段。若 tsc 报 `Property 'cache_creation_tokens' does not exist`，回 Task 13 Step 1 补扩 stream-response.ts L67 的局部 type。
>
> **`p.sessionId` 必填**（`RunStreamParams.sessionId: string` 是 required，L32），不需要 `if (p.sessionId)` 守卫。
>
> **字段校验**：`p.model` 是 `ModelConfig` 类型；`p.model.api_format` / `p.model.model` 存在（前者是 `'openai' | 'anthropic'`，后者是 model identifier 如 `'gpt-4o'`）。不要误写 `p.model.id`（那是 ModelConfig slug，不是 model 字段）。

- [ ] **Step 2: 写 GET API**

```typescript
// src/app/api/copilot/cache-stats/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { readCacheStats, aggregateCacheHitRate } from '@/lib/copilot/cache-stats-store'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_LIMIT = 10

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id') ?? undefined

  const sessionStats = sessionId ? readCacheStats({ session_id: sessionId }) : []
  const weeklyStats = readCacheStats({ since_ms: SEVEN_DAYS_MS })

  const sessionAgg = aggregateCacheHitRate(sessionStats)
  const weeklyAgg = aggregateCacheHitRate(weeklyStats)

  return NextResponse.json({
    session: {
      ...sessionAgg,
      // 最近 N 条倒序（最新在前）供 hover tooltip 展示
      recent: sessionStats.slice(-RECENT_LIMIT).reverse(),
    },
    weekly: weeklyAgg,
  })
}
```

- [ ] **Step 3: tsc + 手动测**

```bash
npx tsc --noEmit
npm run dev
```

curl 验证：

```bash
curl 'http://localhost:3000/api/copilot/cache-stats?session_id=xxx' | jq
```

Expected：返 `{session: {...}, weekly: {...}}`；session 未命中 sessionId 时 `{session: {calls: 0, ...}, weekly: {...}}`。

- [ ] **Step 4: commit**

```bash
git add src/lib/copilot/stream-response.ts \
        src/app/api/copilot/cache-stats/route.ts
git commit -m "feat(copilot): persist cache stats on every LLM call; add GET /cache-stats"
```

---

## Task 16: `CacheStatsChip` 组件 + chat-view 顶部挂 + i18n

**Files:**
- Create: `src/components/copilot/cache-stats-chip.tsx`
- Modify: `src/components/copilot/chat-view.tsx`（挂组件）
- Modify: `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts`

- [ ] **Step 1: 加 i18n key（zh + en 成对）**

```typescript
// src/lib/i18n/zh.ts copilot.* 段追加：
'copilot.cache.label': 'Cache',
'copilot.cache.session': '本 session {pct}',
'copilot.cache.weekly': '近 7 天 {pct}',
'copilot.cache.no_data': 'cache 数据暂无',
'copilot.cache.tooltip.recent_title': '最近调用',
'copilot.cache.tooltip.input': '输入 {n}',
'copilot.cache.tooltip.cache_read': '缓存读 {n}',
'copilot.cache.tooltip.cache_create': '缓存写 {n}',
'copilot.cache.tooltip.unsupported': '{provider} 不返 cache 指标',
```

```typescript
// src/lib/i18n/en.ts 对应：
'copilot.cache.label': 'Cache',
'copilot.cache.session': 'this session {pct}',
'copilot.cache.weekly': 'last 7 days {pct}',
'copilot.cache.no_data': 'no cache data yet',
'copilot.cache.tooltip.recent_title': 'Recent calls',
'copilot.cache.tooltip.input': 'input {n}',
'copilot.cache.tooltip.cache_read': 'cache read {n}',
'copilot.cache.tooltip.cache_create': 'cache create {n}',
'copilot.cache.tooltip.unsupported': '{provider} does not return cache metrics',
```

- [ ] **Step 2: 写组件**

```typescript
// src/components/copilot/cache-stats-chip.tsx
"use client"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import type { CacheUsageStat, CacheHitRateResult } from "@/lib/copilot/cache-stats-store"

interface ApiResponse {
  session: CacheHitRateResult & { recent: CacheUsageStat[] }
  weekly: CacheHitRateResult
}

function formatPct(r: number | null): string {
  if (r === null) return '—'
  return `${Math.round(r * 100)}%`
}

export function CacheStatsChip({ sessionId }: { sessionId?: string }) {
  const t = useT()
  const [data, setData] = useState<ApiResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchStats = () => {
      // 有 sessionId 就带上，没有也 fetch（拿 weekly 聚合数据；session 段会返 calls=0）
      const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
      fetch(`/api/copilot/cache-stats${qs}`)
        .then((r) => r.json())
        .then((d: ApiResponse) => { if (!cancelled) setData(d) })
        .catch(() => {})
    }
    fetchStats()
    const iv = setInterval(fetchStats, 10_000) // 10s 刷新
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId])

  if (!data) return null
  if (data.session.calls === 0 && data.weekly.calls === 0) return null

  const tooltip = data.session.recent.length > 0
    ? [
        t('copilot.cache.tooltip.recent_title'),
        ...data.session.recent.map((s) =>
          `${s.model}: ${t('copilot.cache.tooltip.input', { n: String(s.input_tokens) })}` +
          (s.cache_read_tokens !== undefined
            ? ` · ${t('copilot.cache.tooltip.cache_read', { n: String(s.cache_read_tokens) })}`
            : '') +
          (s.cache_creation_tokens !== undefined
            ? ` · ${t('copilot.cache.tooltip.cache_create', { n: String(s.cache_creation_tokens) })}`
            : ''),
        ),
      ].join('\n')
    : undefined

  return (
    <div
      className="px-3 py-1 text-xs text-muted-foreground flex items-center gap-2 border-b border-border/40"
      title={tooltip}
    >
      <span className="font-medium">{t('copilot.cache.label')}:</span>
      <span>{t('copilot.cache.session', { pct: formatPct(data.session.hit_rate) })}</span>
      <span className="opacity-60">·</span>
      <span>{t('copilot.cache.weekly', { pct: formatPct(data.weekly.hit_rate) })}</span>
    </div>
  )
}
```

> 简化：用 HTML `title` 属性做 tooltip（原生），避免引入 shadcn Tooltip 的复杂度。后续如想要富文本 tooltip，换成 `<Tooltip>` 组件即可，数据源不变。
>
> 组件位于 copilot panel 内部 —— 按 CLAUDE.md "Copilot panel 自身 + 内部不走玻璃"约定，不用 `<GlassThin>`；保持 shadcn 扁平，用 `border-b border-border/40` 作为顶部视觉分隔。

- [ ] **Step 3: chat-view.tsx 挂组件**

顶部 import：

```typescript
import { CacheStatsChip } from "./cache-stats-chip"
```

在 `return` 的根 div 内，`<RouteChangeBanner ... />` 之后、`<div className="flex-1 overflow-y-auto ...">` 之前：

```tsx
return (
  <div className="flex-1 flex flex-col min-h-0">
    <RouteChangeBanner
      hasMessages={stream.messages.length > 0}
      onForkSession={handleForkSession}
    />
    <CacheStatsChip sessionId={sessionId} />
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      {/* ... 原有 messages 渲染 ... */}
```

> `sessionId` prop 来源：chat-view 通常从 props / store 拿到 activeSessionId。grep `sessionId` / `activeSessionId` 确认具体变量名。

- [ ] **Step 4: tsc + 手动 e2e**

```bash
npx tsc --noEmit
npm run dev
```

1. ⌘K 开 copilot，新建会话，发一条需要 LLM 的消息
2. 等 LLM 回复完 → 顶部应出现 `Cache: 本 session 0% · 近 7 天 X%`（首次没有 cache hit 是正常的，Anthropic cache_creation 会记但 hit_rate 是 cache_read/denom = 0）
3. 再发一条同样系统 prompt 的消息 → hit_rate 应该上升（Anthropic 重用了 system prompt cache）
4. hover chip → 原生 tooltip 显示最近几条的 input / cache_read / cache_create 数

- [ ] **Step 5: commit**

```bash
git add src/components/copilot/cache-stats-chip.tsx \
        src/components/copilot/chat-view.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(copilot): cache hit rate chip on chat-view top"
```

---

## Task 17: M2 集成验证 + CHANGELOG + PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 全量测**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: tsc 0 错误；vitest 全 PASS（应 250+ case，M2 新增约 25 个）；next build 通过。

- [ ] **Step 2: e2e smoke**

```bash
npm run test:e2e
```

Expected: 9 case PASS（M2 新路由 `/api/copilot/cache-stats` 不在 smoke 覆盖内，但不破现有）。

- [ ] **Step 3: 手动验证三件事**

```bash
rm -rf data/copilot/cache-stats.jsonl   # 可选：从零开始观察
npm run dev
```

1. **Cache chip 出现**：⌘K 开 copilot，发一条消息 → 10s 内 chip 出现 `Cache: 本 session ...`；再发一条 → hit_rate 更新
2. **Boundary 触发**：连续 5+ 轮触发 microCompact（例如反复圈选 experiment / task_result 问细节），`data/copilot/sessions/{sid}.jsonl` 末尾应出现 `role:"system",kind:"compact_boundary"` 行；boundary 之后新起的 user 消息 parent_id 指向 boundary
3. **老 session 兼容**：打开一个没 boundary 的老 session，继续对话应正常工作（不 fallback、不 crash）

- [ ] **Step 4: 写 CHANGELOG M2 条目**

打开 `CHANGELOG.md`，在 `[Unreleased]` 段 M1 条目之后追加：

```markdown
### Architecture

- Copilot v2.5 M2：CompactBoundaryMessage + cache 遥测
  - **Transcript 加 `role: 'system', kind: 'compact_boundary'` 消息**（`src/lib/copilot/boundary.ts`）：`microCompact` 完成且真有消息被压时，在当前 head 之后追加一条 boundary；`buildLlmMessages` 组装前先 `sliceAfterBoundary`，只看 boundary 之后的历史。老 session 无 boundary 时行为等价 v2 现状（`sliceAfterBoundary` 无匹配返原 branch）
  - **`microCompact` 返 `{messages, didCompact}`**：仅 1 个生产 caller（`build-llm-messages.ts`），breaking 但测试调整成本可控
  - **方案 A**（boundary 接 parent 链 + head 跟）：复用 `appendMessage` 的原子 append + `updateSession` 原子写；多分支语义自然继承（不同分支各自的 boundary 链互不干扰）
  - **Cache 遥测**（`src/lib/copilot/cache-stats-store.ts`）：每次 LLM 调用抽 `cache_creation_input_tokens` / `cache_read_input_tokens`（Anthropic）+ `prompt_tokens_details.cached_tokens`（OpenAI / 兼容层），落 `data/copilot/cache-stats.jsonl`（append-only，独立于 message.usage）；**hit rate 按 provider 分桶**（Anthropic 分母 = input + cache_read + cache_creation；OpenAI 分母 = input_tokens）
  - **Chat-view 顶部新增 `CacheStatsChip`**：`本 session X% · 近 7 天 Y%`，10s 刷新，hover tooltip 看最近几条调用原始数字
- Spec: docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md（§5 / §6）
- Plan: docs/superpowers/plans/2026-05-07-copilot-v25-m1-context-collapse.md（Task 10-17）
```

- [ ] **Step 5: 最终 commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for v2.5 M2 compact_boundary + cache telemetry"
```

---

---

## Part 3 · M3 — 会话级 alwaysAllow

> **前置条件**：M1 + M2 已合入 main（实际 M3 只依赖 v2 主架构，独立于 M1/M2；但建议最后实施，一并 polish UX）。
> **核心设计决策**（见"注意现状偏差" #10-11）：双层短路，客户端为主（`use-chat-stream` L238 处）+ 服务端 `confirmGateHook` 为防御层。

---

## Task 18: `session-allow.ts` 纯函数 + sessionStorage helper

**Files:**
- Create: `src/lib/copilot/session-allow.ts`
- Create: `src/lib/copilot/__tests__/session-allow.test.ts`

- [ ] **Step 1: 写 failing test**

> **决策（基于 vitest.config.ts: `environment: "node"` + 仓库无 jsdom devDep）**：本测**只保留** `isSessionAllowed` 纯函数测（5 case）。sessionStorage helper（`getSessionAllowList` / `addSessionAllow`）的运行时行为不在 vitest 里测——node env 下 `sessionStorage` 全局变量 undefined，helper 走 `isBrowser()` 守卫直接 no-op，单测断言无意义；改由 Task 20 e2e + Task 21 手动验证（在浏览器 F12 sessionStorage 看 key 写入）覆盖。
>
> 若未来引入 jsdom 想补单测：`npm i -D jsdom` + 在测文件顶部加 `// @vitest-environment jsdom`，然后追加 sessionStorage describe 块（pattern 见 `src/components/copilot/store.tsx` 的 `SS_CONTEXTS` 用法 —— 需要 `beforeEach(() => sessionStorage.clear())`）。

```typescript
// src/lib/copilot/__tests__/session-allow.test.ts
import { describe, it, expect } from 'vitest'
import { isSessionAllowed } from '../session-allow'

describe('isSessionAllowed (pure function, server + client shared)', () => {
  it('returns false when allowList is undefined', () => {
    expect(isSessionAllowed(undefined, 'edit_template')).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isSessionAllowed([], 'edit_template')).toBe(false)
  })

  it('returns true when toolName is in list', () => {
    expect(isSessionAllowed(['edit_template', 'restart_experiment'], 'edit_template')).toBe(true)
  })

  it('returns false when toolName missing', () => {
    expect(isSessionAllowed(['edit_template'], 'restart_experiment')).toBe(false)
  })

  it('is exact match, not substring', () => {
    expect(isSessionAllowed(['edit_template'], 'edit_template_v2')).toBe(false)
    expect(isSessionAllowed(['edit'], 'edit_template')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑确认 fail**

```bash
npx vitest run src/lib/copilot/__tests__/session-allow.test.ts
```

Expected: FAIL — `Cannot find module '../session-allow'`。

- [ ] **Step 3: 写 session-allow.ts**

```typescript
// src/lib/copilot/session-allow.ts
//
// spec §8: 会话级 alwaysAllow。
// - `isSessionAllowed`：纯函数，client + server 共用（服务端 confirmGateHook 防御层）
// - `getSessionAllowList` / `addSessionAllow`：sessionStorage helpers，仅客户端（SSR / server 调用会直接 no-op）
//
// 隐私默认：sessionStorage 是 per-tab + 会话关即清，完全不持久化跨 session / 跨 tab。
// spec §8.3 明确不做 4 源 / alwaysDeny / alwaysAsk / pattern 匹配。

const KEY = (sessionId: string) => `evalyst-copilot-allow-${sessionId}`

/**
 * 纯函数：client 和 server 都用。
 * 服务端 `confirmGateHook` 从 body.session_allow_list 收到数组后调这个判断；
 * 客户端 SSE handler 把 sessionStorage 读出来调这个判断。
 */
export function isSessionAllowed(
  allowList: string[] | undefined,
  toolName: string,
): boolean {
  return Array.isArray(allowList) && allowList.includes(toolName)
}

// ---------- sessionStorage helpers（client only）----------

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

export function getSessionAllowList(sessionId: string): string[] {
  if (!isBrowser()) return []
  try {
    const raw = sessionStorage.getItem(KEY(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

export function addSessionAllow(sessionId: string, toolName: string): void {
  if (!isBrowser()) return
  try {
    const current = getSessionAllowList(sessionId)
    if (current.includes(toolName)) return
    const next = [...current, toolName]
    sessionStorage.setItem(KEY(sessionId), JSON.stringify(next))
  } catch {
    // 静默失败：隐私模式 / quota 满 / 其他异常都不影响主流程
  }
}
```

- [ ] **Step 4: 跑 pass**

```bash
npx vitest run src/lib/copilot/__tests__/session-allow.test.ts
npx tsc --noEmit
```

Expected: 5 PASS（全部 `isSessionAllowed` 纯函数 case）。

- [ ] **Step 5: commit**

```bash
git add src/lib/copilot/session-allow.ts \
        src/lib/copilot/__tests__/session-allow.test.ts
git commit -m "feat(copilot): session-allow helpers for v2.5 M3 alwaysAllow"
```

---

## Task 19: 服务端防御层 — hooks + runtime + routes

**Files:**
- Modify: `src/lib/copilot/tools/hooks.ts`
- Modify: `src/lib/copilot/tool-runtime.ts`
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`
- Modify: `src/app/api/copilot/sessions/[id]/chat/route.ts`
- Modify/Create: `src/lib/copilot/tools/__tests__/hooks.test.ts`

> 本 Task 落盘服务端 hook + 透传链。**当前 `/tool-result` 走 `skipConfirm: true` 根本不调 `confirmGateHook`**（注意偏差 #10）—— 这层改动当前无副作用，但 spec 一致 + 为未来 `/chat` 内执行工具留好钩子。实际用户 UX 的变化由 Task 20 承担。

- [ ] **Step 1: 写 hook 测（先 fail）**

如果 `src/lib/copilot/tools/__tests__/hooks.test.ts` 不存在就新建：

```typescript
// src/lib/copilot/tools/__tests__/hooks.test.ts（新建或追加）
import { describe, it, expect } from 'vitest'
import { confirmGateHook } from '../hooks'
import type { AnyToolDescriptor } from '../registry'

function fakeTool(overrides: Partial<AnyToolDescriptor['metadata']> = {}): AnyToolDescriptor {
  return {
    name: 'edit_template',
    description: '',
    inputSchema: { type: 'object' },
    metadata: {
      isReadOnly: false,
      isDestructive: true,
      maxResultSizeChars: 4000,
      ...overrides,
    },
    call: async () => ({}),
  } as never
}

describe('confirmGateHook (v2.5 M3 session allow list short-circuit)', () => {
  it('require_confirm for destructive tool without allow list', async () => {
    const r = await confirmGateHook({
      tool: fakeTool(), input: {}, session_id: 's', session_allow_list: undefined,
    })
    expect(r).toEqual({ action: 'require_confirm' })
  })

  it('require_confirm when tool not in allow list', async () => {
    const r = await confirmGateHook({
      tool: fakeTool(), input: {}, session_id: 's',
      session_allow_list: ['restart_experiment'],
    })
    expect(r).toEqual({ action: 'require_confirm' })
  })

  it('proceed when tool IS in allow list (short-circuit)', async () => {
    const r = await confirmGateHook({
      tool: fakeTool(), input: {}, session_id: 's',
      session_allow_list: ['edit_template'],
    })
    expect(r).toEqual({ action: 'proceed' })
  })

  it('proceed for read-only tool regardless of allow list', async () => {
    const r = await confirmGateHook({
      tool: fakeTool({ isReadOnly: true, isDestructive: false }),
      input: {}, session_id: 's',
    })
    expect(r).toEqual({ action: 'proceed' })
  })
})
```

- [ ] **Step 2: 跑确认 fail（因为 PreToolCallCtx 还不含 session_allow_list）**

```bash
npx vitest run src/lib/copilot/tools/__tests__/hooks.test.ts
```

Expected: Type error 或 runtime FAIL。

- [ ] **Step 3: 改 hooks.ts**

```typescript
// src/lib/copilot/tools/hooks.ts

// 顶部 import 区追加：
import { isSessionAllowed } from "../session-allow"

// PreToolCallCtx（L12-16）扩字段：
export interface PreToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  session_id: string
  /** v2.5 §8: per-request 的会话级信任列表（客户端 sessionStorage → body → hook） */
  session_allow_list?: string[]
}

// confirmGateHook（L41-44）加短路分支：
export const confirmGateHook: PreToolCallHook = async ({ tool, session_allow_list }) => {
  // v2.5 §8: 会话级 alwaysAllow 先查，命中直接放行
  if (isSessionAllowed(session_allow_list, tool.name)) {
    return { action: "proceed" }
  }
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}
```

- [ ] **Step 4: 改 tool-runtime.ts**

```typescript
// src/lib/copilot/tool-runtime.ts

// RunTool opts 扩字段（L43）：
export async function runTool(
  tool: AnyToolDescriptor,
  input: unknown,
  ctx: ToolContext,
  opts: { skipConfirm?: boolean; sessionAllowList?: string[] } = {},
): Promise<RunToolResult> {
  if (!opts.skipConfirm) {
    for (const hook of preToolCallHooks) {
      const r = await hook({
        tool,
        input,
        session_id: ctx.session_id,
        session_allow_list: opts.sessionAllowList,  // ← 透传
      })
      if (r.action === "deny") return { kind: "denied", reason: r.reason }
      if (r.action === "require_confirm") return { kind: "awaiting_confirm" }
    }
  }
  // ... 其他保持不变
}
```

- [ ] **Step 5: 改 `/tool-result` route**

```typescript
// src/app/api/copilot/sessions/[id]/tool-result/route.ts

// body schema（L47-54 那一带）扩字段：
const body = (await req.json().catch(() => ({}))) as {
  call_id?: string
  tool_name?: string
  input?: Record<string, unknown>
  denied?: boolean
  reason?: string
  client_snapshot?: ClientSnapshot
  session_allow_list?: string[]  // ← 新增
}

// runTool 调用（L90 附近）加 opts.sessionAllowList：
const result = await runTool(
  tool,
  body.input ?? {},
  { session_id, signal: req.signal },
  { skipConfirm: true, sessionAllowList: body.session_allow_list },
)
```

> 注意：`skipConfirm: true` 保留——这是 `/tool-result` 的现有语义（用户 Confirm 后再次 run 不能再问一次）。`sessionAllowList` 在当前 `skipConfirm: true` 下不生效；留 API 接口一致。

- [ ] **Step 6: 改 `/chat` route（body 一致，不参与 runTool 链）**

```typescript
// src/app/api/copilot/sessions/[id]/chat/route.ts

// body schema（L39-46 那一带）扩字段：
const body = (await req.json().catch(() => ({}))) as {
  user_message?: string
  parent_id?: string
  model_id?: string
  contexts?: CopilotContextRef[]
  client_snapshot?: ClientSnapshot
  session_allow_list?: string[]  // ← 新增（当前 `/chat` 流不调 runTool，但 spec 一致 + 为未来留口子）
}
```

> `/chat` 当前不消费 `session_allow_list`（不调 runTool），加字段**纯为 spec 一致和未来扩展**。实际 UX 由 Task 20 客户端短路承担。

- [ ] **Step 7: 跑全量**

```bash
npx vitest run src/lib/copilot
npx tsc --noEmit
```

Expected: 4 新增 hook 测 + 全量既有测 PASS；tsc 0 错误。

- [ ] **Step 8: commit**

```bash
git add src/lib/copilot/tools/hooks.ts \
        src/lib/copilot/tool-runtime.ts \
        src/app/api/copilot/sessions/[id]/tool-result/route.ts \
        src/app/api/copilot/sessions/[id]/chat/route.ts \
        src/lib/copilot/tools/__tests__/hooks.test.ts
git commit -m "feat(copilot): server-side confirmGate short-circuit on session allow list"
```

---

## Task 20: 客户端短路 + Confirm 卡 Checkbox + body propagation + i18n

**Files:**
- Modify: `src/components/copilot/use-chat-stream.ts`
- Modify: `src/components/copilot/tool-call-card.tsx`
- Modify: `src/components/copilot/chat-view.tsx`（prop 透传 adapter）
- Modify: `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts`

- [ ] **Step 1: 加 i18n key（zh + en 成对）**

```typescript
// src/lib/i18n/zh.ts copilot.tool.* 段追加：
'copilot.tool.always_allow': '本次会话信任此工具',
'copilot.tool.always_allow_hint': '勾选后同一工具下次调用不再弹确认（仅限本 tab / 本会话）',
```

```typescript
// src/lib/i18n/en.ts 对应：
'copilot.tool.always_allow': 'Trust this tool for this session',
'copilot.tool.always_allow_hint': 'If checked, future calls of this tool skip confirm (tab / session scoped only)',
```

- [ ] **Step 2: 改 `tool-call-card.tsx` 的 WriteVariant**

顶部 import 追加：

```typescript
import { Checkbox } from "@/components/ui/checkbox"
```

> 先 `ls src/components/ui/checkbox.tsx` 确认存在；若无 `npx shadcn@latest add checkbox` 装一下（新 file 会被 git 追踪）。

`Props` 签名改（约 L12-18 附近）：

```typescript
interface ToolCallCardProps {
  // ... 其他 props 保持
  onConfirm: (alwaysAllow: boolean) => void   // ← 改，带 alwaysAllow 参数
  onDeny: (reason: string) => void
}
```

`WriteVariant`（约 L400-505）的 useState 组追加：

```typescript
const [alwaysAllow, setAlwaysAllow] = useState(false)
```

在 Confirm / Deny 按钮的上方（Confirm 按钮之前，约 L467 位置）插入 Checkbox：

```tsx
<div className="flex items-start gap-2 mt-3 mb-2">
  <Checkbox
    id={`always-allow-${call_id}`}
    checked={alwaysAllow}
    onCheckedChange={(v) => setAlwaysAllow(v === true)}
  />
  <label
    htmlFor={`always-allow-${call_id}`}
    className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none"
    title={t('copilot.tool.always_allow_hint')}
  >
    {t('copilot.tool.always_allow')}
  </label>
</div>
```

Confirm button onClick 改成：

```tsx
<Button onClick={() => onConfirm(alwaysAllow)}>{t('copilot.tool.confirm')}</Button>
```

- [ ] **Step 3: 改 `use-chat-stream.ts`**

顶部 import 追加：

```typescript
import {
  isSessionAllowed,
  getSessionAllowList,
  addSessionAllow,
} from "@/lib/copilot/session-allow"
```

**核心客户端短路**——SSE handler 的 `tool_use_end` 处（约 L238）：

```typescript
// 旧
if (!needsConfirm(ev.tool_name)) {
  pendingAutoRunRef.current.push({ call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
}

// 新
const sessionAllowList = sessionId ? getSessionAllowList(sessionId) : []
if (!needsConfirm(ev.tool_name) || isSessionAllowed(sessionAllowList, ev.tool_name)) {
  pendingAutoRunRef.current.push({ call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
}
```

**`confirmTool` 签名 + sessionStorage 写入**（约 L389-394）：

```typescript
// 旧
const confirmTool = (call_id, tool_name, tool_input) => {
  void postToolResult(call_id, tool_name, tool_input, false)
}

// 新
const confirmTool = (
  call_id: string,
  tool_name: string,
  tool_input: Record<string, unknown>,
  alwaysAllow: boolean = false,
) => {
  if (alwaysAllow && sessionId) {
    addSessionAllow(sessionId, tool_name)
  }
  void postToolResult(call_id, tool_name, tool_input, false)
}
```

**body 加 `session_allow_list`**——`postToolResult`（约 L354-357）和 `send`（grep 找 `/chat` POST 处）两处：

```typescript
// postToolResult 内部 fetch body：
body: JSON.stringify({
  call_id, tool_name, input, denied, reason,
  client_snapshot,
  session_allow_list: sessionId ? getSessionAllowList(sessionId) : [],  // ← 新增
}),

// send 内部 /chat fetch body 同样追加：
session_allow_list: sessionId ? getSessionAllowList(sessionId) : [],
```

- [ ] **Step 4: chat-view.tsx prop 透传 adapter**

grep 确认 chat-view 把 `confirmTool` 传给 ToolCallCard 的地方：

```bash
grep -n "confirmTool\|onConfirm" src/components/copilot/chat-view.tsx
```

把 ToolCallCard 的 `onConfirm` prop 适配新签名。多数情况下已经是个 arrow function，直接扩参：

```tsx
// 旧
<ToolCallCard
  ...
  onConfirm={() => confirmTool(msg.call_id!, msg.tool_name!, msg.tool_input!)}
  ...
/>

// 新
<ToolCallCard
  ...
  onConfirm={(alwaysAllow) => confirmTool(msg.call_id!, msg.tool_name!, msg.tool_input!, alwaysAllow)}
  ...
/>
```

- [ ] **Step 5: tsc + 手动 e2e**

```bash
npx tsc --noEmit
npm run dev
```

1. ⌘K 开 copilot，问一个让 LLM 调 `edit_template`（写工具）的 prompt
2. Confirm 卡出现 → 勾选"本次会话信任此工具" → 点确认 → 工具执行
3. 再问 LLM 一次让它再调 `edit_template` → **应该不再弹 Confirm 卡**，直接 auto-run（在 SSE 中被客户端短路）
4. F12 Application → sessionStorage → key `evalyst-copilot-allow-{sid}` → value 含 `["edit_template"]`
5. 关 tab 重开 → sessionStorage 清空 → 同工具再调又弹 Confirm（per-tab 语义正确）

- [ ] **Step 6: commit**

```bash
git add src/components/copilot/use-chat-stream.ts \
        src/components/copilot/tool-call-card.tsx \
        src/components/copilot/chat-view.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(copilot): client-side alwaysAllow checkbox + SSE short-circuit"
```

---

## Task 21: M3 集成验证 + CHANGELOG + PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 全量测**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: tsc 0 错误；vitest 全 PASS（M3 新增 ~8 case）；next build 通过。

- [ ] **Step 2: e2e smoke**

```bash
npm run test:e2e
```

Expected: 9 case PASS（M3 只加客户端行为，不破现有路由）。

- [ ] **Step 3: 手动验证 3 条 UX 分支**

```bash
npm run dev
```

1. **勾选 alwaysAllow**：问"改下 xxx template 的 prompt"→ Confirm 卡 → 勾选 + 确认 → 工具跑；再问同样改动 → 直接 auto-run 不弹卡
2. **不勾选**：Confirm 卡 → 直接点确认（不勾 checkbox）→ 工具跑；再问同样 → 仍然弹卡（sessionStorage 没写入）
3. **Deny 不受影响**：Confirm 卡 → 点"拒绝"输入理由 → 工具不跑；sessionStorage 无写入

- [ ] **Step 4: 写 CHANGELOG M3 条目**

打开 `CHANGELOG.md`，在 `[Unreleased]` 段 M2 条目之后追加：

```markdown
### Architecture

- Copilot v2.5 M3：会话级 alwaysAllow
  - **新 `session-allow.ts`**：sessionStorage helper（client）+ 纯函数 `isSessionAllowed`（client + server 共用）。key `evalyst-copilot-allow-${sid}` 存 `string[]` 工具名数组，per-tab + per-session，tab 关即清
  - **Confirm 卡加 Checkbox**"本次会话信任此工具"（`tool-call-card.tsx` WriteVariant）。勾选 + 确认 → `useChatStream.confirmTool` 先 `addSessionAllow(sid, tool_name)` 再发 `/tool-result`
  - **双层短路**：
    - **客户端（实际生效层）**：`use-chat-stream.ts` 的 SSE `tool_use_end` handler 在 `needsConfirm()` 处加 `|| isSessionAllowed(getSessionAllowList(sid), tool_name)`，命中直接 push 到 auto-run 队列，跳过 ToolCallCard 渲染
    - **服务端（防御层）**：`PreToolCallCtx` 扩 `session_allow_list?: string[]`；`confirmGateHook` 命中 allow list 直接 proceed；`/chat` 和 `/tool-result` body 都加字段透传。当前 `/tool-result` 走 `skipConfirm: true` 不消费服务端 hook，但留好钩子给未来 `/chat` 内执行工具的架构升级
  - **spec §8.5 澄清**：spec 原文写"短路位置在 confirmGateHook"是理论描述；evalyst 当前架构 `/tool-result` skipConfirm 下 hook 是死代码，实际生效层在客户端。plan 注释 #10 显式标注此偏差
- Spec: docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md（§8）
- Plan: docs/superpowers/plans/2026-05-07-copilot-v25-m1-context-collapse.md（Task 18-21）
```

- [ ] **Step 5: 最终 commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for v2.5 M3 session-level alwaysAllow"
```

---

## Task 22: Playwright e2e — chip preview manifest + cache chip 渲染（务实子集）

**Files:**
- Create: `e2e/copilot-v25.spec.ts`
- Modify: `playwright.config.ts`（如需扩 webServer env）—— 通常无需

> **范围说明**：spec §10.3 列了 4 条 e2e 断言，**只把其中 2 条**做成自动化（其他 2 条需要 mock LLM SSE，工程量过大，留作 Task 9/17/21 的手动验证）：
>
> | spec §10.3 断言 | Task 22 处理 |
> |---|---|
> | ① 圈选 task_field → 发消息 → 断 LLM 收到的 system header.active_contexts[0] 不含 input_preview | ❌ **需要拦截 /chat body 解析 system_header**，留手动 / 单测覆盖（Task 2 已锁 `data` 字段不含 input_preview） |
> | ② 圈选 → chip 展开 → 断展开内容是 manifest 形态 | ✅ **本 Task 实现**（不依赖 LLM，只看 `/api/copilot/contexts/resolve` 响应渲染） |
> | ③ Confirm 卡勾"信任"→ 同工具下次不弹 | ❌ **需要 mock LLM SSE 让 LLM 决定调写工具**，Playwright `page.route` 拦截 `/chat` 注入 SSE 流复杂度高，留手动 |
> | ④ session 详情页打开 → 有 cache hit rate 进度条 | ✅ **本 Task 实现**（pre-seed `data/copilot/cache-stats.jsonl` 让 chip 渲染） |

- [ ] **Step 1: 写 e2e spec 文件**

```typescript
// e2e/copilot-v25.spec.ts
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const COPILOT_DIR = path.join(process.cwd(), 'data', 'copilot')
const CACHE_STATS_PATH = path.join(COPILOT_DIR, 'cache-stats.jsonl')

// 第二条测对 cache-stats.jsonl 做 destructive 写：playwright fullyParallel 默认开，
// 多 worker 并发写文件会撕。强制本文件 serial。
test.describe.configure({ mode: 'serial' })

test.describe('Copilot v2.5 e2e', () => {
  test('chip preview shows manifest form (no input_preview leak)', async ({ page }) => {
    // 前提：seed 数据集 + schema + 至少跑过一个实验有 results
    // 假设有个 seed experiment id（取列表第一个；具体看 evalyst seed pattern）
    await page.goto('/')

    // 找到第一个实验卡 → 进详情
    const firstExpLink = page.locator('a[href^="/experiments/"]').first()
    await firstExpLink.click()
    await page.waitForURL(/\/experiments\/[^/]+/)

    // 开 copilot
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await expect(page.locator('[data-copilot-panel]')).toBeVisible()

    // 进 Inspector 模式 - chip rail 上有 Inspector 按钮
    const inspectorBtn = page.getByRole('button', { name: /inspector/i }).first()
    await inspectorBtn.click()

    // 点击页面上第一个 data-copilot-context="task_result" 的元素
    const firstTaskCard = page.locator('[data-copilot-context="task_result"]').first()
    await expect(firstTaskCard).toBeVisible({ timeout: 5000 })
    await firstTaskCard.click()

    // chip 出现在 chip rail
    const chip = page.locator('[data-copilot-panel] >> text=/^#\\d+/').first()
    await expect(chip).toBeVisible()

    // 点开 chip 展开
    const expandBtn = chip.locator('..').getByRole('button').filter({ hasText: /^[^×]+$/ }).first()
    await expandBtn.click()

    // 等待 /api/copilot/contexts/resolve 响应渲染完成
    await page.waitForResponse((res) =>
      res.url().includes('/api/copilot/contexts/resolve') && res.status() === 200,
    )

    // 展开内容里 **不应该** 出现 input_preview 字段名
    const expandedContent = await page.locator('[data-copilot-panel]').textContent()
    expect(expandedContent).not.toContain('input_preview')
    expect(expandedContent).not.toContain('input_refs')
    // 应该看到 manifest 字段（task_result self 形态）
    // 至少有 task_id / status 字面字符串（manifest data 渲染走 JSON.stringify）
    expect(expandedContent).toMatch(/task_id/)
    expect(expandedContent).toMatch(/status/)
  })

  test('cache stats chip renders with weekly seed data', async ({ page }) => {
    // 前置：在 data/copilot/cache-stats.jsonl 写一条最近的 stat
    fs.mkdirSync(COPILOT_DIR, { recursive: true })
    const stat = {
      session_id: 'e2e-seed-session',
      message_id: 'm-seed',
      ts: new Date().toISOString(),
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_tokens: 800,
      cache_read_tokens: 600,
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-6',
    }
    fs.appendFileSync(CACHE_STATS_PATH, JSON.stringify(stat) + '\n')

    try {
      await page.goto('/')

      // 开 copilot
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
      await expect(page.locator('[data-copilot-panel]')).toBeVisible()

      // 等 CacheStatsChip 拉到 weekly.calls > 0 后渲染
      const chip = page.locator('text=/Cache:|Cache 命中|cache hit/i').first()
      await expect(chip).toBeVisible({ timeout: 15000 })

      // chip 文字至少含一个百分号或 — 占位（确认 hit_rate 渲染）
      const chipText = await chip.textContent()
      expect(chipText).toMatch(/%|—/)
    } finally {
      // 清理 seed（**重要**：避免污染下一次跑）
      try {
        const raw = fs.readFileSync(CACHE_STATS_PATH, 'utf-8')
        const filtered = raw.split('\n').filter((l) => l.trim() && !l.includes('e2e-seed-session'))
        fs.writeFileSync(CACHE_STATS_PATH, filtered.join('\n') + (filtered.length ? '\n' : ''))
      } catch {
        // 文件可能不存在或读失败，忽略
      }
    }
  })
})
```

> **selector 注意**：`[data-copilot-panel]` / `[data-copilot-context]` 等 attribute 选择器依赖 evalyst 现有 DOM 标记（`CLAUDE.md` 提到 `data-copilot-context` 是 context 抽取约定）。如果实施时发现 selector 不命中，用 Playwright Inspector (`npx playwright codegen localhost:3000`) 重新拍 selector。
>
> **chip 展开按钮**的 selector 比较脆，可以让 Task 7 实施时给"展开"按钮加 `data-testid="chip-expand"` 以稳定选择。

- [ ] **Step 2: 跑 e2e**

```bash
# 首次需装 chromium（若 CI 还没装）
npx playwright install chromium

npm run test:e2e -- copilot-v25.spec.ts
```

Expected: 2 PASS。

如果 chip preview 测因 seed 数据没 results 跑过失败：
1. 先 `npm run dev`
2. 浏览器手动跑一次 seed experiment（点开始 → 等 finished）
3. 再跑 e2e

如果 cache chip 测 timeout，检查：
- `data/copilot/cache-stats.jsonl` 文件确实创建了
- `/api/copilot/cache-stats?session_id=...` curl 返 weekly.calls > 0
- 10s 自动刷新拿到数据（spec §6.4 设的 setInterval 10_000）

- [ ] **Step 3: 加 selector 稳定 hooks（可选，提升 e2e 可维护性）**

如本 Task 测的 selector 太脆（`getByRole`/`text=/.../i`），考虑回 Task 7 chip rail 实施时给关键节点加 `data-testid`：
- `data-testid="chip"` 给每个 chip 容器
- `data-testid="chip-expand"` 给展开按钮
- `data-testid="cache-stats-chip"` 给 CacheStatsChip 根 div

加了之后 e2e selector 可以换成 `page.getByTestId('chip-expand')`，不依赖 i18n 文案。

- [ ] **Step 4: 追加 CHANGELOG 到 M3 条目末尾**

打开 `CHANGELOG.md`，在 Task 21 Step 4 写的 M3 条目**最后一个 bullet 之后**追加：

```markdown
  - **e2e 自动化**：`e2e/copilot-v25.spec.ts` 覆盖 spec §10.3 两条断言——chip 展开看到 manifest 形态（`input_preview` / `input_refs` 不出现）+ cache hit rate chip 渲染（seed `data/copilot/cache-stats.jsonl` 后 chip 文字含 `%`）。另两条（active_contexts 不含 input_preview / alwaysAllow 勾选后不弹）需 mock LLM SSE，工程量过大留作手动回归
```

- [ ] **Step 5: commit**

```bash
git add e2e/copilot-v25.spec.ts CHANGELOG.md
git commit -m "test(e2e): chip preview manifest + cache chip render for v2.5"
```

> **遗留两条手动验证**（Task 9 / 17 / 21 的 "手动验证" 步骤已覆盖）：
> - spec §10.3 ①：active_contexts 不含 input_preview —— Task 9 Step 3 第 1 条手动验证；单测层 Task 2 已锁定 `r.data` 不含
> - spec §10.3 ③：alwaysAllow 勾选后下次不弹 —— Task 21 Step 3 第 1 条手动验证

---

## Self-Review Checklist

实施完成前对照本节核对（不依赖 subagent，自查）。M1 / M2 各自一组，PR 提交前对应组要全勾。

### M1 (Task 1-9)

1. **Spec §3.2 manifest 表 9 种全覆盖**
   - [ ] experiment / task_result / task_field / dataset / template / display / rubric ← Task 1 manifest.ts 7 个函数
   - [ ] text_selection / rubric_stats ← spec 明确不变，resolve-context.ts 对应分支不动

2. **`resolveContextSelf` 三处泄漏全清**
   - [ ] task_result.data 不含 `input_preview` / `input_refs`（Task 2）
   - [ ] task_field.data 不含 `input_preview`（Task 2）
   - [ ] experiment.data 不含 `prompt_template` / `notes` / `temperature`（Task 2）
   - [ ] template.data 不含 `prompt_template` 全文，仅 excerpt（Task 2）
   - [ ] display.data 不含 JSX 源码（Task 2）
   - [ ] rubric.data 不含 criteria.description / required（Task 2）

3. **`resolveContextById` self/parent 形态**
   - [ ] task_field self = `{targeted_field, targeted_value}`（Task 3）
   - [ ] task_field parent 含 task_meta，**不含 input_preview**（Task 3）
   - [ ] task_result self drop input_preview（Task 3）
   - [ ] task_result parent 的 experiment 子结构是 manifest（不是全量）（Task 3）

4. **`read_page` 也走 manifest（spec §3.6）**
   - [ ] 测锁定 `matches[].content_tree.prompt_template_excerpt` 而非 `prompt_template`（Task 4）
   - [ ] read-page.ts 注释指向 spec §3.6（Task 4）

5. **新工具注册 4 处**
   - [ ] `tools/read-dataset-records.ts`（Task 5 Step 3）
   - [ ] `tools/registry.ts` import + TOOLS 加（Task 5 Step 4）
   - [ ] `tools/metadata-client.ts` 镜像（Task 5 Step 5）
   - [ ] `tool-call-card.tsx` VARIANT_BY_TOOL（Task 5 Step 6）
   - [ ] `metadata-client-sync.test.ts` 自动验两侧对齐（Task 5 Step 8）

6. **划线降权两处**
   - [ ] text-selector.tsx 解构 inspectorActive + enabled 加条件（Task 6 Step 1）
   - [ ] inspector-overlay.tsx 删 4 行让位（Task 6 Step 2）

7. **microCompact 双阈值**
   - [ ] `MicroCompactConfig.maxTotalReplayableTokens?: number` 可选（向后兼容）（Task 8 Step 3）
   - [ ] 反向遍历 + 累加 + 提早 break 算法（Task 8 Step 3）
   - [ ] build-llm-messages.ts 调用方加 `maxTotalReplayableTokens: 4000`（Task 8 Step 5）
   - [ ] 老测仍 PASS（向后兼容 case 验证，Task 8 Step 4）

8. **i18n key 成对**
   - [ ] zh.ts 和 en.ts 都加：`copilot.tool.name.read_dataset_records` / `copilot.tool.summary.read_dataset_records` / `copilot.chip.text_in_host` / `copilot.chip.selected_text` / `copilot.chip.context_anchor` / `copilot.chip.anchor_taken_from` / `copilot.chip.anchor_full_value_hint`

9. **CHANGELOG `[Unreleased]` 写到 §Architecture，含 Spec / Plan 链接**（Task 9 Step 4）

10. **类型一致性**
    - [ ] manifest.ts 函数签名和测试对齐
    - [ ] `MicroCompactConfig` 字段名 `maxTotalReplayableTokens` 在 micro-compact.ts / 测 / build-llm-messages.ts 三处一致
    - [ ] `read_dataset_records` 工具 input shape 在工具实现 / metadata-client / 测 / inputSchema 四处一致（`dataset_id` / `task_id` / `limit` / `offset`）

### M2 (Task 10-17)

11. **CompactBoundaryMessage 数据结构 & 兼容**
    - [ ] `CopilotRole` 加 `'system'`（types.ts L6，Task 10 Step 3）
    - [ ] `CopilotMessage` 加可选 `kind` / `at` / `reason`（types.ts，Task 10 Step 3）—— 不拆 union（继承 PR-3 决定）
    - [ ] `AppendMessageInput` 同步扩 `kind` / `at`（session-store.ts，Task 12 Step 4）
    - [ ] `appendMessage` 写入新字段（Task 12 Step 4）
    - [ ] `appendCompactBoundary` 默认 parent_id 取 session.head_message_id（方案 A）（Task 12 Step 4）
    - [ ] 老 session 无 boundary：`sliceAfterBoundary` 返原 branch，行为等价 v2（boundary.test.ts 第一个 case 验证）

12. **`microCompact` 签名变更影响清单**
    - [ ] 返回类型 `MicroCompactResult = { messages, didCompact }`（Task 11 Step 1）
    - [ ] 唯一生产 caller（build-llm-messages.ts）解构调用（Task 11 Step 3）
    - [ ] 11 个 micro-compact 测全部解构（Task 11 Step 2）
    - [ ] 新增 `didCompact` flag 测：true / false 各一例（Task 11 Step 2）

13. **`buildLlmMessages` 集成**
    - [ ] 加可选第三参数 `opts?: { sessionId?: string }`（Task 12 Step 5）—— 测试不传 opts，保纯函数
    - [ ] 内部 `sliceAfterBoundary(branch)` → `microCompact(usable)` → 条件 `appendCompactBoundary` 顺序正确
    - [ ] for 循环加显式 `if (m.role === 'system') continue`（防御未来误读）（Task 12 Step 5）
    - [ ] stream-response.ts 调用点传 sessionId（Task 12 Step 6）

14. **Cache 字段抽取（llm-stream.ts）**
    - [ ] `usage` accumulator 加 `cache_creation_tokens?` / `cache_read_tokens?`（undefined 而非 0，区分"无数据" vs "0 tokens"）（Task 13 Step 2）
    - [ ] `parseAnthropicEvent` 在 message_start 和 message_delta 都读 cache 字段（Task 13 Step 2）
    - [ ] `parseOpenaiEvent` 读 `prompt_tokens_details.cached_tokens` + 顶层 `cache_read_tokens` 兜底（Task 13 Step 2）
    - [ ] `StreamEvent.done.usage` 类型扩（types.ts，Task 13 Step 1）
    - [ ] `CopilotMessage.usage` **不**扩 cache 字段（cache 走独立 jsonl，session 形态不变）
    - [ ] `stream-response.ts` `RunStreamResult.usage` (L49) + 局部 `assistantUsage` (L67) 同步扩 cache 字段——否则 Task 15 Step 1 写 `assistantUsage?.cache_creation_tokens` 会 tsc fail（Task 13 Step 1）

15. **Cache 遥测落盘 & 聚合**
    - [ ] `CacheUsageStat` 8 字段（session_id / message_id / ts / input_tokens / output_tokens / cache_*? / provider / model）（Task 14 Step 3）
    - [ ] `aggregateCacheHitRate` 按 provider 分桶：Anthropic denom = input + cache_read + cache_creation；OpenAI denom = input_tokens（Task 14 Step 3）
    - [ ] `hasAnyCache` 判定：所有 stat 都没 cache 字段时返 `null`（区分"不支持"与"0%"）（Task 14 Step 3）
    - [ ] `provider` 字段二选一 `'anthropic' | 'openai'`，与 `api_format` 对齐（Task 15 Step 1，Gemini 走 OpenAI 兼容）
    - [ ] `runToolAwareLlmStream` 在 append assistant 之后调 `appendCacheStat`（Task 15 Step 1）
    - [ ] `message_id` 没 assistant 时 fallback 到 `toolUseMessageIds[0]`（Task 15 Step 1）

16. **`/api/copilot/cache-stats` GET API**
    - [ ] 返 `{ session: {...recent}, weekly: {...} }`（Task 15 Step 2）
    - [ ] `since_ms = 7 * 24 * 60 * 60 * 1000`
    - [ ] `recent` 取 session 最近 10 条倒序

17. **CacheStatsChip UI**
    - [ ] 挂在 chat-view `RouteChangeBanner` 之后、messages 滚动区之前（Task 16 Step 3）
    - [ ] 0 calls 时不渲染（避免空 chip）（Task 16 Step 2）
    - [ ] hit_rate `null` 显示 `—`（Task 16 Step 2 `formatPct`）
    - [ ] 10s 自动刷新（setInterval）（Task 16 Step 2）
    - [ ] 不走玻璃（panel 内部，扁平 shadcn）（Task 16 Step 2 注释提到）

18. **i18n key 成对（M2 部分）**
    - [ ] zh.ts + en.ts 同步加：`copilot.cache.label` / `copilot.cache.session` / `copilot.cache.weekly` / `copilot.cache.no_data` / `copilot.cache.tooltip.recent_title` / `copilot.cache.tooltip.input` / `copilot.cache.tooltip.cache_read` / `copilot.cache.tooltip.cache_create` / `copilot.cache.tooltip.unsupported`

19. **CHANGELOG `[Unreleased]` M2 条目** 含 Spec §5 / §6 链接 + Plan Task 10-17 提示（Task 17 Step 4）

20. **类型一致性（M2）**
    - [ ] `CacheUsageStat.provider` 在 cache-stats-store.ts / route.ts / chat-view 类型 import 一致
    - [ ] `MicroCompactResult` 字段名 `messages` / `didCompact` 在 micro-compact.ts / 测 / build-llm-messages.ts 三处一致
    - [ ] boundary 字段 `kind` / `at` / `reason` 在 types.ts / session-store.ts / appendCompactBoundary 三处一致
    - [ ] `sliceAfterBoundary` 在 boundary.ts / build-llm-messages.ts 一处定义一处使用

### M3 (Task 18-21)

21. **`session-allow.ts` 纯函数语义**
    - [ ] `isSessionAllowed(undefined, ...)` 返 false（防御 server 端 body 缺字段）（Task 18 Step 3）
    - [ ] `isSessionAllowed([], ...)` 返 false
    - [ ] 精确匹配（substring 不算）：`['edit'] + 'edit_template'` 返 false（Task 18 Step 1 测）
    - [ ] sessionStorage helper SSR 下 no-op（`typeof window === 'undefined'` 守卫）（Task 18 Step 3）
    - [ ] `addSessionAllow` 去重（同工具加多次只存一份）（Task 18 Step 1 测）

22. **服务端防御层（Task 19）**
    - [ ] `PreToolCallCtx` 扩 `session_allow_list?: string[]`（hooks.ts L12-16）
    - [ ] `confirmGateHook` 命中 allow list 直接 `proceed`（hooks.ts L41-44）
    - [ ] `runTool.opts` 扩 `sessionAllowList?: string[]`（tool-runtime.ts L43）
    - [ ] runTool 构造 PreToolCallCtx 时透传 `session_allow_list: opts.sessionAllowList`（tool-runtime.ts L47）
    - [ ] `/tool-result` body schema 加字段，runTool 调用传 opts（route.ts）
    - [ ] `/chat` body schema 加字段（spec 一致；当前不消费）
    - [ ] hooks 4 个新测全 PASS（require_confirm 兜底 / 不在 list / 命中 / read-only 不受影响）

23. **客户端核心短路（Task 20）**
    - [ ] use-chat-stream.ts SSE `tool_use_end` 处的 `needsConfirm()` 判断加 `|| isSessionAllowed(getSessionAllowList(sid), tool_name)`（约 L238）
    - [ ] `confirmTool` 签名扩 `alwaysAllow: boolean = false`（默认 false 向后兼容）
    - [ ] `confirmTool` 内部 `if (alwaysAllow && sessionId) addSessionAllow(...)` 在 `postToolResult` 之前
    - [ ] `postToolResult` body 和 `send`（/chat）body 都加 `session_allow_list: getSessionAllowList(sid)`
    - [ ] 每次 fetch 都重读 sessionStorage（不缓存到组件 state；spec 一致 + 跨 SSE 流场景需要）

24. **Confirm 卡 UI（Task 20）**
    - [ ] `Props.onConfirm` 签名改 `(alwaysAllow: boolean) => void`
    - [ ] `WriteVariant` 加 `useState<boolean>(false)` for alwaysAllow
    - [ ] `<Checkbox>` 渲染在 Confirm/Deny 按钮上方
    - [ ] Confirm button onClick 改成 `() => onConfirm(alwaysAllow)`
    - [ ] chat-view.tsx 把 ToolCallCard 的 `onConfirm` adapter 改成 `(alwaysAllow) => confirmTool(..., alwaysAllow)`

25. **i18n key 成对（M3 部分）**
    - [ ] zh.ts + en.ts 同步加：`copilot.tool.always_allow` / `copilot.tool.always_allow_hint`

26. **隐私 / 安全默认**
    - [ ] sessionStorage 自然 per-tab + 会话关即清，**不**写 localStorage / 不写 jsonl 落盘
    - [ ] 不做跨 tab 同步（spec 8.6）
    - [ ] 不做 alwaysDeny / alwaysAsk / pattern 匹配（spec 8.6）

27. **CHANGELOG `[Unreleased]` M3 条目** 含 spec §8 链接 + Task 18-21 提示 + spec 偏差澄清（Task 21 Step 4）

28. **类型一致性（M3）**
    - [ ] `session_allow_list` 字段名在所有地方一致：sessionStorage key / body schema / PreToolCallCtx / hooks.ts / tool-runtime.ts opts (`sessionAllowList` camelCase 仅用于 ts opts，body 字段保持 `session_allow_list` snake_case 与 evalyst 既有约定一致)
    - [ ] `onConfirm: (alwaysAllow: boolean) => void` 在 tool-call-card.tsx Props / chat-view.tsx 调用点一致
    - [ ] `confirmTool` 签名 `(call_id, tool_name, input, alwaysAllow?)` 在 use-chat-stream.ts / chat-view.tsx 一致

### Task 22 (E2E 务实子集)

29. **Playwright e2e 覆盖的 2 条（自动化）**
    - [ ] chip preview manifest 形态：圈选 task_result → chip 展开 → 断 `input_preview` / `input_refs` 字面字符串不出现
    - [ ] cache stats chip 渲染：seed `data/copilot/cache-stats.jsonl` → 打开 copilot → chip 文字含 `%` 或 `—`
    - [ ] seed 清理：测末尾 filter 掉 `e2e-seed-session` 行，避免污染下次跑

30. **遗留手动验证（spec §10.3 ① 和 ③）**
    - [ ] active_contexts 不含 input_preview —— Task 9 Step 3 第 1 条（单测 Task 2 辅助锁定）
    - [ ] alwaysAllow 勾选后下次不弹 —— Task 21 Step 3 第 1 条（需 mock LLM SSE 的 e2e 工程量过大，留手动）

31. **（可选）稳定 selector**
    - [ ] 如本 Task e2e selector 太脆（text/role 依赖 i18n 文案），回 Task 7 / Task 16 实施时给关键节点加 `data-testid="chip"` / `chip-expand"` / `cache-stats-chip`，e2e 换 `page.getByTestId(...)`
