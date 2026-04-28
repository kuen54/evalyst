# PR-3 · Copilot 工具调用闭环 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up 3 tools (`list_experiments` / `read_experiment_results` / `restart_experiment`) for Copilot, closing the "chat → see → act" loop without `edit_template` (deferred).

**Architecture:** ReAct-style two-phase streaming chat. LLM emits `tool_use` event → front-end pauses stream → renders ToolCallCard (confirm if write, auto-run if read) → client POSTs `/tool-result` → server runs tool + appends to jsonl + re-streams LLM response. Chain cap 5.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest · OpenAI + Anthropic SSE protocols (both support tool use natively).

**Spec:** `docs/superpowers/specs/2026-04-28-copilot-pr3-tool-calling-design.md`

---

## File Structure Map

### New files

| File | Role |
|---|---|
| `src/lib/copilot/tools.ts` | 3 tool definitions (name / description / input_schema / run / requiresConfirm) |
| `src/lib/copilot/tool-registry.ts` | Map name → tool def + whitelist validator |
| `src/lib/copilot/tool-adapters.ts` | `toOpenaiTools(tools)` / `toAnthropicTools(tools)` 格式转换 |
| `src/lib/copilot/__tests__/tools.test.ts` | Unit tests for each tool's `run()` + input validation |
| `src/lib/copilot/__tests__/tool-adapters.test.ts` | Unit tests for format conversion |
| `src/app/api/copilot/sessions/[id]/tool-result/route.ts` | POST handler: run tool + append result + re-stream LLM |
| `src/components/copilot/tool-call-card.tsx` | In-chat tool call UI (3 states: loading / success-collapsed / confirm) |

### Modified files

| File | Change |
|---|---|
| `src/lib/copilot/types.ts` | Extend `CopilotMessage` union with `tool_use` / `tool_result` roles; extend `CopilotEvent` with tool_use streaming events |
| `src/lib/copilot/llm-stream.ts` | Parse OpenAI `tool_calls` + Anthropic `content_block_*` tool_use blocks; emit `tool_use_*` events; accept `tools` parameter |
| `src/lib/copilot/session-store.ts` | Type narrowing for append so tool_use/tool_result messages fit |
| `src/app/api/copilot/sessions/[id]/chat/route.ts` | Pass tools to LLM; pause stream after tool_use_end; chain cap 5 |
| `src/components/copilot/chat-view.tsx` | Render tool_use messages as `<ToolCallCard>`; handle tool_use_end stream event → auto-run read tools → pending for writes |
| `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts` | ~20 new keys under `copilot.tool.*` |

---

### Task 1: Type extensions (types.ts + llm-stream.ts event additions)

**Files:**
- Modify: `src/lib/copilot/types.ts`

- [ ] **Step 1: Extend CopilotMessage union**

Read `src/lib/copilot/types.ts` first to understand current shape.

Add to the `CopilotMessage` type:

```ts
/** 工具调用（LLM 发起）。pair 在同一 session 内通过 call_id 配对到后续 ToolResultMessage。 */
export interface ToolUseMessage {
  id: string
  role: "tool_use"
  call_id: string
  tool_name: string
  tool_input: Record<string, unknown>
  ts: string
  parent_id?: string
}

/** 工具执行结果（前端 confirm 后 server 跑出来的）或用户 deny 的结果。 */
export interface ToolResultMessage {
  id: string
  role: "tool_result"
  call_id: string
  tool_name: string
  content: unknown  // tool.run() 返回值；denied 时为 { denied: true, reason? }
  denied?: boolean
  reason?: string
  ts: string
  parent_id?: string
}

export type CopilotMessage =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolUseMessage
  | ToolResultMessage
```

