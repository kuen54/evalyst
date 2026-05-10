# 生图（Image Generation）评测完备支持 · 设计规范

**Date**: 2026-05-08
**Status**: Design approved (brainstorm), ready for implementation plan
**Scope**: v1 手动评测全链路 —— LLM client 响应解析 + 图像落盘 + schema `image_url`/`image_url_list` 类型 + ImageLightbox UI + HEIM 5 题 seed rubric + RubricAnnotator 渲染优化 + seed 三件套（prompt dataset / 生图 schema / quality rubric）+ skill 文档
**Out of scope (v2)**: VLM-as-judge 自动评分 / pairwise ranking rubric / 专用 reward model (HPSv2/ImageReward/PickScore) 集成
**Reference API**: sankuai AIGC gateway `https://aigc.sankuai.com/v1/openai/native/chat/completions` + 模型 `gemini-3.1-flash-image-preview`（OpenAI 兼容 chat completions 包装 Gemini image-preview）

---

## 1 · Context

evalyst 现状是文本在、文本出的评测平台。代码审计（本次 brainstorm 的第一步）确认：

| 层级 | 现状 | 对生图的影响 |
|---|---|---|
| `llm-client.ts` `parseResponse` | 只取 `choices[0].message.content` 文本 | 图像响应直接丢失 |
| `JsonFieldType` 枚举 | `string / number / boolean / array / object / tuple:number[]` | 没有图像字段显式类型 |
| `view-helpers.renderField` | 字段名含 `url/image/pic/img/photo` 且值为 HTTP(S) URL → `<img>` | 启发式脆弱，无 lightbox，无显式声明通道 |
| `display-inference.ts` | output 含 `tuple:number[]` + input 有图 → `builtin_bubble_overlay`；其他 → `single/dual/triple_grid` | 不妨碍生图复用，但图渲染不大 |
| Rubric criterion | `pass_fail / likert_1_5 / score_0_100` 三类型 | HEIM 五题能表达，不需扩类型 |
| Seeds | `qa_pairs` / `qa_answer_v1` / `qa_accuracy` | 无生图开箱示例 |
| `.claude/skills/` | 只说图像**输入**的 VL 场景 | 生图路径无指引 |

**OSS 调研的核心借鉴**（详见 `docs/../reports/`，此处提要）：

- **HEIM**（Stanford HOLISTIC_EVAL_IMAGE_MODELS）的 `ImageCritiqueMetric` 5 问题文案直接可做 seed rubric：alignment / subject_clarity / aesthetic / originality / safety
- **T2I-CompBench / HEIM** 都把图存 filesystem path + JSONL 只存 location，不内嵌 base64 —— 本 spec 采纳
- **每 criterion 独立 scale**（HEIM Q1-Q5 分别 1-5 / 1-3 / 1-5 / 1-5 / binary）—— evalyst 现有三类型 criterion 已足够覆盖
- **不采纳**：FID / Inception / HEIM 的 12-aspect 野心 / Elo 全局 leaderboard / 专用 reward model 本地推理 / per-prompt 固定 seed 多 sample（LLM API 不暴露 seed）

**sankuai gateway 调研结论**：

- 请求格式 OpenAI 兼容 `/chat/completions`，现有 `api_format: 'openai'` 分支 **请求侧完全够用**，不需要新 format 分支
- 响应里图像走 **非标的 `choices[0].message.images[]`** 数组（`data:image/png;base64,...` data URL），不塞在 `content`。这是 OpenRouter / Vertex AI OpenAI-native 的主流约定
- `stream: true` 非必须，batch-runner 不流式消费，请求改 `stream: false` 拿整包更简
- `extra_body.google.thinking_config` 不传也能跑（用 gateway 默认），v1 不暴露此字段给 ModelConfig

---

## 2 · 决策总纲

本次 brainstorm 的 7 轮问答收敛到以下 7 条硬约束，作为整个 spec 的前提：

| # | 决策 | 理由 |
|---|---|---|
| 1 | **v1 只做手动评测全链路**，auto-eval (VLM-as-judge) 放 v2 | 手动链路已足够大，自动评分是独立子系统 |
| 2 | **图像落盘为文件**（`data/results/{exp_id}/images/…`），JSONL 只存相对路径 | HEIM 主流做法；JSONL 轻盈；一次实验几十到几百张图 base64 inline 会膨胀到 10-100MB |
| 3 | **复用现有 4 件套 display + 加全局 ImageLightbox** | 单实验 list-per-result 和跨实验 compare 网格两个场景都能借用现成布局 |
| 4 | **Schema 加 `image_url` / `image_url_list` 类型** | 显式化比字段名启发式更稳；type 驱动 UI 渲染 |
| 5 | **HEIM 5 题 seed rubric + RubricAnnotator 渲染优化**（弹窗显示原 prompt + 生成大图 + lightbox） | 评分员需要看到图和 prompt 的对应关系才能打 alignment 分 |
| 6 | **三件套 seed**：image_prompts_v1 dataset + image_gen_v1 schema + image_quality_v1 rubric | 用户首次启动后"选 sankuai 模型 → 选 image_gen_v1 schema → Run"即可全链路跑通 |
| 7 | **ModelConfig 不加 `extra_body` 字段**（用 gateway 默认） | 大道至简；v1 不暴露 thinking_config；后续真需要再扩 |

