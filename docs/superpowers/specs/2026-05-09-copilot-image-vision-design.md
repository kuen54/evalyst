# Copilot × Image Generation 集成（Vision Path）· 设计规范

**Date**: 2026-05-09
**Status**: Design approved (brainstorm), ready for implementation plan
**Scope**: 让 evalyst Copilot 真正"看见"生图实验的输出 —— 圈选含图 result 时把图像 base64 内联进 LLM 多模态消息；vision 模型门控；chip 缩略图；tool 调用结果附图。
**Out of scope (v3+)**: VLM-as-judge auto-evaluation；input-image symmetry（让 LLM 看输入图）；远程 HTTP 图像 fetch；多图 lightbox 缩放/平移；图像编辑（mask、inpaint）；token-budget per-session 累计上限。
**Predecessor**: v0.10.0（PR #52）已 ship 生图评测 manual 全链路（落盘 + ImageLightbox + HEIM rubric）。本次补 Copilot 集成。
**Reference specs**:
- `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`（生图链路；§14 显式排除 copilot 集成）
- `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`（v2 progressive disclosure 架构）

---

## 1 · Context

v0.10.0 ship 后实测发现的核心 gap：圈选含图 result 跟 Copilot 对话，LLM 看到的是字符串路径 `"image_url": "/api/results/.../foo.png"`，根本看不到图。所有"为什么这张没画对 / 比较 #1 #2 / 整批偏暗 / 改 prompt 让头发更亮"的视觉判断诉求**完全失效**。生图 dogfood 时 Copilot 最大价值（视觉判断驱动迭代）整个被砍。

