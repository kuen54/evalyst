# Copilot v2 · 上下文与工具系统重构 · 设计规范

**Date**: 2026-05-03
**Status**: Design approved, ready for implementation plan
**Scope**: 工具注册表 + 上下文分层注入 + tool result 护栏 + micro-compact + 写工具落地（edit_template）
**Reference**: 对照调研 `claude-code-best/claude-code`、`NousResearch/hermes-agent`、`openclaw/openclaw`（见 §11）

---

## 1 · Context

Copilot 现状（PR-4 完成后）：
- 会话 + 流式对话、圈选 context、3 工具（list_experiments / read_experiment_results / restart_experiment）+ read_page ✅
- JSONL append-only session ✅
- 页面 snapshot 每轮随消息发给 LLM ✅

对照三个参考仓库后，以下维度暴露出架构欠债：

| 维度 | 现状 | 痛点 |
|---|---|---|
| 上下文生命周期 | 纯 append，无压缩 | 多轮后 token 爆 / cache 破 |
| Tool 注册 | 硬编码 3+1 | 新增写工具需改 3 个文件 |
| Tool metadata | 仅 `requiresConfirm` | 没有 isDestructive/maxResultSize 等 |
| Tool result | 大 payload 直接入 transcript | `read_page` 撑爆 chain |
| Confirm 逻辑 | 散在 `tool-call-card.tsx` | 不可扩展 |
| 页面 snapshot | 每轮都发 | 浪费 token + 破 cache |
| Hook 机制 | 无 | 审计 / loop 检测无处挂 |

---

## 2 · 目标与非目标

### 目标
1. 新增写工具（如 `edit_template`）只改一个文件
2. 10 轮对话不会因为 context 膨胀触发模型拒收
3. `read_page` 返回大 snapshot 不再撑爆下轮 chain
4. LLM 可见的 system context 规模恒定（不随对话轮数增长）
5. 为"工具层做 aggregation"留好扩展位（如 `read_experiment_results.group_by`）

### 非目标（主动划掉避免过度设计）
- Subagent / AgentTool（用户明确不做）
- 跨 session 记忆 / 四类 taxonomy
- MCP 生态 / tool owner 分类
- ContextEngine 可插拔接口（仅一个 engine 场景，YAGNI）
- `CompactBoundaryMessage` 显式边界（session 不够长）
- Anthropic 4-breakpoint prompt cache 显式控制（规模不值得）
- CompactionStrategy 可插拔
- Registry 自注册（手动 array 够用）

---

## 3 · 三条核心原则

1. **System prompt 恒定小** — 只放 ref + summary，永远不 inline 大 payload
2. **大东西走 ref** — 落盘到 `data/copilot/tool-results/{id}.json`，transcript 里留 preview + ref
3. **Tool 是 LLM 获取 context 的唯一入口** — `read_context(id)` / `read_page(query)` / `read_tool_result(id)` 按需拉

三原则合起来对应哲学：**Progressive Disclosure（渐进式披露）**。起手给极简信号，LLM 根据用户意图自主决定挖多深。

---

## 4 · 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (src/components/copilot/)                          │
│  - panel / chat-view                                        │
│  - context-chip-rail: 删除 preview 面板 + chip expand 详情   │
│  - tool-call-card: 按工具类型分渲染 (read_context /          │
│    read_resource / read_tool_result / write)                │
└────────────────────────┬────────────────────────────────────┘
                         │ /chat /tool-result
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ API (src/app/api/copilot/)                                  │
│  - sessions/[id]/chat        ─┐                             │
│  - sessions/[id]/tool-result ─┤─> stream-response.ts        │
└────────────────────────┬──────┴──────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Core (src/lib/copilot/)                                     │
│                                                             │
│  build-llm-messages.ts  ─── 组装 system header (恒定小)      │
│       │                                                     │
│       │                       ┌── tool-registry.ts ──┐     │
│       ▼                       │                       │     │
│  hook pipeline  ◄─── preToolCall ◄── tools/           │     │
│       │              postToolCall      *.ts           │     │
│       │                                                │     │
│       ▼                                                │     │
│  tool-result-store.ts  (新)    tool-runtime.ts (新)   │     │
│       │                                                │     │
│       ├─ 大 payload 落盘        ├─ JSON 语义截断       │     │
│       └─ transcript 留 ref      └─ Confirm gate       │     │
│                                                             │
│  micro-compact.ts (新) ─── 纯函数，按时间裁可重放 tool_result │
│                                                             │
│  snapshot-cache.ts (改) ─── snapshot 留服务端，不入 transcript│
└─────────────────────────────────────────────────────────────┘
```

---

## 5 · 十二项具体改动

### 5.1 Tool 描述符类型

**位置**：`src/lib/copilot/tools/types.ts`（新文件）

```ts
export interface ToolDescriptor<Input, Output> {
  name: string;
  description: string;
  inputSchema: JSONSchema;        // 给 LLM 看
  outputSchema?: JSONSchema;      // 可选，给类型约束