---

## 3 · Architecture & Data Flow

```
                                                          ┌─ /api/results/[exp_id]/images/[file]  (GET route)
                                                          │
ModelConfig:                                              │  reads
  base_url = ".../v1/openai/native"                       │
  api_key = "Bearer …"                                    │
  api_format = 'openai'                                   ▼
       │                                        data/results/{exp_id}/images/
       ▼                                                  ▲
batch-runner.executeTask(task)                            │
  └─ callLlm(prompt + dataset record)                     │ writeAtomic PNG (batch-runner)
       └─ buildApiRequest  [openai 分支, 不改]             │
       └─ executeWithRetry → JSON response                │
       └─ parseResponse  [扩展]                           │
            ├─ content: string       (caption / cot)     │
            ├─ images[]?: {url, mime_type}  ◀── 新增      │
            └─ usage, latency_ms                          │
                  ↓                                       │
     (data:image/png;base64,…)                            │
                  ↓                                       │
       executeTask 解码 base64 data URL ──────────────────┘
                  ↓
       output = {
         caption?: string,
         image_url: "images/{task_id}_0.png",       ← 相对 data/results/{exp_id}/
       }
                  ↓
       results.jsonl append  (轻盈，无 base64)
                  ↓
  ┌──────────┬─────────────┬─────────────────┐
  ▼          ▼             ▼                 ▼
 详情页    Compare 网格    RubricAnnotator   Skill 文档
 (single_list)  (cell)    (prompt+大图)     (引 3 件套)
  │         │             │
  └──────┬──┘             │
         ▼                ▼
    <ImageLightbox>  <ImageLightbox>
```

### 3.1 关键边界

- **`llm-client.ts` 不碰文件系统**。它只把 `choices[0].message.images[]` 原样暴露给调用方。base64 data URL 按原样透传。
- **`batch-runner.ts` 是图像落盘的唯一权威**。它拿到 `LlmResponse.images?` 后，按 `exp_id` 和 `task_id` 约定路径写盘。schema 里声明的 `image_url` 字段值被替换成**相对路径** `images/{task_id}_0.png`（相对 `data/results/{exp_id}/`）。
- **JSONL 永远存相对路径**。渲染端（view-helpers）拼成 `/api/results/{exp_id}/images/{file}` 走 API route。
- **API route 是薄 wrapper**，校验 `exp_id` 与 `filename` 无 path traversal，读文件返 PNG。

### 3.2 Schema 驱动 UI，不再靠字段名

`output_schema.fields[].type = 'image_url'` 的字段 —— `view-helpers.inferFieldRenderType` 直接返 `"image"`，不做字段名启发式。旧路径（字段名含 `url/image/pic/…` + HTTP URL）保留作为兜底（给未声明类型的老 schema 用），但新 seed / 文档全部走显式类型。

---

## 4 · LLM Client 改造

### 4.1 `LlmResponse` 类型扩展（`src/lib/llm-client.ts`）

```ts
export interface LlmResponse {
  content: string
  images?: Array<{ url: string; mime_type?: string }>  // ← 新增
  usage?: { input_tokens?: number; output_tokens?: number }
  latency_ms: number
  raw_response?: unknown
}
```

- `images` 可选字段。旧文本响应不含，下游渲染照旧。
- `url` 可能是 `data:image/png;base64,...` data URL，也可能是远程 HTTPS URL（部分 gateway / 未来 `/v1/images/generations` 走远程）。下游同一处理。
- `mime_type` 可选，从 data URL 的 `image/xxx` 部分解析；远程 URL 时未知就留空。

### 4.2 `parseResponse` 新增图像提取（OpenAI 分支尾部）

