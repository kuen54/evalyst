# Audit Cleanup M1–M5 Design

## Context

2026-05-01 做的代码审计报告把 19 条 finding 分成四档（必须改 / 值得改 / 可以不改 / 不要改），推荐"一周全面"路径覆盖 9 条：
- **必须改 3 条**：F1（fs 模块违反惰性 cwd 约定，7 处）· F2（`context-mask.tsx` 硬编 "移除"）· F3（CLAUDE.md/README 测试数字 doc drift 110 vs 217）
- **值得改 6 条**：F4（`/chat` + `/tool-result` route 重复 ~100 行 × 2）· F5（`chat-view.tsx` 812 行多职责）· F6（`batch-runner.run` 并发控制绕 + 二段 polling）· F7（OpenAI `Authorization` 头不加 Bearer 前缀）· F8（`form-state.ts` 270 行纯函数无 `__tests__`）· F9（README "开源前会补鉴权" 过期 footnote）

审计结论摘要："总体 7.5/10，局部 debt 明确且可收敛。首要问题是代码里违反自己写的约定（F1 / F2 / F3 / F9）—— 这是外部读者立刻看到的'你们说一套做一套'。" 详见 audit 原报告。

## Goals

1. 清掉 4 条"违反自家约定"的可见 debt（F1 / F2 / F3 / F9）
2. 解决外部用户首配置 LLM 的 Bearer 陷阱（F7）
3. 给 270 行纯函数补 round-trip 测试兜底（F8）
4. 收敛 copilot 近期迭代积累的代码复制 / 文件过载（F4 / F5）
5. 把 `batch-runner` 并发控制从"polling + 二段补救"换成标准 Promise pool（F6）

**强约束：不改变用户可见的业务行为。** 每个 PR 合并后，UI / API / data/ 文件 shape / 测试数字 / skill 输出**必须保持一致**。F7 是**唯一**语义扩展（首次让"纯 `sk-...` key"正常工作），它是**加法**而非"改变已工作场景"。

## Non-Goals

- 不引入新功能、新资源类型、新 UI 交互、新 skill
- 不换技术栈（不引 ORM / Redux / next-intl / job queue）
- 不动 theme cascade（`src/lib/theme/*` + `layout.tsx` 的 inline `<style>` + `sidebar.cycleTheme`）—— CHANGELOG v0.5.4-0.5.7 刚收敛，再动风险收益比差
- 不动 i18n zh.ts / en.ts 的扁平结构（1046 行有意为之）
- 不动 `llm-stream.ts` 580 行（职责内聚）
- 不动 `copilot/store.tsx` 的 NOOP_STORE fallback
- 不做 PR 17 已合完的 workflow 约定 meta 工作
- 不再扩大 scope 到 audit 外发现的其它点

## Scope 矩阵

| Milestone | 对应 finding | 分支 | 类型 | 工作量 | Tag 打算 |
|---|---|---|---|---|---|
| **M1** | F1 + F2 + F3 + F7 + F9 | `refactor/audit-cleanup-convention` | 1 PR | 1h | 合并后不 tag |
| **M2** | F8 | `test/form-state-roundtrip` | 1 PR | 1h | 合并后不 tag |
| **M3** | F4 | `refactor/copilot-stream-response` | 1 PR | 1–2h | 合并后不 tag |
| **M4** | F5 | `refactor/copilot-chat-view-split` | 1 PR | 半天 | 观察一两天后 tag `v0.5.8` |
| **M5** | F6 | `refactor/batch-runner-promise-pool` | 1 PR | 半天 | 合并 + M4 稳定后 tag `v0.6.0` |

五个 milestone 各自独立，无**强**依赖（M4 不依赖 M3；M5 独立）。唯一的 **软依赖**：M4 拆 `chat-view.tsx` 时如果 M3 已先合，chat-view 里调的就是新的 `runToolAwareLlmStream` helper 的 **client 侧** 实际上不动（client 走 SSE）—— 其实独立。**排序按审计报告原序（先易后难、先约定后架构）执行。**

---

## M1 · 约定对齐 + 用户坑修补（F1 + F2 + F3 + F7 + F9）

### 目标

一个 PR 清掉所有"违反已写约定"的点 + 修 Bearer 前缀坑 + 刷文档数字。

### 设计

**F1 · fs 模块惰性 cwd（7 文件）**

