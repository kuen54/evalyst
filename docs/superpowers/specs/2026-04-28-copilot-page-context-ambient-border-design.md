# Copilot Page Context + Ambient Border · Design Spec

**Version**: 1.0 · Draft
**Date**: 2026-04-28
**Author**: Copilot (iterated with user)
**Recommended branch**: `feat/copilot-page-context-ambient-border`
**Status**: Awaiting user review before → writing-plans

---

## 1. Motivation

PR-3 (v0.4.0) 上线后 Copilot 已经能:
- 用户手动圈选元素 → 加到 context chip rail
- 划线选中文本 → 加到 chip rail
- 调 3 个工具（list_experiments / read_experiment_results / restart_experiment）

**但留下三个痛点**:

1. **冷启动门槛高**：每次打开 copilot，面对空对话窗口，必须手动 Inspector → 逐个圈选才能让 LLM "看到"当前页面
2. **LLM 无法主动深挖**：如果用户只问了"这次 compare 里差异最大的是哪两条"，而没圈选对应行，LLM 无能为力（只能反问）
3. **视觉信号不够**：背景光漂移在内容区内部，容易被用户忽略；"AI 在处理"的状态感弱，和普通页面区别不强

**本次改造要解决**：

- (G1) 打开 copilot 即"感知"当前页面（自动注入摘要）
- (G2) LLM 能主动按自然语言 query 拉取当前页面细节
- (G3) 全景视觉信号（Apple Intelligence 风边框光）
- (G4) 切页行为自然（清 chip + 建议开新对话，但不阻断）

## 2. Goals

| # | Goal |
|---|---|
| G1 | 打开 copilot 无须操作，system message 已含当前页面摘要 |
| G2 | LLM 可调 `read_page(query)` 主动读取页面可见数据，返回结构化结果 |
| G3 | ~~中间内容区常驻 ambient border glow~~ **DEFERRED**（见 §5.3，留给未来路线 B WebGL SDF + Simplex noise） |
| G4 | 路由切换即清空用户 context + banner 建议开新对话 |
| G5 | 不牺牲现有能力：Inspector / 划线 / Share Context / 3 个已有工具全部保留 |

## 3. Non-goals

| # | Non-goal |
|---|---|
| N1 | page_context 包含全量 task 明细 —— 只摘要，明细走 read_page |
| N2 | read_page 直接扫描 DOM —— 它读服务端缓存的 snapshot |
| N3 | 跨 session 缓存 snapshot |
| N4 | 边框光有声效 / 触觉反馈 |
| N5 | 移动端 layout 适配 |
| N6 | page_context 与 user-picked context 自动去重 (v1 允许轻度重复，LLM 能处理) |

---

## 4. Architecture Overview

### 4.1 核心设计：Unified client→server snapshot

P1 和 P3 共享同一份客户端快照机制。每次用户发消息或 confirm/deny 工具，客户端把当前页面数据打包一并发给服务端：

```ts
clientSnapshot = {
  session_id, route_type, path, search_params,
  page_context: { ... 摘要数据 },
  viewport_index: [ { key, type, preview_text, ancestors } ],
  timestamp
}
```

服务端双用：
- `page_context` → 自动注入 system message 顶部（P1）
- `viewport_index` → per-session 缓存，供 `read_page` 工具查询（P3）

### 4.2 数据流

```
用户点击打开 copilot
    ↓
useCopilotStore.open = true
    ↓
（P2 border glow DEFERRED — 见 §5.3；`.copilot-glow` 背景 radial drift 保留原状）
    ↓
用户发送消息
    ↓
chat-view 调 collectClientSnapshot()
  (store.pageContext + document.querySelectorAll('[data-copilot-context]'))
    ↓
POST /api/copilot/sessions/:id/chat  body includes client_snapshot
    ↓
server:  setSnapshot(sessionId, snapshot)
         append user message to jsonl
         build system message with page_context.summary 顶部
         stream LLM
    ↓
LLM 可能调 read_page(query)
    ↓
server:  getSnapshot(sessionId) → viewport_index
         token 打分匹配 top 5
         resolveContexts(hit keys) 拉详情
         return { matches, total_scanned, message? }
    ↓
LLM 继续对话
```

### 4.3 三部分关系