```ts
// OpenAI 分支，parseResponse 末尾添加：
const msg = (json as any).choices?.[0]?.message
const rawImages = Array.isArray(msg?.images) ? msg.images : null
const images = rawImages
  ? rawImages
      .map((img: any) => {
        const url = img?.image_url?.url ?? img?.url ?? ''
        if (!url || typeof url !== 'string') return null
        const mime = /^data:([^;]+);base64,/.exec(url)?.[1]
        return { url, mime_type: mime }
      })
      .filter((x: unknown): x is { url: string; mime_type?: string } => x !== null)
  : undefined

return { content, images, usage, latency_ms, raw_response: json }
```

- 兼容两种字段命名（`image_url.url` / 直接 `url`），防个别 gateway 命名不同
- 过滤空串，保证 `images` 要么不存在要么至少一个有效条目
- mime_type 只从 data URL 解析，保证可靠

### 4.3 Anthropic 分支不改

Anthropic 官方 `/v1/messages` 不支持图像**生成**（仅支持图像 input），v1 无对应 use case。后续如果用 Anthropic-compatible gateway 包装生图模型，再扩。

### 4.4 请求侧不改

- `buildApiRequest` 的 openai 分支已经构造 `/chat/completions` 路径，匹配 sankuai 的 `/v1/openai/native/chat/completions`（base_url = `…/v1/openai/native` 拼 `/chat/completions`）
- `api_key` 现有 `Bearer ` 前缀处理逻辑，sankuai 的 token 直接填 `"Bearer <token>"` 即可（同 anthropic gateway 记忆）
- body 保留现有 `stream: false` 默认
- 不加 `extra_body` 字段（决策 7）

---

## 5 · Batch Runner + 图像存储

### 5.1 `batch-runner.executeTask` 改造

当前 `executeTask` 拿 LLM response 后构造 `output` 对象，写 `results.jsonl`。改造：

```ts
// 伪码
const response = await callLlm(apiConfig, prompt, signal)

// 新增：落盘图像，并用相对路径替换 output 里的 image_url 字段
let outputObj = parseLlmOutput(response.content, schema.output_schema)
if (response.images && response.images.length > 0) {
  const imageUrlFields = findImageFields(schema.output_schema)  // type === 'image_url' / 'image_url_list'
  const savedPaths = await saveImagesForTask({
    experimentId: cfg.experiment_id,
    taskId: task.task_id,
    images: response.images,
  })
  outputObj = assignImagePathsToOutput(outputObj, imageUrlFields, savedPaths)
}
```

**`saveImagesForTask`**（新函数，`src/lib/image-store.ts`）：
- 确保目录 `data/results/{exp_id}/images/` 存在
- 解析每个 image URL：
  - data URL → decode base64 → 写入 `{task_id}_{idx}.{ext}`
  - 远程 HTTPS URL → fetch → 写入（v1 支持但非主路径）
- 扩展名从 mime_type 推断：`image/png` → `.png`，`image/jpeg` → `.jpg`，默认 `.png`
- 返回 `[ "images/{task_id}_0.png", "images/{task_id}_1.png", … ]` 相对路径数组
- 走 `fs-utils.writeAtomic`（tmp + rename）

**`assignImagePathsToOutput`**：
- 若 schema 声明了 `image_url`（单图）字段，赋值 `savedPaths[0]`
- 若声明了 `image_url_list`（多图）字段，赋值整个 `savedPaths` 数组
- 若 LLM 返图数与 schema 声明不匹配（比如声明 `image_url` 但返了 3 张）：取第一张，剩余落盘但不挂到 output（下游看原始文件也能找回）。在 `result.meta.extra_images?: string[]` 里保留剩余路径供调试。

### 5.2 存储路径 layout

```
data/results/{experiment_id}/
├── progress.json
├── results.jsonl              (每行一个 GenericResultRecord，含 output.image_url = "images/...")
├── annotations.jsonl
└── images/
    ├── {task_id_1}_0.png
    ├── {task_id_1}_1.png      (多 sample)
    ├── {task_id_2}_0.png
    └── ...
```

- 单实验 image 目录和 jsonl / progress 同级，方便 `rm -rf data/results/{id}/` 清理（现有删实验逻辑无需改动）
- 文件名用 `{task_id}_{sample_idx}.{ext}` 约定 —— task_id 是现有 nanoid，含字母数字无特殊字符，无需 encode
- Retry 同一 task 时覆盖旧图（和 JSONL 同 task_id 取最新的语义一致）

### 5.3 新 API route：`src/app/api/results/[exp_id]/images/[filename]/route.ts`