  metadata: {
    isReadOnly: boolean;            // 参与 micro-compact 需要 true
    isDestructive: boolean;         // 默认触发 Confirm
    requiresConfirm?: boolean;      // 覆盖 isDestructive 默认值
    maxResultSizeChars: number;     // 护栏阈值
    isConcurrencySafe?: boolean;    // 未来并行调用用
  };

  call: (input: Input, ctx: ToolContext) => Promise<Output>;
}
```

**来源**：claude-code-best `buildTool`（`/src/Tool.ts`）。原版 20+ 字段，此处裁到 4 个 metadata 字段。

### 5.2 手动 array 注册

**位置**：`src/lib/copilot/tools/registry.ts`（新文件）

```ts
import { listExperimentsTool } from "./list-experiments";
import { readExperimentResultsTool } from "./read-experiment-results";
import { restartExperimentTool } from "./restart-experiment";
import { readPageTool } from "./read-page";
import { readContextTool } from "./read-context";       // 新
import { readToolResultTool } from "./read-tool-result"; // 新
import { editTemplateTool } from "./edit-template";      // 新

export const TOOLS = [
  listExperimentsTool,
  readExperimentResultsTool,
  restartExperimentTool,
  readPageTool,
  readContextTool,
  readToolResultTool,
  editTemplateTool,
] as const;

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
```

**不做**：import side-effect 自注册、lazySchema 延迟加载、ToolSearch（当前规模不值得）。

### 5.3 `preToolCall` hook

**位置**：`src/lib/copilot/tools/hooks.ts`（新文件）

```ts
export interface PreToolCallCtx { tool: ToolDescriptor; input: unknown; session_id: string; }
export type PreToolCallHook = (ctx: PreToolCallCtx) => Promise<
  { action: "proceed" } | { action: "require_confirm" } | { action: "deny"; reason: string }
>;

export const preToolCallHooks: PreToolCallHook[] = [
  confirmGateHook,     // 读 metadata 决定 require_confirm
  auditLogHook,        // 落日志（当前 no-op，留挂载点）
];
```

默认实现 `confirmGateHook`：`tool.metadata.requiresConfirm ?? tool.metadata.isDestructive` 为 true 则返回 `require_confirm`。

**来源**：claude-code-best `useCanUseTool` + openclaw `before-tool-call`。砍掉四源权限矩阵。

### 5.4 `postToolCall` hook

**位置**：同上

```ts
export interface PostToolCallCtx { tool: ToolDescriptor; input: unknown; output: unknown; session_id: string; }
export type PostToolCallHook = (ctx: PostToolCallCtx) => Promise<{ output: unknown }>;

export const postToolCallHooks: PostToolCallHook[] = [
  payloadGuardHook,    // 超 maxResultSizeChars 走落盘 + ref
  telemetryHook,       // 打点（当前 no-op）
];
```

`payloadGuardHook` 调用 `tool-result-store.ts` 里的落盘函数。

### 5.5 Tool result 落盘 + ref

**位置**：`src/lib/copilot/tool-result-store.ts`（新文件）

```ts
export async function maybePersistToolResult(
  session_id: string,
  output: unknown,
  maxSize: number,
): Promise<{ inline: unknown } | { ref: string; preview: string }> {
  const serialized = JSON.stringify(output);
  if (serialized.length <= maxSize) return { inline: output };

  const id = `tr_${nanoid(12)}`;
  const path = `data/copilot/tool-results/${session_id}/${id}.json`;
  await fs.writeFile(path, serialized);

  const preview = serialized.slice(0, 500) + "...(truncated)";
  return { ref: `ref://tool-result/${id}`, preview };
}
```

**Transcript 里的 tool_result block**（变体）：

```jsonl
// inline 模式（小 payload）
{"role":"tool","tool_call_id":"c1","content":{"inline": {...}}}

