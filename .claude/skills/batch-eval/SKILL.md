---
name: batch-eval
description: "端到端驱动 batch-eval（LLM prompt 批量评测平台）。Use when: 用户在 batch-eval 项目里想「从头跑一轮评测」「帮我建数据集+任务+实验一起跑」「调 API 驱动 batch-eval」，或第一次接触项目需要搞清楚心智模型与 API 入口。NOT for: 单独建数据集（用 /batch-eval-dataset）、单独建评测任务（用 /batch-eval-task）、只是改 UI 代码。"
---

# batch-eval · 端到端驱动

本 skill 帮你（Claude）把 batch-eval 平台当作自己的工作台：从配置 LLM 到跑完一轮实验、读结果、打分，全程用 REST API 驱动，用户只需要在 UI 看结果。数据集和评测任务两类资源的详细 JSON shape 委托给 `/batch-eval-dataset` 和 `/batch-eval-task` 两个子 skill。

## 心智模型

平台围绕**四件套 + 评分量表**组织：

```
LLM 模型   →   数据集   →  评测任务   ⟶ 实验 ⟶  展示模板
 endpoint     原料素材    生产逻辑      跑一批    结果呈现方式
                                          ↘
                                           评分量表（可选）→ 人工/LLM 给结果打分
```

| 资源 | 代码类型 | 存储 | API 前缀 |
|---|---|---|---|
| LLM 模型 | `ModelConfig` | `data/llm-config.json` | `/api/llm-config` |
| 数据集 | `DatasetDef + records` | `data/datasets/{id}.meta.json + .jsonl` | `/api/datasets` |
| 评测任务 | `TaskSchema` | `data/schemas/{id}.json` | `/api/schemas` |
| 实验 | `ExperimentConfig` | `data/experiments/{id}.json + data/results/{id}/` | `/api/experiments` |
| 展示模板 | `Display` | `data/displays/{id}.json` | `/api/displays` |
| 评分量表 | `Rubric` | `data/rubrics/{id}.json` | `/api/rubrics` |

**展示模板 95% 的场景不需要手建**——评测任务声明 `display_dimensions` 后，`src/lib/display-inference.ts` 会按维度数自动选内置（single_list / dual_list / triple_grid / bubble_overlay）。

## Step 1 · 前置确认

1. 用 Bash `pwd` 确认工作目录在 batch-eval 项目根（有 `package.json` 且依赖含 `next`）。否则停下来让用户 `cd` 进去。
2. 确认 dev server 在跑：Bash `curl -sf http://localhost:3000/api/llm-config > /dev/null && echo ok`。没起来告诉用户 `npm run dev`。如果 3000 被占，试 `http://localhost:3002`（Next.js 会自动切）。
3. 读 `src/lib/types.ts`（`ExperimentConfig` / `CreateExperimentRequest` / `LlmConfig` / `ModelConfig`）和 `src/lib/schema/types.ts`（`TaskSchema` / `DatasetDef` / `Rubric` / `GenericResultRecord`）作为 API payload 的权威类型定义。

## Step 2 · 三种驱动方式，按场景选

用户让你**从零建一套并跑起来**时，你有三种可组合的路径：

### 路径 A · 全部走 REST API（推荐给「agent 独立驱动」）

适合用户给了完整需求，想让你一口气把资源建好、实验跑起来，只回去 UI 看结果。整套流程在下面 Step 3-7。

### 路径 B · 先调子 skill 产文件，再用 API 跑实验

数据集 / 评测任务这两类资源的 JSON shape 复杂，直接用子 skill 更稳：
- 数据集：调 `/batch-eval-dataset`（产 `data/datasets/{id}.{meta.json,jsonl}`）
- 评测任务：调 `/batch-eval-task`（产 `data/schemas/{id}.json`）

子 skill 产完文件后，平台下次 list 调用会自动扫到（`ensureSeeds()` + listDatasets/listSchemas 幂等扫目录）。你接着跳到 Step 5 用 API 建实验、跑、读结果。