目标改写 7 个文件的顶层 `const XXX_DIR = path.join(process.cwd(), ...)` 为惰性函数 `function xxxDir() { return path.join(process.cwd(), ...) }`，对齐已有 `llm-config.ts` / `annotation-store.ts` / `copilot/session-store.ts` 的写法。

| 文件 | 原 const | 改成 |
|---|---|---|
| `src/lib/store.ts` | `DATA_DIR / EXPERIMENTS_DIR / RESULTS_DIR` | `dataDir() / experimentsDir() / resultsDir()` |
| `src/lib/rubric-store.ts` | `RUBRICS_DIR` | `rubricsDir()` |
| `src/lib/seed.ts` | `SEEDS_DIR / DATASETS_DIR / SCHEMAS_DIR / RUBRICS_DIR` | `seedsDir() / datasetsDir() / schemasDir() / rubricsDir()` |
| `src/lib/displays.ts` | `DISPLAYS_DIR` | `displaysDir()` |
| `src/lib/schema/user-schema-store.ts` | `SCHEMAS_DIR` | `schemasDir()` |
| `src/lib/datasets.ts` | `DATASETS_DIR` | `datasetsDir()` |

**原则**：函数名对应原 const 的 lowerCamel；调用点 `path.join(DATASETS_DIR, id)` 直接变成 `path.join(datasetsDir(), id)`。每个文件内独立，不抽 shared helper（YAGNI）。

**验证**：`tsc --noEmit` + 217 vitest 全绿 + 9 e2e smoke 全绿。`seed.ts` 在生产场景 ensureSeeds 幂等效果不变。

**F2 · `context-mask.tsx` 硬编 "移除" 走 i18n**

- 在 `src/lib/i18n/zh.ts` + `en.ts` 成对加 key：`copilot.context_remove_title`（中："移除" / 英："Remove"）
- 改 `src/components/copilot/context-mask.tsx` `title / aria-label` 用 `t("copilot.context_remove_title")`
- 跑 `tsc --noEmit`（en.ts 的 `Record<keyof typeof zh, string>` 约束会验证 key 对齐）

**F3 · 测试数字 doc drift**

扫全仓 "110 case" / "110 个 test case" / "104 case" / "109 case" 之类，全部改成动态描述（避免再 stale）：
- CLAUDE.md L13 + L236：`vitest（纯函数单测，约 200+ case）` 或具体当前数字 217
- README.md L410：同上

**保险做法**：直接写实数（217），CHANGELOG 每涨一档顺手刷一次。"约 200+" 过于模糊，外部读者看到会觉得含糊。

**F7 · OpenAI Authorization 自动加 Bearer 前缀**

- `src/lib/llm-client.ts` L118 `'Authorization': config.api_key` → `'Authorization': config.api_key.startsWith('Bearer ') ? config.api_key : 'Bearer ' + config.api_key`
- 给 `buildApiRequest` 加一条 unit test（放 `src/lib/__tests__/llm-client.test.ts`，新文件）：
  - 纯 `sk-...` → 自动加 Bearer
  - 已有 `Bearer sk-...` → 不重复加
  - Anthropic format → `x-api-key` 不动（走另一分支）
- 更新 README Q&A 的 Bearer 注释：删"OpenAI 兼容格式 Authorization 头直接是 key（不带 Bearer 的系统在 extra_body 自行处理）"这句，换成"OpenAI 兼容 API：直接填 api_key 即可（会自动加 `Bearer ` 前缀）。如果你的 gateway 明确不要 Bearer，参考 advanced 章节用 `extra_body` 自定义。"

**行为风险评估**：
- 已有用户把 `Bearer sk-...` 塞进 api_key（workaround）：`startsWith` 检测保留原值 ✅
- 已有用户填纯 `sk-...`（当前 401）：修好 ✅
- 已有用户填 `sk-...` 且连的是**不要 Bearer 的网关**（例如某些内部 OpenAI-compat gateway）：**新代码会自动加 Bearer，原本工作的会失败**

最后一种情况是唯一真正的行为破坏。对策：**暂不提供 UI 选项**，如果有人遇到再加 `ModelConfig.auth_no_bearer_prefix?: boolean`。CHANGELOG 里明确 call-out"破坏性变更候选"让用户能在 issue 里反馈。