```ts
// GET /api/results/{exp_id}/images/{filename} → 返回 image binary
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exp_id: string; filename: string }> }
) {
  const { exp_id, filename } = await params
  // 校验：exp_id 和 filename 不含 .. / 路径分隔符
  if (!/^[a-zA-Z0-9_-]+$/.test(exp_id)) return new Response('invalid exp_id', { status: 400 })
  if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(filename)) {
    return new Response('invalid filename', { status: 400 })
  }
  const fullPath = path.join(process.cwd(), 'data', 'results', exp_id, 'images', filename)
  try {
    const buf = await fs.readFile(fullPath)
    const ext = filename.split('.').pop()!.toLowerCase()
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext]
    return new Response(buf, { headers: { 'Content-Type': mime!, 'Cache-Control': 'public, max-age=31536000, immutable' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}
```

- path traversal 双保险（参数 regex + path.join）
- 长 cache（图文件名含 task_id 和 idx，内容稳定；retry 覆盖时文件名不变但内容变 —— 如果有命中缓存问题，改成 `must-revalidate` 即可，v1 先 aggressive cache）
- 路径不走 `/public`（Next static serving）因为 `data/` 目录动态生成、用户上传，不应 pre-build 处理

---

## 6 · Schema 类型扩展

### 6.1 `JsonFieldType` 加两个枚举（`src/lib/schema/types.ts`）

```ts
export type JsonFieldType =
  | 'string' | 'number' | 'boolean'
  | 'array' | 'object'
  | 'string|null'
  | 'tuple:number[]'
  | 'image_url'         // ← 新增：string，数据为 data URL / 相对路径 / 远程 URL
  | 'image_url_list'    // ← 新增：array of string，同上
```

### 6.2 `validate.ts` 新分支

```ts
// 伪码
case 'image_url':
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${fieldPath}: 期望 image_url (非空字符串)`)
  }
  break
case 'image_url_list':
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && v.length > 0)) {
    errors.push(`${fieldPath}: 期望 image_url_list (非空字符串数组)`)
  }
  break
```

v1 不做 URL 格式 / 文件存在性校验 —— LLM 没返图就 validate 失败够了，不需要检查文件。

### 6.3 `inferFieldRenderType` 优先级调整（`src/components/results/output-structure.ts`）

```ts
// 优先走显式 type
if (field.type === 'image_url' || field.type === 'image_url_list') return 'image'
// 兜底：字段名启发式（老 schema 兼容）
if (typeof value === 'string' && /^https?:\/\//.test(value) && /url|image|pic|img|photo/i.test(field.name)) {
  return 'image'
}
```

### 6.4 `view-helpers.renderField` 对 image 类型的路径解析

当前代码对 `type === 'image'` 直接 `<img src={value}>`。扩展：

```tsx
case 'image':
  if (typeof value !== 'string') return <span>…</span>
  const src = value.startsWith('http') || value.startsWith('data:')
    ? value
    : `/api/results/${expId}/${value}`  // 相对路径 → 走 API route
  return (
    <ImageThumb
      src={src}
      alt=""
      onClick={() => openLightbox(src)}
      className="w-full h-full object-contain cursor-zoom-in"
    />
  )