**底层 audit 结论**（subagent 完整扫了 src/lib/copilot/* + src/components/copilot/* 全链路）：

| 层级 | 现状 | 影响 |
|---|---|---|
| `LlmMessage.content` 类型 | 已是 discriminated union，user/assistant 支持 `string \| Array<{type:'text'} \| {type:'image_url'}>` | ✅ 协议管道就绪，零类型改动 |
| OpenAI request 序列化（`llm-client.ts:154-159`） | `image_url` block 原样透传到 `/chat/completions` | ✅ 包括 data URL 也直接 work |
| Anthropic request 序列化（`llm-stream.ts:629-634`） | `image_url` block 转换成 `{type:'image', source:{type:'url', url}}` | ⚠️ Anthropic 的 `source.type='url'` **不接受** `data:` URL。data URL 必须走 `source.type='base64'` —— 必须修 |
| `parseResponse`（生图响应处理） | v0.10.0 已加 `LlmResponse.images?` 提取 | ✅ 不影响 vision 路径（response 是输出，本 spec 关心 input） |
| `build-llm-messages.ts` | 把每条 CopilotMessage 当字符串透传给 LlmMessage | ❌ 没有 multimodal 升级路径，必须改 |
| `resolve-context.ts` | `manifestTaskResult.output` 含 `image_url` 字段值（路径字符串） | ✅ 数据已拿到，差提取 |
| `system-header.ts` | active_contexts 只挂 ref + summary（v2 progressive disclosure） | ✅ 保持 ref-only，图像走 user message body |
| `ModelConfig` | 有 `copilot_enabled?: boolean`，无 vision flag | ❌ 必须加 `vision_capable?: boolean` |
| `tool-result-store.ts` | `ToolResultContent` 仅 `inline / ref / compacted` | ⚠️ 需扩 `attachments?: ImageRef[]` |
| Chip rail expand panel | 渲染 JSON `<pre>` block | ❌ 含图字段时应渲染缩略图 |

---

## 2 · 决策（brainstorm 收敛的 4 条硬约束）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **Vision 模型识别走手动 `vision_capable?: boolean` 标记**，默认 `false` | 匹配现有 `copilot_enabled` 模式；显式 > 启发式；网关前缀模型名（`sankuai/gemini-3.1-flash-image-preview`）regex 易漏 |
| 2 | **图像永远走 base64 内联**（`fs.readFile` → `data:image/png;base64,...`） | 唯一同时在 dev 和 prod 都能 work 的方式；vision LLM 拉不到 localhost；零网络往返；payload 增 ~33% 是可接受成本 |
| 3 | **每轮 LLM 消息附图上限 N=5**（圈选 + 工具返回合计） | 包住典型 compare 用例（≤5 张图）；不会撑爆 context window 或撞 10MB 请求上限；超出走 LLM 多轮交互或后续 user 提交 |
| 4 | **Vision 门控走硬筛 model picker**（image contexts 存在 → 非 vision 模型不可选） | 防静默失败；用户显式认知"这是个 vision 任务"；和 `copilot_enabled` 筛逻辑同形 |

副推论（base64 → 必须修 Anthropic 序列化器）：
- Anthropic API `source.type='url'` 只接 HTTP(S)，不接 `data:`
- 必须在 `serializeAnthropicAssistantBlock` + `serializeAnthropicNonAssistant` 加分支：检测 `data:image/...;base64,...` → 转 `{type:'image', source:{type:'base64', media_type, data}}`
- HTTP(S) URL 保持现状 `source.type='url'`

---

## 3 · Architecture

### 3.1 数据流

```
Browser (chip rail / model picker / chat-view)        Server (chat route → build-llm-messages)
─────────────────────────────────────────────         ──────────────────────────────────────────

1. 用户在结果卡上圈 task_result chip
   <ClickableImage> 父 div 注入：
   data-copilot-context-extra=
     { experiment_id, field_type:'image_url', url }

2. Chip rail expand：
   detail.data.image_url 检测到 → 渲染 120px
   ClickableImage（点击进 ImageLightboxProvider）

3. 模型选择：
   chat-view 计算 imageContextCount
   model-picker 过滤 copilot_enabled=true
   AND (imageContextCount===0 OR vision_capable===true)

4. POST /api/copilot/sessions/{id}/chat                4. chat/route.ts:
   { user_message, contexts, model_id }                  appendMessage(user, contexts)
                                                          → runToolAwareLlmStream
                                                            → buildLlmMessages(branch, pageContext)
                                                                ▼
                                                          5. collectImageRefs(branch):
                                                             • last user msg.contexts → schema 查询
                                                               找 image_url / image_url_list 字段
                                                               → resolve to data/results/{exp}/images/{f}
                                                             • window 内 tool_result.attachments → 取
                                                             • dedupe by URL；cap 5
                                                                ▼
                                                          6. readImageBytes(refs):
                                                             fs.readFile per ref → base64
                                                             失败 → ImageUnavailable 占位
                                                                ▼
                                                          7. rewriteUserContent + rewriteToolResults
                                                             content: Array<text|image_url>
                                                                ▼
                                                          8. serializeMessagesForProvider:
                                                             • OpenAI: image_url block 透传
                                                             • Anthropic: data: URL 检测 →
                                                               source.type='base64' + media_type + data
```

### 3.2 关键边界

- **SystemHeader 保持 ref-only**：v2 progressive disclosure 不破坏。LLM 看 `active_contexts: [{id: 'ctx_1', type: 'task_result', summary: '...', within: 'experiment:exp_X'}]`，需要 detail 时仍调 `read_context(ctx_1, 'self')`。图像不走 SystemHeader，避免 base64 撑爆 cache 前缀。
- **图像作为 user content body 的一部分**：与 ctx_N 文本标签交错，让 LLM 一眼看出"哪张图对应哪个 #N"。
- **`build-llm-messages.ts` 是图像注入唯一权威**：不在 resolve-context、不在 system-header、不在工具自身做。所有路径汇集到这个组装点。
- **Tool 工具自身只挂 `_attachments` 元数据**：read_context / read_resource / read_experiment_results 等工具在 output 里加 `_attachments: ImageRef[]` 字段；build-llm-messages 重放 tool_result 时识别该字段，提升为多模态 block。工具内部不做 fs.readFile（保持 metadata-first）。

### 3.3 Vision 门控的 defense-in-depth

| 层 | 行为 |
|---|---|
| Model picker 过滤 | 主防线 —— 含图 contexts 时非 vision 模型不显示 |
| Chat route 入口校验 | 二防线 —— `cfg.models.find(...)` 返 undefined 走原 400 路径 |
| build-llm-messages 兜底 | 三防线 —— 实际拼消息时若 modelConfig.vision_capable!==true 仍发现图像 ref，**剥离所有 image_url block** + 注入系统 note `[Images dropped: model not vision_capable]`，避免 provider 400 |

---

## 4 · 改造点

### 4.1 类型 / Schema 层

**`src/lib/llm-config.ts`**：

```ts
export interface ModelConfig {
  id: string
  name: string
  model: string
  api_format: ApiFormat
  base_url: string
  api_key: string
  default_temperature?: number
  default_max_tokens?: number
  pricing?: ModelPricing
  copilot_enabled?: boolean
  vision_capable?: boolean      // ← 新增；默认 false
}
```

**`src/lib/copilot/types.ts`**：

```ts
/** 图像引用：URL（disk 路径或 data URL）+ 来源标签（用于 LLM 文本注释） */
export interface ImageRef {
  url: string                   // images/{f}.png  |  /api/results/.../{f}.png  |  data:image/...
  source_label: string          // "task_result#abc123 · field=image_url"
  ctx_tag?: number              // 来自圈选时填充；来自 tool_result 时省略
}

