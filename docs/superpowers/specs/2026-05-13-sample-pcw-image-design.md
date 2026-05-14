# Sample Data Stream PR #2 · 商品配图（生图）· Design Spec

- **Date**: 2026-05-13
- **Status**: 📝 **DRAFT** — spec 待 user review → 进 writing-plans
- **Author**: Claude（with kuen54）
- **Predecessors**:
  - [v1 失败 lessons](../findings/2026-05-13-sample-data-redesign-lessons.md)
  - [v2 spec · 商品文案改写](2026-05-13-sample-pcw-copywriting-design.md)（已 ship v0.16.0）
- **Stream**: sample-data-redesign · **PR #2 of 3**（剩余 PR #3 多 display 形态覆盖）

## 0. 一句话产品定位

**业务评测员**（同 v2 受众）已经看过"商品文案改写"v2 demo，知道 evalyst 能跑「跨 prompt 对比」。PR #2 用同一商品 dataset 给他**第二个 demo**：跨 prompt 风格生图（小红书插画 / 抖音封面 / 朋友圈生活感），让他确认 evalyst 这套对比框架对**生图 LLM** 同样适用，进而**动手建自己第一个生图 evaluation**。

## 1. lessons §6.4 硬约束 checklist（这次必须满足）

- [x] input ≤ 200 字（复用 v2 dataset，已满足）
- [x] output schema ≤ 5 字段（实际 2 字段：image_url / caption）
- [x] **避开多模态 judge**（lessons §6.4 #6 红线）→ **不 judge / 不 ship annotations**，用户进 evalyst annotation UI 自打分
- [x] 跨场景内聚（同一类业务任务的多个 prompt 风格变体）
- [x] 30-60 条够 demo（实际 60 records = 20 × 3 schemas）
- [x] 可手工编（dataset 复用 v2 已编好的 60 条）
- [x] 避开 kimi（只用 gpt-image-1）
- [x] **每 schema display_dimensions[].header_fields 必填**（lesson 批评 #3 闭环）
- [x] ship 数据全 strip status≠success（demo 是橱窗）
- [x] 验收"30 秒外行能看懂"硬条目
- [x] 预算 ≤ ¥30 / wall ≤ 60 分钟（实际目标 ¥3-5 / 10 分钟，比 v2 还省）

> **特殊豁免说明**：lessons §6.4 #6 同时警告"不要碰多模态（图 / vision judge）"。PR #2 是 user 明确指派的 backlog 项**就是要做生图**——本质是部分豁免该约束。豁免的具体范围与代价：
>
> - 豁免：carry 一次「多模态 output（生图）」 demo，作为 user 显式 backlog 项
> - **不豁免**：vision judge / 多模态 input task / 学术 prompt benchmark（PartiPrompts 等）—— 这三条在 PR #2 仍严格遵守
> - 决策依据：lessons §6.4 #6 红线服务的根本目标是"避免重蹈 v1 用户看不懂"——PR #2 通过「业务向 prompt + 复用业务向 dataset + 不 judge 留给用户手打」来满足根本目标，不是机械套字面规则

## 2. Sample suite 总体结构

| Resource | Id | 来源 | 数量 |
|---|---|---|---|
| Dataset | `product_copywriting_v1` | **复用 v2 ship 的 60 条**（不重写）| 60 条 |
| Schemas（同 `compare_group: "product_image_v1"`）| `pcw_xhs_image_v1` / `pcw_douyin_image_v1` / `pcw_friends_image_v1` | 镜像 v2 命名 + 文案的"配图版" | 3 |
| Rubric | — | **不写**（不 judge）| 0 |
| Judge prompt | — | **不写**（不 judge）| 0 |
| Sample experiments | `pcw_xhs_image_baseline` / `pcw_douyin_image_baseline` / `pcw_friends_image_baseline` | 每 schema 一个 | 3 |
| Annotations | — | **不 ship**（用户自打）| 0 |
| Total records | — | 20 records × 3 schemas × gpt-image-1 | 60 |

**Display 形态**: 隐式推断 → `builtin_single_list`。view-helpers.tsx:73-93 已支持 `image_url` 类型字段的 `<img>` 渲染，**不需要 user JSX display**。

