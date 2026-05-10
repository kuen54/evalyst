# Copilot v2 · 上下文与工具系统重构 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 evalyst copilot 从"一次性注入 + 硬编码 4 工具"重构为"progressive disclosure：system prompt 恒定小 + LLM 按需 tool 拉详细"的 metadata-first 架构。

**Architecture:** 工具注册表 + metadata + pre/postToolCall hooks + tool result 落盘 + micro-compact + context 分层注入 + read_context/read_resource 顺藤摸瓜 + UI 呈现跟进。分六个里程碑（M1-M6），M1-M4 行为等价不改用户侧感知，M5 交付 UI 规格，M6 解锁聚合/写工具/压缩。

**Tech Stack:** TypeScript · Next.js 16.2.4 (App Router, Turbopack) · vitest · Playwright · Node fs + nanoid · 既有 `src/lib/copilot/*` + `src/components/copilot/*`

**Spec**: `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`

---

## 现有代码对照表（必读）

原 plan 在没读现有代码的情况下写成。实施前必须读本节，避免按错误的假设写代码。**设计目标按 spec 不动**；**session 数据不向后兼容已被用户确认接受**（见下方 §数据迁移）；原 plan 里对既有文件的假设错了的地方在此纠正。

### 既有文件映射

| 既有文件 | 现状 | 改动策略 |
|---|---|---|
| `src/lib/copilot/tools.ts` | 191 行，含 `CopilotTool` interface + 4 工具定义 | **整文件删除**。`CopilotTool` → 新 `ToolDescriptor`（见 Task 1.1），4 工具拆到 `src/lib/copilot/tools/*.ts` |
| `src/lib/copilot/tool-registry.ts` | 11 行，`findTool` / `assertKnownTool` 线性查 | **整文件替换**。新 `src/lib/copilot/tools/registry.ts` 走 `toolByName` Map（见 Task 1.7）|
| `src/lib/copilot/tool-metadata.ts` | 19 行，client-safe `{ name, requiresConfirm }[]` | **整文件删除**。UI 读 `ToolDescriptor.metadata` 或通过新 barrel export |
| `src/lib/copilot/tool-adapters.ts` | 20 行，`toOpenaiTools` / `toAnthropicTools` | **适配**。接收 `ToolDescriptor[]` 而非 `CopilotTool[]`，字段 `inputSchema` 替代 `input_schema` |
| `src/lib/copilot/snapshot-cache.ts` | 20 行，**已正确实现** `set/get/delete + Map` | **保留不动**。Task 4.2 只需验证 `/chat` / `/tool-result` 路由已调用 `setSnapshot` 且未把 snapshot 塞 transcript |
| `src/lib/copilot/resolve-context.ts` | 374 行，`resolveContexts(refs[])` 批量 + `formatContextsForLlm` | **扩展**。Task 4.4 在这里 append `resolveContextById(sessionId, ctxId)`，保留既有函数 |
| `src/lib/copilot/session-store.ts` | 260 行，JSONL append-only + fork | **扩展**。Task 3.2 加 `normalizeToolResult` 读取兜底；Task 4.4 加 `getSessionContext(sessionId, ctxId)` 查 active_contexts |
| `src/lib/copilot/types.ts` | 134 行，`CopilotMessage` 有 `role: 'user'\|'assistant'\|'tool_use'\|'tool_result'` + content:string + tool_* sibling 字段 | **按 spec §7.1 迁移**。`role='tool_use'` / `'tool_result'` 改为 `role='tool'`，`content` 改为 `ToolResultContent` union。破坏既有 JSONL 数据（见下方）|
| `src/lib/copilot/stream-response.ts` | 158 行，接收 `CopilotTool[]` 走 adapter | **适配**。参数改 `ToolDescriptor[]`，dispatch 改走 `toolByName` Map；Task 1.8 |
| `src/lib/copilot/build-llm-messages.ts` | 67 行 | **重写**。Task 4.1 / 4.6 替换为 SystemHeader + 按 ToolResultContent 分渲染 |
| `src/app/api/copilot/sessions/[id]/chat/route.ts` | 现有路由，`import { tools } from '@/copilot/lib/tools'` | **适配**。import 路径改走新 barrel `@/copilot/lib/tools`（index.ts） |
| `src/app/api/copilot/sessions/[id]/tool-result/route.ts` | 同上 | 同上 |

### 既有函数签名纠正

原 plan 里几处伪代码假设错了（async / 函数名）。真实签名：

| 函数 | 原 plan 假设 | 真实情况 |
|---|---|---|
| `listExperiments` | `async` | **sync**，from `@/lib/store` |
| `readResults` | `readResultsJsonl` | 真名 `readResults`，**sync**，from `@/lib/store` |
| `getExperiment` | `readExperiment` 且 `async` | 真名 `getExperiment`，**sync**，from `@/lib/store` |
| `startBatch` | 无明确返回 | 返回 `{ totalTasks }`，第 3 参数 concurrency 默认给 3（`ExperimentConfig` 无 concurrency 字段） |
| Template CRUD | `readSchema` / `writeSchema` | 实际 `readUserSchema` / `writeUserSchema` from `@/lib/schema/user-schema-store`（实施时 grep 确认） |
| Dataset / Display / Rubric CRUD | `readDataset` / `readDisplay` / `readRubric` | 分别在 `@/lib/datasets`、`@/lib/displays`、`@/lib/rubric-store`（实施时 grep 确认具体 export 名） |

### CopilotMessage schema 迁移（破坏性）

Spec §7.1 定义 `role: 'tool'` + `content: ToolResultContent` union。既有 JSONL 是 `role: 'tool_use' \| 'tool_result'` + `content: string` + tool_* sibling 字段。**用户已确认 session 数据不兼容 OK**。实施方案：

1. **新增迁移脚本**（M3 Task 3.2 范围）`src/lib/copilot/migrate-sessions.ts`：
   - 读 `data/copilot/sessions/*.jsonl`
   - 合并相邻的 `tool_use` + `tool_result`（按 call_id 配对）成新 `role: 'tool'` 消息
   - 把 tool_result 的 `content: string` 包装成 `{ kind: "inline", value: JSON.parse(content) }`
   - 原地覆写 jsonl（事前手动备份 `data/copilot/sessions.bak/`，脚本不负责备份）
2. **或**：加 `normalizeToolResult` 读时兼容（见 spec §8.1），运行时即时转换，不迁移文件。
3. **或**：放弃既有 session 数据（用户开发阶段可接受）— 删 `data/copilot/index.json` + `data/copilot/sessions/*.jsonl`，copilot 首次启动自动重建。

**推荐选项 3**（最简，用户明示 OK）。M3 实施时加一条 dev 注释说明："若要保留旧会话，运行一次迁移脚本；否则清空 data/copilot/ 即可。"

### 既有测试需要清理

以下 `__tests__` 文件涉及被删除 / 替换的 API，实施时要同步删除或重写：

| 测试文件 | 处置 |
|---|---|
| `src/lib/copilot/__tests__/tools.test.ts` | 删除或重写成 per-tool tests |
| `src/lib/copilot/__tests__/tool-adapters.test.ts` | 重写（`ToolDescriptor` 接口变了） |
| `src/lib/copilot/__tests__/session-store.test.ts` | 验证新 `CopilotMessage` schema；若保留 tool_use/tool_result 角色历史测试，改为测新的 `role='tool'` |

### 下游 consumer 同步

除 `src/lib/copilot/` 和 `src/app/api/copilot/` 外，以下也需关注：

- `src/components/copilot/tool-call-card.tsx` — 读 `tool-metadata.ts`（将被删），M2 起改走 `ToolDescriptor.metadata`（可能从 client-safe 导出点拿）。注意 "use client" 组件不能直接 import server-side `tools/` 文件（有 `fs` 依赖），需通过新的 client-safe `tool-metadata-client.ts` 或类似 barrel 导出纯 metadata 列表。
- `src/components/copilot/chat-view.tsx` — 消费 `ctxPreview` 状态（M5 Task 5.1 删除）
- `src/components/copilot/context-chip-rail.tsx` — 删 preview 按钮（M5 Task 5.1）+ 加 chip expand（M5 Task 5.2）

### 执行顺序小调整

原 plan 的 M1-M6 基本不动。**小修正**：