// ref 模式（大 payload）
{"role":"tool","tool_call_id":"c1","content":{"ref":"ref://tool-result/tr_xyz","preview":"..."}}
```

`read_tool_result(id)` 工具让 LLM 在后续轮次拉回详情。

**来源**：claude-code-best `toolResultStorage` + `SnipTool`。砍掉 `contentReplacementState` 聚合预算。

### 5.6 Micro-compact 纯函数

**位置**：`src/lib/copilot/micro-compact.ts`（新文件）

```ts
export function microCompact(
  messages: CopilotMessage[],
  config: { keepRecentReadResults: number },
): CopilotMessage[] {
  const readResults = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === "tool" && isReplayableTool(m.tool_name));

  const toCompact = readResults.slice(0, -config.keepRecentReadResults);

  return messages.map((m, i) => {
    if (!toCompact.find((x) => x.i === i)) return m;
    const refId = m.content?.kind === "ref" ? parseRefId(m.content.ref) : undefined;
    return {
      ...m,
      content: {
        kind: "compacted",
        summary: refId
          ? `(archived tool result; retrieve via read_tool_result('${refId}') if needed)`
          : `(archived tool result; original payload not persisted)`,
        ref: refId,
      },
    };
  });
}

// "ref://tool-result/tr_xyz" → "tr_xyz"
function parseRefId(ref: string): string | undefined {
  return ref.match(/^ref:\/\/tool-result\/(.+)$/)?.[1];
}

function isReplayableTool(name: string): boolean {
  const tool = toolByName.get(name);
  return tool?.metadata.isReadOnly ?? false;
}
```

调用时机：每次 `build-llm-messages.ts` 组装 LLM 请求前跑一次。

**来源**：claude-code-best `microCompact`。原版时间+token 双阈值，简化为只按数量保留最近 N 条可重放结果。

### 5.7 `read_experiment_results` 聚合参数

**位置**：`src/lib/copilot/tools/read-experiment-results.ts`（改造现有）

新增可选入参：

```ts
inputSchema: {
  experiment_id: string,
  task_ids?: string[],
  status?: "success" | "failed" | "running",
  limit?: number,

  // 新增
  group_by?: "error_type" | "score_bucket" | "task_id",
  aggregate?: Array<"count" | "pass_rate" | "avg_score" | "sample_ids">,
  filter?: { score_lt?: number; score_gte?: number; error_contains?: string },
}
```

不带 `group_by` 时行为不变（返回 task 列表），带 `group_by` 时返回 `Array<{group_key, metrics: {...}, sample_ids: string[]}>`。

**来源**：借鉴 hermes `session_search` 的"不让主 LLM 遍历原始数据"精神，实现用工具内置聚合而非辅助模型二次摘要。

### 5.8 JSON 语义截断

**位置**：`src/lib/copilot/tool-runtime.ts`（新文件）

```ts
export function truncateJsonSemantic(obj: unknown, maxFieldChars: number): unknown {
  if (typeof obj === "string") {
    return obj.length > maxFieldChars
      ? obj.slice(0, maxFieldChars) + "...(truncated)"
      : obj;
  }
  if (Array.isArray(obj)) return obj.map((x) => truncateJsonSemantic(x, maxFieldChars));
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, truncateJsonSemantic(v, maxFieldChars)]),
    );
  }
  return obj;
}
```

应用场景：
- Tool args 送出前（防止 LLM 产生过长字符串导致 provider 拒收）
- Tool result `preview` 字段生成（`maybePersistToolResult` 内部调用）

**来源**：hermes `_truncate_tool_call_args_json`（`agent/context_compressor.py`）。直接照抄，这是 Nous 踩过的坑。

### 5.9 新增 `edit_template` 工具

**位置**：`src/lib/copilot/tools/edit-template.ts`（新文件）

```ts
export const editTemplateTool: ToolDescriptor<
  { schema_id: string; patch: TemplatePatch },
  { success: boolean; new_version: number }
> = {
  name: "edit_template",
  description: "Edit a prompt template. User confirmation required.",
  inputSchema: {...},
  metadata: {
    isReadOnly: false,
    isDestructive: true,          // 自动触发 preToolCall require_confirm
    maxResultSizeChars: 2000,
  },
  call: async ({ schema_id, patch }, ctx) => {
    const schema = await readSchema(schema_id);
    const updated = applyPatch(schema, patch);
    await writeSchema(schema_id, updated);
    return { success: true, new_version: updated.version };
  },
};
```

作用：作为第一个新写工具，验证 metadata → Confirm → hook → 落盘 全链路。

### 5.10 Context 分层注入（核心）

**位置**：`src/lib/copilot/build-llm-messages.ts`（重写）+ `src/lib/copilot/snapshot-cache.ts`（改）

#### 5.10.1 System header 结构

```ts
interface SystemHeader {
  route_type: string;
  path: string;
  active_contexts: Array<{
    id: string;                 // "ctx_1"
    type: "experiment" | "task_result" | "template" | ...;
    ref: string;                // 原对象 ID，如 "exp_123"
    summary: string;            // 一句话描述，<100 字符

    // Inline 降级（见 5.10.2）
    inline?: unknown;           // 超阈值前直接 inline
  }>;
}
```

#### 5.10.2 Inline 阈值

组装规则（伪码）：

```
总 inline 允许 token 数 = 2000
每个 context 最大 inline token = 1000
active_contexts.length 阈值 = 3

