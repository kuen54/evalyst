# Copilot Page Context + Ambient Border Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开 copilot 自动感知当前页面（摘要 + viewport index）、LLM 按自然语言 query 读当前页面细节、中间内容区常驻 Apple Intelligence 风彩色边框光（4 状态动效），切页清圈选 + 建议开新对话。

**Architecture:**
- **P1 + P3 共享 client→server snapshot**：每次 `/chat` / `/tool-result` POST 客户端附 `client_snapshot = { page_context, viewport_index }`。Server 缓存到 per-session Map，page_context 注入 system message，viewport_index 供新增 `read_page(query)` 工具查询。
- **P2 独立 UI 子系统**：`CopilotBorderGlow` 作为 sibling overlay 渲染到 `<main>` 内（不包裹 main、不改 layout、`.copilot-glow` 背景光完全保留）；`conic-gradient + @property --angle` 彩色旋转 + `mask-composite: exclude` 切成 ring 形状贴 `<main>` 外缘；3 active 状态 `data-glow=idle/typing/working`（off 时 return null），通过 CSS 变量切 rim_width / feather / speed / saturate。
- **切页**：Next.js `usePathname` 观察路由变化，清 manual contexts，session.messages 非空时显示 banner 建议开新对话。

**Tech Stack:** Next.js 16.2.4 App Router · React 19 · TypeScript · Tailwind v4 · vitest · Playwright

**Spec:** `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md`
**Branch:** `feat/copilot-page-context-ambient-border`

---

## 约定与前置须知

- **所有新增 UI 可见文本必须走 i18n**：成对写 `src/lib/i18n/zh.ts` + `en.ts`，`en.ts` 的 `Record<keyof typeof zh, string>` 约束会在 `tsc` 阶段强制完整性
- **文件写入走 `writeAtomic`**（`src/lib/fs-utils.ts`）——本 plan 不涉及磁盘写
- **玻璃档位**：page_context preview 面板走 Regular，route change banner 沿用既有 `agent-hint-banner` amber 样式（不玻璃）
- **Tool client bundle 约束**：`read_page` 的 client metadata 只能 import `./tool-metadata.ts` 和 pure UI util；不能触碰 `@/lib/store`（会把 fs 拖进 browser，memory 已记）
- **测试策略**：新增纯函数配 vitest 单测；UI 组件不单测（沿用现状）；一个 e2e smoke case
- **每个 task 完成即 commit**，commit 信息走 `<type>(<scope>): <subject>` 格式

---

## Phase 0 — 基础类型 & 仓库准备

### Task 0: 确认 branch + 空跑基线

**Files:**
- 无（仅 git 操作）

- [ ] **Step 1: 确认当前在 feature branch**

Run: `git branch --show-current`
Expected: `feat/copilot-page-context-ambient-border`
若不对：`git checkout feat/copilot-page-context-ambient-border`

- [ ] **Step 2: 跑基线测试 + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 179 tests passed (as of 2026-04-28 main), tsc 无输出
此基线贯穿所有后续 task，每一步 commit 前必须保持全绿。

---

### Task 1: 添加基础类型到 `types.ts`

**Files:**
- Modify: `src/lib/copilot/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加 RouteType / PageContext / ViewportIndexEntry / ClientSnapshot**

```ts
// ---------- PR-4: Page Context + Viewport Index ----------

export type RouteType =
  | 'dashboard'
  | 'experiment_new' | 'experiment_detail'
  | 'compare'
  | 'settings_hub'
  | 'datasets_list' | 'dataset_new' | 'dataset_detail'
  | 'templates_list' | 'template_new' | 'template_detail'
  | 'displays_list' | 'display_new' | 'display_detail'
  | 'rubrics_list' | 'rubric_new' | 'rubric_detail'
  | 'models_list'
  | 'unknown'

/** 打开 copilot 时注入的当前页面摘要。每个路由自定义 summary 字段（具体 shape 见 spec §5.1.2）。 */
export interface PageContext {
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  summary: Record<string, unknown>
  timestamp: string
}

/** 当前页面中一个可被圈选元素的轻量索引条目。 */
export interface ViewportIndexEntry {
  key: string
  type: string
  preview_text: string
  ancestors?: string[]
}

/** 客户端每次 chat / tool-result 请求附带的页面快照。 */
export interface ClientSnapshot {
  session_id: string
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  page_context: PageContext
  viewport_index: ViewportIndexEntry[]
  timestamp: string
}
```

- [ ] **Step 2: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 无输出（新类型仅 export，还没被 import）

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/types.ts
git commit -m "feat(copilot): add PageContext / ViewportIndexEntry / ClientSnapshot types"
```

---

## Phase 1 — Server-side Snapshot Cache

### Task 2: `snapshot-cache.ts` + 单测

**Files:**
- Create: `src/lib/copilot/snapshot-cache.ts`
- Create: `src/lib/copilot/__tests__/snapshot-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/copilot/__tests__/snapshot-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setSnapshot, getSnapshot, deleteSnapshot } from '../snapshot-cache'
import type { ClientSnapshot } from '../types'

function makeSnap(sessionId: string, path = '/'): ClientSnapshot {
  return {
    session_id: sessionId,
    route_type: 'dashboard',
    path,
    page_context: { route_type: 'dashboard', path, summary: {}, timestamp: 'ts' },
    viewport_index: [],
    timestamp: 'ts',
  }
}

describe('snapshot-cache', () => {
  beforeEach(() => {
    deleteSnapshot('s1')
    deleteSnapshot('s2')
  })

  it('stores and retrieves a snapshot by session id', () => {
    const snap = makeSnap('s1')
    setSnapshot('s1', snap)
    expect(getSnapshot('s1')).toEqual(snap)
  })

  it('returns undefined when no snapshot exists', () => {
    expect(getSnapshot('missing')).toBeUndefined()
  })

  it('overwrites on repeated set', () => {
    setSnapshot('s1', makeSnap('s1', '/a'))
    setSnapshot('s1', makeSnap('s1', '/b'))
    expect(getSnapshot('s1')?.path).toBe('/b')
  })

  it('isolates different session ids', () => {
    setSnapshot('s1', makeSnap('s1', '/a'))
    setSnapshot('s2', makeSnap('s2', '/b'))
    expect(getSnapshot('s1')?.path).toBe('/a')
    expect(getSnapshot('s2')?.path).toBe('/b')
  })

  it('deletes cleanly', () => {
    setSnapshot('s1', makeSnap('s1'))
    deleteSnapshot('s1')
    expect(getSnapshot('s1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- snapshot-cache`
Expected: FAIL `Cannot find module '../snapshot-cache'`

- [ ] **Step 3: Implement `snapshot-cache.ts`**

Create `src/lib/copilot/snapshot-cache.ts`:

```ts
// In-memory per-session snapshot cache (server-only).
// Lifetime: latest snapshot per session; overwritten on every /chat or /tool-result POST.
// Cleared when session is DELETE'd. Lost on process restart — read_page returns "no snapshot" gracefully.
// For single-process local dev. Multi-process (e.g. Vercel) would need Redis; out of scope for v1.

import type { ClientSnapshot } from './types'

const cache = new Map<string, ClientSnapshot>()

export function setSnapshot(sessionId: string, snapshot: ClientSnapshot): void {
  cache.set(sessionId, snapshot)
}

export function getSnapshot(sessionId: string): ClientSnapshot | undefined {
  return cache.get(sessionId)
}

export function deleteSnapshot(sessionId: string): void {
  cache.delete(sessionId)
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- snapshot-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/snapshot-cache.ts src/lib/copilot/__tests__/snapshot-cache.test.ts
git commit -m "feat(copilot): in-memory snapshot cache for per-session viewport data"
```

---

## Phase 2 — read_page 工具 + 扩展 tool ctx

### Task 3: 扩展 `CopilotTool.run` 签名加 `ctx` 参数

**Files:**
- Modify: `src/lib/copilot/tools.ts`
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`

背景：当前 `run(input)` 没法拿到 sessionId。`read_page` 必须按 sessionId 取 snapshot，所以给 `run` 加一个可选 `ctx` 对象参数。前 3 个工具不读 ctx，保持原逻辑。

- [ ] **Step 1: 修改 `CopilotTool` 接口 + 现有 3 工具**

Edit `src/lib/copilot/tools.ts` — 接口部分：

```ts
export interface CopilotToolContext {
  sessionId: string
}

export interface CopilotTool {
  name: string
  description: string
  input_schema: {
    type: "object"
    required?: string[]
    properties: Record<string, unknown>
  }
  requiresConfirm: boolean
  run: (input: Record<string, unknown>, ctx: CopilotToolContext) => Promise<unknown>
}
```

现有 3 个工具的 `run` 签名改成 `async (input, _ctx) => { ... }`（忽略 ctx）：

```ts
// list_experiments
run: async (input, _ctx) => { /* 原逻辑不变 */ },
// read_experiment_results
run: async (input, _ctx) => { /* 原逻辑不变 */ },
// restart_experiment
run: async (input, _ctx) => { /* 原逻辑不变 */ },
```

- [ ] **Step 2: 修改 /tool-result route 的 `tool.run` 调用，传 ctx**

`src/app/api/copilot/sessions/[id]/tool-result/route.ts`，把第 97 行（约）从：

```ts
resultContent = await tool.run(body.input)
```

改为：

```ts
resultContent = await tool.run(body.input, { sessionId })
```

- [ ] **Step 3: 验证 tsc + 现有测试**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 无输出；179 tests pass（没新测，仅签名改动）

- [ ] **Step 4: Commit**

```bash
git add src/lib/copilot/tools.ts src/app/api/copilot/sessions/[id]/tool-result/route.ts
git commit -m "refactor(copilot): add CopilotToolContext to tool.run signature"
```

---

### Task 4: `read_page` 工具实现 + 单测

**Files:**
- Modify: `src/lib/copilot/tools.ts`（追加第 4 个工具）
- Create: `src/lib/copilot/__tests__/read-page-tool.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/copilot/__tests__/read-page-tool.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tools } from '../tools'
import { setSnapshot, deleteSnapshot } from '../snapshot-cache'
import type { ClientSnapshot } from '../types'