- M1 Task 1.7 从 "新建 tool-registry.ts" 改为 "**删除既有 tool-registry.ts + tool-metadata.ts**，新建 `tools/registry.ts` + `tools/metadata-client.ts`（client-safe mirror for UI）"
- M1 Task 1.8 stream-response 改造时，需同时适配 `tool-adapters.ts` 接收 `ToolDescriptor[]`（原 plan 未涵盖这个依赖）
- M4 Task 4.2 snapshot-cache 服务端化 → 现有已实现，只需**验证 chat / tool-result route 未把 snapshot push 到 transcript**（若已规范则本 task 零改动）
- M3 Task 3.2 session-store 读兼容 → 改为"Session 迁移决策"节（见上"数据迁移"方案 3：放弃既有数据）
- 数据破坏性改动集中在 M3（CopilotMessage schema 迁移），**M3 完成前提醒用户备份 / 清空 data/copilot/**

### 不变的东西

- Spec §3 三核心原则不变
- M1-M6 总体范围和顺序不变
- 总预估 3-4 周不变
- 所有 TDD / 每任务 commit / 每 M 验证点不变

---

## 全局规则

- TDD：每个纯函数任务 `写测试 → 跑测试失败 → 写实现 → 跑测试通过 → 提交`
- 每个任务单独 commit，commit 信息按 AGENTS.md 规范（`<type>(<scope>): <subject>`）
- 不改配置文件（lockfile / tsconfig / 包依赖），除非任务显式要求
- 所有新增 UI 文案走 `useT()` + `zh.ts` / `en.ts` 成对加 key
- 新增纯函数 → 配套 `__tests__/*.test.ts`，`npm test` 本地验证
- 每个 M 末尾跑全量验证：`npx tsc --noEmit && npm test && npm run build`
- 遇到 UI 改动的 M（M5），跑 `npm run test:e2e` playwright smoke

---

## 文件结构（全图）

### 新建

| 文件 | 职责 |
|---|---|
| `src/lib/copilot/tools/types.ts` | `ToolDescriptor`、`ToolContext`、`ToolCallResult` |
| `src/lib/copilot/tools/registry.ts` | `TOOLS` 手动 array + `toolByName` Map |
| `src/lib/copilot/tools/hooks.ts` | `PreToolCallHook` / `PostToolCallHook` 类型 + 内置钩子 |
| `src/lib/copilot/tools/list-experiments.ts` | 迁移现有 |
| `src/lib/copilot/tools/read-experiment-results.ts` | 迁移 + M6 加 aggregation |
| `src/lib/copilot/tools/restart-experiment.ts` | 迁移（isDestructive=true）|
| `src/lib/copilot/tools/read-page.ts` | 迁移 |
| `src/lib/copilot/tools/read-context.ts` | 新工具，带 scope |
| `src/lib/copilot/tools/read-tool-result.ts` | 新工具，按 ref 拉落盘结果 |
| `src/lib/copilot/tools/read-resource.ts` | 新工具，按 type+id 查资源 |
| `src/lib/copilot/tools/edit-template.ts` | 新工具，写 |
| `src/lib/copilot/tool-runtime.ts` | `runTool(call)` 主入口 + `truncateJsonSemantic` |
| `src/lib/copilot/tool-result-store.ts` | `maybePersistToolResult` + `loadPersistedToolResult` |
| `src/lib/copilot/micro-compact.ts` | 纯函数 `microCompact(messages, config)` |
| `src/lib/copilot/snapshot-cache.ts` | 服务端 per-session snapshot cache |
| 多个 `__tests__/*.test.ts` | 单测 |

### 修改

| 文件 | 变化 |
|---|---|
| `src/lib/copilot/types.ts` | 新增 `ToolResultContent` 三态；`CopilotMessage.content` 对齐 |
| `src/lib/copilot/session-store.ts` | 读取旧 tool_result 视作 `{kind: "inline", value}` 兼容 |
| `src/lib/copilot/build-llm-messages.ts` | 重写 system header 组装；inline 阈值；micro-compact 前置 |
| `src/lib/copilot/stream-response.ts` | 走 `runTool` 而非直接 switch |
| `src/app/api/copilot/sessions/[id]/chat/route.ts` | client_snapshot 写 cache 不 append |
| `src/app/api/copilot/sessions/[id]/tool-result/route.ts` | 同上 |
| `src/app/api/copilot/contexts/resolve/route.ts` | 响应体 `system_message` 字段保留但前端不消费 |
| `src/components/copilot/context-chip-rail.tsx` | 删 preview 折叠面板 + chip 本身 expand |
| `src/components/copilot/chat-view.tsx` | 删 `ctxPreview` state / effect |
| `src/components/copilot/tool-call-card.tsx` | 按 tool name 分 variant 渲染 |
| `src/lib/i18n/zh.ts` + `en.ts` | 删 `copilot.preview_system_message`，新增 `copilot.context_tag_expand` / `copilot.tool.*` 系列 |

### 新数据目录

```
data/copilot/tool-results/{session_id}/tr_xxx.json
```

---

# M1 · 工具系统骨架

目标：把硬编码的 4 工具迁移成 `ToolDescriptor` 描述符格式，引入 manual array registry，不改运行时行为。

## Task 1.1 · 定义 ToolDescriptor 类型

**Files:**
- Create: `src/lib/copilot/tools/types.ts`

- [ ] **Step 1: 写类型定义文件**

```ts
// src/lib/copilot/tools/types.ts
export interface ToolMetadata {
  isReadOnly: boolean;
  isDestructive: boolean;
  requiresConfirm?: boolean;
  maxResultSizeChars: number;
}

export interface ToolContext {
  session_id: string;
  signal: AbortSignal;
}

export interface ToolDescriptor<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  metadata: ToolMetadata;
  call: (input: Input, ctx: ToolContext) => Promise<Output>;
}

export interface ToolCallRecord {
  tool_call_id: string;
  tool_name: string;
  input: unknown;
}
```

- [ ] **Step 2: 跑 tsc 确保语法正确**

```bash
npx tsc --noEmit
```

Expected: PASS（新文件无被引用先不会报错）

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/tools/types.ts
git commit -m "feat(copilot): add ToolDescriptor type definitions"
```

---

## Task 1.2 · 实现 truncateJsonSemantic

**Files:**
- Create: `src/lib/copilot/tool-runtime.ts`
- Test: `src/lib/copilot/__tests__/tool-runtime.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/copilot/__tests__/tool-runtime.test.ts
import { describe, it, expect } from "vitest";
import { truncateJsonSemantic } from "../tool-runtime";

describe("truncateJsonSemantic", () => {
  it("leaves short strings untouched", () => {
    expect(truncateJsonSemantic("hello", 100)).toBe("hello");
  });

  it("truncates long strings with marker", () => {
    const long = "x".repeat(300);
    const result = truncateJsonSemantic(long, 100) as string;
    expect(result.startsWith("x".repeat(100))).toBe(true);
    expect(result).toContain("truncated");
  });

  it("recurses into arrays", () => {
    const input = ["x".repeat(200), "y"];
    const result = truncateJsonSemantic(input, 50) as string[];
    expect(result[0]).toContain("truncated");
    expect(result[1]).toBe("y");
  });

  it("recurses into objects", () => {
    const input = { body: "a".repeat(500), id: 1 };
    const result = truncateJsonSemantic(input, 100) as { body: string; id: number };
    expect(result.body).toContain("truncated");
    expect(result.id).toBe(1);
  });

  it("passes numbers / booleans / null through", () => {
    expect(truncateJsonSemantic(42, 10)).toBe(42);
    expect(truncateJsonSemantic(true, 10)).toBe(true);
    expect(truncateJsonSemantic(null, 10)).toBe(null);
  });

  it("handles nested structures", () => {
    const input = { items: [{ text: "z".repeat(300) }] };
    const result = truncateJsonSemantic(input, 100) as { items: { text: string }[] };
    expect(result.items[0].text).toContain("truncated");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/lib/copilot/__tests__/tool-runtime.test.ts
```

Expected: FAIL `Cannot find module '../tool-runtime'`

- [ ] **Step 3: 实现**

```ts
// src/lib/copilot/tool-runtime.ts
export function truncateJsonSemantic(obj: unknown, maxFieldChars: number): unknown {
  if (typeof obj === "string") {
    return obj.length > maxFieldChars
      ? obj.slice(0, maxFieldChars) + "...(truncated)"
      : obj;
  }
  if (Array.isArray(obj)) return obj.map((x) => truncateJsonSemantic(x, maxFieldChars));
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateJsonSemantic(v, maxFieldChars),
      ]),
    );
  }
  return obj;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/copilot/__tests__/tool-runtime.test.ts
```

Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/tool-runtime.ts src/lib/copilot/__tests__/tool-runtime.test.ts
git commit -m "feat(copilot): truncateJsonSemantic util (from hermes-agent)"
```

---

## Task 1.3 · 迁移 list_experiments 到 ToolDescriptor

**Files:**
- Read: `src/lib/copilot/tools.ts`（看现有实现）
- Create: `src/lib/copilot/tools/list-experiments.ts`

- [ ] **Step 1: 读现有实现**

```bash
grep -n "list_experiments" src/lib/copilot/tools.ts
```

记下现有 `list_experiments` 的输入/输出形态、实现逻辑。

- [ ] **Step 2: 写新文件（按 ToolDescriptor 包装）**

```ts
// src/lib/copilot/tools/list-experiments.ts
import type { ToolDescriptor } from "./types";
import { listExperiments as listExperimentsImpl } from "@/lib/store";

interface Input {
  status?: "running" | "done" | "failed";
  schema_id?: string;
  limit?: number;
}

interface Output {
  experiments: Array<{ id: string; status: string; schema_id: string; name?: string }>;
}

export const listExperimentsTool: ToolDescriptor<Input, Output> = {
  name: "list_experiments",
  description: "List experiments with optional status/schema filter and limit.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["running", "done", "failed"] },
      schema_id: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: 100 },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 2000,
  },
  call: async ({ status, schema_id, limit = 20 }) => {
    const all = await listExperimentsImpl();
    let filtered = all;
    if (status) filtered = filtered.filter((e) => e.status === status);
    if (schema_id) filtered = filtered.filter((e) => e.schema_id === schema_id);
    return {
      experiments: filtered.slice(0, limit).map((e) => ({
        id: e.id,
        status: e.status,
        schema_id: e.schema_id,
        name: e.name,
      })),
    };
  },
};
```

> **注意**：具体 `listExperimentsImpl` 的签名/返回值可能和上面不符。**先读 `src/lib/store.ts` 确认**，按实际签名调整 `call` 实现。字段名对齐现有 `Experiment` 类型。

- [ ] **Step 3: tsc 检查**

```bash
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/copilot/tools/list-experiments.ts
git commit -m "refactor(copilot): migrate list_experiments to ToolDescriptor"
```

---

## Task 1.4 · 迁移 read_experiment_results

**Files:**
- Create: `src/lib/copilot/tools/read-experiment-results.ts`

- [ ] **Step 1: 读现有 `read_experiment_results` 签名**

```bash
grep -n "read_experiment_results" src/lib/copilot/tools.ts
```

- [ ] **Step 2: 写新文件（**暂不加 aggregation**，M6 再补）**

```ts
// src/lib/copilot/tools/read-experiment-results.ts
import type { ToolDescriptor } from "./types";
import { readResultsJsonl } from "@/lib/store";

interface Input {
  experiment_id: string;
  task_ids?: string[];
  status?: "success" | "failed" | "running";
  limit?: number;
}

export const readExperimentResultsTool: ToolDescriptor<Input, unknown> = {
  name: "read_experiment_results",
  description: "Read task results from an experiment. Supports filtering by task_ids/status/limit.",
  inputSchema: {
    type: "object",
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["success", "failed", "running"] },
      limit: { type: "number" },
    },
    required: ["experiment_id"],
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,
  },
  call: async ({ experiment_id, task_ids, status, limit = 20 }) => {
    const all = await readResultsJsonl(experiment_id);
    let filtered = all;
    if (task_ids?.length) {
      const set = new Set(task_ids);
      filtered = filtered.filter((r) => set.has(r.task_id));
    }
    if (status) filtered = filtered.filter((r) => r.status === status);
    return { results: filtered.slice(0, limit), total: filtered.length };
  },
};
```

> **注意**：`readResultsJsonl` 名称可能不同。读代码对齐。

- [ ] **Step 3: tsc 检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/copilot/tools/read-experiment-results.ts
git commit -m "refactor(copilot): migrate read_experiment_results to ToolDescriptor"
```

---

## Task 1.5 · 迁移 restart_experiment

**Files:**
- Create: `src/lib/copilot/tools/restart-experiment.ts`

- [ ] **Step 1: 写新文件（`isDestructive: true`）**

```ts
// src/lib/copilot/tools/restart-experiment.ts
import type { ToolDescriptor } from "./types";
import { startBatch } from "@/lib/batch-runner";
import { readExperiment } from "@/lib/store";

interface Input {
  experiment_id: string;
  task_ids?: string[];
}

export const restartExperimentTool: ToolDescriptor<Input, { started: boolean }> = {
  name: "restart_experiment",
  description: "Restart an experiment or specific tasks. DESTRUCTIVE - requires user confirmation.",
  inputSchema: {
    type: "object",
    properties: {
      experiment_id: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
    },
    required: ["experiment_id"],
  },
  metadata: {
    isReadOnly: false,
    isDestructive: true,
    maxResultSizeChars: 500,
  },
  call: async ({ experiment_id, task_ids }) => {
    const cfg = await readExperiment(experiment_id);
    if (!cfg) throw new Error(`experiment ${experiment_id} not found`);
    await startBatch(cfg, true, undefined, task_ids);
    return { started: true };
  },
};
```

> **注意**：`startBatch` 签名可能不同（AGENTS.md 说 `startBatch(cfg, resume, concurrency, taskIds?)`），按实际调整。

- [ ] **Step 2: tsc 检查 + Commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/tools/restart-experiment.ts
git commit -m "refactor(copilot): migrate restart_experiment to ToolDescriptor (destructive)"
```

---

## Task 1.6 · 迁移 read_page

**Files:**
- Create: `src/lib/copilot/tools/read-page.ts`

- [ ] **Step 1: 写新文件**

```ts
// src/lib/copilot/tools/read-page.ts
import type { ToolDescriptor } from "./types";
import { getSnapshot } from "../snapshot-cache";  // M4 才实现，先 stub

interface Input {
  query: string;
}

export const readPageTool: ToolDescriptor<Input, unknown> = {
  name: "read_page",
  description: "Query the current page snapshot. Use to inspect the UI the user sees.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 3000,
  },
  call: async ({ query }, ctx) => {
    const snap = getSnapshot(ctx.session_id);
    if (!snap) return { found: false, reason: "no snapshot for this session yet" };
    return { query, snapshot_summary: snap };
  },
};
```

> **注意**：`snapshot-cache` 模块在 M4 实现。**本任务先 stub 一个 `src/lib/copilot/snapshot-cache.ts`** 返 `undefined`（防止 tsc 报缺模块）：

```ts
// src/lib/copilot/snapshot-cache.ts（stub）
export function getSnapshot(_session_id: string): unknown | undefined {
  return undefined;
}
export function setSnapshot(_session_id: string, _data: unknown): void {}
```

- [ ] **Step 2: tsc 检查 + Commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/tools/read-page.ts src/lib/copilot/snapshot-cache.ts
git commit -m "refactor(copilot): migrate read_page to ToolDescriptor + snapshot-cache stub"
```

---

## Task 1.7 · 建立 tool registry

**Files:**
- Create: `src/lib/copilot/tools/registry.ts`
- Test: `src/lib/copilot/tools/__tests__/registry.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/copilot/tools/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { TOOLS, toolByName } from "../registry";

describe("tool registry", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("toolByName lookup works", () => {
    for (const t of TOOLS) {
      expect(toolByName.get(t.name)).toBe(t);
    }
  });

  it("every tool has required metadata fields", () => {
    for (const t of TOOLS) {
      expect(typeof t.metadata.isReadOnly).toBe("boolean");
      expect(typeof t.metadata.isDestructive).toBe("boolean");
      expect(t.metadata.maxResultSizeChars).toBeGreaterThan(0);
    }
  });

  it("destructive tools are not marked read-only", () => {
    for (const t of TOOLS) {
      if (t.metadata.isDestructive) expect(t.metadata.isReadOnly).toBe(false);
    }
  });

  it("contains the 4 migrated tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("list_experiments");
    expect(names).toContain("read_experiment_results");
    expect(names).toContain("restart_experiment");
    expect(names).toContain("read_page");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/lib/copilot/tools/__tests__/registry.test.ts
```

Expected: FAIL `Cannot find module '../registry'`

- [ ] **Step 3: 实现**

```ts
// src/lib/copilot/tools/registry.ts
import type { ToolDescriptor } from "./types";
import { listExperimentsTool } from "./list-experiments";
import { readExperimentResultsTool } from "./read-experiment-results";
import { restartExperimentTool } from "./restart-experiment";
import { readPageTool } from "./read-page";

export const TOOLS: ReadonlyArray<ToolDescriptor> = [
  listExperimentsTool,
  readExperimentResultsTool,
  restartExperimentTool,
  readPageTool,
] as const;

export const toolByName = new Map(TOOLS.map((t) => [t.name, t] as const));
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
npx vitest run src/lib/copilot/tools/__tests__/registry.test.ts
git add src/lib/copilot/tools/registry.ts src/lib/copilot/tools/__tests__/registry.test.ts
git commit -m "feat(copilot): tool registry with 4 migrated tools"
```

---

## Task 1.8 · stream-response 走 registry

**Files:**
- Modify: `src/lib/copilot/stream-response.ts`（删除工具硬编 switch，改走 registry lookup）

- [ ] **Step 1: 找当前硬编位置**

```bash
grep -n "list_experiments\|read_experiment_results\|restart_experiment\|read_page" src/lib/copilot/stream-response.ts
```

- [ ] **Step 2: 改造 tool 调用入口（保留 pipeline 时序不变）**

替换形如 `switch (toolName) { case 'list_experiments': ... }` 的代码为：

```ts
import { toolByName } from "./tools/registry";

// ... 在 tool_use 处理处 ...
const tool = toolByName.get(tool_name);
if (!tool) {
  return writeToolResult(tool_call_id, { error: `unknown tool: ${tool_name}` });
}
const output = await tool.call(input, { session_id, signal });
return writeToolResult(tool_call_id, output);
```

保持原 tool_result 写入时序（preToolCall / postToolCall 要到 M2 再串入）。

- [ ] **Step 3: tsc + vitest（确保现有 copilot 相关 test 不破）**

```bash
npx tsc --noEmit
npx vitest run src/lib/copilot src/components/copilot
```

Expected: 全 PASS

- [ ] **Step 4: 删除旧的硬编 tools.ts 内工具实现（只保留被 stream-response import 的 shim，或整个删）**

> 如果 `src/lib/copilot/tools.ts` 里没有其他东西了，整文件删除；如果有工具以外的 util，保留 util。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(copilot): stream-response uses tool registry (no more hardcoded switch)"
```

---

## M1 验证点

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm test` 全通过（新增 ~10 test case）
- [ ] `npm run build` 成功
- [ ] 浏览器手测：`⌘K` 打开 copilot，圈选实验卡 → 问"列出最近的实验" → 观察是否正常返回（行为应与 refactor 前一致）

---

# M2 · Hooks 链路

目标：引入 `preToolCall` / `postToolCall` hook pipeline，把 Confirm 逻辑从 UI 搬到 metadata 驱动。

## Task 2.1 · 定义 hook 类型

**Files:**
- Create: `src/lib/copilot/tools/hooks.ts`

- [ ] **Step 1: 写类型与默认钩子**

```ts
// src/lib/copilot/tools/hooks.ts
import type { ToolDescriptor } from "./types";

export interface PreToolCallCtx {
  tool: ToolDescriptor;
  input: unknown;
  session_id: string;
}

export type PreToolCallResult =
  | { action: "proceed" }
  | { action: "require_confirm" }
  | { action: "deny"; reason: string };

export type PreToolCallHook = (ctx: PreToolCallCtx) => Promise<PreToolCallResult>;

export interface PostToolCallCtx {
  tool: ToolDescriptor;
  input: unknown;
  output: unknown;
  session_id: string;
}

export type PostToolCallResult = { output: unknown };
export type PostToolCallHook = (ctx: PostToolCallCtx) => Promise<PostToolCallResult>;

// ---- 内置 hooks ----

export const confirmGateHook: PreToolCallHook = async ({ tool }) => {
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive;
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" };
};

export const auditLogHook: PreToolCallHook = async () => ({ action: "proceed" });

export const telemetryHook: PostToolCallHook = async ({ output }) => ({ output });

export const preToolCallHooks: PreToolCallHook[] = [confirmGateHook, auditLogHook];
export const postToolCallHooks: PostToolCallHook[] = [telemetryHook];
```

- [ ] **Step 2: tsc + Commit**

```bash
npx tsc --noEmit
git add src/lib/copilot/tools/hooks.ts
git commit -m "feat(copilot): pre/postToolCall hook types + confirmGate default"
```

---

## Task 2.2 · 测试 confirmGateHook

**Files:**
- Test: `src/lib/copilot/tools/__tests__/hooks.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/copilot/tools/__tests__/hooks.test.ts
import { describe, it, expect } from "vitest";
import { confirmGateHook } from "../hooks";
import type { ToolDescriptor } from "../types";

function makeTool(metadata: ToolDescriptor["metadata"]): ToolDescriptor {
  return {
    name: "t",
    description: "",
    inputSchema: {},
    metadata,
    call: async () => ({}),
  };
}

describe("confirmGateHook", () => {
  it("read-only non-destructive → proceed", async () => {
    const tool = makeTool({ isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 });
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" });
    expect(r.action).toBe("proceed");
  });

  it("destructive → require_confirm", async () => {
    const tool = makeTool({ isReadOnly: false, isDestructive: true, maxResultSizeChars: 1000 });
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" });
    expect(r.action).toBe("require_confirm");
  });

  it("requiresConfirm: false overrides destructive", async () => {
    const tool = makeTool({
      isReadOnly: false, isDestructive: true, requiresConfirm: false, maxResultSizeChars: 1000,
    });
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" });
    expect(r.action).toBe("proceed");
  });

  it("requiresConfirm: true overrides non-destructive", async () => {
    const tool = makeTool({
      isReadOnly: true, isDestructive: false, requiresConfirm: true, maxResultSizeChars: 1000,
    });
    const r = await confirmGateHook({ tool, input: {}, session_id: "s" });
    expect(r.action).toBe("require_confirm");
  });
});
```

- [ ] **Step 2: 跑测试确认通过（实现已在 2.1 写了）**

```bash
npx vitest run src/lib/copilot/tools/__tests__/hooks.test.ts
```

Expected: PASS（4 tests）

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/tools/__tests__/hooks.test.ts
git commit -m "test(copilot): confirmGateHook metadata-driven matrix"
```

---

## Task 2.3 · runTool 主入口串 hooks

**Files:**
- Modify: `src/lib/copilot/tool-runtime.ts`

- [ ] **Step 1: 在 tool-runtime.ts 里新增 `runTool`**

```ts
// src/lib/copilot/tool-runtime.ts （append）
import type { ToolDescriptor, ToolContext, ToolCallRecord } from "./tools/types";
import { preToolCallHooks, postToolCallHooks } from "./tools/hooks";
import type { PreToolCallResult } from "./tools/hooks";

export type RunToolResult =
  | { kind: "done"; output: unknown }
  | { kind: "awaiting_confirm" }
  | { kind: "denied"; reason: string };

export async function runTool(
  tool: ToolDescriptor,
  input: unknown,
  ctx: ToolContext,
  opts: { skipConfirm?: boolean } = {},
): Promise<RunToolResult> {
  if (!opts.skipConfirm) {
    for (const hook of preToolCallHooks) {
      const r = await hook({ tool, input, session_id: ctx.session_id });
      if (r.action === "deny") return { kind: "denied", reason: r.reason };
      if (r.action === "require_confirm") return { kind: "awaiting_confirm" };
    }
  }

  let output = await tool.call(input, ctx);
  for (const hook of postToolCallHooks) {
    const r = await hook({ tool, input, output, session_id: ctx.session_id });
    output = r.output;
  }
  return { kind: "done", output };
}
```

- [ ] **Step 2: 写 runTool 的集成测试**

Test file: `src/lib/copilot/__tests__/tool-runtime-integration.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { runTool } from "../tool-runtime";
import type { ToolDescriptor } from "../tools/types";

const readTool: ToolDescriptor = {
  name: "r", description: "", inputSchema: {},
  metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
};

const writeTool: ToolDescriptor = {
  name: "w", description: "", inputSchema: {},
  metadata: { isReadOnly: false, isDestructive: true, maxResultSizeChars: 100 },
  call: async () => ({ ok: 1 }),
};

const signal = new AbortController().signal;

describe("runTool", () => {
  it("read tool runs through", async () => {
    const r = await runTool(readTool, {}, { session_id: "s", signal });
    expect(r.kind).toBe("done");
  });

  it("write tool awaiting_confirm", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal });
    expect(r.kind).toBe("awaiting_confirm");
  });

  it("write tool with skipConfirm runs", async () => {
    const r = await runTool(writeTool, {}, { session_id: "s", signal }, { skipConfirm: true });
    expect(r.kind).toBe("done");
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
npx vitest run src/lib/copilot/__tests__/tool-runtime-integration.test.ts
```

Expected: PASS（3 tests）

- [ ] **Step 4: Commit**

```bash
git add src/lib/copilot/tool-runtime.ts src/lib/copilot/__tests__/tool-runtime-integration.test.ts
git commit -m "feat(copilot): runTool pipeline with hook dispatch + skipConfirm escape"
```

---

## Task 2.4 · stream-response 用 runTool 替换直接 call

**Files:**
- Modify: `src/lib/copilot/stream-response.ts`
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`

- [ ] **Step 1: 改 stream-response.ts**

找到 1.8 任务里 `const output = await tool.call(input, ...)` 的位置，改为：

```ts
import { runTool } from "./tool-runtime";

const result = await runTool(tool, input, { session_id, signal });
if (result.kind === "awaiting_confirm") {
  // 不执行 tool，只 emit tool_use_end，等前端 Confirm 后走 /tool-result 路由
  return writeToolUseEnd(tool_call_id, tool_name, input);
}
if (result.kind === "denied") {
  return writeToolResult(tool_call_id, { error: `denied: ${result.reason}` });
}
return writeToolResult(tool_call_id, result.output);
```

- [ ] **Step 2: 改 /tool-result route（用户 Confirm 后走这里 → 需 skipConfirm）**

```ts
// src/app/api/copilot/sessions/[id]/tool-result/route.ts 内部
const result = await runTool(tool, input, { session_id, signal }, { skipConfirm: true });
```

- [ ] **Step 3: tsc + 全 vitest**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 4: 浏览器手测 `restart_experiment` → 弹 Confirm，`list_experiments` → 直接跑**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(copilot): route tool calls through runTool (Confirm gate from metadata)"
```

---

## M2 验证点

- [ ] `tsc`、`npm test` 全通过
- [ ] 浏览器手测：`restart_experiment` 触发 Confirm 弹窗，非 destructive 工具直接执行

---

# M3 · Tool result 护栏

目标：超过 `maxResultSizeChars` 的 tool result 自动落盘到 `data/copilot/tool-results/{session}/`，transcript 只留 preview + ref。新增 `read_tool_result` 工具拉回。

## Task 3.1 · CopilotMessage ToolResultContent 类型升级

**Files:**
- Modify: `src/lib/copilot/types.ts`

- [ ] **Step 1: 加新类型，不破坏旧类型**

找到 `CopilotMessage` 定义，加入：

```ts
export type ToolResultContent =
  | { kind: "inline"; value: unknown }
  | { kind: "ref"; ref: string; preview: string }
  | { kind: "compacted"; summary: string; ref?: string };

// CopilotMessage 里 role==="tool" 的 content 改为 ToolResultContent | unknown（兼容旧）
```

> 旧数据里 `content` 是裸 output object。读取时用 `normalizeToolResult()` 统一成 `ToolResultContent`（见 Task 3.2）。

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/types.ts
git commit -m "feat(copilot): ToolResultContent three-state union type"
```

---

## Task 3.2 · session-store 读旧格式兼容

**Files:**
- Modify: `src/lib/copilot/session-store.ts`
- Test: `src/lib/copilot/__tests__/session-store-compat.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from "vitest";
import { normalizeToolResult } from "../session-store";

describe("normalizeToolResult", () => {
  it("wraps bare output as inline", () => {
    const bare = { a: 1 };
    expect(normalizeToolResult(bare)).toEqual({ kind: "inline", value: bare });
  });

  it("preserves already-shaped inline", () => {
    const content = { kind: "inline" as const, value: { b: 2 } };
    expect(normalizeToolResult(content)).toBe(content);
  });

  it("preserves ref shape", () => {
    const content = { kind: "ref" as const, ref: "ref://tool-result/x", preview: "..." };
    expect(normalizeToolResult(content)).toBe(content);
  });

  it("preserves compacted shape", () => {
    const content = { kind: "compacted" as const, summary: "...", ref: "x" };
    expect(normalizeToolResult(content)).toBe(content);
  });
});
```

- [ ] **Step 2: 跑失败**

```bash
npx vitest run src/lib/copilot/__tests__/session-store-compat.test.ts
```

- [ ] **Step 3: 加 `normalizeToolResult` export 到 session-store.ts**

```ts
// src/lib/copilot/session-store.ts（append export）
import type { ToolResultContent } from "./types";

export function normalizeToolResult(content: unknown): ToolResultContent {
  if (content && typeof content === "object" && "kind" in content) {
    const k = (content as { kind: unknown }).kind;
    if (k === "inline" || k === "ref" || k === "compacted") return content as ToolResultContent;
  }
  return { kind: "inline", value: content };
}
```

- [ ] **Step 4: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/__tests__/session-store-compat.test.ts
git add src/lib/copilot/session-store.ts src/lib/copilot/__tests__/session-store-compat.test.ts
git commit -m "feat(copilot): normalizeToolResult for backward compat"
```

---

## Task 3.3 · maybePersistToolResult 落盘

**Files:**
- Create: `src/lib/copilot/tool-result-store.ts`
- Test: `src/lib/copilot/__tests__/tool-result-store.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { maybePersistToolResult, loadPersistedToolResult } from "../tool-result-store";

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-result-"));
  process.chdir(testDir);
});

describe("maybePersistToolResult", () => {
  it("inline when small", async () => {
    const r = await maybePersistToolResult("sess_1", { a: 1 }, 1000);
    expect(r.kind).toBe("inline");
  });

  it("ref when large", async () => {
    const big = { body: "x".repeat(5000) };
    const r = await maybePersistToolResult("sess_1", big, 1000);
    expect(r.kind).toBe("ref");
    if (r.kind === "ref") {
      expect(r.ref).toMatch(/^ref:\/\/tool-result\/tr_/);
      expect(r.preview.length).toBeLessThan(600);
    }
  });

  it("loadPersistedToolResult retrieves round-trip", async () => {
    const big = { body: "y".repeat(5000) };
    const r = await maybePersistToolResult("sess_1", big, 1000);
    expect(r.kind).toBe("ref");
    if (r.kind === "ref") {
      const loaded = await loadPersistedToolResult("sess_1", r.ref);
      expect(loaded).toEqual(big);
    }
  });
});
```

- [ ] **Step 2: 跑失败 → 实现**

```ts
// src/lib/copilot/tool-result-store.ts
import fs from "node:fs/promises";
import path from "node:path";
import { customAlphabet } from "nanoid";
import type { ToolResultContent } from "./types";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

function storeDir(session_id: string): string {
  return path.join(process.cwd(), "data", "copilot", "tool-results", session_id);
}

export async function maybePersistToolResult(
  session_id: string,
  output: unknown,
  maxSize: number,
): Promise<ToolResultContent> {
  const serialized = JSON.stringify(output);
  if (serialized.length <= maxSize) {
    return { kind: "inline", value: output };
  }
  const id = `tr_${nanoid()}`;
  const dir = storeDir(session_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), serialized);
  const preview = serialized.slice(0, 500) + "...(truncated)";
  return { kind: "ref", ref: `ref://tool-result/${id}`, preview };
}

export async function loadPersistedToolResult(
  session_id: string,
  ref: string,
): Promise<unknown> {
  const m = ref.match(/^ref:\/\/tool-result\/(.+)$/);
  if (!m) throw new Error(`invalid ref: ${ref}`);
  const id = m[1];
  const file = path.join(storeDir(session_id), `${id}.json`);
  const text = await fs.readFile(file, "utf-8");
  return JSON.parse(text);
}
```

**Package check**: 如果 `nanoid` 不在依赖里：`grep "nanoid" package.json`。如果缺 → 用 `crypto.randomUUID()` 改写：

```ts
const id = `tr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
```

- [ ] **Step 3: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/__tests__/tool-result-store.test.ts
git add src/lib/copilot/tool-result-store.ts src/lib/copilot/__tests__/tool-result-store.test.ts
git commit -m "feat(copilot): maybePersistToolResult + loadPersistedToolResult"
```

---

## Task 3.4 · payloadGuardHook 串入 postToolCall

**Files:**
- Modify: `src/lib/copilot/tools/hooks.ts`

- [ ] **Step 1: 加 hook 实现**

```ts
// src/lib/copilot/tools/hooks.ts（append）
import { maybePersistToolResult } from "../tool-result-store";

export const payloadGuardHook: PostToolCallHook = async ({ tool, output, session_id }) => {
  const normalized = await maybePersistToolResult(
    session_id, output, tool.metadata.maxResultSizeChars,
  );
  return { output: normalized };
};

// 替换 postToolCallHooks
export const postToolCallHooks: PostToolCallHook[] = [payloadGuardHook, telemetryHook];
```

> `payloadGuardHook` 产出的 `output` 已经是 `ToolResultContent` 形态，不是裸值。下游 stream-response 把它直接作为 tool_result content 写入 transcript。

- [ ] **Step 2: 更新 runTool 集成测试覆盖落盘路径**

在 `src/lib/copilot/__tests__/tool-runtime-integration.test.ts` 加：

```ts
it("large output → ref via payloadGuard", async () => {
  const bigReadTool: ToolDescriptor = {
    name: "br", description: "", inputSchema: {},
    metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 100 },
    call: async () => ({ body: "x".repeat(500) }),
  };
  const r = await runTool(bigReadTool, {}, { session_id: "sess_test", signal });
  expect(r.kind).toBe("done");
  if (r.kind === "done") {
    expect((r.output as { kind: string }).kind).toBe("ref");
  }
});
```

> 注意：此 test 会落盘到 cwd 下，保证 cwd 是 tmp。参考 task 3.3 的 beforeEach。**加 beforeEach chdir 到 tmpdir**。

- [ ] **Step 3: 跑测试通过 + Commit**

```bash
npx vitest run src/lib/copilot
git add -A
git commit -m "feat(copilot): payloadGuardHook auto-persists large tool results"
```

---

## Task 3.5 · read_tool_result 工具

**Files:**
- Create: `src/lib/copilot/tools/read-tool-result.ts`
- Modify: `src/lib/copilot/tools/registry.ts`

- [ ] **Step 1: 实现工具**

```ts
// src/lib/copilot/tools/read-tool-result.ts
import type { ToolDescriptor } from "./types";
import { loadPersistedToolResult } from "../tool-result-store";

export const readToolResultTool: ToolDescriptor<{ ref: string }, unknown> = {
  name: "read_tool_result",
  description: "Retrieve a previously persisted tool result by its ref (format: ref://tool-result/tr_xxx).",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 8000,
  },
  call: async ({ ref }, ctx) => {
    return loadPersistedToolResult(ctx.session_id, ref);
  },
};
```

- [ ] **Step 2: 注册到 registry**

```ts
// src/lib/copilot/tools/registry.ts 修改
import { readToolResultTool } from "./read-tool-result";

export const TOOLS = [
  listExperimentsTool,
  readExperimentResultsTool,
  restartExperimentTool,
  readPageTool,
  readToolResultTool,
] as const;
```

- [ ] **Step 3: registry test 补一条断言**

```ts
it("contains read_tool_result", () => {
  expect(TOOLS.map((t) => t.name)).toContain("read_tool_result");
});
```

- [ ] **Step 4: 测 + Commit**

```bash
npx vitest run src/lib/copilot
git add -A
git commit -m "feat(copilot): read_tool_result tool to retrieve persisted refs"
```

---

## Task 3.6 · build-llm-messages 处理 ref 形 content

**Files:**
- Modify: `src/lib/copilot/build-llm-messages.ts`

- [ ] **Step 1: 找 tool_result 消息转换为 LLM 可见 content 的位置**

```bash
grep -n "tool_result\|tool_use" src/lib/copilot/build-llm-messages.ts
```

- [ ] **Step 2: 让 `ref` 形态对 LLM 展示 preview，不是 ref URL**

```ts
// build-llm-messages.ts 里 tool_result 处理
import { normalizeToolResult } from "./session-store";

// ... 把 messages 里 role==="tool" 的 content normalize：
const content = normalizeToolResult(msg.content);
let visibleContent: string;
if (content.kind === "inline") {
  visibleContent = JSON.stringify(content.value);
} else if (content.kind === "ref") {
  visibleContent = `${content.preview}\n\n[Full result available via read_tool_result(ref="${content.ref}")]`;
} else {
  // compacted
  visibleContent = content.summary;
}
// 把 visibleContent 塞到 LLM tool_result message 里
```

- [ ] **Step 3: tsc + test**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 4: 浏览器手测：触发一个会返回大 payload 的查询，确认 transcript 里 tool_result 是 ref 形态 + LLM 能继续对话**

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/build-llm-messages.ts
git commit -m "feat(copilot): build-llm-messages renders ref'd tool results as preview + hint"
```

---

## M3 验证点

- [ ] 跑一次大 payload 查询（比如 `read_experiment_results` 返回 30 条 task），观察 `data/copilot/tool-results/{session_id}/` 出现 `.json` 文件
- [ ] `npm test` 全过
- [ ] 浏览器手测无回归

---

# M4 · Context 分层 + read_resource

目标：system header 恒定小（只 ref + summary），snapshot 服务端缓存，引入 `read_context(id, scope)` 和 `read_resource(type, id, fields?)` 两个工具。

## Task 4.1 · 定义 SystemHeader 类型 + 纯函数

**Files:**
- Create: `src/lib/copilot/system-header.ts`
- Test: `src/lib/copilot/__tests__/system-header.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from "vitest";
import { buildSystemHeader, shouldInlineContext } from "../system-header";
import type { CapturedContext } from "../types";

describe("buildSystemHeader", () => {
  it("produces route_type + path + active_contexts", () => {
    const header = buildSystemHeader({
      route_type: "compare", path: "/compare",
      contexts: [
        { id: "ctx_1", type: "experiment", ref: "exp_A", summary: "Exp A" } as CapturedContext,
      ],
    });
    expect(header.route_type).toBe("compare");
    expect(header.active_contexts).toHaveLength(1);
    expect(header.active_contexts[0].id).toBe("ctx_1");
  });

  it("drops inline field when context is ref-only", () => {
    const header = buildSystemHeader({
      route_type: "r", path: "/p",
      contexts: [
        { id: "ctx_1", type: "experiment", ref: "exp_A", summary: "..." } as CapturedContext,
      ],
    });
    expect(header.active_contexts[0].inline).toBeUndefined();
  });
});

describe("shouldInlineContext", () => {
  const limits = { maxContexts: 3, maxTokensPerContext: 1000, maxTotalTokens: 2000 };

  it("inlines when count ≤ maxContexts and size OK", () => {
    const ctx = { serialized_tokens: 500 };
    expect(shouldInlineContext(ctx, 1, 500, limits)).toBe(true);
  });

  it("blocks inline when count > maxContexts", () => {
    const ctx = { serialized_tokens: 500 };
    expect(shouldInlineContext(ctx, 5, 500, limits)).toBe(false);
  });

  it("blocks inline when single context > per-context limit", () => {
    const ctx = { serialized_tokens: 1500 };
    expect(shouldInlineContext(ctx, 2, 0, limits)).toBe(false);
  });

  it("blocks inline when accumulated > total limit", () => {
    const ctx = { serialized_tokens: 500 };
    expect(shouldInlineContext(ctx, 2, 1700, limits)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑失败 → 实现**

```ts
// src/lib/copilot/system-header.ts
import type { CapturedContext } from "./types";

export interface InlineLimits {
  maxContexts: number;
  maxTokensPerContext: number;
  maxTotalTokens: number;
}

export const DEFAULT_INLINE_LIMITS: InlineLimits = {
  maxContexts: 3,
  maxTokensPerContext: 1000,
  maxTotalTokens: 2000,
};

export interface SystemHeader {
  route_type: string;
  path: string;
  active_contexts: Array<{
    id: string;
    type: string;
    ref: string;
    summary: string;
    within?: Record<string, string>;
    inline?: unknown;
  }>;
}

export function shouldInlineContext(
  ctx: { serialized_tokens: number },
  currentCount: number,
  accumulatedTokens: number,
  limits: InlineLimits,
): boolean {
  if (currentCount > limits.maxContexts) return false;
  if (ctx.serialized_tokens > limits.maxTokensPerContext) return false;
  if (accumulatedTokens + ctx.serialized_tokens > limits.maxTotalTokens) return false;
  return true;
}

export function buildSystemHeader(args: {
  route_type: string;
  path: string;
  contexts: CapturedContext[];
}): SystemHeader {
  return {
    route_type: args.route_type,
    path: args.path,
    active_contexts: args.contexts.map((c) => ({
      id: c.id,
      type: c.type,
      ref: (c as { ref?: string }).ref ?? c.context_id,
      summary: c.summary ?? "",
      within: (c as { ancestors?: Record<string, string> }).ancestors,
    })),
  };
}
```

> `CapturedContext` 的实际字段按现有 `src/lib/copilot/types.ts` 的 `context_id` / `ancestors` / etc 取名对齐。**读现有类型再填准确字段**。

- [ ] **Step 3: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/__tests__/system-header.test.ts
git add src/lib/copilot/system-header.ts src/lib/copilot/__tests__/system-header.test.ts
git commit -m "feat(copilot): buildSystemHeader + inline threshold predicate"
```

---

## Task 4.2 · snapshot-cache 服务端化

**Files:**
- Modify: `src/lib/copilot/snapshot-cache.ts`（之前是 stub）

- [ ] **Step 1: 实现**

```ts
// src/lib/copilot/snapshot-cache.ts
interface Snapshot {
  data: unknown;
  updated_at: number;
}

const cache = new Map<string, Snapshot>();

export function setSnapshot(session_id: string, data: unknown): void {
  cache.set(session_id, { data, updated_at: Date.now() });
}

export function getSnapshot(session_id: string): unknown | undefined {
  return cache.get(session_id)?.data;
}

export function clearSnapshot(session_id: string): void {
  cache.delete(session_id);
}
```

- [ ] **Step 2: /chat route 调用 setSnapshot，不 append 到 transcript**

```ts
// src/app/api/copilot/sessions/[id]/chat/route.ts
import { setSnapshot } from "@/copilot/lib/snapshot-cache";

// 在处理请求前：
if (body.client_snapshot) {
  setSnapshot(session_id, body.client_snapshot);
}
// 不要把 client_snapshot push 到 messages / transcript
```

- [ ] **Step 3: /tool-result route 同改**

- [ ] **Step 4: grep 确认没地方再把 snapshot 塞进 transcript**

```bash
grep -rn "client_snapshot" src/app/api/copilot src/lib/copilot
```

若有把它 append 到 messages 的遗漏，删掉。

- [ ] **Step 5: tsc + test + Commit**

```bash
npx tsc --noEmit
npm test
git add -A
git commit -m "feat(copilot): snapshot lives in server cache, not transcript"
```

---

## Task 4.3 · read_context 工具（带 scope）

**Files:**
- Create: `src/lib/copilot/tools/read-context.ts`
- Modify: `src/lib/copilot/tools/registry.ts`

- [ ] **Step 1: 读 contexts/resolve 现有逻辑对齐返回结构**

```bash
grep -n "resolve" src/app/api/copilot/contexts/resolve/route.ts
cat src/lib/copilot/resolve-context.ts | head -80
```

- [ ] **Step 2: 实现 read_context**

```ts
// src/lib/copilot/tools/read-context.ts
import type { ToolDescriptor } from "./types";
import { resolveContextById } from "@/copilot/lib/resolve-context";

type Scope = "self" | "parent" | "full";

interface Input {
  id: string;
  scope?: Scope;
}

function defaultScope(type: string): Scope {
  return "self";  // 所有 type 默认 self
}

export const readContextTool: ToolDescriptor<Input, unknown> = {
  name: "read_context",
  description:
    "Fetch details of a user-picked context (chip #N). Use scope='parent' for surrounding data " +
    "(e.g. task_field's parent scope returns the whole task_result with input/output/metrics).",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      scope: { type: "string", enum: ["self", "parent", "full"] },
    },
    required: ["id"],
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,
  },
  call: async ({ id, scope }, ctx) => {
    const resolved = await resolveContextById(ctx.session_id, id);
    if (!resolved) throw new Error(`context ${id} not found in session`);
    const useScope = scope ?? defaultScope(resolved.type);
    if (useScope === "self") return resolved.self_value;
    if (useScope === "parent") return resolved.parent_value ?? resolved.self_value;
    return resolved.full_value ?? resolved.parent_value ?? resolved.self_value;
  },
};
```

> **重要**：`resolveContextById` 的新签名（返回 `{self_value, parent_value?, full_value?}`）**还没实现**。本任务先写 tool 骨架 + stub `resolve-context.ts` 加 `resolveContextById`：

```ts
// src/lib/copilot/resolve-context.ts（append export）
export async function resolveContextById(
  session_id: string, ctx_id: string,
): Promise<null | { type: string; self_value: unknown; parent_value?: unknown; full_value?: unknown }> {
  // TODO M4.4: 按 type 路由到具体 resolver
  return null;
}
```

- [ ] **Step 3: 注册到 registry**

```ts
// src/lib/copilot/tools/registry.ts
import { readContextTool } from "./read-context";
export const TOOLS = [...existing, readContextTool] as const;
```

- [ ] **Step 4: tsc + Commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(copilot): read_context tool skeleton with scope parameter"
```

---

## Task 4.4 · 实现 resolveContextById per-type resolver

**Files:**
- Modify: `src/lib/copilot/resolve-context.ts`
- Test: `src/lib/copilot/__tests__/resolve-context.test.ts`

- [ ] **Step 1: 看已有 resolver 实现**

```bash
grep -n "^export\|^function" src/lib/copilot/resolve-context.ts
```

**现有的 resolve 接受整个 contexts 数组，返回 markdown system_message。我们要补的是 per-id + per-scope 版本。**

- [ ] **Step 2: 写测试（mock 文件系统）**

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveContextById } from "../resolve-context";

vi.mock("@/lib/store", () => ({
  readExperiment: vi.fn(async (id: string) =>
    id === "exp_A" ? { id: "exp_A", schema_id: "schema_X", name: "Exp A" } : null,
  ),
  readResultsJsonl: vi.fn(async () => [
    { task_id: "task_A1", input: { product: "tea" }, output: { answer: "great!" } },
  ]),
}));

// 同样 mock session 的 context 存储（根据实际实现）

describe("resolveContextById", () => {
  it.todo("task_field self returns field value only");
  it.todo("task_field parent returns full task");
  it.todo("experiment self returns meta");
  it.todo("returns null for unknown ctx_id");
});
```

> `.todo` 先留位，本任务专注 resolver 实现。

- [ ] **Step 3: 实现 resolver**

```ts
// src/lib/copilot/resolve-context.ts（改写 resolveContextById）
import { readExperiment, readResultsJsonl } from "@/lib/store";
import { getSessionContext } from "./session-store";  // 假设有这个

export async function resolveContextById(
  session_id: string, ctx_id: string,
): Promise<null | { type: string; self_value: unknown; parent_value?: unknown; full_value?: unknown }> {
  const ctx = await getSessionContext(session_id, ctx_id);
  if (!ctx) return null;

  switch (ctx.type) {
    case "task_field": {
      const results = await readResultsJsonl(ctx.extra?.experiment_id);
      const task = results.find((r: { task_id: string }) => r.task_id === ctx.extra?.task_id);
      if (!task) return { type: ctx.type, self_value: null };
      const fieldValue = getByPath(task, ctx.context_id);  // 形如 "output.answer"
      return {
        type: ctx.type,
        self_value: { targeted_field: ctx.context_id, targeted_value: fieldValue },
        parent_value: { targeted_field: ctx.context_id, targeted_value: fieldValue, task },
      };
    }
    case "task_result": {
      const results = await readResultsJsonl(ctx.extra?.experiment_id);
      const task = results.find((r: { task_id: string }) => r.task_id === ctx.context_id);
      return { type: ctx.type, self_value: task };
    }
    case "experiment": {
      const exp = await readExperiment(ctx.context_id);
      return { type: ctx.type, self_value: exp };
    }
    // text_selection / template / dataset / display / rubric / rubric_stats
    default:
      return { type: ctx.type, self_value: ctx };
  }
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => {
    if (o && typeof o === "object") return (o as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}
```

> **注意**：
> - `getSessionContext(session_id, ctx_id)` 可能不存在 — 若不存在，在 session-store.ts 加一个读 session 里 active_contexts 的函数。
> - `ctx.extra`、`ctx.context_id` 字段名要和 `CapturedContext` 实际一致。
> - 其他 type（template/dataset/display/rubric/rubric_stats/text_selection）可先只返 `self_value: ctx`，M6 或者更后再补；**不得 throw**。

- [ ] **Step 4: 把 `.todo` 测试实际写出并通过**

```ts
it("task_field self returns only field value", async () => {
  // mock session ctx with type=task_field, context_id="output.answer", extra={experiment_id:"exp_A", task_id:"task_A1"}
  const r = await resolveContextById("s", "ctx_1");
  expect(r?.self_value).toMatchObject({ targeted_field: "output.answer" });
  expect((r?.self_value as any).task).toBeUndefined();
});

it("task_field parent returns with full task", async () => {
  const r = await resolveContextById("s", "ctx_1");
  expect(r?.parent_value).toMatchObject({ task: { task_id: "task_A1" } });
});
```

- [ ] **Step 5: Commit**

```bash
npx vitest run src/lib/copilot/__tests__/resolve-context.test.ts
git add -A
git commit -m "feat(copilot): resolveContextById with per-type scope resolvers"
```

---

## Task 4.5 · read_resource 工具

**Files:**
- Create: `src/lib/copilot/tools/read-resource.ts`
- Test: `src/lib/copilot/tools/__tests__/read-resource.test.ts`
- Modify: `src/lib/copilot/tools/registry.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { readResourceTool } from "../read-resource";

vi.mock("@/lib/store", () => ({
  readExperiment: async (id: string) => id === "exp_A" ? { id, schema_id: "sch", model_name: "gpt-4o", extra: "ignored" } : null,
}));

const ctx = { session_id: "s", signal: new AbortController().signal };

describe("readResourceTool", () => {
  it("returns whole resource when no fields specified", async () => {
    const r = await readResourceTool.call({ type: "experiment", id: "exp_A" }, ctx) as Record<string, unknown>;
    expect(r.id).toBe("exp_A");
    expect(r.extra).toBe("ignored");
  });

  it("fields filter picks subset only", async () => {
    const r = await readResourceTool.call(
      { type: "experiment", id: "exp_A", fields: ["schema_id", "model_name"] }, ctx,
    ) as Record<string, unknown>;
    expect(r).toEqual({ schema_id: "sch", model_name: "gpt-4o" });
    expect(r.extra).toBeUndefined();
  });

  it("throws on missing resource", async () => {
    await expect(readResourceTool.call({ type: "experiment", id: "nope" }, ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑失败 → 实现**

```ts
// src/lib/copilot/tools/read-resource.ts
import type { ToolDescriptor } from "./types";
import { readExperiment, readSchema, readDataset, readDisplay, readRubric } from "@/lib/store";

type ResourceType = "experiment" | "template" | "dataset" | "display" | "rubric";

interface Input {
  type: ResourceType;
  id: string;
  fields?: string[];
}

async function loadResource(type: ResourceType, id: string): Promise<unknown> {
  switch (type) {
    case "experiment": return readExperiment(id);
    case "template":   return readSchema(id);
    case "dataset":    return readDataset(id);
    case "display":    return readDisplay(id);
    case "rubric":     return readRubric(id);
  }
}

function pickFields(obj: unknown, fields: string[]): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const src = obj as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f, src[f]]).filter(([, v]) => v !== undefined));
}

export const readResourceTool: ToolDescriptor<Input, unknown> = {
  name: "read_resource",
  description: "Fetch a specific platform resource (experiment/template/dataset/display/rubric) by id. Use fields to subset. Use when active_contexts doesn't cover what you need.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["experiment", "template", "dataset", "display", "rubric"] },
      id: { type: "string" },
      fields: { type: "array", items: { type: "string" } },
    },
    required: ["type", "id"],
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 4000,
  },
  call: async ({ type, id, fields }) => {
    const res = await loadResource(type, id);
    if (!res) throw new Error(`${type}/${id} not found`);
    return fields ? pickFields(res, fields) : res;
  },
};
```

> **注意**：`readSchema` / `readDataset` / `readDisplay` / `readRubric` 的实际 export 名按现有代码库调整。参考 `src/lib/schema/index.ts` / `src/lib/datasets.ts` / `src/lib/displays.ts` / `src/lib/rubric-store.ts`。

- [ ] **Step 3: 注册 + 测 + Commit**

```ts
// registry.ts
import { readResourceTool } from "./read-resource";
export const TOOLS = [...existing, readResourceTool] as const;
```

```bash
npx vitest run src/lib/copilot
git add -A
git commit -m "feat(copilot): read_resource tool for LLM-initiated resource lookup"
```

---

## Task 4.6 · build-llm-messages 用新 SystemHeader

**Files:**
- Modify: `src/lib/copilot/build-llm-messages.ts`

- [ ] **Step 1: 在组装 system prompt 的位置，用 buildSystemHeader 代替原 markdown 拼接**

```ts
// build-llm-messages.ts 主路径
import { buildSystemHeader } from "./system-header";

// ... 原来可能是：
// const systemMsg = formatContextsForLlm(contexts)  // 拼整段 markdown 塞 system
// 改为：
const header = buildSystemHeader({
  route_type: session.route_type ?? "unknown",
  path: session.path ?? "",
  contexts: session.active_contexts ?? [],
});

const systemMessages = [
  { role: "system", content: COPILOT_SYSTEM_PROMPT },
  { role: "system", content: "Session context:\n" + JSON.stringify(header, null, 2) },
];
```

> **保留** `COPILOT_SYSTEM_PROMPT`（固定 prompt）作为第一段。第二段从"完整 context markdown"改为"JSON 形 SystemHeader"。

- [ ] **Step 2: 删除老 `formatContextsForLlm` 的调用路径（但函数可保留以供 contexts/resolve API 向后兼容返回 system_message 字段）**

- [ ] **Step 3: tsc + vitest + 浏览器手测**

确认：
- 圈选 → 新消息 → LLM 回复不再包含"看到 context markdown 全文"的错觉行为
- LLM 能正常调 `read_context(ctx_1)` 拉细节

- [ ] **Step 4: Commit**

```bash
git add src/lib/copilot/build-llm-messages.ts
git commit -m "feat(copilot): system header uses compact JSON, not inline markdown"
```

---

## M4 验证点

- [ ] `npm test` 全过
- [ ] 浏览器手测：圈选 task_field → 问问题 → 观察 network tab 发给 LLM 的 system prompt 是 JSON header 而非大段 markdown
- [ ] `read_context(ctx_1, scope="parent")` 返回带 parent 数据
- [ ] `read_resource(type="experiment", id="xxx", fields=["schema_id"])` 返回单字段

---

# M5 · UI 规格

目标：删除"预览 LLM 将看到的 context"面板，chip 本身 expand 详情，tool-call-card 按类型分渲染。

## Task 5.1 · 删除 preview 折叠面板

**Files:**
- Modify: `src/components/copilot/context-chip-rail.tsx`
- Modify: `src/components/copilot/chat-view.tsx`
- Modify: `src/lib/i18n/zh.ts` + `en.ts`

- [ ] **Step 1: context-chip-rail.tsx**

删除：
- `previewOpen` state
- 按钮 `{ctxPreview && (<button onClick={...}>{previewOpen ? "▾" : "▸"} {t("copilot.preview_system_message")}</button>)}`
- 展开面板 `{previewOpen && ctxPreview && ( ... <MarkdownBody text={ctxPreview} /> ... )}`

- [ ] **Step 2: chat-view.tsx**

删除：
- `ctxPreview` state 声明
- 计算 `setCtxPreview` 的 useEffect
- 传给 ContextChipRail 的 `ctxPreview` prop

修改 ContextChipRail 的 props 定义删除 `ctxPreview` 字段。

- [ ] **Step 3: i18n**

在 `zh.ts` + `en.ts` 删除 key：
```
"copilot.preview_system_message": ...
```

- [ ] **Step 4: 检查 globals.css 里 `.copilot-preview-md` 是否只被此面板使用**

```bash
grep -rn "copilot-preview-md" src/
```

若只此处用，从 `src/app/globals.css` 删除。

- [ ] **Step 5: tsc + test + 浏览器手测（确认面板不见了但 chip 还在）**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(copilot): remove 'preview LLM will see' panel (semantically wrong in v2)"
```

---

## Task 5.2 · chip expand 详情

**Files:**
- Modify: `src/components/copilot/context-chip-rail.tsx`
- Modify: `src/lib/i18n/zh.ts` + `en.ts`

- [ ] **Step 1: 加新 i18n key**

```ts
// zh.ts
"copilot.chip.expand_detail": "查看详情",
"copilot.chip.loading": "加载中...",
"copilot.chip.within": "位于",
"copilot.chip.value_label": "内容",
"copilot.chip.metadata_label": "元数据",
```

英文对称。

- [ ] **Step 2: chip 改造**

```tsx
// context-chip-rail.tsx 里 chip 渲染
function ContextChip({ ctx, onRemove }: { ctx: CapturedContext; onRemove: () => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ResolvedDetail | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadDetail() {
    if (detail) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/copilot/contexts/${ctx.id}/resolve`);
      setDetail(await r.json());
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand() {
    setExpanded((v) => {
      if (!v) loadDetail();
      return !v;
    });
  }

  return (
    <div className="chip">
      <button onClick={toggleExpand} className="chip-body">
        #{ctx.number} {ctx.type} {ctx.summary}
        {ctx.within && <span className="chip-within">└ {t("copilot.chip.within")} {formatWithin(ctx.within)}</span>}
      </button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={t("copilot.context_tag_remove")}>×</button>

      {expanded && (
        <div className="chip-detail">
          {loading && <p>{t("copilot.chip.loading")}</p>}
          {detail && (
            <>
              <div><strong>{t("copilot.chip.value_label")}</strong>: <pre>{JSON.stringify(detail.self_value, null, 2)}</pre></div>
              <div><strong>{t("copilot.chip.metadata_label")}</strong>: {JSON.stringify(detail.metadata)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

> 细节样式按项目 shadcn + Tailwind 现有风格写；**不玻璃化（panel 内部不走 glass 体系，见 AGENTS.md Copilot 约定）**。

- [ ] **Step 3: 加 per-id resolve API endpoint（如果不存在）**

```ts
// src/app/api/copilot/contexts/[ctx_id]/resolve/route.ts（新建）
import { resolveContextById } from "@/copilot/lib/resolve-context";

export async function GET(req: Request, { params }: { params: Promise<{ ctx_id: string }> }) {
  const { ctx_id } = await params;
  const session_id = req.headers.get("x-copilot-session") ?? "";
  const r = await resolveContextById(session_id, ctx_id);
  if (!r) return new Response("not found", { status: 404 });
  return Response.json(r);
}
```

实际 session_id 走 header / cookie 的机制参照现有 `/api/copilot/contexts/resolve`。

- [ ] **Step 4: tsc + test + 浏览器手测（圈选 → 点 chip → 展开详情）**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(copilot): chip body expand shows resolved context detail (lazy-loaded)"
```

---

## Task 5.3 · tool-call-card 按 tool name 分 variant

**Files:**
- Modify: `src/components/copilot/tool-call-card.tsx`

- [ ] **Step 1: 定义 variant 路由**

```tsx
// tool-call-card.tsx
const VARIANT_BY_TOOL: Record<string, "context" | "resource" | "retrieval" | "write" | "default"> = {
  read_context: "context",
  read_resource: "resource",
  read_tool_result: "retrieval",
  edit_template: "write",
  restart_experiment: "write",
};

function pickVariant(toolName: string, metadata?: { isDestructive: boolean }): Variant {
  if (VARIANT_BY_TOOL[toolName]) return VARIANT_BY_TOOL[toolName];
  return metadata?.isDestructive ? "write" : "default";
}
```

- [ ] **Step 2: 按 variant 分别渲染**

```tsx
function ToolCallCard({ call, result, onConfirm, onDeny }: Props) {
  const variant = pickVariant(call.tool_name, call.metadata);
  switch (variant) {
    case "context": return <ContextVariant call={call} result={result} />;
    case "resource": return <ResourceVariant call={call} result={result} />;
    case "retrieval": return <RetrievalVariant call={call} result={result} />;
    case "write": return <WriteVariant call={call} result={result} onConfirm={onConfirm} onDeny={onDeny} />;
    default: return <DefaultVariant call={call} result={result} />;
  }
}

// ContextVariant 展示 chip echo #N + scope
function ContextVariant({ call, result }: { call: ToolCall; result?: unknown }) {
  const t = useT();
  const input = call.input as { id: string; scope?: string };
  return (
    <div className="tc-card tc-context">
      <div className="tc-header">{t("copilot.tool.read_context.title")} {input.id} · scope: {input.scope ?? "self"}</div>
      {result !== undefined && (
        <div className="tc-body"><pre>{JSON.stringify(result, null, 2)}</pre></div>
      )}
    </div>
  );
}

// ResourceVariant 带 type/id 链接
function ResourceVariant({ call, result }: { call: ToolCall; result?: unknown }) {
  const t = useT();
  const input = call.input as { type: string; id: string; fields?: string[] };
  const href = linkForResource(input.type, input.id);
  return (
    <div className="tc-card tc-resource">
      <div className="tc-header">
        {t("copilot.tool.read_resource.title")} {input.type}/<a href={href}>{input.id}</a>
        {input.fields && <span> · fields: {input.fields.join(", ")}</span>}
      </div>
      {result !== undefined && <div className="tc-body"><pre>{JSON.stringify(result, null, 2)}</pre></div>}
    </div>
  );
}

// RetrievalVariant
function RetrievalVariant({ call, result }: { call: ToolCall; result?: unknown }) {
  const t = useT();
  const input = call.input as { ref: string };
  return (
    <div className="tc-card tc-retrieval">
      <div className="tc-header">{t("copilot.tool.read_tool_result.title")} {input.ref}</div>
      {result !== undefined && <div className="tc-body"><pre>{JSON.stringify(result, null, 2)}</pre></div>}
    </div>
  );
}

// WriteVariant 带 Confirm UI
function WriteVariant({ call, result, onConfirm, onDeny }: Props) {
  const t = useT();
  return (
    <div className="tc-card tc-write border-warning">
      <div className="tc-header">{t("copilot.tool.write.title")}: {call.tool_name}</div>
      <div className="tc-body"><pre>{JSON.stringify(call.input, null, 2)}</pre></div>
      {result === undefined && (
        <div className="tc-actions">
          <button onClick={onDeny}>{t("copilot.tool.deny")}</button>
          <button onClick={onConfirm}>{t("copilot.tool.confirm")}</button>
        </div>
      )}
      {result !== undefined && <div className="tc-body"><pre>{JSON.stringify(result, null, 2)}</pre></div>}
    </div>
  );
}

function linkForResource(type: string, id: string): string {
  switch (type) {
    case "template": return `/settings/templates/${id}`;
    case "dataset": return `/settings/datasets/${id}`;
    case "display": return `/settings/displays/${id}`;
    case "rubric": return `/settings/rubrics/${id}`;
    case "experiment": return `/experiments/${id}`;
    default: return "#";
  }
}
```

- [ ] **Step 3: 加 i18n keys**

```ts
// zh.ts
"copilot.tool.read_context.title": "查阅圈选",
"copilot.tool.read_resource.title": "查阅资源",
"copilot.tool.read_tool_result.title": "回拉历史",
"copilot.tool.write.title": "写操作",
"copilot.tool.confirm": "确认",
"copilot.tool.deny": "拒绝",
```

英文对称。

- [ ] **Step 4: tsc + test + 浏览器手测（观察每种 tool 的 card 样式）**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(copilot): tool-call-card variant rendering (context/resource/retrieval/write)"
```

---

## M5 验证点

- [ ] `npm run test:e2e` playwright 全过（至少路由 smoke）
- [ ] 浏览器手测：
  - "预览 LLM 将看到的 context" 折叠按钮不存在
  - chip 点击 body 展开详情，×仅移除不影响展开
  - 触发 `read_context` / `read_resource` / `read_tool_result` / `edit_template` 各看一次，卡片样式不同

---

# M6 · 聚合 + 写工具 + 压缩

目标：完成 `read_experiment_results` 的 aggregation、micro-compact、`edit_template` 写工具。

## Task 6.1 · read_experiment_results 加 aggregation 参数

**Files:**
- Modify: `src/lib/copilot/tools/read-experiment-results.ts`
- Test: `src/lib/copilot/tools/__tests__/read-experiment-results-aggregate.test.ts`

- [ ] **Step 1: 测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { readExperimentResultsTool } from "../read-experiment-results";

vi.mock("@/lib/store", () => ({
  readResultsJsonl: vi.fn(async () => [
    { task_id: "t1", status: "failed", error: "timeout" },
    { task_id: "t2", status: "failed", error: "timeout" },
    { task_id: "t3", status: "failed", error: "parse_error" },
    { task_id: "t4", status: "success" },
  ]),
}));

const ctx = { session_id: "s", signal: new AbortController().signal };

describe("read_experiment_results aggregation", () => {
  it("groups by error_type with count + sample_ids", async () => {
    const r = await readExperimentResultsTool.call(
      { experiment_id: "e", status: "failed", group_by: "error_type", aggregate: ["count", "sample_ids"] },
      ctx,
    ) as { groups: Array<{ group_key: string; metrics: Record<string, unknown>; sample_ids: string[] }> };
    expect(r.groups).toHaveLength(2);
    const timeout = r.groups.find((g) => g.group_key === "timeout");
    expect(timeout?.metrics.count).toBe(2);
    expect(timeout?.sample_ids).toEqual(["t1", "t2"]);
  });
});
```

- [ ] **Step 2: 扩展 tool 实现**

```ts
// read-experiment-results.ts（扩展）
interface Input {
  experiment_id: string;
  task_ids?: string[];
  status?: "success" | "failed" | "running";
  limit?: number;
  group_by?: "error_type" | "score_bucket" | "task_id";
  aggregate?: Array<"count" | "pass_rate" | "avg_score" | "sample_ids">;
  filter?: { score_lt?: number; score_gte?: number; error_contains?: string };
}

// ... call 扩展 ...
call: async (input) => {
  const { experiment_id, task_ids, status, limit = 20, group_by, aggregate, filter } = input;
  let rows = await readResultsJsonl(experiment_id);
  if (task_ids?.length) {
    const set = new Set(task_ids);
    rows = rows.filter((r) => set.has(r.task_id));
  }
  if (status) rows = rows.filter((r) => r.status === status);
  if (filter?.error_contains) rows = rows.filter((r) => (r.error ?? "").includes(filter.error_contains));
  if (filter?.score_lt !== undefined) rows = rows.filter((r) => (r.score ?? Infinity) < filter.score_lt!);
  if (filter?.score_gte !== undefined) rows = rows.filter((r) => (r.score ?? -Infinity) >= filter.score_gte!);

  if (!group_by) return { results: rows.slice(0, limit), total: rows.length };

  const groupKey = (r: { error?: string; score?: number; task_id: string }) => {
    if (group_by === "error_type") return r.error ?? "no_error";
    if (group_by === "score_bucket") return scoreBucket(r.score);
    return r.task_id;
  };
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return {
    groups: Array.from(groups.entries()).map(([key, members]) => ({
      group_key: key,
      metrics: computeMetrics(members, aggregate ?? ["count"]),
      sample_ids: aggregate?.includes("sample_ids") ? members.slice(0, 5).map((m) => m.task_id) : undefined,
    })),
    total: rows.length,
  };
},

function scoreBucket(score?: number): string {
  if (score === undefined) return "no_score";
  if (score < 0.5) return "<0.5";
  if (score < 0.8) return "0.5-0.8";
  return "≥0.8";
}

function computeMetrics(members: Array<{ status: string; score?: number }>, aggs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (aggs.includes("count")) out.count = members.length;
  if (aggs.includes("pass_rate")) {
    out.pass_rate = members.filter((m) => m.status === "success").length / members.length;
  }
  if (aggs.includes("avg_score")) {
    const scores = members.map((m) => m.score).filter((s): s is number => s !== undefined);
    out.avg_score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }
  return out;
}
```

- [ ] **Step 3: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/tools/__tests__/read-experiment-results-aggregate.test.ts
git add -A
git commit -m "feat(copilot): read_experiment_results group_by/aggregate/filter params"
```

---

## Task 6.2 · micro-compact 纯函数

**Files:**
- Create: `src/lib/copilot/micro-compact.ts`
- Test: `src/lib/copilot/__tests__/micro-compact.test.ts`

- [ ] **Step 1: 测试**

```ts
import { describe, it, expect } from "vitest";
import { microCompact, parseRefId } from "../micro-compact";
import type { CopilotMessage } from "../types";

function toolResult(id: string, ref?: string): CopilotMessage {
  return {
    role: "tool",
    tool_call_id: id,
    tool_name: "list_experiments",  // read-only
    content: ref
      ? { kind: "ref", ref, preview: "..." }
      : { kind: "inline", value: { x: 1 } },
  } as CopilotMessage;
}

describe("parseRefId", () => {
  it("extracts id from ref URL", () => {
    expect(parseRefId("ref://tool-result/tr_abc123")).toBe("tr_abc123");
  });
  it("returns undefined on invalid", () => {
    expect(parseRefId("garbage")).toBeUndefined();
  });
});

describe("microCompact", () => {
  it("keeps recent N read tool_results, compacts older", () => {
    const messages = [
      toolResult("c1", "ref://tool-result/tr_1"),
      toolResult("c2", "ref://tool-result/tr_2"),
      toolResult("c3", "ref://tool-result/tr_3"),
      toolResult("c4", "ref://tool-result/tr_4"),
    ];
    const result = microCompact(messages, { keepRecentReadResults: 2 });
    expect((result[0].content as { kind: string }).kind).toBe("compacted");
    expect((result[1].content as { kind: string }).kind).toBe("compacted");
    expect((result[2].content as { kind: string }).kind).toBe("ref");
    expect((result[3].content as { kind: string }).kind).toBe("ref");
  });

  it("preserves non-tool messages", () => {
    const messages: CopilotMessage[] = [
      { role: "user", content: "hi" } as CopilotMessage,
      toolResult("c1", "ref://tool-result/tr_1"),
      { role: "assistant", content: "hello" } as CopilotMessage,
    ];
    const result = microCompact(messages, { keepRecentReadResults: 0 });
    expect(result[0].role).toBe("user");
    expect(result[2].role).toBe("assistant");
  });

  it("does not compact write tool results", () => {
    const writeMsg = {
      role: "tool", tool_call_id: "c1", tool_name: "restart_experiment",
      content: { kind: "ref", ref: "ref://tool-result/tr_1", preview: "." },
    } as CopilotMessage;
    const result = microCompact([writeMsg, writeMsg, writeMsg], { keepRecentReadResults: 1 });
    result.forEach((m) => expect((m.content as { kind: string }).kind).toBe("ref"));
  });
});
```

- [ ] **Step 2: 实现**

```ts
// src/lib/copilot/micro-compact.ts
import type { CopilotMessage, ToolResultContent } from "./types";
import { toolByName } from "./tools/registry";

export function parseRefId(ref: string): string | undefined {
  return ref.match(/^ref:\/\/tool-result\/(.+)$/)?.[1];
}

function isReplayableTool(name: string): boolean {
  const tool = toolByName.get(name);
  return tool?.metadata.isReadOnly ?? false;
}

export function microCompact(
  messages: CopilotMessage[],
  config: { keepRecentReadResults: number },
): CopilotMessage[] {
  const replayableIdx = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === "tool" && isReplayableTool((m as { tool_name: string }).tool_name));

  const toCompact = replayableIdx.slice(0, Math.max(0, replayableIdx.length - config.keepRecentReadResults));

  return messages.map((m, i) => {
    if (!toCompact.find((x) => x.i === i)) return m;
    const content = (m as { content: ToolResultContent }).content;
    const refId = content.kind === "ref" ? parseRefId(content.ref) : undefined;
    const newContent: ToolResultContent = {
      kind: "compacted",
      summary: refId
        ? `(archived tool result; retrieve via read_tool_result('ref://tool-result/${refId}') if needed)`
        : `(archived tool result; payload not persisted)`,
      ref: refId ? `ref://tool-result/${refId}` : undefined,
    };
    return { ...m, content: newContent } as CopilotMessage;
  });
}
```

- [ ] **Step 3: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/__tests__/micro-compact.test.ts
git add -A
git commit -m "feat(copilot): microCompact pure function for old tool_result cleanup"
```

---

## Task 6.3 · build-llm-messages 调用 microCompact

**Files:**
- Modify: `src/lib/copilot/build-llm-messages.ts`

- [ ] **Step 1: 在组装 LLM messages 前应用 microCompact**

```ts
// build-llm-messages.ts 里
import { microCompact } from "./micro-compact";

const compacted = microCompact(sessionMessages, { keepRecentReadResults: 3 });
// ... 用 compacted 替代 sessionMessages 构造 LLM messages ...
```

- [ ] **Step 2: 处理 `compacted` kind 的 content（LLM 应看到 summary）**

在 build-llm-messages 的 ToolResultContent 分支加 `compacted`：

```ts
if (content.kind === "compacted") visibleContent = content.summary;
```

- [ ] **Step 3: tsc + test + 浏览器手测（长对话确认老 tool_result 被压 summary）**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(copilot): build-llm-messages applies microCompact before assembly"
```

---

## Task 6.4 · edit_template 写工具

**Files:**
- Create: `src/lib/copilot/tools/edit-template.ts`
- Test: `src/lib/copilot/tools/__tests__/edit-template.test.ts`
- Modify: `src/lib/copilot/tools/registry.ts`

- [ ] **Step 1: 测试（mock store）**

```ts
import { describe, it, expect, vi } from "vitest";
import { editTemplateTool } from "../edit-template";

const writeMock = vi.fn(async () => {});
vi.mock("@/lib/store", () => ({
  readSchema: async (id: string) => id === "sch_X" ? { id, prompt_template: "old", version: 1 } : null,
  writeSchema: writeMock,
}));

const ctx = { session_id: "s", signal: new AbortController().signal };

describe("edit_template", () => {
  it("is marked destructive", () => {
    expect(editTemplateTool.metadata.isDestructive).toBe(true);
  });

  it("applies patch and writes", async () => {
    const r = await editTemplateTool.call(
      { schema_id: "sch_X", patch: { prompt_template: "new" } },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalled();
  });

  it("throws on missing schema", async () => {
    await expect(
      editTemplateTool.call({ schema_id: "nope", patch: {} }, ctx),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 实现**

```ts
// src/lib/copilot/tools/edit-template.ts
import type { ToolDescriptor } from "./types";
import { readSchema, writeSchema } from "@/lib/store";

interface Input {
  schema_id: string;
  patch: Partial<{ prompt_template: string; variables: unknown[]; output_schema: unknown }>;
}

export const editTemplateTool: ToolDescriptor<Input, { success: boolean; new_version: number }> = {
  name: "edit_template",
  description:
    "Edit a prompt template. DESTRUCTIVE - user must confirm. patch fields are shallow-merged into the template.",
  inputSchema: {
    type: "object",
    properties: {
      schema_id: { type: "string" },
      patch: { type: "object" },
    },
    required: ["schema_id", "patch"],
  },
  metadata: {
    isReadOnly: false,
    isDestructive: true,
    maxResultSizeChars: 1000,
  },
  call: async ({ schema_id, patch }) => {
    const schema = await readSchema(schema_id);
    if (!schema) throw new Error(`template ${schema_id} not found`);
    const updated = { ...schema, ...patch, version: (schema.version ?? 0) + 1 };
    await writeSchema(schema_id, updated);
    return { success: true, new_version: updated.version };
  },
};
```

> `readSchema` / `writeSchema` 的实际 export 名按 `src/lib/schema/index.ts` 对齐；字段名对齐 `TaskSchema`。

- [ ] **Step 3: 注册 + feature flag**

```ts
// registry.ts
import { editTemplateTool } from "./edit-template";
export const TOOLS = [...existing, editTemplateTool] as const;
```

如 spec §8.3 要求 feature flag，暂不接入 LLM config（本任务就展示全量；若要加 flag 可后续）。

- [ ] **Step 4: 测通过 + Commit**

```bash
npx vitest run src/lib/copilot/tools/__tests__/edit-template.test.ts
git add -A
git commit -m "feat(copilot): edit_template write tool (destructive, confirm-gated)"
```

---

## Task 6.5 · e2e §6 完整场景

**Files:**
- Modify: `e2e/copilot-v2.spec.ts`（新建）

- [ ] **Step 1: 写 Playwright e2e**

```ts
// e2e/copilot-v2.spec.ts
import { test, expect } from "@playwright/test";

test("copilot progressive disclosure flow", async ({ page }) => {
  await page.goto("/");
  // ... 打开 copilot、圈选（具体步骤参考 existing e2e / smoke）...
  // 发送消息 → 观察 network 看是否有 read_context / read_resource 调用
  // 断言 DOM 上：
  //   - 没有 "预览 LLM 将看到的 context" 按钮
  //   - tool-call-card 有对应 variant class (tc-context / tc-resource / tc-write)
});
```

> e2e 具体写法按现有 `e2e/smoke.spec.ts` pattern 学。可能需要 mock LLM 响应流（参考 `playwright.config.ts` 的 webServer 设置；如果真跑 LLM 成本太高，考虑用 `page.route()` stub `/api/copilot/sessions/*/chat`）。

- [ ] **Step 2: 跑 e2e**

```bash
npm run test:e2e -- copilot-v2
```

- [ ] **Step 3: Commit**

```bash
git add e2e/copilot-v2.spec.ts
git commit -m "test(copilot): e2e smoke for v2 progressive disclosure flow"
```

---

## M6 验证点

- [ ] `npm test` 全过，新增 ~15 test case
- [ ] `npm run test:e2e` 全过
- [ ] `npm run build` 成功
- [ ] 浏览器 end-to-end 手测：§6 的完整场景（圈选 task_field → 问文案好坏 → 问 prompt 改法 → Confirm edit_template）全部跑通

---

# 收尾

- [ ] 全量验证：`npx tsc --noEmit && npm test && npm run build && npm run test:e2e`
- [ ] 更新 CHANGELOG.md（`[Unreleased]` 段加 copilot v2 条目）
- [ ] `gh pr create` 提交 PR，标题 `refactor(copilot): v2 context + tool system (progressive disclosure)`，body 按 AGENTS.md 四段结构（改了什么 / 为什么 / 怎么验证 / 向后兼容风险）

---

## Self-review Checklist

- [x] **Spec 覆盖**：spec §5 十二项都有对应 Task（§5.1→T1.1, §5.2→T1.7, §5.3→T2.1-2.2, §5.4→T2.3+T3.4, §5.5→T3.1-3.6, §5.6→T6.2-6.3, §5.7→T6.1, §5.8→T1.2, §5.9→T6.4, §5.10→T4.1-4.2+T4.6, §5.11→T4.5, §5.12→T5.1-5.3）
- [x] **Placeholder**: 无 TBD / "add error handling" / "similar to task N" 等红旗
- [x] **Type consistency**: `ToolDescriptor` / `ToolResultContent` / `PreToolCallResult` / `SystemHeader` 在所有使用处名称一致
- [x] **Commit granularity**: 每个 task 独立 commit，commit msg 符合 AGENTS.md 规范
- [x] **测试 first**: 所有纯函数任务先写测试见失败再实现
- [x] **文件路径**: 每个任务都明确 Create/Modify/Test 路径