if (contexts.length <= 3) {
  for each context:
    try inline (serialize + token count);
    if (token > 1000) fall back to ref-only;
    if (accumulated token > 2000) fall back to ref-only for rest;
} else {
  all ref-only;
}
```

Ref-only 时 LLM 想看详情走 `read_context(id)` 工具。

阈值 (3, 1000, 2000) 是初值，后期可根据遥测调整。

#### 5.10.3 服务端 snapshot 缓存

**改动**：`snapshot-cache.ts` 保留；`/chat` 请求依然带 `client_snapshot`，但**不再往 transcript append**。

当前流程：
```
client → /chat {client_snapshot, user_message}
       → build-llm-messages append client_snapshot 到 system
       → LLM 看到整页 DOM
```

新流程：
```
client → /chat {client_snapshot, user_message}
       → snapshot-cache.set(session_id, client_snapshot)
       → build-llm-messages 只注入 route_type + path 到 system header
       → LLM 如需详细，调 read_page(query)
       → read_page.call() 从 snapshot-cache.get(session_id) 拉快照并按 query 返回子集
```

#### 5.10.4 新增三个 context-reading 工具

- `read_context(id, scope?)` — 拉**用户圈选过的** context 详情。`scope: "self" | "parent" | "full"`，默认按 context.type 决定（见下表）。
- `read_tool_result(id)` — 按 `ref://tool-result/{id}` 拉回落盘的 tool result。
- `read_resource(type, id, fields?)` — 拉**用户没圈但 LLM 需要的**平台资源。见 §5.11。

三者都标 `isReadOnly: true`，参与 micro-compact。

**`read_context.scope` 每种 type 的默认和语义**：

| context.type | 默认 scope | `scope: "self"` 返什么 | `scope: "parent"` 返什么 |
|---|---|---|---|
| `task_field` | self | field value 本身 | field + 所属 task 全量（input/output/metrics） |
| `task_result` | self | task 全量 | task + 所属 experiment 元数据 |
| `experiment` | self | experiment 元数据 | — |
| `text_selection` | self | 选中文本 + 前后 200 字 | 选中文本 + 所属元素 DOM 片段 |
| `template / dataset / display / rubric` | self | 资源全量 | — |
| `rubric_stats` | self | 聚合统计 | stats + 关联 experiment 元数据 |

`scope: "full"` 目前不使用，留作后期升级（若需要跳两层）。

**工具与 `read_resource` 边界**：`read_context` 走 session 内 active_contexts 表（id 是 `ctx_N`），只能查用户点过的；`read_resource` 走 `data/` 文件系统（id 是资源本体 id），可查任意资源。语义清晰不重叠。

---

### 5.11 `read_resource` 工具

**位置**：`src/lib/copilot/tools/read-resource.ts`（新文件）

用于 LLM 顺藤摸瓜查用户**没圈过但需要**的平台资源。5.1–5.10 里 `read_context` 只能覆盖圈选过的；`read_resource` 填补"没圈也能查"的缺口。

```ts
export const readResourceTool: ToolDescriptor<
  {
    type: "experiment" | "template" | "dataset" | "display" | "rubric";
    id: string;
    fields?: string[];  // 只取这些字段；省略 = 全量
  },
  Record<string, unknown>
> = {
  name: "read_resource",
  description:
    "Fetch a specific platform resource by id. Use when you need metadata not already in active_contexts (e.g. a template referenced by an experiment).",
  inputSchema: {...},
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,  // template/dataset 通常比 task 大
  },
  call: async ({ type, id, fields }) => {
    const resource = await loadResource(type, id);
    if (!resource) throw new Error(`${type}/${id} not found`);
    return fields ? pick(resource, fields) : resource;
  },
};
```

**关键设计**：
- `fields?` 参数是核心 — LLM 只取需要的字段（如 `["prompt_template"]`），token 预算自己掌握
- 同 `read_context` 一样 `isReadOnly: true`，参与 micro-compact
- 大 payload 自动走 postToolCall 护栏（5.5 落盘 + ref）