**与 PR #95 ship 的 `image_prompts_v1` / `image_gen_v1` 关系**：**已删除**（user 反馈 sample data 不应包含这些）。`e2e/vision-gate.spec.ts` 改为 `writeFixtures()` self-provisions minimal `image_gen_v1` schema 文件 + `clearFixtures()` 清掉，不再依赖 seeds 提供。Sample seeds 现在只有 2 schemas: `pcw_text_v1` + `pcw_image_v1` (+ evalyst 自带的 `qa_answer_v1`)。

## 3. Dataset（复用 v2，不动文件）

`product_copywriting_v1` 已 ship 在 `src/lib/seeds/datasets/product_copywriting_v1.{meta.json,jsonl}`，60 条 / 6 品类（美妆 / 数码 / 食品饮料 / 家居 / 服饰 / 母婴）/ 字段 pid + name + category + price + core_features + target_user + target_user。

**抽 20 条策略**：
- schema `inputs[].filters` 的 `limit` filter **不设 defaultValue**（与 v2 schema 一致：UI 显示空，blank=all 跑全 60）
- 由 sample experiment meta `filter_values.limit=20` 决定实际跑的 limit
- runner 按 dataset 行号顺序读 60 条，**确定性分配**：美妆 4 / 数码 4 / 食品饮料 4 / 家居 4 / 服饰 2 / 母婴 2 = 共 20（每类前 N 条，N 在 runner 常量里硬编）
- user 在 evalyst UI 进实验后可手动改 limit 跑全 60 条（dataset 完整保留）

**抽样确定性**：runner 按文件行号读，不随机。同一 dataset 多次跑 ship 的 results 完全一致。

## 4. Schemas（3 个，同 `compare_group: "product_image_v1"`）

### 4.1 共用结构

```json
{
  "id": "<pcw_*_image_v1>",
  "label": "商品配图 · <平台风>",
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
  "default_prompt": "<see 4.2-4.4>",
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

`caption` 是可选字段——让模型随手描述"我画了什么"，业务评测员看图前能先看一句"模型自认为画的是啥"，体验更完整。模型不输出也不影响。

### 4.2 `pcw_xhs_image_v1` · 小红书插画风（1:1 方图）

**default_prompt**:

```
你是商品配图设计师。请为这个商品生成一张小红书风的种草配图。

风格要求：
- 1:1 方图
- ins 插画 / 手账 / 少女系，柔和暖色调
- 商品居中或左上偏置，留白舒适
- 不要硬商业感，要"在博主手里"的随性场景感
- 不放任何文字 / 标题 / logo（小红书图片靠 caption 不靠图内字）

商品参数：
- 名：{{name}}
- 品类：{{category}}
- 价：{{price}}
- 核心卖点：{{features}}
- 目标用户：{{target_user}}

直接生图。
```

### 4.3 `pcw_douyin_image_v1` · 抖音封面风（1:1 方图高对比商业感）

**default_prompt**:

```
你是抖音视频封面设计师。请为这个商品生成视频封面图。

风格要求：
- 1:1 方图
- 商业感强，高饱和、高对比、视觉冲击
- 商品占比要大（封面就要看到货）
- 不放任何文字 / 标题 / 价签 / logo（生图模型中文字渲染不稳，避开）
- 通过视觉符号（光晕 / 强反差 / 突出感）建立"封面"感，不靠文字

商品参数：
- 名：{{name}}
- 品类：{{category}}
- 价：{{price}}
- 核心卖点：{{features}}
- 目标用户：{{target_user}}

直接生图。
```

### 4.4 `pcw_friends_image_v1` · 朋友圈生活感（1:1 方图）

**default_prompt**:

```
你是个普通人，刚买了这个东西想发朋友圈。

风格要求：
- 1:1 方图（朋友圈默认）
- 手机随手拍质感：自然光、桌面 / 窗台 / 手心，略带颗粒感
- 不要影棚布光，不要修图过度的"商品图感"
- 不要文字 / 价签 / 包装贴纸

商品参数：
- 名：{{name}}
- 品类：{{category}}
- 价：{{price}}
- 核心卖点：{{features}}
- 目标用户：{{target_user}}