export interface ToolResultContent {
  // ... 现有 inline/ref/compacted
  attachments?: ImageRef[]      // ← 新增 optional
}
```

### 4.2 LLM client 层（Anthropic 序列化器修复）

**`src/lib/copilot/llm-stream.ts`**（两个序列化函数）：

```ts
function imageBlockForAnthropic(url: string): Record<string, unknown> {
  // 检测 data URL → 拆出 media_type + base64 data
  const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(url)
  if (dataMatch) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataMatch[1],
        data: dataMatch[2],
      },
    }
  }
  // HTTP(S) URL → 现行 source.type='url' 不变
  return {
    type: 'image',
    source: { type: 'url', url },
  }
}

// serializeAnthropicAssistantBlock + serializeAnthropicNonAssistant 复用此 helper：
content: m.content.map(b => {
  if (b.type === 'text') return { type: 'text', text: b.text }
  return imageBlockForAnthropic(b.image_url.url)
})
```

OpenAI 不动 —— `image_url.url` 接受 data URL native。

**`src/lib/llm-client.ts`** 同处理（非流式 callLlm 的 `buildRequestBody` 也走 anthropic 分支）—— 抽 `imageBlockForAnthropic` 到 shared util 或就地复制（YAGNI 倾向就地）。

### 4.3 图像收集与字节读取（新文件）

**`src/lib/copilot/image-attach.ts`**：

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { getSchema } from '@/lib/schema'
import { readResults } from '@/lib/store'
import type { CopilotMessage, CopilotContextRef, ImageRef } from './types'

const IMAGE_FIELD_NAME_RE = /url|image|pic|img|photo/i
const PATH_PREFIX_RE = /^(images\/|\/api\/results\/[^/]+\/images\/)/
const MAX_IMAGES_PER_TURN = 5

interface CollectInput {
  branch: CopilotMessage[]      // active branch 已 sliced + microcompacted
  modelVisionCapable: boolean   // false 时返 [] 直接短路
}

interface CollectOutput {
  user_image_refs: ImageRef[]   // 给最后一条 user msg
  tool_image_refs: Map<string, ImageRef[]>  // call_id → refs
  dropped_count: number          // 超 cap 被丢弃数；UI 显示 warning
}

/** 主入口：扫整个 branch 收集所有图像 ref（dedupe + cap 5） */
export function collectImageRefs(input: CollectInput): CollectOutput { ... }

/** 把 ref.url 解析成磁盘路径并 base64 编码；失败返 null + 错误说明 */
export async function readImageBytes(
  ref: ImageRef,
): Promise<{ data_url: string } | { error: string }> {
  const diskPath = resolveImageDiskPath(ref.url)
  if (!diskPath) {
    if (ref.url.startsWith('data:')) return { data_url: ref.url }
    return { error: `unsupported url: ${ref.url}` }
  }
  try {
    const buf = await fs.readFile(diskPath)
    const ext = path.extname(diskPath).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'image/png'
    return { data_url: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

function resolveImageDiskPath(url: string): string | null {
  // images/{exp_id_implied}/foo.png 形式 —— 来源 ImageRef.source_label 已带 exp_id
  // /api/results/{exp_id}/images/{f}.png → cwd + data/results/{exp_id}/images/{f}.png
  const m1 = /^\/api\/results\/([^/]+)\/images\/([^/]+\.(png|jpg|jpeg|webp))$/.exec(url)
  if (m1) return path.join(process.cwd(), 'data', 'results', m1[1], 'images', m1[2])
  // ImageRef 内部约定：来自圈选时 url 已经被规范化为 /api/... 形式
  return null
}
```

**Schema-aware extraction**（`collectImageRefs` 内部）：

