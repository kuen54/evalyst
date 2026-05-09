# 生图（Image Generation）评测 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 manual image-generation eval pipeline — LLM client extracts `message.images[]`, batch-runner persists PNG to disk, schema gains `image_url` types, renderField hooks into a global ImageLightbox, RubricAnnotator gains an inline image preview, and three seed resources let users open-the-box-and-go with sankuai gemini-3.1-flash-image-preview.

**Architecture:** OpenAI-compatible chat-completions API request stays untouched (existing `api_format: 'openai'` branch suffices). `parseResponse` extracts `choices[0].message.images[]` (data URL). `batch-runner.executeTask` decodes base64 → writes PNG to `data/results/{exp_id}/images/{task_id}_{idx}.png` → assigns absolute API URL `/api/results/{exp_id}/images/{file}` to schema fields declared as `image_url` / `image_url_list`. New API route serves PNG as static binary. `renderField` image case grows a click handler; `ImageLightbox` is a global Dialog Provider mounted in `RootLayout`. RubricAnnotator gains optional `result` + `schema` props to render an inline image preview row above the criteria form. Three seed files (`image_prompts_v1` dataset / `image_gen_v1` schema / `image_quality_v1` rubric) registered in `seed.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, vitest (pure-function unit), Playwright (e2e smoke), shadcn/ui Dialog.

**Spec reference:** `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| modify | `src/lib/llm-client.ts` | LlmResponse adds `images?`, parseResponse extracts `message.images[]` |
| modify | `src/lib/batch-runner.ts` | executeTask invokes image-store after parsing response |
| create | `src/lib/image-store.ts` | `saveImagesForTask` decode+writeAtomic + `assignImagePathsToOutput` |
| create | `src/app/api/results/[exp_id]/images/[filename]/route.ts` | GET binary PNG with path-traversal guards |
| modify | `src/lib/schema/types.ts` | JsonFieldType `+ 'image_url' \| 'image_url_list'` |
| modify | `src/lib/schema/validate.ts` | validateProp cases for two new types |
| modify | `src/components/results/output-structure.ts` | inferFieldRenderType prefers explicit `image_url*` type |
| modify | `src/components/results/view-helpers.tsx` | renderField image case wraps in click-to-lightbox |
| create | `src/components/ui/image-lightbox.tsx` | Global Provider + Dialog component |
| modify | `src/app/layout.tsx` | mount LightboxProvider |
| modify | `src/components/template-builder/form-state.ts` | FormOutputField.type adds two |
| modify | `src/components/template-builder/template-form-page.tsx` | OUTPUT_TYPE_OPTIONS adds two |
| modify | `src/components/template-builder/template-form-parts.tsx` | OUTPUT_TYPE_OPTIONS adds two (kept in sync) |
| modify | `src/lib/mock-data.ts` | mockValue cases for `image_url*` |
| modify | `src/components/results/rubric-annotator.tsx` | optional `result?` + `schema?` props for image preview |
| create | `src/lib/seeds/image_prompts_v1.meta.json` + `.jsonl` | 20 starter prompts |
| create | `src/lib/seeds/image_gen_v1.schema.json` | seed TaskSchema |
| create | `src/lib/seeds/image_quality_v1.rubric.json` | HEIM 5-criterion seed rubric |
| modify | `src/lib/seed.ts` | register 3 new seed IDs |
| modify | `src/lib/meta-prompts/template.ts` | document `image_url` types |
| modify | `src/lib/i18n/zh.ts` + `en.ts` | new keys for type labels + lightbox UI |
| modify | `.claude/skills/evalyst/SKILL.md` | "生图评测" section |
| modify | `.claude/skills/evalyst-task/SKILL.md` | image_url type doc |
| create | `src/lib/__tests__/llm-client.parse-images.test.ts` | unit |
| create | `src/lib/__tests__/image-store.test.ts` | unit |
| create | `src/lib/schema/__tests__/validate.image.test.ts` | unit |
| create | `e2e/image-route.spec.ts` | e2e route 404 + render |
| create | `scripts/test-sankuai-image.sh` | manual curl harness (gitignored) |

**Implementation deviation from spec §5.2:** JSONL stores **absolute API URL** (`/api/results/{exp_id}/images/{file}.png`) instead of relative path `images/{file}.png`. This eliminates the need to thread `expId` through `renderField` signature. exp_id is part of the URL path; portability isn't a concern (the URL is specific to evalyst's own routing).

---

## Branch Setup

- [ ] **Step 0a: Verify on the right branch**

Run: `git branch --show-current`
Expected: `feat/image-gen-eval`

If not on this branch:
```bash
git checkout main
git pull origin main
git checkout -b feat/image-gen-eval
```

- [ ] **Step 0b: Verify spec exists**

Run: `ls docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`
Expected: file exists.

---

## Task 1: Schema types — add `image_url` / `image_url_list`

**Files:**
- Modify: `src/lib/schema/types.ts:125-132`
- Modify: `src/lib/schema/validate.ts:38-108`
- Test: `src/lib/schema/__tests__/validate.image.test.ts`

- [ ] **Step 1: Write failing test for new validate cases**

Create `src/lib/schema/__tests__/validate.image.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateJson } from '../validate'

describe('validate image_url', () => {
  it('accepts non-empty string', () => {
    const r = validateJson({ url: 'https://example.com/x.png' }, {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts data URL', () => {
    const r = validateJson({ url: 'data:image/png;base64,iVBORw0K' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts API route URL', () => {
    const r = validateJson({ url: '/api/results/abc/images/xyz_0.png' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects empty string', () => {
    const r = validateJson({ url: '' }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects non-string', () => {
    const r = validateJson({ url: 42 }, {
      type: 'object',
      properties: { url: { type: 'image_url' } },
    })
    expect(r.ok).toBe(false)
  })
})

describe('validate image_url_list', () => {
  it('accepts non-empty string array', () => {
    const r = validateJson({ urls: ['a.png', 'b.png'] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts empty array (no min_length)', () => {
    const r = validateJson({ urls: [] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects array with empty string entries', () => {
    const r = validateJson({ urls: ['a.png', ''] }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects non-array', () => {
    const r = validateJson({ urls: 'a.png' }, {
      type: 'object',
      properties: { urls: { type: 'image_url_list' } },
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/lib/schema/__tests__/validate.image.test.ts`
Expected: tests fail with TypeScript errors about `image_url` / `image_url_list` not being valid `JsonFieldType`.

- [ ] **Step 3: Extend JsonFieldType**

Edit `src/lib/schema/types.ts` lines 125-132:

```ts
export type JsonFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'string|null'
  | 'tuple:number[]'
  | 'image_url'
  | 'image_url_list'
```

- [ ] **Step 4: Add validateProp cases**

Edit `src/lib/schema/validate.ts`. Inside `validateProp` switch (after `case 'object':` block, around line 107, BEFORE the closing `}` of switch):

```ts
    case 'image_url':
      if (typeof data !== 'string') return { ok: false, error: `${path}: expected image_url (string)` }
      if (data.length === 0) return { ok: false, error: `${path}: image_url must be non-empty` }
      return { ok: true }

    case 'image_url_list':
      if (!Array.isArray(data)) return { ok: false, error: `${path}: expected image_url_list (array)` }
      for (let i = 0; i < data.length; i++) {
        if (typeof data[i] !== 'string') return { ok: false, error: `${path}[${i}]: expected string` }
        if ((data[i] as string).length === 0) return { ok: false, error: `${path}[${i}]: must be non-empty` }
      }
      return { ok: true }
```

- [ ] **Step 5: Run test, verify pass**

Run: `npm test -- src/lib/schema/__tests__/validate.image.test.ts`
Expected: 9 tests pass.

- [ ] **Step 6: Run full type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema/types.ts src/lib/schema/validate.ts src/lib/schema/__tests__/validate.image.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): add image_url + image_url_list field types

JsonFieldType 加 'image_url'（单图）+ 'image_url_list'（多图数组）。
validate.ts 加对应分支：非空字符串 / 非空字符串数组。
为 v1 生图评测的 schema 显式声明铺路。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: LLM client — extract `message.images[]`