**F9 · README 鉴权 footnote 刷新**

`README.md` 第 314 行 "当前 API 无鉴权，适合本地开发。开源前会补 token 机制。" → "**当前 API 无鉴权**（适合本地/单机自用）。**跨网暴露**请自己加反代 + basic auth / OAuth。原生鉴权不在路线图里，需求请开 issue 讨论。"

### 测试策略

- tsc 必须过
- 现有 217 vitest 全绿（F1 不会加新测；F2 i18n 不需要测；F7 新增 3 cases → 220 total；F3 + F9 只改文档）
- 新增 `buildApiRequest` 测试覆盖 Bearer 分支
- Playwright smoke 全绿（验证 LLM 设置页不崩）

### 提交节奏（一个 PR 内）

5 个 commit，每 commit 一个 finding，分开以便 bisect：
1. `refactor(fs): lazy-resolve cwd in 7 storage modules (F1)`
2. `i18n(copilot): localize context-mask remove button (F2)`
3. `docs: update test count from 110 to 217 (F3)`
4. `feat(llm-client): auto-prefix Bearer for openai Authorization header (F7)`
5. `docs(readme): remove stale auth promise (F9)`

### PR description 必含 4 段（按 AGENTS.md）

- 改了什么（5 条 finding 对应）
- 为什么（audit report 指路 + F7 的行为扩展说明）
- 怎么验证（`tsc --noEmit && npm test && npm run test:e2e && npm run build`）
- 向后兼容风险（F7 对不要 Bearer 的 OpenAI-compat gateway 是破坏性；其它 5 条无）

---

## M2 · form-state 测试补完（F8）

### 目标

给 `src/components/template-builder/form-state.ts` 270 行纯函数加 test 文件，对齐 AGENTS.md "新的纯函数必须配套 `__tests__`" 约定。

### 设计

**测试目录**：`src/components/template-builder/__tests__/form-state.test.ts`

**覆盖函数**：
- `emptyFormState()` — 形态断言
- `emptyInput() / emptyVariable() / emptyDimension()` — 轻快的形态断言
- `parseEqualsValue(raw: string)` — 5 种输入：`"true"` / `"false"` / `"null"` / `"42"` / `"string"`
- `buildSchemaFromForm(form)` —
  - **valid 路径**：给一个完整 form，断言产出 TaskSchema 结构 + required 列表 + enum 数字强转 + display_dimensions 映射
  - **invalid 路径**：空 id / 非法 id（数字开头）/ 空 label / 重复 alias / 重复 variable name / 重复 output field name / `raw_text_output + 多个 output field` / `raw_text_output + 非 string 类型` / 缺 dataset_id —— 每条断言对应 `errors` 条目 + `schema` 为 undefined
- `formFromSchema(schema)` — 给 TaskSchema 往回映射，断言 FormState 与 buildSchemaFromForm 的输入同构
- **Round-trip 幂等**：`formFromSchema(buildSchemaFromForm(f).schema!) === f`（对一个合法 f，深度 equal）

**测试规模**：约 20 cases，时间 <50ms。

### 测试策略

- 纯函数，无 fs / network / DOM；不需要 `beforeEach(chdir)`
- 每个 assertion 独立；避免共享 state
- Round-trip 幂等测试是**关键保证**—— 未来改字段时会第一时间发现 asymmetry

### 提交节奏

1 个 commit：`test(template-builder): add form-state round-trip + validation tests (F8)`。

---

## M3 · copilot stream response 抽 helper（F4）

### 目标

把 `/chat` 和 `/tool-result` route 里约 100 行 × 2 的流式段抽到共享 helper，让未来类似的 pipeline race fix 只需改一处。

### 设计

**新文件**：`src/lib/copilot/stream-response.ts`

**导出签名**：
```ts
export interface RunStreamParams {
  sessionId: string
  branch: CopilotMessage[]              // 已经拉好的 active branch（含上游消息）
  model: ModelConfig
  tools: Tool[]                         // tools.ts 的 tools 数组
  pageContext: PageContext | null
  startParentId: string | undefined     // 新 assistant / tool_use 的 parent_id 起点
  signal: AbortSignal
  write: (payload: unknown) => void     // SSE `data: ...\n\n` 写出
}

export interface RunStreamResult {
  assistantMessageId?: string
  toolUseMessageIds: string[]
  usage?: { input_tokens: number; output_tokens: number }
  stopReason?: string
}

export async function runToolAwareLlmStream(p: RunStreamParams): Promise<RunStreamResult>
```