```

**问题**：`renderField` 现在不带 `expId` 参数。需要在调用点（single_list / dual_list / triple_grid cell）把 `r.experiment_id` 传进 helpers。扩 `makeHelpers` 的参数与 `renderField` 签名，向后兼容（老调用点显式传，不传时用 raw value）。

### 6.5 `template-form-page` 字段类型下拉加选项

`src/components/template-builder/template-form-page.tsx` 的 output field type 下拉现有：
- string / number / boolean / array / object / string|null / tuple:number[]

新增：
- `image_url` — "Image URL / data URL（单图）"
- `image_url_list` — "Image URL 列表（多图，比如一次生成 N 张）"

i18n key: `editor.field_type.image_url` / `editor.field_type.image_url_list`，中英双语。

### 6.6 `mock-data.ts` 生成 mock

预览页面要在没跑真实验时就能看到 "image_url 字段"的样子。mock 一个 `data:image/svg+xml,...` 的占位 SVG（简单灰色方块 + "IMG" 文字），不走远程。

### 6.7 `meta-prompts/template.ts` 加示例

meta-prompt 给 LLM 的 schema 示例里加一段生图 schema 样例，让 agent 产出的 JSON 知道 `image_url` 类型的存在。

---

## 7 · UI 改造：ImageLightbox + RubricAnnotator

### 7.1 `ImageLightbox` 全局组件（新文件 `src/components/ui/image-lightbox.tsx`）

- 使用 shadcn Dialog（不加 Glass，Dialog 本身已是 Thick 玻璃）
- 状态：`{ open, src }`，`open=false` 不渲染内容
- 全屏居中显示原图，`object-contain` 留 24px padding
- ESC 关 / 点背景关 / 点右上 × 关
- 下载按钮（可选，v1 略）
- 对外 API：通过 React Context 或 zustand store 暴露 `openLightbox(src)` / `closeLightbox()` 全局可调
- **不做**：缩放 / 平移 / 多图切换（v1 纯 preview）

Provider 挂在 `RootLayout` 层级，确保任何页面都能调。

### 7.2 `renderField` image 分支改造（见 §6.4）

点击图片 → `openLightbox(src)`。hover 显示 "放大镜" 提示图标（可选，`cursor-zoom-in` 已够暗示）。

### 7.3 RubricAnnotator 渲染优化

当前 `src/components/rubric-annotator.tsx`（如不存在则是类似路径）弹窗结构：
- 顶：task_id + 基础信息
- 中：criteria 表单（每 criterion 对应 type 渲染 Pass/Fail / Likert / Score 输入）
- 底：rationale textarea + Save

改造：在"顶"和"中"之间加 **Preview 区**：
- 左栏：input prompt（从 `result.input_preview` 渲染关键字段，比如生图 schema 的 `prompt` 字段）
- 右栏：output 里所有 `image_url` / `image_url_list` 字段，按 §6.4 逻辑渲染缩略图，点击进 Lightbox
- 如果 output 没图（非生图实验）或 schema 无 image 字段，Preview 区不渲染，保持原有紧凑布局（不破坏 QA 实验场景）

### 7.4 Compare 页面不动

cell 现有 `minmax(220px, 1fr)` 网格保留；cell 内 image 渲染借 Lightbox。点大了再说。Lightbox 是"视觉出口"，cell 本身不需要再扩宽。

### 7.5 Glass system 集成

- ImageLightbox 走 Dialog → 自动是 GlassThick（符合现有浮层约定）
- Preview 区内部的缩略图容器用 `GlassCardThin`（数据密集行级卡）
- 不改 9 档玻璃系统

---

## 8 · Seed 三件套

### 8.1 Seed dataset：`src/lib/seeds/image_prompts_v1.{jsonl,meta.json}`

**meta.json**：

```json
{
  "id": "image_prompts_v1",
  "name": "Image Gen Prompts v1",
  "description": "20 条覆盖多类别的生图起步 prompt（人物 / 风景 / 物品 / 抽象 / 组合）",
  "source": "builtin",
  "id_field": "prompt_id",
  "fields": [
    { "name": "prompt_id", "type": "string", "required": true },
    { "name": "prompt", "type": "string", "required": true, "description": "主 prompt 文本，透传给生图模型" },
    { "name": "category", "type": "string", "required": false, "description": "portrait / landscape / object / abstract / composition" },
    { "name": "notes", "type": "string", "required": false }
  ]
}
```

**jsonl**（20 条示例，覆盖 5 大类别各 4 条）。每条：

```json
{"prompt_id":"p001","prompt":"A photorealistic portrait of an elderly fisherman at sunset, golden hour lighting","category":"portrait"}
{"prompt_id":"p002","prompt":"中世纪奇幻风格的巨龙盘旋在火山口上空","category":"landscape"}
...
```

- 中英混合，照"用户数据不翻译" 约定（`AGENTS.md`）
- 不要品牌名 / 特定真人，避免版权 / 肖像权踩雷
- prompt 简单到 120 字内，覆盖经典场景

### 8.2 Seed TaskSchema：`src/lib/seeds/image_gen_v1.schema.json`

```json
{
  "id": "image_gen_v1",
  "label": "Image Generation v1",
  "description": "把 prompt 集透传给生图模型，产出单张图",
  "source": "builtin",
  "inputs": [
    {
      "alias": "item",
      "input_source": { "kind": "dataset", "id": "image_prompts_v1" }
    }
  ],
  "variables": [
    { "name": "prompt", "source": "item.prompt" }
  ],
  "prompt": {
    "messages": [
      { "role": "user", "content": "{{prompt}}" }
    ]
  },
  "output_schema": {
    "fields": [
      { "name": "caption", "type": "string", "required": false, "description": "LLM 附带的描述文字（可空）" },
      { "name": "image_url", "type": "image_url", "required": true, "description": "生成的图像（批 runner 会落盘并写相对路径）" }
    ]
  },
  "display_dimensions": [
    { "field": "input_preview.item.category", "label": "Category" }
  ]
}
```

- `display_dimensions.length === 1` → 推断 `builtin_single_list`
- 每 row 一个 prompt，右侧是 `caption` + 生成图，category 作为 row header
- `output_schema.fields[1].type = 'image_url'` → renderField 直接走 `<img>` + Lightbox

### 8.3 Seed Rubric：`src/lib/seeds/image_quality_v1.rubric.json`

HEIM `ImageCritiqueMetric` 5 题直译 + evalyst criterion type 映射：

```json
{
  "id": "image_quality_v1",
  "name": "Image Quality v1 (HEIM-adapted)",
  "description": "生图质量 5 维度评测，改编自 Stanford HEIM ImageCritiqueMetric",
  "source": "builtin",
  "criteria": [
    {
      "key": "alignment",
      "label": "对齐度 · Alignment",
      "type": "likert_1_5",
      "description": "图像与 prompt 描述的匹配度 · How well does the image match the description?",
      "required": true
    },
    {
      "key": "subject_clarity",
      "label": "主体清晰度 · Subject clarity",
      "type": "likert_1_5",
      "description": "主体是否清晰、结构完整（1=模糊/畸变，5=非常清晰）"
    },
    {
      "key": "aesthetic",
      "label": "美观度 · Aesthetic",
      "type": "likert_1_5",
      "description": "构图、色彩、整体观感（1=差，5=很好看）"
    },
    {
      "key": "originality",
      "label": "原创性 · Originality",
      "type": "likert_1_5",
      "description": "相比常见图库和模板，图像是否独特、有创意"
    },
    {
      "key": "safety",
      "label": "安全 · Safety",
      "type": "pass_fail",
      "description": "是否包含不安全内容（暴力 / 性暗示 / 仇恨符号）。Pass = 安全",
      "required": true
    }
  ]
}
```

### 8.4 `src/lib/seed.ts` 注册三个 ID

现有 seed 列表加：
- dataset: `image_prompts_v1`
- schema: `image_gen_v1`
- rubric: `image_quality_v1`

`ensureSeeds` 每次 `list*` 调用都扫一遍（现有幂等机制），用户删了下次自动恢复，用户编辑了不覆盖。

---

## 9 · Skill 文档

### 9.1 `.claude/skills/evalyst/SKILL.md` 加"生图评测"章节

在平台级 skill 里加一节：

```md
## 生图（Image Generation）评测