Extend `CopilotEvent` union (SSE events):
```ts
export type CopilotEvent =
  | { type: "text_delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "tool_use_start"; call_id: string; tool_name: string }
  | { type: "tool_use_delta"; call_id: string; input_json_delta: string }
  | { type: "tool_use_end"; call_id: string; tool_name: string; input: Record<string, unknown> }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If any existing code in `session-store.ts` or `chat-view.tsx` breaks due to exhaustive switches, fix the switches to handle new cases (pass through / ignore for now).

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/types.ts
git commit -m "$(cat <<'EOF'
feat(copilot): extend types with tool_use / tool_result messages and events

Ground layer for PR-3 tool calling: adds ToolUseMessage + ToolResultMessage
message roles (persisted to jsonl) and three streaming events
(tool_use_start / tool_use_delta / tool_use_end).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tool registry + 3 tool implementations

**Files:**
- Create: `src/lib/copilot/tools.ts`
- Create: `src/lib/copilot/tool-registry.ts`
- Create: `src/lib/copilot/__tests__/tools.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/lib/copilot/__tests__/tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { tools } from "../tools"

const listTool = tools.find(t => t.name === "list_experiments")!
const readTool = tools.find(t => t.name === "read_experiment_results")!
const restartTool = tools.find(t => t.name === "restart_experiment")!

describe("tool: list_experiments", () => {
  it("returns all when no filter", async () => {
    const result = await listTool.run({}) as { experiments: unknown[]; total_matching: number }
    expect(Array.isArray(result.experiments)).toBe(true)
  })

  it("caps limit at 50", async () => {
    const result = await listTool.run({ limit: 999 }) as { returned: number }
    expect(result.returned).toBeLessThanOrEqual(50)
  })

  it("requiresConfirm false", () => {
    expect(listTool.requiresConfirm).toBe(false)
  })
})

describe("tool: read_experiment_results", () => {
  it("requires experiment_id", async () => {
    await expect(readTool.run({} as never)).rejects.toThrow()
  })

  it("returns empty for unknown experiment", async () => {
    const result = await readTool.run({ experiment_id: "nonexistent" }) as { results: unknown[] }
    expect(result.results).toEqual([])
  })

  it("requiresConfirm false", () => {
    expect(readTool.requiresConfirm).toBe(false)
  })
})

describe("tool: restart_experiment", () => {
  it("requiresConfirm true", () => {
    expect(restartTool.requiresConfirm).toBe(true)
  })

  it("requires experiment_id", async () => {
    await expect(restartTool.run({} as never)).rejects.toThrow()
  })
})
```

Run: `npm test -- tools.test`
Expected: FAIL — `../tools` not found.

- [ ] **Step 2: Create tool registry**

Create `src/lib/copilot/tool-registry.ts`:

```ts
import type { CopilotTool } from "./tools"

export function findTool(tools: CopilotTool[], name: string): CopilotTool | null {
  return tools.find(t => t.name === name) ?? null
}

export function assertKnownTool(tools: CopilotTool[], name: string): CopilotTool {
  const t = findTool(tools, name)
  if (!t) throw new Error(`Unknown tool: ${name}. Allowed: ${tools.map(x => x.name).join(", ")}`)
  return t
}
```

- [ ] **Step 3: Create tools.ts with 3 tool impls**

Create `src/lib/copilot/tools.ts`:

```ts
import { listExperiments, getExperiment } from "@/lib/store"
import { startBatch } from "@/lib/batch-runner"
import { readResults } from "@/lib/result-parser"

export interface CopilotTool {
  name: string
  description: string
  input_schema: {
    type: "object"
    required?: string[]
    properties: Record<string, unknown>
  }
  requiresConfirm: boolean
  run: (input: Record<string, unknown>) => Promise<unknown>
}