**职责**：
1. 构造 provider-adapted tools（`toOpenaiTools` / `toAnthropicTools`）
2. 调 `buildLlmMessages(branch, pageContext)`
3. `callLlmStreaming` 回调：累 `assistantText` / `pendingToolUses` / `assistantUsage` / `stopReason`；转发 text / tool_use_start/delta/end / error 为 SSE payload via `write`
4. 流结束后按顺序 `appendMessage` assistant（如果有文本）+ 每条 tool_use（parent_id 链式）
5. 返回 `{ assistantMessageId, toolUseMessageIds, usage, stopReason }`

**两个 route 改成**：
- `/chat`：鉴权 → 校验 body → 拉 branch → 构造 `ReadableStream` → 里面 `write({ kind: 'user_message', id })` 后调 `runToolAwareLlmStream(...)`，拿结果写 `{ kind: 'done', assistant_message_id, tool_use_message_ids, usage, stop_reason }`
- `/tool-result`：鉴权 → 校验 body → 链长检查 → 执行 tool（或 denied）→ append tool_result → 拉 branch（含刚 append 的）→ `ReadableStream` → `write({ kind: 'tool_result_message', ... })` 后调 `runToolAwareLlmStream(...)`，拿结果写 `done`

两个 route 预期各 ~50 行，都主要是校验 + 构造 helper 参数。

### 保留不动的 race fix 点

CHANGELOG 0.4.0 记录的 race fix 必须保留：
- **appendMessage 并发写**：helper 调 `appendMessage`（`fs.appendFileSync`）—— 现有行为，不动
- **SSE controller.enqueue 流关后抛**：`write` 函数里的 try/catch 必须保留
- **tool_use 落盘后才 emit done 的顺序**：helper 保证"append 先于 emit"—— 必须对齐
- **abort signal 透传**：helper 接 `signal`，透给 `callLlmStreaming`

### 测试策略

**现有覆盖**：
- `build-llm-messages` 已由 `llm-stream-serialize.test.ts` 间接测到
- `llm-stream` 本身有 single-case 测试
- 两个 route 没有 unit test（符合 AGENTS.md "UI / API route 暂不要求测"）

**新增**：
- **不加** route-level integration test（Playwright e2e 已有 smoke 覆盖路由不崩）
- helper 本身**能否单测**：需要 mock `callLlmStreaming` + `appendMessage` + `buildLlmMessages`。可行但重，先不加。**前提条件**：PR description 明示"手动走快乐路径 + deny 路径 + chain 链式"实测一轮
- e2e smoke 9 全绿

**手动回归 checklist**：
1. 发一条普通对话 → 看 assistant 消息出现
2. 用工具 `list_experiments` → 看 read 工具 auto-run + 卡片展开
3. 发 `restart_experiment` → 看 Confirm/Deny 按钮 → Confirm 走通
4. 同上 → Deny with reason → LLM 再回一句
5. 链式：连续 5+ 次 tool_use 触发 chain cap 429 toast

### 提交节奏

3 个 commit：
1. `refactor(copilot): extract runToolAwareLlmStream helper (F4 prep)`
2. `refactor(copilot): rewrite /chat route to use stream helper (F4)`
3. `refactor(copilot): rewrite /tool-result route to use stream helper (F4)`

---

## M4 · chat-view.tsx 拆分（F5）

### 目标

把 `src/components/copilot/chat-view.tsx` 的 812 行拆成 `useChatStream` hook + `<ContextChipRail />` 组件 + 精简的 `<ChatView />`，每块职责单一。

### 设计

**三个新文件**：

**1. `src/components/copilot/use-chat-stream.ts`** — streaming state + SSE handling + send/tool-result actions