直接生图。
```

**3 个 prompt 的对比维度**（**全 1:1 统一比例**——纯风格 / 场景对比，不掺比例 / 文字次级变量）:

| 维度 | xhs 插画 | douyin 封面 | friends 生活感 |
|---|---|---|---|
| 比例 | 1:1 方 | 1:1 方 | 1:1 方 |
| 商业感 | 中 | 高 | 低 |
| 风格强度 | 高（插画化）| 高（视觉冲击）| 低（自然） |
| 文字 | 无 | 无 | 无 |
| 商品占比 | 中（留白）| 大（满铺）| 小（场景中）|

→ 业务评测员在 `/compare` 横排看 20 商品 × 3 风格，3 列差异在**风格 + 商品占比**维度上肉眼可分——demo 故事「跨 prompt 选最优」自然成立。

**特意躲开的坑**：
- gemini-2.5-flash-image 中文字渲染不稳——3 prompt 全部明确**不带任何文字**（v1 让 douyin 带中文钩子，实测大部分错字 / 乱码，已撤回到统一无字方案）
- 不放 brand info（dataset 没此字段）—— 不会因 hallucinate 品牌 logo 翻车
- 不要求"白底产品摄影"（gemini 弱项）—— 三个 prompt 都偏插画 / 场景 / 生活感
- 统一 1:1 比例（v1 让 xhs/douyin 走 4:5/9:16，但 sankuai gateway gemini imageGenerate 不接 aspect ratio param，所有图实际都是 1:1，不如显式 align prompt 与实际 output）

## 5. Sample experiments

3 个，全部用 `gemini-2.5-flash-image` 单 model（sankuai gateway google native imageGenerate 端点）。

| Experiment id | Schema | Records | Rubric | Annotations |
|---|---|---|---|---|
| `pcw_xhs_image_baseline` | `pcw_xhs_image_v1` | 20 | null | 不 ship |
| `pcw_douyin_image_baseline` | `pcw_douyin_image_v1` | 20 | null | 不 ship |
| `pcw_friends_image_baseline` | `pcw_friends_image_v1` | 20 | null | 不 ship |

**Meta json 模板**（`src/lib/seeds/experiments/pcw_*_image_baseline.json`）—— shape mirror v2 ship 的 `pcw_xhs_baseline.json` (`ExperimentConfig` 完整字段)：

```json
{
  "id": "pcw_xhs_image_baseline",
  "name": "商品配图 · 小红书风 · gemini-2.5-flash-image baseline",
  "created_at": "2026-05-13T00:00:00Z",
  "updated_at": "2026-05-13T00:00:00Z",
  "schema_id": "pcw_xhs_image_v1",
  "filter_values": { "categories": ["美妆","数码","食品饮料","家居","服饰","母婴"], "limit": 20 },
  "model": "gemini-2.5-flash-image",
  "temperature": 1,
  "max_tokens": 1,
  "api_config": { "base_url": "", "api_key": "" },
  "prompt_template": "(uses schema default_prompt)",
  "status": "completed",
  "notes": "复用 v2 product_copywriting_v1 dataset 抽 20 条商品（每品类 3-4 条），xhs 插画风 prompt × gemini-2.5-flash-image 跑 20 张配图。配套 douyin / friends baseline 共同对比 3 风格。不带 judge / 不带 annotations，留给用户进 evalyst annotation UI 自打分。"
}
```

`api_config` 留空字符串：runner standalone 不走 evalyst llm-client，evalyst UI 上 "重跑" 按钮也跑不通（google native 端点未集成进 evalyst）—— 这是 PR #2 的 known limitation，未来 sub-PR 扩 evalyst google_native_image_generate 端点支持后即解。`temperature=1, max_tokens=1` 是占位值（image gen 不读，但 type 要求非空）；`rubric_id` 字段省略（无 judge）。

**关键 demo 路径（验收）**:

1. user 进 `/`（总览页 = 实验列表）→ 看到 3 个 image baseline 实验（与 v2 三个文案 baseline 平行）
2. 点任一进详情页 → 看到 ~20 行结果（xhs 18 / douyin 20 / friends 20，少数 gateway 拒生成已 strip），每行 row header 显示 商品名 / 目标用户 / 价 / 核心卖点 + 一张 1:1 方图
3. toolbar 看到「**对比 (vs 2)**」按钮（PR #97 ship 的对比入口）
4. 点击 → `/compare` 自动预选 3 个 baseline → 一行同商品三张不同风格图横排
5. 评测员能识别 3 prompt 风格在不同品类上的契合度差异（具体哪种风格对哪个品类最赢，实测时观察，spec 不预判）

## 6. Runner script

`scripts/run-pcw-image-samples.ts`（~250 行 standalone tsx，zero-dep + macOS sips）。**不走 evalyst llm-client**——sankuai gateway 的 `gemini-2.5-flash-image` 走 google native 端点（异步 submit + poll），evalyst 现在的 `endpoint_kind=images_generations` 只支持 OpenAI Images API。runner 直接 fetch sankuai gateway。

**API surface**:
- `POST https://aigc.sankuai.com/v1/google/models/gemini-2.5-flash-image:imageGenerate` — body `{ "contents": [{ "parts": [{ "text": "..." }] }] }`，header `Authorization: <raw-key>`（不带 Bearer 前缀），返回**纯字符串 task_id**（不是 JSON）
- `GET https://aigc.sankuai.com/v1/google/models/{taskId}:imageGenerateQuery` — 同 auth，返回 `{ status: 1=done, data: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] }, finishReason }], usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } } }`
- 图返回**公开 https URL**（`https://s3plus.vip.sankuai.com/aigc-public-resources/gemini-image-generate/{taskId}.png`），不是 base64 inline

