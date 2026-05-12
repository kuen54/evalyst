# Sample Data Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全删现有 trivia/image seeds，落 3 套真 benchmark suite（GSM8K + BELLE-eval + PartiPrompts + RefCOCO），覆盖 7 种 display 形态、4 套 sample experiment 预跑结果开箱即体验。

**Architecture:** 4 个 PR 渐进交付。PR 1 给 evalyst llm-client 加 OpenAI Images API 端点支持（生图前置）；PR 2 把 seed.ts 改成扫子目录（解耦 id 列表）；PR 3 主体——拉数据、写 schema/rubric/display、跑 experiment、ship 进 git；PR 4（可降级）补 table / grouped_grid display 的 computed-field / annotation-pull mini 协议。每个 PR 独立可合、可 revert。

**Tech Stack:** TypeScript / Next.js 16 / Node 18 fetch / Vitest / Playwright；数据来源 Hugging Face / GitHub raw；LLM 调用走美团 sankuai gateway（OpenAI 兼容 + Anthropic 兼容 + OpenAI Images API）。

**Spec 来源:** [`docs/superpowers/specs/2026-05-12-sample-data-redesign-design.md`](../specs/2026-05-12-sample-data-redesign-design.md)

---

## Phase 1 · llm-client `/images/generations` 端点支持（PR 1）

> 前置改造，给 evalyst LLM 客户端加 OpenAI Images API 端点路由，让 GPT-Image-2 这类纯生图模型可调。Scope 约 150 行 src + 80 行 tests。

> **架构**：在 `ApiConfig`（src/lib/types.ts）+ `ModelConfig`（src/lib/llm-config.ts）上加 `endpoint_kind?: 'chat' | 'images_generations'`（默认 `'chat'`，向后兼容）。`callLlm` 入口先按 `config.endpoint_kind` 分发：`'chat'` 复用现有路径；`'images_generations'` 走新 `callImagesGenerations()` helper（构造 OpenAI Images API body → POST `${base}/images/generations` → 解析 `data[0].b64_json` → 输出 `LlmResponse` 结构与 chat 端点 image 输出对齐）。所有 retry / timeout 复用现有 `executeWithRetry`。

### Task 1.1 · 在 `ApiConfig` + `ModelConfig` 加 `endpoint_kind` 字段

**Files:**
- Modify: `src/lib/types.ts` (ApiConfig 类型)
- Modify: `src/lib/llm-config.ts` (ModelConfig 类型 + migrate 兼容)

- [ ] **Step 1: 在 `ApiConfig` 加可选字段**

修改 `src/lib/types.ts`：

```typescript
export interface ApiConfig {
  api_format?: 'openai' | 'anthropic'
  base_url: string
  api_key: string
  extra_body?: Record<string, unknown>
  /**
   * 路由 LLM 调用走哪个端点。默认 'chat' = `/chat/completions`（OpenAI 兼容）
   * 或 `/messages`（Anthropic）。'images_generations' = OpenAI Images API
   * `/images/generations`，仅 OpenAI 兼容下生效（api_format='openai' 时）。
   */
  endpoint_kind?: 'chat' | 'images_generations'
}
```

- [ ] **Step 2: 在 `ModelConfig` 加同名字段（持久化到 llm-config.json）**

修改 `src/lib/llm-config.ts:22-34`，在 `ModelConfig` 末尾追加：

```typescript
  endpoint_kind?: 'chat' | 'images_generations'  // 默认 'chat'；UI 配置生图模型时选 'images_generations'
```

- [ ] **Step 3: migrate 兼容（老 config 缺字段 → undefined → 调用时按 'chat' 走）**

无需改 `migrate()`：未声明的字段在 TypeScript optional 下读出来就是 undefined，下游 `callLlm` 用 `config.endpoint_kind ?? 'chat'` 兜底。

- [ ] **Step 4: 跑 tsc 验证类型**

```bash
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 5: commit**

```bash
git add src/lib/types.ts src/lib/llm-config.ts
git commit -m "$(cat <<'EOF'
feat(llm): add endpoint_kind field on ApiConfig and ModelConfig

为生图 API（OpenAI /images/generations）路由做准备。可选字段，未配置时按
'chat' 兜底 → 完全向后兼容。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2 · 实现 `callImagesGenerations` helper + 单测

**Files:**
- Modify: `src/lib/llm-client.ts` (加 helper)
- Create: `src/lib/__tests__/llm-client.images-generations.test.ts`

- [ ] **Step 1: 写失败测试（请求 body shape）**

新建 `src/lib/__tests__/llm-client.images-generations.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callLlm } from '../llm-client'

describe('callLlm with endpoint_kind=images_generations', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('builds request body with model/prompt/size/quality and POSTs to /images/generations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: 'AAAA' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await callLlm({
      messages: [{ role: 'user', content: 'A red cube' }],
      config: {
        api_format: 'openai',
        base_url: 'https://example.com/v1',
        api_key: '1983731511187542037',
        endpoint_kind: 'images_generations',
      },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 4096,
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://example.com/v1/images/generations')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'A red cube',
      size: '1024x1024',
      quality: 'low',
    })
    // 不应该带 messages / max_tokens / temperature（Images API 不接受）
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('max_tokens')
  })
})
```

- [ ] **Step 2: 跑测试，验证 fail**

```bash
npx vitest run src/lib/__tests__/llm-client.images-generations.test.ts
```

预期：FAIL（`callLlm` 当前无 endpoint_kind 路由，会构造 chat body）。

- [ ] **Step 3: 实现 `callImagesGenerations` helper**

修改 `src/lib/llm-client.ts`，在 `callLlm` 入口加路由（在第 130 行附近 `if (!p.config.base_url || !p.config.api_key)` 检查之后）：

```typescript
  if ((p.config.endpoint_kind ?? 'chat') === 'images_generations') {
    return callImagesGenerations(p)
  }
```

在文件末尾（`executeWithRetry` 之后）加 helper：

```typescript
// ---------- OpenAI Images API 端点支持（生图模型） ----------

async function callImagesGenerations(p: CallLlmParams): Promise<LlmResponse> {
  const start = Date.now()
  // 取最后一条 user 消息的 content 作为 prompt（生图 API 不接 messages 数组）
  const lastUser = [...p.messages].reverse().find(m => m.role === 'user')
  const prompt = !lastUser
    ? ''
    : typeof lastUser.content === 'string'
      ? lastUser.content
      : lastUser.content.map(b => ('text' in b ? b.text : '')).join('')

  const base = p.config.base_url.replace(/\/$/, '')
  const body: Record<string, unknown> = {
    model: p.model,
    prompt,
    size: '1024x1024',
    quality: 'low',
    ...(p.config.extra_body ?? {}),
  }
  const req: ApiRequestSpec = {
    url: `${base}/images/generations`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: p.config.api_key.startsWith('Bearer ')
        ? p.config.api_key
        : `Bearer ${p.config.api_key}`,
    },
    body,
  }

  const data = await executeWithRetry(req, p.signal)
  const images = parseImagesGenerationsResponse(data)
  return {
    content: '',
    ...(images !== undefined ? { images } : {}),
    latency_ms: Date.now() - start,
  }
}

function parseImagesGenerationsResponse(data: unknown): LlmResponse['images'] | undefined {
  const d = data as { data?: Array<Record<string, unknown>> }
  if (!Array.isArray(d.data)) return undefined
  const out = d.data
    .map((entry): { url: string; mime_type?: string } | null => {
      const b64 = entry.b64_json
      if (typeof b64 === 'string' && b64.length > 0) {
        return { url: `data:image/png;base64,${b64}`, mime_type: 'image/png' }
      }
      const url = entry.url
      if (typeof url === 'string' && url.length > 0) return { url }
      return null
    })
    .filter((x): x is { url: string; mime_type?: string } => x !== null)
  return out.length > 0 ? out : undefined
}
```

- [ ] **Step 4: 跑测试，验证通过**

```bash
npx vitest run src/lib/__tests__/llm-client.images-generations.test.ts
```

预期：PASS。

- [ ] **Step 5: commit**

```bash
git add src/lib/llm-client.ts src/lib/__tests__/llm-client.images-generations.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): route images_generations endpoint via callImagesGenerations

构造 OpenAI Images API body（model/prompt/size/quality），POST 到 /images/generations，
解析 data[0].b64_json → LlmResponse.images（与 chat 端点输出 shape 对齐）。
extra_body 透传 + Authorization Bearer 复用 chat 路径策略。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3 · 单测覆盖响应解析（b64_json + url 两种返回形态）

**Files:**
- Modify: `src/lib/__tests__/llm-client.images-generations.test.ts`

- [ ] **Step 1: 加 b64_json 解析测试**

在测试文件追加：

```typescript
  it('parses b64_json response into data:image URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }),
        { status: 200 },
      ),
    )
    const res = await callLlm({
      messages: [{ role: 'user', content: 'cat' }],
      config: { api_format: 'openai', base_url: 'https://x.test/v1', api_key: 'k', endpoint_kind: 'images_generations' },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 0,
    })
    expect(res.images).toEqual([{ url: 'data:image/png;base64,iVBORw0KGgo=', mime_type: 'image/png' }])
    expect(res.content).toBe('')
  })

  it('parses bare url response when b64_json absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example.com/img/abc.png' }] }),
        { status: 200 },
      ),
    )
    const res = await callLlm({
      messages: [{ role: 'user', content: 'cat' }],
      config: { api_format: 'openai', base_url: 'https://x.test/v1', api_key: 'k', endpoint_kind: 'images_generations' },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 0,
    })
    expect(res.images).toEqual([{ url: 'https://cdn.example.com/img/abc.png' }])
  })
```

- [ ] **Step 2: 跑测试**

```bash
npx vitest run src/lib/__tests__/llm-client.images-generations.test.ts
```

预期：PASS（3 tests）。

- [ ] **Step 3: commit**

```bash
git add src/lib/__tests__/llm-client.images-generations.test.ts
git commit -m "test(llm): cover b64_json + bare url images_generations response parsing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.4 · 单测覆盖错误路径（HTTP 4xx / 5xx）

**Files:**
- Modify: `src/lib/__tests__/llm-client.images-generations.test.ts`

- [ ] **Step 1: 加 HTTP 4xx throw 测试**

```typescript
  it('throws on HTTP 4xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid prompt"}', { status: 400 }),
    )
    await expect(callLlm({
      messages: [{ role: 'user', content: 'x' }],
      config: { api_format: 'openai', base_url: 'https://x.test/v1', api_key: 'k', endpoint_kind: 'images_generations' },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 0,
    })).rejects.toThrow(/HTTP 400/)
  })

  it('retries on 429 / 5xx (existing executeWithRetry path)', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++
      if (calls < 3) return new Response('rate limited', { status: 429 })
      return new Response(JSON.stringify({ data: [{ b64_json: 'OK' }] }), { status: 200 })
    })
    const res = await callLlm({
      messages: [{ role: 'user', content: 'x' }],
      config: { api_format: 'openai', base_url: 'https://x.test/v1', api_key: 'k', endpoint_kind: 'images_generations' },
      model: 'gpt-image-2',
      temperature: 1,
      max_tokens: 0,
    })
    expect(calls).toBe(3)
    expect(res.images).toBeDefined()
  }, 15_000)  // backoff sleep 累计 ~6s
```

- [ ] **Step 2: 跑测试**

```bash
npx vitest run src/lib/__tests__/llm-client.images-generations.test.ts
```

预期：5 tests PASS。第二个 retry test 慢，~10s。

- [ ] **Step 3: commit**