```ts
export interface UseChatStreamParams {
  sessionId?: string
  modelId?: string
  pageContext: PageContext | null
  onError: (message: string) => void     // toast.error 注入避免 hook 硬依赖 sonner
}

export interface UseChatStreamResult {
  messages: UiMessage[]
  setMessages: (updater: (prev: UiMessage[]) => UiMessage[]) => void
  sending: boolean
  loadingSession: boolean
  pendingCallIds: Set<string>
  send: (text: string, contexts?: CopilotContextRef[]) => Promise<void>
  confirmTool: (call_id: string, tool_name: string, input: Record<string, unknown>) => Promise<void>
  denyTool: (call_id: string, tool_name: string, input: Record<string, unknown>, reason: string) => Promise<void>
  deleteMessage: (msg: UiMessage) => Promise<void>   // 含 prune-descendants
  editUserMessage: (msg: UiMessage, newText: string) => Promise<void>  // 删 + 重发
}

export function useChatStream(p: UseChatStreamParams): UseChatStreamResult
```

内部封装（CHANGELOG 0.4.0 race fix **全部保留**）：
- `makeSseHandler(pairSessionId)` + `consumeSseStream`
- `abortRef` / `streamToolUseOrderRef` / `pendingAutoRunRef` / `currentSessionRef`
- `doStreamSend` / `postToolResult`
- loadSession useEffect
- unmount abort cleanup useEffect

**2. `src/components/copilot/context-chip-rail.tsx`** — 圈选按钮 + chip 行 + preview 面板 + pulsing style

Props：
```ts
interface ContextChipRailProps {
  contexts: CapturedContext[]
  ctxStatus: Record<string, 'ok' | 'missing' | 'error'>
  ctxPreview: string
  inspectorActive: boolean
  onInspectorToggle: () => void
  onRemoveContext: (elementKey: string) => void
  onClearContexts: () => void
}
```

内部 `useState(previewOpen)` + 纯 render。

**3. `src/components/copilot/chat-view.tsx` 精简版**（目标 ≤ 250 行）：

- 调 `useCopilotStore` 拿 contexts / inspector / pageContext
- 调 `useChatStream(...)` 拿 messages / send / confirm/deny/edit/delete
- resolve /api/copilot/contexts/resolve effect 留在这里（它不是 streaming 关注的）
- 渲染：RouteChangeBanner + 消息列表 map + ContextChipRail + textarea（带 expand）+ model picker + send button

### 兼容性保证

- `UiMessage` 类型继续从 `chat-view-parts.tsx` 导出（已经是那里的）
- `ChatView` 的 props 签名不变（`sessionId / selectedModelId / onPickModel`）
- `CopilotMessage` → `UiMessage` 映射 `toUiMessage` 函数搬去 `use-chat-stream.ts`（内部用）
- toast 通过 `onError` 注入而非 hook 直接 `import { toast }`—— 可测性（虽然本期不加测）+ 解耦

### 测试策略

- 同 M3，**不加 hook 级 unit test**（React hook 测试成本高）
- 手动回归 checklist：
  1. 发消息 / 发空消息 / ⌘Enter 发送
  2. Edit 用户消息 → 自动重发 → 旧 assistant 消失
  3. Delete 消息 → 后代一起消失
  4. 切 session → messages 正确切换
  5. Fork session（RouteChangeBanner）→ 新 session 空
  6. Tool use：auto-run read / confirm write / deny / chain cap
  7. Input expand / collapse
  8. Context chip：圈选 → chip 出现 → 发消息带 context → stale chip 视觉
  9. Preview LLM 将看到的 context 按钮展开

### 提交节奏

4 个 commit：
1. `refactor(copilot): extract useChatStream hook (F5 prep)`
2. `refactor(copilot): extract ContextChipRail component (F5 prep)`
3. `refactor(copilot): slim chat-view.tsx to orchestration (F5)`
4. `test(copilot): sanity checks after chat-view split` (可选，如果有值得加的 hook test)

合并 + 观察 1-2 天后 tag `v0.5.8`（refactor 类型的小递增）。

---

## M5 · batch-runner Promise pool（F6）

### 目标

把 `BatchRunner.run` 的并发控制从"workers 数组 + 内部 while + running counter + 两段 polling"换成标准 Promise pool，删 `running` counter + `Promise.all(workers)` + 二段 polling。

### 设计

**关键变更**：`src/lib/batch-runner.ts:139-208` 的 worker pattern 换成：

```ts
const inFlight = new Set<Promise<void>>()
let completedIds = /* ... */

for (const task of pendingTasks) {
  if (this.stopped) break
  const p = this.executeTask(task)
    .then(result => {
      // 同现有：appendResult / completedIds.add / 累 token/cost / writeProgress
    })
    .catch(() => { /* errors handled in executeTask */ })
    .finally(() => { inFlight.delete(p) })
  inFlight.add(p)
  if (inFlight.size >= this.concurrency) {
    await Promise.race(inFlight)
  }
}
await Promise.all(inFlight)

// 到这里所有 task 真的完成，可以写 final progress / run_stats
```