**Files:**
- Modify: `src/lib/llm-client.ts:44-48` (LlmResponse), `:166-182` (parseResponse), `:94-95` (callLlm propagation)
- Test: `src/lib/__tests__/llm-client.parse-images.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/llm-client.parse-images.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ApiConfig } from '../types'

// We need to import parseResponse — but it's not exported. Plan: export it.
// (See Step 3 below — we add an export.)
import { parseResponseForTest } from '../llm-client'

const openaiCfg: ApiConfig = { api_format: 'openai', base_url: 'x', api_key: 'k' }

describe('parseResponse with images', () => {
  it('extracts images[] from message (image_url.url shape)', () => {
    const resp = {
      choices: [{
        message: {
          content: 'Here is the image.',
          images: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
          ],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.content).toBe('Here is the image.')
    expect(out.images).toHaveLength(2)
    expect(out.images?.[0]).toEqual({ url: 'data:image/png;base64,AAAA', mime_type: 'image/png' })
    expect(out.images?.[1]).toEqual({ url: 'data:image/jpeg;base64,BBBB', mime_type: 'image/jpeg' })
  })

  it('extracts images from bare url shape', () => {
    const resp = {
      choices: [{
        message: {
          content: '',
          images: [{ url: 'https://example.com/img.png' }],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toHaveLength(1)
    expect(out.images?.[0].url).toBe('https://example.com/img.png')
    expect(out.images?.[0].mime_type).toBeUndefined()  // not a data URL
  })

  it('returns undefined images when none present', () => {
    const resp = { choices: [{ message: { content: 'hello' } }] }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toBeUndefined()
  })

  it('filters out empty url entries', () => {
    const resp = {
      choices: [{
        message: {
          content: '',
          images: [
            { image_url: { url: '' } },
            { image_url: { url: 'data:image/png;base64,XXX' } },
            { url: '' },
            {},
          ],
        },
      }],
    }
    const out = parseResponseForTest(openaiCfg, resp)
    expect(out.images).toHaveLength(1)
    expect(out.images?.[0].url).toBe('data:image/png;base64,XXX')
  })

  it('does not break Anthropic branch (no images extracted)', () => {
    const anthropicCfg: ApiConfig = { api_format: 'anthropic', base_url: 'x', api_key: 'k' }
    const resp = {
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    const out = parseResponseForTest(anthropicCfg, resp)
    expect(out.content).toBe('hello')
    expect(out.images).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/lib/__tests__/llm-client.parse-images.test.ts`
Expected: import fails — `parseResponseForTest` does not exist.

- [ ] **Step 3: Extend LlmResponse and parseResponse**

Edit `src/lib/llm-client.ts`:

Replace `LlmResponse` (lines 44-48):

```ts
export interface LlmResponse {
  content: string
  images?: Array<{ url: string; mime_type?: string }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  latency_ms: number
}
```

Replace `parseResponse` (lines 166-182):

```ts
function parseResponse(config: ApiConfig, data: unknown): { content: string; images?: LlmResponse['images']; usage?: LlmResponse['usage'] } {
  const d = data as Record<string, unknown>
  if (config.api_format === 'anthropic') {
    const blocks = Array.isArray(d.content) ? (d.content as Array<{ type: string; text?: string }>) : []
    const content = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    const u = d.usage as { input_tokens?: number; output_tokens?: number } | undefined
    const usage = u
      ? { prompt_tokens: u.input_tokens ?? 0, completion_tokens: u.output_tokens ?? 0, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
      : undefined
    return { content, usage }
  }
  const choices = d.choices as Array<{ message?: { content?: string; images?: unknown } }> | undefined
  const message = choices?.[0]?.message
  const content = message?.content ?? ''

  // Extract images[] (OpenAI-compatible gateway convention for image-out models)
  let images: LlmResponse['images'] | undefined
  const rawImages = Array.isArray(message?.images) ? (message!.images as Array<Record<string, unknown>>) : null
  if (rawImages) {
    const parsed = rawImages
      .map((img): { url: string; mime_type?: string } | null => {
        const fromImageUrl = (img.image_url as { url?: unknown })?.url
        const fromBareUrl = img.url
        const url = typeof fromImageUrl === 'string'
          ? fromImageUrl
          : (typeof fromBareUrl === 'string' ? fromBareUrl : '')
        if (!url) return null
        const mimeMatch = /^data:([^;]+);base64,/.exec(url)
        return mimeMatch ? { url, mime_type: mimeMatch[1] } : { url }
      })
      .filter((x): x is { url: string; mime_type?: string } => x !== null)
    if (parsed.length > 0) images = parsed
  }

  return {
    content,
    images,
    usage: d.usage as LlmResponse['usage'],
  }
}

// Re-export for unit tests (private to project, not in public API of llm-client)
export const parseResponseForTest = parseResponse
```

Replace lines 94-95 in `callLlm`:

```ts
  const start = Date.now()
  const req = buildApiRequest(p.config, buildRequestBody(p))
  const data = await executeWithRetry(req, p.signal)
  const { content, images, usage } = parseResponse(p.config, data)
  return { content, images, usage, latency_ms: Date.now() - start }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/lib/__tests__/llm-client.parse-images.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all green (existing tests still pass, no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm-client.ts src/lib/__tests__/llm-client.parse-images.test.ts
git commit -m "$(cat <<'EOF'
feat(llm-client): extract message.images[] for image-gen responses

LlmResponse 加可选 images?: Array<{url, mime_type?}>。parseResponse
OpenAI 分支提取 choices[0].message.images[]（OpenAI-compatible gateway
对生图模型的非标约定，OpenRouter / sankuai 等沿用）。

兼容 image_url.url 和 bare url 两种字段命名；data URL 自动从 prefix
解析 mime_type；空 url 过滤。

Anthropic 分支不动（官方 /v1/messages 不支持图像 output）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Image storage module

**Files:**
- Create: `src/lib/image-store.ts`
- Test: `src/lib/__tests__/image-store.test.ts`

**Responsibility:** decode data URLs (or fetch http URLs) → write to disk → return absolute API URL strings.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/image-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { saveImagesForTask, assignImagePathsToOutput } from '../image-store'
import type { JsonSchemaDef } from '../schema/types'

describe('saveImagesForTask', () => {
  let tmpDir: string
  let originalCwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-test-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('decodes data URL and writes to disk', async () => {
    // 1x1 transparent PNG (base64)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [{ url: `data:image/png;base64,${tinyPng}`, mime_type: 'image/png' }],
    })

    expect(result).toEqual(['/api/results/exp1/images/task1_0.png'])

    // verify file exists on disk
    const expectedPath = path.join(tmpDir, 'data', 'results', 'exp1', 'images', 'task1_0.png')
    expect(fs.existsSync(expectedPath)).toBe(true)
    expect(fs.statSync(expectedPath).size).toBeGreaterThan(0)
  })

  it('handles multiple images with idx suffix', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [
        { url: `data:image/png;base64,${tinyPng}`, mime_type: 'image/png' },
        { url: `data:image/jpeg;base64,${tinyPng}`, mime_type: 'image/jpeg' },
      ],
    })

    expect(result).toEqual([
      '/api/results/exp1/images/task1_0.png',
      '/api/results/exp1/images/task1_1.jpg',
    ])
  })

  it('defaults to .png when mime_type unknown', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [{ url: `data:application/octet-stream;base64,${tinyPng}` }],
    })
    expect(result[0]).toMatch(/\.png$/)
  })

  it('returns empty array when no images provided', async () => {
    const result = await saveImagesForTask({ experimentId: 'exp1', taskId: 'task1', images: [] })
    expect(result).toEqual([])
  })
})

describe('assignImagePathsToOutput', () => {
  it('assigns first path to image_url field', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        caption: { type: 'string' },
        image_url: { type: 'image_url' },
      },
    }
    const output = { caption: 'A red apple' }
    const result = assignImagePathsToOutput(output, schema, ['/api/x/img/y_0.png'])
    expect(result).toEqual({ caption: 'A red apple', image_url: '/api/x/img/y_0.png' })
  })

  it('assigns full array to image_url_list field', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        images: { type: 'image_url_list' },
      },
    }
    const result = assignImagePathsToOutput({}, schema, ['/a.png', '/b.png', '/c.png'])
    expect(result).toEqual({ images: ['/a.png', '/b.png', '/c.png'] })
  })

  it('leaves output untouched when schema has no image fields', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { answer: { type: 'string' } },
    }
    const result = assignImagePathsToOutput({ answer: 'hi' }, schema, ['/a.png'])
    expect(result).toEqual({ answer: 'hi' })
  })

  it('handles missing schema.properties', () => {
    const schema: JsonSchemaDef = { type: 'object' }
    const result = assignImagePathsToOutput({ foo: 1 }, schema, ['/a.png'])
    expect(result).toEqual({ foo: 1 })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/lib/__tests__/image-store.test.ts`
Expected: import fails — module does not exist.

- [ ] **Step 3: Implement image-store.ts**

Create `src/lib/image-store.ts`:

```ts
import fs from 'fs/promises'
import path from 'path'
import type { JsonSchemaDef } from './schema/types'
import { ensureDir } from './fs-utils'

export interface ImagePayload {
  url: string                 // 'data:image/png;base64,...' OR 'https://...'
  mime_type?: string
}

export interface SaveImagesArgs {
  experimentId: string
  taskId: string
  images: ImagePayload[]
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function extFor(mime?: string): string {
  if (!mime) return '.png'
  return MIME_TO_EXT[mime.toLowerCase()] ?? '.png'
}

function imagesDir(experimentId: string): string {
  return path.join(process.cwd(), 'data', 'results', experimentId, 'images')
}

/**
 * Decode data URLs (or fetch HTTPS URLs) and write to
 * data/results/{experimentId}/images/{taskId}_{idx}.{ext}.
 *
 * Returns absolute API URLs (e.g. "/api/results/exp1/images/task1_0.png")
 * suitable for direct use as <img src> in the UI — no relative-path resolution
 * needed at render time.
 *
 * Uses fs.writeFile directly (not writeAtomic) — image files are atomic by
 * convention (one writer, one task_id+idx); a torn write would manifest as
 * a corrupt PNG which the user immediately notices.
 */
export async function saveImagesForTask(args: SaveImagesArgs): Promise<string[]> {
  if (args.images.length === 0) return []
  const dir = imagesDir(args.experimentId)
  ensureDir(dir)
  const out: string[] = []
  for (let i = 0; i < args.images.length; i++) {
    const img = args.images[i]
    const ext = extFor(img.mime_type)
    const filename = `${args.taskId}_${i}${ext}`
    const fullPath = path.join(dir, filename)

    let buf: Buffer
    if (img.url.startsWith('data:')) {
      const base64Match = /^data:[^;]+;base64,(.*)$/.exec(img.url)
      if (!base64Match) throw new Error(`saveImagesForTask: malformed data URL at index ${i}`)
      buf = Buffer.from(base64Match[1], 'base64')
    } else if (img.url.startsWith('http://') || img.url.startsWith('https://')) {
      const resp = await fetch(img.url)
      if (!resp.ok) throw new Error(`saveImagesForTask: HTTP ${resp.status} fetching ${img.url}`)
      buf = Buffer.from(await resp.arrayBuffer())
    } else {
      throw new Error(`saveImagesForTask: unsupported url scheme at index ${i}`)
    }

    await fs.writeFile(fullPath, buf)
    out.push(`/api/results/${args.experimentId}/images/${filename}`)
  }
  return out
}

/**
 * Assign saved image URLs to fields declared as image_url / image_url_list
 * in the output schema. Single image_url gets paths[0]; image_url_list gets
 * the full array. Multiple image_url fields each get one image (in declaration
 * order). Mutates a copy and returns it.
 */
export function assignImagePathsToOutput(
  output: Record<string, unknown>,
  schema: JsonSchemaDef,
  paths: string[],
): Record<string, unknown> {
  if (!schema.properties || paths.length === 0) return { ...output }
  const result: Record<string, unknown> = { ...output }
  let cursor = 0
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.type === 'image_url') {
      if (cursor < paths.length) {
        result[name] = paths[cursor]
        cursor++
      }
    } else if (prop.type === 'image_url_list') {
      result[name] = paths.slice(cursor)
      cursor = paths.length
    }
  }
  return result
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/lib/__tests__/image-store.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/image-store.ts src/lib/__tests__/image-store.test.ts
git commit -m "$(cat <<'EOF'
feat(image-store): saveImagesForTask + assignImagePathsToOutput

新模块 src/lib/image-store.ts，承担生图响应的落盘 + 路径回填：
- saveImagesForTask: data URL / HTTPS URL → data/results/{exp_id}/images/{task_id}_{idx}.{ext}
- assignImagePathsToOutput: 按 schema.properties 里 image_url / image_url_list
  字段顺序回填绝对 API URL ("/api/results/.../images/...")

返回绝对 API URL 而非相对路径，让 renderField 直接 <img src={value}> 不
需 expId 上下文。MIME → ext 映射对未知 mime 兜底 .png。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: API route for image binary

**Files:**
- Create: `src/app/api/results/[exp_id]/images/[filename]/route.ts`
- Test: `e2e/image-route.spec.ts` (e2e smoke)

- [ ] **Step 1: Implement the route**

Create `src/app/api/results/[exp_id]/images/[filename]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const EXP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const FILENAME_PATTERN = /^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exp_id: string; filename: string }> },
) {
  const { exp_id, filename } = await params
  if (!EXP_ID_PATTERN.test(exp_id)) {
    return new NextResponse('invalid exp_id', { status: 400 })
  }
  if (!FILENAME_PATTERN.test(filename)) {
    return new NextResponse('invalid filename', { status: 400 })
  }
  const fullPath = path.join(process.cwd(), 'data', 'results', exp_id, 'images', filename)
  // Defense in depth: ensure resolved path stays within imagesDir
  const expectedDir = path.join(process.cwd(), 'data', 'results', exp_id, 'images')
  const resolved = path.resolve(fullPath)
  if (!resolved.startsWith(path.resolve(expectedDir))) {
    return new NextResponse('forbidden', { status: 403 })
  }
  try {
    const buf = await fs.readFile(fullPath)
    const ext = filename.split('.').pop()!.toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    // Buffer → Uint8Array → BodyInit (Next.js 16 / Web APIs accept Uint8Array)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return new NextResponse('not found', { status: 404 })
    }
    return new NextResponse('error', { status: 500 })
  }
}
```

- [ ] **Step 2: Add e2e smoke test**

Create `e2e/image-route.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('image route returns 400 for invalid exp_id', async ({ request }) => {
  const res = await request.get('/api/results/..%2F..%2Fevil/images/x.png')
  expect(res.status()).toBe(400)
})

test('image route returns 400 for invalid filename', async ({ request }) => {
  const res = await request.get('/api/results/abc/images/no_extension')
  expect(res.status()).toBe(400)
})

test('image route returns 404 for missing file', async ({ request }) => {
  const res = await request.get('/api/results/nonexistent_exp_xyz/images/missing_0.png')
  expect(res.status()).toBe(404)
})
```

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e -- e2e/image-route.spec.ts`
Expected: all 3 tests pass.

If `npm run test:e2e` requires server to be running, the existing playwright config handles it (`webServer` in `playwright.config.ts` runs `npm run dev`).

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/results/ e2e/image-route.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/results/[exp_id]/images/[filename] for PNG binary

新 GET route 服务生图实验落盘的图像。双重 path traversal 防护：
- exp_id / filename 各走 regex 白名单
- path.resolve 校验解析后仍在 expectedDir 内

Cache-Control: public, max-age=31536000, immutable —— 文件名含 task_id
+ idx 内容稳定；retry 覆盖会写同名但极少见，先 aggressive cache。

E2E smoke 覆盖 400 / 404 三个边界。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Batch runner integrates image-store

**Files:**
- Modify: `src/lib/batch-runner.ts:230-305` (executeTask)

- [ ] **Step 1: Edit imports at top of batch-runner.ts**

Edit `src/lib/batch-runner.ts`. After the existing imports (around line 14), add:

```ts
import { saveImagesForTask, assignImagePathsToOutput } from './image-store'
```

- [ ] **Step 2: Modify success path of executeTask**

Edit `src/lib/batch-runner.ts` lines 274-296. Replace:

```ts
      const parsed = parseResponse(response.content, schema)
      if (!parsed.success) {
        return baseRecord({
          status: 'parse_error',
          error: parsed.error,
          raw_response: response.content,
          latency_ms: response.latency_ms,
          input_tokens,
          output_tokens,
          cost_value,
          cost_currency,
        })
      }

      return baseRecord({
        status: 'success',
        output: parsed.data,
        latency_ms: response.latency_ms,
        input_tokens,
        output_tokens,
        cost_value,
        cost_currency,
      })
```

with:

```ts
      const parsed = parseResponse(response.content, schema)
      if (!parsed.success) {
        return baseRecord({
          status: 'parse_error',
          error: parsed.error,
          raw_response: response.content,
          latency_ms: response.latency_ms,
          input_tokens,
          output_tokens,
          cost_value,
          cost_currency,
        })
      }

      // If LLM returned images (sankuai gemini-image-preview etc.), persist them
      // to data/results/{exp_id}/images/ and inject API URLs into output fields
      // declared as image_url / image_url_list.
      let finalOutput = parsed.data as Record<string, unknown>
      if (response.images && response.images.length > 0) {
        try {
          const savedPaths = await saveImagesForTask({
            experimentId: this.config.id,
            taskId: task.task_id,
            images: response.images,
          })
          finalOutput = assignImagePathsToOutput(finalOutput, schema.output_schema, savedPaths)
        } catch (imgErr) {
          const msg = imgErr instanceof Error ? imgErr.message : String(imgErr)
          return baseRecord({
            status: 'error',
            error: `image save failed: ${msg}`,
            raw_response: response.content,
            latency_ms: response.latency_ms,
            input_tokens,
            output_tokens,
            cost_value,
            cost_currency,
          })
        }
      }

      return baseRecord({
        status: 'success',
        output: finalOutput,
        latency_ms: response.latency_ms,
        input_tokens,
        output_tokens,
        cost_value,
        cost_currency,
      })
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run all unit tests for regressions**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/batch-runner.ts
git commit -m "$(cat <<'EOF'
feat(batch-runner): persist LlmResponse.images to disk + inject paths

executeTask 在 parseResponse 之后、写 result 之前，如果 response.images
非空就调 saveImagesForTask 落盘，并 assignImagePathsToOutput 把绝对 API
URL 回填到 schema 声明为 image_url / image_url_list 的 output 字段。

落盘失败转 status=error 返回，不破 result.jsonl 的完整性（用户看到红
卡 + 明确 image save failed: ... 错误）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ImageLightbox global Provider

**Files:**
- Create: `src/components/ui/image-lightbox.tsx`
- Modify: `src/app/layout.tsx:80` (mount inside CopilotStoreProvider)

- [ ] **Step 1: Implement Lightbox + Provider**

Create `src/components/ui/image-lightbox.tsx`:

```tsx
"use client"

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/provider"

interface LightboxContextValue {
  openLightbox: (src: string, alt?: string) => void
  closeLightbox: () => void
}

const LightboxContext = createContext<LightboxContextValue | null>(null)

export function useImageLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext)
  if (!ctx) {
    // Graceful no-op fallback: components outside Provider get a noop
    return {
      openLightbox: () => {},
      closeLightbox: () => {},
    }
  }
  return ctx
}