export const tools: CopilotTool[] = [
  {
    name: "list_experiments",
    description: "列出平台上的实验，可按 status / schema_id 过滤。用于发现用户没圈选的相关实验。",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed"] },
        schema_id: { type: "string", description: "按评测任务 ID 过滤" },
        limit: { type: "number", description: "最多返回多少条，上限 50" },
      },
    },
    requiresConfirm: false,
    run: async (input) => {
      const all = await listExperiments()
      let filtered = all
      if (input.status) filtered = filtered.filter(e => e.status === input.status)
      if (input.schema_id) filtered = filtered.filter(e => e.schema_id === input.schema_id)
      const limit = Math.min(Number(input.limit ?? 20), 50)
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
  },
  {
    name: "read_experiment_results",
    description: "读取某个实验的 task 结果，可按 task_id 列表或 status 过滤。用于扫描失败样本或提取特定结果。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["success", "failed", "timeout"] },
        limit: { type: "number" },
      },
    },
    requiresConfirm: false,
    run: async (input) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const all = await readResults(String(input.experiment_id))
      let filtered = all
      if (Array.isArray(input.task_ids) && input.task_ids.length) {
        const set = new Set(input.task_ids as string[])
        filtered = filtered.filter(r => set.has(r.task_id))
      }
      if (input.status) filtered = filtered.filter(r => r.status === input.status)
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return {
        results: filtered.slice(0, limit),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
      }
    },
  },
  {
    name: "restart_experiment",
    description: "重新运行一个实验。可选：只跑指定的 task_ids 子集（用于修了 prompt 后只重跑失败的几条）。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
      },
    },
    requiresConfirm: true,
    run: async (input) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const expId = String(input.experiment_id)
      const exp = await getExperiment(expId)
      if (!exp) throw new Error(`Experiment not found: ${expId}`)
      const taskIds = Array.isArray(input.task_ids) ? (input.task_ids as string[]) : undefined
      // startBatch 的参数请和 batch-runner 的签名对齐：(cfg, resume, concurrency, taskIds)
      // resume=true 表示累加历史 stats；concurrency 取配置或默认
      await startBatch(exp, true, exp.concurrency ?? 3, taskIds)
      return {
        triggered: true,
        experiment_id: expId,
        task_count: taskIds?.length ?? exp.run_stats?.total_tasks ?? 0,
        message: taskIds?.length
          ? `已触发重跑 ${taskIds.length} 条指定 task`
          : `已触发全量重跑实验 ${expId}`,
      }
    },
  },
]
```

**Note**: 实施时请验证 `listExperiments` / `getExperiment` / `startBatch` / `readResults` 这四个函数的真实签名，导入路径可能与示例不同。看 `src/lib/store.ts` / `src/lib/batch-runner.ts` / `src/lib/result-parser.ts` 对齐。

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tools.test`
Expected: 6+ cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/tools.ts src/lib/copilot/tool-registry.ts src/lib/copilot/__tests__/tools.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): add 3 tools (list_experiments / read_experiment_results / restart_experiment) + registry

Only restart_experiment requires confirm (write). list_* and read_* are
no-confirm for zero-cost dev loop. limit capped at 50 to keep LLM context
budget predictable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tool adapters (OpenAI + Anthropic format)

**Files:**
- Create: `src/lib/copilot/tool-adapters.ts`
- Create: `src/lib/copilot/__tests__/tool-adapters.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/copilot/__tests__/tool-adapters.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { toOpenaiTools, toAnthropicTools } from "../tool-adapters"
import { tools } from "../tools"

describe("toOpenaiTools", () => {
  it("wraps each tool in OpenAI function schema", () => {
    const out = toOpenaiTools(tools)
    expect(out).toHaveLength(tools.length)
    expect(out[0]).toMatchObject({
      type: "function",
      function: { name: expect.any(String), description: expect.any(String), parameters: expect.any(Object) },
    })
  })
})

describe("toAnthropicTools", () => {
  it("exposes name/description/input_schema directly", () => {
    const out = toAnthropicTools(tools)
    expect(out).toHaveLength(tools.length)
    expect(out[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      input_schema: expect.any(Object),
    })
  })
})
```

- [ ] **Step 2: Implement**

Create `src/lib/copilot/tool-adapters.ts`:

```ts
import type { CopilotTool } from "./tools"

export function toOpenaiTools(tools: CopilotTool[]) {
  return tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

export function toAnthropicTools(tools: CopilotTool[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
npm test -- tool-adapters.test
git add src/lib/copilot/tool-adapters.ts src/lib/copilot/__tests__/tool-adapters.test.ts
git commit -m "feat(copilot): tool format adapters for OpenAI + Anthropic APIs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Extend llm-stream.ts to handle tool_use events

**Files:**
- Modify: `src/lib/copilot/llm-stream.ts`

**Background**: This is the **hardest single task** — need to correctly parse tool_use from both OpenAI (`choices[0].delta.tool_calls[]`) and Anthropic (`event: content_block_start` with `content_block.type: "tool_use"`) streaming protocols, emit unified `tool_use_*` events.

- [ ] **Step 1: Read current llm-stream.ts**

Read it fully. Understand the existing text_delta parsing, then plan where to hook tool parsing.

- [ ] **Step 2: Accept `tools` parameter**

Change `callLlmStreaming` signature to accept optional `tools` array:

```ts
export async function callLlmStreaming(opts: {
  config: LlmConfig
  messages: CopilotMessage[]
  tools?: unknown[]   // already in adapter format (OpenAI function schema OR Anthropic tool schema)
  onEvent: (ev: CopilotEvent) => void
  signal?: AbortSignal
}): Promise<void>
```

When `tools` is passed, include them in the request body per format:
- OpenAI: `body.tools = tools; body.tool_choice = "auto"`
- Anthropic: `body.tools = tools`

- [ ] **Step 3: Parse OpenAI tool_calls in streaming**

OpenAI sends `choices[0].delta.tool_calls[0]` chunks:
- First chunk: `{ index: 0, id: "call_...", function: { name: "..." }, type: "function" }`
- Subsequent chunks: `{ index: 0, function: { arguments: "...partial json..." } }`
- Finish: `finish_reason: "tool_calls"` in final chunk

Parsing logic:
```ts
// Track tool calls by index
const toolCallsByIndex: Map<number, { call_id: string; name: string; args_buffer: string }> = new Map()

// in each chunk:
if (delta.tool_calls) {
  for (const tc of delta.tool_calls) {
    const idx = tc.index
    if (!toolCallsByIndex.has(idx)) {
      toolCallsByIndex.set(idx, { call_id: tc.id, name: tc.function?.name ?? "", args_buffer: "" })
      onEvent({ type: "tool_use_start", call_id: tc.id, tool_name: tc.function?.name ?? "" })
    }
    const entry = toolCallsByIndex.get(idx)!
    if (tc.function?.arguments) {
      entry.args_buffer += tc.function.arguments
      onEvent({ type: "tool_use_delta", call_id: entry.call_id, input_json_delta: tc.function.arguments })
    }
  }
}

// on finish_reason === "tool_calls":
for (const [, entry] of toolCallsByIndex) {
  try {
    const input = JSON.parse(entry.args_buffer || "{}")
    onEvent({ type: "tool_use_end", call_id: entry.call_id, tool_name: entry.name, input })
  } catch (e) {
    onEvent({ type: "error", message: `Tool args JSON parse failed: ${(e as Error).message}` })
  }
}
```

- [ ] **Step 4: Parse Anthropic tool_use blocks in streaming**

Anthropic sends:
- `event: content_block_start` with `content_block: { type: "tool_use", id: "toolu_...", name: "..." }`
- `event: content_block_delta` with `delta: { type: "input_json_delta", partial_json: "..." }`
- `event: content_block_stop` with `index`

Parsing logic:
```ts
// Track blocks by index
const blocksByIndex: Map<number, { type: string; call_id: string; name: string; args_buffer: string }> = new Map()

// on content_block_start:
if (e.content_block?.type === "tool_use") {
  blocksByIndex.set(e.index, { type: "tool_use", call_id: e.content_block.id, name: e.content_block.name, args_buffer: "" })
  onEvent({ type: "tool_use_start", call_id: e.content_block.id, tool_name: e.content_block.name })
}

// on content_block_delta:
const blk = blocksByIndex.get(e.index)
if (blk?.type === "tool_use" && e.delta.type === "input_json_delta") {
  blk.args_buffer += e.delta.partial_json
  onEvent({ type: "tool_use_delta", call_id: blk.call_id, input_json_delta: e.delta.partial_json })
}