**保留**：
- `this.stopped` flag + `this.abortController.abort()` 语义
- 精准重试（`taskIds` 过滤 pendingTasks）
- 历史 stats 累加（resume 分支）
- progress 增量 writeProgress 节奏（每个 task 完成 write 一次）

**验证路径**：
- concurrency = 10（默认）不变
- concurrency = 1：串行跑
- `stopBatch` 在途中触发 → stopped=true → break + final progress 状态 = 'paused'
- 精准重试：只跑指定 task_ids

### 测试策略

**现状**：`batch-runner.ts` 没 unit test（只有 `results-aggregate` / `llm-config` / `store.migrate` 的 test）。

**本期**：
- **不加** integration test（mock `callLlm` + tmp fs 设置成本 >1h，不值得）
- 严格手动回归：跑一个真实 6 task 实验 × 3 种场景（全跑 / 中途 stop / 单条 retry）
- 依赖现有 `store.migrate.test.ts` 保证 progress state shape 不变

### 提交节奏

2 个 commit：
1. `refactor(batch-runner): replace worker-polling with promise pool (F6)`
2. `test(batch-runner): optionally add smoke integration test`（只做一条"起 3 task 全跑完"的 smoke）

合并 + 实测过快乐路径 + pause/resume + 精准 retry 后 tag `v0.6.0`（语义上 batch-runner 机制替换，minor bump 合理）。

---

## 测试策略（汇总）

### 自动化

- **tsc --noEmit** 每个 PR 必须过
- **vitest**：
  - M1 后 217 → 220（+3 buildApiRequest）
  - M2 后 → 约 240（+20 form-state）
  - M3 / M4 / M5 不加 vitest（或只加轻量 smoke）
  - CI 必须全绿
- **Playwright e2e smoke**：每个 PR 前本地跑一次 `npm run test:e2e`，9 case 全绿
- **build**：`npm run build` 通过

### 手动回归

每个 PR description 带 checklist，覆盖：
- M1：LLM 设置连接测试 + 数据集 list + 评测任务 list + 实验 list 不崩
- M2：无手动（纯函数测）
- M3：copilot 对话 + 工具调用完整 5 场景
- M4：copilot 对话 9 场景（见 M4 设计）
- M5：实验跑 / 暂停 / 继续 / 精准重试

## 分支 / PR / tag 策略

完全对齐 AGENTS.md §开发流程：
- 每个 M 一个 feature branch，commit 粒度按上面设计
- `gh pr create` 4 段 description（改了什么 / 为什么 / 怎么验证 / 向后兼容风险）
- merge 策略：merge commit（不 squash）
- 不混 scope —— 每 PR 只做对应 finding 的事
- tag：只给 M4（v0.5.8）和 M5（v0.6.0）打，合并后观察 1-2 天稳定再打（对齐 AGENTS.md "不要在'我以为它做完了'的瞬间 tag"）

**Agent 驱动执行中**，本次 AI 助手会：
- 自动 `git checkout -b` 每个分支
- 自动 commit（每步一个 commit，带 Co-Authored-By）
- 自动 push + `gh pr create`
- **不自动 merge** — 等用户自己 merge
- **不自动 tag** — 等用户说

## 风险 + 缓解

| 风险 | 影响 PR | 缓解 |
|---|---|---|
| F1 改后某处调用点忘了替换（`DATA_DIR` 被 import 到别的文件） | M1 | 每个文件改前 `grep -r "DATA_DIR\\|RUBRICS_DIR\\|..."` 找所有引用 |
| F7 Bearer 自动加前缀破坏某些不要 Bearer 的 gateway | M1 | CHANGELOG 明确 call-out；观察一两天无 issue 即 fine |
| M3 抽 helper 时 SSE 时序的 race fix 被无意改掉（controller enqueue 流关后抛 / append 先于 emit done） | M3 | helper 内部注释**逐条抄过来** + 手动回归 5 场景 |
| M4 `chat-view` 拆分时 useEffect 依赖 / ref 生命周期错位（`abortRef` / `currentSessionRef`）| M4 | 代码 review 时对照原 chat-view 的 useEffect + 手动回归 9 场景 |
| M5 Promise pool 的 stopped + abort 顺序错导致 stop 不生效 | M5 | 手动 "跑 10 task 到一半点停" + 验证 'paused' 状态落 progress.json |
| 文档 drift 再次出现（CHANGELOG 加条目后忘记同步 CLAUDE.md 数字）| M1 | 这次用"具体数字"而非"约 N+"；把 CLAUDE.md 的刷新步写进 AGENTS.md §回顾/审计节奏 |