```ts
function extractFromTaskResult(
  ref: CopilotContextRef,
  ctx_tag: number,
): ImageRef[] {
  const expId = (ref.extra as { experiment_id?: string } | undefined)?.experiment_id
  if (!expId) return []
  const exp = getExperiment(expId)
  if (!exp?.schema_id) return []
  const schema = getSchema(exp.schema_id)
  if (!schema) return []

  const imageFields = schema.output_schema?.fields?.filter(
    f => f.type === 'image_url' || f.type === 'image_url_list',
  ) ?? []
  // 兜底启发式：未声明类型但字段名暗示图像 + 值像路径
  const heuristicFields = schema.output_schema?.fields?.filter(
    f => !imageFields.includes(f) && IMAGE_FIELD_NAME_RE.test(f.name),
  ) ?? []

  const results = readResults(expId)
  const found = results.find(r => r.task_id === ref.id)
  if (!found || found.status !== 'success' || !found.output) return []

  const refs: ImageRef[] = []
  for (const fd of imageFields) {
    const v = (found.output as Record<string, unknown>)[fd.name]
    if (fd.type === 'image_url' && typeof v === 'string' && v) {
      refs.push({ url: normalizeUrl(v, expId), source_label: `task_result#${ref.id} · ${fd.name}`, ctx_tag })
    } else if (fd.type === 'image_url_list' && Array.isArray(v)) {
      for (const url of v as unknown[]) {
        if (typeof url === 'string' && url) {
          refs.push({ url: normalizeUrl(url, expId), source_label: `task_result#${ref.id} · ${fd.name}`, ctx_tag })
        }
      }
    }
  }
  for (const fd of heuristicFields) {
    const v = (found.output as Record<string, unknown>)[fd.name]
    if (typeof v === 'string' && PATH_PREFIX_RE.test(v)) {
      refs.push({ url: normalizeUrl(v, expId), source_label: `task_result#${ref.id} · ${fd.name} (inferred)`, ctx_tag })
    }
  }
  return refs
}