export function ImageLightboxProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [alt, setAlt] = useState<string>("")

  const openLightbox = useCallback((nextSrc: string, nextAlt = "") => {
    setSrc(nextSrc)
    setAlt(nextAlt)
    setOpen(true)
  }, [])

  const closeLightbox = useCallback(() => setOpen(false), [])

  // ESC handled by Dialog automatically; explicit listener for click-outside
  // (Dialog's overlay click already triggers onOpenChange).

  // Reset src after close transition so DOM doesn't keep big base64 in memory
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => setSrc(null), 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  return (
    <LightboxContext.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[min(95vw,1280px)] max-h-[95vh] p-2 overflow-hidden"
          aria-label={t("results.image_lightbox.title")}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              className="w-full h-auto max-h-[88vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </LightboxContext.Provider>
  )
}
```

- [ ] **Step 2: Mount Provider in RootLayout**

Edit `src/app/layout.tsx`. Add import (after line 17):

```ts
import { ImageLightboxProvider } from "@/components/ui/image-lightbox"
```

Wrap inside `CopilotStoreProvider` (currently lines 80-93). Replace:

```tsx
              <CopilotStoreProvider>
                <Sidebar />
                <main className="flex-1 h-screen flex flex-col overflow-hidden relative">
                  <GlowOverlay />
                  <MaterialRevealOverlay />
                  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
                </main>
                <CopilotPanel />
                <InspectorOverlay />
                <ContextMask />
                <TextSelector />
                <TextSelectionMask />
                <Toaster />
              </CopilotStoreProvider>
```

with:

```tsx
              <CopilotStoreProvider>
                <ImageLightboxProvider>
                  <Sidebar />
                  <main className="flex-1 h-screen flex flex-col overflow-hidden relative">
                    <GlowOverlay />
                    <MaterialRevealOverlay />
                    <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
                  </main>
                  <CopilotPanel />
                  <InspectorOverlay />
                  <ContextMask />
                  <TextSelector />
                  <TextSelectionMask />
                  <Toaster />
                </ImageLightboxProvider>
              </CopilotStoreProvider>
```

- [ ] **Step 3: Add i18n keys**

Edit `src/lib/i18n/zh.ts` — find a logical group near other `results.*` keys (e.g. after `results.annotate.*`). Add:

```ts
  "results.image_lightbox.title": "图像预览",
  "results.image_lightbox.close": "关闭",
```

Edit `src/lib/i18n/en.ts` (same line context):

```ts
  "results.image_lightbox.title": "Image preview",
  "results.image_lightbox.close": "Close",
```

- [ ] **Step 4: Type check + build smoke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev` (in background) and visit `http://localhost:3000/`. Confirm page loads without console errors.

If running in background: `npm run dev &` then `sleep 3 && curl -sf http://localhost:3000 | head -1` (expect HTML). Kill: `kill %1`. (Or use task tools to manage background process.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/image-lightbox.tsx src/app/layout.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "$(cat <<'EOF'
feat(ui): ImageLightboxProvider — global click-to-zoom for generated images

新 src/components/ui/image-lightbox.tsx，挂在 RootLayout 内。
- useImageLightbox() hook 暴露 openLightbox(src, alt) / closeLightbox
- 走 shadcn Dialog（GlassThick 玻璃自动适配）
- max-w 95vw / max-h 95vh, object-contain 留 padding
- ESC / overlay 点击关闭（Dialog 默认行为）
- 关闭后 300ms 清 src，避免 base64 长留内存

i18n 加 results.image_lightbox.title / close 两键。

Provider-外组件调 hook 走 noop fallback，不报错（边界场景兜底）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire renderField to Lightbox + prefer explicit type

**Files:**
- Modify: `src/components/results/output-structure.ts:27-40` (inferFieldRenderType)
- Modify: `src/components/results/view-helpers.tsx:54-71` (renderField)

- [ ] **Step 1: Modify inferFieldRenderType to prefer explicit type**

Edit `src/components/results/output-structure.ts` lines 27-40. Replace `inferFieldRenderType`:

```ts
/** 推断某个字段用什么 renderField type 展示 */
export function inferFieldRenderType(
  field: OutputField,
  sampleValue?: unknown,
): "text" | "image" | "badge" | "json" {
  // 显式 image 类型 → image（最高优先级）
  if (field.type === "image_url" || field.type === "image_url_list") return "image"
  // 名字启发式 → badge
  if (/tag|label|category|status/i.test(field.name)) return "badge"
  // URL 启发式 → image (fallback for legacy schemas without image_url type)
  if (typeof sampleValue === "string" && /^https?:\/\//.test(sampleValue) && /(url|image|pic|img|photo)/i.test(field.name)) {
    return "image"
  }
  // 非字符串/数字/布尔 → json
  if (field.type === "object" || field.type === "array" || field.type === "tuple:number[]") return "json"
  return "text"
}
```

- [ ] **Step 2: Modify renderField to support image_url_list arrays + Lightbox**

Edit `src/components/results/view-helpers.tsx`. Add import after line 4:

```tsx
import { useImageLightbox } from "@/components/ui/image-lightbox"
```

Replace `renderField` (lines 53-71):

```tsx
/** 渲染一个字段值为 React 节点，按 type 决定展示方式 */
export function renderField(value: unknown, type: string | undefined, maxLength?: number): React.ReactNode {
  if (value == null || value === "") return <span className="text-muted-foreground">-</span>
  switch (type) {
    case "image":
      // image_url_list → array of strings
      if (Array.isArray(value)) {
        const urls = value.filter((v): v is string => typeof v === "string" && v.length > 0)
        if (urls.length === 0) return <span className="text-muted-foreground">-</span>
        return (
          <div className="flex flex-wrap gap-1.5">
            {urls.map((u, i) => <ClickableImage key={i} src={u} />)}
          </div>
        )
      }
      // image_url → single string (URL, data URL, or relative)
      if (typeof value === "string" && (value.startsWith("http") || value.startsWith("data:") || value.startsWith("/api/"))) {
        return <ClickableImage src={value} />
      }
      // legacy: any other string falls through to muted text
      return <span className="text-muted-foreground">{formatValue(value, maxLength)}</span>
    case "badge":
      return <Badge variant="secondary" className="text-xs">{formatValue(value, maxLength)}</Badge>
    case "json":
      return <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    case "text":
    default:
      return <span className="text-sm">{formatValue(value, maxLength)}</span>
  }
}

function ClickableImage({ src, alt = "" }: { src: string; alt?: string }) {
  const { openLightbox } = useImageLightbox()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onClick={(e) => { e.stopPropagation(); openLightbox(src, alt) }}
      className="w-full h-full object-contain cursor-zoom-in rounded"
    />
  )
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run unit tests for regressions**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Manual smoke**

Start dev server: `npm run dev` (background). Visit any existing experiment detail page (e.g. `/experiments/<some_id>`). Confirm: text-output experiments still render normally (renderField text/json/badge cases unchanged). Kill server when done.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/output-structure.ts src/components/results/view-helpers.tsx
git commit -m "$(cat <<'EOF'
feat(results): renderField hooks Lightbox + supports image_url_list

inferFieldRenderType 优先走显式 type=image_url / image_url_list（不再
被字段名启发式抢路径）。老 schema 字段名启发式作为 fallback 保留。

renderField image case 拆出 <ClickableImage> 子组件：
- 单图（string）渲染单 <img>
- image_url_list（array of string）渲染 flex-wrap 的图墙
- 点击调 useImageLightbox().openLightbox(src) 进 Dialog 大图
- cursor-zoom-in 暗示可点击；e.stopPropagation 阻止冒泡到外层卡片

绝对 API URL / data URL / http URL 三种 src 走同一渲染路径。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Form-state + UI dropdown — new types selectable

**Files:**
- Modify: `src/components/template-builder/form-state.ts:14-22`
- Modify: `src/components/template-builder/template-form-page.tsx:52-60`
- Modify: `src/components/template-builder/template-form-parts.tsx:25-34`
- Modify: `src/lib/mock-data.ts:25-58`

- [ ] **Step 1: Extend FormOutputField type**

Edit `src/components/template-builder/form-state.ts` line 14-22:

```ts
export interface FormOutputField {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object" | "string|null" | "tuple:number[]" | "image_url" | "image_url_list"
  required: boolean
  max_length?: number
  min_length?: number
  tuple_len?: number
  enum_values: string[]                   // 空数组 = 无约束；非空则值必须在列表里
}
```

- [ ] **Step 2: Add to OUTPUT_TYPE_OPTIONS in template-form-page.tsx**

Edit `src/components/template-builder/template-form-page.tsx` lines 52-60:

```ts
const OUTPUT_TYPE_OPTIONS: FormOutputField["type"][] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "string|null",
  "tuple:number[]",
  "image_url",
  "image_url_list",
]
```

- [ ] **Step 3: Add to OUTPUT_TYPE_OPTIONS in template-form-parts.tsx**

Edit `src/components/template-builder/template-form-parts.tsx` lines 26-34:

```ts
const OUTPUT_TYPE_OPTIONS: FormOutputField["type"][] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "string|null",
  "tuple:number[]",
  "image_url",
  "image_url_list",
]
```

- [ ] **Step 4: Add mock-data cases**

Edit `src/lib/mock-data.ts` lines 25-58. Replace `mockValue`:

```ts
function mockValue(prop: JsonPropDef, seedKey: string): unknown {
  switch (prop.type) {
    case "string":
      // 给一些"看起来像那个字段会返回的内容"
      if (/tag|scene|label|category|status/i.test(seedKey)) return "示例标签"
      if (/url|image|pic/i.test(seedKey)) return "https://via.placeholder.com/200"
      return "示例文本内容"
    case "string|null":
      return "示例"
    case "number":
      return 0
    case "boolean":
      return true
    case "tuple:number[]":
      // 给不同位置的坐标避免全部重叠
      const hash = seedKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
      return [0.3 + (hash % 40) / 100, 0.3 + ((hash * 7) % 40) / 100]
    case "image_url":
      // Inline gray SVG placeholder so preview works without network
      return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23e5e7eb'/><text x='120' y='90' font-family='monospace' font-size='14' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image_url</text></svg>"
    case "image_url_list":
      return [
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23e5e7eb'/><text x='120' y='90' font-family='monospace' font-size='12' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image[0]</text></svg>",
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'><rect width='240' height='180' fill='%23d1d5db'/><text x='120' y='90' font-family='monospace' font-size='12' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>image[1]</text></svg>",
      ]
    case "object":
      if (prop.properties) {
        const nested: Record<string, unknown> = {}
        for (const [k, p] of Object.entries(prop.properties)) {
          nested[k] = mockValue(p, k)
        }
        return nested
      }
      return {}
    case "array":
      if (prop.items) {
        const item = prop.items as JsonPropDef
        const count = 3
        return Array.from({ length: count }, (_, i) => mockValue(item, `${seedKey}_${i}`))
      }
      return []
  }
}
```

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Manual smoke**

Start dev: `npm run dev` (background). Visit `/settings/templates/new`. In output fields section, verify the type dropdown lists `image_url` and `image_url_list` options. Pick one and check the preview panel on the right shows a gray SVG placeholder. Kill server.

- [ ] **Step 8: Commit**

```bash
git add src/components/template-builder/form-state.ts src/components/template-builder/template-form-page.tsx src/components/template-builder/template-form-parts.tsx src/lib/mock-data.ts
git commit -m "$(cat <<'EOF'
feat(template-builder): output type dropdown adds image_url + image_url_list

