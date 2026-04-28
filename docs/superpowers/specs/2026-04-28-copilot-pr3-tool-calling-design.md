# PR-3 · Copilot 工具调用闭环 · 设计规范

**Date**: 2026-04-28
**Status**: Design approved, ready for implementation
**Scope**: 3 tools (2 read + 1 write). `edit_template` deferred indefinitely (决策记录见 §9)

---

## 1 · Context

Copilot 现状（PR-2 + PR-2.6 完成后）：
- 会话 + 流式对话 ✅
- 看到用户圈的 context（实验 / task / text / template / rubric 等）✅
- 能打字聊天 ✅
- ❌ **不能"动手"**：改完 prompt 还是要用户切到 template 编辑页自己改，不满意想重跑得切到实验详情页点按钮

目标：关掉"复制系统 context 到另一个对话窗口 → 调 prompt → 复制回平台 → 点重跑"的拷贝粘贴链路的**最后一环**。

非目标：
- 完整自动 ReAct agent（无人看守的多步执行）—— **non-YOLO is a covenant**
- 工具调用能创建新资源（`create_dataset` / `create_template` / `create_rubric`）—— 未来再说
- 完整闭环替代人（用户仍应在工具卡上 Confirm/Deny，保持控制感）

---

## 2 · Scope Decision：砍到 3 个工具

原 plan 有 9 个工具（7 read + 2 write），砍到：

### ✅ 保留 3 个

**Read (2)** — 用户没圈的东西 Copilot 自己看：
- `list_experiments(filter?)` — 发现相关实验
- `read_experiment_results(experiment_id, task_ids?, status?)` — 批量扫失败 / 读详细

**Write (1)** — 唯一"动手"：
- `restart_experiment(experiment_id, task_ids?)` — 重跑实验（全部 or 特定 task）

### ❌ 删除 6 个

- `read_experiment(id)` / `read_template(id)` / `read_dataset(id)` / `read_display(id)` / `read_rubric(id)` — 用户 share context 已覆盖
- `list_templates()` — 未来需要再加
- **`edit_template(schema_id, patch)` —— 本次 defer**（决策 2，见 §9）

### Defer `edit_template` 的代价

"改 prompt 然后只重跑这条"这个**核心验收场景**变成两步：
1. 用户在 Copilot 里和 LLM 讨论 prompt 改法 → LLM 给出建议 prompt 文本
2. 用户**手动**复制到 `/settings/templates/{id}/edit` 页替换 + 保存
3. 回到 Copilot 说"跑了"，Copilot 调 `restart_experiment` 触发重跑

拷贝链路从 6–8 次降到 1 次（手动粘贴 prompt 那一次）。比现状好很多。

等工具调用协议稳定跑一轮后，再把 `edit_template` 加回来，届时 diff + confirm UX 也能基于真实使用沉淀设计好。

---

## 3 · 心智模型：ReAct 式两阶段对话

```
用户发问
    ↓
LLM 决定用工具，流式发出 tool_use 事件
    ↓
前端拦截 tool_use → 渲染 ToolCallCard
    ├── read 工具：折叠式 "🔍 调用 X → 查询中..." 无感执行（决策 1 · 见 §9）
    └── write 工具（restart_experiment）：Confirm / Deny 按钮
    ↓
（确认后）客户端 POST /tool-result → 服务端 append 到 jsonl
    ↓
服务端再调 LLM（带完整 messages 含 tool_use + tool_result）
    ↓
LLM 要么回文字收尾，要么发下一个 tool_use
    ↓
循环最多 5 次（决策 3 · 见 §9），超限强制收尾
```

**写操作永远需要 confirm**（即使未来加更多 write 工具也是）。
**读操作无感执行**但在卡片里显示查询摘要（"找到 5 条 / 3 条 failed"）。

---

## 4 · 工具 Specs

### 4.1 · `list_experiments`

```ts
{
  name: "list_experiments",
  description: "列出平台上的实验，可按 status / schema_id 过滤。用于发现用户没圈选的相关实验。",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed"] },
      schema_id: { type: "string", description: "按评测任务 ID 过滤" },
      limit: { type: "number", default: 20, description: "最多返回多少条，上限 50" },
    },
  },
  requiresConfirm: false,  // 决策 1
  run: async (input) => {
    const all = await listExperiments()
    let filtered = all
    if (input.status) filtered = filtered.filter(e => e.status === input.status)
    if (input.schema_id) filtered = filtered.filter(e => e.schema_id === input.schema_id)
    const limit = Math.min(input.limit ?? 20, 50)
    return {
      experiments: filtered.slice(0, limit).map(e => ({
        id: e.id,
        name: e.name,
        model: e.model,
        status: e.status,
        schema_id: e.schema_id,
        completed_tasks: e.run_stats?.completed_tasks ?? 0,
        total_tasks: e.run_stats?.total_tasks ?? 0,
        failed_tasks: e.run_stats?.failed_tasks ?? 0,
      })),
      total_matching: filtered.length,
      returned: Math.min(filtered.length, limit),
    }
  },
}
```