**逻辑**:

1. 读 `process.env.SANKUAI_KEY`（缺则 exit 1，不 fallback）
2. 读 `src/lib/seeds/datasets/product_copywriting_v1.jsonl`（60 条），按品类配额抽 20 条（美妆/数码/食品饮料/家居 × 4 + 服饰/母婴 × 2）
3. 对 3 schemas × 20 records，每条：submit imageGen → poll until `status=1` → 下载 https URL → `sips -Z 768` resize 到长边 768px → 写盘
4. 写 `data/results/{exp_id}/results.jsonl`（`output.image_url` 字段填 `/api/results/{exp_id}/images/{pid}.png`）+ `data/results/{exp_id}/images/{pid}.png`
5. **strip status≠success**（lessons §6.4 #4）—— Task 12 单独 step
6. 拷贝到 `src/lib/seeds/results/{exp_id}/{results.jsonl, images/}` ship 进 git —— Task 12

**关键约定**:
- **Rate limit**: sankuai gateway 给 `gemini-2.5-flash-image` 的 RPM = 5。runner 内置 sliding-window submit limiter（60s 窗口最多 5 个 submit），query polling 5s 间隔（observed empirically 不算入 RPM）
- **Resize**: 原图 1024×1024 PNG ~2 MB × 60 = ~120 MB 进 git 太重；用 macOS `sips -Z 768` resize 到长边 768px → ~250-400 KB/张 × 60 = ~20 MB seeds 增量。可接受
- **Image binary 进 git**（seeds/ 下）：约 20 MB。git 中 `results.jsonl` 存 `/api/results/{exp_id}/images/{pid}.png` 路径，配套 PNG 进 `src/lib/seeds/results/{exp_id}/images/`。第一次启动 evalyst 时 PR #96 `seedResultsTree()` 递归 copy 到 runtime
- **runner 可重入（skip-if-exists）**：同 task_id 的 results 行已存在则跳过
- **240s poll timeout / task**（image gen 单次实测 9-30s 完成；240s 给重试空间）
- **Auth via env var** `SANKUAI_KEY`，不进 git

**预算追踪**:
- 60 records / 5 RPM ≈ 12 分钟 submit + poll 等图 5-10s/张 → wall ≈ 15-25 min（取决于 polling latency）
- usageMetadata 有 promptTokenCount / candidatesTokenCount，记录到 results.jsonl 但 PR #2 不算具体钱（gemini image 内部 quota，无明确每条价格表）