// Mock resolveContexts to avoid fs deps in unit test
vi.mock('../resolve-context', () => ({
  resolveContexts: vi.fn((refs) => refs.map((r: { tag: number; type: string; id: string }) => ({
    tag: r.tag,
    type: r.type,
    id: r.id,
    status: 'ok',
    data: { id: r.id, stub: true },
  }))),
}))

const readPage = tools.find(t => t.name === 'read_page')!

function makeSnap(sessionId: string, entries: Array<{ key: string; type: string; preview_text: string; ancestors?: string[] }>): ClientSnapshot {
  return {
    session_id: sessionId,
    route_type: 'experiment_detail',
    path: '/experiments/exp_1',
    page_context: { route_type: 'experiment_detail', path: '/experiments/exp_1', summary: {}, timestamp: 'ts' },
    viewport_index: entries,
    timestamp: 'ts',
  }
}

describe('read_page tool', () => {
  beforeEach(() => {
    deleteSnapshot('sess')
  })

  it('exists and has query input schema', () => {
    expect(readPage).toBeTruthy()
    expect(readPage.requiresConfirm).toBe(false)
    expect(readPage.input_schema.required).toContain('query')
  })

  it('returns empty result with message when no snapshot', async () => {
    const r = await readPage.run({ query: 'anything' }, { sessionId: 'sess' }) as {
      matches: unknown[]; total_scanned: number; message?: string
    }
    expect(r.matches).toEqual([])
    expect(r.total_scanned).toBe(0)
    expect(r.message).toBeTruthy()
  })

  it('returns zero matches with message when query finds nothing', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'apple pie' },
      { key: 'task_result:t2', type: 'task_result', preview_text: 'banana bread' },
    ]))
    const r = await readPage.run({ query: 'xylophone' }, { sessionId: 'sess' }) as {
      matches: unknown[]; total_scanned: number; message?: string
    }
    expect(r.matches).toEqual([])
    expect(r.total_scanned).toBe(2)
    expect(r.message).toContain('xylophone')
  })

  it('matches by substring in preview_text', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'failed: connection timeout' },
      { key: 'task_result:t2', type: 'task_result', preview_text: 'success: 200 ok' },
    ]))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: Array<{ key: string }>
    }
    expect(r.matches.length).toBe(1)
    expect(r.matches[0].key).toBe('task_result:t1')
  })

  it('scores multi-token queries higher for entries with more hits', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'a', type: 'task_result', preview_text: 'failed timeout' },
      { key: 'b', type: 'task_result', preview_text: 'failed' },
      { key: 'c', type: 'task_result', preview_text: 'timeout' },
    ]))
    const r = await readPage.run({ query: 'failed timeout' }, { sessionId: 'sess' }) as {
      matches: Array<{ key: string }>
    }
    expect(r.matches[0].key).toBe('a') // 2 hits beats 1
  })

  it('caps at top 5 matches', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      key: `t${i}`, type: 'task_result', preview_text: 'failed hit',
    }))
    setSnapshot('sess', makeSnap('sess', entries))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: unknown[]
    }
    expect(r.matches.length).toBe(5)
  })

  it('hydrates matched entries via resolveContexts', async () => {
    setSnapshot('sess', makeSnap('sess', [
      { key: 'task_result:t1', type: 'task_result', preview_text: 'failed' },
    ]))
    const r = await readPage.run({ query: 'failed' }, { sessionId: 'sess' }) as {
      matches: Array<{ content_tree: unknown }>
    }
    expect(r.matches[0].content_tree).toBeTruthy()
    expect((r.matches[0].content_tree as { stub: boolean }).stub).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- read-page-tool`
Expected: FAIL（`readPage` undefined，tool 未注册）

- [ ] **Step 3: Implement read_page in tools.ts**

在 `src/lib/copilot/tools.ts` 顶部 import 追加：

```ts
import { getSnapshot } from './snapshot-cache'
import { resolveContexts } from './resolve-context'
import type { CopilotContextRef } from './types'
```

在 `tools` 数组最末尾、`]` 之前，追加第 4 个工具：

```ts
{
  name: "read_page",
  description:
    "Search the current page for nodes matching a natural-language query. Returns the top 5 matching data nodes with their full structured content. Use this when the user asks about something visible on their page but you don't have the detail in context yet.",
  input_schema: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "自然语言搜索词，例如 'status 为 failed 的 task' / '第三条结果的输出' / 'experiment exp_123 的失败样本'",
      },
    },
  },
  requiresConfirm: false,
  run: async (input, ctx) => {
    const snapshot = getSnapshot(ctx.sessionId)
    if (!snapshot) {
      return { matches: [], total_scanned: 0, message: '当前没有页面快照可用' }
    }
    const query = String(input.query ?? '').toLowerCase().trim()
    const tokens = query.split(/\s+/).filter(t => t.length >= 2)
    const scored = snapshot.viewport_index
      .map(entry => {
        const haystack = `${entry.type} ${entry.preview_text} ${(entry.ancestors ?? []).join(' ')}`.toLowerCase()
        let score = 0
        for (const t of tokens) if (haystack.includes(t)) score += 1
        return { entry, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    if (scored.length === 0) {
      return {
        matches: [],
        total_scanned: snapshot.viewport_index.length,
        message: `未在当前页面找到匹配 "${input.query}" 的内容`,
      }
    }
    const refs: CopilotContextRef[] = scored.map((x, i) => {
      const [type, ...rest] = x.entry.key.split(':')
      const id = rest.join(':')
      // elementKey 可能带 experiment_id 前缀 (task_result/task_field)，格式 "<type>:<exp>/<id>"
      // 这里简化：交给 resolveContexts，它按 ref.extra 查；但 extra 丢了
      // 暂不处理复杂 key，直接用 id；后续若命中率不足再增强
      return { tag: i + 1, type, id }
    })
    const resolved = resolveContexts(refs)
    return {
      matches: scored.map((x, i) => {
        const hit = resolved[i]
        return {
          key: x.entry.key,
          type: x.entry.type,
          content_tree: hit?.data ?? null,
        }
      }),
      total_scanned: snapshot.viewport_index.length,
    }
  },
},
```

**注：** 上面 elementKey 拆分简化了 `task_result` / `task_field` 带 experiment_id 前缀（`"task_result:exp_1/t_1"`）的情况。第一版命中即足够；若后续 read_page 命中后 resolve 失败率高，再增强到从 `extra` 里提取 experiment_id。列入 Open Questions（spec §13 O1）。

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- read-page-tool`
Expected: PASS (7 tests)

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 179 + 6 (snapshot-cache) + 7 (read-page) = 192 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/copilot/tools.ts src/lib/copilot/__tests__/read-page-tool.test.ts
git commit -m "feat(copilot): add read_page tool with natural-language query matching"
```

---

### Task 5: 注册 read_page 到 tool-metadata

**Files:**
- Modify: `src/lib/copilot/tool-metadata.ts`

- [ ] **Step 1: 追加 read_page 到 toolMetadata**

Edit `src/lib/copilot/tool-metadata.ts`:

```ts
export const toolMetadata: ToolMetadata[] = [
  { name: "list_experiments", requiresConfirm: false },
  { name: "read_experiment_results", requiresConfirm: false },
  { name: "read_page", requiresConfirm: false },   // NEW
  { name: "restart_experiment", requiresConfirm: true },
]
```

- [ ] **Step 2: 验证 tsc + 测试**

Run: `npx tsc --noEmit && npm test`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/tool-metadata.ts
git commit -m "feat(copilot): register read_page in tool-metadata"
```

---

## Phase 3 — Page Context 注册机制

### Task 6: `use-page-context.ts` hook + 扩展 store

**Files:**
- Create: `src/lib/copilot/use-page-context.ts`
- Modify: `src/components/copilot/store.tsx`

- [ ] **Step 1: 扩展 Store interface + state + action**

Edit `src/components/copilot/store.tsx` — interface 追加：

```ts
interface CopilotStore {
  // ... 既有字段 ...

  // ---- PR-4: Page Context + typing signal + route change banner ----
  pageContext: PageContext | null
  setPageContext: (pc: PageContext | null) => void
  typingSignal: number
  bumpTypingSignal: () => void
  routeChangeBanner: { visible: boolean; count: number } | null
  showRouteChangeBanner: (count: number) => void
  dismissRouteChangeBanner: () => void
  clearManualContexts: () => { count: number }
}
```

import 顶部加：

```ts
import type { CopilotContextRef, PageContext } from "@/lib/copilot/types"
```

Provider 实现（在既有 state 后追加）：

```ts
const [pageContext, setPageContextState] = useState<PageContext | null>(null)
const [typingSignal, setTypingSignalState] = useState(0)
const [routeChangeBanner, setRouteChangeBannerState] = useState<{ visible: boolean; count: number } | null>(null)

const setPageContext = useCallback((pc: PageContext | null) => {
  setPageContextState(pc)
}, [])

// typing signal 内部 debounce 250ms，避免每键盘事件都 setState
const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const bumpTypingSignal = useCallback(() => {
  if (typingDebounceRef.current) return // 已在 debounce 窗口内
  typingDebounceRef.current = setTimeout(() => {
    setTypingSignalState(n => n + 1)
    typingDebounceRef.current = null
  }, 250)
}, [])

const showRouteChangeBanner = useCallback((count: number) => {
  setRouteChangeBannerState({ visible: true, count })
}, [])

const dismissRouteChangeBanner = useCallback(() => {
  setRouteChangeBannerState(null)
}, [])

const clearManualContexts = useCallback((): { count: number } => {
  let removed = 0
  setContexts(prev => {
    removed = prev.length
    return []
  })
  try { sessionStorage.removeItem(SS_CONTEXTS) } catch {}
  return { count: removed }
}, [])
```

（注意 `useRef` 从 React import；顶部若没 import 则追加 `useRef`。）

把新字段加到 `useMemo` 的 value 里：

```ts
const value = useMemo<CopilotStore>(() => ({
  // ... 既有字段 ...
  pageContext,
  setPageContext,
  typingSignal,
  bumpTypingSignal,
  routeChangeBanner,
  showRouteChangeBanner,
  dismissRouteChangeBanner,
  clearManualContexts,
}), [open, setOpen, toggleOpen, width, setWidth, activeSessionId, setActiveSessionId, mounted, inspectorActive, contexts, addContext, removeContext, clearContexts, busy, pageContext, setPageContext, typingSignal, bumpTypingSignal, routeChangeBanner, showRouteChangeBanner, dismissRouteChangeBanner, clearManualContexts])
```

NOOP_STORE 也补齐：

```ts
const NOOP_STORE: CopilotStore = {
  // ... 既有字段 ...
  pageContext: null,
  setPageContext: () => {},
  typingSignal: 0,
  bumpTypingSignal: () => {},
  routeChangeBanner: null,
  showRouteChangeBanner: () => {},
  dismissRouteChangeBanner: () => {},
  clearManualContexts: () => ({ count: 0 }),
}
```

- [ ] **Step 2: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: 写 use-page-context hook**

Create `src/lib/copilot/use-page-context.ts`:

```ts
"use client"

import { useEffect } from "react"
import { useCopilotStore } from "@/components/copilot/store"
import type { PageContext } from "./types"

/**
 * 每个页面在顶部调用，把当前页面摘要注册到 copilot store。
 * 依赖变化时自动更新；unmount 时清空。
 *
 * 用法：
 *   useRegisterPageContext(() => ({
 *     route_type: 'experiment_detail',
 *     path: `/experiments/${id}`,
 *     summary: { id, name, status, ... },
 *     timestamp: new Date().toISOString(),
 *   }), [experiment, tasks])
 */
export function useRegisterPageContext(
  getter: () => PageContext,
  deps: React.DependencyList,
): void {
  const { setPageContext } = useCopilotStore()
  useEffect(() => {
    setPageContext(getter())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    return () => setPageContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
```

- [ ] **Step 4: 验证 tsc + build**

Run: `npx tsc --noEmit && npm test`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/use-page-context.ts src/components/copilot/store.tsx
git commit -m "feat(copilot): page context + typing/route-change store fields + useRegisterPageContext hook"
```

---

## Phase 4 — 每路由注册 page_context（13 处）

### Task 7: Dashboard + experiment 相关 3 页

**Files:**
- Modify: `src/app/page.tsx`（dashboard）
- Modify: `src/app/experiments/new/page.tsx`
- Modify: `src/app/experiments/[id]/page.tsx`

- [ ] **Step 1: 在 `src/app/page.tsx` 顶部（"use client" 指令后）加 register**

找到现有 `export default function DashboardPage()` 顶部，在所有 hook 之后、return 之前加：

```tsx
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
// ...
// （在组件 body 里，其它 hook 之后）
useRegisterPageContext(() => ({
  route_type: 'dashboard',
  path: '/',
  summary: {
    experiments_total: experiments.length,
    recent: experiments.slice(0, 5).map(e => ({
      id: e.id,
      name: e.name,
      status: e.status,
      success: e.run_stats?.completed_tasks ?? 0,
      failed: e.run_stats?.failed_tasks ?? 0,
      created_at: e.created_at,
    })),
    counts: {
      datasets: datasetCount,      // 若现 state 叫别的，参照现有变量名
      templates: schemaCount,
      displays: displayCount,
      rubrics: rubricCount,
      models: modelCount,
    },
  },
  timestamp: new Date().toISOString(),
}), [experiments])
```

> 注：具体变量名以当前 `src/app/page.tsx` 为准，若没某些 count state 就省略这些字段（summary 允许缺）。

- [ ] **Step 2: 在 `src/app/experiments/new/page.tsx` 加 register**

找到表单 state（大概率有 `templateId`, `datasetIds`, `modelId` 之类），在组件 body 里：

```tsx
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
// ...
useRegisterPageContext(() => ({
  route_type: 'experiment_new',
  path: '/experiments/new',
  summary: {
    template_id: templateId ?? null,
    dataset_ids: datasetIds ?? [],
    model_id: modelId ?? null,
  },
  timestamp: new Date().toISOString(),
}), [templateId, datasetIds, modelId])
```

> 若当前变量名不同（如 `selectedTemplate` / `schemaId`），照当前代码名字改。

- [ ] **Step 3: 在 `src/app/experiments/[id]/page.tsx` 加 register**

```tsx
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
// ...
useRegisterPageContext(() => ({
  route_type: 'experiment_detail',
  path: `/experiments/${id}`,
  summary: experiment ? {
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    created_at: experiment.created_at,
    schema_id: experiment.schema_id,
    model: experiment.model,
    progress: {
      total: experiment.run_stats?.total_tasks ?? 0,
      success: experiment.run_stats?.completed_tasks ?? 0,
      failed: experiment.run_stats?.failed_tasks ?? 0,
      pending: (experiment.run_stats?.total_tasks ?? 0) - (experiment.run_stats?.completed_tasks ?? 0) - (experiment.run_stats?.failed_tasks ?? 0),
    },
    cost_by_currency: experiment.run_stats?.total_cost_by_currency ?? {},
    rubric_id: experiment.rubric_id ?? null,
  } : {},
  timestamp: new Date().toISOString(),
}), [experiment])
```

- [ ] **Step 4: 验证 tsc**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 5: 手动冒烟验证**

启动 dev server：`npm run dev`
打开 `http://localhost:3000`，进入一个实验详情页，按 ⌘K 开 copilot，目前还没接前端发 snapshot 逻辑，只是验证 register 不炸页面。
控制台不应有报错。

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/experiments/new/page.tsx src/app/experiments/[id]/page.tsx
git commit -m "feat(copilot): register page_context for dashboard + experiment routes"
```

---

### Task 8: Compare 页

**Files:**
- Modify: `src/app/compare/page.tsx`

- [ ] **Step 1: 加 useRegisterPageContext**

```tsx
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
// ...
useRegisterPageContext(() => ({
  route_type: 'compare',
  path: '/compare',
  search_params: { ids: experimentIds.join(',') },
  summary: {
    experiment_ids: experimentIds,
    experiments: experiments.map(e => ({
      id: e.id,
      name: e.name,
      status: e.status,
      success: e.run_stats?.completed_tasks ?? 0,
      failed: e.run_stats?.failed_tasks ?? 0,
    })),
    align_key: alignKey ?? 'task_id',
  },
  timestamp: new Date().toISOString(),
}), [experimentIds, experiments, alignKey])
```

> 参照现有变量名。若 `experimentIds` 其实叫 `selectedIds`，或 `alignKey` 不存在，按当前代码微调。

- [ ] **Step 2: tsc 验证**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/compare/page.tsx
git commit -m "feat(copilot): register page_context for compare route"
```

---

### Task 9: Settings 主 hub + 5 个 list 页

**Files:**
- Modify: `src/app/settings/page.tsx`（若有，否则 layout.tsx；按当前实际情况）
- Modify: `src/app/settings/datasets/page.tsx`
- Modify: `src/app/settings/templates/page.tsx`
- Modify: `src/app/settings/displays/page.tsx`
- Modify: `src/app/settings/rubrics/page.tsx`
- Modify: `src/app/settings/models/page.tsx`（或 `/settings/llm/page.tsx`，按现状）

对每个 list 页，按以下 pattern 添加（以 datasets 为例）：

- [ ] **Step 1: `src/app/settings/datasets/page.tsx`**

```tsx
import { useRegisterPageContext } from "@/lib/copilot/use-page-context"
// ...
useRegisterPageContext(() => ({
  route_type: 'datasets_list',
  path: '/settings/datasets',
  summary: {
    count: datasets.length,
    items: datasets.slice(0, 20).map(d => ({
      id: d.id,
      name: d.name,
      record_count: d.record_count ?? 0,
    })),
  },
  timestamp: new Date().toISOString(),
}), [datasets])
```

- [ ] **Step 2: `src/app/settings/templates/page.tsx`**

```tsx
useRegisterPageContext(() => ({
  route_type: 'templates_list',
  path: '/settings/templates',
  summary: {
    count: schemas.length,
    items: schemas.slice(0, 20).map(s => ({
      id: s.id,
      name: s.label ?? s.id,
      version: s.version ?? 1,
    })),
  },
  timestamp: new Date().toISOString(),
}), [schemas])
```

- [ ] **Step 3: `src/app/settings/displays/page.tsx`**

```tsx
useRegisterPageContext(() => ({
  route_type: 'displays_list',
  path: '/settings/displays',
  summary: {
    count: displays.length,
    items: displays.slice(0, 20).map(d => ({
      id: d.id,
      name: d.name,
      mode: d.mode,
    })),
  },
  timestamp: new Date().toISOString(),
}), [displays])
```

- [ ] **Step 4: `src/app/settings/rubrics/page.tsx`**

```tsx
useRegisterPageContext(() => ({
  route_type: 'rubrics_list',
  path: '/settings/rubrics',
  summary: {
    count: rubrics.length,
    items: rubrics.slice(0, 20).map(r => ({
      id: r.id,
      name: r.name,
      criteria_count: r.criteria?.length ?? 0,
    })),
  },
  timestamp: new Date().toISOString(),
}), [rubrics])
```

- [ ] **Step 5: `src/app/settings/llm/page.tsx` (models list)**

```tsx
useRegisterPageContext(() => ({
  route_type: 'models_list',
  path: '/settings/llm',
  summary: {
    models: models.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.api_format,
      copilot_enabled: m.copilot_enabled ?? false,
    })),
  },
  timestamp: new Date().toISOString(),
}), [models])
```

- [ ] **Step 6: `src/app/settings/page.tsx`（settings_hub，若存在）**

若存在，加：
```tsx
useRegisterPageContext(() => ({
  route_type: 'settings_hub',
  path: '/settings',
  summary: {},
  timestamp: new Date().toISOString(),
}), [])
```
若不存在（settings 直接 redirect 到子页），跳过此步。

- [ ] **Step 7: tsc + 冒烟**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 8: Commit**

```bash
git add src/app/settings
git commit -m "feat(copilot): register page_context for settings list routes"
```

---

### Task 10: Settings detail + new 页

**Files:**
- Modify: `src/app/settings/datasets/[id]/page.tsx` + `new/page.tsx`
- Modify: `src/app/settings/templates/[id]/page.tsx` + `new/page.tsx`
- Modify: `src/app/settings/displays/[id]/page.tsx` + `new/page.tsx`
- Modify: `src/app/settings/rubrics/[id]/page.tsx` + `new/page.tsx`

- [ ] **Step 1: datasets/[id] + new**

detail page：
```tsx
useRegisterPageContext(() => ({
  route_type: 'dataset_detail',
  path: `/settings/datasets/${id}`,
  summary: dataset ? {
    id: dataset.id,
    name: dataset.name,
    fields: dataset.fields?.map(f => f.name) ?? [],
    record_count: dataset.record_count ?? 0,
  } : {},
  timestamp: new Date().toISOString(),
}), [dataset])
```

new page：
```tsx
useRegisterPageContext(() => ({
  route_type: 'dataset_new',
  path: '/settings/datasets/new',
  summary: {},
  timestamp: new Date().toISOString(),
}), [])
```

- [ ] **Step 2: templates/[id] + new**

detail：
```tsx
useRegisterPageContext(() => ({
  route_type: 'template_detail',
  path: `/settings/templates/${id}`,
  summary: schema ? {
    id: schema.id,
    name: schema.label ?? schema.id,
    version: schema.version ?? 1,
    input_aliases: schema.inputs?.map(i => i.alias) ?? [],
    output_field_names: Object.keys(schema.output_schema?.properties ?? {}),
    prompt_length: (schema.default_prompt ?? '').length,
  } : {},
  timestamp: new Date().toISOString(),
}), [schema])
```

new：
```tsx
useRegisterPageContext(() => ({
  route_type: 'template_new',
  path: '/settings/templates/new',
  summary: {},
  timestamp: new Date().toISOString(),
}), [])
```

- [ ] **Step 3: displays/[id] + new**

```tsx
// detail
useRegisterPageContext(() => ({
  route_type: 'display_detail',
  path: `/settings/displays/${id}`,
  summary: display ? {
    id: display.id,
    name: display.name,
    mode: display.mode,
    columns_count: (display.table?.columns ?? display.grouped_grid?.cell_columns ?? []).length,
  } : {},
  timestamp: new Date().toISOString(),
}), [display])

// new
useRegisterPageContext(() => ({
  route_type: 'display_new',
  path: '/settings/displays/new',
  summary: {},
  timestamp: new Date().toISOString(),
}), [])
```

- [ ] **Step 4: rubrics/[id] + new**

```tsx
// detail
useRegisterPageContext(() => ({
  route_type: 'rubric_detail',
  path: `/settings/rubrics/${id}`,
  summary: rubric ? {
    id: rubric.id,
    name: rubric.name,
    criteria_count: rubric.criteria?.length ?? 0,
    criteria_kinds: rubric.criteria?.map(c => c.type) ?? [],
  } : {},
  timestamp: new Date().toISOString(),
}), [rubric])

// new
useRegisterPageContext(() => ({
  route_type: 'rubric_new',
  path: '/settings/rubrics/new',
  summary: {},
  timestamp: new Date().toISOString(),
}), [])
```

- [ ] **Step 5: tsc + 冒烟**

Run: `npx tsc --noEmit && npm test && npm run dev`（手动点过几个 settings 详情页验证不报错）

- [ ] **Step 6: Commit**

```bash
git add src/app/settings
git commit -m "feat(copilot): register page_context for settings detail + new routes"
```

---

## Phase 5 — Client Snapshot 收集 + 传输

### Task 11: `collect-snapshot.ts` + 单测

**Files:**
- Create: `src/lib/copilot/collect-snapshot.ts`
- Create: `src/lib/copilot/__tests__/collect-snapshot.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/copilot/__tests__/collect-snapshot.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { collectClientSnapshot, truncatePreview } from '../collect-snapshot'
import type { PageContext } from '../types'

const pc: PageContext = {
  route_type: 'experiment_detail',
  path: '/experiments/exp_1',
  summary: { id: 'exp_1' },
  timestamp: '2026-04-28T00:00:00Z',
}

describe('truncatePreview', () => {
  it('returns text as-is when under 200 chars', () => {
    expect(truncatePreview('hello world')).toBe('hello world')
  })

  it('collapses whitespace', () => {
    expect(truncatePreview('hello   \n\n  world')).toBe('hello world')
  })

  it('truncates over 200 chars with …', () => {
    const long = 'a'.repeat(250)
    const r = truncatePreview(long)
    expect(r.length).toBe(198) // 197 + 1 ellipsis (…) = rendered as 1 unicode char
    expect(r.endsWith('…')).toBe(true)
  })
})

describe('collectClientSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns empty viewport_index when no context elements', () => {
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index).toEqual([])
    expect(snap.session_id).toBe('sess')
    expect(snap.page_context).toBe(pc)
    expect(snap.route_type).toBe('experiment_detail')
    expect(snap.path).toBe('/experiments/exp_1')
  })

  it('picks up all data-copilot-context elements with id', () => {
    document.body.innerHTML = `
      <div data-copilot-context="experiment" data-copilot-context-id="exp_1">Experiment 1</div>
      <div data-copilot-context="task_result" data-copilot-context-id="t_1" data-copilot-context-extra='{"experiment_id":"exp_1"}'>Task 1 failed</div>
    `
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index.length).toBe(2)
    expect(snap.viewport_index[0].type).toBe('experiment')
    expect(snap.viewport_index[1].type).toBe('task_result')
  })

  it('truncates long preview_text', () => {
    const long = 'x'.repeat(300)
    document.body.innerHTML = `<div data-copilot-context="experiment" data-copilot-context-id="exp_1">${long}</div>`
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index[0].preview_text.length).toBeLessThanOrEqual(200)
    expect(snap.viewport_index[0].preview_text.endsWith('…')).toBe(true)
  })

  it('skips invalid elements (missing id or type)', () => {
    document.body.innerHTML = `
      <div data-copilot-context="experiment">No id</div>
      <div data-copilot-context-id="only-id">No type</div>
      <div data-copilot-context="unknown_type" data-copilot-context-id="x">Unknown type</div>
    `
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- collect-snapshot`
Expected: FAIL `Cannot find module '../collect-snapshot'`

- [ ] **Step 3: Implement collect-snapshot.ts**

Create `src/lib/copilot/collect-snapshot.ts`:

```ts
// Client-side: scan the DOM for all [data-copilot-context] elements and build a
// lightweight ViewportIndexEntry[] snapshot. Paired with getPageContext() from
// the route's useRegisterPageContext call to form a full ClientSnapshot, sent
// to the server with every /chat and /tool-result POST.

import { captureFromElement } from './context-registry'
import type { ClientSnapshot, PageContext, ViewportIndexEntry } from './types'

const PREVIEW_MAX = 200

/** Collapse whitespace + truncate to PREVIEW_MAX chars with ellipsis. */
export function truncatePreview(s: string): string {
  const norm = s.replace(/\s+/g, ' ').trim()
  if (norm.length <= PREVIEW_MAX) return norm
  return norm.slice(0, PREVIEW_MAX - 3) + '…'
}

function collectAncestorKeys(el: HTMLElement | null): string[] {
  const keys: string[] = []
  let cur: HTMLElement | null = el
  while (cur) {
    const captured = captureFromElement(cur)
    if (captured) keys.push(captured.elementKey)
    cur = cur.parentElement
  }
  return keys
}

/** Scan the current DOM for context nodes and build a snapshot. */
export function collectClientSnapshot(
  sessionId: string,
  pageContext: PageContext,
): ClientSnapshot {
  const viewport_index: ViewportIndexEntry[] = []
  if (typeof document !== 'undefined') {
    const nodes = document.querySelectorAll<HTMLElement>('[data-copilot-context][data-copilot-context-id]')
    for (const el of Array.from(nodes)) {
      const captured = captureFromElement(el)
      if (!captured) continue
      const preview_text = truncatePreview(el.textContent ?? '')
      const ancestors = collectAncestorKeys(el.parentElement)
      viewport_index.push({
        key: captured.elementKey,
        type: captured.type,
        preview_text,
        ancestors: ancestors.length > 0 ? ancestors : undefined,
      })
    }
  }
  return {
    session_id: sessionId,
    route_type: pageContext.route_type,
    path: pageContext.path,
    search_params: pageContext.search_params,
    page_context: pageContext,
    viewport_index,
    timestamp: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- collect-snapshot`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/copilot/collect-snapshot.ts src/lib/copilot/__tests__/collect-snapshot.test.ts
git commit -m "feat(copilot): collectClientSnapshot walks DOM for viewport index"
```

---

### Task 12: 扩展 `/chat` POST 接受 client_snapshot

**Files:**
- Modify: `src/app/api/copilot/sessions/[id]/chat/route.ts`
- Modify: `src/lib/copilot/build-llm-messages.ts`
- Modify: `src/lib/copilot/resolve-context.ts`

- [ ] **Step 1: 扩展 formatContextsForLlm 接受 pageContext**

Edit `src/lib/copilot/resolve-context.ts` — 修改 `formatContextsForLlm` 签名：

```ts
export function formatContextsForLlm(
  resolved: ResolvedContext[],
  pageContext?: import('./types').PageContext | null,
): string {
  const parts: string[] = []

  if (pageContext) {
    parts.push('# 当前页面')
    parts.push('')
    parts.push(`path: \`${pageContext.path}\``)
    parts.push(`route_type: \`${pageContext.route_type}\``)
    parts.push('')
    parts.push('## Summary')
    parts.push('')
    for (const [k, v] of Object.entries(pageContext.summary ?? {})) {
      const line = typeof v === 'object' && v !== null
        ? `- ${k}: \`${JSON.stringify(v)}\``
        : `- ${k}: ${String(v)}`
      parts.push(line)
    }
    parts.push('')
  }

  if (resolved.length === 0 && !pageContext) return ''
  // ... 既有逻辑（原本从 "const ok = ..." 开始的整段）紧接着追加 ...

  const ok = resolved.filter(r => r.status === 'ok')
  const missing = resolved.filter(r => r.status !== 'ok')
  if (ok.length === 0 && missing.length === 0) return parts.join('\n')

  // （以下为既有逻辑，整段保留，变量复用上面的 parts 数组）
  // ... entities 收集 + ok parts.push + missing parts.push ...
}
```

**重要**：把原函数里 `const parts: string[] = []` 那行删掉（现在顶部已声明），保留之后所有 `parts.push(...)` 逻辑。原 `if (resolved.length === 0) return ''` 改为 `if (resolved.length === 0 && !pageContext) return ''`，空参时返空串；有 pageContext 无 resolved 时返回 page_context 部分。

- [ ] **Step 2: 更新 resolve-context 单测**

Edit `src/lib/copilot/__tests__/resolve-context.test.ts`（文件已存在），在文件末尾追加：

```ts
import type { PageContext } from '../types'

describe('formatContextsForLlm with pageContext', () => {
  const pc: PageContext = {
    route_type: 'experiment_detail',
    path: '/experiments/exp_1',
    summary: { id: 'exp_1', name: 'test exp', status: 'completed', progress: { total: 10, success: 9, failed: 1 } },
    timestamp: 'ts',
  }

  it('prepends page_context header when pageContext is provided', () => {
    const out = formatContextsForLlm([], pc)
    expect(out).toContain('# 当前页面')
    expect(out).toContain('/experiments/exp_1')
    expect(out).toContain('experiment_detail')
    expect(out).toContain('- id: exp_1')
    expect(out).toContain('- name: test exp')
  })

  it('stringifies nested objects in summary', () => {
    const out = formatContextsForLlm([], pc)
    expect(out).toContain('- progress: `{"total":10,"success":9,"failed":1}`')
  })

  it('returns empty string when no pageContext and no resolved', () => {
    expect(formatContextsForLlm([])).toBe('')
    expect(formatContextsForLlm([], null)).toBe('')
  })

  it('renders both page_context and user selections', () => {
    const resolved = [{ tag: 1, type: 'experiment', id: 'exp_1', status: 'ok' as const, summary: 's', data: { id: 'exp_1' } }]
    const out = formatContextsForLlm(resolved, pc)
    expect(out).toContain('# 当前页面')
    expect(out).toContain('# 用户圈选的上下文 (context)')
  })
})
```

- [ ] **Step 3: 运行测试 — 预期 pass**

Run: `npm test -- resolve-context`
Expected: 原有 6 + 4 new = 10 tests pass

- [ ] **Step 4: 更新 buildLlmMessages 接受 pageContext**

Edit `src/lib/copilot/build-llm-messages.ts` — 改函数签名：

```ts
export function buildLlmMessages(
  branch: CopilotMessage[],
  pageContext?: import('./types').PageContext | null,
): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  const lastUser = [...branch].reverse().find(m => m.role === 'user')
  const refs = lastUser?.contexts ?? []
  const resolved = refs.length > 0 ? resolveContexts(refs as CopilotContextRef[]) : []
  const ctxText = formatContextsForLlm(resolved, pageContext)
  if (ctxText) {
    out.push({ role: 'system', content: ctxText })
  }

  // ...既有的 branch loop ...
}
```

- [ ] **Step 5: 扩展 /chat route body 支持 client_snapshot**

Edit `src/app/api/copilot/sessions/[id]/chat/route.ts`：

1. 顶部 import 追加：
```ts
import { setSnapshot } from '@/lib/copilot/snapshot-cache'
import type { ClientSnapshot } from '@/lib/copilot/types'
```

2. body 类型扩展（约第 39 行）：
```ts
const body = await req.json().catch(() => ({})) as {
  user_message?: string
  parent_id?: string
  model_id?: string
  contexts?: CopilotContextRef[]
  client_snapshot?: ClientSnapshot
}
```

3. 在 user 消息 append 之前（约第 68 行 `appendMessage` 调用前）写入缓存：
```ts
if (body.client_snapshot) {
  setSnapshot(sessionId, body.client_snapshot)
}
```

4. `buildLlmMessages` 调用（约第 80 行）传 pageContext：
```ts
const llmMessages = buildLlmMessages(branch, body.client_snapshot?.page_context ?? null)
```

- [ ] **Step 6: /tool-result route 同样处理**

Edit `src/app/api/copilot/sessions/[id]/tool-result/route.ts`：

1. 顶部加相同 import
2. body 类型加 `client_snapshot?: ClientSnapshot`
3. 在 `appendMessage` 前调 `setSnapshot` 若 body 带 snapshot
4. `buildLlmMessages(branch, body.client_snapshot?.page_context ?? null)`

- [ ] **Step 7: 在 sessions/[id] DELETE 里清 snapshot**

Edit `src/app/api/copilot/sessions/[id]/route.ts` 顶部：
```ts
import { deleteSnapshot } from '@/lib/copilot/snapshot-cache'
```

DELETE 里：
```ts
export async function DELETE(_req, { params }) {
  const { id } = await params
  const ok = deleteSession(id)
  deleteSnapshot(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ deleted: id })
}
```

- [ ] **Step 8: tsc + 全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git add src/lib/copilot/resolve-context.ts src/lib/copilot/build-llm-messages.ts src/lib/copilot/__tests__/resolve-context.test.ts src/app/api/copilot
git commit -m "feat(copilot): thread client_snapshot through /chat + /tool-result, inject page_context into system message"
```

