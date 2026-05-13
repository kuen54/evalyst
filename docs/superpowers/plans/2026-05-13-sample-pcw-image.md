# Sample PCW Image (PR #2 of stream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 60-record image-generation sample suite (3 schemas × 20 records × gpt-image-1) mirroring v2 商品文案 demo's "跨 prompt 对比" narrative, but for visual output. No judge, no annotations — users score by hand.

**Architecture:** 3 new schemas reusing v2's `product_copywriting_v1` dataset + 3 sample experiment metas + 1 zero-dep runner script (mirror of `scripts/run-pcw-samples.ts` minus judge). image binary commits into `src/lib/seeds/results/{exp_id}/images/` (~9 MB total) so first-boot `seedResultsTree()` populates runtime correctly. Lessons §6.4 fully respected: 多模态 input/output 部分豁免（user explicit backlog item），vision judge / 学术 prompt 严守红线。

**Tech Stack:** TypeScript / Node 18+ / Next.js 16 / vitest / Playwright (e2e). LLM gateway: sankuai aigc.sankuai.com OpenAI-native endpoint, `gpt-image-1` via `endpoint_kind=images_generations`. Image rendering: `view-helpers.tsx:73-93` already supports `image_url` field type.

**Spec:** `docs/superpowers/specs/2026-05-13-sample-pcw-image-design.md`

**Branch:** `feat/sample-pcw-image` (already created, spec already committed)