**npm script**:
- `package.json` 加 `"run:pcw-image-samples": "tsx scripts/run-pcw-image-samples.ts"`，平行 v2 `run:pcw-samples`

## 7. 不带 judge 的设计取舍

**选择不 ship annotations 的理由**:

1. **lessons §6.4 #6 红线 buffer**——vision judge 是该红线明确禁止的项；文本 judge "评 prompt 而非评图"叙事错位。**不 judge** 是唯一既 lessons-respecting 又叙事一致的路径
2. **业务评测员真实工作流**——他们的 day-1 工作就是"看图打分"。Demo 直接呈现这个工作流（看 60 张图自己评）比"看 LLM judge 已打好的分"更贴
3. **凸显 evalyst「人标注」能力**——v2 demo 已展示 LLM-judge 能力，PR #2 反过来 demo「人标注」UI（rubric_annotator.tsx 已存在的能力），覆盖更全
4. **预算更省**——judge 跑 60 calls × 4o-vision 估 ¥10-15。不 judge 直接省下

**用户进 UI 标注路径**（验收时手测）:
- 进 `/experiments/pcw_xhs_image_baseline` 详情页
- 点任意 row → 弹出 annotation panel
- 手工选 rubric（可选 v2 ship 的 `pcw_quality` 或自建）
- 给 5 维评分 → save → annotation 进 `data/annotations/{exp_id}/annotations.jsonl`

注：不在 PR #2 scope 内提供 rubric。如果用户想用 v2 ship 的 `pcw_quality` rubric 标这些 image，evalyst UI 已支持（rubric 与 schema 通过 `rubric_id` 字段松耦合，annotation UI 不强制 schema/rubric 1:1）。

## 8. Runner auth setup（用户操作 / runner 校验）

PR #2 runner 通过 `SANKUAI_KEY` env var 读取 sankuai gateway raw token（不带 Bearer 前缀，因为 google native 端点直接收 raw key）。**不写进 evalyst `data/llm-config.json`**——evalyst 的 LLM config 给 chat / OpenAI Images 用，google native imageGenerate 路径未集成。

**用户操作**:

```bash
SANKUAI_KEY=1983731511187542037 npm run run:pcw-image-samples
```

**Runner 启动时校验**: 读 `process.env.SANKUAI_KEY`，缺则 print:
```
[runner] missing SANKUAI_KEY env var
[runner] usage: SANKUAI_KEY=xxxxx npm run run:pcw-image-samples
exit 1
```

> Future improvement（不在 PR #2 scope）：扩 evalyst 加 `endpoint_kind = 'google_native_image_generate'` 到 llm-client.ts，sample experiment meta 走标准 callLlm 路径，evalyst UI 上"重跑"按钮也能跑。独立 sub-PR。

## 9. 验收（lessons §6.4 闭环）

**Spec / Plan 阶段**:
- [ ] 3 schemas display_dimensions[].header_fields 4 字段齐全
- [ ] 3 sample experiment meta json `rubric_id: null`
- [ ] runner 启动校验 LLM config 缺失 fail-fast
- [ ] PR description "## Plan deviation" 段声明 `image_prompts_v1` + `image_gen_v1` 删除

**Runner 阶段**:
- [ ] 跑前预算估算 print（确认 user 看到 ~¥17 范围）
- [ ] 60 calls 全 status=success，git ship 0 条 status≠success
- [ ] image 落 `data/images/{exp_id}/{task_id}.png`，git 不进 binary
- [ ] runner 可重入（中断后再跑跳过已完成）

**浏览器实测阶段**:
- [ ] 进 `/experiments/pcw_xhs_image_baseline` 详情页 → 30 秒外行能看懂任务（显示商品 + 大图）
- [ ] toolbar 「对比 (vs 2)」按钮可见，点击进 `/compare` 三 baseline 横排
- [ ] /compare 三列同商品图差异肉眼可分（xhs 插画 vs douyin 封面 vs friends 生活感）
- [ ] 任意 row → annotation panel 可弹出（验证「不 judge 留给用户手打」路径通畅）

**五件套**:
- [ ] tsc / vitest / lint / build / knip 全绿
- [ ] e2e（如果新加 spec 则同跑；现有 vision-gate.spec.ts 必须仍绿，验证 image_gen_v1 fixture 没被误删）