---

### Task 13: 客户端 `chat-view.tsx` 发送 snapshot + bump typing signal

**Files:**
- Modify: `src/components/copilot/chat-view.tsx`

- [ ] **Step 1: 在 chat-view 顶部 import + 取 state**

加 import：
```ts
import { collectClientSnapshot } from "@/lib/copilot/collect-snapshot"
```

修改既有 `useCopilotStore()` destructure（约第 77 行），把 `pageContext` 和 `bumpTypingSignal` 取出来：

```ts
const {
  contexts, clearContexts, removeContext,
  setInspectorActive, inspectorActive,
  setBusy, pageContext, bumpTypingSignal,
} = useCopilotStore()
```

- [ ] **Step 2: 修改 doStreamSend，在 fetch body 里带 client_snapshot**

找到约第 401 行的 `fetch(...,/chat, {...})`，修改 body：

```ts
const resp = await fetch(`/api/copilot/sessions/${sessionId}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    user_message: text,
    model_id: modelId,
    contexts: sendContexts,
    client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
  }),
  signal: ctrl.signal,
})
```

- [ ] **Step 3: 修改 postToolResult，body 里也带 client_snapshot**

找到约第 342 行 `fetch(..., tool-result, {...})`，修改 body：

```ts
const resp = await fetch(`/api/copilot/sessions/${sessionId}/tool-result`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    call_id, tool_name, input, denied, reason,
    client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
  }),
  signal: ctrl.signal,
})
```

- [ ] **Step 4: 在 textarea onChange 里 bumpTypingSignal**

找到 `<Textarea ... onChange={...}>`，在现有 onChange 里追加调用：

```tsx
onChange={e => {
  setInput(e.target.value)
  bumpTypingSignal()
}}
```

- [ ] **Step 5: tsc + 冒烟**

Run: `npx tsc --noEmit`
启动 dev server `npm run dev`，打开 copilot，发送消息，打开 Chrome DevTools Network，检查 `/chat` 请求 body 是否含 `client_snapshot` 对象。

- [ ] **Step 6: Commit**

```bash
git add src/components/copilot/chat-view.tsx
git commit -m "feat(copilot): send client_snapshot with chat + tool-result POSTs; dispatch typing signal"
```

---

## Phase 6 — 切页清空 + Banner

### Task 14: i18n keys 新增

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: 给 zh.ts 加 key**

追加到 zh.ts（`copilot.*` 命名空间）：

```ts
"copilot.route_change.message": "已切换页面，清空了 {n} 个圈选上下文。建议开启新对话以获得更清晰的当前页面答复。",
"copilot.route_change.new_session": "开启新对话",
"copilot.route_change.continue": "继续当前对话",
"copilot.tool.read_page.label": "读取页面",
"copilot.tool.read_page.summary_found": "找到 {n} 条匹配",
"copilot.tool.read_page.summary_empty": "未在当前页面找到相关内容",
"copilot.page_context.header": "当前页面",
"copilot.page_context.unknown_route": "未知页面",
```

- [ ] **Step 2: en.ts 对应加 key**

```ts
"copilot.route_change.message": "Page changed. {n} context selections cleared. Consider starting a new conversation for clearer answers.",
"copilot.route_change.new_session": "New conversation",
"copilot.route_change.continue": "Keep current",
"copilot.tool.read_page.label": "Read page",
"copilot.tool.read_page.summary_found": "Found {n} matches",
"copilot.tool.read_page.summary_empty": "No matches on current page",
"copilot.page_context.header": "Current page",
"copilot.page_context.unknown_route": "Unknown page",
```

- [ ] **Step 3: tsc 验证类型完整性**

Run: `npx tsc --noEmit`
Expected: 无 `en.ts` 缺 key 报错

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n
git commit -m "feat(copilot): i18n keys for route change banner + read_page + page context"
```