### 4.2 · `read_experiment_results`

```ts
{
  name: "read_experiment_results",
  description: "读取某个实验的 task 结果，可按 task_id 列表 或 status 过滤。用于扫描失败样本或提取特定结果。",
  input_schema: {
    type: "object",
    required: ["experiment_id"],
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" }, description: "可选，只返回指定 task" },
      status: { type: "string", enum: ["success", "failed", "timeout"] },
      limit: { type: "number", default: 20, description: "最多返回多少条，上限 50" },
    },
  },
  requiresConfirm: false,
  run: async (input) => {
    const all = await readResults(input.experiment_id)  // 从 data/results/{id}/results.jsonl
    let filtered = all
    if (input.task_ids?.length) filtered = filtered.filter(r => input.task_ids.includes(r.task_id))
    if (input.status) filtered = filtered.filter(r => r.status === input.status)
    const limit = Math.min(input.limit ?? 20, 50)
    return {
      results: filtered.slice(0, limit),
      total_matching: filtered.length,
      returned: Math.min(filtered.length, limit),
      truncated: filtered.length > limit,
    }
  },
}
```

### 4.3 · `restart_experiment`

```ts
{
  name: "restart_experiment",
  description: "重新运行一个实验。可选：只跑指定的 task_ids 子集（用于修了 prompt 后只重跑失败的几条）。",
  input_schema: {
    type: "object",
    required: ["experiment_id"],
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" }, description: "可选，只重跑这些 task；为空则全部重跑" },
    },
  },
  requiresConfirm: true,  // 写操作必 confirm
  run: async (input) => {
    // 内部走 fetch("/api/experiments/{id}/run", { method: "POST", body: { task_ids } })
    // 或直接调 startBatch(cfg, resume=true, concurrency, task_ids)
    const res = await triggerRun(input.experiment_id, input.task_ids)
    return {
      triggered: true,
      experiment_id: input.experiment_id,
      task_count: res.queued ?? 0,
      message: input.task_ids?.length
        ? `已触发重跑 ${input.task_ids.length} 条指定 task`
        : `已触发全量重跑实验 ${input.experiment_id}`,
    }
  },
}
```

---

## 5 · Session Protocol 扩展

### 5.1 · 消息类型扩展

**目前**：`CopilotMessage` = `{ role: "user" | "assistant" | "system", content: string, ... }`

**扩展后**：新增两个 role：

```ts
type CopilotMessage =
  | { role: "user"; content: string; contexts?: CopilotContextRef[]; ... }
  | { role: "assistant"; content: string; ... }  // 纯文本回复
  | { role: "system"; content: string; ... }
  | {
      role: "tool_use"
      tool_name: string
      tool_input: Record<string, unknown>
      call_id: string   // nanoid，用来配对
      ...
    }
  | {
      role: "tool_result"
      call_id: string           // 配对 tool_use
      tool_name: string         // 冗余记录，方便审计
      content: unknown          // tool.run() 返回值 OR { denied: true, reason }
      denied?: boolean
      ...
    }
```

**持久化**：`tool_use` + `tool_result` 都 append 进 `data/copilot-sessions/{id}.jsonl`（决策 4）。刷新页面能看到完整链路。

### 5.2 · Streaming 事件扩展

`llm-stream.ts` 的 `CopilotEvent` 加三种：

```ts
type CopilotEvent =
  | { type: "text_delta"; delta: string }  // 已有
  | { type: "done" }                        // 已有
  | { type: "error"; message: string }      // 已有
  | { type: "tool_use_start"; call_id: string; tool_name: string }   // 新
  | { type: "tool_use_delta"; call_id: string; input_json_delta: string }   // 新（Anthropic 流式 input JSON；OpenAI 可能一次给完 input）
  | { type: "tool_use_end"; call_id: string; tool_name: string; input: Record<string, unknown> }   // 新
```

客户端拼成完整 `tool_use_end.input` 后才能渲染卡片。

### 5.3 · Chat route 两阶段流程

`POST /api/copilot/sessions/[id]/chat` 加"暂停"能力：