**CHANGELOG**:
- [ ] `[Unreleased]` 加 `### Added` 条：「sample-pcw-image suite: 3 schemas + 3 baseline experiments + 60 records (gpt-image-1 image gen, no annotations)」
- [ ] **不打 tag**（PR #2 + PR #3 一起 promote 到 v0.17.0，用户原 prompt 已声明）

## 10. 不在 scope（backlog）

- 跨模型对比（gpt-image-1 vs gemini-2.5-flash-image）—— PR #2 单 model gemini，跨模型对比单独 sub-PR
- **扩 evalyst 加 `endpoint_kind=google_native_image_generate` 端点支持** —— 独立 sub-PR；解后 PR #2 sample experiment 在 evalyst UI 上"重跑"按钮可用
- vision judge / 文本 judge —— lessons-respecting 决策不做
- 多 display 形态（table / triple_grid / jsx 等）—— **PR #3 of stream**
- Brand consistency demo（dataset 加 brand 字段）—— 不在本 PR
- LLM-as-judge UI 改动 —— 不在本 PR
- /compare 行内 mini view（lessons §6.5 推荐方案 B）—— 不在本 PR
- 删除 `image_prompts_v1` / `image_gen_v1` —— **已在 PR #2 后期完成**：seeds + runtime 全删，e2e/vision-gate.spec.ts 改为 self-provision schema fixture (writeFixtures + clearFixtures)，4/4 cases 仍绿

## 11. 与 v2 spec 镜像对照

| 维度 | v2（文案）| PR #2（配图）|
|---|---|---|
| 任务 | 文本生成 | 图像生成 |
| Dataset | product_copywriting_v1（60 条手编）| **复用 v2 同 dataset** |
| Schemas | pcw_xhs_v1 / pcw_douyin_v1 / pcw_friends_v1 | pcw_xhs_image_v1 / pcw_douyin_image_v1 / pcw_friends_image_v1 |
| compare_group | product_copywriting_v1 | product_image_v1 |
| Records | 60 × 3 = 180 | **20 × 3 = 60**（节流） |
| Output 字段 | title / body / hashtags / cta | image_url / caption |
| Rubric | pcw_quality（5 维）| **不 ship** |
| Judge | gpt-4o-mini 文本 | **不 judge** |
| Model | claude-opus-4-6 | gemini-2.5-flash-image (sankuai google native) |
| 预算 | ~¥13 | sankuai gateway gemini quota（无具体每条价格表）|
| Wall | ~30 分钟 | ~15-25 分钟（RPM=5 制约）|
| Annotations | 全 ship | **不 ship**（user 自打）|
| Display | builtin_single_list + header_fields | 同 + image_url 渲染 |

→ PR #2 是 v2 的「视觉镜像 + 节流版本」。叙事补完整：v2 demo 文本生成跨 prompt 对比，PR #2 demo 图像生成跨 prompt 对比，业务评测员看完两个 demo → 理解 evalyst 这套「跨 prompt 对比」框架对**任意 LLM 任务**（文本 / 图像）通用。

## 12. Plan deviation 候选（提前声明）

写 plan 时下列不在 brief 中的 scope 改动需要在 PR description 「## Plan deviation」段声明：

1. **新加 `npm run run:pcw-image-samples` 脚本** (package.json scripts)
   - 与 v2 ship 的 `run:pcw-samples` 平行，便于 user 重跑
   - 严格说不算 deviation，是 brief 内必要工程；写一句对齐 reviewer 心智

不在合理偏离范围（拆 follow-up PR）：
- "顺手"重构 batch-runner 的 image handling 路径——独立 PR
- 改 view-helpers.tsx 的 image 渲染样式（再大、再小、加 placeholder）—— 独立 PR
- 加 brand 字段到 dataset —— PR #3 配套或独立
- **删除 `image_prompts_v1` / `image_gen_v1`（已在 PR #2 后期完成，user 后期 ask）—— e2e/vision-gate.spec.ts 改为 self-provision fixture (write+clear)，4/4 仍绿**

---

*spec written 2026-05-13, awaiting user review → writing-plans transition.*