**典型链式调用**：

```
read_resource("experiment", "exp_A", fields=["schema_id"])
  → { schema_id: "schema_X" }
read_resource("template", "schema_X", fields=["prompt_template", "variables"])
  → { prompt_template: "...", variables: [...] }
```

---

### 5.12 Copilot UI 呈现约定

重构后 LLM 对 context 的消费路径变了（ref + on-demand），UI 必须跟上才不会心智错配。

#### 5.12.1 删除「预览 LLM 将看到的 context」折叠面板

**位置**：`src/components/copilot/context-chip-rail.tsx` + `src/components/copilot/chat-view.tsx`

**原行为**：展开后显示圈选 contexts resolve 成 markdown 的完整文本，标签"预览 LLM 将看到的 context"。

**新架构下误导**：LLM 不再看到这段 markdown 全文，只看 ctx_N + summary。保留 = 用户心智与实际行为错配。

**具体删除清单**：

| 文件 | 内容 |
|---|---|
| `context-chip-rail.tsx` | `previewOpen` state + 触发按钮 + 展开 `<div>` 面板（当前 L34, L92-99, L104-108 附近） |
| `chat-view.tsx` | `ctxPreview` state、`setCtxPreview` 调用、以及计算它的 `useEffect`（L55 附近） |
| `src/lib/i18n/zh.ts` + `en.ts` | 删除 key `copilot.preview_system_message` |
| `src/app/globals.css` | 删除 `.copilot-preview-md` 类（如仅此处使用） |
| `/api/copilot/contexts/resolve` | `system_message` 字段可保留给后端 `/chat` 组装时用（但 §5.10 之后也不再拼成单一 markdown 注入），前端不再消费。实际可考虑把这个字段从响应体移除 |

#### 5.12.2 Chip 本身承载"查看详情"

删除 preview 后，用户仍需要手段确认 "我圈对了"。承担方：chip 本身可展开。

**位置**：`src/components/copilot/context-chip-rail.tsx`

**规格**：

```
┌ chip (collapsed)──────────────────────────────┐
│  #2  field  output.answer            [×]      │
│       └ in Exp B / task_B1                    │
└─(click body → expand)─────────────────────────┘

┌ chip (expanded inline)─────────────────────────┐
│  #2  field  output.answer            [×]      │
│       └ in Exp B / task_B1                    │
│  ──────────                                    │
│  Value:                                       │
│  "产品质量过硬，值得推荐..."                    │
│                                                │
│  Metadata:                                    │
│  · experiment: Exp B (exp_B)                  │
│  · task: task_B1                              │
│  · field path: output.answer                  │
└────────────────────────────────────────────────┘
```

- Chip 主体点击 → inline 展开/折叠
- `×` 保持 remove 功能（独立按钮，阻止冒泡）
- 展开内容来源：lazy 调 `/api/copilot/contexts/resolve`（已有 API）—— 可接受批量查询一次拿全，也可 per-id 按展开时请求
- 多个 chip 同时展开允许存在
- 展开状态存 `context-chip-rail.tsx` 组件内 state（不需要持久化）

#### 5.12.3 tool-call-card 按工具类型分渲染

**位置**：`src/components/copilot/tool-call-card.tsx`

当前卡片只展示工具名 + 参数 + 结果预览，分辨度低。新架构下 Copilot 大部分"上下文流动"都通过 tool-call 显现，卡片是可视化主载体。按**工具类型分家**：

| 工具 | 卡片样式要点 | Icon 建议（Lucide） |
|---|---|---|
| `read_context(id, scope)` | 标题 `查阅圈选 #N · scope`；视觉 echo chip rail 的 `#N`（同色/同编号）；底部展示 scope 带回的内容（self = field value；parent = field + task 折叠） | `Paperclip` |
| `read_resource(type, id, fields)` | 标题 `查阅资源 type/id`；`id` 作可点击链接跳详情页（如 `/settings/templates/{id}`）；展示 fields 子集 | `Link` |
| `read_tool_result(id)` | 标题 `回拉历史 · tr_xxx`；副标题 `(Turn N 的 <原工具名> 结果)`；展示内容 | `RotateCcw` |
| `list_experiments` / `read_experiment_results` / `read_page` | 保留现有样式，根据 metadata.isReadOnly 自动标 `read` | `Search` / `FileText` |
| `restart_experiment` / `edit_template`（写） | 独立样式：`写操作`标签 + 待确认状态（`[拒绝] [确认]`）+ diff 预览（edit_template 场景） | `Pencil` / `RotateCw` |