**Predecessors:**
- v1 fail lessons (`docs/superpowers/findings/2026-05-13-sample-data-redesign-lessons.md`)
- v2 ship spec + plan (`docs/superpowers/specs/2026-05-13-sample-pcw-copywriting-design.md` ship 在 v0.16.0 PR #98)

---

## Task 1: Pre-flight verification

**Files:** none (verification only)

- [ ] **Step 1.1: Confirm branch state**

```bash
git branch --show-current
# Expected: feat/sample-pcw-image

git log --oneline -3
# Expected: top commit is "docs(specs): clarify image binary ships into seeds/ for PR #2"
```

- [ ] **Step 1.2: Run baseline five-checks (确认 main pristine)**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
# Expected: 全绿
```

- [ ] **Step 1.3: Verify v2 ship resources exist (复用依赖)**

```bash
ls -la src/lib/seeds/datasets/product_copywriting_v1.{meta.json,jsonl}
wc -l src/lib/seeds/datasets/product_copywriting_v1.jsonl
# Expected: file 存在；jsonl 有 60 行
```

- [ ] **Step 1.4: Verify image-gen pipeline pieces present**

```bash
grep -n "callImagesGenerations\|images_generations" src/lib/llm-client.ts | head -5
grep -n "saveImagesForTask" src/lib/image-store.ts | head -3
# Expected: 都有定义
```

不需要 commit。

---

## Task 2: Create `pcw_xhs_image_v1` schema

**Files:**
- Create: `src/lib/seeds/schemas/pcw_xhs_image_v1.json`

- [ ] **Step 2.1: Write schema file**

```json
{
  "id": "pcw_xhs_image_v1",
  "label": "商品配图 · 小红书风",
  "version": 1,
  "compare_group": "product_image_v1",
  "inputs": [
    {
      "alias": "p",
      "dataset_id": "product_copywriting_v1",
      "filters": [
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "品类",
          "options": [
            { "value": "美妆", "label": "美妆" },
            { "value": "数码", "label": "数码" },
            { "value": "食品饮料", "label": "食品饮料" },
            { "value": "家居", "label": "家居" },
            { "value": "服饰", "label": "服饰" },
            { "value": "母婴", "label": "母婴" }
          ],
          "defaultValue": ["美妆", "数码", "食品饮料", "家居", "服饰", "母婴"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [
    { "name": "name", "source": "p.name" },
    { "name": "category", "source": "p.category" },
    { "name": "price", "source": "p.price" },
    { "name": "features", "source": "p.core_features", "transform": [{ "op": "join", "sep": "、" }] },
    { "name": "target_user", "source": "p.target_user" }
  ],
  "default_prompt": "你是商品配图设计师。请为这个商品生成一张小红书风的种草配图。\n\n风格要求：\n- 4:5 竖版构图\n- ins 插画 / 手账 / 少女系，柔和暖色调\n- 商品居中或左上偏置，留白舒适\n- 不要硬商业感，要\"在博主手里\"的随性场景感\n- 不放任何文字 / 标题 / logo（小红书图片靠 caption 不靠图内字）\n\n商品参数：\n- 名：{{name}}\n- 品类：{{category}}\n- 价：{{price}}\n- 核心卖点：{{features}}\n- 目标用户：{{target_user}}\n\n直接生图。",
  "message_builder": {
    "user_template": "请为这个商品生成一张配图。"
  },
  "output_schema": {
    "type": "object",
    "required": ["image_url"],
    "properties": {
      "image_url": { "type": "image_url" },
      "caption": { "type": "string", "max_length": 200 }
    }
  },
  "display_dimensions": [
    {
      "field": "input_preview.p.category",
      "label": "品类",
      "header_fields": [
        { "field": "input_preview.p.name", "label": "商品" },
        { "field": "input_preview.p.target_user", "label": "目标用户" },
        { "field": "input_preview.p.price", "label": "价" },
        { "field": "input_preview.p.core_features", "label": "核心卖点" }
      ]
    }
  ],
  "raw_text_output": false
}
```

- [ ] **Step 2.2: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/lib/seeds/schemas/pcw_xhs_image_v1.json', 'utf8'))" && echo OK
# Expected: OK
```

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/seeds/schemas/pcw_xhs_image_v1.json
git commit -m "$(cat <<'EOF'
feat(sample): add pcw_xhs_image_v1 schema (xhs 插画风 4:5)

Stream sample-data-redesign PR #2 第一个 schema。复用 v2
product_copywriting_v1 dataset，输出 image_url + caption。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `pcw_douyin_image_v1` schema

**Files:**
- Create: `src/lib/seeds/schemas/pcw_douyin_image_v1.json`

- [ ] **Step 3.1: Write schema file**（结构同 Task 2，差别仅 `id` / `label` / `default_prompt`）

```json
{
  "id": "pcw_douyin_image_v1",
  "label": "商品配图 · 抖音封面风",
  "version": 1,
  "compare_group": "product_image_v1",
  "inputs": [
    {
      "alias": "p",
      "dataset_id": "product_copywriting_v1",
      "filters": [
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "品类",
          "options": [
            { "value": "美妆", "label": "美妆" },
            { "value": "数码", "label": "数码" },
            { "value": "食品饮料", "label": "食品饮料" },
            { "value": "家居", "label": "家居" },
            { "value": "服饰", "label": "服饰" },
            { "value": "母婴", "label": "母婴" }
          ],
          "defaultValue": ["美妆", "数码", "食品饮料", "家居", "服饰", "母婴"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [
    { "name": "name", "source": "p.name" },
    { "name": "category", "source": "p.category" },
    { "name": "price", "source": "p.price" },
    { "name": "features", "source": "p.core_features", "transform": [{ "op": "join", "sep": "、" }] },
    { "name": "target_user", "source": "p.target_user" }
  ],
  "default_prompt": "你是抖音视频封面设计师。请为这个商品生成视频封面图。\n\n风格要求：\n- 9:16 竖版构图\n- 商业感强，高饱和、高对比、视觉冲击\n- 商品占比要大（封面就要看到货）\n- 可加 1 个短中文钩子文字（≤ 6 字，例如「绝了」「必囤」「新一代」「真香」）\n  注：gpt-image-1 中文字渲染不稳，允许偶尔出错——这恰好是评测员要看见的模型弱点之一\n- 留出右下角空白处便于后续叠平台 UI\n\n商品参数：\n- 名：{{name}}\n- 品类：{{category}}\n- 价：{{price}}\n- 核心卖点：{{features}}\n- 目标用户：{{target_user}}\n\n直接生图。",
  "message_builder": {
    "user_template": "请为这个商品生成一张配图。"
  },
  "output_schema": {
    "type": "object",
    "required": ["image_url"],
    "properties": {
      "image_url": { "type": "image_url" },
      "caption": { "type": "string", "max_length": 200 }
    }
  },
  "display_dimensions": [
    {
      "field": "input_preview.p.category",
      "label": "品类",
      "header_fields": [
        { "field": "input_preview.p.name", "label": "商品" },
        { "field": "input_preview.p.target_user", "label": "目标用户" },
        { "field": "input_preview.p.price", "label": "价" },
        { "field": "input_preview.p.core_features", "label": "核心卖点" }
      ]
    }
  ],
  "raw_text_output": false
}
```

- [ ] **Step 3.2: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/lib/seeds/schemas/pcw_douyin_image_v1.json', 'utf8'))" && echo OK
```

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/seeds/schemas/pcw_douyin_image_v1.json
git commit -m "feat(sample): add pcw_douyin_image_v1 schema (douyin 封面风 9:16)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create `pcw_friends_image_v1` schema

**Files:**
- Create: `src/lib/seeds/schemas/pcw_friends_image_v1.json`

- [ ] **Step 4.1: Write schema file**

```json
{
  "id": "pcw_friends_image_v1",
  "label": "商品配图 · 朋友圈生活感",
  "version": 1,
  "compare_group": "product_image_v1",
  "inputs": [
    {
      "alias": "p",
      "dataset_id": "product_copywriting_v1",
      "filters": [
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "品类",
          "options": [
            { "value": "美妆", "label": "美妆" },
            { "value": "数码", "label": "数码" },
            { "value": "食品饮料", "label": "食品饮料" },
            { "value": "家居", "label": "家居" },
            { "value": "服饰", "label": "服饰" },
            { "value": "母婴", "label": "母婴" }
          ],
          "defaultValue": ["美妆", "数码", "食品饮料", "家居", "服饰", "母婴"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [
    { "name": "name", "source": "p.name" },
    { "name": "category", "source": "p.category" },
    { "name": "price", "source": "p.price" },
    { "name": "features", "source": "p.core_features", "transform": [{ "op": "join", "sep": "、" }] },
    { "name": "target_user", "source": "p.target_user" }
  ],
  "default_prompt": "你是个普通人，刚买了这个东西想发朋友圈。\n\n风格要求：\n- 1:1 方图（朋友圈默认）\n- 手机随手拍质感：自然光、桌面 / 窗台 / 手心，略带颗粒感\n- 不要影棚布光，不要修图过度的\"商品图感\"\n- 不要文字 / 价签 / 包装贴纸\n\n商品参数：\n- 名：{{name}}\n- 品类：{{category}}\n- 价：{{price}}\n- 核心卖点：{{features}}\n- 目标用户：{{target_user}}\n\n直接生图。",
  "message_builder": {
    "user_template": "请为这个商品生成一张配图。"
  },
  "output_schema": {
    "type": "object",
    "required": ["image_url"],
    "properties": {
      "image_url": { "type": "image_url" },
      "caption": { "type": "string", "max_length": 200 }
    }
  },
  "display_dimensions": [
    {
      "field": "input_preview.p.category",
      "label": "品类",
      "header_fields": [
        { "field": "input_preview.p.name", "label": "商品" },
        { "field": "input_preview.p.target_user", "label": "目标用户" },
        { "field": "input_preview.p.price", "label": "价" },
        { "field": "input_preview.p.core_features", "label": "核心卖点" }
      ]
    }
  ],
  "raw_text_output": false
}
```

- [ ] **Step 4.2: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/lib/seeds/schemas/pcw_friends_image_v1.json', 'utf8'))" && echo OK
```

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/seeds/schemas/pcw_friends_image_v1.json
git commit -m "feat(sample): add pcw_friends_image_v1 schema (friends 生活感 1:1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Create 3 sample experiment meta files

**Files:**
- Create: `src/lib/seeds/experiments/pcw_xhs_image_baseline.json`
- Create: `src/lib/seeds/experiments/pcw_douyin_image_baseline.json`
- Create: `src/lib/seeds/experiments/pcw_friends_image_baseline.json`

- [ ] **Step 5.1: Reference v2 experiment meta shape**

```bash
cat src/lib/seeds/experiments/pcw_xhs_baseline.json
# 用作字段顺序 + timestamp 风格参考
```

- [ ] **Step 5.2: Write `pcw_xhs_image_baseline.json`** — shape must match `ExperimentConfig` type (`src/lib/types.ts:28-55`); cross-check field names against v2 `pcw_xhs_baseline.json`

```json
{
  "id": "pcw_xhs_image_baseline",
  "name": "商品配图 · 小红书风 · gpt-image-1 baseline",
  "created_at": "2026-05-13T00:00:00Z",
  "updated_at": "2026-05-13T00:00:00Z",
  "schema_id": "pcw_xhs_image_v1",
  "filter_values": { "categories": ["美妆","数码","食品饮料","家居","服饰","母婴"], "limit": 20 },
  "model": "gpt-image-1",
  "temperature": 1,
  "max_tokens": 1,
  "api_config": { "base_url": "", "api_key": "" },
  "prompt_template": "(uses schema default_prompt)",
  "status": "completed",
  "notes": "复用 v2 product_copywriting_v1 dataset 抽 20 条商品（每品类 3-4 条），xhs 插画风 prompt × gpt-image-1 跑 20 张配图。配套 douyin / friends baseline 共同对比 3 风格。不带 judge / 不带 annotations，留给用户进 evalyst annotation UI 自打分。"
}
```

注意（坑）：
- `name` not `label`；`notes` not `description`；不要加 `system_prompt_id`（不存在的字段会被 schema validator 拒）
- `temperature=1, max_tokens=1` 是 image gen 占位值（API 不读，但 type 要求非空）
- `api_config` 留空字符串，运行时从 `data/llm-config.json` 用 `model="gpt-image-1"` 查
- 时间戳 ISO **不带** millis（`Z` 结尾，跟 v2 一致）
- 省略 `rubric_id`（不 ship rubric）
- `status: "completed"` 表示已跑完，runner ship 后用户能看到完成态实验

- [ ] **Step 5.3: Write `pcw_douyin_image_baseline.json`**（同上结构，仅改 id / name / schema_id / notes）

```json
{
  "id": "pcw_douyin_image_baseline",
  "name": "商品配图 · 抖音封面风 · gpt-image-1 baseline",
  "created_at": "2026-05-13T00:00:00Z",
  "updated_at": "2026-05-13T00:00:00Z",
  "schema_id": "pcw_douyin_image_v1",
  "filter_values": { "categories": ["美妆","数码","食品饮料","家居","服饰","母婴"], "limit": 20 },
  "model": "gpt-image-1",
  "temperature": 1,
  "max_tokens": 1,
  "api_config": { "base_url": "", "api_key": "" },
  "prompt_template": "(uses schema default_prompt)",
  "status": "completed",
  "notes": "复用 v2 product_copywriting_v1 dataset 抽 20 条商品（每品类 3-4 条），douyin 封面风 prompt × gpt-image-1 跑 20 张配图。配套 xhs / friends baseline 共同对比 3 风格。不带 judge / 不带 annotations，留给用户进 evalyst annotation UI 自打分。"
}
```

- [ ] **Step 5.4: Write `pcw_friends_image_baseline.json`**

```json
{
  "id": "pcw_friends_image_baseline",
  "name": "商品配图 · 朋友圈生活感 · gpt-image-1 baseline",
  "created_at": "2026-05-13T00:00:00Z",
  "updated_at": "2026-05-13T00:00:00Z",
  "schema_id": "pcw_friends_image_v1",
  "filter_values": { "categories": ["美妆","数码","食品饮料","家居","服饰","母婴"], "limit": 20 },
  "model": "gpt-image-1",
  "temperature": 1,
  "max_tokens": 1,
  "api_config": { "base_url": "", "api_key": "" },
  "prompt_template": "(uses schema default_prompt)",
  "status": "completed",
  "notes": "复用 v2 product_copywriting_v1 dataset 抽 20 条商品（每品类 3-4 条），friends 生活感 prompt × gpt-image-1 跑 20 张配图。配套 xhs / douyin baseline 共同对比 3 风格。不带 judge / 不带 annotations，留给用户进 evalyst annotation UI 自打分。"
}
```

- [ ] **Step 5.5: Verify all three parse**

```bash
for f in src/lib/seeds/experiments/pcw_*_image_baseline.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f', 'utf8'))" && echo "$f OK"
done
# Expected: 3 个 OK
```

- [ ] **Step 5.6: Commit**

```bash
git add src/lib/seeds/experiments/pcw_xhs_image_baseline.json src/lib/seeds/experiments/pcw_douyin_image_baseline.json src/lib/seeds/experiments/pcw_friends_image_baseline.json
git commit -m "$(cat <<'EOF'
feat(sample): add 3 pcw image baseline experiment metas

xhs / douyin / friends image baselines pointing at the new image schemas.
filter_values.limit=20 → runner picks 20 deterministically per category.
rubric_id: null → no auto-judge, user annotates by hand.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Schema/experiment dev-server smoke (no data yet)

**Files:** none (browser verification)

- [ ] **Step 6.1: Start dev server in background**

```bash
npm run dev
# Wait for "Ready in X.Xs" message
```

- [ ] **Step 6.2: Browser visit `/settings/templates`**

Expected: 看到 3 个新 schema 出现在列表 (`pcw_xhs_image_v1` / `pcw_douyin_image_v1` / `pcw_friends_image_v1`)，没有 schema-load 错误

- [ ] **Step 6.3: Click into one schema (e.g. xhs_image_v1)**

Expected: schema editor 渲染正常；prompt 中文不乱码；output_schema 显示 `image_url` + `caption`

- [ ] **Step 6.4: Visit `/experiments`**

Expected: 看到 3 个新 baseline 实验 (`pcw_xhs_image_baseline` 等)，每个显示 0 results（因为还没跑）

- [ ] **Step 6.5: Click `pcw_xhs_image_baseline` 进详情**

Expected: 详情页 empty state（"还没有 results"）；不要崩；toolbar 看到 "运行" / "对比" 按钮

- [ ] **Step 6.6: Stop dev server**

ctrl-c 或杀掉 process。

不需要 commit（仅验证）。

---

## Task 7: Write runner script — skeleton + config gate + sample selection

**Files:**
- Create: `scripts/run-pcw-image-samples.ts`

- [ ] **Step 7.1: Reference v2 runner structure**

```bash
head -80 scripts/run-pcw-samples.ts
# 理解 EXPERIMENTS const / pickModel / main() / process.exit 模式
```

- [ ] **Step 7.2: Write skeleton with config gate + dataset reading + deterministic selection**

```typescript
#!/usr/bin/env -S npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- script-only file; tolerate any for jsonl record shapes from external LLM responses */
/**
 * scripts/run-pcw-image-samples.ts
 *
 * 跑 3 套生图 sample experiment (pcw_xhs_image_baseline / pcw_douyin_image_baseline /
 * pcw_friends_image_baseline) × gpt-image-1 → 输出到嵌套约定
 * data/results/<exp_id>/{results.jsonl, images/}。
 *
 * Skip-if-exists：单条 result 已落盘则跳过（避免重复烧钱）。
 * Strip：跑完后从 ship 文件里去掉 status!=success（lessons §6.4 #4 硬约束）。
 * 不带 judge / 不写 annotations（lessons §6.4 #6 红线 buffer，业务评测员手打）。
 * 用法：npm run run:pcw-image-samples
 *
 * Zero-dep（仅 Node 18+ 内置 fetch / fs / path）。
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { callLlm } from '../src/lib/llm-client'
import { getLlmConfig, type LlmConfig, type ModelConfig } from '../src/lib/llm-config'
import { saveImagesForTask, assignImagePathsToOutput } from '../src/lib/image-store'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATA = path.join(process.cwd(), 'data')

// gpt-image-1 候选 model name（按顺序找第一个匹配）
const IMAGE_MODEL_CANDIDATES = ['gpt-image-1']

const EXPERIMENTS: Array<{ id: string; schemaId: string; promptKey: 'xhs' | 'douyin' | 'friends' }> = [
  { id: 'pcw_xhs_image_baseline', schemaId: 'pcw_xhs_image_v1', promptKey: 'xhs' },
  { id: 'pcw_douyin_image_baseline', schemaId: 'pcw_douyin_image_v1', promptKey: 'douyin' },
  { id: 'pcw_friends_image_baseline', schemaId: 'pcw_friends_image_v1', promptKey: 'friends' },
]

// 每品类抽取条数 (固定，加起来 = 20)
const CATEGORY_PICK: Record<string, number> = {
  '美妆': 4, '数码': 4, '食品饮料': 4, '家居': 4, '服饰': 2, '母婴': 2,
}

interface Product {
  pid: string
  name: string
  category: string
  price: string
  core_features: string[]
  target_user: string
}

function pickModel(cfg: LlmConfig, candidates: string[]): ModelConfig | null {
  for (const c of candidates) {
    const found = cfg.models.find((m) => m.model === c)
    if (found) return found
  }
  return null
}

function readDataset(): Product[] {
  const filePath = path.join(SEEDS, 'datasets', 'product_copywriting_v1.jsonl')
  const text = fsSync.readFileSync(filePath, 'utf8')
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Product)
}

/**
 * 按 CATEGORY_PICK 配额从 dataset 中抽取 20 条。每品类按 dataset 行号顺序前 N 条。
 * 确定性：同一 dataset 多次调用返回完全相同 20 条（顺序也一致）。
 */
function pickSamples(dataset: Product[]): Product[] {
  const byCategory: Record<string, Product[]> = {}
  for (const p of dataset) {
    if (!byCategory[p.category]) byCategory[p.category] = []
    byCategory[p.category]!.push(p)
  }
  const out: Product[] = []
  for (const [cat, n] of Object.entries(CATEGORY_PICK)) {
    const list = byCategory[cat] ?? []
    out.push(...list.slice(0, n))
  }
  return out
}

async function main() {
  const cfg = getLlmConfig()
  const imageModel = pickModel(cfg, IMAGE_MODEL_CANDIDATES)
  if (!imageModel) {
    console.error('[runner] missing LLM config: gpt-image-1')
    console.error('[runner] please add at /settings/llm with these fields:')
    console.error('  endpoint_kind=images_generations')
    console.error('  base_url=https://aigc.sankuai.com/v1/openai/native')
    console.error('  api_format=openai')
    console.error('  api_key=Bearer ...')
    console.error('[runner] then re-run.')
    process.exit(1)
  }
  if (imageModel.endpoint_kind !== 'images_generations') {
    console.error(`[runner] gpt-image-1 found but endpoint_kind="${imageModel.endpoint_kind}", expected "images_generations". Update /settings/llm.`)
    process.exit(1)
  }

  const dataset = readDataset()
  const samples = pickSamples(dataset)
  if (samples.length !== 20) {
    console.error(`[runner] expected 20 samples, got ${samples.length}. Check dataset / CATEGORY_PICK.`)
    process.exit(1)
  }
  console.log(`[runner] image_model=${imageModel.model} (${imageModel.api_format} / ${imageModel.endpoint_kind})`)
  console.log(`[runner] picked ${samples.length} products: ${samples.map((s) => s.pid).join(', ')}`)
  console.log(`[runner] estimated cost: 60 calls × ~$0.04 = ~$2.4 / ¥17`)

  // TODO Task 8: per-experiment loop
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 7.3: Verify tsc passes**

```bash
npx tsc --noEmit
# Expected: 全绿
```

- [ ] **Step 7.4: Run skeleton dry — config-missing path**

```bash
npx tsx scripts/run-pcw-image-samples.ts
# Expected (gpt-image-1 LLM config 还没加): 输出 "missing LLM config: gpt-image-1" 然后 exit 1
```

- [ ] **Step 7.5: Commit**

```bash
git add scripts/run-pcw-image-samples.ts
git commit -m "$(cat <<'EOF'
feat(scripts): add run-pcw-image-samples runner skeleton

Mirror of run-pcw-samples but for gpt-image-1 image gen. Skeleton
only — config gate + dataset read + deterministic pickSamples (20 per
fixed CATEGORY_PICK distribution). Per-experiment loop follows in
next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire runner main loop — callLlm + saveImagesForTask + write results

**Files:**
- Modify: `scripts/run-pcw-image-samples.ts`

- [ ] **Step 8.1: Add per-experiment loop (replace `// TODO Task 8` line)**

After the `console.log(...)` of estimated cost, add:

```typescript
  let totalSuccess = 0
  let totalFailed = 0
  let totalSkipped = 0
  const t0 = Date.now()

  for (const exp of EXPERIMENTS) {
    console.log(`\n[runner] === ${exp.id} (schema=${exp.schemaId}) ===`)
    const schemaPath = path.join(SEEDS, 'schemas', `${exp.schemaId}.json`)
    const schema = JSON.parse(fsSync.readFileSync(schemaPath, 'utf8'))
    const promptTemplate = schema.default_prompt as string

    const resultsDir = path.join(DATA, 'results', exp.id)
    await fs.mkdir(resultsDir, { recursive: true })
    const resultsPath = path.join(resultsDir, 'results.jsonl')

    // Skip-if-exists：read existing task_ids
    const existingTaskIds = new Set<string>()
    if (fsSync.existsSync(resultsPath)) {
      const lines = fsSync.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try { existingTaskIds.add((JSON.parse(line) as any).task_id) } catch {}
      }
    }

    for (const sample of samples) {
      const taskId = `${exp.id}:${sample.pid}`
      if (existingTaskIds.has(taskId)) {
        totalSkipped++
        process.stdout.write('s')
        continue
      }

      // Render prompt with sample values
      const features = sample.core_features.join('、')
      const renderedPrompt = promptTemplate
        .replace(/\{\{name\}\}/g, sample.name)
        .replace(/\{\{category\}\}/g, sample.category)
        .replace(/\{\{price\}\}/g, sample.price)
        .replace(/\{\{features\}\}/g, features)
        .replace(/\{\{target_user\}\}/g, sample.target_user)

      const baseRecord = {
        task_id: taskId,
        experiment_id: exp.id,
        schema_id: exp.schemaId,
        schema_version: 1,
        input_refs: { p: sample.pid },
        input_preview: { p: sample },
        prompt_excerpt: renderedPrompt.slice(0, 200),
        timestamp: new Date().toISOString(),
        model: imageModel.model,
      }

      const tStart = Date.now()
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 120_000)
        const resp = await callLlm({
          messages: [{ role: 'user', content: renderedPrompt }],
          config: imageModel,
          model: imageModel.model,
          temperature: 1,
          max_tokens: 1,
          signal: ac.signal,
        })
        clearTimeout(timer)
        const latency_ms = Date.now() - tStart

        if (!resp.images || resp.images.length === 0) {
          const rec = { ...baseRecord, status: 'error' as const, error: 'no images returned', latency_ms }
          await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
          totalFailed++
          process.stdout.write('F')
          continue
        }

        const savedPaths = await saveImagesForTask({
          experimentId: exp.id,
          taskId,
          images: resp.images,
        })
        const output = assignImagePathsToOutput({}, schema.output_schema, savedPaths)
        // Optional caption from response.content (most image gen returns text alongside)
        if (resp.content && typeof resp.content === 'string' && resp.content.trim()) {
          (output as any).caption = resp.content.slice(0, 200)
        }

        const rec = {
          ...baseRecord,
          status: 'success' as const,
          output,
          latency_ms,
          input_tokens: resp.usage?.prompt_tokens ?? 0,
          output_tokens: resp.usage?.completion_tokens ?? 0,
        }
        await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
        totalSuccess++
        process.stdout.write('.')
      } catch (e) {
        const latency_ms = Date.now() - tStart
        const error = e instanceof Error ? e.message : String(e)
        const rec = { ...baseRecord, status: 'error' as const, error, latency_ms }
        await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
        totalFailed++
        process.stdout.write('F')
      }
    }
    process.stdout.write('\n')
  }

  const wallSec = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\n[runner] done. success=${totalSuccess} fail=${totalFailed} skipped=${totalSkipped} wall=${wallSec}s`)
  console.log(`[runner] results in data/results/{pcw_xhs|douyin|friends}_image_baseline/`)
  console.log(`[runner] next: run strip + copy to seeds (Task 12)`)
```

- [ ] **Step 8.2: Verify tsc passes**

```bash
npx tsc --noEmit
```

- [ ] **Step 8.3: Commit**

```bash
git add scripts/run-pcw-image-samples.ts
git commit -m "$(cat <<'EOF'
feat(scripts): wire run-pcw-image-samples main loop

callLlm (images_generations) → saveImagesForTask → write results.jsonl
with rendered prompt_excerpt + input_preview + image_url. Skip-if-exists
on task_id, 120s per-call timeout, status=error captured per call.
Caption opportunistically pulled from resp.content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire npm script + verify config-missing gate

**Files:**
- Modify: `package.json`

- [ ] **Step 9.1: Read package.json scripts section**

```bash
grep -n "run:pcw-samples\|\"scripts\"" package.json | head -5
```

- [ ] **Step 9.2: Add `run:pcw-image-samples` script**

Locate the `"scripts"` block in package.json and add (right after the existing `"run:pcw-samples"` line):

```json
    "run:pcw-image-samples": "tsx scripts/run-pcw-image-samples.ts",
```

(maintain trailing comma JSON syntax.)

- [ ] **Step 9.3: Verify**

```bash
grep "run:pcw-image-samples" package.json
# Expected: 找到一行
npm run | grep run:pcw-image
# Expected: 列出 run:pcw-image-samples
```

- [ ] **Step 9.4: Run via npm to confirm config-gate path**

```bash
npm run run:pcw-image-samples
# Expected: "[runner] missing LLM config: gpt-image-1" then exit 1
```

- [ ] **Step 9.5: Commit**

```bash
git add package.json
git commit -m "feat(scripts): wire npm run run:pcw-image-samples

Mirror npm run run:pcw-samples for image suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: USER STEP — Add gpt-image-1 LLM config in evalyst

**This task is performed by the human user, not the agent. Agent should announce and wait.**

**Files:** none (config UI step). Result: `data/llm-config.json` gets a new entry.

- [ ] **Step 10.1: Announce step to user**

> "PR #2 runner ready. Need user to add gpt-image-1 LLM config now. Boot dev server and follow these steps."

- [ ] **Step 10.2: User performs (provide instruction):**

1. `npm run dev` (start dev server)
2. Browser → `http://localhost:3000/settings/llm`
3. Click "+ 新增"
4. Fill the form:
   - **Model name (model 字段)**: `gpt-image-1`
   - **Endpoint kind**: `images_generations` (dropdown)
   - **Base URL**: `https://aigc.sankuai.com/v1/openai/native`
   - **API format**: `openai`
   - **API key**: `Bearer 1983731511187542037` (paste full string with `Bearer ` prefix; sankuai gateway accepts Bearer through openai-native endpoint)
   - **Pricing**: leave blank (runner doesn't depend on it)
5. Save → close form

- [ ] **Step 10.3: Verify config landed**

```bash
grep -A 3 "gpt-image-1" data/llm-config.json
# Expected: 看到 model=gpt-image-1, endpoint_kind=images_generations, base_url=https://aigc.sankuai.com/v1/openai/native
```

- [ ] **Step 10.4: Stop dev server (ctrl-c)**

不需要 commit（config 在 data/，不进 git；data/llm-config.json 已在 .gitignore 内）。

---

## Task 11: Run runner end-to-end (real API, ~10 min, ~¥17)

**Files:**
- Create: `data/results/pcw_xhs_image_baseline/{results.jsonl, images/*.png}`
- Create: `data/results/pcw_douyin_image_baseline/{results.jsonl, images/*.png}`
- Create: `data/results/pcw_friends_image_baseline/{results.jsonl, images/*.png}`

- [ ] **Step 11.1: Confirm pre-conditions**

```bash
ls src/lib/seeds/datasets/product_copywriting_v1.jsonl    # exists, 60 lines
ls src/lib/seeds/schemas/pcw_xhs_image_v1.json            # exists
ls src/lib/seeds/experiments/pcw_xhs_image_baseline.json  # exists
grep "gpt-image-1" data/llm-config.json                   # exists
```

- [ ] **Step 11.2: Run runner**

```bash
npm run run:pcw-image-samples 2>&1 | tee /tmp/pcw-image-runner.log
# Expected: ~10 minutes wall, prints dots (success) / F (fail) per record
# Final line: success=N fail=M skipped=0 wall=600s (or so)
```

- [ ] **Step 11.3: Verify results landed**

```bash
wc -l data/results/pcw_xhs_image_baseline/results.jsonl    # ≈ 20 (some F + some success)
ls data/results/pcw_xhs_image_baseline/images/ | wc -l     # ≈ N success records' images
```

- [ ] **Step 11.4: Inspect cost (from runner log + sankuai dashboard)**

Expected total: ~¥17 (60 calls × ~$0.04 / ~¥0.28). If wildly off, halt + investigate.

- [ ] **Step 11.5: Spot-check one image**

```bash
# pick a random task_id from results
head -1 data/results/pcw_xhs_image_baseline/results.jsonl | python3 -c "import json,sys;r=json.load(sys.stdin);print(r.get('output',{}).get('image_url'),r.get('status'))"
# Expected: /api/results/pcw_xhs_image_baseline/images/xxx.png + status=success
ls data/results/pcw_xhs_image_baseline/images/ | head -3   # 看到 PNG 文件
```

不需要 commit（data/ 在 .gitignore，下一 task 拷贝到 seeds/ 再 commit）。

---

## Task 12: Strip status≠success + copy to seeds + commit

**Files:**
- Create: `src/lib/seeds/results/pcw_xhs_image_baseline/{results.jsonl, images/*.png}`
- Create: `src/lib/seeds/results/pcw_douyin_image_baseline/{results.jsonl, images/*.png}`
- Create: `src/lib/seeds/results/pcw_friends_image_baseline/{results.jsonl, images/*.png}`

- [ ] **Step 12.1: Strip status≠success from each results.jsonl**

```bash
for exp in pcw_xhs_image_baseline pcw_douyin_image_baseline pcw_friends_image_baseline; do
  src="data/results/$exp/results.jsonl"
  if [ ! -f "$src" ]; then echo "missing $src"; exit 1; fi
  before=$(wc -l < "$src")
  jq -c 'select(.status == "success")' "$src" > "${src}.stripped"
  after=$(wc -l < "${src}.stripped")
  echo "$exp: $before → $after"
  mv "${src}.stripped" "$src"
done
```

(macOS jq comes with brew; if missing, install via `brew install jq` or rewrite as `python3 -c "..."`.)

- [ ] **Step 12.2: Copy seeds tree (jsonl + images)**

```bash
mkdir -p src/lib/seeds/results
for exp in pcw_xhs_image_baseline pcw_douyin_image_baseline pcw_friends_image_baseline; do
  rm -rf "src/lib/seeds/results/$exp"
  cp -r "data/results/$exp" "src/lib/seeds/results/$exp"
done
ls src/lib/seeds/results/pcw_xhs_image_baseline/
ls src/lib/seeds/results/pcw_xhs_image_baseline/images/ | head -3
# Expected: results.jsonl + images/ dir + N PNGs
```

- [ ] **Step 12.3: Verify seeds size sane**

```bash
du -sh src/lib/seeds/results/pcw_*_image_baseline/
# Expected: each 2-5 MB total (jsonl small + images ~150 KB each × N)
```

If any single experiment > 15 MB, investigate (gpt-image-1 should output ~150 KB PNGs; large outputs suggest non-PNG mime or unexpected size).

- [ ] **Step 12.4: Verify image_url paths point at the right place (sanity)**

```bash
head -1 src/lib/seeds/results/pcw_xhs_image_baseline/results.jsonl | python3 -c "
import json,sys
r = json.load(sys.stdin)
url = r['output']['image_url']
assert url.startswith('/api/results/pcw_xhs_image_baseline/images/'), f'bad url: {url}'
print('OK', url)
"
```

- [ ] **Step 12.5: Commit**

```bash
git add src/lib/seeds/results/pcw_xhs_image_baseline src/lib/seeds/results/pcw_douyin_image_baseline src/lib/seeds/results/pcw_friends_image_baseline
git status   # confirm staged file count + size estimate
git commit -m "$(cat <<'EOF'
feat(sample): ship 60 pcw image baseline records + 60 images

Stripped status!=success per lessons §6.4 #4 ("demo 是橱窗"). Each
experiment ~20 success records (some calls may have failed). image
PNGs co-located in seeds/results/{exp}/images/ so first-boot
seedResultsTree() populates runtime correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Browser QA — lessons-respecting verification

**Files:** none (browser verification only)

- [ ] **Step 13.1: Boot dev server with seed copy fresh**

```bash
# Wipe runtime data/results/ to force seedResultsTree() re-copy on boot
rm -rf data/results/pcw_*_image_baseline
npm run dev
```

- [ ] **Step 13.2: Confirm seed copied to runtime**

After dev server boots once (visit any page), verify:
```bash
ls data/results/pcw_xhs_image_baseline/
# Expected: results.jsonl + images/
```

- [ ] **Step 13.3: Visit `/experiments/pcw_xhs_image_baseline`**

Expected:
- 详情页加载完毕，看到 ~20 行结果
- 每行 row header 显示「商品 / 目标用户 / 价 / 核心卖点」4 个字段（lessons §6.4 #3 红线）
- 每行右侧（或下方，按 single_list 布局）渲染一张 4:5 配图
- 图正常显示（不 404 / 不 broken icon）
- **30 秒外行验收**：让一个不熟悉 evalyst 的人看 5 秒，问"这页面在干嘛"——答得出"模型给商品配图"即过

- [ ] **Step 13.4: Toolbar 看到「对比 (vs 2)」按钮（PR #97 ship 的）**

Click → 跳转到 `/compare`，自动预选另外两个 baseline (douyin / friends)。

- [ ] **Step 13.5: 在 `/compare` 页验证三栏横排**

Expected:
- 同一商品占一行，三列分别显示 xhs / douyin / friends 配图
- row header 显示商品参数
- 三列图风格差异肉眼可见（4:5 vs 9:16 vs 1:1；插画 vs 封面 vs 生活感）

- [ ] **Step 13.6: 试一行 annotation panel（"留给用户手打"路径）**

Click 任意 row → annotation panel 弹出 → 可以选 rubric / 输入分数 → save 后 annotation 落 `data/annotations/...` (不进 ship)

- [ ] **Step 13.7: 检查 console 无 warning / error**

Browser DevTools console: 应只看到 dev server 的正常 boot 日志，没有 React warning / 404 / image load error。

- [ ] **Step 13.8: 关掉 dev server**

不需要 commit（QA 阶段不改文件）。

---

## Task 14: Five-checks all green

**Files:** none (just verification)

- [ ] **Step 14.1: Run all five checks**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip
# Expected: 全绿
```

If 任一不绿：
- `tsc` 报错 → 修 type error
- vitest fail → 修测试或 fix code
- lint → `npm run lint -- --fix` 试自动修
- build fail → 看 next.js build log
- knip 报 unused export → 该删的删，runner 的 helper export 注意排除

修完 → 重跑确认绿。每修一类 issue 单独一次 commit。

- [ ] **Step 14.2: 跑 e2e (vision-gate.spec.ts 必须仍绿)**

```bash
npm run test:e2e -- e2e/vision-gate.spec.ts
# Expected: pass，证明 image_gen_v1 fixture 没被误改
```

- [ ] **Step 14.3: Optional - 跑全 e2e**

```bash
npm run test:e2e
# Expected: 全绿 (PR #2 没新增 e2e spec，不该 break 任何现有 spec)
```

不需要单独 commit（这步是 verification，commit 已在 Task 14.1 各修复段散落）。

---

## Task 15: Update CHANGELOG `[Unreleased]`

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 15.1: Read current CHANGELOG `[Unreleased]` section**

```bash
sed -n '/## \[Unreleased\]/,/## \[/p' CHANGELOG.md | head -30
```

- [ ] **Step 15.2: Add entry under `### Added`**

If `[Unreleased]` already has `### Added`, append:

```markdown
- **Sample · 商品配图 (生图) suite** — 3 schemas (`pcw_xhs_image_v1` / `pcw_douyin_image_v1` / `pcw_friends_image_v1`) + 3 baseline experiments × gpt-image-1 × 20 records 每个 = 60 records 共。复用 v2 `product_copywriting_v1` dataset，不带 judge / 不带 annotations（lessons §6.4 #6 红线 buffer，业务评测员手打）。配套 `npm run run:pcw-image-samples` runner。同 stream PR #2 of 3。
```

If `[Unreleased]` has only header, add:

```markdown
## [Unreleased]

### Added

- **Sample · 商品配图 (生图) suite** — ...（同上）
```

- [ ] **Step 15.3: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs(changelog): add pcw image sample suite to [Unreleased]

Sample-data-redesign stream PR #2 of 3 — 60 image gen records
across 3 prompt styles. No judge / no annotations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Push branch + open PR

**Files:** none (git remote + PR)

- [ ] **Step 16.1: Push branch**

```bash
git push -u origin feat/sample-pcw-image
```

If push fails due to network / proxy, use:
```bash
HTTPS_PROXY=127.0.0.1:7890 git push -u origin feat/sample-pcw-image
```

- [ ] **Step 16.2: Open PR**

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat(sample): pcw image suite (PR #2 of stream)" --body "$(cat <<'EOF'
## Summary

- Sample-data-redesign stream PR #2 of 3 (生图场景)
- 3 schemas + 3 baselines × gpt-image-1 × 20 records 每 = 60 records
- 复用 v2 `product_copywriting_v1` dataset (60 条手编商品参数)
- 不带 judge / 不带 annotations (lessons §6.4 #6 红线 buffer，业务评测员手打)
- 配套 `npm run run:pcw-image-samples` runner

## Why

镜像 v2 商品文案 demo 的「跨 prompt 对比」叙事到生图场景。业务评测员看完 v2 demo + PR #2 demo → 理解 evalyst 的对比框架对**任意 LLM 任务**（文本 / 图像）通用。

Spec：`docs/superpowers/specs/2026-05-13-sample-pcw-image-design.md`
Plan：`docs/superpowers/plans/2026-05-13-sample-pcw-image.md`

## How to verify

- [ ] tsc / vitest / lint / build / knip 五件套全绿
- [ ] e2e/vision-gate.spec.ts 仍绿（image_gen_v1 fixture 未误改）
- [ ] 浏览器进 `/experiments/pcw_xhs_image_baseline` → 20 行图 + header_fields 显示商品 / 目标用户 / 价 / 核心卖点
- [ ] 浏览器 toolbar「对比 (vs 2)」→ /compare 三栏横排，xhs / douyin / friends 风格差异肉眼可分
- [ ] 任意 row → annotation panel 可弹出（"留给用户手打"路径通畅）

## Backwards-compat risk

无。新加 3 schemas / 3 experiments / 1 script / 60 records / 60 PNGs (~9 MB seeds 体积增量)。不修改任何现有资源；image_gen_v1 / image_prompts_v1 (e2e fixture) 保留不动。

## Plan deviation

- 新加 `npm run run:pcw-image-samples` 脚本 — 严格说不算 deviation，是 brief 内必要工程；与 v2 `run:pcw-samples` 平行。

## Tag plan

不打 tag。PR #2 + 后续 PR #3（多 display 形态覆盖）一起 promote 到 v0.17.0。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 16.3: Confirm PR URL** — print returned URL，user 手动浏览验收 PR diff。

不需要 commit（gh 行为，无文件改动）。

---

## Self-review checklist (engineer 完成所有 Task 后跑一遍)

- [ ] 所有 Task 都 commit 干净，git log 一行一意图
- [ ] 没有 placeholder / TODO 留在代码或 spec / plan
- [ ] PR description 「## Plan deviation」段写明（没 deviation 就写 "无"）
- [ ] CHANGELOG `[Unreleased]` 有条目，**没误打 tag**
- [ ] `data/results/pcw_*_image_baseline/` 不进 git（在 .gitignore 内或 git status 不出现）
- [ ] `src/lib/seeds/results/pcw_*_image_baseline/{results.jsonl, images/}` 都进 git
- [ ] image PNGs 总 size ≤ 15 MB 增量（合理范围）

---

*plan written 2026-05-13, awaiting execution-mode choice.*