```
P1 (page_context)  ─┐
                    ├→ clientSnapshot → server cache
P3 (viewport_index)─┘                          │
                                               ├→ system message  (P1)
                                               └→ read_page tool  (P3)

P2 (border glow)   → **DEFERRED** —— 见 §5.3，本 PR 不实现
```

---

## 5. Detailed Design

### 5.1 Page Context (P1)

#### 5.1.1 类型定义

`src/lib/copilot/types.ts` 新增:

```ts
export type RouteType =
  | 'dashboard' | 'experiment_new' | 'experiment_detail' | 'compare'
  | 'settings_hub'
  | 'datasets_list' | 'dataset_new' | 'dataset_detail'
  | 'templates_list' | 'template_new' | 'template_detail'
  | 'displays_list' | 'display_new' | 'display_detail'
  | 'rubrics_list' | 'rubric_new' | 'rubric_detail'
  | 'models_list'
  | 'unknown'

export type PageContext = {
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  summary: Record<string, unknown>  // route-specific, shape per 5.1.2
  timestamp: string
}
```

#### 5.1.2 每路由 summary 定义

| route_type | 路径 | `summary` 字段 |
|---|---|---|
| `dashboard` | `/` | `experiments_total`, `recent: [{id,name,status,success,failed,created_at}]` (前 5), `counts: {datasets,templates,displays,rubrics,models}` |
| `experiment_new` | `/experiments/new` | `template_id?`, `dataset_ids: string[]`, `model_id?`, `input_refs_count?` |
| `experiment_detail` | `/experiments/[id]` | `id`, `name`, `status`, `created_at`, `template_id`, `model`, `progress: {total,success,failed,pending}`, `cost_by_currency: {CNY?:number,USD?:number}`, `rubric_id?` |
| `compare` | `/compare?ids=X,Y,Z` | `experiment_ids: string[]`, `experiments: [{id,name,status,success,failed}]`, `align_key: string` |
| `settings_hub` | `/settings` | (empty) |
| `datasets_list` | `/settings/datasets` | `count`, `items: [{id,name,record_count}]` (前 20) |
| `dataset_new` | `/settings/datasets/new` | (empty) |
| `dataset_detail` | `/settings/datasets/[id]` | `id`, `name`, `fields: string[]`, `record_count` |
| `templates_list` | `/settings/templates` | `count`, `items: [{id,name,version}]` (前 20) |
| `template_new` | `/settings/templates/new` | (empty) |
| `template_detail` | `/settings/templates/[id]` | `id`, `name`, `version`, `input_aliases: string[]`, `output_field_names: string[]`, `prompt_length: number` |
| `displays_list` | `/settings/displays` | `count`, `items: [{id,name,mode}]` (前 20) |
| `display_new` | `/settings/displays/new` | (empty) |
| `display_detail` | `/settings/displays/[id]` | `id`, `name`, `mode`, `columns_count?` |
| `rubrics_list` | `/settings/rubrics` | `count`, `items: [{id,name,criteria_count}]` (前 20) |
| `rubric_new` | `/settings/rubrics/new` | (empty) |
| `rubric_detail` | `/settings/rubrics/[id]` | `id`, `name`, `criteria_count`, `criteria_kinds: string[]` |
| `models_list` | `/settings/models` | `models: [{id,name,provider,copilot_enabled}]` |
| `unknown` | 其它 | `{}` |

**原则**: 字段数和 payload 都控制在"LLM 一眼能看懂当前页面状态"的粒度，不 ship 明细。task 详情、完整 prompt、完整 records 都不进 page_context，必要时走 read_page。

#### 5.1.3 注册机制

新 hook `src/lib/copilot/use-page-context.ts`:

```ts
export function useRegisterPageContext(
  getter: () => PageContext,
  deps: React.DependencyList
) {
  const { setPageContext } = useCopilotStore()
  useEffect(() => {
    setPageContext(getter())
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setPageContext(null), [])
}
```

Store 新增:
- `pageContext: PageContext | null` 字段
- `setPageContext(pc: PageContext | null)` action

每个 client 页面在顶部调:

```tsx
// src/app/experiments/[id]/page.tsx
"use client"
useRegisterPageContext(() => ({
  route_type: 'experiment_detail',
  path: `/experiments/${id}`,
  summary: {
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    created_at: experiment.created_at,
    template_id: experiment.template_id,
    model: experiment.model,
    progress: computeProgress(tasks),
    cost_by_currency: computeCost(tasks),
    rubric_id: experiment.rubric_id,
  },
  timestamp: new Date().toISOString(),
}), [experiment, tasks])
```

#### 5.1.4 System message 注入

`src/lib/copilot/resolve-context.ts` `formatContextsForLlm()` 扩展。新顺序:

```markdown
# 当前页面

path: `/experiments/exp_123`
route_type: experiment_detail

## Summary

- id: `exp_123`
- name: 解签文案对比 v4
- status: completed
- progress: 57 total / 55 success / 2 failed / 0 pending
- cost_by_currency: CNY ¥12.50
- template_id: `fortune_v4`
- model: `gemini-2.5-flash`

# 用户圈选的上下文

## 📚 Referenced entities
...

## 🎯 User selections
...
```

`page_context` 摘要按 `summary` 字段用 `- key: value` 平铺渲染。复杂嵌套对象（如 `progress`）用"分隔符连接"的方式输出，不再嵌套 bullet，避免 markdown 深度过深。

#### 5.1.5 UI 展示

- ❌ 不作为 chip 显示在 chip rail
- ✅ 在 chat-view 的 "预览 LLM 将看到的 context" 面板里渲染（已是 markdown）
- 面板顶部区块标题 "## 当前页面" 清晰区分自动 vs 手动 context

### 5.2 Viewport Index + read_page Tool (P3)

#### 5.2.1 类型定义

```ts
export type ViewportIndexEntry = {
  key: string           // 遵循 context-registry elementKey 规则
  type: string          // KNOWN_CONTEXT_TYPES 之一
  preview_text: string  // <= 200 chars, trimmed
  ancestors?: string[]  // parent keys (最近祖先链)
}

export type ClientSnapshot = {
  session_id: string
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  page_context: PageContext
  viewport_index: ViewportIndexEntry[]
  timestamp: string
}
```

#### 5.2.2 客户端采集

`src/lib/copilot/collect-snapshot.ts`:

```ts
export function collectClientSnapshot(
  sessionId: string,
  pageContext: PageContext
): ClientSnapshot {
  const nodes = document.querySelectorAll<HTMLElement>('[data-copilot-context]')
  const viewport_index: ViewportIndexEntry[] = []
  for (const el of Array.from(nodes)) {
    const captured = captureFromElement(el) // 已有函数
    if (!captured) continue
    const preview_text = truncatePreview(el.textContent ?? '')
    const ancestors = collectAncestorKeys(el.parentElement)
    viewport_index.push({
      key: captured.elementKey,
      type: captured.type,
      preview_text,
      ancestors,
    })
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

function truncatePreview(s: string): string {
  const norm = s.replace(/\s+/g, ' ').trim()
  return norm.length > 200 ? norm.slice(0, 197) + '…' : norm
}
```

调用点：`chat-view.tsx` 的 `doStreamSend()` + `postToolResult()`。

#### 5.2.3 服务端缓存

`src/lib/copilot/snapshot-cache.ts`:

```ts
const cache = new Map<string /* session_id */, ClientSnapshot>()

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

**生命周期**:
- `POST /chat` 或 `POST /tool-result` 请求进入时写入
- `DELETE /sessions/:id` 时清除
- 进程重启丢失（无持久化）——`read_page` 返回 "no snapshot" 消息让 LLM 换招
- 本地单进程 dev 足够；未来多进程需换 Redis

#### 5.2.4 read_page 工具定义

`src/lib/copilot/tools.ts`:

```ts
export const readPageTool: ToolDefinition = {
  name: 'read_page',
  description:
    'Search the current page for nodes matching a natural-language query. ' +
    'Returns the top 5 matching data nodes with their full structured content. ' +
    'Use when the user asks about something visible on their page but detail is not in context.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '自然语言查询，例如 "status 为 failed 的 task" / "第三条结果的输出" / "experiment exp_123 的失败样本"',
      },
    },
    required: ['query'],
  },
  requiresConfirm: false, // auto-run
  impl: readPage,
}