FormOutputField.type 加两枚；两个 OUTPUT_TYPE_OPTIONS 同步加（注释里
的「保持同步」约束）。

mock-data.ts 对 image_url / image_url_list 返回 inline SVG data URL
占位，让 /settings/templates/new 的右栏预览不依赖网络也能看到
"图片渲染"效果。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: RubricAnnotator — preview area for image + prompt

**Files:**
- Modify: `src/components/results/rubric-annotator.tsx:14-22, 30-46, 105-133`

**Goal:** Optional `result?: GenericResultRecord` and `schema?: TaskSchema` props. When both present and the schema declares any `image_url` / `image_url_list` field, render a preview row above the criteria form: prompt-side input + generated image (clickable → Lightbox).

- [ ] **Step 1: Extend Props + add Preview component**

Edit `src/components/results/rubric-annotator.tsx`:

Replace import block (lines 1-13):

```tsx
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"
import type { Annotation, Criterion, Rubric, GenericResultRecord, TaskSchema, JsonPropDef } from "@/lib/schema/types"
import { toast } from "sonner"
import { CheckIcon, XIcon } from "lucide-react"
import { renderField, readField } from "./view-helpers"
import { getOutputFields } from "./output-structure"
```

Replace `Props` interface (around lines 15-22):

```tsx
interface Props {
  experimentId: string
  taskId: string
  rubric: Rubric
  existing?: Annotation | null
  onSaved?: (a: Annotation) => void
  triggerClassName?: string
  /** Optional result + schema for inline preview (esp. image generation rubrics) */
  result?: GenericResultRecord
  schema?: TaskSchema
}
```

Replace component signature (around line 30):

```tsx
export function RubricAnnotator({ experimentId, taskId, rubric, existing, onSaved, triggerClassName, result, schema }: Props) {
```

Inside `DialogContent` (around lines 106-125), insert a `<ResultPreview>` block between `DialogHeader` and the criteria scroll container. Replace the existing block:

```tsx
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("results.annotate.dialog_title")}</DialogTitle>
            <p className="text-xs text-muted-foreground">{rubric.name}</p>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-auto pr-2">
            {rubric.criteria.map(c => (
```

with (note: bumped max-w-lg → max-w-2xl to fit preview comfortably):

```tsx
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("results.annotate.dialog_title")}</DialogTitle>
            <p className="text-xs text-muted-foreground">{rubric.name}</p>
          </DialogHeader>
          {result && schema && hasImageOutput(schema) && (
            <ResultPreview result={result} schema={schema} t={t} />
          )}
          <div className="space-y-4 py-2 max-h-[55vh] overflow-auto pr-2">
            {rubric.criteria.map(c => (
```

Add helper functions at the bottom of the file (after `summarizeScores` function):

```tsx
function hasImageOutput(schema: TaskSchema): boolean {
  const fields = getOutputFields(schema.output_schema)
  return fields.some(f => f.type === "image_url" || f.type === "image_url_list")
}

function ResultPreview({
  result,
  schema,
  t,
}: {
  result: GenericResultRecord
  schema: TaskSchema
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  const fields = getOutputFields(schema.output_schema)
  const imageFields = fields.filter(f => f.type === "image_url" || f.type === "image_url_list")
  const inputPreviewKeys = Object.keys(result.input_preview)

  return (
    <div className="grid grid-cols-2 gap-3 py-2 border-y border-border/50">
      {/* Left: input preview (key fields) */}
      <div className="space-y-1.5 text-xs overflow-auto max-h-[30vh]">
        <div className="text-muted-foreground font-medium">{t("results.annotate.preview_input")}</div>
        {inputPreviewKeys.length === 0 ? (
          <div className="text-muted-foreground italic">-</div>
        ) : (
          inputPreviewKeys.map(k => (
            <div key={k} className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground font-mono">{k}</div>
              <div className="text-foreground break-words">{String(result.input_preview[k] ?? "")}</div>
            </div>
          ))
        )}
      </div>
      {/* Right: image output(s) */}
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">{t("results.annotate.preview_image")}</div>
        {imageFields.map(f => {
          const value = readField(result, `output.${f.name}`)
          if (value == null || value === "") return (
            <div key={f.name} className="text-xs text-muted-foreground italic">-</div>
          )
          return (
            <div key={f.name} className="max-h-[30vh] overflow-hidden rounded">
              {renderField(value, "image")}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add i18n keys**

Edit `src/lib/i18n/zh.ts` (near other `results.annotate.*` keys):

```ts
  "results.annotate.preview_input": "原输入",
  "results.annotate.preview_image": "生成图像",
```

Edit `src/lib/i18n/en.ts`:

```ts
  "results.annotate.preview_input": "Input",
  "results.annotate.preview_image": "Generated image",
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: all green (RubricAnnotator is UI, no unit tests directly cover it; existing rubric-related pure-function tests untouched).

- [ ] **Step 5: Find existing call sites and pass new props (best-effort)**

Run: `grep -rn "RubricAnnotator" src/ --include="*.tsx"`
Expected: 1-2 call sites in experiment detail / scoring components.

For each call site, pass `result={r}` and `schema={schema}` if those values are in scope. The props are optional, so call sites that don't pass them keep working unchanged. Example update — find the call site (likely in `src/app/experiments/[id]/page.tsx` or a child component) and add the props:

```tsx
// before:
<RubricAnnotator experimentId={id} taskId={r.task_id} rubric={rubric} existing={existing} onSaved={...} />
// after:
<RubricAnnotator experimentId={id} taskId={r.task_id} rubric={rubric} existing={existing} onSaved={...} result={r} schema={schema} />
```

If the call site doesn't already have schema in scope, fetch via `getSchema(r.schema_id)` from `@/lib/schema` (server-side) or accept that legacy call sites just don't get preview (acceptable v1 fallback).

- [ ] **Step 6: Commit**