## Decisions（本次 spec 要锁的）

| # | Decision | 理由 |
|---|---|---|
| 1 | F1 用 `function xDir()` 而非 lazy `get`/`Object.defineProperty` | 对齐已有 3 个正确范例；最小惊讶 |
| 2 | F7 自动加 Bearer **不加**配置开关 | YAGNI；有需求再加 |
| 3 | F7 同 PR 里改 README Q&A 说明 | doc / code 同步 |
| 4 | F3 写实数 217 而非 "约 200+" | 外部读者更清楚；未来 CHANGELOG + CLAUDE.md 一起维护 |
| 5 | M3 helper 放 `src/lib/copilot/stream-response.ts` | 是 pure logic 层，不是 React component |
| 6 | M4 `useChatStream` 放 `src/components/copilot/` 而非 `lib/` | 它依赖 React + store + i18n，属于 component-side hook |
| 7 | M4 toast 通过 `onError` 回调注入 hook | 解耦 + 未来可测；不改当前行为 |
| 8 | M3 / M4 不加 hook/route 级 unit test | AGENTS.md 约定 UI/API route 暂不要求测；本期依赖 e2e smoke + 手动 checklist |
| 9 | M2 form-state 测试放 `src/components/template-builder/__tests__/` 就近 | 约定 "测文件放 `src/**/__tests__/*.test.ts`，与被测模块就近" |
| 10 | M5 不加 batch-runner integration test | 1h 成本 > 本期收益；smoke-level 人工回归 + e2e 覆盖 |
| 11 | Tag 策略：M1/M2/M3 不 tag；M4 后 `v0.5.8`；M5 后 `v0.6.0` | refactor 类型的小 step 不值得 tag，M5 是"机制替换"合理 minor bump |
| 12 | 每个 M 独立 PR，不合并 | 便于 bisect + 便于 user review |
| 13 | 不开 worktree | CLAUDE.md/AGENTS.md 没要求；5 个 PR 都是对项目 root 的 git 操作，正常 branch 足够 |

## Exit criteria（全部 M 合完后的状态）

1. ✅ 0 处 fs 模块顶层 `const XXX_DIR = path.join(process.cwd(), ...)`
2. ✅ context-mask 的 "移除" 走 i18n
3. ✅ CLAUDE.md / README 测试数字更新到 220（M1 后）→ 240（M2 后）
4. ✅ `buildApiRequest` 有单测；OpenAI Authorization 自动加 Bearer
5. ✅ README 鉴权 footnote 不再出现 "开源前会补"
6. ✅ `form-state.ts` 有 round-trip 测试 + 所有校验分支覆盖
7. ✅ `/chat` + `/tool-result` route 各 ≤ 60 行，调 `runToolAwareLlmStream`
8. ✅ `chat-view.tsx` ≤ 300 行，逻辑分散到 `useChatStream` + `ContextChipRail`
9. ✅ `batch-runner.run` 不再有 `running` counter / `while (running > 0)` polling / workers 数组
10. ✅ CHANGELOG 有 `[Unreleased]` 整合条目；tag v0.5.8 + v0.6.0 打好（经用户确认）
11. ✅ 217 → 240 vitest 全绿；9 e2e smoke 全绿；tsc clean；build pass

## 参考

- Audit 原报告：本次 conversation 内（未写盘）
- AGENTS.md §开发流程 / §Commit message 规范 / §Tag + 版本号 / §CHANGELOG 规范
- CLAUDE.md Copilot + Glass UI 章节（边界：本期不碰）
- CHANGELOG.md v0.4.0（PR-3 tool calling pipeline race fix 参考）
- CHANGELOG.md v0.5.4-0.5.7（theme cascade 收敛参考，边界：本期不碰）