```bash
git add src/lib/__tests__/llm-client.images-generations.test.ts
git commit -m "test(llm): cover error + retry paths for images_generations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.5 · `/settings/llm` UI 加端点类型 Select

**Files:**
- Modify: `src/components/settings/model-card.tsx`

- [ ] **Step 1: 在 api_format Select 旁边加 endpoint_kind Select**

修改 `src/components/settings/model-card.tsx`，在 `<div className="grid grid-cols-2 gap-3">`（第 121 行）之后插入新一行：

```tsx
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("settings.llm.endpoint_kind_label")}</Label>
            <Select
              value={entry.endpoint_kind ?? 'chat'}
              onValueChange={v => { if (v) set("endpoint_kind", v as 'chat' | 'images_generations') }}
            >
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">{t("settings.llm.endpoint_kind_chat")}</SelectItem>
                <SelectItem value="images_generations">{t("settings.llm.endpoint_kind_images_generations")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex items-end">
            <p className="text-xs text-muted-foreground leading-snug">
              {t("settings.llm.endpoint_kind_hint")}
            </p>
          </div>
        </div>
```

放在原 grid 块之后、`<div className="space-y-1.5"><Label>{t("settings.llm.base_url_label")}…` 之前。

- [ ] **Step 2: 验证 UI 渲染（dev server）**

```bash
npm run dev
```

浏览器打开 `http://localhost:3000/settings/llm`，新建一个 model，确认能看到"端点类型"下拉，默认为"Chat (默认)"，可切到"Images Generations (生图)"。

- [ ] **Step 3: commit**

```bash
git add src/components/settings/model-card.tsx
git commit -m "$(cat <<'EOF'
feat(settings/llm): add endpoint kind selector to model card

新增"端点类型"下拉，让用户为生图模型（如 GPT-Image-2）选 OpenAI Images API
端点而不是默认的 chat completions。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.6 · i18n key（zh.ts + en.ts 成对加）

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: 在 zh.ts 找到 `settings.llm.api_format_label` 那一行（约第 326 行），在其 block 内追加 4 个 key**

```typescript
  "settings.llm.endpoint_kind_label": "端点类型",
  "settings.llm.endpoint_kind_chat": "Chat（默认）",
  "settings.llm.endpoint_kind_images_generations": "Images Generations（生图）",
  "settings.llm.endpoint_kind_hint": "生图模型（如 GPT-Image-2）走 OpenAI /images/generations 端点；普通对话保持 Chat。",
```

- [ ] **Step 2: 在 en.ts 同位置追加同 4 个 key（English 翻译）**

```typescript
  "settings.llm.endpoint_kind_label": "Endpoint kind",
  "settings.llm.endpoint_kind_chat": "Chat (default)",
  "settings.llm.endpoint_kind_images_generations": "Images Generations",
  "settings.llm.endpoint_kind_hint": "Image-out models (e.g. GPT-Image-2) use OpenAI /images/generations endpoint; keep Chat for conversational models.",
```

- [ ] **Step 3: 跑 tsc 验证 en.ts 类型完整性（en 用 `Record<keyof typeof zh, string>`，缺 key 会编译失败）**

```bash
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 4: commit**

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(i18n): add endpoint kind labels for llm settings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.7 · 跑五件套验证 + 真 API smoke 验证

**Files:**
- 无文件修改；纯验证。

- [ ] **Step 1: 跑五件套**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
```

预期：全绿。如果 knip 报新增 helper 或 i18n key 未使用，确认是误报（model-card 用到了）后忽略或加进 knip ignore。

- [ ] **Step 2: 跑 Playwright e2e**

```bash
npm run test:e2e
```

预期：全绿（这次 PR 不影响现有 e2e 路径）。

- [ ] **Step 3: 手动 smoke 真 API（GPT-Image-2 via 美团 sankuai gateway）**

`npm run dev`，浏览器打开 `/settings/llm`，新建 model：

- name: `gpt-image-2-test`
- api_format: `openai`
- endpoint_kind: `images_generations`
- base_url: `https://aigc.sankuai.com/v1/openai/native`
- api_key: `1983731511187542037`
- model: `gpt-image-2`

保存。在 model card 上点"测试连接"按钮，预期返回 HTTP 200（注：`handleTest` 当前用 chat body，需要后续补 images_generations 的 test path——本 PR 仅验证主调用路径，"测试连接"按钮的 endpoint_kind 适配作为已知 follow-up）。

或者直接用 `image_gen_v1`（仍是老 sample）schema 跑一个 1-prompt 的 mini experiment，验证图能落盘。

- [ ] **Step 4: 起 branch + push**

```bash
git checkout -b feat/llm-client-images-generations
git push -u origin feat/llm-client-images-generations
```

- [ ] **Step 5: 开 PR**

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat(llm): support OpenAI Images API endpoint" --body "$(cat <<'EOF'
## 改了什么

给 evalyst llm-client 加 OpenAI Images API（`/images/generations`）端点支持。

- `ApiConfig` / `ModelConfig` 新增可选字段 `endpoint_kind: 'chat' | 'images_generations'`（默认 'chat'，向后兼容）
- `callLlm` 入口按 endpoint_kind 分发；`callImagesGenerations()` helper 构造 OpenAI Images API body（model/prompt/size/quality），POST 到 `${base}/images/generations`
- 响应解析：`data[0].b64_json` → `LlmResponse.images[0]`（data:URL 形式，与 chat 端点 image 输出 shape 对齐，下游 image-store / display 完全复用）
- `/settings/llm` UI 加"端点类型"下拉
- i18n key（zh/en 成对加 4 个）
- 5 个新单测覆盖请求 body / b64_json 解析 / bare url 解析 / HTTP 4xx / 429 retry

## 为什么

为 sample data redesign（spec `docs/superpowers/specs/2026-05-12-sample-data-redesign-design.md` §5.7 + §7）做前置。GPT-Image-2 走 `/images/generations`（不是 chat completions），现有 llm-client 只支持 chat 协议，需要扩展。

## 怎么验证

- 五件套全绿：`npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip`
- E2E：`npm run test:e2e`
- 手动 smoke：用 GPT-Image-2 via sankuai gateway 跑一个 1-prompt mini experiment，验证图落盘到 `data/images/`

## 向后兼容风险

- 老 ModelConfig 不带 endpoint_kind 字段 → 读出 undefined → `callLlm` 用 `?? 'chat'` 兜底，完全兼容
- llm-config.json migrate 不需改（optional 字段自然兼容）
- "测试连接"按钮当前仍用 chat body，对 images_generations 模型测连会报"无 messages"或类似错——已知 follow-up，不阻塞本 PR

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 · seed.ts 扫子目录改造（PR 2）

> 把 seed.ts 从硬编 id 列表改成扫子目录机制，为 PR 3 ship 大量 sample 资源做准备。**这一步不动现有 sample 数据语义**——把现有 8 个 seed 文件 git mv 到子目录里，保证老 sample（qa_pairs / image_prompts_v1）仍然能 seed 出来；PR 3 才动这些文件本身。

> **架构**：新 `seedFromDir(srcSubdir, dstDir, allowedExts)` helper 扫 `src/lib/seeds/<srcSubdir>/`，对每个允许后缀的文件 existsSync 跳过 / 不存在则复制到 `dstDir`。`ensureSeeds()` 调用 7 次该 helper（datasets / schemas / rubrics / displays / experiments / results / annotations）+ 1 次 `seedSampleImages()`（拷 `src/lib/seeds/images/` 到 `public/sample-images/`）。幂等性与现机制一致。

### Task 2.1 · 创建子目录 + git mv 现有 seed 文件

**Files:**
- Create: `src/lib/seeds/{datasets,schemas,rubrics,displays,experiments,results,annotations,judges,images,LICENSES}/.gitkeep`（先建空目录）
- Move: 8 个现有 seed 文件

- [ ] **Step 1: 建 9 个子目录 + .gitkeep**

```bash
cd /Users/lijiakun/Documents/evalyst
for d in datasets schemas rubrics displays experiments results annotations judges images LICENSES; do
  mkdir -p "src/lib/seeds/$d"
  touch "src/lib/seeds/$d/.gitkeep"
done
```

- [ ] **Step 2: git mv 4 个 dataset 文件**

```bash
git mv src/lib/seeds/qa_pairs.jsonl src/lib/seeds/datasets/qa_pairs.jsonl
git mv src/lib/seeds/qa_pairs.meta.json src/lib/seeds/datasets/qa_pairs.meta.json
git mv src/lib/seeds/image_prompts_v1.jsonl src/lib/seeds/datasets/image_prompts_v1.jsonl
git mv src/lib/seeds/image_prompts_v1.meta.json src/lib/seeds/datasets/image_prompts_v1.meta.json
```

- [ ] **Step 3: git mv 2 个 schema 文件（同时去掉 `.schema` 中缀，统一为 `<id>.json`）**

```bash
git mv src/lib/seeds/qa_answer_v1.schema.json src/lib/seeds/schemas/qa_answer_v1.json
git mv src/lib/seeds/image_gen_v1.schema.json src/lib/seeds/schemas/image_gen_v1.json
```

- [ ] **Step 4: git mv 2 个 rubric 文件（同样去掉 `.rubric` 中缀）**

```bash
git mv src/lib/seeds/qa_accuracy.rubric.json src/lib/seeds/rubrics/qa_accuracy.json
git mv src/lib/seeds/image_quality_v1.rubric.json src/lib/seeds/rubrics/image_quality_v1.json
```

- [ ] **Step 5: 验证 git status**

```bash
git status
```

预期：8 个 rename + 10 个 .gitkeep new file。无 modify。

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(seeds): move existing seed files into per-kind subdirectories

预备 PR 3 大批 sample 资源 ship。把 8 个 seed 文件 git mv 到
src/lib/seeds/{datasets,schemas,rubrics}/ 下，schema/rubric 文件名去掉
.schema/.rubric 中缀统一为 <id>.json。

下一步（同 PR）改 seed.ts 扫子目录读取，老 sample 仍能正常 seed 出来
（语义不变，仅文件位置变更）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2 · 写新 seed.ts 测试（先 fail）

**Files:**
- Create: `src/lib/__tests__/seed.test.ts`

- [ ] **Step 1: 写测试文件**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ensureSeeds } from '../seed'

describe('ensureSeeds (subdir-scan)', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-seed-test-'))
    // 拷一份 seeds 目录到 tmp（避免污染真实 src/lib/seeds）
    const realSeeds = path.join(originalCwd, 'src', 'lib', 'seeds')
    const tmpSeeds = path.join(tmpRoot, 'src', 'lib', 'seeds')
    fs.mkdirSync(tmpSeeds, { recursive: true })
    cpRecursive(realSeeds, tmpSeeds)
    process.chdir(tmpRoot)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('seeds all subdirs into data/{kind}/ on empty data tree', () => {
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/qa_pairs.meta.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/rubrics/qa_accuracy.json'))).toBe(true)
  })

  it('does not overwrite existing target files (idempotent)', () => {
    fs.mkdirSync(path.join(tmpRoot, 'data/datasets'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'), 'USER_EDITED')
    ensureSeeds()
    expect(fs.readFileSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'), 'utf-8')).toBe('USER_EDITED')
  })

  it('restores deleted seed files on next run', () => {
    ensureSeeds()
    fs.unlinkSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(false)
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(true)
  })

  it('skips .gitkeep and other non-data files', () => {
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/.gitkeep'))).toBe(false)
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/.gitkeep'))).toBe(false)
  })

  it('copies sample images to public/sample-images/', () => {
    // 在 tmp seeds/images/refcoco 放一张假图测试
    const fakeImgDir = path.join(tmpRoot, 'src/lib/seeds/images/refcoco')
    fs.mkdirSync(fakeImgDir, { recursive: true })
    fs.writeFileSync(path.join(fakeImgDir, 'fake.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'public/sample-images/refcoco/fake.jpg'))).toBe(true)
  })
})

function cpRecursive(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) cpRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}
```

- [ ] **Step 2: 跑测试，验证 fail**

```bash
npx vitest run src/lib/__tests__/seed.test.ts
```

预期：FAIL（当前 seed.ts 硬编 id 列表，新结构 schemas 子目录里的文件根本不会被读到；image seeding 函数也不存在）。

- [ ] **Step 3: commit**

```bash
git add src/lib/__tests__/seed.test.ts
git commit -m "test(seed): cover subdir scan + idempotency + image copy

5 tests for upcoming subdir-scan refactor: full empty-tree seed,
existing-file skip, deleted-file restore, .gitkeep filter, public/sample-images copy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3 · 重写 `seed.ts`（扫子目录 + seedSampleImages）

**Files:**
- Modify: `src/lib/seed.ts` (整个文件重写)

- [ ] **Step 1: 重写 seed.ts**

替换 `src/lib/seed.ts` 全文：

```typescript
// ---------- Seed 机制（子目录扫描版） ----------
// 首次访问时把 src/lib/seeds/<kind>/ 下的示例资源复制到 data/<kind>/，
// images/ 下的示例图复制到 public/sample-images/。
// 幂等：目标文件已存在则跳过；用户删除后下次访问自动恢复。

import fs from 'fs'
import path from 'path'
import { ensureDir } from './fs-utils'

function seedsRoot() { return path.join(process.cwd(), 'src', 'lib', 'seeds') }
function dataRoot() { return path.join(process.cwd(), 'data') }
function publicRoot() { return path.join(process.cwd(), 'public') }

// 每个 kind 允许的文件后缀（白名单 → 防 .gitkeep / .DS_Store / README.md 等被错拷）
const KINDS: Array<{ subdir: string; dst: string; exts: string[] }> = [
  { subdir: 'datasets', dst: 'datasets', exts: ['.jsonl', '.meta.json'] },
  { subdir: 'schemas', dst: 'schemas', exts: ['.json'] },
  { subdir: 'rubrics', dst: 'rubrics', exts: ['.json'] },
  { subdir: 'displays', dst: 'displays', exts: ['.json'] },
  { subdir: 'experiments', dst: 'experiments', exts: ['.json'] },
  { subdir: 'results', dst: 'results', exts: ['.jsonl'] },
  { subdir: 'annotations', dst: 'annotations', exts: ['.jsonl'] },
]

export function ensureSeeds() {
  try {
    for (const k of KINDS) {
      seedFromDir(path.join(seedsRoot(), k.subdir), path.join(dataRoot(), k.dst), k.exts)
    }
    seedSampleImages()
  } catch (e) {
    console.error('[ensureSeeds] failed:', e)
  }
}

/**
 * 扫 srcDir 下文件名后缀命中 allowedExts 的文件，把不在 dstDir 的复制过去。
 * srcDir 不存在时静默跳过（开发态可能尚未拉数据）。
 */
function seedFromDir(srcDir: string, dstDir: string, allowedExts: string[]) {
  if (!fs.existsSync(srcDir)) return
  ensureDir(dstDir)
  for (const name of fs.readdirSync(srcDir)) {
    if (!matchesExt(name, allowedExts)) continue
    const src = path.join(srcDir, name)
    const dst = path.join(dstDir, name)
    if (fs.existsSync(dst)) continue
    fs.copyFileSync(src, dst)
  }
}

function matchesExt(name: string, allowedExts: string[]): boolean {
  // 处理多段后缀如 ".meta.json"：endsWith 即可
  return allowedExts.some(ext => name.endsWith(ext))
}

/**
 * 递归把 src/lib/seeds/images/ 下的图复制到 public/sample-images/。
 * 仅图片后缀（.jpg/.jpeg/.png/.webp）；保留子目录结构（如 refcoco/）。
 */
function seedSampleImages() {
  const src = path.join(seedsRoot(), 'images')
  const dst = path.join(publicRoot(), 'sample-images')
  if (!fs.existsSync(src)) return
  copyImageTree(src, dst)
}

function copyImageTree(src: string, dst: string) {
  ensureDir(dst)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyImageTree(s, d)
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
      if (!fs.existsSync(d)) fs.copyFileSync(s, d)
    }
  }
}
```

- [ ] **Step 2: 跑测试，验证 PASS**

```bash
npx vitest run src/lib/__tests__/seed.test.ts
```

预期：5 tests PASS。

- [ ] **Step 3: 跑全量单测**

```bash
npm test
```

预期：全绿（不应该破坏其他测试）。

- [ ] **Step 4: commit**

```bash
git add src/lib/seed.ts
git commit -m "$(cat <<'EOF'
refactor(seed): scan per-kind subdirs instead of hard-coded id lists

ensureSeeds 现在扫 src/lib/seeds/{datasets,schemas,rubrics,displays,
experiments,results,annotations}/ 下符合后缀白名单的文件，复制到 data/
对应子目录。新增 seedSampleImages 把 src/lib/seeds/images/ 拷到
public/sample-images/。

幂等性与原版一致：existsSync 跳过；用户删除后自动恢复。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.4 · 验证老 sample 在 dev server 兼容

**Files:**
- 无文件修改；纯验证。

- [ ] **Step 1: 删本地 data/ 部分文件，模拟新用户首启**

```bash
rm -f data/datasets/qa_pairs.jsonl data/schemas/qa_answer_v1.json
```

- [ ] **Step 2: 启动 dev server，访问 datasets / schemas 列表页触发 seed**

```bash
npm run dev
```

浏览器打开 `http://localhost:3000/settings/datasets`，确认 `qa_pairs` 出现；打开 `http://localhost:3000/settings/templates`，确认 `qa_answer_v1` 出现。

- [ ] **Step 3: 检查文件被恢复**

```bash
ls -la data/datasets/qa_pairs.jsonl data/schemas/qa_answer_v1.json
```

预期：两个文件都已存在。

- [ ] **Step 4: 检查 public/sample-images/ 目录（PR 2 没图，应为空目录或不存在）**

```bash
ls public/sample-images/ 2>/dev/null || echo "(empty/absent — expected)"
```

- [ ] **Step 5: 跑五件套**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
```

预期：全绿。

### Task 2.5 · 起 branch + push + 开 PR

- [ ] **Step 1: 起 branch**

```bash
git checkout -b refactor/seed-scan-subdirs
git push -u origin refactor/seed-scan-subdirs
```

- [ ] **Step 2: 开 PR**

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "refactor(seed): scan per-kind subdirs" --body "$(cat <<'EOF'
## 改了什么

`src/lib/seed.ts` 从硬编 id 列表改成扫子目录机制。

- 把现有 8 个 seed 文件 git mv 到 `src/lib/seeds/{datasets,schemas,rubrics}/` 下；
  schema / rubric 文件名去掉 `.schema` / `.rubric` 中缀，统一 `<id>.json`
- `ensureSeeds()` 用新 `seedFromDir(srcSubdir, dstDir, allowedExts)` helper 扫
  7 个 kind 子目录（datasets/schemas/rubrics/displays/experiments/results/annotations）
- 新增 `seedSampleImages()` 拷 `src/lib/seeds/images/` 到 `public/sample-images/`
- 幂等性保留：existsSync 跳过；用户删除后下次访问自动恢复
- 5 个新单测覆盖：empty-tree seed / existing-file skip / deleted-file restore /
  .gitkeep filter / public/sample-images copy

## 为什么

为 sample data redesign（spec §6.1）做前置。PR 3 要 ship 大量新 sample
资源（datasets / schemas / rubrics / displays / experiments / results /
annotations / images），硬编 id 列表会膨胀失控；扫子目录后 PR 3 只动数据
不动 seed.ts。

## 怎么验证

- `npx vitest run src/lib/__tests__/seed.test.ts` — 5 tests 全绿
- 五件套全绿：`npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip`
- 实测：删 `data/datasets/qa_pairs.jsonl`，访问 `/settings/datasets` → 自动恢复

## 向后兼容风险

- 无：seed 文件物理位置变了但内容 / id / 数据 schema 完全不动。已生成
  的 `data/{datasets,schemas,rubrics}/*.json(l)` 不受影响（不会重 seed）
- `data/displays|experiments|results|annotations` 子目录此 PR 不会有任何
  文件被 seed（src/lib/seeds 对应子目录是空的，仅 .gitkeep）— 留待 PR 3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 3 · 全删旧 sample + 落新 sample 数据 + 预跑 experiments（PR 3，主体）

> 大 PR，5 个子阶段：3A 数据获取脚本 → 3B 资源 JSON 文件 → 3C 删旧 sample → 3D 预跑 4 套 experiment + judge 标注 → 3E 文档收尾。

> **架构**：作者本地一次性跑 `scripts/build-sample-data.ts`（zero-dep，仅 Node 18+ 内置 fetch）拉 GSM8K / BELLE / PartiPrompts / RefCOCO 数据 → 输出到 `src/lib/seeds/datasets/` + `src/lib/seeds/images/`；手动写 `src/lib/seeds/{schemas,rubrics,displays,experiments,judges}/` 的 JSON / Markdown 文件；跑 `scripts/run-sample-experiments.ts` 调美团 sankuai gateway 跑 4 个 experiment + LLM-as-judge → 输出到 `data/{results,annotations}/` + 拷一份到 `src/lib/seeds/`；commit 全部新文件 + 删旧文件 + 写 `docs/sample-data.md`。

### 3A · 数据获取脚本 `scripts/build-sample-data.ts`

> **Zero-dep 约束**：仅 Node 18+ 内置 fetch / fs / path / crypto / zlib，不引入新 npm 依赖。tsx 已在 devDependencies。

#### Task 3A.1 · 脚手架 + `npm run build:samples`

**Files:**
- Create: `scripts/build-sample-data.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: 写脚本入口骨架**

```typescript
#!/usr/bin/env -S npx tsx
// scripts/build-sample-data.ts
// 一次性拉取 sample 数据集到 src/lib/seeds/。zero-dep（仅 Node 18+ 内置 fetch）。

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')

async function main() {
  console.log('[build-samples] starting…')
  await ensureDir(path.join(SEEDS, 'datasets'))
  await ensureDir(path.join(SEEDS, 'images', 'refcoco'))

  await buildGSM8K()
  await buildBelleEval()
  await buildPartiPrompts()
  await buildRefCOCO()

  console.log('[build-samples] done.')
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

// stubs (具体实现见后续 task)
async function buildGSM8K() { console.log('  [gsm8k] TODO') }
async function buildBelleEval() { console.log('  [belle] TODO') }
async function buildPartiPrompts() { console.log('  [parti] TODO') }
async function buildRefCOCO() { console.log('  [refcoco] TODO') }

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 在 `package.json` 的 `scripts` 加 `build:samples`**

```diff
   "scripts": {
+    "build:samples": "tsx scripts/build-sample-data.ts",
     ...
   }
```

- [ ] **Step 3: 跑脚手架**

```bash
npm run build:samples
```

预期输出：
```
[build-samples] starting…
  [gsm8k] TODO
  [belle] TODO
  [parti] TODO
  [refcoco] TODO
[build-samples] done.
```

- [ ] **Step 4: commit**

```bash
git add scripts/build-sample-data.ts package.json
git commit -m "chore(scripts): add build:samples scaffold for sample data fetching

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3A.2 · GSM8K 拉取 + 抽 80 条

**Files:**
- Modify: `scripts/build-sample-data.ts` (`buildGSM8K`)

- [ ] **Step 1: 实现 `buildGSM8K`**

替换 `buildGSM8K` stub：

```typescript
async function buildGSM8K() {
  console.log('  [gsm8k] fetching test.jsonl…')
  const url = 'https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl'
  const text = await (await fetch(url)).text()
  const all = text.trim().split('\n').map(l => JSON.parse(l)) as Array<{ question: string; answer: string }>

  // GSM8K answer 字段格式："reasoning steps...\n#### final_number"
  const records = all.map((r, i) => {
    const ansMatch = r.answer.match(/#### (.+)$/)
    const finalAnswer = ansMatch?.[1]?.trim().replace(/[$,]/g, '') ?? ''
    const reasoning = r.answer.replace(/\n#### .+$/, '')
    const stepCount = reasoning.split(/\n/).filter(l => l.trim()).length
    const difficulty = stepCount <= 2 ? 'easy' : stepCount <= 4 ? 'medium' : 'hard'
    const category = inferGSM8KCategory(r.question)
    return {
      qid: `gsm8k_${String(i + 1).padStart(3, '0')}`,
      question: r.question,
      reference_answer: finalAnswer,
      reference_steps: reasoning,
      category,
      difficulty,
      step_count: stepCount,
    }
  })

  // 平衡抽样：easy 20 + medium 40 + hard 20，category 内尽量均匀
  const easy = pickBalanced(records.filter(r => r.difficulty === 'easy'), 20, 'category')
  const med  = pickBalanced(records.filter(r => r.difficulty === 'medium'), 40, 'category')
  const hard = pickBalanced(records.filter(r => r.difficulty === 'hard'), 20, 'category')
  const sampled = [...easy, ...med, ...hard]

  const meta = {
    id: 'gsm8k_mini',
    name: 'GSM8K mini',
    description: 'GSM8K 测试集采样 80 条小学数学应用题。来自 openai/grade-school-math (MIT)。',
    source: 'builtin',
    id_field: 'qid',
    fields: [
      { key: 'qid', type: 'string', label: 'QA ID' },
      { key: 'question', type: 'string', label: 'Question' },
      { key: 'reference_answer', type: 'string', label: 'Reference Answer' },
      { key: 'reference_steps', type: 'string', label: 'Reference Steps' },
      { key: 'category', type: 'string', label: 'Category' },
      { key: 'difficulty', type: 'string', label: 'Difficulty' },
      { key: 'step_count', type: 'number', label: 'Step Count' },
    ],
  }

  await fs.writeFile(path.join(SEEDS, 'datasets', 'gsm8k_mini.meta.json'), JSON.stringify(meta, null, 2))
  await fs.writeFile(
    path.join(SEEDS, 'datasets', 'gsm8k_mini.jsonl'),
    sampled.map(r => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`  [gsm8k] wrote ${sampled.length} records`)
}

function inferGSM8KCategory(q: string): string {
  const lc = q.toLowerCase()
  if (/\b(percent|%)\b/.test(lc)) return 'percentage'
  if (/\b(year|month|week|day|hour|minute)s?\b/.test(lc)) return 'time'
  if (/\b(age|old|year(s)? old|born)\b/.test(lc)) return 'age'
  if (/\b(cost|price|dollar|sell|buy|paid)\b/.test(lc) || /\$/.test(lc)) return 'shopping'
  if (/\b(area|perimeter|volume|cube|square|rectangle|triangle|circle)\b/.test(lc)) return 'geometry'
  if (/\b(ratio|times|twice|thrice|half|quarter)\b/.test(lc)) return 'ratio'
  if (/\b(mix|combine|total|sum)\b/.test(lc)) return 'mixture'
  return 'arithmetic'
}

function pickBalanced<T extends { [k: string]: unknown }>(pool: T[], n: number, balanceField: string): T[] {
  const buckets = new Map<string, T[]>()
  for (const r of pool) {
    const k = String(r[balanceField] ?? '')
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(r)
  }
  const out: T[] = []
  while (out.length < n) {
    let pickedAny = false
    for (const arr of buckets.values()) {
      if (out.length >= n) break
      const r = arr.shift()
      if (r) { out.push(r); pickedAny = true }
    }
    if (!pickedAny) break
  }
  return out
}
```

- [ ] **Step 2: 跑脚本 + 验证产出**

```bash
npm run build:samples
wc -l src/lib/seeds/datasets/gsm8k_mini.jsonl
node -e "const r=require('fs').readFileSync('src/lib/seeds/datasets/gsm8k_mini.jsonl','utf8').trim().split('\n').map(JSON.parse); console.log('difficulty:', Object.entries(r.reduce((a,x)=>{a[x.difficulty]=(a[x.difficulty]||0)+1;return a},{}))); console.log('category:', Object.entries(r.reduce((a,x)=>{a[x.category]=(a[x.category]||0)+1;return a},{})))"
```

预期：80 行；difficulty 分布 ~20/40/20；category 8 类皆出现。

- [ ] **Step 3: commit**

```bash
git add scripts/build-sample-data.ts src/lib/seeds/datasets/gsm8k_mini.*
git commit -m "feat(seeds): pull GSM8K-mini (80 records) from openai/grade-school-math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3A.3 · BELLE-eval 拉取 + 抽 60 条

**Files:**
- Modify: `scripts/build-sample-data.ts` (`buildBelleEval`)

> **字段验证 fallback**（spec §10 R2）：BELLE-eval 字段名以仓库实际为准。如字段叫 `class` 而非 `category`，按 implementation 时实测调整 mapping。

- [ ] **Step 1: 实现 `buildBelleEval`**

```typescript
async function buildBelleEval() {
  console.log('  [belle] fetching eval_set.json…')
  const candidates = [
    'https://raw.githubusercontent.com/LianjiaTech/BELLE/main/eval/eval_set.json',
    'https://raw.githubusercontent.com/LianjiaTech/BELLE/main/eval/eval_data/eval_set.json',
  ]
  let raw = ''
  for (const url of candidates) {
    const r = await fetch(url)
    if (r.ok) { raw = await r.text(); break }
  }
  if (!raw) throw new Error('[belle] cannot fetch eval_set.json from any candidate URL')

  const all = JSON.parse(raw) as Array<Record<string, unknown>>
  const records = all.map((r, i) => ({
    qid: `belle_${String(i + 1).padStart(3, '0')}`,
    question: String(r.question ?? r.prompt ?? ''),
    category: String(r.class ?? r.category ?? 'qa'),
    subcategory: String(r.subclass ?? r.subcategory ?? ''),
    reference_criteria: String(r.criteria ?? r.grading_prompt ?? ''),
    reference_answer: r.standard_answer != null ? String(r.standard_answer) : null,
    difficulty: String(r.difficulty ?? 'medium'),
  })).filter(r => r.question.length > 0)

  // 抽 60 条覆盖 10 类
  const byClass = new Map<string, typeof records>()
  for (const r of records) {
    if (!byClass.has(r.category)) byClass.set(r.category, [])
    byClass.get(r.category)!.push(r)
  }
  const perClass = Math.floor(60 / Math.min(byClass.size, 10))
  const sampled: typeof records = []
  for (const arr of byClass.values()) {
    sampled.push(...arr.slice(0, perClass))
    if (sampled.length >= 60) break
  }
  const finalRecords = sampled.slice(0, 60).map((r, i) => ({ ...r, qid: `belle_${String(i + 1).padStart(3, '0')}` }))

  const meta = {
    id: 'belle_eval_mini',
    name: 'BELLE-eval mini',
    description: '中文 alignment 评测 BELLE-eval 采样 60 条覆盖 10 类。来自 LianjiaTech/BELLE (Apache-2.0)。',
    source: 'builtin',
    id_field: 'qid',
    fields: [
      { key: 'qid', type: 'string', label: 'QA ID' },
      { key: 'question', type: 'string', label: '问题' },
      { key: 'category', type: 'string', label: '类目' },
      { key: 'subcategory', type: 'string', label: '子类' },
      { key: 'reference_criteria', type: 'string', label: '评分要点' },
      { key: 'reference_answer', type: 'string', label: '参考答案' },
      { key: 'difficulty', type: 'string', label: '难度' },
    ],
  }
  await fs.writeFile(path.join(SEEDS, 'datasets', 'belle_eval_mini.meta.json'), JSON.stringify(meta, null, 2))
  await fs.writeFile(
    path.join(SEEDS, 'datasets', 'belle_eval_mini.jsonl'),
    finalRecords.map(r => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`  [belle] wrote ${finalRecords.length} records, classes:`, [...new Set(finalRecords.map(r => r.category))])
}
```

- [ ] **Step 2: 跑脚本**

```bash
npm run build:samples
wc -l src/lib/seeds/datasets/belle_eval_mini.jsonl
```

预期：60 行；classes 至少 5-10 个。如 fetch 失败或字段对不上，按 implementation 时实测调整 mapping，必要时手工从 GitHub 下载 eval_set.json 用本地路径。

- [ ] **Step 3: commit**

```bash
git add scripts/build-sample-data.ts src/lib/seeds/datasets/belle_eval_mini.*
git commit -m "feat(seeds): pull BELLE-eval-mini (60 records) covering 10 classes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3A.4 · PartiPrompts 拉取 + 抽 60 + 8 中文 = 68 条

**Files:**
- Modify: `scripts/build-sample-data.ts` (`buildPartiPrompts`)

- [ ] **Step 1: 实现 `buildPartiPrompts`**

```typescript
async function buildPartiPrompts() {
  console.log('  [parti] fetching PartiPrompts.tsv…')
  const url = 'https://raw.githubusercontent.com/google-research/parti-prompts/main/PartiPrompts.tsv'
  const text = await (await fetch(url)).text()
  const lines = text.trim().split('\n')
  const header = lines[0]!.split('\t')
  const idxPrompt = header.indexOf('Prompt')
  const idxCat = header.indexOf('Category')
  const idxChal = header.indexOf('Challenge')

  const ALLOWED_CATS = new Set(['People', 'Animals', 'World Knowledge', 'Outdoor Scenes', 'Artifacts', 'Abstract'])
  type Row = { prompt: string; category: string; challenge: string }
  const all: Row[] = lines.slice(1).map(l => {
    const cols = l.split('\t')
    return { prompt: cols[idxPrompt] ?? '', category: cols[idxCat] ?? '', challenge: cols[idxChal] ?? '' }
  }).filter(r => ALLOWED_CATS.has(r.category) && r.prompt.length > 0)

  const normalizedChallenge = (c: string) => c.includes('Basic') ? 'Basic' : 'Complex'

  // 6 类 × 2 challenge × 5 条 = 60
  const sampled: Array<Row & { is_chinese: boolean }> = []
  for (const cat of ALLOWED_CATS) {
    for (const chal of ['Basic', 'Complex']) {
      const matched = all.filter(r => r.category === cat && normalizedChallenge(r.challenge) === chal).slice(0, 5)
      sampled.push(...matched.map(r => ({ ...r, challenge: chal, is_chinese: false })))
    }
  }

  // 注入 8 条中文 prompt
  const CN_PROMPTS = [
    { prompt: '一位戴圆框眼镜的少年学者，在烛光下专心读书', category: 'People', challenge: 'Basic' },
    { prompt: '一只橘色花猫蹲在书堆上打盹，午后阳光斜照', category: 'Animals', challenge: 'Basic' },
    { prompt: '敦煌壁画风格的飞天，淡彩，矿物颜料质感', category: 'Artifacts', challenge: 'Complex' },
    { prompt: '南宋山水画风格：远山、溪流、独钓的渔翁，构图带 negative space', category: 'Outdoor Scenes', challenge: 'Complex' },
    { prompt: '黑色釉面陶碗里盛着一杯热抹茶，俯视构图，竹制茶筅放在一旁', category: 'Artifacts', challenge: 'Basic' },
    { prompt: '清晨竹林被薄雾笼罩，晨光从密叶间穿透下来', category: 'Outdoor Scenes', challenge: 'Basic' },
    { prompt: '宇宙诞生之初的混沌：金色与靛蓝色的流体形态相互纠缠', category: 'Abstract', challenge: 'Complex' },
    { prompt: '一只机械蜂鸟悬停于发光的玻璃花朵前，蒸汽朋克风格', category: 'World Knowledge', challenge: 'Complex' },
  ]
  sampled.push(...CN_PROMPTS.map(r => ({ ...r, is_chinese: true })))

  const records = sampled.map((r, i) => ({
    pid: `parti_${String(i + 1).padStart(3, '0')}`,
    prompt: r.prompt,
    category: r.category,
    challenge: r.challenge,
    is_chinese: r.is_chinese,
  }))

  const meta = {
    id: 'partiprompts_mini',
    name: 'PartiPrompts mini',
    description: 'Google PartiPrompts 采样 60 条覆盖 6 大类 × Basic/Complex 二档，含 8 条中文 prompt。来自 google-research/parti-prompts (BSD-3)。',
    source: 'builtin',
    id_field: 'pid',
    fields: [
      { key: 'pid', type: 'string', label: 'Prompt ID' },
      { key: 'prompt', type: 'string', label: 'Prompt' },
      { key: 'category', type: 'string', label: 'Category' },
      { key: 'challenge', type: 'string', label: 'Challenge' },
      { key: 'is_chinese', type: 'boolean', label: 'Is Chinese' },
    ],
  }
  await fs.writeFile(path.join(SEEDS, 'datasets', 'partiprompts_mini.meta.json'), JSON.stringify(meta, null, 2))
  await fs.writeFile(
    path.join(SEEDS, 'datasets', 'partiprompts_mini.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`  [parti] wrote ${records.length} records`)
}
```

- [ ] **Step 2: 跑脚本 + 验证 + commit**

```bash
npm run build:samples
wc -l src/lib/seeds/datasets/partiprompts_mini.jsonl  # 68
git add scripts/build-sample-data.ts src/lib/seeds/datasets/partiprompts_mini.*
git commit -m "feat(seeds): pull PartiPrompts-mini (68 records, 6 cats × 2 challenges + 8 zh)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3A.5 · RefCOCO 标注 + 30 张图

**Files:**
- Create: `scripts/refcoco-30.json` (手工 hand-pick 30 条标注)
- Modify: `scripts/build-sample-data.ts` (`buildRefCOCO`)
- Create: 30 张 jpg 进 `src/lib/seeds/images/refcoco/`

> **数据格式 fallback**（spec §10 R3）：RefCOCO 原始 .p（pickle）格式 Node 不易解析。**作者手工 export 30 条到 plain JSON**，commit 进 `scripts/refcoco-30.json`，由脚本读取。

- [ ] **Step 1: 手工准备 `scripts/refcoco-30.json`**

格式：

```json
[
  {
    "coco_image_id": 123456,
    "image_w": 640,
    "image_h": 480,
    "referring_expression": "the cat on the right",
    "bbox": [380, 240, 64, 94],
    "is_chinese": false
  }
]
```

来源：从 RefCOCO unc split 的 val 集合 hand-pick 25 条英文 + 5 条中文（spec §5.4）。中文 expression 由作者翻译，保持原 bbox。

- [ ] **Step 2: 实现 `buildRefCOCO`**

```typescript
async function buildRefCOCO() {
  console.log('  [refcoco] reading hand-picked annotations…')
  const handPicked = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'scripts', 'refcoco-30.json'), 'utf-8'),
  ) as Array<{
    coco_image_id: number
    image_w: number
    image_h: number
    referring_expression: string
    bbox: [number, number, number, number]
    is_chinese?: boolean
  }>

  const records: Array<Record<string, unknown>> = []
  for (let i = 0; i < handPicked.length; i++) {
    const r = handPicked[i]!
    const fileId = String(r.coco_image_id).padStart(12, '0')
    const cocoUrl = `http://images.cocodataset.org/val2014/COCO_val2014_${fileId}.jpg`
    const localName = `${fileId}.jpg`
    const localPath = path.join(SEEDS, 'images', 'refcoco', localName)

    if (!fsSync.existsSync(localPath)) {
      console.log(`  [refcoco] downloading ${cocoUrl}…`)
      const buf = Buffer.from(await (await fetch(cocoUrl)).arrayBuffer())
      await fs.writeFile(localPath, buf)
    }

    const bbox = r.bbox
    records.push({
      vid: `refcoco_${String(i + 1).padStart(3, '0')}`,
      image_url: `/sample-images/refcoco/${localName}`,
      referring_expression: r.referring_expression,
      gt_point: [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2],
      gt_bbox: bbox,
      image_w: r.image_w,
      image_h: r.image_h,
      is_chinese: r.is_chinese ?? false,
    })
  }

  const meta = {
    id: 'refcoco_mini',
    name: 'RefCOCO mini (visual referring)',
    description: 'RefCOCO unc-split 采样 30 条（5 中文）。图来自 COCO val2014 (CC-BY 4.0)，标注 CC-BY 4.0。',
    source: 'builtin',
    id_field: 'vid',
    fields: [
      { key: 'vid', type: 'string', label: 'VQA ID' },
      { key: 'image_url', type: 'url', label: 'Image' },
      { key: 'referring_expression', type: 'string', label: '指代表达式' },
      { key: 'gt_point', type: 'array', label: 'GT center [x,y]' },
      { key: 'gt_bbox', type: 'array', label: 'GT bbox [x,y,w,h]' },
      { key: 'image_w', type: 'number', label: '图宽' },
      { key: 'image_h', type: 'number', label: '图高' },
      { key: 'is_chinese', type: 'boolean', label: 'Is Chinese' },
    ],
  }
  await fs.writeFile(path.join(SEEDS, 'datasets', 'refcoco_mini.meta.json'), JSON.stringify(meta, null, 2))
  await fs.writeFile(
    path.join(SEEDS, 'datasets', 'refcoco_mini.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`  [refcoco] wrote 30 records + ${handPicked.length} images`)
}
```

- [ ] **Step 3: 跑脚本（首次会下载 30 张图，~30s-1min）**

```bash
npm run build:samples
ls src/lib/seeds/images/refcoco/ | wc -l
du -sh src/lib/seeds/images/refcoco/
```

预期：30 张 jpg。

- [ ] **Step 4: ImageMagick 缩放 max 720px（避免 commit 超大图）**

```bash
brew install imagemagick  # 如未装
cd src/lib/seeds/images/refcoco/
mogrify -resize '720x720>' *.jpg
du -sh .
```

预期：~3-5MB。

- [ ] **Step 5: commit**

```bash
git add scripts/build-sample-data.ts scripts/refcoco-30.json src/lib/seeds/datasets/refcoco_mini.* src/lib/seeds/images/refcoco/
git commit -m "$(cat <<'EOF'
feat(seeds): pull RefCOCO-mini (30 records + 30 720px images) for VQA pointing

Hand-picked RefCOCO unc-split annotations (25 en + 5 zh translated) +
COCO val2014 images downsampled to 720px max edge. Saves ground truth
bbox + center point for programmatic IoU scoring.

License: RefCOCO CC-BY 4.0, COCO images CC-BY 4.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 3B · Schema / Rubric / Display / Experiment / Judge / LICENSES 资源文件

> **写作策略**：每个文件按 spec §3-§5 的字段定义生成；每个 task 写一个 batch（一个 suite 的 schema + display + rubric + judge + experiment-meta），完成后 commit。Suite A 第一个 task 给完整范例，其余引用 spec section + 关键差异点。

#### Task 3B.1 · Suite A 全套（GSM8K：3 schemas + 2 displays + rubric + judge + experiment-meta）

**Files (创建)：**
- `src/lib/seeds/schemas/gsm8k_cot_v1.json`
- `src/lib/seeds/schemas/gsm8k_direct_v1.json`
- `src/lib/seeds/schemas/gsm8k_fewshot_v1.json`
- `src/lib/seeds/displays/gsm8k_compact_table.json`
- `src/lib/seeds/displays/gsm8k_step_card.json`
- `src/lib/seeds/rubrics/gsm8k_grading.json`
- `src/lib/seeds/judges/gsm8k_grading.judge.md`
- `src/lib/seeds/experiments/gsm8k_compare_v1.json`

- [ ] **Step 1: 写 `schemas/gsm8k_cot_v1.json`**（按 spec §3 "Schema A1"）

```json
{
  "id": "gsm8k_cot_v1",
  "label": "GSM8K · Chain-of-Thought",
  "description": "标准 CoT 提示。1 个 display_dim → 自动推断 single_list。",
  "version": 1,
  "compare_group": "gsm8k_v1",
  "inputs": [
    {
      "alias": "q",
      "dataset_id": "gsm8k_mini",
      "filters": [
        {
          "kind": "multiselect",
          "key": "difficulties",
          "field": "difficulty",
          "label": "难度",
          "options": [
            { "value": "easy", "label": "Easy" },
            { "value": "medium", "label": "Medium" },
            { "value": "hard", "label": "Hard" }
          ],
          "defaultValue": ["easy", "medium", "hard"]
        },
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "类目",
          "options": [
            { "value": "arithmetic", "label": "Arithmetic" },
            { "value": "ratio", "label": "Ratio" },
            { "value": "percentage", "label": "Percentage" },
            { "value": "time", "label": "Time" },
            { "value": "age", "label": "Age" },
            { "value": "shopping", "label": "Shopping" },
            { "value": "geometry", "label": "Geometry" },
            { "value": "mixture", "label": "Mixture" }
          ],
          "defaultValue": ["arithmetic", "ratio", "percentage", "time", "age", "shopping", "geometry", "mixture"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [{ "name": "question", "source": "q.question" }],
  "default_prompt": "You are a careful math problem solver. Solve the problem step by step, then state the final numeric answer.\n\nOutput JSON only:\n{\n  \"steps\": \"step-by-step reasoning, plain text\",\n  \"final_answer\": \"the final number, no units\",\n  \"confidence\": 1-5\n}\n\nProblem: {{question}}",
  "message_builder": { "user_template": "Reply with JSON only — no prose, no code fences." },
  "output_schema": {
    "type": "object",
    "required": ["final_answer", "confidence"],
    "properties": {
      "steps": { "type": "string", "max_length": 4000 },
      "final_answer": { "type": "string", "max_length": 200 },
      "confidence": { "type": "number", "enum": [1, 2, 3, 4, 5] }
    }
  },
  "display_dimensions": [{ "field": "input_preview.q.difficulty", "label": "难度" }]
}
```

- [ ] **Step 2: 写 `schemas/gsm8k_direct_v1.json`**（复制 cot_v1 改 4 处）

| 改动 | 内容 |
|---|---|
| `id` | `"gsm8k_direct_v1"` |
| `label` | `"GSM8K · Direct (no CoT)"` |
| `description` | `"直答 prompt（无 CoT）。display_id 指向 user table。"` |
| `default_prompt` | `"Solve the math problem and output ONLY the final number.\n\nOutput JSON only:\n{\n  \"final_answer\": \"...\",\n  \"confidence\": 1-5\n}\n\nProblem: {{question}}"` |
| 顶层加 | `"display_id": "gsm8k_compact_table"` |
| `output_schema.required` | 去掉 `"steps"`（properties 仍含可选） |

- [ ] **Step 3: 写 `schemas/gsm8k_fewshot_v1.json`**（复制 cot_v1 改 5 处）

| 改动 | 内容 |
|---|---|
| `id` | `"gsm8k_fewshot_v1"` |
| `label` | `"GSM8K · Few-shot CoT"` |
| `description` | `"Few-shot CoT prompt（含 2 个示例）。display_id 指向 user jsx 玻璃卡。"` |
| `default_prompt` | spec §3 Schema A3 完整 few-shot 文本 |
| 顶层加 | `"display_id": "gsm8k_step_card"` |
| `display_dimensions` | 改成 2 dim：`[{"field":"input_preview.q.difficulty"},{"field":"input_preview.q.category"}]` |

- [ ] **Step 4: 写 `displays/gsm8k_compact_table.json`**（按 spec §3 "User Display gsm8k_compact_table"）

```json
{
  "id": "gsm8k_compact_table",
  "name": "GSM8K 紧凑表格",
  "description": "题号 / 题目 / 模型答案 / 参考答案 / 是否相等 / 用时。注：✓✗ 列依赖 PR 4 实现，PR 3 ship 时该列渲染为空字符串可接受。",
  "source": "builtin",
  "mode": "table",
  "table": {
    "columns": [
      { "field": "input_preview.q.qid", "label": "ID", "width": "80px" },
      { "field": "input_preview.q.question", "label": "题目", "type": "text", "max_length": 80 },
      { "field": "output.final_answer", "label": "模型答案", "type": "text", "width": "100px" },
      { "field": "input_preview.q.reference_answer", "label": "参考", "type": "text", "width": "80px" },
      { "field": "_computed.answer_match", "label": "✓✗", "type": "badge", "width": "60px" },
      { "field": "latency_ms", "label": "用时(ms)", "type": "text", "width": "100px" }
    ]
  }
}
```

- [ ] **Step 5: 写 `displays/gsm8k_step_card.json`**（jsx，按 spec §3 jsx source）

JSON 字段 `jsx.source` 值是 spec §3 那段 `function GSM8KStepCard({ result, schema, helpers }) { ... }` 的 String 化（引号 escape）。注意保留 `helpers.glassStyle('regular')` 三件套（CLAUDE.md 反直觉约束 #3）。

- [ ] **Step 6: 写 `rubrics/gsm8k_grading.json`**

```json
{
  "id": "gsm8k_grading",
  "name": "GSM8K Grading",
  "description": "数学推理评测：final_answer_correct 程序化标注，其余 4 维 LLM-as-judge。",
  "source": "builtin",
  "criteria": [
    { "key": "final_answer_correct", "label": "答案正确", "type": "pass_fail", "required": true,
      "description": "程序化校验：strip 空白后 final_answer 与 reference_answer 字符串相等或数值相等。" },
    { "key": "reasoning_validity", "label": "推理合理度", "type": "likert_1_5",
      "description": "推理过程是否成立、无跳跃、无幻觉。" },
    { "key": "step_efficiency", "label": "步骤效率", "type": "likert_1_5",
      "description": "步骤是否冗余 / 跳过关键步。" },
    { "key": "confidence_calibration", "label": "置信度校准", "type": "likert_1_5",
      "description": "自评 confidence 是否匹配实际对错。" },
    { "key": "overall_quality", "label": "综合分", "type": "score_0_100" }
  ]
}
```

- [ ] **Step 7: 写 `judges/gsm8k_grading.judge.md`**（spec §3 全文）

- [ ] **Step 8: 写 `experiments/gsm8k_compare_v1.json`**（meta only，无 results；api_config 留空，runtime 取 llm-config）

```json
{
  "id": "gsm8k_compare_v1",
  "name": "GSM8K · CoT vs Direct vs Few-shot · Opus 4.6 × Kimi K2.6",
  "created_at": "2026-05-12T00:00:00Z",
  "updated_at": "2026-05-12T00:00:00Z",
  "schema_id": "gsm8k_cot_v1",
  "filter_values": { "difficulties": ["easy", "medium", "hard"], "limit": 30 },
  "model": "claude-opus-4-6",
  "temperature": 0.2,
  "max_tokens": 2048,
  "rubric_id": "gsm8k_grading",
  "api_config": { "base_url": "", "api_key": "" },
  "prompt_template": "(uses default_prompt)",
  "status": "completed",
  "notes": "Sample experiment shipped with seed; results at data/results/gsm8k_compare_v1.jsonl"
}
```

- [ ] **Step 9: 删 data/ 副本 + dev 验证**

```bash
rm -f data/schemas/gsm8k_*.json data/displays/gsm8k_*.json data/rubrics/gsm8k_grading.json
npm run dev
```

打开 `/settings/templates`，确认 3 个 GSM8K schema 都列出且点开不报错；displays / rubrics 同理。

- [ ] **Step 10: commit**

```bash
git add src/lib/seeds/schemas/gsm8k_*.json src/lib/seeds/displays/gsm8k_*.json src/lib/seeds/rubrics/gsm8k_grading.json src/lib/seeds/judges/gsm8k_grading.judge.md src/lib/seeds/experiments/gsm8k_compare_v1.json
git commit -m "feat(seeds): suite A · GSM8K (3 schemas + 2 displays + rubric + judge)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3B.2 · Suite B 全套（BELLE：2 schemas + 1 display + rubric + judge + experiment-meta）

**Files (创建)：** 6 个文件，按 spec §4。

- [ ] **Step 1: 写 6 个文件**
  - `schemas/belle_plain_v1.json`（朴素 zero-shot，2 dim → dual_list，`raw_text_output: true`，output_schema `{answer: string}`）
  - `schemas/belle_persona_v1.json`（含 4 条 `user_templates_by_cond` + 4 个 `eq + notEmpty` transform variables，`display_id: "belle_persona_grid"`）
  - `displays/belle_persona_grid.json`（mode=grouped_grid，按 spec §4 全文）
  - `rubrics/belle_quality.json`（5 维：correctness pass_fail / instruction_following / helpfulness / language_quality / overall_score 0-100）
  - `judges/belle_quality.judge.md`
  - `experiments/belle_compare_v1.json`（meta only，model gemini-3.1-pro / kimi-k2.6）

> **关键点**：`belle_persona_v1.json` 的 `variables` 必须写完整 5 个：`question` + 4 个 boolean transform。语法：`{ name, source: "q.category", transform: [{ op: "eq", value: "open_generation" }, { op: "notEmpty" }] }`。验证 `eq + notEmpty` chain 与 `user_templates_by_cond.when` 字段语义匹配（spec §10 R4），如不匹配降级到 hard-coded 4 schema 变体。

- [ ] **Step 2: dev 验证 + commit**

```bash
rm -f data/schemas/belle_*.json data/displays/belle_*.json data/rubrics/belle_quality.json
npm run dev  # 浏览器实测
git add src/lib/seeds/schemas/belle_*.json src/lib/seeds/displays/belle_persona_grid.json src/lib/seeds/rubrics/belle_quality.json src/lib/seeds/judges/belle_quality.judge.md src/lib/seeds/experiments/belle_compare_v1.json
git commit -m "feat(seeds): suite B · BELLE-eval (2 schemas + grouped_grid display + rubric)

含 user_templates_by_cond 条件模板演示按 category 切换 persona prompt。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3B.3 · Suite C1 全套（PartiPrompts T2I：1 schema + rubric + judge + experiment-meta）

**Files (创建)：**
- `schemas/parti_t2i_v1.json`（按 spec §5.2，3 dim → triple_grid，output `image_url` + 可选 `caption`）
- `rubrics/t2i_quality.json`（按 spec §5.3，6 维含 `composition_correctness`）
- `judges/t2i_quality.judge.md`（vision judge，prompt 接受 image_url）
- `experiments/parti_t2i_compare_v1.json`（meta，model `gpt-image-2` + `gemini-3.1-flash-image-preview`）

- [ ] **Step 1: 写 4 个文件 + dev 验证 + commit**

```bash
git add src/lib/seeds/schemas/parti_t2i_v1.json src/lib/seeds/rubrics/t2i_quality.json src/lib/seeds/judges/t2i_quality.judge.md src/lib/seeds/experiments/parti_t2i_compare_v1.json
git commit -m "feat(seeds): suite C1 · PartiPrompts T2I (schema + HEIM-style rubric)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3B.4 · Suite C2 全套（RefCOCO Pointing：1 schema + rubric + judge + experiment-meta）

**Files (创建)：**
- `schemas/vqa_pointing_v1.json`（按 spec §5.5，含 `message_builder.image: { field: "v.image_url", required: true }`，output 含 `tuple:number[]` → bubble_overlay）
- `rubrics/pointing_accuracy.json`（按 spec §5.6，4 维：point_inside_bbox / distance_from_center / referent_correct / overall_score）
- `judges/pointing_accuracy.judge.md`
- `experiments/vqa_pointing_baseline_v1.json`（meta，model `claude-opus-4-6` + `gemini-3.1-pro`）

- [ ] **Step 1: 写 4 个文件 + dev 验证 + commit**

```bash
git add src/lib/seeds/schemas/vqa_pointing_v1.json src/lib/seeds/rubrics/pointing_accuracy.json src/lib/seeds/judges/pointing_accuracy.judge.md src/lib/seeds/experiments/vqa_pointing_baseline_v1.json
git commit -m "feat(seeds): suite C2 · RefCOCO pointing (schema + accuracy rubric)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3B.5 · LICENSES 文件夹

**Files (创建)：**
- `src/lib/seeds/LICENSES/README.md`
- `src/lib/seeds/LICENSES/gsm8k-MIT.txt`
- `src/lib/seeds/LICENSES/belle-Apache-2.0.txt`
- `src/lib/seeds/LICENSES/partiprompts-BSD-3.txt`
- `src/lib/seeds/LICENSES/refcoco-CC-BY-4.0.txt`
- `src/lib/seeds/LICENSES/coco-CC-BY-4.0.txt`

- [ ] **Step 1: 写 README.md**（按 spec §6.4）+ 5 个 license 全文（直接从原仓 LICENSE 拷贝）

- [ ] **Step 2: commit**

```bash
git add src/lib/seeds/LICENSES/
git commit -m "docs(seeds): add LICENSES + attributions for sample data sources

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 3C · 删除旧 sample（来自 Phase 2 的兼容残留）

#### Task 3C.1 · 删除老 seed 文件 + data/ 残留

- [ ] **Step 1: 删 seed 端**

```bash
rm src/lib/seeds/datasets/qa_pairs.jsonl src/lib/seeds/datasets/qa_pairs.meta.json \
   src/lib/seeds/datasets/image_prompts_v1.jsonl src/lib/seeds/datasets/image_prompts_v1.meta.json \
   src/lib/seeds/schemas/qa_answer_v1.json src/lib/seeds/schemas/image_gen_v1.json \
   src/lib/seeds/rubrics/qa_accuracy.json src/lib/seeds/rubrics/image_quality_v1.json
```

- [ ] **Step 2: 删 data 端**

```bash
rm -f data/datasets/qa_pairs.jsonl data/datasets/qa_pairs.meta.json \
      data/datasets/image_prompts_v1.jsonl data/datasets/image_prompts_v1.meta.json \
      data/schemas/qa_answer_v1.json data/schemas/image_gen_v1.json \
      data/rubrics/qa_accuracy.json data/rubrics/image_quality_v1.json
```

- [ ] **Step 3: dev server 实测 + 五件套**

```bash
npm run dev
# 浏览器打开 /settings/datasets，确认只有 4 个新 dataset
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
```

如老 e2e / unit test 引用 `qa_pairs` 或 `image_prompts_v1`，按需更新到新 sample id。

- [ ] **Step 4: commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(seeds): remove legacy qa_pairs / image_prompts_v1 sample data

老 sample 已被 4 套新 benchmark suite 取代。同时清理 data/ 运行时副本，
保证开箱新用户只看到新 sample。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 3D · 预跑 4 套 sample experiment + LLM-as-judge 标注

> 作者本机一次性跑。脚本调美团 sankuai gateway，结果固化进 git。预算 ~¥50-130（spec §10 R5）。

#### Task 3D.1 · 写 `scripts/run-sample-experiments.ts` 脚手架

**Files:**
- Create: `scripts/run-sample-experiments.ts`
- Modify: `package.json` (`scripts.run:samples`)

- [ ] **Step 1: 写脚本骨架**

```typescript
#!/usr/bin/env -S npx tsx
// scripts/run-sample-experiments.ts
// 一次性跑完 4 套 sample experiment + LLM-as-judge 标注，输出到 data/{results,annotations}/。
// 跑完拷贝到 src/lib/seeds/{results,annotations}/ ship 进 git。

import fs from 'fs/promises'
import path from 'path'
import { callLlm } from '../src/lib/llm-client'
import { getLlmConfig, type LlmConfig } from '../src/lib/llm-config'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATA = path.join(process.cwd(), 'data')

async function main() {
  const cfg = getLlmConfig()
  if (cfg.models.length === 0) {
    console.error('[run-samples] data/llm-config.json 没有 model，先去 /settings/llm 配置')
    process.exit(1)
  }

  await runGSM8K(cfg)
  await runBelle(cfg)
  await runPartiT2I(cfg)
  await runVQAPointing(cfg)
  await runJudges(cfg)
  await copyToSeeds()
  console.log('[run-samples] all done.')
}

async function runGSM8K(cfg: LlmConfig) { console.log('  [gsm8k] TODO') }
async function runBelle(cfg: LlmConfig) { console.log('  [belle] TODO') }
async function runPartiT2I(cfg: LlmConfig) { console.log('  [parti] TODO') }
async function runVQAPointing(cfg: LlmConfig) { console.log('  [vqa] TODO') }
async function runJudges(cfg: LlmConfig) { console.log('  [judges] TODO') }

async function copyToSeeds() {
  for (const kind of ['results', 'annotations']) {
    const src = path.join(DATA, kind)
    const dst = path.join(SEEDS, kind)
    if (!(await exists(src))) continue
    await fs.mkdir(dst, { recursive: true })
    for (const f of await fs.readdir(src)) {
      if (!f.endsWith('.jsonl')) continue
      await fs.copyFile(path.join(src, f), path.join(dst, f))
    }
  }
}

async function exists(p: string) { try { await fs.access(p); return true } catch { return false } }

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 加 npm script**

```diff
   "scripts": {
     ...
+    "run:samples": "tsx scripts/run-sample-experiments.ts",
   }
```

- [ ] **Step 3: commit**

```bash
git add scripts/run-sample-experiments.ts package.json
git commit -m "chore(scripts): add run:samples scaffold for prerunning sample experiments

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3D.2 · 实现 4 个 runner（共享 batchRun helper）

**Files:**
- Modify: `scripts/run-sample-experiments.ts`

- [ ] **Step 1: 实现 batchRun helper + 4 个 runner**

batchRun 签名：

```typescript
async function batchRun(opts: {
  experimentId: string
  schemaId: string
  modelIds: string[]
  records: Array<Record<string, unknown>>
  buildMessages: (rec: Record<string, unknown>, schemaPrompt: string) => any[]
  schemaPrompt: string
  inputAlias: string
  cfg: LlmConfig
}): Promise<void>
```

每条 record × 每个 model 调一次 callLlm；产出 GenericResultRecord（按 src/lib/schema/types.ts），写到 `data/results/${experimentId}.jsonl`。错误吞了打 console。

`runGSM8K`：30 条均衡 subset × 3 schema × 2 model（claude-opus-4-6 / kimi-k2.6）→ merge 三个 results 文件到 `gsm8k_compare_v1.jsonl` 共 180 行。

`runBelle`：60 条 × 2 schema × 2 model（gemini-3.1-pro / kimi-k2.6）= 240 行。

`runPartiT2I`：68 条 × 1 schema × 2 model（gpt-image-2 用 endpoint_kind=images_generations / gemini-3.1-flash-image-preview chat）= 136 行。**生成图通过 evalyst image-store 落盘到 `data/images/`**，result.output.image_url 是本地 path。

`runVQAPointing`：30 条 × 1 schema × 2 model（claude-opus-4-6 / gemini-3.1-pro）= 60 行。`buildMessages` 构造**含 image_url 的多模态 user content**：

```typescript
buildMessages: (rec, prompt) => [
  {
    role: 'user',
    content: [
      { type: 'text', text: prompt.replace('{{expr}}', String(rec.referring_expression ?? '')) },
      { type: 'image_url', image_url: { url: `http://localhost:3000${rec.image_url}` } },
    ],
  },
]
```

> 跑该 runner 前必须 `npm run dev` 让 `public/sample-images/` 可访问，或把图直接 base64 inline。

具体实现按本 task **Step 1** 的 batchRun helper 模板展开——本 task 在脚本里完整 fill in 4 个 runner 函数。

- [ ] **Step 2: commit**

```bash
git add scripts/run-sample-experiments.ts
git commit -m "feat(scripts): implement 4 experiment runners (gsm8k/belle/parti/vqa)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3D.3 · 实现 `runJudges`（LLM-as-judge 标注）

**Files:**
- Modify: `scripts/run-sample-experiments.ts`

- [ ] **Step 1: 实现 `runJudges`**

```typescript
async function runJudges(cfg: LlmConfig) {
  const judgeText = 'gpt-4o-mini'
  const judgeVision = 'gpt-4o'

  const tasks: Array<{ exp: string; rubric: string; judge: string }> = [
    { exp: 'gsm8k_compare_v1', rubric: 'gsm8k_grading', judge: judgeText },
    { exp: 'belle_compare_v1', rubric: 'belle_quality', judge: judgeText },
    { exp: 'parti_t2i_compare_v1', rubric: 't2i_quality', judge: judgeVision },
    { exp: 'vqa_pointing_baseline_v1', rubric: 'pointing_accuracy', judge: judgeVision },
  ]

  for (const t of tasks) {
    const judgePrompt = await fs.readFile(path.join(SEEDS, 'judges', `${t.rubric}.judge.md`), 'utf-8')
    const results = (await fs.readFile(path.join(DATA, 'results', `${t.exp}.jsonl`), 'utf-8'))
      .trim().split('\n').map(l => JSON.parse(l))
    const judgeModel = cfg.models.find(m => m.model === t.judge)
    if (!judgeModel) { console.error(`  [judge] model ${t.judge} not configured; skip`); continue }

    const annotations: any[] = []
    for (const r of results) {
      const filled = fillJudgePrompt(judgePrompt, r)
      try {
        const res = await callLlm({
          messages: [{ role: 'user', content: filled }],
          config: { api_format: judgeModel.api_format, base_url: judgeModel.base_url, api_key: judgeModel.api_key },
          model: judgeModel.model,
          temperature: 0,
          max_tokens: 2048,
        })
        const parsed = tryParseJSON(res.content)
        annotations.push({
          annotation_id: nanoid10(),
          task_id: r.task_id,
          rubric_id: t.rubric,
          evaluator: 'llm',
          scores: parsed.scores ?? {},
          rationale: parsed.rationale ?? '',
          timestamp: new Date().toISOString(),
        })
      } catch (e: any) {
        console.error(`  [judge ${t.exp}] failed: ${e.message}`)
      }
    }
    await fs.mkdir(path.join(DATA, 'annotations'), { recursive: true })
    await fs.writeFile(
      path.join(DATA, 'annotations', `${t.exp}.jsonl`),
      annotations.map(a => JSON.stringify(a)).join('\n') + '\n',
    )
    console.log(`  [judge ${t.exp}] wrote ${annotations.length} annotations`)
  }
}

function fillJudgePrompt(template: string, result: any): string {
  return template
    .replace(/\{\{question\}\}/g, String(result.input_preview?.q?.question ?? result.input_preview?.p?.prompt ?? result.input_preview?.v?.referring_expression ?? ''))
    .replace(/\{\{model_final_answer\}\}/g, String(result.output?.final_answer ?? ''))
    .replace(/\{\{model_steps\}\}/g, String(result.output?.steps ?? ''))
    .replace(/\{\{model_confidence\}\}/g, String(result.output?.confidence ?? ''))
    .replace(/\{\{model_answer\}\}/g, String(result.output?.answer ?? result.raw_response ?? ''))
    .replace(/\{\{reference_answer\}\}/g, String(result.input_preview?.q?.reference_answer ?? ''))
    .replace(/\{\{reference_steps\}\}/g, String(result.input_preview?.q?.reference_steps ?? ''))
    .replace(/\{\{reference_criteria\}\}/g, String(result.input_preview?.q?.reference_criteria ?? ''))
    .replace(/\{\{answer_match\}\}/g, String(
      String(result.output?.final_answer ?? '').trim() === String(result.input_preview?.q?.reference_answer ?? '').trim()
    ))
}

function nanoid10(): string { return Math.random().toString(36).slice(2, 12) }
function tryParseJSON(s: string): any { try { return JSON.parse(s.replace(/^```json\s*|\s*```$/g, '').trim()) } catch { return { _raw: s } } }
```

- [ ] **Step 2: commit**

```bash
git add scripts/run-sample-experiments.ts
git commit -m "feat(scripts): implement runJudges for 4 LLM-as-judge annotation runs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3D.4 · 真跑（作者本机操作）+ 验证 + ship 进 seeds

> **作者本人一次性操作**。预算 ~¥50-130。

- [ ] **Step 1: 在 `/settings/llm` 配齐所需 7 个 model**

| Name | api_format | endpoint_kind | model | base_url |
|---|---|---|---|---|
| Opus 4.6 | anthropic | chat | claude-opus-4-6 | https://aigc.sankuai.com/v1/anthropic |
| Kimi K2.6 | openai | chat | kimi-k2.6 | https://aigc.sankuai.com/v1/openai/native |
| Gemini 3.1 Pro | openai | chat | gemini-3.1-pro | https://aigc.sankuai.com/v1/openai/native |
| GPT-Image-2 | openai | images_generations | gpt-image-2 | https://aigc.sankuai.com/v1/openai/native |
| Gemini 3.1 Flash Image | openai | chat | gemini-3.1-flash-image-preview | https://aigc.sankuai.com/v1/openai/native |
| GPT-4o (vision judge) | openai | chat | gpt-4o | https://aigc.sankuai.com/v1/openai/native |
| GPT-4o-mini (text judge) | openai | chat | gpt-4o-mini | https://aigc.sankuai.com/v1/openai/native |

api_key: `Bearer 1983731511187542037`（Anthropic 走 Bearer 也支持）

- [ ] **Step 2: 启 dev server（让 `public/sample-images/` 可访问）**

```bash
npm run dev &
```

- [ ] **Step 3: 跑预跑脚本**

```bash
npm run run:samples
```

预期：脚本顺序输出 4 套 experiment 的 record 数 + 4 套 judge 的 annotation 数；总耗时 30-60 分钟。

- [ ] **Step 4: 验证产出**

```bash
ls -la data/results/ data/annotations/
wc -l data/results/*.jsonl data/annotations/*.jsonl
```

预期：
- `gsm8k_compare_v1.jsonl`: 180 行
- `belle_compare_v1.jsonl`: 240 行
- `parti_t2i_compare_v1.jsonl`: 136 行（68 × 2）
- `vqa_pointing_baseline_v1.jsonl`: 60 行
- 4 个 annotations.jsonl 数行 = 对应 results 行数

- [ ] **Step 5: 确认 results 已被 `copyToSeeds` 拷到 seeds**

```bash
ls -la src/lib/seeds/results/ src/lib/seeds/annotations/
```

- [ ] **Step 6: 浏览器实测 4 个 experiment 详情页**

打开 evalyst 实验列表，逐个点开：
- `gsm8k_compare_v1` → cot single_list / direct table / fewshot jsx 卡都正常渲染
- `belle_compare_v1` → dual_list + grouped_grid 都正常
- `parti_t2i_compare_v1` → triple_grid 显示 6 类目 × Basic/Complex × 中英 + 图片渲染
- `vqa_pointing_baseline_v1` → bubble_overlay 在原图上叠加 point

- [ ] **Step 7: commit（仅 src/lib/seeds，不进 data/）**

```bash
git add src/lib/seeds/results/ src/lib/seeds/annotations/
git commit -m "$(cat <<'EOF'
feat(seeds): ship pre-run results + LLM-as-judge annotations

4 套 sample experiment 预跑结果固化进 seed：
- gsm8k_compare_v1: 180 records (3 schema × 2 model × 30)
- belle_compare_v1: 240 records (2 schema × 2 model × 60)
- parti_t2i_compare_v1: 136 records (1 schema × 2 model × 68)
- vqa_pointing_baseline_v1: 60 records (1 schema × 2 model × 30)

Judge: GPT-4o-mini (gsm8k/belle), GPT-4o vision (t2i/vqa)。
新用户首次启动 evalyst 直接看到完整对比页 + 标注分布。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 3E · 文档 + 收尾

#### Task 3E.1 · 写 `docs/sample-data.md` 概览

**Files:**
- Create: `docs/sample-data.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 写 `docs/sample-data.md`** （200-300 行；按 spec 附录 B 三象限速记 + 4 个 dataset 字段表 + 7 个 schema 关系图）

```markdown
# Evalyst Sample Data 概览

evalyst 开箱预置 4 套 benchmark suite，演示三象限评测能力 + 7 种 display 形态。

## 三象限速记

| Suite | 一句话 | 卖点能力 |
| --- | --- | --- |
| A · GSM8K | 同一道数学题，CoT vs Direct vs Few-shot 三种 prompt 哪个更准？ | compare_group 跨 prompt 对比；programmatic + LLM 混合 rubric；3 种 display 风格 |
| B · BELLE-eval | 中文 alignment 评测：朴素 prompt vs 角色 persona prompt？ | dual_list 双维分组；user_templates_by_cond 条件模板；grouped_grid 自定义网格 |
| C1 · PartiPrompts | GPT-Image-2 vs Gemini 3.1 Flash Image 在 6 类目上谁更会画？ | 多模态生图；triple_grid 三维分组；HEIM-style 多维 rubric |
| C2 · RefCOCO | 给 LLM 一张图 + 一句话，让它在图上点出位置——它点对了吗？ | 多模态图像输入；bubble_overlay 坐标可视化；程序化 IoU + LLM-judge 混合评分 |

## Suite A · GSM8K-mini

数据集 80 条小学数学应用题（来自 openai/grade-school-math, MIT）。

字段：…（详见 src/lib/seeds/datasets/gsm8k_mini.meta.json）

3 个 schema 共享 compare_group="gsm8k_v1"：
| Schema | Display | Prompt 策略 |
|---|---|---|
| gsm8k_cot_v1 | builtin_single_list | 标准 CoT（默认） |
| gsm8k_direct_v1 | user table | 直答（无 CoT） |
| gsm8k_fewshot_v1 | user jsx 玻璃卡 | Few-shot CoT |

…(其余 3 个 suite 类似展开)…

## License & Attribution

详见 `src/lib/seeds/LICENSES/README.md`。

- GSM8K · MIT · openai/grade-school-math
- BELLE-eval · Apache-2.0 · LianjiaTech/BELLE
- PartiPrompts · BSD-3 · google-research/parti-prompts
- RefCOCO · CC-BY 4.0 · lichengunc/refer
- COCO 图像 · CC-BY 4.0 · cocodataset.org
```

- [ ] **Step 2: 改 CLAUDE.md 索引（在表底追加一行）**

```diff
+| Sample data 概览（4 dataset / 7 schema / 4 rubric / 3 display / 4 experiment） | [`docs/sample-data.md`](docs/sample-data.md) |
```

- [ ] **Step 3: 改 CLAUDE.md 直答表"加新评测任务 / 加新数据集"行末**

末尾追加 "新 sample 见 [`docs/sample-data.md`](docs/sample-data.md)"。

- [ ] **Step 4: commit**

```bash
git add docs/sample-data.md CLAUDE.md
git commit -m "docs(sample-data): add overview + CLAUDE.md cross-reference

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

#### Task 3E.2 · 五件套 + Playwright + 浏览器对照 spec §9 验收

- [ ] **Step 1: 五件套**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
```

如 knip 报新增的 build:samples / run:samples script 不被引用，加进 knip ignore（这俩是一次性脚本）。

- [ ] **Step 2: Playwright e2e**

```bash
npm run test:e2e
```

如老 e2e 用 qa_pairs / image_prompts_v1，更新到新 sample id 后再跑。

- [ ] **Step 3: 浏览器对照 spec §9 验收 12 条 checklist 逐项检查**

跑 `npm run dev`，按 plan 末尾"验收"section 逐项打勾。

#### Task 3E.3 · 起 branch + push + 开 PR

- [ ] **Step 1: 起 branch + push**

```bash
git checkout -b feat/sample-data-redesign
git push -u origin feat/sample-data-redesign
```

- [ ] **Step 2: 开 PR**（描述按 AGENTS.md 4 段格式）

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat(sample): redesign 4 benchmark suites + prerun experiments" --body "$(cat <<'EOF'
## 改了什么

全删旧 trivia/image sample，落 4 套真 benchmark suite + 4 套预跑 sample experiment：

- **GSM8K-mini** (80 records, 3 schemas, single_list/table/jsx display)
- **BELLE-eval-mini** (60 records, 2 schemas, dual_list/grouped_grid)
- **PartiPrompts-mini** (68 records, 1 schema, triple_grid)
- **RefCOCO-mini** (30 records + 30 images, 1 schema, bubble_overlay)

7 种 display 形态全覆盖。每套 sample experiment 预跑 results + LLM-as-judge
annotations 进 git，新用户开箱即看完整对比页。

数据来源：openai/grade-school-math (MIT) / LianjiaTech/BELLE (Apache-2.0) /
google-research/parti-prompts (BSD-3) / lichengunc/refer (CC-BY 4.0)。

## 为什么

老 sample 是 12 条 trivia + 20 条图 prompt，严重低估 evalyst 实际能力。详见 spec
[`docs/superpowers/specs/2026-05-12-sample-data-redesign-design.md`](docs/superpowers/specs/2026-05-12-sample-data-redesign-design.md)。

## 怎么验证

- 五件套全绿 + Playwright e2e 全绿
- 浏览器跑 \`npm run dev\`，spec §9 验收 12 条 checklist 逐项 OK
- 数据脚本可重跑：\`npm run build:samples\` + \`npm run run:samples\`

## 向后兼容风险

- **破坏性**：老 dataset id qa_pairs / image_prompts_v1 已删，引用它们的老
  experiment / schema 会变成"找不到 dataset"。本仓内已无此引用，外部用户自
  定义文件需自行迁移。
- 老 schema id qa_answer_v1 / image_gen_v1 同理删。
- 仓 size 增量 ~5-8MB（jsonl + 30 张 720px COCO 图）。
- 依赖 PR 1 (llm-client images_generations) 已合，否则 GPT-Image-2 跑不了。
- PR 4（_computed / _annotation 字段）未合时，A2 table 的 ✓✗ 列、B2 grouped_grid
  的 judge 分 badge 会渲染为空——可降级（spec §10 R1）。

## Plan deviation

无。所有改动严格落在 plan §3 内。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 4 · Display computed-fields + annotation-pull 协议（PR 4，可降级）

> 给 table display 加 `_computed.*` 协议（程序化对错列）、给 grouped_grid 加 `_annotation.*` 协议（judge 分 badge）。如果 implementation 阶段发现复杂度过高，**降级**：去掉 A2 / B2 display 的对应列，sample 数据本身仍可用，只是失去这两个演示力（spec §10 R1）。

> **架构**：`view-helpers.tsx` `readField` 入口加路由——`path.startsWith('_computed.')` 走 `readComputedField(result, path)`（识别 `answer_match` 等内置算子，对比 output 与 input_preview）；`path.startsWith('_annotation.')` 走 `readAnnotationField(result, annotations, path)`（按 task_id 索引最新 annotation 取 scores[criterion_key]）。父组件 `configurable-display.tsx` 给所有 display 注入 `annotations` props（来自 experiment 详情页拉的 `/api/experiments/{id}/annotations`）。

### Task 4.1 · `_computed.*` 协议（最小实现 + display-table 接入 + TDD）

**Files:**
- Modify: `src/components/results/view-helpers.tsx` (readField 入口加路由)
- Create: `src/components/results/__tests__/computed-fields.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `src/components/results/__tests__/computed-fields.test.tsx`：

```typescript
import { describe, it, expect } from 'vitest'
import { readField } from '../view-helpers'
import type { GenericResultRecord } from '@/lib/schema/types'

const r: GenericResultRecord = {
  schema_id: 'gsm8k_direct_v1',
  schema_version: 1,
  task_id: 't1',
  experiment_id: 'e1',
  input_refs: { q: 'gsm8k_001' },
  input_preview: { 'q.qid': 'gsm8k_001', 'q.reference_answer': '18' },
  output: { final_answer: '18' },
  status: 'success',
  latency_ms: 1234,
  model: 'kimi-k2.6',
  timestamp: '2026-05-12T00:00:00Z',
}

describe('_computed.* protocol', () => {
  it('answer_match returns true when output.final_answer equals input_preview reference', () => {
    expect(readField(r, '_computed.answer_match')).toBe(true)
  })

  it('answer_match returns false on mismatch', () => {
    const wrong = { ...r, output: { final_answer: '99' } }
    expect(readField(wrong, '_computed.answer_match')).toBe(false)
  })

  it('answer_match strips trailing/leading whitespace', () => {
    const padded = { ...r, output: { final_answer: '  18 ' } }
    expect(readField(padded, '_computed.answer_match')).toBe(true)
  })

  it('answer_match treats numeric equality (18 vs 18.0)', () => {
    const numeric = { ...r, input_preview: { 'q.qid': 'x', 'q.reference_answer': '18.0' } }
    expect(readField(numeric, '_computed.answer_match')).toBe(true)
  })

  it('returns undefined for unknown _computed.* keys', () => {
    expect(readField(r, '_computed.nonsense')).toBe(undefined)
  })
})
```

- [ ] **Step 2: 跑测试，验证 fail**

```bash
npx vitest run src/components/results/__tests__/computed-fields.test.tsx
```

预期：FAIL（`readField` 不识别 `_computed.*` 前缀，返回 undefined / 走 default branch）。

- [ ] **Step 3: 实现 `readComputedField`**

修改 `src/components/results/view-helpers.tsx`，在 `readField` 函数顶部加路由，并在文件下方加 helper：

```typescript
// 在 readField switch 之前加：
  if (path.startsWith('_computed.')) {
    return readComputedField(result, path.slice('_computed.'.length))
  }
```

文件末尾加 helper：

```typescript
/**
 * `_computed.*` 协议：由 result 内字段程序化派生的"伪字段"，display table/cell
 * 用来展示对错对比 / 简单衍生值。当前支持的算子：
 *   - answer_match: bool — output.final_answer 与 input_preview.<alias>.reference_answer
 *     字符串相等（去空白）或数值相等。alias 自动取 input_preview 中第一个含 reference_answer
 *     的 key 前缀。
 */
function readComputedField(result: GenericResultRecord, key: string): unknown {
  switch (key) {
    case 'answer_match': {
      const out = String((result.output as Record<string, unknown> | undefined)?.final_answer ?? '').trim()
      const refKey = Object.keys(result.input_preview).find(k => k.endsWith('.reference_answer'))
      const ref = refKey ? String(result.input_preview[refKey] ?? '').trim() : ''
      if (out === ref) return true
      const outNum = Number(out), refNum = Number(ref)
      if (!Number.isNaN(outNum) && !Number.isNaN(refNum) && outNum === refNum) return true
      return false
    }
    default:
      return undefined
  }
}
```

- [ ] **Step 4: 跑测试，验证 PASS**

```bash
npx vitest run src/components/results/__tests__/computed-fields.test.tsx
```

预期：5 tests PASS。

- [ ] **Step 5: 增强 `renderField` 处理 boolean 显示为 ✓✗**

修改 `src/components/results/view-helpers.tsx` `renderField` 函数，在 type='badge' 分支增强 boolean 处理：

```typescript
    case "badge":
      if (typeof value === "boolean") {
        return value
          ? <Badge variant="default" className="text-xs bg-green-600">✓</Badge>
          : <Badge variant="destructive" className="text-xs">✗</Badge>
      }
      return <Badge variant="secondary" className="text-xs">{formatValue(value, maxLength)}</Badge>
```

- [ ] **Step 6: 跑全量单测**

```bash
npm test
```

预期：全绿（`renderField` boolean 增强不破坏其他用例）。

- [ ] **Step 7: commit**

```bash
git add src/components/results/view-helpers.tsx src/components/results/__tests__/computed-fields.test.tsx
git commit -m "$(cat <<'EOF'
feat(display): _computed.* protocol + answer_match operator

display-table 现在可以用 _computed.answer_match 列做"模型答案 vs 参考答案"
的程序化对错对比。renderField 在 badge type 上识别 boolean → ✓/✗。

供 GSM8K direct 表格 display 用，也可被任意需要程序化派生 boolean
的 user table display 使用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2 · `_annotation.*` 协议（含 ResultViewProps 扩展 + display-grouped-grid 接入 + TDD）

**Files:**
- Modify: `src/components/results/types.tsx` (ResultViewProps 加 annotations)
- Modify: `src/components/results/view-helpers.tsx` (readAnnotationField helper)
- Modify: `src/components/results/display-grouped-grid.tsx` (传入 annotations)
- Modify: `src/components/results/display-table.tsx` (同样传入 annotations)
- Create: `src/components/results/__tests__/annotation-fields.test.tsx`

- [ ] **Step 1: 扩展 ResultViewProps**

修改 `src/components/results/types.tsx`：

```typescript
import type { GenericResultRecord, TaskSchema, Annotation } from "@/lib/schema/types"

export interface ResultViewProps {
  results: GenericResultRecord[]
  schema: TaskSchema
  /** 按 task_id → 最新 annotation 索引；display-table / grouped_grid 用 _annotation.* 协议读 */
  annotations?: Map<string, Annotation>
}

export type CellViewProps = {
  result: GenericResultRecord
  schema: TaskSchema
  annotations?: Map<string, Annotation>
}
```

- [ ] **Step 2: 写 `readAnnotationField` 失败测试**

新建 `src/components/results/__tests__/annotation-fields.test.tsx`：

```typescript
import { describe, it, expect } from 'vitest'
import { readAnnotationField } from '../view-helpers'
import type { Annotation } from '@/lib/schema/types'

const ann: Annotation = {
  annotation_id: 'a1',
  task_id: 't1',
  rubric_id: 'gsm8k_grading',
  evaluator: 'llm',
  scores: { overall_quality: 87, reasoning_validity: 4, final_answer_correct: true },
  rationale: 'good',
  timestamp: '2026-05-12T00:00:00Z',
}

const annMap = new Map([['t1', ann]])

describe('_annotation.* protocol', () => {
  it('reads numeric criterion score', () => {
    expect(readAnnotationField('t1', annMap, 'overall_quality')).toBe(87)
    expect(readAnnotationField('t1', annMap, 'reasoning_validity')).toBe(4)
  })

  it('reads boolean criterion', () => {
    expect(readAnnotationField('t1', annMap, 'final_answer_correct')).toBe(true)
  })

  it('returns undefined when task_id absent', () => {
    expect(readAnnotationField('missing', annMap, 'overall_quality')).toBe(undefined)
  })

  it('returns undefined when criterion key absent', () => {
    expect(readAnnotationField('t1', annMap, 'nonsense')).toBe(undefined)
  })

  it('returns undefined when annotations map absent', () => {
    expect(readAnnotationField('t1', undefined, 'overall_quality')).toBe(undefined)
  })
})
```

- [ ] **Step 3: 跑测试验证 fail（helper 不存在）**

```bash
npx vitest run src/components/results/__tests__/annotation-fields.test.tsx
```

预期：FAIL（import 错误）。

- [ ] **Step 4: 实现 `readAnnotationField`**

在 `src/components/results/view-helpers.tsx` 末尾加：

```typescript
import type { Annotation } from "@/lib/schema/types"

/**
 * `_annotation.*` 协议：从外部注入的 annotations map（按 task_id 索引）取
 * 该 result 最新 annotation 的 scores[criterionKey]。配合 display-table /
 * grouped_grid 把 LLM-as-judge 评分嵌入对比视图。
 */
export function readAnnotationField(
  taskId: string,
  annotations: Map<string, Annotation> | undefined,
  criterionKey: string,
): unknown {
  const ann = annotations?.get(taskId)
  if (!ann) return undefined
  const v = ann.scores[criterionKey]
  return v
}
```

- [ ] **Step 5: 跑测试验证 PASS**

```bash
npx vitest run src/components/results/__tests__/annotation-fields.test.tsx
```

预期：5 tests PASS。

- [ ] **Step 6: 改 display-table.tsx + display-grouped-grid.tsx 接入**

`display-table.tsx`：
```diff
-export function DisplayTable({ results, display }: ResultViewProps & { display: Display }) {
+export function DisplayTable({ results, display, annotations }: ResultViewProps & { display: Display }) {
```

每行渲染时若 `c.field.startsWith('_annotation.')`，走 `readAnnotationField(r.task_id, annotations, c.field.slice('_annotation.'.length))` 取值，再 `renderField`。

`display-grouped-grid.tsx`：同样在 props 接 `annotations`，cell_columns 渲染时按 `_annotation.*` 前缀分发。

- [ ] **Step 7: 跑全量单测 + tsc**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 8: commit**

```bash
git add src/components/results/types.tsx src/components/results/view-helpers.tsx src/components/results/display-table.tsx src/components/results/display-grouped-grid.tsx src/components/results/__tests__/annotation-fields.test.tsx
git commit -m "$(cat <<'EOF'
feat(display): _annotation.* protocol for embedding LLM-as-judge scores

ResultViewProps 新增可选 annotations: Map<task_id, Annotation>。
display-table / grouped_grid 现在可以用 _annotation.{criterion_key} 列
直接展示该 result 最新 annotation 的某维度分数（badge 形式）。

供 BELLE persona grid 等需要在对比视图嵌入 judge 分的 user display 用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3 · 父组件 `configurable-display.tsx` + experiment 详情页注入 annotations

**Files:**
- Modify: `src/components/results/configurable-display.tsx` (透传 annotations)
- Modify: experiment 详情页（具体路径 implementation 时定位，预计在 `src/app/experiments/[id]/page.tsx` 或对应 client component）

- [ ] **Step 1: configurable-display 透传**

```diff
-export function ConfigurableDisplay({ results, schema, display }: ResultViewProps & { display: Display }) {
+export function ConfigurableDisplay({ results, schema, display, annotations }: ResultViewProps & { display: Display }) {
   switch (display.mode) {
     case "table":
-      return <DisplayTable results={results} schema={schema} display={display} />
+      return <DisplayTable results={results} schema={schema} display={display} annotations={annotations} />
     case "grouped_grid":
-      return <DisplayGroupedGrid results={results} schema={schema} display={display} />
+      return <DisplayGroupedGrid results={results} schema={schema} display={display} annotations={annotations} />
```

`ConfigurableCell` 同样改。

- [ ] **Step 2: 找到 experiment 详情页消费 ConfigurableDisplay 的地方**

```bash
grep -rn "ConfigurableDisplay\b" src/app/ src/components/
```

定位 1-2 个父组件（可能是 `src/app/experiments/[id]/page.tsx` 或专门的客户端展示组件）。

- [ ] **Step 3: 在父组件 fetch annotations 并 build map**

```typescript
const [annotations, setAnnotations] = useState<Map<string, Annotation>>(new Map())

useEffect(() => {
  fetch(`/api/experiments/${experimentId}/annotations`)
    .then(r => r.json())
    .then((list: Annotation[]) => {
      // 同 task_id 取最新一条（timestamp 最大）
      const m = new Map<string, Annotation>()
      for (const a of list) {
        const prev = m.get(a.task_id)
        if (!prev || a.timestamp > prev.timestamp) m.set(a.task_id, a)
      }
      setAnnotations(m)
    })
    .catch(() => setAnnotations(new Map()))
}, [experimentId])
```

`<ConfigurableDisplay results={...} schema={...} display={...} annotations={annotations} />`

> 如果 `/api/experiments/{id}/annotations` 端点不存在，要么新增（小改 `src/app/api/experiments/[id]/annotations/route.ts`），要么用 server-side prefetch ssr 注入 annotations。spec implementation 时确认现有 annotation API 形态。

- [ ] **Step 4: 跑 dev 实测**

```bash
npm run dev
```

打开 `http://localhost:3000/experiments/belle_compare_v1`（PR 3 已 ship 该 experiment + annotations.jsonl），grouped_grid cell 应展示 judge 分 badge（来自 `_annotation.overall_score`）。

打开 `gsm8k_compare_v1`（direct schema 走 table display），✓✗ 列应正确显示（来自 `_computed.answer_match`，无依赖 annotation）。

- [ ] **Step 5: commit**

```bash
git add src/components/results/configurable-display.tsx src/app/experiments/...  # 实际改动文件
git commit -m "$(cat <<'EOF'
feat(experiments): inject annotations map into display tree

experiment 详情页拉 /api/experiments/{id}/annotations，按 task_id → latest
索引成 Map 注入到 ConfigurableDisplay。下游 display-table / grouped_grid
自动消费 _annotation.* 列。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.4 · 五件套 + Playwright + 起 branch + 开 PR

- [ ] **Step 1: 五件套**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
```

- [ ] **Step 2: Playwright e2e**

```bash
npm run test:e2e
```

考虑加一条新的 e2e：打开 `gsm8k_compare_v1` direct schema → 断言 ✓✗ 列至少有一行渲染了 ✓ badge。

- [ ] **Step 3: 浏览器逐项验证**

- `gsm8k_compare_v1` direct schema → table display ✓✗ 列正确显示（红绿对错）
- `belle_compare_v1` persona schema → grouped_grid cell judge_score badge 显示
- 任意 result，删除其 annotation 后刷新 → cell 显示空白（fallback 优雅）

- [ ] **Step 4: 起 branch + push**

```bash
git checkout -b feat/display-computed-and-annotation-fields
git push -u origin feat/display-computed-and-annotation-fields
```

- [ ] **Step 5: 开 PR**

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat(display): _computed.* + _annotation.* mini protocols" --body "$(cat <<'EOF'
## 改了什么

给 display-table / grouped_grid 加两个 mini 字段路由协议：

- **`_computed.*`**：result 内程序化派生伪字段。当前支持 `answer_match`
  （比对 output.final_answer 与 input_preview reference_answer），boolean →
  ✓/✗ badge。
- **`_annotation.{criterion_key}`**：从注入的 annotations map 取该 task_id
  最新 annotation 的 scores[criterion_key]。LLM-as-judge 分嵌入对比视图。

支持代码：
- `view-helpers.tsx` `readField` 入口加路由 + 两个 helper
- `ResultViewProps` 加可选 `annotations: Map<string, Annotation>`
- `configurable-display.tsx` 透传 annotations
- experiment 详情页 fetch + 构造 map + 注入
- 10 个新单测覆盖

## 为什么

PR 3 ship 的 GSM8K direct table display 与 BELLE persona grouped_grid
display 各依赖一个伪字段（`_computed.answer_match` / `_annotation.overall_score`）。
没有这俩协议，对应列显示为空——sample 数据演示力打折（spec §10 R1 已识别为可降级）。
本 PR 把"演示力"补回来。

## 怎么验证

- 五件套 + Playwright e2e 全绿
- 浏览器：`gsm8k_compare_v1` direct schema 看 ✓✗ 列；`belle_compare_v1`
  persona schema 看 grouped_grid cell judge 分 badge

## 向后兼容风险

- `ResultViewProps.annotations` optional，老 caller 不传也正常工作
- 不识别的 `_computed.*` / `_annotation.*` key 返回 undefined → renderField
  渲染 "-"，不抛错
- 不影响现有 schema / display / experiment 数据

## Plan deviation

无。所有改动落在 plan §4 内。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 总览

| Phase | PR | 任务数 | 主要风险 |
|---|---|---|---|
| 1 | `feat/llm-client-images-generations` | 7 | 真 API 协议匹配（spec §10 R1 已识别） |
| 2 | `refactor/seed-scan-subdirs` | 5 | 老 sample 兼容性 |
| 3 | `feat/sample-data-redesign` | 18 | 数据源 fallback（spec §10 R2/R3）+ 跑数据预算 ¥50-130 + commit 体积 5-8MB |
| 4 | `feat/display-computed-and-annotation-fields` | 4 | 协议设计复杂度，可降级（spec §10 R1） |

合计 4 PR / 34 task。

---

## 验收（spec §9）

PR 1-3 全合后新用户首次启动 evalyst 应直接看到：

- [ ] Datasets 页 4 个新 sample，无任何 qa_pairs / image_prompts_v1 残留
- [ ] Schemas 页 7 个新 schema
- [ ] Rubrics 页 4 个新 rubric
- [ ] Displays 页 3 个新 user display
- [ ] Experiments 页 4 个 sample experiment 含完整 results + annotations
- [ ] `gsm8k_compare_v1` 三种 display 形态都能正确渲染
- [ ] `parti_t2i_compare_v1` triple_grid 三维分组（category × challenge × is_chinese）显示正确
- [ ] `vqa_pointing_baseline_v1` bubble_overlay 在原图上叠加点位
- [ ] 任意删除一个 sample 文件后刷新自动恢复
- [ ] CI 五件套 + Playwright E2E 全绿
- [ ] CLAUDE.md 索引更新 + `docs/sample-data.md` 可点击

PR 4 验收（可选）：

- [ ] A2 table display ✓✗ 列正确（程序化对比）
- [ ] B2 grouped_grid judge 分 badge 正确（取最新 annotation）