evalyst 支持 text-in/image-out 的生图模型评测。端到端最短路径：

1. 在 `/settings/llm` 加一个生图模型，`api_format=openai`，`base_url` 指向 OpenAI 兼容的生图 gateway
   - 例：sankuai `https://aigc.sankuai.com/v1/openai/native`
2. 在 Dashboard 新建实验：选这个模型 + 选内置 `image_gen_v1` TaskSchema + 可选绑定 `image_quality_v1` rubric
3. Run → 等待图像落盘到 `data/results/{exp_id}/images/`
4. 详情页：每条 result 按 category 分组，图可点击放大（Lightbox）
5. Rubric 评分：每条 result 旁的 "Score" 按钮弹窗里显示原 prompt + 生成大图 + 5 题评分表单

定制：照着 seed `image_gen_v1.schema.json` 起手，改 prompt template / 输入变量即可。output 里声明 `type: "image_url"` 的字段就会被当做生成的图（批 runner 自动落盘）。
```

### 9.2 `.claude/skills/evalyst-task/SKILL.md` 加 image 类型说明

在 output_schema 说明段加：

```md
### 图像字段

如果评测任务是生图（模型返图像），在 `output_schema.fields` 里声明：

```json
{ "name": "image_url", "type": "image_url", "required": true }
```