```
T0. 用户 POST /chat { content }
T1. 服务端 append user msg → append tool_use turn to LLM
T2. LLM 流式回复 → 服务端 SSE 转发给前端
T3. 若 LLM 以 tool_use 结束（不是文字）：
     - 服务端 append tool_use msg 到 jsonl
     - SSE 发 tool_use_end → 结束本次 SSE（stream close）
     - 服务端什么也不做，等前端
T4. 前端看到 tool_use_end：
     - 如果 requiresConfirm=false：直接 POST /tool-result with { call_id, input }
     - 如果 requiresConfirm=true：渲染卡片 → 用户 Confirm → POST /tool-result
     - Deny：POST /tool-result with { call_id, denied: true, reason? }
T5. 服务端收到 /tool-result：
     - 调 tool.run(input) 得到 result（或 denied 情况下不调）
     - append tool_result msg 到 jsonl
     - 重新打开 SSE，再调 LLM with 完整 messages → 回 T2
T6. 循环，直到 LLM 回纯文字（assistant role, no tool_use），或链式调用计数达 5（chainCount++ 每次 T5 时）
     - 达 5 强制停：append 一条 system note "tool call chain limit reached"，前端显示 "链式调用已达上限，请人工介入"
```

### 5.4 · 新 API endpoint

```
POST /api/copilot/sessions/[id]/tool-result
Body: { call_id, result?, denied?, reason? }

- 调 tool.run() 得到 result（除非 denied）
- append tool_result msg
- 返回 SSE 再次调 LLM，stream 继续发 text/tool_use 事件
```

---

## 6 · UI · ToolCallCard

三种形态：

### 6.1 · Read 工具（无感执行）

```
┌────────────────────────────────────────┐
│ 🔍 read_experiment_results              │
│    experiment_id=exp_abc, status=failed │
│    ⏳ 查询中...                          │
└────────────────────────────────────────┘
```

完成后变折叠条：
```
┌────────────────────────────────────────┐
│ ✅ read_experiment_results · 找到 3 条 failed [展开 ▸] │
└────────────────────────────────────────┘
```

展开后显示返回的 JSON（可选）。

### 6.2 · Write 工具 `restart_experiment`

```
┌─────────────────────────────────────────┐
│ ⚙️  restart_experiment                    │
│                                          │
│ 参数:                                     │
│   experiment_id:  exp_abc                │
│   task_ids:       [t-001, t-005, t-009]  │
│                                          │
│   将触发重跑这 3 条 task                   │
│                                          │
│ [ Confirm ]   [ Deny ]                    │
└─────────────────────────────────────────┘
```

用户点 Confirm → 调 `/tool-result` → 卡片变绿显示"已触发"。
用户点 Deny → 弹一个小输入框填理由（可空）→ 调 `/tool-result` with denied=true + reason。

### 6.3 · 错误 / denied / 超限态

- 工具执行 throws → 卡片变红，显示 error.message，LLM 会在下一轮看到错误重新决策
- Deny → 卡片变灰，显示 "已拒绝: {reason}"，LLM 会看到 denied=true 可以换个说法继续
- 链式调用达 5 → 系统消息 "已到达链式调用上限，请用户介入"

---

## 7 · 文件清单

### 新建（6 个文件）

| 文件 | 职责 |
|---|---|
| `src/lib/copilot/tools.ts` | 3 工具定义：`name` / `description` / `input_schema` / `run` / `requiresConfirm` |
| `src/lib/copilot/tool-adapters.ts` | `toOpenaiTools` / `toAnthropicTools` 格式转换 |
| `src/lib/copilot/tool-registry.ts` | Map `name → toolDef`，白名单校验入口 |
| `src/app/api/copilot/sessions/[id]/tool-result/route.ts` | POST 处理 tool result → 调 run → append → 再调 LLM |
| `src/components/copilot/tool-call-card.tsx` | 嵌入 chat 消息流的工具卡片（3 态：loading / success+collapse / confirm）|
| `src/lib/copilot/__tests__/tools.test.ts` | 每个 tool 的 run() 单测 + 输入 schema 校验 |

### 编辑（5 个文件）