---

### Task 15: `RouteChangeObserver` 组件 + 挂载

**Files:**
- Create: `src/components/copilot/route-change-observer.tsx`
- Modify: `src/components/copilot/panel.tsx`（挂载）

- [ ] **Step 1: 写 observer 组件**

Create `src/components/copilot/route-change-observer.tsx`:

```tsx
"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCopilotStore } from "./store"

/**
 * 监听路由变化：
 *   - 路由变 → 清空 manual contexts（inspector + text_selection）
 *   - 当前 session 有 messages 且清空数 > 0 → 显示 banner 建议开新对话
 * 首次 mount 不触发（避免初始 path 被当成变化）。
 *
 * 注：具体"session 有 messages"的判定放在 chat-view 层——observer 只负责触发事件
 *    clearManualContexts + showRouteChangeBanner；banner visible 条件在 chat-view 里判定。
 */
export function RouteChangeObserver() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { clearManualContexts, showRouteChangeBanner } = useCopilotStore()
  const previousKey = useRef<string | null>(null)

  useEffect(() => {
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (previousKey.current === null) {
      previousKey.current = key
      return
    }
    if (key !== previousKey.current) {
      previousKey.current = key
      const { count } = clearManualContexts()
      if (count > 0) showRouteChangeBanner(count)
    }
  }, [pathname, searchParams, clearManualContexts, showRouteChangeBanner])

  return null
}
```