// on content_block_stop:
const blk2 = blocksByIndex.get(e.index)
if (blk2?.type === "tool_use") {
  try {
    const input = JSON.parse(blk2.args_buffer || "{}")
    onEvent({ type: "tool_use_end", call_id: blk2.call_id, tool_name: blk2.name, input })
  } catch (e2) {
    onEvent({ type: "error", message: `Tool args JSON parse failed: ${(e2 as Error).message}` })
  }
}
```

- [ ] **Step 5: Serialize tool_use / tool_result messages in outgoing request**

Before sending messages to LLM, need to map `tool_use` / `tool_result` messages to the format each provider expects:

**OpenAI format**:
```ts
// ToolUseMessage → assistant message with tool_calls field
{ role: "assistant", content: null, tool_calls: [{ id: call_id, type: "function", function: { name, arguments: JSON.stringify(input) } }] }

// ToolResultMessage → tool message
{ role: "tool", tool_call_id: call_id, content: typeof content === "string" ? content : JSON.stringify(content) }
```

**Anthropic format**:
```ts
// ToolUseMessage → assistant message with tool_use block
{ role: "assistant", content: [{ type: "tool_use", id: call_id, name, input }] }

// ToolResultMessage → user message with tool_result block
{ role: "user", content: [{ type: "tool_result", tool_use_id: call_id, content: typeof content === "string" ? content : JSON.stringify(content) }] }
```

Wrap this logic in a helper `serializeMessagesForLlm(messages, apiFormat)`.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm test
```

Tests should stay at 158+ green (old 156 + Task 2's 6 + Task 3's 2 = 164).

- [ ] **Step 7: Commit**

```bash
git add src/lib/copilot/llm-stream.ts
git commit -m "$(cat <<'EOF'
feat(copilot): stream tool_use events from OpenAI + Anthropic protocols

callLlmStreaming now accepts tools parameter and emits
tool_use_start / tool_use_delta / tool_use_end events alongside
existing text_delta. Message serialization handles tool_use +
tool_result roles for both OpenAI (assistant.tool_calls + role: tool)
and Anthropic (content blocks).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: /tool-result API route

**Files:**
- Create: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`

- [ ] **Step 1: Implement POST handler**

```ts
import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { tools } from "@/lib/copilot/tools"
import { assertKnownTool } from "@/lib/copilot/tool-registry"
import { toOpenaiTools, toAnthropicTools } from "@/lib/copilot/tool-adapters"
import { appendMessage, readSession } from "@/lib/copilot/session-store"
import { callLlmStreaming } from "@/lib/copilot/llm-stream"
import { getLlmConfigFor } from "@/lib/copilot/model-config"  // 实施时对齐真实模块
import type { CopilotEvent, ToolUseMessage, ToolResultMessage } from "@/lib/copilot/types"

const CHAIN_CAP = 5

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const body = await req.json() as {
    call_id: string
    tool_name: string
    input: Record<string, unknown>
    denied?: boolean
    reason?: string
  }

  const session = await readSession(sessionId)
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 })

  // 链式调用计数：数现有会话里连续的 tool_use（未被文字消息分隔的）
  const chainCount = countTrailingToolUses(session.messages)
  if (chainCount >= CHAIN_CAP) {
    return NextResponse.json({ error: "chain call limit reached" }, { status: 429 })
  }

  // 1. 如果 denied：只写 tool_result 带 denied=true
  // 2. 否则：找 tool → run(input) → 写 tool_result
  let resultContent: unknown
  if (body.denied) {
    resultContent = { denied: true, reason: body.reason ?? "" }
  } else {
    const tool = assertKnownTool(tools, body.tool_name)
    try {
      resultContent = await tool.run(body.input)
    } catch (e) {
      resultContent = { error: (e as Error).message }
    }
  }

  const toolResultMsg: ToolResultMessage = {
    id: nanoid(10),
    role: "tool_result",
    call_id: body.call_id,
    tool_name: body.tool_name,
    content: resultContent,
    denied: body.denied,
    reason: body.reason,
    ts: new Date().toISOString(),
  }
  await appendMessage(sessionId, toolResultMsg)

  // 3. 重新调 LLM，带完整 messages，返回 SSE
  const updated = await readSession(sessionId)
  const cfg = await getLlmConfigFor(session.model_id ?? "default")
  const toolsFormatted = cfg.api_format === "openai" ? toOpenaiTools(tools) : toAnthropicTools(tools)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: CopilotEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }
      try {
        await callLlmStreaming({
          config: cfg,
          messages: updated!.messages,
          tools: toolsFormatted,
          onEvent: send,
        })
        send({ type: "done" })
      } catch (e) {
        send({ type: "error", message: (e as Error).message })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  })
}

function countTrailingToolUses(messages: { role: string }[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (role === "tool_use" || role === "tool_result") count++
    else break
  }
  return Math.floor(count / 2)  // 一对 tool_use+tool_result 算一次
}
```