**三个视觉原则**：

1. **与 chip rail 的视觉 echo**：`read_context` 卡片的 `#N` 和输入框上方 chip 的 `#N` 用同色/同编号，用户一眼看出 LLM 在查他圈选的哪个
2. **资源可跳转**：`read_resource` 的 type+id 链接到详情页（evalyst 有 `/settings/templates/{id}` 等路由）
3. **读写视觉区分**：`metadata.isDestructive` 驱动 card 样式；写工具独立色/边框，强化用户控制感

#### 5.12.4 保留不变

- 圈选 inspector（`inspector-overlay`）
- DOM mask 彩色徽章（`context-mask`）
- Session list / model picker / glass 体系

---

## 6 · 渐进披露数据流（end-to-end 实例）

场景：用户在对比页 `/compare?a=exp_A&b=exp_B` **圈选 task_field 级别**（`output.answer`，来自两个实验各自一条结果），先问"哪个文案更好？"，再问"怎么调 prompt 能综合优点？"。这个场景压力测试两件事：(a) 圈选粒度到字段级 (b) LLM 需要查未圈选的资源（prompt template）。

```
圈选完成时（尚未发消息）:
┌─ build-llm-messages ─┐
system header:
  {
    route_type: "compare_experiments",
    path: "/compare?a=exp_A&b=exp_B",
    active_contexts: [
      {
        id: "ctx_1", type: "task_field", ref: "output.answer",
        summary: "字段 output.answer · within Exp A / task_A1",
        within: {experiment: "exp_A", task_result: "task_A1"},
      },
      {
        id: "ctx_2", type: "task_field", ref: "output.answer",
        summary: "字段 output.answer · within Exp B / task_B1",
        within: {experiment: "exp_B", task_result: "task_B1"},
      },
    ],
  }
  [注意：没有 field value，没有 experiment 元数据，没有 prompt]

Turn 1:
┌─ User ─┐
"哪个文案更好？"

┌─ LLM ─┐  (推理: 要判断好坏得先看文案内容)
tool_use: read_context(id="ctx_1", scope="self")
tool_use: read_context(id="ctx_2", scope="self")

┌─ Tool runtime ─┐
[preToolCall] read tool → proceed
[call ctx_1]  → field value: "这个产品让我喜出望外，细腻的做工..."  (~300 字节 inline)
[call ctx_2]  → field value: "产品质量过硬，值得推荐..."            (~300 字节 inline)

┌─ LLM ─┐  (推理: 想知道文案对什么 input 生成的，升级 scope)
tool_use: read_context(id="ctx_1", scope="parent")

┌─ Tool ─┐
→ {
    targeted_field: "output.answer", targeted_value: "...",
    task: { task_id: "task_A1", input: {product: "枸杞茶"}, output: {...}, metrics: {...} },
  }
  [~2KB, inline]

┌─ LLM ─┐
text: "A 的文案更有感染力，B 更克制..." (分析)

Turn 2:
┌─ User ─┐
"怎么调 prompt，能综合 A、B 的优点？"

┌─ LLM ─┐  (推理: 要改 prompt 必须先看 prompt)
tool_use: read_resource(type="experiment", id="exp_A", fields=["schema_id", "model_name"])
tool_use: read_resource(type="experiment", id="exp_B", fields=["schema_id", "model_name"])

┌─ Tool ─┐
→ { schema_id: "schema_X", model_name: "gpt-4o" }
→ { schema_id: "schema_Y", model_name: "claude-4.7" }

┌─ LLM ─┐
tool_use: read_resource(type="template", id="schema_X", fields=["prompt_template", "variables"])
tool_use: read_resource(type="template", id="schema_Y", fields=["prompt_template", "variables"])

┌─ Tool runtime ─┐
[call]        返回 prompt template（假设 ~3KB）
[postToolCall] 超 maxResultSizeChars=4000 则落盘 + ref；未超则 inline
              若落盘 → transcript 里 tool_result content 为 {kind: "ref", ref: "ref://tool-result/tr_xyz", preview: "..."}

┌─ LLM ─┐
text: "建议合并成这样: ...（具体 prompt 改法）"

Turn 3 (用户决定落地):
┌─ User ─┐
"好，帮我把 schema_X 改成这样"

┌─ LLM ─┐
tool_use: edit_template(schema_id="schema_X", patch={prompt_template: "..."})

┌─ Tool runtime ─┐
[preToolCall] isDestructive=true → require_confirm
[UI]          tool-call-card 渲染"写操作 · 等待确认" + diff 预览 + [拒绝] [确认]
[User clicks 确认]
[POST /tool-result] action=run
[call]        writeSchema(schema_X, updated) → success
[postToolCall] inline 结果

Turn 10 (多轮后):
┌─ build-llm-messages ─┐
microCompact(messages, { keepRecentReadResults: 3 }):
  → Turn 2 的 read_resource(template) 的 ref 形 tool_result
  → 被压成 "(archived tool result; retrieve via read_tool_result('tr_xyz') if needed)"
  → transcript 继续精简
```