async function readPage(
  input: { query: string },
  ctx: { sessionId: string }
): Promise<{
  matches: Array<{ key: string; type: string; content_tree: unknown }>
  total_scanned: number
  message?: string
}> {
  const snapshot = getSnapshot(ctx.sessionId)
  if (!snapshot) {
    return { matches: [], total_scanned: 0, message: '当前没有页面快照可用' }
  }

  const query = input.query.toLowerCase().trim()
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

  const refs = scored.map(x => keyToContextRef(x.entry.key, x.entry.type))
  const resolved = await resolveContexts(refs)

  return {
    matches: scored.map(x => {
      const hit = resolved.resolved.find(r => r.ref.key === x.entry.key)
      return {
        key: x.entry.key,
        type: x.entry.type,
        content_tree: hit?.data ?? null,
      }
    }),
    total_scanned: snapshot.viewport_index.length,
  }
}
```

**注释点**:
- 匹配策略：小写 + token 子串打分（简单够用）。不做 embedding / 语义匹配——v1 保持可解释。
- Top 5 上限：避免一次 tool_result payload 过大。
- hydrate 复用现有 `resolveContexts()`——已支持 entity + chain + dedup 逻辑，不重复造轮子。

#### 5.2.5 Tool metadata

`src/lib/copilot/tool-metadata.ts`（client-safe，不 import `@/lib/store`）:

```ts
read_page: {
  name: 'read_page',
  label: t('copilot.tool.read_page.label'), // "读取页面"
  icon: 'search', // lucide icon 名
  requiresConfirm: false,
  renderSummary: (input, result) => {
    if (!result) return null
    if (result.message) return result.message
    return t('copilot.tool.read_page.summary_found', { n: result.matches.length })
  },
  renderDetail: (input, result) => { ... } // collapsed JSON tree
}
```

### 5.3 Ambient Border Glow (P2) — **DEFERRED** ⏸️

> **2026-04-29 更新**：本 PR **放弃实现** Apple Intelligence 风 screen edges glow；既有 `.copilot-glow` 背景 radial drift（PR-2.5 + PR #6 定型）**完全保留、不动**。

**为什么 defer**：
1. 尝试了 3 个 CSS 方向都没达到 Apple Intelligence 的真实观感：
   - v1 `inset: -24px` + 大 bloom：遮盖内容、破坏 `.copilot-glow`
   - v2 `conic-gradient + @property --angle + mask-composite: exclude` rotating ring：机械"彩虹转圈"，偏离 Apple 有机流体
   - v3 路线 A · 5 pastel blob + inset mask + `mix-blend-mode: screen`：在纯白 card bg 上 `screen` blend 成近白不可见；调成直接 alpha 合成 + 调 blob/blur/mask 参数后勉强能看到色晕，但和原 `.copilot-glow` 背景 drift 视觉重叠，并非用户期待的"屏幕边缘一圈贴外缘的 rim"
2. Apple Intelligence 真实实现是 **SDF + Simplex noise fragment shader**（用户在专业拆解里明确说了），CSS 做不到真 SDF / Perlin noise，只能近似 —— 近似出的观感和期望差距太大
3. 用户明确要求（2026-04-29）："先把你做的 screen edges glow 代码删掉"

**本 PR 留下什么**（未动）：
- `.copilot-glow`（`src/app/globals.css:176-271`）+ `src/components/copilot/glow-overlay.tsx` 原状保留
- `<main>` 的 className / z-index / overflow 原状保留

**未来升级路径（路线 B，单独 PR）**：
- `<canvas>` 全 `<main>` 铺满
- WebGL fragment shader：SDF 算到 rounded-rect 边距 → inverse-square falloff → 多色插值 → Simplex noise 扭曲 UV
- busy / streaming 作为 shader uniform 做响应
- ~300-500 行 shader + canvas，bundle +5KB

（原 §5.3 详细方案 v1-v3 保留在 git 历史 commit `39acf1f` / `c640cb1` / `6af7aca` / `53d9d11` + 本文件前一版，供未来复用参考。）


### 5.4 Route Change Behavior (G4)

#### 5.4.1 监听

`src/components/copilot/panel.tsx` 内挂载一个 observer 子组件:

```tsx
function RouteChangeObserver() {
  const pathname = usePathname()
  const { clearManualContexts, currentSession } = useCopilotStore()
  const previousPath = useRef<string | null>(null)

  useEffect(() => {
    if (previousPath.current === null) {
      previousPath.current = pathname // 首次 mount 不触发
      return
    }
    if (pathname !== previousPath.current) {
      const { count } = clearManualContexts() // 清 inspector + text_selection
      previousPath.current = pathname
      if (count > 0 && currentSession?.messages?.length > 0) {
        showRouteChangeBanner({ count })
      }
    }
  }, [pathname])

  return null
}
```

**清空范围**:
- ✅ Inspector-picked contexts
- ✅ Text selection contexts
- ❌ 不清 messages
- ❌ 不清 pageContext（自动刷新到新路由）

#### 5.4.2 Route change banner

`src/components/copilot/route-change-banner.tsx`:

```tsx
export function RouteChangeBanner() {
  const { routeChangeBanner, dismissRouteChangeBanner, forkToNewSession } = useCopilotStore()
  const t = useT()
  if (!routeChangeBanner?.visible) return null

  return (
    <div className="agent-hint-banner"> {/* 沿用已有 amber 样式 */}
      <AlertTriangle className="size-4 shrink-0" />
      <div className="flex-1 text-xs">
        {t('copilot.route_change.message', { n: routeChangeBanner.count })}
      </div>
      <button
        className="h-7 px-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-xs font-medium"
        onClick={forkToNewSession}
      >
        {t('copilot.route_change.new_session')}
      </button>
      <button
        className="h-7 px-2 rounded hover:bg-amber-500/10 text-xs"
        onClick={dismissRouteChangeBanner}
      >
        {t('copilot.route_change.continue')}
      </button>
    </div>
  )
}
```

在 `chat-view.tsx` 顶部渲染，sticky。

**显示条件**（三者 AND）:
1. 最近一次 route change 触发了 banner
2. 当前 session.messages.length > 0
3. 用户未点 dismiss 或 new_session

**Mockup**:
```
┌──────────────────────────────────────────────────────┐
│ ⚠  已切换页面，清空了 3 个圈选上下文。               │
│    建议开启新对话以获得更清晰的当前页面答复。         │
│    [开启新对话]   [继续当前对话]                      │
└──────────────────────────────────────────────────────┘
```

#### 5.4.3 forkToNewSession 行为

```ts
forkToNewSession() {
  const newSession = await createSession({ name: auto-generated })
  setCurrentSession(newSession.id)
  dismissRouteChangeBanner()
  // 旧 session 保留在 list
}
```

### 5.5 Session 与工具 (clarification)

现有 3 工具继续存在。`read_page` 作为第 4 个工具加入（auto-run，no-confirm）:

| Tool | Kind | Confirm? |
|---|---|---|
| `list_experiments` | read | no |
| `read_experiment_results` | read | no |
| `read_page` | read | no (新增) |
| `restart_experiment` | write | **yes** |

- 链式上限维持 5
- Tool metadata 必须在 `tool-metadata.ts` 定义（不引 `@/lib/store`），避免 client bundle 炸 fs（memory 提醒）

---

## 6. API Changes

### 6.1 `/api/copilot/sessions/[id]/chat` POST

Body 扩展:

```ts
{
  message: string,           // 既有
  model_id: string,          // 既有
  context_refs: ContextRef[],// 既有
  client_snapshot: ClientSnapshot, // 新增
}
```

Server 收到后:
1. `setSnapshot(sessionId, client_snapshot)`
2. `formatContextsForLlm(context_refs, client_snapshot.page_context)` 构造 system message
3. 继续 stream LLM (传 tool list 含 read_page)

### 6.2 `/api/copilot/sessions/[id]/tool-result` POST

Body 扩展同上：加 `client_snapshot`。

### 6.3 `/api/copilot/sessions/[id]` DELETE

Server 同时 `deleteSnapshot(sessionId)`.

**无新端点**。

---

## 7. File Impact

### 新建 (~10)

**lib**
- `src/lib/copilot/use-page-context.ts`
- `src/lib/copilot/collect-snapshot.ts`
- `src/lib/copilot/snapshot-cache.ts`
- `src/lib/copilot/__tests__/collect-snapshot.test.ts`
- `src/lib/copilot/__tests__/read-page-tool.test.ts`
- `src/lib/copilot/__tests__/snapshot-cache.test.ts`

**components**
- ~~`src/components/copilot/border-glow.tsx`~~ (**DEFERRED**，见 §5.3)
- `src/components/copilot/route-change-banner.tsx`
- `src/components/copilot/route-change-observer.tsx` (内部用)

**docs**
- `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md` (this file)
- `docs/superpowers/plans/2026-04-28-copilot-page-context-ambient-border.md` (writing-plans 产物)

### 修改 (~17)

**lib**
- `src/lib/copilot/types.ts` — `RouteType`, `PageContext`, `ViewportIndexEntry`, `ClientSnapshot`
- `src/lib/copilot/tools.ts` — 新增 `readPageTool`
- `src/lib/copilot/tool-metadata.ts` — 新增 `read_page` client metadata
- `src/lib/copilot/tool-registry.ts` — 注册
- `src/lib/copilot/tool-adapters.ts` — 支持 `sessionId` 注入到 tool impl ctx（现在没传）
- `src/lib/copilot/resolve-context.ts` — `formatContextsForLlm(refs, pageContext?)` 签名扩
- `src/lib/copilot/build-llm-messages.ts` — 调 formatContextsForLlm 传 page_context

**components**
- `src/components/copilot/store.tsx` — `pageContext`, `typingSignal`, `bumpTypingSignal`, `clearManualContexts`, `routeChangeBanner`, `dismissRouteChangeBanner`, `forkToNewSession`
- `src/components/copilot/chat-view.tsx` — `collectClientSnapshot()` 调用; RouteChangeBanner 渲染; textarea onChange 调 bumpTypingSignal
- `src/components/copilot/panel.tsx` — 挂 RouteChangeObserver

**API**
- `src/app/api/copilot/sessions/[id]/chat/route.ts` — accept client_snapshot → setSnapshot + 传 pageContext 给 formatContextsForLlm
- `src/app/api/copilot/sessions/[id]/tool-result/route.ts` — accept client_snapshot → setSnapshot
- `src/app/api/copilot/sessions/[id]/route.ts` — DELETE 时 deleteSnapshot

**Layout & pages**
- ~~`src/app/layout.tsx` — `<main>` 内新增 `<CopilotBorderGlow />` sibling overlay~~ (**DEFERRED**)
- ~~`src/app/globals.css` — border glow 样式~~ (**DEFERRED**)
- `src/app/page.tsx` — useRegisterPageContext (dashboard)
- `src/app/experiments/new/page.tsx` — useRegisterPageContext
- `src/app/experiments/[id]/page.tsx` — useRegisterPageContext
- `src/app/compare/page.tsx` — useRegisterPageContext
- `src/app/settings/page.tsx` — useRegisterPageContext (settings_hub)
- `src/app/settings/datasets/page.tsx` + `new/page.tsx` + `[id]/page.tsx`
- `src/app/settings/templates/page.tsx` + `new/page.tsx` + `[id]/page.tsx`
- `src/app/settings/displays/page.tsx` + `new/page.tsx` + `[id]/page.tsx`
- `src/app/settings/rubrics/page.tsx` + `new/page.tsx` + `[id]/page.tsx`
- `src/app/settings/models/page.tsx`

**i18n**
- `src/lib/i18n/dict_*.ts` — ~10 新 keys

---

## 8. i18n Keys (new)

| key | zh | en |
|---|---|---|
| `copilot.route_change.message` | "已切换页面，清空了 {n} 个圈选上下文。建议开启新对话以获得更清晰的当前页面答复。" | "Page changed. {n} context selections cleared. Consider starting a new conversation." |
| `copilot.route_change.new_session` | "开启新对话" | "New conversation" |
| `copilot.route_change.continue` | "继续当前对话" | "Keep current" |
| `copilot.tool.read_page.label` | "读取页面" | "Read page" |
| `copilot.tool.read_page.summary_found` | "找到 {n} 条匹配" | "Found {n} matches" |
| `copilot.tool.read_page.summary_empty` | "未找到相关内容" | "No matches" |
| `copilot.page_context.header` | "当前页面" | "Current page" |
| `copilot.page_context.preview_label` | "## 当前页面" | "## Current page" |
| `copilot.page_context.unknown_route` | "未知页面" | "Unknown route" |

---

## 9. Testing Strategy

### 9.1 Unit (vitest)

**`use-page-context.test.ts`**
- Mount 时调 setPageContext
- Deps change → 重新 set
- Unmount → set(null)

**`collect-snapshot.test.ts`**
- DOM 无 `[data-copilot-context]` → viewport_index 为空
- DOM 含 N 节点 → N 条目
- preview_text 截断 >200 char
- ancestors 正确链
- 不包含 text_selection（没固定 DOM 不扫）

**`read-page-tool.test.ts`**
- snapshot 不存在 → message 返回
- 0 match → message + total_scanned
- 1+ match → 按 score 排序 top 5
- 多 token 累加打分
- 调 `resolveContexts` → content_tree 正确填充
- 命中项 content_tree 包含祖先链

**`snapshot-cache.test.ts`**
- set / get / delete 幂等
- 不同 sessionId 隔离

**`store.test.ts` (既有文件扩展)**
- `bumpTypingSignal` debounce 250ms
- `clearManualContexts` 只清 inspector + text_selection，不清 page_context / messages
- `forkToNewSession` 创建新 session + 切换

**`resolve-context.test.ts` (既有文件扩展)**
- formatContextsForLlm 有 page_context 时顶部插 "# 当前页面"
- page_context + user selections 分别 block
- page_context 为 null 时只渲染用户选择

### 9.2 Integration

- POST `/chat` with `client_snapshot` → 服务端 cache 更新
- POST `/tool-result` with `client_snapshot` → cache 更新
- DELETE session → cache 清除
- `read_page` 端到端: LLM tool_use → auto-run → cache lookup → resolveContexts → 返回 tree

### 9.3 E2E (Playwright smoke)

- 打开 copilot → preview panel 含当前路由 summary
- 切页 → chip 清空 + banner 出现 + 点 "开启新对话" 切到新 session
- 点 "继续当前对话" → banner 消失 + messages 保留

### 9.4 Visual (manual)

- ~~4 状态 border glow~~ **DEFERRED**（见 §5.3）
- `.copilot-glow` 背景光：开 copilot 后原 radial drift 照常（和本 PR 前完全一致）

### 9.5 数字目标

- vitest: 179 → ~195+ 全绿
- tsc --noEmit clean
- e2e smoke: 9 → 11+ 全绿

---

## 10. Performance & Risks

### 10.1 Snapshot payload 大小

- 估算: 100 节点 × (key 80B + type 20B + preview 200B + ancestors 100B) ≈ 40KB
- 超大 compare 页（300+ 节点）≈ 120KB
- 每条消息上行 40-120KB 可接受
- 若未来爆 → 加 truncation（例如仅发送视窗内元素，用 IntersectionObserver）

### 10.2 Border glow 帧渲染

- 1600×900 frame + blur(28px) saturate(1.5) conic 旋转
- Safari / Chrome M 系列实测 60Hz 稳定
- Intel 集显可能 ~2ms/frame
- **风险**: panel 宽度 drag resize 时 conic 重新光栅化 → jank
  - **缓解**: panel resize 用 `transform: scaleX()` 而不是 width 变化；或 debounce width → 快照档位

### 10.3 `@property` Firefox 兼容

- FF < 128 静态不转 → 接受
- 检测: `@supports (transition: --x 1s)` fallback 到 SVG stroke (备用方案)

### 10.4 路由监听双触发

- Next.js `usePathname()` 变化 + `useSearchParams()` 变化可能同 tick 触发两次
- 方案：合并判断 `path + search.toString()` 当 key，避免双重 clear

### 10.5 Snapshot cache 内存泄漏

- sessions 删除时必须 deleteSnapshot，否则 Map 长大
- 加自动 TTL（例如 30 min 未访问自动淘汰）作为兜底

---

## 11. Decisions Record

| # | 决策 | 最终 | 理由 |
|---|---|---|---|
| 1 | page_context 粒度 | 每页自定义 getter | 最自然，各页面自己最懂要暴露啥 |
| 2 | page_context UI 展示 | 只在 preview panel，不 chip | chip rail 专留给手动操作，auto 的藏起来不扰视觉 |
| 3 | read_page 返回形态 | 结构化 tree (JSON content_tree) | LLM 吃结构化最稳；preview panel 里 markdown 渲染 |
| 4 | ~~Border glow 与背景光~~ | **DEFERRED** | 见 §5.3；仅保留 `.copilot-glow` 背景 |
| 5 | 切页 context 行为 | 清所有圈选 + banner | 避免 LLM 误把前页 context 当现在 |
| 6 | 切页 session 行为 | 保留 (A) + banner 建议新对话 | 最少惊讶；允许用户自主切 |
| 7 | read_page 签名 | `query: string` 自然语言 | viewport_index 摘要给 LLM 看不友好，NL 最易用 |
| 8 | Snapshot 持久化 | in-memory Map，重启丢失 | 本地 dev 足够；未来多进程换 Redis |
| 9 | 链式上限 | 5 (不变) | PR-3 沉淀值 |
| 10-11, 15-17 | ~~边框光相关~~ | **DEFERRED** | 见 §5.3 |
| 12 | Debounce typing signal | 250ms | 平衡响应性 + 避免 React 每键 re-render |
| 13 | read_page 匹配策略 | 小写 token 子串 | v1 可解释；embedding 以后加 |
| 14 | top-N matches | 5 | 避免 tool_result payload 过大 |

---

## 12. Scope

### In scope
- P1 13+ route page_context + getter hook + system message 注入 + preview UI
- ~~P2 border glow 4 状态 + a11y 降级 + 容器挂载~~ **DEFERRED**（见 §5.3）
- P3 read_page 工具 + snapshot cache + viewport_index 采集
- 切页行为 + route change banner
- i18n 新 keys
- 单测 + e2e smoke
- CHANGELOG `[Unreleased]`

### Out of scope
- 移动端 layout
- Task 明细进 page_context
- read_page 语义/embedding 匹配
- 跨 session snapshot 持久化
- Border glow 声效 / 触觉反馈
- page_context 与 user-picked 自动 entity 去重
- 支持多进程 snapshot cache (Redis)

---

## 13. Open Questions

O1. `working` 状态视觉：`conic-gradient + @property` 旋转是否够"active"？调研建议可加一次"脉冲"叠加。→ 实施时手调后决定。
O2. page_context summary 里的数值单位和格式（例如 cost 是 `¥12.50` 还是 `12.50 CNY`）→ v1 按 summary 字段原样输出，不专门格式化。
O3. snapshot 体积上限实际测量 → 实施中 profile。
O4. 每路由 getter 是否可以用 shared helper 简化（例如"entity detail" = id+name+status+N metrics）？→ v1 每页独立写，避免过早抽象。
O5. FF < 128 降级 SVG stroke 方案是否写入 v1？→ v1 不写（接受 FF < 128 静态边）；如果用户反馈补 feature flag。

---

## 14. References

### 内部文档
- [PR-3 tool calling spec](./2026-04-28-copilot-pr3-tool-calling-design.md)
- [Glass system spec](./2026-04-28-copilot-glass-system-design.md)
- [CHANGELOG.md](../../../CHANGELOG.md) — v0.4.0 / v0.3.0 / v0.2.0 上下文

### 调研来源
- Apple Intelligence visual reference (subagent 调研)
- [MDN @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property)
- [caniuse @property](https://caniuse.com/mdn-css_at-rules_property) — Chrome 85+, Safari 16.4+, Firefox 128+
- [MDN conic-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient)
- [MDN prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency)
- [MDN border-image](https://developer.mozilla.org/en-US/docs/Web/CSS/border-image) — 记录了 border-radius 不生效的已知限制

### 复用的既有基础
- `src/lib/copilot/context-registry.ts` — `captureFromElement`, `collectAncestorChain`, `elementKey`
- `src/lib/copilot/resolve-context.ts` — `resolveContexts`, `formatContextsForLlm`
- `src/lib/copilot/session-store.ts` — session CRUD + fork
- `src/components/copilot/shell.tsx` — Glass System 4 档
- `src/app/globals.css` — 既有 `.copilot-glow` 背景光效

---

**End of Spec.**