**Note**: 实施时对齐 `getLlmConfigFor` 的真实名字（可能是 `pickModel` 或 `getLlmConfig`）。

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/copilot/sessions/\[id\]/tool-result/route.ts
git commit -m "$(cat <<'EOF'
feat(copilot): POST /tool-result endpoint closes the tool call loop

Client POSTs after confirm/deny → server runs tool (or records denial) →
appends tool_result to jsonl → re-streams LLM with tool context.
Chain cap 5 (429 if exceeded).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update /chat route to pass tools + pause on tool_use

**Files:**
- Modify: `src/app/api/copilot/sessions/[id]/chat/route.ts`

- [ ] **Step 1: Read current /chat route**

Understand current streaming flow.

- [ ] **Step 2: Thread tools through**

Import `tools` + `toOpenaiTools` / `toAnthropicTools` + pass to `callLlmStreaming({ ..., tools })`.

If LLM emits `tool_use_end`, server needs to:
- Append the `ToolUseMessage` to jsonl (before closing stream)
- End the SSE stream (client will see tool_use_end and POST to /tool-result next)

Track tool_use_end in onEvent callback:
```ts
const pendingToolUses: ToolUseMessage[] = []
await callLlmStreaming({
  ...,
  onEvent: (ev) => {
    if (ev.type === "tool_use_end") {
      pendingToolUses.push({
        id: nanoid(10),
        role: "tool_use",
        call_id: ev.call_id,
        tool_name: ev.tool_name,
        tool_input: ev.input,
        ts: new Date().toISOString(),
      })
    }
    send(ev)
  }
})
for (const tu of pendingToolUses) await appendMessage(sessionId, tu)
send({ type: "done" })
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add src/app/api/copilot/sessions/\[id\]/chat/route.ts
git commit -m "feat(copilot): chat route passes tools to LLM and appends tool_use to jsonl

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ToolCallCard component

**Files:**
- Create: `src/components/copilot/tool-call-card.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"
import type { ToolUseMessage, ToolResultMessage } from "@/lib/copilot/types"
import { tools } from "@/lib/copilot/tools"
import { findTool } from "@/lib/copilot/tool-registry"

interface Props {
  toolUse: ToolUseMessage
  toolResult?: ToolResultMessage  // undefined 表示还在 pending
  onConfirm: () => void
  onDeny: (reason: string) => void
  pending: boolean  // 用户正在等待 / 还没决策
}