**这个 trace 证明了什么**：

1. 圈选字段级（task_field）也能承载，无需把整个 task 注入 system
2. `read_context` 的 scope 让 LLM 从 field value 逐级升级到 task 全量，精确控制 token 用量
3. `read_resource` 让 LLM 从圈选的 experiment 顺藤摸到 schema 再到 template，**用户无需预先圈选所有可能相关的资源**
4. 写工具 `edit_template` 在 preToolCall hook 触发 Confirm，用户始终在控制回路
5. 多轮后 micro-compact 自动收缩老的大 tool_result，cache 前缀稳定


---

## 7 · 数据结构与存储变更

### 7.1 JSONL tool_result content 字段

**旧**：

```json
{"role":"tool","tool_call_id":"c1","content": <output obj>}
```

**新**（对齐三种形态）：

```ts
type ToolResultContent =
  | { kind: "inline"; value: unknown }                       // 小 payload
  | { kind: "ref"; ref: string; preview: string }            // 大 payload 落盘后
  | { kind: "compacted"; summary: string; ref?: string };    // micro-compact 后
```

### 7.2 新目录

```
data/copilot/
  index.json           (已有)
  sessions/{id}.jsonl  (已有)
  tool-results/        (新)
    {session_id}/
      tr_xxx.json
      tr_yyy.json
```

### 7.3 Registry 单例

`src/lib/copilot/tools/registry.ts` 模块级常量 `TOOLS` + `toolByName`，SSR 友好。

---

## 8 · 向后兼容

### 8.1 老 session JSONL 读取

现有 session 里的 `tool_result.content` 是裸 output 对象。读取时视作 `{ kind: "inline", value: <content> }` 即可，不需要迁移写入。

### 8.2 API 兼容

`/chat` 请求体 `client_snapshot` 保留（继续作 snapshot-cache 写入），但**不往 transcript 塞**。前端无需改动。

### 8.3 新工具渐进上线

`read_context` / `read_tool_result` / `read_resource` / `edit_template` 四者独立加入 registry。`edit_template` 用 feature flag（复用现有 LLM config 机制）控制启用。

---

## 9 · 测试策略

### 9.1 纯函数（vitest）
- `microCompact` — 表驱动测试：不同消息序列 × 不同 keepRecentReadResults
- `truncateJsonSemantic` — 嵌套对象、数组、字符串边界
- `maybePersistToolResult` — inline vs ref 分支、文件写入 mock
- `build-llm-messages` — 各种 context 组合 × inline/ref 阈值触发 × 各 type 的 scope 默认
- `read_resource` 的 `fields` 裁剪：已知资源 × 指定字段子集

### 9.2 Tool runtime 集成
- `preToolCall` / `postToolCall` 链路：mock tool，验证 hook 顺序 + 短路行为
- `edit_template`: Confirm 未通过时拒绝执行
- `read_context(id, scope)` 对 task_field / task_result / template 等各 type 的 scope 升级路径
- `read_resource` 对不存在资源的 404 处理

### 9.3 e2e（Playwright）
- 复现场景 §6 Turn 1-3，断言：
  - transcript 里 tool_result content 是 ref 形态（非 inline）
  - `data/copilot/tool-results/{session_id}/` 下有对应文件
- 10 轮对话后 system prompt token 数稳定在上限以下
- UI 断言：
  - "预览 LLM 将看到的 context" 折叠按钮不再存在
  - 圈选后 chip 点击 → inline expand 出详情区域
  - tool-call-card 对 `read_context` / `read_resource` / `read_tool_result` / write 四种类型分别渲染为不同 variant

---

## 10 · 开放问题与待拍数字

| 数字 | 初值 | 说明 |
|---|---|---|
| `maxResultSizeChars`（per-tool 可覆盖默认） | 2000 | 超过走落盘 |
| `read_resource` 的 `maxResultSizeChars` | 4000 | template/dataset 通常较大，单独放宽 |
| Inline context 总上限 | 2000 token | 组装 system header 时 |
| Inline 单 context 上限 | 1000 token | 单个超即降级 ref |
| Inline 降级触发 count | 3 | contexts.length > 3 全 ref |
| `microCompact` keepRecentReadResults | 3 | 保最近 N 条可重放 tool_result |
| Max tool chain per turn | 5（保持现状） | 不提升 |
| Tool result retention | 永久保留 | 和 session JSONL 同生命周期 |