```bash
git add src/components/results/rubric-annotator.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts src/app/experiments/
git commit -m "$(cat <<'EOF'
feat(rubric): RubricAnnotator inline preview for image-output schemas

加可选 result?: GenericResultRecord + schema?: TaskSchema props，schema
里声明了 image_url / image_url_list 字段时弹窗在 criteria 表单上方插入
两栏 preview：原 input 字段 / 生成图。图借 renderField "image" 走
ClickableImage → Lightbox。

Dialog max-w 从 lg 拓宽到 2xl 容下预览。已有调用点（experiment detail
页评分入口）传新 props；其他位置保持不传，preview 不渲染、行为不变。

i18n 加 results.annotate.preview_input / preview_image。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Seed dataset — image_prompts_v1

**Files:**
- Create: `src/lib/seeds/image_prompts_v1.meta.json`
- Create: `src/lib/seeds/image_prompts_v1.jsonl`

- [ ] **Step 1: Create meta.json**

Create `src/lib/seeds/image_prompts_v1.meta.json`:

```json
{
  "id": "image_prompts_v1",
  "name": "Image Gen Prompts v1",
  "description": "20 starter prompts across 5 categories (portrait / landscape / object / abstract / composition). Use as a baseline for image generation eval. Edit freely; seed restores only if you delete the file.",
  "source": "builtin",
  "id_field": "prompt_id",
  "fields": [
    { "key": "prompt_id", "type": "string", "label": "Prompt ID" },
    { "key": "prompt", "type": "string", "label": "Prompt" },
    { "key": "category", "type": "string", "label": "Category" },
    { "key": "notes", "type": "string", "label": "Notes" }
  ]
}
```

- [ ] **Step 2: Create jsonl with 20 prompts**

Create `src/lib/seeds/image_prompts_v1.jsonl`:

```jsonl
{"prompt_id":"p001","prompt":"A photorealistic portrait of an elderly fisherman at sunset, golden hour, weathered face","category":"portrait","notes":"natural lighting"}
{"prompt_id":"p002","prompt":"Anime-style portrait of a young scholar with round glasses studying by candlelight","category":"portrait","notes":"stylized"}
{"prompt_id":"p003","prompt":"中年咖啡师在木质吧台后冲泡手冲咖啡，蒸汽缭绕，柔和灯光","category":"portrait","notes":"中文 prompt"}
{"prompt_id":"p004","prompt":"Black and white film photograph of a child laughing while running through autumn leaves","category":"portrait","notes":"monochrome"}
{"prompt_id":"p005","prompt":"A medieval fantasy dragon coiled around an erupting volcano at dusk","category":"landscape","notes":"dramatic"}
{"prompt_id":"p006","prompt":"Misty bamboo forest in early morning, sunlight filtering through dense leaves","category":"landscape","notes":"atmospheric"}
{"prompt_id":"p007","prompt":"Cyberpunk Tokyo street at night with neon signs and rain-slick pavement","category":"landscape","notes":"genre"}
{"prompt_id":"p008","prompt":"敦煌壁画风格的飞天，淡彩，矿物颜料质感","category":"landscape","notes":"中文 + 艺术风格"}
{"prompt_id":"p009","prompt":"A vintage brass pocket watch open on a wooden desk beside a leather notebook","category":"object","notes":"still life"}
{"prompt_id":"p010","prompt":"Macro photograph of a single dandelion seed against a black background","category":"object","notes":"macro detail"}
{"prompt_id":"p011","prompt":"Origami crane folded from a sheet of marbled paper, soft studio lighting","category":"object","notes":"craft"}
{"prompt_id":"p012","prompt":"一杯热抹茶在黑色釉面陶碗里，俯视构图，竹制茶筅放在一旁","category":"object","notes":"中文俯拍"}
{"prompt_id":"p013","prompt":"Abstract composition of flowing turquoise and gold liquid forms, fluid art","category":"abstract","notes":"non-representational"}
{"prompt_id":"p014","prompt":"Geometric pattern inspired by Islamic tile work, tessellating stars in deep blue and brass","category":"abstract","notes":"pattern"}
{"prompt_id":"p015","prompt":"Sound visualization of a piano chord rendered as colored particles in 3D space","category":"abstract","notes":"synesthesia"}
{"prompt_id":"p016","prompt":"Generative art: organic branching structure resembling lungs and trees combined","category":"abstract","notes":"hybrid metaphor"}
{"prompt_id":"p017","prompt":"A scientist examining a glowing specimen in a moonlit laboratory, oil painting style","category":"composition","notes":"narrative + style"}
{"prompt_id":"p018","prompt":"Three children flying paper kites of different colors over a sunset wheat field","category":"composition","notes":"multi-subject"}
{"prompt_id":"p019","prompt":"南宋山水画风格：远山、溪流、独钓的渔翁，构图有 negative space","category":"composition","notes":"中英混合 + 国画"}
{"prompt_id":"p020","prompt":"A bookshop interior with floor-to-ceiling shelves, a sleeping cat on a stack of books, warm afternoon light","category":"composition","notes":"detail-rich scene"}
```

- [ ] **Step 3: Verify JSONL parseability**

Run: `cat src/lib/seeds/image_prompts_v1.jsonl | wc -l`
Expected: `20`.

Run: `node -e "const fs=require('fs'); fs.readFileSync('src/lib/seeds/image_prompts_v1.jsonl','utf8').split('\n').filter(Boolean).forEach((line,i)=>{ try { JSON.parse(line) } catch(e){ console.error('line',i+1,e.message); process.exit(1) }}); console.log('all 20 valid JSON')"`
Expected: `all 20 valid JSON`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/seeds/image_prompts_v1.meta.json src/lib/seeds/image_prompts_v1.jsonl
git commit -m "$(cat <<'EOF'
feat(seeds): image_prompts_v1 dataset — 20 starter prompts

Seed 数据集：5 类别（portrait / landscape / object / abstract /
composition）各 4 条，中英混合，无品牌 / 真人版权风险。每条带
category 标签便于 display_dimensions 分组展示。

注册到 seed.ts 在 Task 13。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Seed schema — image_gen_v1

**Files:**
- Create: `src/lib/seeds/image_gen_v1.schema.json`

- [ ] **Step 1: Create schema**

Create `src/lib/seeds/image_gen_v1.schema.json`:

```json
{
  "id": "image_gen_v1",
  "label": "Image Generation v1",
  "description": "Pass dataset prompts to an image generation model and persist the generated PNG to disk. Pair with image_quality_v1 rubric for HEIM-style critique.",
  "version": 1,
  "compare_group": "image_gen",
  "inputs": [
    {
      "alias": "item",
      "dataset_id": "image_prompts_v1",
      "filters": [
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "Category",
          "options": [
            { "value": "portrait", "label": "Portrait" },
            { "value": "landscape", "label": "Landscape" },
            { "value": "object", "label": "Object" },
            { "value": "abstract", "label": "Abstract" },
            { "value": "composition", "label": "Composition" }
          ],
          "defaultValue": ["portrait", "landscape", "object", "abstract", "composition"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [
    { "name": "prompt", "source": "item.prompt" }
  ],
  "default_prompt": "{{prompt}}",
  "message_builder": {
    "user_template": "{{prompt}}"
  },
  "output_schema": {
    "type": "object",
    "required": ["image_url"],
    "properties": {
      "caption": { "type": "string", "max_length": 500 },
      "image_url": { "type": "image_url" }
    }
  },
  "display_dimensions": [
    {
      "field": "input_refs.item",
      "label": "Prompt",
      "header_fields": [
        { "field": "input_preview.item.prompt", "label": "Prompt" },
        { "field": "input_preview.item.category", "label": "Category" }
      ]
    }
  ],
  "raw_text_output": false
}
```

- [ ] **Step 2: Verify JSON parseability**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/lib/seeds/image_gen_v1.schema.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/seeds/image_gen_v1.schema.json
git commit -m "$(cat <<'EOF'
feat(seeds): image_gen_v1 TaskSchema

Seed 评测任务：透传 image_prompts_v1 数据集的 prompt 给生图模型，
output 声明为 { caption?: string, image_url: image_url }。

display_dimensions = 1 → 推断 builtin_single_list（每条 prompt 一行
header + 生成图）。compare_group="image_gen" 让多模型实验跨实验对比。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Seed rubric — image_quality_v1 (HEIM 5)

**Files:**
- Create: `src/lib/seeds/image_quality_v1.rubric.json`

- [ ] **Step 1: Create rubric**

Create `src/lib/seeds/image_quality_v1.rubric.json`:

```json
{
  "id": "image_quality_v1",
  "name": "Image Quality v1 (HEIM-adapted)",
  "description": "Image generation quality rubric adapted from Stanford HEIM ImageCritiqueMetric. 5 criteria covering alignment, subject clarity, aesthetic, originality, and safety.",
  "source": "builtin",
  "criteria": [
    {
      "key": "alignment",
      "label": "Alignment · 对齐度",
      "type": "likert_1_5",
      "description": "How well does the image match the prompt? · 图像与描述匹配程度 (1=mismatch, 5=perfect match)",
      "required": true
    },
    {
      "key": "subject_clarity",
      "label": "Subject Clarity · 主体清晰度",
      "type": "likert_1_5",
      "description": "Is the main subject clear and well-formed? · 主体是否清晰、结构完整 (1=blurry/distorted, 5=very clear)"
    },
    {
      "key": "aesthetic",
      "label": "Aesthetic · 美观度",
      "type": "likert_1_5",
      "description": "Composition, color, overall visual appeal · 构图、色彩、整体观感 (1=poor, 5=excellent)"
    },
    {
      "key": "originality",
      "label": "Originality · 原创性",
      "type": "likert_1_5",
      "description": "Is the image distinctive vs. generic stock-image patterns? · 相比常见图库和模板是否独特"
    },
    {
      "key": "safety",
      "label": "Safety · 安全",
      "type": "pass_fail",
      "description": "Free of unsafe content (violence / sexual / hate symbols). Pass = safe · 是否包含不安全内容",
      "required": true
    }
  ]
}
```

- [ ] **Step 2: Verify JSON parseability**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/lib/seeds/image_quality_v1.rubric.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/seeds/image_quality_v1.rubric.json
git commit -m "$(cat <<'EOF'
feat(seeds): image_quality_v1 Rubric — HEIM 5 题改编

5 criterion 基于 Stanford HEIM ImageCritiqueMetric 经典 5 题：
- alignment (likert_1_5, required)
- subject_clarity (likert_1_5)
- aesthetic (likert_1_5)
- originality (likert_1_5)
- safety (pass_fail, required)

每条 description 中英双语并置，方便用户理解每档分值锚点。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Register seeds + verify ensure-seeds works

**Files:**
- Modify: `src/lib/seed.ts:31-33, 50, 62`
- Test: ensureSeeds smoke (manual)

- [ ] **Step 1: Register the three new seed IDs**

Edit `src/lib/seed.ts`:

Replace lines 29-46 (`seedDatasets`):

```ts
function seedDatasets() {
  ensureDir(datasetsDir())
  const datasets = [
    { id: 'qa_pairs', meta: 'qa_pairs.meta.json', jsonl: 'qa_pairs.jsonl' },
    { id: 'image_prompts_v1', meta: 'image_prompts_v1.meta.json', jsonl: 'image_prompts_v1.jsonl' },
  ]
  for (const ds of datasets) {
    const metaDst = path.join(datasetsDir(), `${ds.id}.meta.json`)
    const jsonlDst = path.join(datasetsDir(), `${ds.id}.jsonl`)
    if (!fs.existsSync(metaDst)) {
      const metaSrc = path.join(seedsDir(), ds.meta)
      if (fs.existsSync(metaSrc)) fs.copyFileSync(metaSrc, metaDst)
    }
    if (!fs.existsSync(jsonlDst)) {
      const jsonlSrc = path.join(seedsDir(), ds.jsonl)
      if (fs.existsSync(jsonlSrc)) fs.copyFileSync(jsonlSrc, jsonlDst)
    }
  }
}
```

Replace line 50 (`schemas` array inside `seedSchemas`):

```ts
  const schemas = ['qa_answer_v1', 'image_gen_v1']
```

Replace line 62 (`rubrics` array inside `seedRubrics`):

```ts
  const rubrics = ['qa_accuracy', 'image_quality_v1']
```

- [ ] **Step 2: Manual smoke — clear and re-seed**

Run:

```bash
# Move any existing image seeds aside (don't delete user data)
mkdir -p /tmp/evalyst-seed-test
mv data/datasets/image_prompts_v1.* data/schemas/image_gen_v1.json data/rubrics/image_quality_v1.json /tmp/evalyst-seed-test/ 2>/dev/null || true

# Trigger ensureSeeds via npm dev briefly
npm run dev > /tmp/evalyst-dev.log 2>&1 &
DEV_PID=$!
sleep 4
curl -sf http://localhost:3000/api/datasets > /dev/null
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null

# Verify all three seeded
ls data/datasets/image_prompts_v1.{meta.json,jsonl} data/schemas/image_gen_v1.json data/rubrics/image_quality_v1.json
```

Expected: all 4 paths exist.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seed.ts
git commit -m "$(cat <<'EOF'
feat(seed): register image_prompts_v1 / image_gen_v1 / image_quality_v1

ensureSeeds 三个数组各加一条对应文件。同 qa_* 三件套 pattern：
fileNotExists → copyFile，幂等、用户删了下次 list 时自动恢复、
编辑了不覆盖。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Meta-prompt + Skill docs

**Files:**
- Modify: `src/lib/meta-prompts/template.ts:83-94` (output_schema doc)
- Modify: `.claude/skills/evalyst/SKILL.md` (add image-gen section)
- Modify: `.claude/skills/evalyst-task/SKILL.md` (add image_url type)

- [ ] **Step 1: Update template meta-prompt**

Edit `src/lib/meta-prompts/template.ts`. Find the `## output_schema` section (around line 83). Replace it:

```ts
## output_schema

\`\`\`json
{
  "type": "object",
  "required": ["answer", "confidence"],
  "properties": {
    "answer": { "type": "string" },
    "confidence": { "type": "number", "enum": [1, 2, 3, 4, 5] }
  }
}
\`\`\`

支持的 type: \`string\` / \`number\` / \`boolean\` / \`array\` / \`object\` / \`string|null\` / \`tuple:number[]\` / \`image_url\` / \`image_url_list\`

**\`image_url\` / \`image_url_list\`**：用于生图评测。模型返回的 base64 data URL 会被 batch-runner 自动落盘到 \`data/results/{exp_id}/images/\`，JSONL 里只存绝对 API URL（\`/api/results/{exp_id}/images/...\`）。

\`\`\`json
{
  "type": "object",
  "required": ["image_url"],
  "properties": {
    "caption": { "type": "string" },
    "image_url": { "type": "image_url" }
  }
}
\`\`\`
```

- [ ] **Step 2: Update evalyst skill doc**

Edit `.claude/skills/evalyst/SKILL.md`. Find a logical place to add a new section (e.g. after the section explaining experiment runs / before troubleshooting, near the end). Look for an appropriate anchor with:

Run: `grep -n "^## " .claude/skills/evalyst/SKILL.md | head -10`

Add the following section in a sensible location:

```md
## 生图评测 (Image Generation)

evalyst v1 支持 text-in / image-out 的生图模型评测。最短路径：

1. **配模型**：`/settings/llm` 加生图模型，`api_format=openai`（OpenAI-兼容生图 gateway 都行）
   - 例：sankuai `https://aigc.sankuai.com/v1/openai/native` + 模型 `gemini-3.1-flash-image-preview`
   - api_key 填 `Bearer <token>`（gateway 通常要 Bearer）
2. **建实验**：Dashboard → New experiment → 选这个模型 + 选内置 `image_gen_v1` schema
   - 可选：绑定 `image_quality_v1` rubric 走 HEIM 5 题打分
3. **Run**：图自动落盘到 `data/results/{exp_id}/images/`，JSONL 里 `output.image_url` 是绝对 API URL
4. **看图 / 打分**：详情页一行一条 prompt，图可点击放大（Lightbox）；rubric 打分弹窗里同时显示 prompt 和图
5. **跨模型对比**：跑第二个实验换模型 → /compare 自动按 `compare_group="image_gen"` 把两实验的同 prompt 图并排

定制：复制 `image_gen_v1.schema.json` 改 prompt template / 加变量；output 声明 `type: "image_url"` 的字段就走生图路径（batch-runner 自动落盘）。

**已知限制（v1）**：
- VLM-as-judge 自动评分还没做（v2）
- compare cell 宽度仍是 220-400px，看大图走 Lightbox
- LLM 自带 thinking_config 等 extra_body 现在不暴露给 ModelConfig；如果你要传，编辑 `data/experiments/{id}.json` 直接改 `api_config.extra_body`
```

- [ ] **Step 3: Update evalyst-task skill doc**

Edit `.claude/skills/evalyst-task/SKILL.md`. Find the `output_schema` section. Add after the existing types list:

```md
### Image Output Types

- `image_url` — single image URL (string). Use when the model returns one image.
- `image_url_list` — array of image URLs (string[]). Use when the model returns multiple images per call.

evalyst's batch-runner detects `data:image/...;base64,...` payloads in OpenAI-compatible `choices[0].message.images[]` responses, decodes them, and persists each as PNG/JPG to `data/results/{exp_id}/images/{task_id}_{idx}.{ext}`. The `output.image_url` field in JSONL stores the absolute API URL (e.g. `/api/results/abc/images/xyz_0.png`), which the UI uses directly as `<img src>`.

Example schema:

```json
{
  "output_schema": {
    "type": "object",
    "required": ["image_url"],
    "properties": {
      "caption": { "type": "string" },
      "image_url": { "type": "image_url" }
    }
  }
}
```
```

- [ ] **Step 4: Verify skill download endpoint still works**

Run:

```bash
npm run dev > /tmp/evalyst-dev.log 2>&1 &
DEV_PID=$!
sleep 4
curl -sf http://localhost:3000/api/skills/evalyst | head -20
curl -sf http://localhost:3000/api/skills/evalyst-task | head -20
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Expected: both return markdown content (no 404 / 500).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta-prompts/template.ts .claude/skills/evalyst/SKILL.md .claude/skills/evalyst-task/SKILL.md
git commit -m "$(cat <<'EOF'
docs(skills): document image_url types + image-gen workflow

- meta-prompts/template.ts: 类型列表加 image_url / image_url_list，附
  生图 schema 示例
- evalyst/SKILL.md: 新增「生图评测」章节，端到端 5 步走通 (含
  sankuai gateway 实例)
- evalyst-task/SKILL.md: 新增 Image Output Types 段，说明
  base64 → PNG → API URL 自动落盘机制

让 agent 通过 SKILL.md 就能自驱地为生图评测建模、跑实验、读结果。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Manual sankuai gateway test harness

**Files:**
- Create: `scripts/test-sankuai-image.sh`
- Modify: `.gitignore` (ensure scripts/test-*.sh excluded)

- [ ] **Step 1: Add gitignore rule**

Run: `grep -q "scripts/test-" .gitignore || echo "scripts/test-*.sh" >> .gitignore`

Then verify:

```bash
grep "scripts/test-" .gitignore
```

Expected: contains `scripts/test-*.sh`.

- [ ] **Step 2: Create test harness**

Create `scripts/test-sankuai-image.sh`:

```bash
#!/bin/bash
# Manual harness — verify sankuai gateway response shape before relying on
# parseResponse. Run locally with $SANKUAI_TOKEN exported.
# This script is gitignored (scripts/test-*.sh).

set -euo pipefail

TOKEN="${SANKUAI_TOKEN:?Set SANKUAI_TOKEN env var to your gateway token}"

curl -sS --location 'https://aigc.sankuai.com/v1/openai/native/chat/completions' \
  --header "Authorization: Bearer $TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "stream": false,
    "model": "gemini-3.1-flash-image-preview",
    "messages": [
      { "role": "user", "content": "Generate a simple test image: a red apple on a white background." }
    ]
  }' | jq '{
    has_images: (.choices[0].message.images | type == "array"),
    images_len: (.choices[0].message.images | length),
    first_url_prefix: (.choices[0].message.images[0].image_url.url[0:60]? // .choices[0].message.images[0].url[0:60]?),
    content_text: .choices[0].message.content,
    raw_keys: (.choices[0].message | keys)
  }'
```

Make executable:

```bash
chmod +x scripts/test-sankuai-image.sh
```

- [ ] **Step 3: Run it (manual prerequisite)**

```bash
export SANKUAI_TOKEN="<your token>"
./scripts/test-sankuai-image.sh
```

Expected output approximately:

```json
{
  "has_images": true,
  "images_len": 1,
  "first_url_prefix": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA",
  "content_text": "Here's a simple test image of a red apple...",
  "raw_keys": ["role", "content", "images"]
}
```

If `has_images: false` or `raw_keys` shows the image data is somewhere unexpected (e.g. nested in `content` array as multimodal blocks), STOP and adjust `parseResponse` in Task 2's implementation accordingly. Document the actual response shape in this task's commit message before proceeding.

- [ ] **Step 4: Commit (gitignore only)**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore: gitignore scripts/test-*.sh manual harness scripts

让本地放 sankuai gateway / 其他外部 API 的实测脚本不会被 git tracked。
当前唯一脚本 scripts/test-sankuai-image.sh 验证 gemini-3.1-flash-image-preview
响应 shape，结果与 parseResponse 假设一致。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Manual end-to-end smoke (real LLM)

**Files:** none (operational task)

This task is mandatory before declaring v1 done. It validates the entire stack against a real sankuai gateway response.

- [ ] **Step 1: Configure gateway in /settings/llm**

```bash
npm run dev > /tmp/evalyst-dev.log 2>&1 &
DEV_PID=$!
sleep 4
```

Open browser → `http://localhost:3000/settings/llm` → Add model:
- `name`: Sankuai Gemini Image Preview
- `model`: gemini-3.1-flash-image-preview
- `api_format`: openai
- `base_url`: https://aigc.sankuai.com/v1/openai/native
- `api_key`: Bearer <your token>

Save. Click Test → expect connection OK (or graceful error if gateway is finicky for plain "hello").

- [ ] **Step 2: Run image_gen_v1 experiment**

Dashboard → New experiment:
- Schema: `image_gen_v1`
- Model: Sankuai Gemini Image Preview
- Rubric: `image_quality_v1`
- Filter: limit=2 (just 2 prompts to keep iteration fast)

Click Start. Wait. Expected: progress bar reaches 2/2 success.

- [ ] **Step 3: Verify image files on disk**

```bash
ls data/results/<exp_id>/images/
```

Expected: 2 files matching `<task_id>_0.png` (or `.jpg`).

- [ ] **Step 4: Verify detail page renders**

Navigate to `/experiments/<exp_id>`. Expected:
- Two rows, each with prompt header and a generated image
- Click image → Lightbox opens with full-size image
- Press ESC → Lightbox closes

- [ ] **Step 5: Verify rubric annotator**

Click the score button on a result. Expected:
- Dialog opens (max-w-2xl)
- Top: 2-column preview — prompt on left, generated image on right
- Click image inside dialog → Lightbox opens (nested OK)
- Below: 5 criteria form
- Pick scores: alignment 4 / subject_clarity 5 / aesthetic 4 / originality 3 / safety pass
- Save → toast "评分已保存"
- Reopen → existing scores prefilled

- [ ] **Step 6: Verify cross-experiment compare**

Run a second experiment with a different config (e.g., the same schema + a different model, or just rerun for noise). Then `/compare?exp_ids=<id1>,<id2>` (or use the compare UI). Expected: row × col grid where each cell shows that model's image for that prompt; click cell image → Lightbox.

- [ ] **Step 7: Verify regression — old QA experiment still works**

Visit any existing pre-v1 QA experiment. Expected: text output renders normally, no console errors, no UI regressions.

- [ ] **Step 8: Kill dev server**

```bash
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 9: Commit (no code, just acceptance signal)**

(No commit unless any micro-fix surfaces during smoke. Note any tweaks in their own commit.)

---

## Task 17: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section)

- [ ] **Step 1: Add entry under [Unreleased]**

Edit `CHANGELOG.md`. Find `## [Unreleased]`. Add an entry below any existing Unreleased content (in date-newest-on-top order):

```md
### 体验

- **生图（Image Generation）评测 v1 完备支持** — text-in / image-out 评测端到端。
  - LLM client：扩 `LlmResponse.images?`，`parseResponse` OpenAI 分支提取
    `choices[0].message.images[]`（OpenRouter / sankuai 等 gateway 约定的
    非标字段）。请求侧零改动（沿用 `api_format='openai'`）
  - 图像存储：data URL 解码 → `data/results/{exp_id}/images/{task_id}_{idx}.{ext}`，
    JSONL 里只存绝对 API URL `/api/results/{exp_id}/images/...`
  - Schema：`JsonFieldType` 加 `image_url` / `image_url_list`，validate 跟上
  - UI：全局 `ImageLightboxProvider` 挂 RootLayout；`renderField` image case
    走 `<ClickableImage>` → 点击进 Lightbox；RubricAnnotator 弹窗 image 类
    schema 自动展示双栏 preview
  - 三件套 seed：`image_prompts_v1` 数据集（20 prompt × 5 类别）+
    `image_gen_v1` schema + `image_quality_v1` rubric（HEIM 5 题改编）
  - Skill 文档：`evalyst` + `evalyst-task` 加生图章节
  - 验证：sankuai `gemini-3.1-flash-image-preview` 实跑通，5 单测组 +
    1 e2e smoke

- Spec: `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-image-generation-eval.md`
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs(changelog): image generation eval v1 entry under [Unreleased]

记录本次 v1 完备支持的范围 (LLM client / 存储 / schema / UI / seeds /
skill)；spec + plan 引用。等下次 tag 时再 promote 到具体版本号。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final verification + PR

**Files:** none (verification + PR)

- [ ] **Step 1: Full type check + tests + build**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm test
```

Expected: all green (existing 221 + ~14 new test cases).

```bash
npm run build
```

Expected: build succeeds, no warnings about missing routes / pages.

```bash
npm run test:e2e
```

Expected: existing e2e + 3 new image-route cases all green.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/image-gen-eval
```

Then:

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat: image generation eval v1 — sankuai gemini-3.1-flash-image-preview compatible" --body "$(cat <<'EOF'
## Summary

- **改了什么**: v1 manual image-generation eval pipeline. LLM client extracts `choices[0].message.images[]` from OpenAI-compatible image-gen gateways; batch-runner persists base64 PNGs to `data/results/{exp_id}/images/`; new `image_url` / `image_url_list` schema types; global ImageLightbox; HEIM 5-criterion seed rubric + matching dataset/schema seed; skill docs.
- **为什么**: evalyst was text-in/text-out only. Validated against sankuai `gemini-3.1-flash-image-preview` gateway. OSS调研借鉴 HEIM 5-题 critique 文案 + filesystem path storage convention.
- **怎么验证**: 5 unit test groups (parse-images / image-store / validate.image), 1 e2e route smoke (400/404), manual end-to-end with real sankuai gateway covering: model config, run, image render, click-to-Lightbox, rubric annotator with preview, cross-experiment compare. Spec §16 acceptance checklist passes.
- **向后兼容**: zero impact on existing QA / VL experiments. New `JsonFieldType` enum values are additive; `LlmResponse.images?` is optional; `RubricAnnotator` new props are optional; `inferFieldRenderType` legacy field-name heuristic preserved as fallback.

Spec: `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`
Plan: `docs/superpowers/plans/2026-05-08-image-generation-eval.md`

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npm test` all green (5 new test groups)
- [x] `npm run build` succeeds
- [x] `npm run test:e2e` all green (3 new image-route cases)
- [x] Manual: configure sankuai gateway → run image_gen_v1 → view → score → compare
- [x] Manual: regression — pre-v1 QA experiment still works
- [x] Manual: ensureSeeds restores all 3 new seed files after delete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Verify CI passes**

Visit PR URL. Wait for CI (verify + e2e). Expected: green.

If CI fails, fix locally → push → wait → repeat.

- [ ] **Step 4: Final task closure**

Mark this plan as ready for merge. Tag will be applied separately after merge + manual cooling-off period (per CLAUDE.md tag conventions).

---

## Summary of Test Coverage

| Layer | Test type | Path |
|---|---|---|
| Schema validate | unit | `src/lib/schema/__tests__/validate.image.test.ts` (9 cases) |
| LLM client parseResponse | unit | `src/lib/__tests__/llm-client.parse-images.test.ts` (5 cases) |
| Image store fs operations | unit | `src/lib/__tests__/image-store.test.ts` (8 cases) |
| API route guards | e2e | `e2e/image-route.spec.ts` (3 cases) |
| End-to-end | manual | Task 16 (8 sub-steps with real gateway) |
| Regression | manual | Task 16 step 7 (pre-v1 QA experiment) |

UI components (`ImageLightbox`, `ClickableImage`, `RubricAnnotator` Preview) intentionally have no unit tests — consistent with project's "only test pure functions" rule (CLAUDE.md / AGENTS.md).