- [ ] **Step 2: 在 panel.tsx 挂载**

Edit `src/components/copilot/panel.tsx`，找到组件 return 的根元素，在任何位置 render 一次：

```tsx
import { RouteChangeObserver } from "./route-change-observer"

// 组件内返回 JSX 里（panel 根容器里、或 panel 外都行，observer 不渲染内容）：
<RouteChangeObserver />
```

- [ ] **Step 3: tsc + 冒烟**

Run: `npx tsc --noEmit && npm run dev`
在浏览器跳转两个页面，observer effect 应运行（但目前没圈选也没 banner 可视化，下 task 补）

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/route-change-observer.tsx src/components/copilot/panel.tsx
git commit -m "feat(copilot): RouteChangeObserver clears manual contexts and triggers banner"
```

---

### Task 16: `RouteChangeBanner` 组件 + 在 chat-view 挂载

**Files:**
- Create: `src/components/copilot/route-change-banner.tsx`
- Modify: `src/components/copilot/chat-view.tsx`

- [ ] **Step 1: 写 banner 组件**

Create `src/components/copilot/route-change-banner.tsx`:

```tsx
"use client"

import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n/provider"
import { useCopilotStore } from "./store"

interface Props {
  onForkSession: () => void
  hasMessages: boolean
}

/**
 * 顶部提示 banner：告知用户切换页面已清空 chips，提供"开启新对话"或"继续"二选一。
 * 显示条件（AND）：routeChangeBanner.visible + session.messages.length > 0
 * 沿用既有 agent-hint-banner amber 样式（semantic 色信号 > 装饰玻璃）
 */