开放问题：
- **Q1**：`read_context` 结果也走 `maybePersistToolResult` 护栏吗？（倾向于是，但 inline 阈值可放宽——圈选本来就是用户主动要求 LLM 看的）
- **Q2**：`client_snapshot` 是否带时间戳 TTL，还是 session 生命周期内一直有效？（倾向于后者，用户切页面会覆写）
- **Q3**：`edit_template` 的 patch 格式（JSON Patch vs 整条 template 替换）？→ 建议用整条替换，patch 语义交给 LLM，Confirm 时展示完整 diff
- **Q4**：`active_contexts.within` 是否自动补全关系链（如 task_field 内自动带出 experiment.schema_id）？自动补 = LLM 少一次 `read_resource` 调用但 resolver 变重；不补 = 当前 DOM 父链语义纯粹但 LLM 多一轮工具调用。**倾向于不补**，保持 `read_resource` 为唯一顺藤摸瓜入口
- **Q5**：chip 点击 expand 详情走 lazy fetch，同 chip 反复展开要不要客户端缓存一次？（倾向于 session 生命周期缓存，chip 关闭重开不重新请求）

---

## 11 · 参考来源对照

| 改动 | 来源 repo / 文件 | 采用程度 |
|---|---|---|
| 5.1 Tool 描述符 | claude-code-best `/src/Tool.ts` | 裁剪到 4 字段 metadata |
| 5.2 手动 array 注册 | — | 简化，反 CCB 自注册 |
| 5.3 preToolCall hook | CCB `useCanUseTool` + openclaw `before-tool-call` | 合流简化 |
| 5.4 postToolCall hook | CCB PostToolUse + openclaw `after-tool-call` | 合流简化 |
| 5.5 Tool result 落盘 | CCB `toolResultStorage` + `SnipTool` | 砍聚合预算 |
| 5.6 Micro-compact | CCB `microCompact` | 简化为纯函数 |
| 5.7 Aggregation 参数 | hermes `session_search` 精神 | 改用工具内置聚合 |
| 5.8 JSON 语义截断 | hermes `_truncate_tool_call_args_json` | 直接照抄 |
| 5.9 `edit_template` | — | 业务需求 |
| 5.10 Context 分层（含 `read_context.scope`） | hermes `MemoryManager` + CCB `toolResultStorage` + openclaw `ContextEngine` 精神 | 综合 |
| 5.11 `read_resource` | — | 补 PR-3 砍掉 6 个 read 工具后遗留的顺藤摸瓜缺口 |
| 5.12 UI 规格（删 preview 面板 + chip expand + tool-card 分渲染） | — | 响应新架构语义偏移 |

### 显式未采用清单

- claude-code-best: `autoCompact` 全量 summary / fork subagent / 四类 taxonomy 记忆 / ToolSearch / CompactBoundaryMessage / 四源权限矩阵
- hermes: XML `<tool_call>` 协议 / handoff framing / ContextEngine 可插拔接口 / FTS5 session 搜索
- openclaw: Gateway + channels / Active Memory + Dreaming + LanceDB / 4-kind owner / availability 表达式 / rewriteTranscriptEntries

---

## 12 · 实施顺序建议（交给 writing-plans）

按依赖关系划 6 个里程碑：

1. **M1 · 工具系统骨架**：5.1 + 5.2 + 5.8，迁移现有 4 工具到新 descriptor 格式
2. **M2 · Hooks 链路**：5.3 + 5.4，落 Confirm + 落盘 hook，UI Confirm 逻辑迁移
3. **M3 · Tool result 护栏**：5.5 + 新增 `read_tool_result` 工具
4. **M4 · Context 分层注入**：5.10（含 `read_context` 带 scope）+ 5.11 `read_resource`，snapshot 移服务端
5. **M5 · UI 规格**：5.12（删除 preview 面板 + chip expand + tool-call-card 分渲染）
6. **M6 · 聚合 + 写工具 + 压缩**：5.6 + 5.7 + 5.9

每个里程碑独立可测试，M1–M4 完成后行为与现状等价（无 regression）。M5 让用户侧看到新架构的可视化承载。M6 解锁新能力。

总预估 3-4 周（单人专注）。M5 UI 改动 +3-4 天。