### 路径 C · 手把手让用户在 UI 点

当需求不确定、或用户想自己走一遍熟悉产品时：指给用户去 `/settings/llm` / `/settings/datasets/new` / `/settings/templates/new` / `/experiments/new`。每个页面都有表单 + 子 skill 下载按钮。你在旁边当顾问。

**默认走路径 A 或 B**，除非用户明确说「我想自己点」。

## Step 3 · 配 LLM 模型（必须，首次用前）

```bash
# 查现有配置
curl -s http://localhost:3000/api/llm-config | jq
```

空则引导用户去 `/settings/llm` 填（API key 敏感，不建议由 agent 代填）。如果用户已授权直接写：

```bash
curl -X PUT http://localhost:3000/api/llm-config \
  -H "Content-Type: application/json" \
  -d '{
    "models": [
      {
        "id": "m_abc123",
        "name": "OpenAI gpt-4o-mini",
        "model": "gpt-4o-mini",
        "api_format": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-...",
        "default_temperature": 0.7,
        "default_max_tokens": 800,
        "pricing": { "input_per_mtok": 0.15, "output_per_mtok": 0.6, "currency": "USD" }
      }
    ],
    "active_model_id": "m_abc123"
  }'
```

完整 `ModelConfig` 字段见 `src/lib/llm-config.ts`。`api_format` 只接受 `openai` / `anthropic`。

## Step 4 · 建数据集

**优先调 `/batch-eval-dataset`**。如果用户需求简单，想直接 POST：

```bash
curl -X POST http://localhost:3000/api/datasets \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my_dataset",
    "name": "我的数据集",
    "id_field": "qa_id",
    "fields": [
      { "key": "qa_id", "type": "string" },
      { "key": "question", "type": "string" },
      { "key": "reference", "type": "string" }
    ],
    "records": [
      { "qa_id": "q1", "question": "地球有几个月亮", "reference": "1" },
      { "qa_id": "q2", "question": "水的沸点", "reference": "100°C" }
    ]
  }'
```

返回 201 + `DatasetDef`。校验失败返 400 + `errors[]`，按提示修。

## Step 5 · 建评测任务（TaskSchema）

**优先调 `/batch-eval-task`**。需要时直接 POST `/api/schemas`，payload 就是完整 `TaskSchema`（`src/lib/schema/types.ts`）。字段多，参考 `src/lib/meta-prompts/template.ts` 里的示例。

```bash
curl -X POST http://localhost:3000/api/schemas \
  -H "Content-Type: application/json" \
  -d @/tmp/my_schema.json
```

409 表示 id 冲突，换一个。

## Step 6 · 建实验 + 跑

先估任务数（避免一上来跑几千条）：

```bash
curl -X POST http://localhost:3000/api/estimate \
  -H "Content-Type: application/json" \
  -d '{ "schema_id": "my_schema", "filter_values": { "limit": 5 } }'
# { "task_count": 5 }
```

建实验（`CreateExperimentRequest` 见 `src/lib/types.ts`）：

```bash
curl -X POST http://localhost:3000/api/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-first-run",
    "schema_id": "my_schema",
    "model_id": "m_abc123",
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 800,
    "prompt_template": "<从 schema.default_prompt 拿或自定义>",
    "filter_values": { "limit": 5 },
    "rubric_id": "qa_accuracy"
  }'
# 返回 201 + ExperimentConfig，记住 id
```

触发运行：

```bash
curl -X POST http://localhost:3000/api/experiments/{exp_id}/run \
  -H "Content-Type: application/json" \
  -d '{ "concurrency": 3 }'
# { "status": "started", "total_tasks": 5 }
```

轮询进度：

```bash
curl -s http://localhost:3000/api/experiments/{exp_id}/run | jq
# { completed, total, failed, ... }
```