function normalizeUrl(raw: string, expId: string): string {
  if (raw.startsWith('data:') || raw.startsWith('http')) return raw
  if (raw.startsWith('/api/results/')) return raw
  if (raw.startsWith('images/')) return `/api/results/${expId}/${raw}`
  return raw  // 未知形式，兜底原样
}
```

**Dedup + Cap**（顶层 collect）：

```ts
const seen = new Set<string>()
const all: ImageRef[] = []
let dropped = 0
for (const ref of allCandidates) {
  if (seen.has(ref.url)) continue
  if (all.length >= MAX_IMAGES_PER_TURN) { dropped++; continue }
  seen.add(ref.url)
  all.push(ref)
}
```

**`task_field` 类型也支持**：`extra.field` 指向 `image_url` 类型字段时同样收集（但只有 1 张）。逻辑：从 `extra.task_id` 拿 result，从 `extra.field` 取值，复用 `normalizeUrl` 输出 `ImageRef`。

**通用 helper 暴露给工具复用**：

```ts
// 给 read-context / read-experiment-results / read-resource 用的纯函数版
export function extractImageRefsFromOutput(
  output: Record<string, unknown>,
  schema: TaskSchema,
  expId: string,
  ctx_tag?: number,         // 工具调用路径不传；圈选路径传
  task_id?: string,         // source_label 用
): ImageRef[]
```

### 4.4 build-llm-messages 改造

**签名变 async**：`buildLlmMessages` → `Promise<LlmMessage[]>`。caller 跟着改：
- `runToolAwareLlmStream`（已 async）→ `await buildLlmMessages(...)`
- `__tests__/build-llm-messages*.test.ts` → 测试改 `await`

**核心改动（伪码）**：

```ts
export async function buildLlmMessages(
  branch: CopilotMessage[],
  pageContext?: PageContext | null,
  opts?: { sessionId?: string; modelVisionCapable?: boolean },
): Promise<LlmMessage[]> {
  const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

  const usable = sliceAfterBoundary(branch)
  // ... SystemHeader 拼接（不变）

  const { messages: compacted, didCompact } = microCompact(usable, ...)
  if (didCompact && opts?.sessionId) appendCompactBoundary(...)

  // ★ 预计算"最后一条 user 消息"引用，避免 O(N²)
  const lastUserMsg = [...compacted].reverse().find(m => m.role === 'user')

  // ★ 新增：图像收集 + 字节读取
  let imageMap: ImagePlan = { user_blocks: [], tool_blocks_by_call_id: new Map(), system_notes: [] }
  if (opts?.modelVisionCapable) {
    const collected = collectImageRefs({ branch: compacted, modelVisionCapable: true })
    imageMap = await materializeImagePlan(collected)  // fs.readFile + base64 + 错误降级
    if (collected.dropped_count > 0) {
      imageMap.system_notes.push(`[${collected.dropped_count} images not attached: per-turn cap is ${MAX_IMAGES_PER_TURN}]`)
    }
  } else if (collectImageRefs({ branch: compacted, modelVisionCapable: false }).user_image_refs.length > 0) {
    // 兜底：模型不是 vision，但用户圈了图。剥离 + system note
    imageMap.system_notes.push('[Image attachments dropped: selected model is not vision_capable]')
  }
  for (const note of imageMap.system_notes) {
    out.push({ role: 'system', content: note })
  }

  // ★ 修改：组装时按 image plan 重写 user / tool_result content
  for (const m of compacted) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      const isLast = m === lastUserMsg
      const blocks = isLast ? imageMap.user_blocks : []
      if (blocks.length === 0) {
        out.push({ role: 'user', content: m.content })
      } else {
        out.push({
          role: 'user',
          content: [...blocks, { type: 'text', text: m.content }],
        })
      }
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content })
    } else if (m.role === 'tool_use') {
      // 不变
    } else if (m.role === 'tool_result') {
      // ★ 修改：检测 attachments
      const parsed = normalizeToolResult(m.content)
      const blocks = m.call_id ? imageMap.tool_blocks_by_call_id.get(m.call_id) ?? [] : []
      let visible: string | Array<{type:'text', text:string} | {type:'image_url', image_url:{url:string}}>
      let isError = false
      if (parsed.kind === 'inline') {
        const valueText = JSON.stringify(parsed.value ?? null)
        if (isToolErrorShape(parsed.value)) isError = true
        if (blocks.length === 0) {
          visible = valueText
        } else {
          visible = [{ type: 'text', text: valueText }, ...blocks]
        }
      } else if (parsed.kind === 'ref') {
        // ref kind 不附图（避免 read_tool_result 重复附）
        visible = `${parsed.preview}\n\n[Full result available via read_tool_result(ref="${parsed.ref}")]`
      } else {
        visible = parsed.summary
      }
      out.push({
        role: 'tool_result',
        call_id: m.call_id!,
        content: typeof visible === 'string' ? visible : JSON.stringify(visible) /* TODO: see §4.4.1 */,
        ...(isError ? { is_error: true } : {}),
      })
    }
  }
  return out
}
```

#### 4.4.1 `LlmMessage.tool_result.content` 类型扩展

当前 `LlmMessage` 的 `tool_result` 变体是：

```ts
{ role: 'tool_result'; call_id: string; content: string; is_error?: boolean }
```

`content` 是 `string`，但我们要塞 `Array<{type:'text'|'image_url',...}>`。两个选择：

**A. 扩 LlmMessage.tool_result.content union**（推荐）
```ts
{
  role: 'tool_result'
  call_id: string
  content: string | Array<{type:'text', text:string} | {type:'image_url', image_url:{url:string}}>
  is_error?: boolean
}
```

`serializeAnthropicNonAssistant` + OpenAI tool_result 序列化处理两种形态。Anthropic 协议本就支持 tool_result content 是 array of content block；OpenAI 标准 `tool_result` 其实是 `tool` role with string content，但 OpenRouter / Anthropic-compatible gateway 多接受 array。

**B. 双路写**（备选）—— LlmMessage 不改，把图像作为额外 user message 紧跟 tool_result 后面
- pros: 不改类型；
- cons: 破坏 Anthropic user/assistant 严格交替；多一条用户消息搅乱对话历史

**采纳 A**。Anthropic 序列化器已经在第 4.2 节修了；OpenAI 这边需要确认 sankuai/OpenRouter 的 tool 消息是否接受 content array。**Plan 第一步要验证**（curl 实测）。fallback：若 OpenAI 不接受 array，改用 **B + tool_result 文本里嵌图像 ref 占位**（"[Image at idx 3 in following user msg]"），多发一条 user message 跟在 tool_result 后。

### 4.5 Tool 工具改造

**`src/lib/copilot/tools/read-context.ts`**：

```ts
// 在 call() 末尾，取到 ResolvedContext 之后：
if (resolved.type === 'task_result' || resolved.type === 'task_field') {
  const refs = extractImageRefsFromResolved(resolved)  // 复用 image-attach.ts 的 helper
  if (refs.length > 0) {
    return { ...result, _attachments: refs }
  }
}
```

**`src/lib/copilot/tools/read-experiment-results.ts`**：

```ts
// 拿到 results 数组后：
const allRefs: ImageRef[] = []
for (const r of results) {
  if (r.status !== 'success') continue
  const refs = extractImageRefsFromOutput(r.output, schema, expId, undefined)
  allRefs.push(...refs)
  if (allRefs.length >= MAX_IMAGES_PER_TURN) break
}
if (allRefs.length > 0) {
  return { ...result, _attachments: allRefs.slice(0, MAX_IMAGES_PER_TURN) }
}
```

**`src/lib/copilot/tools/read-resource.ts`**：当 type='experiment' + fields 含 result 时，附首个 task_result 的图（如有）。

**Tool result 落盘 & 加载**（`tool-result-store.ts`）：
- `maybePersistToolResult` 把 `_attachments` 字段一并存入落盘 JSON
- `loadPersistedToolResult` 读回时保留 attachments
- `read_tool_result` 工具回捞时 build-llm-messages 还能识别（关键：build-llm-messages 重放 normalizeToolResult 后看 `.attachments` 字段）

### 4.6 UI 改造

**`src/components/results/view-helpers.tsx`** —— `<ClickableImage>` 父级注入 context-extra：

```tsx
<div
  data-copilot-context="task_field"
  data-copilot-context-id={fieldName}
  data-copilot-context-extra={JSON.stringify({
    experiment_id: expId,
    task_id: taskId,
    field: fieldName,
    field_type: 'image_url',
    url: src,
  })}
  data-copilot-context-summary={`image: ${fieldName}`}