export function ToolCallCard({ toolUse, toolResult, onConfirm, onDeny, pending }: Props) {
  const t = useT()
  const [denyReason, setDenyReason] = useState("")
  const [denyOpen, setDenyOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const tool = findTool(tools, toolUse.tool_name)
  const requiresConfirm = tool?.requiresConfirm ?? false

  // 3 个状态：
  // a) 无结果 + write tool + !denyOpen → 显示 Confirm / Deny
  // b) 无结果 + read tool → 显示 loading
  // c) 有结果 → 显示 summary collapsed

  if (toolResult) {
    const denied = toolResult.denied
    return (
      <div className={`rounded-md border px-3 py-2 text-xs ${denied ? "bg-muted/40 text-muted-foreground" : "bg-muted/20"}`}>
        <div className="flex items-center gap-2">
          <span>{denied ? "🚫" : "✅"}</span>
          <code className="font-mono">{toolUse.tool_name}</code>
          <span className="text-muted-foreground">
            {denied ? t("copilot.tool.denied_summary", { reason: toolResult.reason ?? "" })
                    : summarizeResult(toolResult.content)}
          </span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setExpanded(v => !v)}>
            {expanded ? "▾" : "▸"}
          </button>
        </div>
        {expanded && (
          <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap bg-background/60 p-2 rounded max-h-60 overflow-auto">
            {JSON.stringify(toolResult.content, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  if (!requiresConfirm) {
    return (
      <div className="rounded-md border px-3 py-2 text-xs bg-muted/10">
        <div className="flex items-center gap-2">
          <span>🔍</span>
          <code className="font-mono">{toolUse.tool_name}</code>
          <span className="text-muted-foreground">{t("copilot.tool.loading")}</span>
        </div>
      </div>
    )
  }

  // write tool, pending confirm
  return (
    <div className="rounded-md border bg-card px-3 py-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span>⚙️</span>
        <code className="font-mono font-medium">{toolUse.tool_name}</code>
        <Badge variant="outline" className="text-[10px]">{t("copilot.tool.requires_confirm")}</Badge>
      </div>
      <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/40 p-2 rounded max-h-40 overflow-auto">
        {JSON.stringify(toolUse.tool_input, null, 2)}
      </pre>
      {denyOpen ? (
        <div className="space-y-1.5">
          <input
            value={denyReason}
            onChange={e => setDenyReason(e.target.value)}
            placeholder={t("copilot.tool.deny_reason_placeholder")}
            className="w-full h-7 px-2 text-xs border rounded"
          />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => onDeny(denyReason)} disabled={pending}>
              {t("copilot.tool.deny_confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDenyOpen(false)} disabled={pending}>
              {t("copilot.tool.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={onConfirm} disabled={pending}>
            {t("copilot.tool.confirm")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDenyOpen(true)} disabled={pending}>
            {t("copilot.tool.deny")}
          </Button>
        </div>
      )}
    </div>
  )
}

function summarizeResult(content: unknown): string {
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>
    if ("triggered" in obj) return String(obj.message ?? "done")
    if ("returned" in obj) return `${obj.returned}/${obj.total_matching}`
  }
  return ""
}
```

**Note**: The `Props.onConfirm` / `onDeny` trigger client-side fetch to `/api/copilot/sessions/[id]/tool-result`. Wiring done in chat-view.tsx (Task 9).

- [ ] **Step 2: Commit**

```bash
git add src/components/copilot/tool-call-card.tsx
git commit -m "feat(copilot): ToolCallCard with 3 states (loading / confirm / result)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire ToolCallCard into chat-view

**Files:**
- Modify: `src/components/copilot/chat-view.tsx`

- [ ] **Step 1: Extend message list render**

Currently chat-view renders `UiMessage[]` with MessageRow. Extend to handle tool_use / tool_result:

```tsx
// New union:
type UiMessage =
  | { role: "user"; ... }
  | { role: "assistant"; ... }
  | { role: "tool_use"; tool_use: ToolUseMessage }
  | { role: "tool_result"; tool_result: ToolResultMessage }
```

In the map render, for `role === "tool_use"`:
- Find the paired `tool_result` later in the list (by call_id)
- Render `<ToolCallCard toolUse={msg.tool_use} toolResult={pair} ...>`

- [ ] **Step 2: Handle tool_use_end streaming event**

When SSE delivers `tool_use_end`:
- Construct a `ToolUseMessage` in UI state (marked pending/confirm-needed)
- If requiresConfirm=false: auto-call `/tool-result` with the input (auto-confirm for read tools)
- If requiresConfirm=true: add to UI state, wait for user click

When user clicks Confirm:
```ts
await fetch(`/api/copilot/sessions/${sessionId}/tool-result`, {
  method: "POST",
  body: JSON.stringify({
    call_id,
    tool_name,
    input,
    denied: false,
  }),
})
// Response is SSE again, keep reading events
```

Same for Deny (with `denied: true, reason`).

After confirm/deny, continue reading SSE for next batch of text / tool_use events.

- [ ] **Step 3: Run dev server + smoke**

```bash
npm run dev
# Open browser, ⌘K, try a tool call prompt
```

Verify:
- Read tool auto-runs and shows summary
- Write tool shows Confirm / Deny buttons
- After confirm, LLM continues speaking

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/copilot/chat-view.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): chat-view wires ToolCallCard + auto-runs read tools

Tool_use_end SSE event → if requiresConfirm=false, POST /tool-result
immediately with input; else surface confirm buttons. Tool_result comes
back via next SSE stream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: i18n keys

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: Add ~20 `copilot.tool.*` keys**

Add the following keys to both `zh.ts` and `en.ts` (preserve key symmetry):

```ts
// zh
"copilot.tool.loading": "查询中…",
"copilot.tool.requires_confirm": "需要你确认",
"copilot.tool.confirm": "确认执行",
"copilot.tool.deny": "拒绝",
"copilot.tool.deny_confirm": "提交拒绝",
"copilot.tool.cancel": "取消",
"copilot.tool.deny_reason_placeholder": "（可选）告诉 Copilot 为什么不应该跑",
"copilot.tool.denied_summary": "用户拒绝: {reason}",
"copilot.tool.chain_limit": "链式调用已达上限 (5)，请人工介入",
"copilot.tool.error_prefix": "工具出错: ",
"copilot.tool.run_failed": "工具执行失败",

"copilot.tool.list_experiments.desc": "列出实验",
"copilot.tool.read_experiment_results.desc": "读实验结果",
"copilot.tool.restart_experiment.desc": "重跑实验",

// en mirrors same keys with English values
```

Verify `en.ts` has all keys from `zh.ts` (typecheck does this for us via `Record<keyof typeof zh, string>`).

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "i18n(copilot): add ~13 copilot.tool.* keys for PR-3 tool calling UI"
```

---

### Task 10: End-to-end manual verification + commit final

**Files:**
- None (manual testing)

- [ ] **Step 1: Configure a copilot-enabled LLM** with `tools` support (GPT-4o, Claude 3.5+, etc.)

- [ ] **Step 2: Run 4 test cases from spec §8 "集成测试"**

- [ ] **Step 3: Run full suite**

```bash
npm test
npm run test:e2e
npm run build
```

All must be green.

- [ ] **Step 4: Update CHANGELOG.md** with PR-3 entry (add to [Unreleased] or create [0.4.0])

- [ ] **Step 5: Final commit + push branch**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for PR-3 tool calling"
git push origin feat/pr3-tool-calling
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(copilot): tool calling closed loop — list_experiments / read_experiment_results / restart_experiment" \
  --body "..."
```

Include in PR body:
- Verification scenarios A/B/C/D walk-through
- Screenshots of Confirm/Deny cards
- Note: `edit_template` deferred (spec §2, decision 2)

---

## Self-Review

**1. Spec coverage**:
- 3 tools impl → Tasks 2, 5 ✓
- Protocol extensions (types + events) → Tasks 1, 4 ✓
- Two-phase flow (pause + /tool-result) → Tasks 5, 6 ✓
- UI (ToolCallCard) → Tasks 7, 8 ✓
- i18n → Task 9 ✓
- Chain cap 5 → Task 5 ✓
- Auto-run read vs confirm write → Task 8 ✓
- Persist tool_use + tool_result → Tasks 1, 5, 6 ✓
- Deny flow → Tasks 7, 5 ✓

**2. Placeholder scan**:
- No TBD / TODO
- All tasks have full code or explicit pointer to read existing code for alignment (e.g., `store.ts` signatures)

**3. Type consistency**:
- `ToolUseMessage` / `ToolResultMessage` / `CopilotTool` shapes consistent across tasks
- `call_id` used everywhere for pairing
- `tool_use_start` / `_delta` / `_end` naming consistent in protocol

---

## Execution Handoff

Plan complete. After user `/compact`s the conversation, execution resumes:

- Branch: `feat/pr3-tool-calling` (already created, only contains docs so far)
- Execute tasks 1–10 in order
- Either subagent-driven (dispatch per task) or inline execution