**agent 驱动时建议 task 少（≤10）一轮跑完再扩量**——跑大量任务前让用户确认，避免烧 api 额度。

## Step 7 · 读结果

```bash
# 全部结果
curl -s "http://localhost:3000/api/experiments/{exp_id}/results" | jq

# 只看失败
curl -s "http://localhost:3000/api/experiments/{exp_id}/results?status=error" | jq
```

返回 `GenericResultRecord[]`（`src/lib/schema/types.ts`）。每条含 `task_id / input_refs / input_preview / output / status / latency_ms / cost_value / cost_currency / error?`。**同 `task_id` JSONL 里取最后一条**（重试会覆盖旧失败）。

失败 task 精准重跑：

```bash
curl -X POST http://localhost:3000/api/experiments/{exp_id}/run \
  -H "Content-Type: application/json" \
  -d '{ "task_ids": ["task_xxx"] }'
```

传 `task_ids` 自动走 resume 语义，累计历史 stats。

## Step 8（可选）· 评分 Rubric + Annotation

建量表：

```bash
curl -X POST http://localhost:3000/api/rubrics \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my_rubric",
    "name": "我的量表",
    "criteria": [
      { "key": "correct", "label": "回答正确", "type": "pass_fail", "required": true },
      { "key": "fluency", "label": "流畅度", "type": "likert_1_5" }
    ]
  }'
```

实验建的时候带 `rubric_id`（Step 6），或后续绑。给单条 result 打分：

```bash
curl -X POST http://localhost:3000/api/experiments/{exp_id}/annotations \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_xxx",
    "rubric_id": "my_rubric",
    "evaluator": "llm",
    "scores": { "correct": true, "fluency": 4 },
    "rationale": "答案和 reference 完全一致"
  }'
```

Annotation 是 **append-only**（同 `(task_id, rubric_id, evaluator)` 可多条，按 timestamp 取最新聚合）。

## Step 9 · 引导用户看 UI

任务跑完后告诉用户：

1. 实验详情页：`http://localhost:3000/experiments/{exp_id}` —— 按 `display_dimensions` 自动呈现
2. 列表页：`http://localhost:3000/` 或 `/settings/templates/{schema_id}`（反查哪些实验用了这个评测任务）
3. 跨实验对比：`/compare`（需要多个实验同 `compare_group`）

## 自我校验

完整跑一轮后检查：

- [ ] 每个 API 返回 status < 400
- [ ] 实验 `status` 最终到 `completed` 或 `paused`（不要停在 `running` 就告诉用户跑完了）
- [ ] `results.jsonl` 里成功条数 ≥ 用户预期下限
- [ ] 失败 task 给出 `error` 字段（不是静默）
- [ ] 如果绑了 rubric，annotation 数 ≥ 预期

## 不在本 skill 范围内

- 数据集的详细 JSON shape → `/batch-eval-dataset`
- 评测任务的详细 JSON shape → `/batch-eval-task`
- 自建 JSX display → 极少场景，用户明确要求再做；参考 `src/lib/meta-prompts/display.ts`
- LLM 厂商 SDK / 多模态图片的消息格式 → `src/lib/llm-client.ts` 已封装，不用操心
- 修 UI 代码 / 改 i18n → 不走 skill，直接对话

## 关键源文件（权威参考）

- `src/lib/types.ts` —— ExperimentConfig / LlmConfig / ModelConfig / CreateExperimentRequest
- `src/lib/schema/types.ts` —— TaskSchema / DatasetDef / Rubric / Annotation / GenericResultRecord / FilterDef / DisplayDimension
- `src/lib/meta-prompts/{dataset,template,display}.ts` —— 三类资源的完整 JSON 示例
- `src/lib/display-inference.ts` —— display 自动推断规则
- `src/lib/llm-client.ts` —— OpenAI / Anthropic 协议封装
- `README.md` —— 面向用户的完整教程，想懂业务语境时读这个