>
  <ClickableImage src={src} ... />
</div>
```

**`src/components/copilot/context-chip-rail.tsx`** —— 在 expanded panel 里检测 `detail.data` 含 image_url 字段时渲染缩略图：

```tsx
{detail && !loading && (
  <>
    {/* ... 现有 within / value / metadata ... */}
    {/* ★ 新增：image preview */}
    {extractImageUrlsFromDetail(detail).map((url, i) => (
      <div key={i} className="mt-1">
        <ClickableImage src={url} className="w-[120px] h-[120px] object-contain rounded border" />
      </div>
    ))}
  </>
)}
```

`extractImageUrlsFromDetail` 是客户端纯函数：扫 `detail.data.output` 找 image_url 类型字段（schema 元数据由 detail 一并返回，或者用启发式正则 PATH_PREFIX_RE）。

**`src/components/copilot/model-picker.tsx`** —— 接受 `requireVision: boolean` prop：

```tsx
const visibleModels = useMemo(
  () => cfg.models.filter(m =>
    m.copilot_enabled && (!requireVision || m.vision_capable)
  ),
  [cfg.models, requireVision],
)
```

**`src/components/copilot/chat-view.tsx`** —— 计算 imageContextCount：

```tsx
const imageContextCount = useMemo(
  () => contexts.filter(c =>
    (c.extra as { field_type?: string } | undefined)?.field_type === 'image_url'
    || c.type === 'task_result'  // 保守估计：所有 task_result 都*可能*含图，避免漏判
  ).length,
  [contexts],
)
// ↓ 准确做法：context 在前端不查 schema，无法 100% 判定。保守过滤即可，
//   后端 build-llm-messages 兜底 strip 见 §3.3。
<ModelPicker requireVision={imageContextCount > 0} />
```

**`src/components/settings/model-card.tsx`** —— vision_capable Checkbox（i18n key `settings.llm.vision_capable_label/desc`）：

```tsx
<div className="flex items-center gap-2">
  <Checkbox checked={form.vision_capable ?? false}
            onChange={v => setForm({...form, vision_capable: v})} />
  <Label>{t('settings.llm.vision_capable_label')}</Label>