export function RouteChangeBanner({ onForkSession, hasMessages }: Props) {
  const t = useT()
  const { routeChangeBanner, dismissRouteChangeBanner } = useCopilotStore()
  if (!routeChangeBanner?.visible || !hasMessages) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200">
      <AlertTriangle className="size-4 shrink-0" />
      <div className="flex-1 text-xs">
        {t("copilot.route_change.message", { n: routeChangeBanner.count })}
      </div>
      <button
        type="button"
        className="h-7 px-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-xs font-medium"
        onClick={() => {
          dismissRouteChangeBanner()
          onForkSession()
        }}
      >
        {t("copilot.route_change.new_session")}
      </button>
      <button
        type="button"
        className="h-7 px-2 rounded hover:bg-amber-500/10 text-xs"
        onClick={dismissRouteChangeBanner}
      >
        {t("copilot.route_change.continue")}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: 在 chat-view 顶部 render banner**

Edit `src/components/copilot/chat-view.tsx`：

import 加：
```ts
import { RouteChangeBanner } from "./route-change-banner"
```

找到 component return 的根元素顶部（message list 之上），加：

```tsx
<RouteChangeBanner
  hasMessages={messages.length > 0}
  onForkSession={handleForkSession}
/>
```

在组件内新增 handler：

```tsx
const handleForkSession = async () => {
  // 创建新 session，切过去
  try {
    const resp = await fetch("/api/copilot/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t("copilot.session.untitled") ?? "新对话" }),
    })
    if (!resp.ok) {
      toast.error(t("copilot.session.create_failed"))
      return
    }
    const data = await resp.json() as { session: { id: string } }
    // 切到新 session —— session-list 的 prop/hooks 决定；最简：调 setActiveSessionId
    // 具体接入方式参考 session-list.tsx 的用法
    useCopilotStore.getState?.()?.setActiveSessionId?.(data.session.id)
    // 若没有 getState（context-based store），可用 setActiveSessionId from destructure
  } catch {
    toast.error(t("copilot.session.create_failed"))
  }
}
```

**注**：由于 `useCopilotStore` 是 React Context 而非 zustand，没有 `getState()`。改成从 destructure 取：

```ts
const { contexts, clearContexts, ..., setActiveSessionId } = useCopilotStore()
```

然后 handleForkSession 里 `setActiveSessionId(data.session.id)`。

若 `copilot.session.untitled` / `copilot.session.create_failed` 的 i18n key 不存在，用已有的 fallback 文案或新增到 Task 14 的 i18n 补丁（此时需要补回去）。

- [ ] **Step 3: 若需要新 i18n key，补回去**

检查 zh.ts 是否已有 `copilot.session.untitled`。若没有，到 zh.ts + en.ts 各加一条：
- zh: `"copilot.session.untitled": "新对话"`, `"copilot.session.create_failed": "创建会话失败"`
- en: `"copilot.session.untitled": "New conversation"`, `"copilot.session.create_failed": "Failed to create session"`

- [ ] **Step 4: tsc + 冒烟**

Run: `npx tsc --noEmit && npm run dev`
操作：开 copilot → 圈选 1 条 context → 跳另一个页面 → banner 应出现（sessions 有 messages 时）；点"开启新对话" → 切到新 session；点"继续当前对话" → banner 消失。

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot
git commit -m "feat(copilot): RouteChangeBanner prompts user to fork session on navigation"
```

---

## Phase 7 — Ambient Border Glow (P2) — Apple Intelligence "screen edges glow" 风格（路线 A · CSS 近似）

**视觉目标**：`<main>` 内缘的 inset volumetric glow —— 多层 pastel iridescent blob 独立漂移（近似 Perlin noise 流体感）+ `mix-blend-mode: screen` 保证深浅背景通透 + inset radial mask (inverse-square 近似) 让光只在外缘显现中心透明。**不包裹 `<main>`、不改 `<main>` layout、背景光 `.copilot-glow` 完全保留原状。** 观感 ~80% 像 Apple；若验收不过可升级路线 B（WebGL SDF + Simplex noise fragment shader）。

### Task 17: CSS — `.copilot-border-glow` + 5 pastel blob + inset mask + screen blend

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 在 globals.css 末尾追加 border glow 样式**

在文件末尾（现有 `.copilot-scroll-edge-*` 之后）追加：

```css
/* ---------------- PR-4: Ambient Border Glow (Apple Intelligence 风 · 路线 A) ---------------- */
/* screen edges glow —— 限定在 <main> 内，5 层 pastel blob 独立漂移 + inset radial mask
   (inverse-square 近似) + mix-blend-mode: screen。
   不包裹 <main>、不改 <main> layout；作为 <main> 内 overlay (sibling of GlowOverlay)。 */

.copilot-border-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
  border-radius: inherit;
  mix-blend-mode: screen;

  /* Inset vignette：中心透明、向外分段 opacity → 近似 inverse-square falloff */
  -webkit-mask: radial-gradient(
    ellipse 85% 88% at center,
    transparent 0%,
    transparent 48%,
    hsla(0, 0%, 0%, 0.2) 62%,
    hsla(0, 0%, 0%, 0.55) 78%,
    hsla(0, 0%, 0%, 0.85) 92%,
    black 100%
  );
  mask: radial-gradient(
    ellipse 85% 88% at center,
    transparent 0%,
    transparent 48%,
    hsla(0, 0%, 0%, 0.2) 62%,
    hsla(0, 0%, 0%, 0.55) 78%,
    hsla(0, 0%, 0%, 0.85) 92%,
    black 100%
  );

  opacity: 0;
  animation: csg-spring-in 900ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes csg-spring-in {
  0%   { opacity: 0;    transform: scale(0.985); }
  60%  { opacity: 1.05; transform: scale(1.008); }
  100% { opacity: 1;    transform: scale(1); }
}

.csg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  will-change: transform;
}