| 文件 | 改什么 |
|---|---|
| `src/lib/copilot/types.ts` | 扩 `CopilotMessage` + `CopilotEvent` 类型 |
| `src/lib/copilot/llm-stream.ts` | 处理 OpenAI `tool_calls` 流式 + Anthropic `content_block_start/delta/stop` with `type: tool_use`，归一化成 `tool_use_*` 事件；接受 `tools` 参数传给 LLM |
| `src/lib/copilot/session-store.ts` | 支持 append tool_use / tool_result 消息（jsonl 已是 union 就行，可能只需类型扩） |
| `src/app/api/copilot/sessions/[id]/chat/route.ts` | 两阶段：首轮 stream 若命中 tool_use 就 stream_end 暂停；增加 tools 参数组装 |
| `src/components/copilot/chat-view.tsx` | 消息列表渲染多一种 role（tool_use → `<ToolCallCard>`）；收 `tool_use_end` 事件 → 维护 pending 状态 |
| `src/lib/i18n/zh.ts` + `en.ts` | `copilot.tool.*` 约 20 条 key |

### 依赖

- 无新依赖（Anthropic + OpenAI 协议都有 tool_use 能力，SDK 不用升；diff viewer 因 `edit_template` defer 也不需要）

---

## 8 · 测试策略

### 单测（vitest · 必做）

- `tools.test.ts` — 3 个 tool.run() 各至少 2 个 case（happy path + 边界）
- `tool-adapters.test.ts` — OpenAI / Anthropic 格式转换正确
- `tool-registry.test.ts` — 白名单校验（未知 name throw）

### 集成测试（手动 + 端到端 Playwright）

端到端验收场景：

**Case A · "查失败并重跑"**
1. 用户有一个完成的实验，含 3 个 failed task
2. 圈该实验 → Copilot
3. 问: "这实验有哪些 task 失败了？重跑它们。"
4. Copilot 调 `read_experiment_results({ experiment_id, status: "failed" })` → 无感返回 3 条
5. Copilot 回应 "找到 3 条失败，触发重跑"
6. Copilot 调 `restart_experiment({ experiment_id, task_ids: [...] })` → 弹 confirm 卡
7. 用户 Confirm → 卡变绿 → 实验详情页该 3 条进入 running

**Case B · "发现新实验"**
1. 问: "最近有哪些 completed 的实验？"
2. Copilot 调 `list_experiments({ status: "completed", limit: 10 })`
3. 回应列表摘要

**Case C · Deny**
1. Copilot 想 `restart_experiment`
2. 用户点 Deny，填理由 "prompt 还没改完"
3. LLM 收到 denied=true，回应 "好的，先不重跑，我这里把 prompt 建议列出来..."

**Case D · 链式上限**
1. 构造诡异 prompt 让 LLM 反复调工具
2. 第 6 次被强制停，显示 system message

### E2E Smoke（Playwright · 最小）

加 1 条：`/api/copilot/sessions/[id]/tool-result` 返回 200（POST 带假 call_id + result），确保路由存在。不跑完整 LLM 流程（太贵）。

---

## 9 · 决策记录

| # | 决策 | 选项 | 最终 | 理由 |
|---|---|---|---|---|
| 1 | Read 工具是否 confirm | A. 无感 / B. 都 confirm | **A** | 副作用为零，每次 confirm 是骚扰 |
| 2 | `edit_template` 粒度 | A. 整 TaskSchema merge / B. 只改 prompt / **N. 整体 defer** | **N (defer)** | 用户 2026-04-28 决定：先跑稳 3 工具，diff UX 等后续沉淀再加 |
| 3 | 链式调用上限 | 5 vs 其他 | **5** | 典型场景 read→restart 只要 2 次；5 已够兜底 |
| 4 | `tool_use` + `tool_result` 是否持久化 | A. 进 jsonl / B. 临时 | **A** | 保留"可审计"价值，和 session fork 语义一致 |
| 5 | Deny 行为 | A. 继续对话 / B. 结束本轮 | **A** | 继续对话更自然，LLM 能换招 |
| 6 | Fork 时 pending tool call | A. 保留 / B. 作废 | **B** | fork 是"重来"，pending call 作废 |

---

## 10 · 范围外

- **`edit_template`**（决策 2 defer）
- 自动 ReAct 循环（LLM 无人 confirm 自动跑 10 次）
- 工具链创建新资源（`create_template` / `create_dataset` / `create_rubric`）
- Session 跨设备同步 / 分享 / 导出 markdown
- Mobile layout
- 实时 token 成本显示（每个 tool call 消耗多少）
- Copilot 模型定价计入实验 cost ledger
- 工具调用的"批量拒绝"（全部 deny 之类）

---

## 11 · Follow-up（PR-3 之后）

- `edit_template` 重新评估（2 周后 / 用了一轮 3 工具后）
- 基于真实 LLM 调工具行为写 system prompt 引导（告诉它优先看 share context、回避不必要的 read 调用）
- 给 `restart_experiment` 加 dry-run 参数（返回会跑什么 task，不真跑）