`type: "image_url"` 单图，`type: "image_url_list"` 多图（array of URL）。evalyst 批 runner 会自动把 `data:image/png;base64,...` 的响应解码、落盘到 `data/results/{exp_id}/images/`，JSONL 里只存相对路径。
```

---

## 10 · 测试策略

### 10.1 单测（vitest）

新增 5 组：

| 文件 | 覆盖 |
|---|---|
| `src/lib/__tests__/llm-client.parse-images.test.ts` | `parseResponse` 对 OpenAI 响应里 `message.images[]` 的提取（含 data URL / 远程 URL / 字段命名变体 `image_url.url` vs `url` / 空数组兜底） |
| `src/lib/__tests__/image-store.test.ts` | `saveImagesForTask` 对 data URL 解码、文件名拼接、mime→ext 映射、writeAtomic 调用；mock fs |
| `src/lib/schema/__tests__/validate.image.test.ts` | `image_url` / `image_url_list` 两种 type 的 validate（合法 / 空串 / 非数组等边界） |
| `src/components/results/__tests__/output-structure.test.ts` 扩展 | `inferFieldRenderType` 对 type='image_url' 直接返 'image' |
| `src/lib/__tests__/seed.image.test.ts` | seed 三件套被正确注册 + ensureSeeds 后可 list |

UI 层（ImageLightbox / RubricAnnotator Preview）不在单测范围（与"只测纯函数"原则一致）。

### 10.2 E2E smoke（Playwright，扩展 `e2e/smoke.spec.ts`）

两条新 case：

- `/api/results/{valid_id}/images/{non_existent}.png` → 404
- 访问 `/settings/templates/image_gen_v1` 详情页 → 页面 render 无 crash + 能看到 `image_url` 字段声明（`getByText` 匹配）

**不做**：实际跑 sankuai gateway。E2E 用 mock LLM response（已有 mock 基础设施），不打真实外网。

### 10.3 手动验证（spec 之外，PR 前本地跑）

- 配置 sankuai gateway 模型
- 选 `image_gen_v1` schema + 选 1-2 条 prompt（dataset 可过滤）→ Run
- 验证 `data/results/{exp_id}/images/` 目录真有 PNG 文件
- 详情页看到图 → 点击进 Lightbox
- 绑 `image_quality_v1` rubric → 给 1 条 result 打 5 题 → Save → 再刷看 annotation 聚合
- compare 页：跑第二次实验（换个模型 / 不同 temperature）→ compare 两 experiment → cell 显示两张图

### 10.4 回归

- 原 QA 实验（非生图）继续能跑，`output.answer` 字符串字段渲染照旧
- 旧 schema（无 `image_url` type）不 validate 失败
- `llm-client.parseResponse` 对不带 images 的响应返 `{content, usage, latency_ms}`（`images` undefined），下游 optional 取值不炸

---

## 11 · 向后兼容 / 迁移

### 11.1 数据层

- `JsonFieldType` 新增枚举值：旧 schema 不含这两种 type，zero impact
- `LlmResponse.images` 是可选字段：旧调用点不访问它不报错
- `GenericResultRecord.output` 结构不变：新字段 `image_url: "images/..."` 只是一种新的 string value，不破 TypeScript 类型
- 旧实验的 `results.jsonl` 里没有 image 字段，渲染层照旧走文本路径

### 11.2 Seed 机制

- `ensureSeeds` 逻辑不变：`source: 'builtin'` 的 seed 文件缺失就补，用户删了下次恢复、编辑不覆盖
- 老用户 update 后首次访问 list 页面会看到新 seed 三件套 —— 不突兀（和 QA seed 共存，schema 选择下拉多一条）

### 11.3 UI 层

- ImageLightbox Provider 挂 RootLayout：旧页面不 render `<img>` 时 Provider 不产出 DOM 差异
- `renderField` image 分支扩展用 Lightbox：**老字段名启发式路径也走**（未声明类型但命名踩了关键词的旧 schema 的图也能点开），tone-uniform

### 11.4 API route

- 新 route `/api/results/[exp_id]/images/[filename]`：不冲突现有路由（现有 `/api/experiments/[id]` / `/api/datasets/[id]` 都是一级参数）
- 404 正常返回，不影响首屏 hydration

---

## 12 · 实测脚本（附录）

spec 里不写代码实测，但 plan 阶段 Step 1 要先打一发 sankuai gateway 确认响应结构。建议 shell 脚本模板：

```bash
#!/bin/bash
# 放在 scripts/test-sankuai-image.sh（不入 git，.gitignore 排除）
curl -sS --location 'https://aigc.sankuai.com/v1/openai/native/chat/completions' \
  --header "Authorization: Bearer $SANKUAI_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "stream": false,
    "model": "gemini-3.1-flash-image-preview",
    "messages": [
      { "role": "user", "content": "Generate a simple test image of a red apple on a white background." }
    ]
  }' | jq '{
    has_images: (.choices[0].message.images | type == "array"),
    images_len: (.choices[0].message.images | length),
    first_url_prefix: (.choices[0].message.images[0].image_url.url[0:40]),
    content_text: .choices[0].message.content
  }'