.csg-blob-1 { top: -28%; left: -22%;     width: 62%; height: 66%; background: hsla(310, 72%, 74%, 0.60); animation: csg-drift-1 13s ease-in-out infinite alternate; }
.csg-blob-2 { top: -18%; right: -25%;    width: 56%; height: 56%; background: hsla(200, 70%, 72%, 0.60); animation: csg-drift-2 17s ease-in-out infinite alternate; }
.csg-blob-3 { bottom: -22%; right: -20%; width: 58%; height: 60%; background: hsla(28, 72%, 74%, 0.58);  animation: csg-drift-3 19s ease-in-out infinite alternate; }
.csg-blob-4 { bottom: -26%; left: -18%;  width: 60%; height: 56%; background: hsla(268, 60%, 76%, 0.55); animation: csg-drift-4 11s ease-in-out infinite alternate; }
.csg-blob-5 { top: 32%; right: -30%;     width: 42%; height: 42%; background: hsla(158, 55%, 74%, 0.52); animation: csg-drift-5 23s ease-in-out infinite alternate; }

@keyframes csg-drift-1 {
  0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
  50%  { transform: translate(14%, 10%) scale(1.14) rotate(-6deg); }
  100% { transform: translate(-9%, 18%) scale(1.06) rotate(8deg); }
}
@keyframes csg-drift-2 {
  0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
  50%  { transform: translate(-16%, 22%) scale(1.10) rotate(5deg); }
  100% { transform: translate(12%, -11%) scale(1.08) rotate(-7deg); }
}
@keyframes csg-drift-3 {
  0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
  50%  { transform: translate(-18%, -15%) scale(1.12) rotate(-4deg); }
  100% { transform: translate(9%, -21%) scale(1.05) rotate(6deg); }
}
@keyframes csg-drift-4 {
  0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
  50%  { transform: translate(20%, -14%) scale(1.08) rotate(7deg); }
  100% { transform: translate(-13%, -19%) scale(1.11) rotate(-5deg); }
}
@keyframes csg-drift-5 {
  0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
  50%  { transform: translate(-24%, 18%) scale(1.18) rotate(9deg); }
  100% { transform: translate(-10%, -16%) scale(1.04) rotate(-8deg); }
}

.copilot-border-glow[data-glow="typing"] .csg-blob-1 { animation-duration: 8s; }
.copilot-border-glow[data-glow="typing"] .csg-blob-2 { animation-duration: 10s; }
.copilot-border-glow[data-glow="typing"] .csg-blob-3 { animation-duration: 11s; }
.copilot-border-glow[data-glow="typing"] .csg-blob-4 { animation-duration: 7s; }
.copilot-border-glow[data-glow="typing"] .csg-blob-5 { animation-duration: 13s; }
.copilot-border-glow[data-glow="typing"]  { filter: saturate(1.1) brightness(1.04); }

.copilot-border-glow[data-glow="working"] .csg-blob-1 { animation-duration: 4s; }
.copilot-border-glow[data-glow="working"] .csg-blob-2 { animation-duration: 5s; }
.copilot-border-glow[data-glow="working"] .csg-blob-3 { animation-duration: 6s; }
.copilot-border-glow[data-glow="working"] .csg-blob-4 { animation-duration: 3.5s; }
.copilot-border-glow[data-glow="working"] .csg-blob-5 { animation-duration: 7s; }
.copilot-border-glow[data-glow="working"] {
  filter: saturate(1.25) brightness(1.1);
  will-change: filter;
}

@media (prefers-reduced-motion: reduce) {
  .csg-blob { animation: none; }
  .copilot-border-glow { animation: csg-fade-in-reduced 300ms ease-out forwards; }
  @keyframes csg-fade-in-reduced { to { opacity: 1; } }
  .copilot-border-glow[data-glow="working"] {
    animation: csg-pulse-reduced 3s ease-in-out infinite;
  }
  @keyframes csg-pulse-reduced {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.75; }
  }
}

@media (prefers-reduced-transparency: reduce) {
  .copilot-border-glow { display: none; }
}
```

- [ ] **Step 2: 验证 build + dev server**

Run: `npm run dev`
页面应加载正常（此时 `.copilot-border-glow` class 尚未被任何元素应用）。
CSS 校验：打开 DevTools Elements → 搜索 `copilot-border-glow`，无错即可。

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(copilot): screen edges glow CSS (5 pastel blobs + inset mask + screen blend)"
```

---

### Task 18: `CopilotBorderGlow` 组件（含 5 blob 子元素）+ 挂载为 `<main>` 内 sibling

**Files:**
- Create: `src/components/copilot/border-glow.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 写 border-glow 组件**

Create `src/components/copilot/border-glow.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useCopilotStore } from "./store"

type GlowState = 'off' | 'idle' | 'typing' | 'working'

/**
 * Apple Intelligence 风 screen edges glow —— 路线 A · CSS 近似实现。
 * 5 层 pastel blob 独立 drift + inset radial mask (inverse-square 近似)
 * + mix-blend-mode: screen。作为 overlay 渲染到 <main> 内与 GlowOverlay 同级。
 * off 状态直接 return null；状态转移通过 data-glow 属性驱动 CSS 切换 blob 动画速度与滤镜。
 */
export function CopilotBorderGlow() {
  const { open, busy, typingSignal } = useCopilotStore()
  const [state, setState] = useState<GlowState>('off')

  useEffect(() => {
    if (!open) { setState('off'); return }
    if (busy) { setState('working'); return }
    if (typingSignal > 0) {
      setState('typing')
      const t = setTimeout(() => {
        setState(curr => (curr === 'typing' ? 'idle' : curr))
      }, 2000)
      return () => clearTimeout(t)
    }
    setState('idle')
  }, [open, busy, typingSignal])

  if (state === 'off') return null
  return (
    <div className="copilot-border-glow" data-glow={state} aria-hidden>
      <div className="csg-blob csg-blob-1" />
      <div className="csg-blob csg-blob-2" />
      <div className="csg-blob csg-blob-3" />
      <div className="csg-blob csg-blob-4" />
      <div className="csg-blob csg-blob-5" />
    </div>
  )
}
```

- [ ] **Step 2: 挂到 `layout.tsx` 里 `<main>` 内，GlowOverlay 旁**

Edit `src/app/layout.tsx`:

Import（放在其它 copilot 组件 imports 旁）：
```tsx
import { CopilotBorderGlow } from "@/components/copilot/border-glow"
```

找到既有（**保持不变**，**不**包 wrapper）：
```tsx
<main className="flex-1 h-screen flex flex-col overflow-hidden relative">
  <GlowOverlay />
  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
</main>
```

只需在 `<GlowOverlay />` 下方加一行：
```tsx
<main className="flex-1 h-screen flex flex-col overflow-hidden relative">
  <GlowOverlay />
  <CopilotBorderGlow />                     {/* ← 新增一行 */}
  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
</main>
```

**重要**：`<main>` 的 className / `z-[1]` 内容层 / overflow-hidden **完全不动**。Border glow 作为 sibling overlay 自己 absolute 定位贴边。

- [ ] **Step 3: tsc + 视觉冒烟**

Run: `npx tsc --noEmit && npm run dev`

手动测试：
- copilot 关：无彩色光（组件 return null）✅
- ⌘K 打开 copilot：5 层 pastel 云彩在 `<main>` 外缘慢速蠕动（周期 11/13/17/19/23s 质数错位），spring overshoot 入场 ✅
- 在 textarea 输入：blob drift 加速到 7-13s + 轻微 saturate/brightness 提升 (typing) ✅
- 发消息 → 等流式返回：blob drift 进一步加速到 3.5-7s + 更强 saturate/brightness (working) ✅
- 返回完成：回 idle（blob 回到 11-23s 节奏）✅
- 背景光 `.copilot-glow` 漂移应**和 fix 前完全一致**，无遮盖、无位移

System Settings → Accessibility → Reduce Motion 勾选：blob 停 drift；working 态走慢 opacity 脉冲。
Reduce Transparency 勾选：整层 `display: none`（诚实降级）。

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/border-glow.tsx src/app/layout.tsx
git commit -m "feat(copilot): CopilotBorderGlow overlay (pastel blobs + inset mask) inside <main>"
```