</div>
<p className="text-xs text-muted-foreground">{t('settings.llm.vision_capable_desc')}</p>
```

### 4.7 i18n key 增量

`src/lib/i18n/{zh,en}.ts` 成对加：

```ts
// settings.llm.vision_capable_label: "Vision capable / 支持图像输入"
// settings.llm.vision_capable_desc:  "Enable to allow this model to receive image attachments from circled task_results / 允许此模型在 Copilot 接收圈选结果中的图像"
// copilot.model_picker_vision_required: "Vision-capable model required for image contexts / 含图 context 需要支持视觉的模型"
// copilot.image_dropped_warn: "{n} images not attached (cap {cap}/turn) / {n} 张图未附（每轮上限 {cap}）"
// copilot.chip.image_preview_label: "Image preview / 图像预览"
```

---

## 5 · 测试策略

### 5.1 单测（vitest）

| 文件 | 覆盖 |
|---|---|
| `src/lib/copilot/__tests__/image-attach.test.ts` | `collectImageRefs` schema-aware 提取（image_url + image_url_list）；启发式 fallback；dedup；N=5 cap + dropped_count；URL 规范化；非 vision 模型直接返空 |
| `src/lib/copilot/__tests__/image-attach.read-bytes.test.ts` | `readImageBytes` data URL 直通；磁盘文件成功；缺失文件返 error；非法路径阻断 |
| `src/lib/copilot/__tests__/build-llm-messages.image.test.ts` | user msg multimodal 重写（含图 / 不含图）；tool_result inline kind 加 attachments；tool_result ref kind 不加；vision 兜底 strip + system note；dropped_count system note |
| `src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts` | data: URL → source.type=base64 + media_type 解析；http URL 保持 source.type=url；混合 content array 正确遍历 |
| `src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts` | output 含 image_url 字段时 _attachments 填充；超 8 张截断；非生图实验不挂 _attachments |
| `src/lib/copilot/tools/__tests__/read-context.image.test.ts` | task_result + task_field 类型 ctx 都能挂 _attachments；非含图 result 不挂 |

预估 ~150 LOC 新测试，跑时间 <300ms。**不测 UI**（ChatView / ModelPicker / ChipRail），照"只测纯函数" 约定。

### 5.2 E2E smoke（不扩）

不加新 case。`e2e/smoke.spec.ts` 现有路由检查覆盖 chat 路由 no-crash 即可。Vision LLM 实际调用在手测里走。

### 5.3 手动验证 checklist（PR 前必跑）

- [ ] `/settings/llm` 加一个 `vision_capable=true` 的模型（如 sankuai 网关的 Claude-Sonnet）
- [ ] 跑一发 `image_gen_v1` 实验，确认 v0.10.0 链路仍 ok
- [ ] 实验详情页：圈选 1 张图 result → 打开 Copilot → 模型选择器只显示 vision_capable 模型 → 提问"为什么这张图主体偏左？" → LLM 回答应基于图像内容（非"我看不到图"套话）
- [ ] 圈 2 张图 → "对比 #1 和 #2 哪张更清晰" → LLM 应对应 ctx_1/ctx_2 给出图像级别评论
- [ ] 圈实验整体 → "这一批图整体偏暗吗？" → LLM 调 `read_experiment_results` → 应收到 _attachments 含 8 张图（cap）→ 给出整体评估
- [ ] 圈 6 张图 result → 应见 chip 警告"1 image not attached (cap 5)"
- [ ] 选非 vision 模型 + 试圈图 → 模型选择器应剔除该模型；强行 contexts 注入（dev tools 模拟）→ build-llm-messages 兜底 strip + system note
- [ ] 删图后再问 → "Image unavailable: ... — ENOENT" 占位文本可见
- [ ] Anthropic provider（claude-sonnet）+ data URL → 序列化为 source.type=base64；HTTP URL（远程）若有 → source.type=url
- [ ] OpenAI provider + image_url block → 透传 work
- [ ] Chip rail 展开 → 含图 detail 渲染 120px 缩略图；点击 → ImageLightbox

### 5.4 回归

- [ ] 不含图实验（QA, qa_answer_v1）正常 chat，零 fs.readFile 调用（perf）
- [ ] 旧 ModelConfig（无 vision_capable 字段）默认表现为 false，不破坏现有 copilot 工作流
- [ ] `npm test` / `npx tsc --noEmit` / `npm run build` 全绿
- [ ] `npm run test:e2e` 全绿

---

## 6 · 向后兼容 / 迁移

### 6.1 数据层

- `ModelConfig.vision_capable` optional —— 旧 config JSON 无此字段，加载默认 false；保存 default-undefined 不强制写入
- `LlmMessage.tool_result.content` 扩 union —— 老消息 content 是 string，新分支 array；序列化器认两种形态
- `ToolResultContent.attachments` optional —— 老 jsonl session 重放无 attachments，零行为差异
- `ImageRef` 是新类型，无迁移
- 无 fs / data 目录变化

### 6.2 Caller 改动（buildLlmMessages 变 async）

机械改：
- `src/lib/copilot/stream-response.ts` runToolAwareLlmStream → 已 async
- `src/lib/copilot/__tests__/build-llm-messages*.test.ts` → `await` 前缀
- 检索 `buildLlmMessages(` 全部 caller 跟改

### 6.3 UI

- 新 `vision_capable` checkbox 默认 unchecked —— 用户主动勾选才打开
- Model picker 过滤逻辑：现有 `copilot_enabled` 过滤之上叠加 vision filter；非含图场景下行为不变

### 6.4 API

- chat / tool-result route 签名不变（buildLlmMessages 内部 async 化对外不暴露）
- 无新 API endpoint
- 无 i18n key 删除（只增）

---

## 7 · 不做（v3+）

| 项 | 原因 | 触发条件 |
|---|---|---|
| VLM-as-judge 自动评分 | v0.10.0 spec 已明确放 v2；本 spec 是 v2 也不做 | 用户明确反馈手动评分慢 |
| 输入图（input_refs）的 vision 注入 | v1 outputs-only。input image 在 bubble overlay schema 用 url 类型字段，需要走 dataset 解析路径，复杂 | 用户明确想"看输入图调 prompt" |
| 远程 HTTP 图像 fetch & cache | base64 path 已覆盖主用例。HTTP fetch 涉及超时/重试/cache 策略 | 用户用远程 storage（S3 等） |
| Token-budget per-session 累计上限 | 每轮 N=5 cap 已 bound；多轮累计由 micro-compact + chain cap 5 兜底 | 实测发现某用户对话长期吃不消 |
| 图像 lightbox 缩放 / 平移 / 多图切换 | v0.10.0 spec 已放 v2 | 用户反馈要细看像素 |
| Image-aware tool（如 `compare_images(ctx_a, ctx_b)`） | 现有 read_context + 多模态注入已能让 LLM 自己 compare | 多次 chain miss / LLM 不会主动比较 |
| `app_base_url` 静态配置（HTTP URL fallback） | base64 always 简单可靠；公网部署的优化收益小 | 用户实际部署到公网 + 投诉 token 费 |

---

## 8 · 改动文件清单

**改（13 个）**：

核心运行时：
- `src/lib/llm-config.ts` — `ModelConfig.vision_capable?: boolean`
- `src/lib/copilot/types.ts` — `ImageRef` 类型；`ToolResultContent.attachments?` 字段
- `src/lib/llm-client.ts` — Anthropic 分支 imageBlockForAnthropic（data URL → base64）
- `src/lib/copilot/llm-stream.ts` — 同上（serializeAnthropicAssistantBlock + serializeAnthropicNonAssistant）
- `src/lib/copilot/build-llm-messages.ts` — async + image plan + multimodal rewrite + vision strip 兜底
- `src/lib/copilot/stream-response.ts` — `await buildLlmMessages(...)`
- `src/lib/copilot/tool-result-store.ts` — persist `attachments` 字段
- `src/lib/copilot/tools/read-context.ts` — _attachments 输出
- `src/lib/copilot/tools/read-experiment-results.ts` — _attachments + cap 5
- `src/lib/copilot/tools/read-resource.ts` — task_result 取首图（适用时）

UI / 配置：
- `src/components/settings/model-card.tsx` — vision_capable Checkbox
- `src/components/copilot/model-picker.tsx` — `requireVision` filter
- `src/components/copilot/chat-view.tsx` — 计算 imageContextCount → 传 picker
- `src/components/copilot/context-chip-rail.tsx` — expanded detail 渲染缩略图
- `src/components/results/view-helpers.tsx` — ClickableImage 父级注入 context-extra
- `src/lib/i18n/zh.ts` + `src/lib/i18n/en.ts` — 5 个新 key

**新增（7 个）**：
- `src/lib/copilot/image-attach.ts` — collectImageRefs / readImageBytes / extractImageRefsFromOutput
- `src/lib/copilot/__tests__/image-attach.test.ts`
- `src/lib/copilot/__tests__/image-attach.read-bytes.test.ts`
- `src/lib/copilot/__tests__/build-llm-messages.image.test.ts`
- `src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts`
- `src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts`
- `src/lib/copilot/tools/__tests__/read-context.image.test.ts`

**删**：无

---

## 9 · 开放问题（plan 阶段定）

1. **OpenAI tool_result content array 兼容性** —— Plan Step 1 必须 curl 实测 sankuai gateway 是否接受 `tool` role + `content: [{type:'text'},{type:'image_url'}]`。若不接受，落 §4.4.1 备选 B（tool_result 文字 + 紧跟 user image message）。
2. **Schema cache 作用域** —— buildLlmMessages 内 per-call Map vs 模块级 Map（per-process）。倾向 per-call 保纯函数；如实测 perf 不足再升级。
3. **`read_tool_result` 回捞后的图像重附** —— 落盘 attachments 是 `ImageRef[]`，回捞后 build-llm-messages 重新走 `materializeImagePlan`。需明确：是按 cap 5 重新计算，还是该次 tool_result 独立 cap？倾向独立 cap（每个 tool_result 各自最多 5），避免重复计数。Plan 阶段确认。
4. **`task_result` 的 imageContextCount 前端检测精度** —— chat-view 拿不到 schema 元数据，无法 100% 判定。当前提案"task_result 类型一律按可能含图"是保守上限，会过度 filter model picker。可选优化：context capture 时同步带 `has_image: boolean` flag（schema 在 server resolve 时填回）。Plan 阶段考虑。
5. **Vision capable 默认值的迁移建议** —— 是否在 first-run UX 给现有 vision 主流模型（claude-sonnet/opus、gpt-4o、gemini-pro）预填 true？倾向保守：留空，让用户主动开。文档 + skill 里写清。Plan 阶段定。

---

## 10 · 测试验收标准

spec → done 前验证：

- [ ] `npm test` 全绿（含 ~6 组新单测）
- [ ] `npm run test:e2e` 全绿
- [ ] `npx tsc --noEmit` 零 error
- [ ] `npm run build` 成功
- [ ] §5.3 手测 11 项全过
- [ ] §5.4 回归全过
- [ ] CHANGELOG `[Unreleased]` 段加 entry（`## Copilot × Image Vision`）
- [ ] PR description 含：改了什么 / 为什么 / 怎么验证 / 向后兼容风险