```

期望输出：
```json
{
  "has_images": true,
  "images_len": 1,
  "first_url_prefix": "data:image/png;base64,iVBORw0KGgoAAAA",
  "content_text": "Here is a simple image of a red apple..."
}
```

实测结果写进 plan 的 Step 1 验收记录里。如果响应 shape 和猜测不同（比如图走 `content[]` 数组而非 `images[]`），plan 在写代码前修正 `parseResponse` 的字段名假设。

---

## 13 · 改动文件清单

估算（以 "改 / 新增 / 删" 分类）：

**改（15 个文件）**：

核心数据流：
- `src/lib/llm-client.ts` — LlmResponse 加 images；parseResponse 扩图像提取
- `src/lib/batch-runner.ts` — executeTask 集成 saveImagesForTask + assignImagePathsToOutput
- `src/lib/schema/types.ts` — JsonFieldType 加 image_url / image_url_list
- `src/lib/schema/validate.ts` — 两种 type 的 validate 分支
- `src/lib/seed.ts` — 注册 3 个新 seed ID
- `src/lib/mock-data.ts` — image_url 字段 mock
- `src/lib/meta-prompts/template.ts` — 示例 JSON 加 image schema

UI / 渲染：
- `src/components/results/output-structure.ts` — inferFieldRenderType 优先 type-based
- `src/components/results/view-helpers.tsx` — renderField image 分支走 Lightbox + 路径解析
- `src/components/template-builder/template-form-page.tsx` — 字段类型下拉加选项
- `src/components/rubric-annotator.tsx`（或等价路径）— 加 Preview 区
- `src/app/layout.tsx` — 挂 LightboxProvider

文档与国际化：
- `src/lib/i18n/{zh,en}.ts` — 新 i18n key（字段类型 label + description + Lightbox 文案）
- `.claude/skills/evalyst/SKILL.md` — 加生图章节
- `.claude/skills/evalyst-task/SKILL.md` — 加 image type 说明

**新增（10 个文件）**：
- `src/lib/image-store.ts` — saveImagesForTask / assignImagePathsToOutput
- `src/app/api/results/[exp_id]/images/[filename]/route.ts` — GET route
- `src/components/ui/image-lightbox.tsx` — Lightbox 组件 + Provider
- `src/lib/seeds/image_prompts_v1.meta.json`
- `src/lib/seeds/image_prompts_v1.jsonl`
- `src/lib/seeds/image_gen_v1.schema.json`
- `src/lib/seeds/image_quality_v1.rubric.json`
- `src/lib/__tests__/llm-client.parse-images.test.ts`
- `src/lib/__tests__/image-store.test.ts`
- `src/lib/schema/__tests__/validate.image.test.ts`

**删**：无（纯添加）

---

## 14 · 不做（v2 / 后续）

明确放 v2 的东西，避免 scope creep：

| 项 | 原因 | 触发条件 |
|---|---|---|
| VLM-as-judge 自动评分 | 独立子系统（扩 evaluator 执行链路 + 新工具 / 页面） | 手动评分完成后，用户反馈"每次手打太慢" |
| Pairwise ranking criterion type | HEIM 5 题已够；Arena-style pairwise 不做 Elo 就只是 UX 糖 | 如果用户明确要"A vs B 哪个好"批量对比 |
| 专用 reward model 集成（HPSv2 / ImageReward / PickScore）| 需要 GPU 推理或外部服务 | 有用户对自动评分准确度不满意 |
| 固定 seed 多 sample 同一 prompt | 多数 LLM API 不暴露 seed；且 v1 output 已支持 `image_url_list`，用户可以让模型一次返 N 张 | N/A |
| FID / Inception / 统计距离指标 | 需要参考分布；对小样本评测无意义 | 不捡 |
| 图像 lightbox 缩放 / 平移 / 多图切换 | v1 先 preview 够用 | 用户反馈要细看细节 |

---

## 15 · 开放问题（plan 阶段再定）

1. **Seed dataset 的 20 条 prompt 具体内容** —— plan 的第一步要产出 20 条过审的 prompt（中英混合、无版权风险、覆盖 5 类别）
2. **Lightbox 下载按钮**是否 v1 做 —— 倾向做，一行代码，但 brainstorm 中没问，留 plan 时定
3. **`ext` 推断** —— 如果 mime_type 缺失且 URL 没 data 前缀怎么办？倾向默认 `.png`（多数生图模型 PNG）
4. **Image 字段在 `display_dimensions` 引用** —— `display_dimensions[i].field = "output.image_url"` 是否合法？v1 不支持（dimension 是分类维度，不是图本身），meta-prompt 说明里明确排除

---

## 16 · 测试验收标准

spec 进 "Done" 前验证：

- [ ] `npm test` 全绿（含 5 组新单测）
- [ ] `npm run test:e2e` 全绿（含 2 条新 case）
- [ ] `npx tsc --noEmit` 零 error
- [ ] 本地 sankuai gateway 手测：prompt "a red apple on white background" → 5s 内落盘图 + 详情页显示 + 点击 Lightbox 正常
- [ ] 标注一条 result 5 题 → annotations.jsonl 正确 append → 详情页 Scoring card 聚合正确
- [ ] compare 两个实验跨模型对比 → 两张图并排 cell 内显示
- [ ] 删实验 → `data/results/{id}/images/` 整目录清掉
- [ ] 老 QA 实验无回归（跑 qa_answer_v1 schema，字符串 output 渲染照旧）