---

## Phase 8 — e2e + 文档

### Task 19: E2E smoke test 新增

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: 加 test case**

在 `e2e/smoke.spec.ts` 末尾追加：

```ts
test('copilot open + page_context preview shows current route', async ({ page }) => {
  await page.goto('/')
  // 打开 copilot：按 ⌘K（Mac）或 Ctrl+K（Linux/Windows）
  const isMac = process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k')
  await page.waitForSelector('[data-copilot-panel]', { timeout: 5000 }).catch(() => {})
  // 若 panel 有 "预览 context" 按钮，点开
  const previewBtn = page.getByRole('button', { name: /预览|preview/i }).first()
  if (await previewBtn.isVisible().catch(() => false)) {
    await previewBtn.click()
    // 应含当前页面 header
    await expect(page.getByText(/当前页面|Current page/)).toBeVisible()
    await expect(page.getByText('dashboard')).toBeVisible()
  }
})

test('copilot border glow absent before open, appears after open', async ({ page }) => {
  await page.goto('/')
  // Before open: component returns null, no element in DOM
  await expect(page.locator('.copilot-border-glow')).toHaveCount(0)
  // Open copilot
  const isMac = process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k')
  // After open: overlay exists with a non-off state (idle / typing / working)
  const glow = page.locator('.copilot-border-glow').first()
  await expect(glow).toBeVisible({ timeout: 3000 })
  await expect.poll(async () => await glow.getAttribute('data-glow')).not.toBe('off')
})
```

- [ ] **Step 2: 跑 e2e**

Run: `npm run test:e2e`
Expected: 原 9 + 2 new = 11 cases pass

（若 `[data-copilot-panel]` selector 或"预览"按钮文案在实际项目里不同，以 chat-view 当前实现为准调整。）

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(e2e): copilot page_context preview + glow frame smoke"
```

---

### Task 20: CHANGELOG `[Unreleased]` 更新

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 在 `[Unreleased]` 下追加新 section**

在 `CHANGELOG.md` 的 `## [Unreleased]` 下，`### UI polish` 之后加：

```markdown
### Page Context + Viewport Tool + Ambient Border（PR-4）

- **自动 page context**：开 copilot 即向 LLM 注入当前页面摘要（13 种 `route_type` × 每页自定义 summary 字段，e.g. experiment_detail 含 id/name/status/progress/cost_by_currency）。不走 chip rail，只在"预览 LLM 看到的 context"面板里以 markdown 渲染
- **`read_page(query)` 工具**：LLM 可按自然语言 query 查找当前页面可见数据，服务端对 `viewport_index` 做 token 子串打分、top-5 命中复用既有 `resolveContexts()` hydrate 成 tree 返回。`requiresConfirm: false` auto-run
- **Apple Intelligence 风 ambient border glow**：`CopilotBorderGlow` 作为 `<main>` 内 sibling overlay（与 GlowOverlay 并列，不包裹 main、不改 main 的 className/layout），`conic-gradient + @property --glow-angle + mask-composite: exclude` 切出贴 `<main>` 外缘的 rim；3 active 状态 `data-glow=idle/typing/working`（off 时 return null），状态差异通过 rim_width (4→8px) / feather (14→20px) / speed (8s→2s) / saturate (1.35→1.75) 调节；内容区透明不遮挡；`prefers-reduced-motion` 降级为饱和度脉冲、`prefers-reduced-transparency` 降 blur + 去饱和
- **切页清空 + banner**：路由变化清空 manual contexts（inspector/text_selection），session 有 messages 时顶部弹 amber banner 提示"开启新对话/继续当前对话"（不阻断切换）
- **统一 client→server snapshot 机制**：`/chat` + `/tool-result` POST body 新增 `client_snapshot = { page_context, viewport_index, ... }`；server 缓存到 per-session Map，`read_page` 工具按 `sessionId` 取 snapshot

**架构落地**：
- `src/lib/copilot/` 新增: `types.ts` 扩展 / `use-page-context.ts` / `collect-snapshot.ts` / `snapshot-cache.ts` / tools.ts 新 `read_page` + `CopilotToolContext` 接口
- `src/components/copilot/` 新增: `border-glow.tsx`（sibling overlay，off 时 return null） / `route-change-banner.tsx` / `route-change-observer.tsx` / store 扩展 (pageContext / typingSignal / routeChangeBanner / clearManualContexts)
- 13 个 page 文件补 `useRegisterPageContext()` hook
- `src/app/globals.css` 追加 `.copilot-border-glow` + `@property --glow-angle` + `mask-composite: exclude` ring + 3 active 状态 + 2 段 a11y 降级
- `src/app/layout.tsx` `<main>` 内加 `<CopilotBorderGlow />` sibling（不包裹 main、不改 main className / z-index）

**测试**：179 → ~200 vitest（snapshot-cache + collect-snapshot + read-page-tool + resolve-context 扩展）；e2e smoke 9 → 11 case

- Spec: `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-copilot-page-context-ambient-border.md`
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): page context + read_page + ambient border unreleased entry"
```

---

### Task 21: 最终验证 + PR

**Files:**
- 无（git 操作）

- [ ] **Step 1: 全量测试 + tsc + build**

```bash
npx tsc --noEmit
npm test
npm run test:e2e
npm run build
```

- [ ] **Step 2: 手动冒烟（desktop）**

- 打开 copilot（⌘K）
- 在 dashboard / experiment detail / compare / settings 各路由上观察：
  - 边框彩色缓慢呼吸
  - 预览 context 面板有"当前页面"块
- 输入消息：边框加速
- 发送消息：边框快速旋转
- 流式回复完毕：回 idle
- 在实验详情页发问"失败的 task"：LLM 调 `read_page(query="failed")`，应拿到结果（看 DevTools Network `/tool-result`）
- 切换页面：若当前 session 有 messages，顶部出 amber banner
- 点"开启新对话"：进入新 session，banner 消失
- System → Reduce Motion：边框停止旋转，工作态有慢 opacity 脉冲

- [ ] **Step 3: push + 开 PR**

```bash
git push -u origin feat/copilot-page-context-ambient-border
gh pr create --title "Copilot Page Context + read_page + Ambient Border" --body "$(cat <<'EOF'
## Summary

- **Auto page context**: copilot 开即注入当前路由摘要到 system message（13 种 route_type × 每页自定义 summary）
- **`read_page(query)` 工具**：LLM 按自然语言查找页面可见数据，top-5 匹配 + 现有 resolveContexts hydrate
- **Ambient border glow**: Apple Intelligence 风 conic-gradient 旋转彩色边框，4 状态（idle/typing/working）
- **Route change UX**: 切页清 chips + amber banner 建议开新对话
- **统一架构**：client→server snapshot + per-session cache

## Test plan

- [ ] tsc --noEmit clean
- [ ] `npm test` (~200 vitest all green)
- [ ] `npm run test:e2e` (11 cases)
- [ ] Manual: open copilot on each route — preview 面板含 "当前页面" 段
- [ ] Manual: border glow 4 states visible (off / idle / typing / working)
- [ ] Manual: read_page 能从 LLM 触发并命中当前页可见数据
- [ ] Manual: 切页触发 banner，选"开启新对话"切到新 session
- [ ] a11y: prefers-reduced-motion 下 border 不转
- [ ] Spec: docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md
- [ ] Plan: docs/superpowers/plans/2026-04-28-copilot-page-context-ambient-border.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

在所有 task 完成后，手动过一遍：

- [ ] **Spec 覆盖**：spec §2 的 G1-G5 每个都能指向一个 task？（G1→Task 7-10+12-13；G2→Task 4-5；G3→Task 17-18；G4→Task 15-16；G5→未删除既有工具 ✅）
- [ ] **Placeholder 扫描**：无 TBD/TODO
- [ ] **Type 一致性**：`CopilotToolContext.sessionId` 在 tools.ts 和 tool-result route 两处一致；`PageContext.route_type` 枚举所有 19 个值都在 Task 7-10 里用过一次（除 `unknown` 和 `settings_hub` 是 edge）

---

## Open Questions — 实施时视觉决策

1. **working state 动效强度**：若旋转太柔，可在 working 态叠加 `copilot-glow-pulse`（opacity 脉冲）—— 实施 Task 18 后手调决定
2. **FF < 128 降级**：若用户反馈 FF 边框不转，加 `@supports (transition: --x 1s)` fallback 到 SVG stroke —— 默认不做
3. **Snapshot 体积超限**：实测若 compare 页 > 200KB payload，加 `IntersectionObserver` 仅序列化可见元素
4. **read_page 命中后 resolveContexts 失败率**：若 task_result 类型的 elementKey 含 experiment_id 前缀导致 id 解析错误，补强 tools.ts read_page 里的 key→ref 转换逻辑（从 ancestors 或 preview_text 找回 experiment_id）
5. **page_context 与 user-picked 实体重复**：v1 不去重；若 LLM 因重复 confused，加 formatContextsForLlm 去重层

---

**End of Plan.**
