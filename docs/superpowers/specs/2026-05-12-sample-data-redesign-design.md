# Sample Data Redesign · Design Spec

- **Date**: 2026-05-12
- **Status**: Draft（pending user review）
- **Author**: Claude（with kuen54）
- **Related plan**: TBD（生成于 spec 批准后）

## 0. 背景与目标

### 现状问题

当前 evalyst 的 starter sample 仅有 2 套：

- `qa_pairs`（12 条 trivia QA） + `qa_answer_v1` schema + `qa_accuracy` rubric（pass/fail + 1 likert）
- `image_prompts_v1`（20 条 prompt） + `image_gen_v1` schema + `image_quality_v1` rubric（HEIM 5 维）

新用户首次启动看到的内容**严重低估 evalyst 实际能力**：

- 只用了 1 个 input、1 套 variable、最简单的 rubric
- 完全没体现：多 input 笛卡尔积、跨 schema 对比组（compare_group）、自定义 display（table / grouped_grid / jsx）、内置 display 的 dual_list / triple_grid / bubble_overlay 形态、LLM-as-judge 多维评分、`user_templates_by_cond` 条件模板、多模态 image 输入、token / cost 统计、预跑 experiment "开箱即对比"
- 数据本身（"法国首都"）一眼到底，毫无质感

### 目标

**全删现有 seeds，重做 3 套 suite × 共 4 个 dataset × 5 个 schema × 4 个 rubric × 3 个用户 display × 4 个 sample experiment**，覆盖：

1. **三象限**：客观可校验 / 主观开放生成 / 多模态生图 + 视觉理解
2. **7 种 display 形态全覆盖**（除异常兜底 `builtin_json_default`）
3. **开箱即体验**：每套 suite 预置已跑完的 results.jsonl + LLM-as-judge annotations.jsonl，新用户首次访问直接看到完整对比页 / 分组视图 / 标注分布
4. **License 干净**：所有数据来自 MIT / Apache-2.0 / BSD-3 / CC-BY 4.0 来源，仓内 attribution 齐备

## 1. 全删清单

```
src/lib/seeds/qa_answer_v1.schema.json
src/lib/seeds/qa_pairs.jsonl
src/lib/seeds/qa_pairs.meta.json
src/lib/seeds/qa_accuracy.rubric.json
src/lib/seeds/image_gen_v1.schema.json
src/lib/seeds/image_prompts_v1.jsonl
src/lib/seeds/image_prompts_v1.meta.json
src/lib/seeds/image_quality_v1.rubric.json

data/datasets/qa_pairs.{jsonl,meta.json}
data/datasets/image_prompts_v1.{jsonl,meta.json}
data/schemas/qa_answer_v1.json
data/schemas/image_gen_v1.json
data/rubrics/qa_accuracy.json
data/rubrics/image_quality_v1.json
```

`src/lib/seed.ts` 中对应的 id 列表项一并删除（被新的扫子目录机制替代，见 §5）。

## 2. 总体设计

### 三象限

| Suite | 主题 | Dataset | Schema 数 | Display 形态覆盖 |
|---|---|---|---|---|
| **A** | 客观可校验 · math reasoning | `gsm8k_mini`（80 条） | 3 | `builtin_single_list` / 用户 `table` / 用户 `jsx` |
| **B** | 主观开放 · 中文 alignment | `belle_eval_mini`（60 条） | 2 | `builtin_dual_list` / 用户 `grouped_grid` |
| **C1** | 多模态生图 · text-to-image | `partiprompts_mini`（60 条） | 1 | `builtin_triple_grid` |
| **C2** | 视觉理解 · referring expression pointing | `refcoco_mini`（30 条） | 1 | `builtin_bubble_overlay` |

合计 **4 dataset / 7 schema / 230 records** 静态数据 + **600 records sample experiment results** + **LLM-judge annotations**。

### Display 7 形态全覆盖矩阵

| Display 形态 | 触发方式 | 承载 schema |
|---|---|---|
| `builtin_single_list` | display_dimensions 数 = 0/1 | `gsm8k_cot_v1` |
| `builtin_dual_list` | display_dimensions 数 = 2 | `belle_plain_v1` |
| `builtin_triple_grid` | display_dimensions 数 = 3 | `parti_t2i_v1` |
| `builtin_bubble_overlay` | output 含 `tuple:number[]` + input 有 image 字段 | `vqa_pointing_v1` |
| 用户 `table` | 显式 `display_id` 指向 user display | `gsm8k_direct_v1` |
| 用户 `grouped_grid` | 同上 | `belle_persona_v1` |
| 用户 `jsx` | 同上 | `gsm8k_fewshot_v1` |

`builtin_json_default` 仅用于 schema 异常兜底，不需要专门 demo。

### 关键设计原则

1. **多 schema 共享 dataset + `compare_group`** —— 演示 evalyst 招牌能力"同数据 × 不同 prompt 横向对比"
2. **Rubric 做厚** —— 每个 4-6 维度，覆盖 `pass_fail` / `likert_1_5` / `score_0_100` 三种 type；至少一个 `pass_fail` 用程序化校验、其余走 LLM-as-judge
3. **Sample experiment 预置已跑数据 + 标注** —— 新用户开箱不必先配 LLM 等几分钟跑完，直接看到对比页
4. **i18n** —— 所有新 schema 的 `label` / `description` / filter `label` 等用户可见文本走 i18n 键（如有需要新增 key，必须 zh.ts + en.ts 成对加）

## 3. Suite A · GSM8K-mini（客观可校验）

### Dataset `gsm8k_mini`

- **来源**: [openai/grade-school-math](https://github.com/openai/grade-school-math)，MIT license
- **抽样**: 80 条，从 GSM8K 测试集（test.jsonl, 1319 条）按以下规则抽：
  - difficulty 平衡：easy 20 / medium 40 / hard 20（按推理步数：≤2 / 3-4 / ≥5）
  - category 覆盖 8 类：arithmetic / ratio / percentage / time / age / shopping / geometry / mixture
  - 数字简洁（剥离单位后纯数字）
- **id_field**: `qid`
- **字段**:

| 字段 | type | 说明 | 示例 |
|---|---|---|---|
| `qid` | string | 主键 | `gsm8k_001` |
| `question` | string | 原题英文 | "Janet's ducks lay 16 eggs per day. She eats 3 for breakfast and bakes 4 into muffins for her friends. She sells the rest at the market for $2 each. How much money does she make every day?" |
| `reference_answer` | string | 最终数字（剥离单位） | `"18"` |
| `reference_steps` | string | GSM8K 原版 step-by-step 推理 | "She eats 16 - 3 - 4 = 9 eggs less. She sells 9 eggs for 9 × 2 = 18 dollars." |
| `category` | string | 8 类自打标 | `"shopping"` |
| `difficulty` | string | `easy` / `medium` / `hard` | `"medium"` |
| `step_count` | number | GSM8K 原数据推理步数 | `3` |

### Schemas

3 个 schema 共享 `compare_group: "gsm8k_v1"`，inputs 完全相同（`alias=q, dataset_id=gsm8k_mini`），filter 相同（difficulty multiselect / category multiselect / limit），output_schema 相同（`{steps?: string, final_answer: string, confidence: number 1-5}`），**仅 prompt 与 display 不同**。

#### Schema A1 `gsm8k_cot_v1` —— default Chain-of-Thought

- **display**: 隐式（不指定 display_id），`display_dimensions: 1` → 自动推断 `builtin_single_list`
- **display_dimensions**: `[{ field: "input_preview.q.difficulty", label: "难度" }]`
- **default_prompt**:

```
You are a careful math problem solver. Solve the problem step by step, then state the final numeric answer.

Output JSON only:
{
  "steps": "step-by-step reasoning, plain text",
  "final_answer": "the final number, no units",
  "confidence": 1-5
}

Problem: {{question}}
```

#### Schema A2 `gsm8k_direct_v1` —— 直答（无 CoT）+ user table display

- **display_id**: `gsm8k_compact_table`（user display，定义见下方）
- **display_dimensions**: `[{ field: "input_preview.q.difficulty", label: "难度" }]`（display_id 优先生效，display_dimensions 此处仅作元数据；保留以便用户切换回 builtin display 时仍可分组）
- **default_prompt**:

```
Solve the math problem and output ONLY the final number.

Output JSON only:
{
  "final_answer": "...",
  "confidence": 1-5
}

Problem: {{question}}
```

#### Schema A3 `gsm8k_fewshot_v1` —— Few-shot CoT + user jsx display

- **display_id**: `gsm8k_step_card`（user display，定义见下方）
- **display_dimensions**: `[{ field: "input_preview.q.difficulty" }, { field: "input_preview.q.category" }]`（display_id 优先生效，display_dimensions 仅作元数据，便于用户切回 builtin display 时仍可分组）
- **default_prompt**: 包含 2 个 few-shot 示例 + 标准 CoT 指令

```
Here are 2 examples of how to solve math problems step by step:

Example 1:
Problem: ...
Steps: ...
Answer: 12

Example 2:
Problem: ...
Steps: ...
Answer: 35

Now solve this problem the same way:

Problem: {{question}}

Output JSON only:
{
  "steps": "...",
  "final_answer": "...",
  "confidence": 1-5
}
```

### User Displays for Suite A

#### Display `gsm8k_compact_table` (mode=table)

```json
{
  "id": "gsm8k_compact_table",
  "name": "GSM8K 紧凑表格",
  "description": "题号 / 题目 / 模型答案 / 参考答案 / 是否相等 / 用时",
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

> 注：`_computed.answer_match` 不是真实字段，table display 渲染时需要在 `display-table.tsx` 加一个轻量 computed-field 解析（对比 output.final_answer 与 input_preview.q.reference_answer，相等 → ✓ badge / 否则 ✗）。如果该改造被认为超出 sample 数据 scope，**降级为去掉这一列、或写成单独的 jsx 卡片**。spec 决议：**保留这一列**，因为它演示了"程序化对错判定"这个 evalyst 用户最常想要的能力，对应 implementation 阶段需要给 display-table 加一个 mini computed-field 协议（spec 在 plan 阶段细化）。

#### Display `gsm8k_step_card` (mode=jsx)

Glass UI 风格的卡片：题目 + 思考链（折叠）+ 红绿对错灯 + confidence 进度条。**严格遵守 CLAUDE.md "JSX display 外层主卡 helpers.glassStyle 三件套"约束**：

```jsx
function GSM8KStepCard({ result, schema, helpers }) {
  const { glassStyle, glassAttr, formatNumber } = helpers
  const out = result.output || {}
  const ref = result.input_preview?.q?.reference_answer
  const match = String(out.final_answer ?? '').trim() === String(ref ?? '').trim()

  return React.createElement('div', {
    className: 'border rounded-lg p-3 bg-card flex flex-col gap-3',
    style: glassStyle('regular'),
    'data-glass-variant': glassAttr('regular'),
  },
    // 题目
    React.createElement('div', { className: 'text-sm font-medium' },
      result.input_preview?.q?.question ?? ''),
    // 答案 + 对错灯
    React.createElement('div', { className: 'flex items-center gap-2' },
      React.createElement('span', {
        className: match ? 'text-green-600 text-2xl' : 'text-red-600 text-2xl'
      }, match ? '✓' : '✗'),
      React.createElement('span', { className: 'text-lg font-semibold' },
        out.final_answer ?? '—'),
      React.createElement('span', { className: 'text-xs text-muted-foreground' },
        `(参考: ${ref ?? '—'})`)
    ),
    // confidence 进度条
    React.createElement('div', { className: 'flex items-center gap-2' },
      React.createElement('span', { className: 'text-xs text-muted-foreground' }, 'Confidence'),
      React.createElement('div', { className: 'flex-1 h-2 bg-muted rounded' },
        React.createElement('div', {
          className: 'h-2 bg-blue-500 rounded',
          style: { width: `${(out.confidence ?? 0) * 20}%` }
        })
      ),
      React.createElement('span', { className: 'text-xs' }, `${out.confidence ?? '—'}/5`)
    ),
    // 思考链 details/summary
    out.steps && React.createElement('details', { className: 'text-xs text-muted-foreground' },
      React.createElement('summary', { className: 'cursor-pointer' }, '思考链'),
      React.createElement('div', { className: 'mt-2 whitespace-pre-wrap' }, out.steps)
    )
  )
}
```

### Rubric `gsm8k_grading`

| key | type | required | 描述 |
|---|---|---|---|
| `final_answer_correct` | pass_fail | true | 程序化：strip 空白/单位 / 数值相等比较；rationale 写 "AUTO" |
| `reasoning_validity` | likert_1_5 | false | LLM-judge：推理过程是否成立、无跳跃、无幻觉 |
| `step_efficiency` | likert_1_5 | false | LLM-judge：步骤是否冗余 / 跳过关键步 |
| `confidence_calibration` | likert_1_5 | false | 程序化或 LLM-judge：自评是否匹配实际对错 |
| `overall_quality` | score_0_100 | false | LLM-judge：综合分 |

#### Judge prompt（`src/lib/seeds/judges/gsm8k_grading.judge.md`）

```
你是数学推理评测员。给定题目、参考答案、模型回答，按以下 4 维评分（final_answer_correct 由程序自动标，你只需评 reasoning_validity / step_efficiency / confidence_calibration / overall_quality）。

题目：{{question}}
参考答案：{{reference_answer}}
参考推理：{{reference_steps}}
模型 final_answer：{{model_final_answer}}
模型 steps：{{model_steps}}
模型 confidence：{{model_confidence}}（1=无把握，5=很确定）
答对了吗：{{answer_match}}（true/false，由程序判断）

输出严格 JSON：
{
  "scores": {
    "reasoning_validity": 1-5,
    "step_efficiency": 1-5,
    "confidence_calibration": 1-5,
    "overall_quality": 0-100
  },
  "rationale": "中文，30-80 字，重点说哪一维扣了分"
}
```

### Sample Experiment `gsm8k_compare_v1`

- **名称**: "GSM8K · CoT vs Direct vs Few-shot · Opus 4.6 × Kimi K2.6"
- **dataset_bindings**: 默认（`q -> gsm8k_mini`）
- **filter_values**: 抽 difficulty 平衡子集 30 条（10 easy + 10 medium + 10 hard）
- **runs**: 3 schema × 2 模型 = 6 runs × 30 records = **180 records**
- **annotations**: GPT-4o-mini 当 judge 跑完 rubric 5 维度 → ship 进 `data/annotations/gsm8k_compare_v1.annotations.jsonl`
- **预算**: ~¥3-5（含 judge）

## 4. Suite B · BELLE-eval-mini（中文主观开放）

### Dataset `belle_eval_mini`

- **来源**: [LianjiaTech/BELLE](https://github.com/LianjiaTech/BELLE) `eval/eval_set.json`，Apache-2.0 license
- **抽样**: 60 条，覆盖 BELLE-eval 的 10 个 class（每类 6 条）：
  - QA / Open Generation / Math / Brainstorming / Rewrite / Summarization / Translation / Code / Extract / Closed QA
  - 每类内按 difficulty（easy/medium/hard）尽量平衡（不强求各档同数）
- **id_field**: `qid`
- **字段**:

| 字段 | type | 说明 | 示例 |
|---|---|---|---|
| `qid` | string | 主键 | `belle_001` |
| `question` | string | 中文题目 | "请写一首关于秋天的现代诗，要求至少使用三种意象，押韵规整。" |
| `category` | string | 10 类 class | `"open_generation"` |
| `subcategory` | string | BELLE 子标签或自补（"日常写作" / "诗歌创作"） | `"诗歌创作"` |
| `reference_criteria` | string | 评分要点（BELLE 自带或自补） | "1) 至少 3 种意象；2) 扣题；3) 押韵规整；4) 现代诗风格" |
| `reference_answer` | string\|null | 标准答案（BELLE 部分题有，无则 null） | null |
| `difficulty` | string | easy/medium/hard | `"medium"` |

### Schemas

2 个共享 `compare_group: "belle_v1"`，inputs 相同（alias=q），output_schema 相同（`{answer: string}`，`raw_text_output: true` 让 raw response 直接进 answer，不强 JSON 输出——BELLE 是开放生成、强 JSON 反而压抑生成质量）。

#### Schema B1 `belle_plain_v1` —— 朴素 zero-shot

- **display**: 隐式，`display_dimensions: 2` → 自动推断 `builtin_dual_list`
- **display_dimensions**: `[{ field: "input_preview.q.category" }, { field: "input_preview.q.difficulty" }]`
- **default_prompt**:

```
你是一个有帮助的中文 AI 助手。请认真回答以下问题：

{{question}}
```

#### Schema B2 `belle_persona_v1` —— Persona prompt + `user_templates_by_cond` + user grouped_grid

- **display_id**: `belle_persona_grid`（user display，定义见下方）
- **default_prompt**: 通用 fallback "你是一个 AI 助手，请回答：{{question}}"
- **message_builder.user_templates_by_cond**: 按 category 命中条件挑模板

```json
{
  "user_templates_by_cond": [
    { "when": "is_writing", "template": "你是一位资深中文写作老师，请按以下要求写作：\n\n{{question}}\n\n注意文采、扣题、结构清晰。" },
    { "when": "is_math", "template": "你是一位数学老师，请一步一步解答：\n\n{{question}}\n\n务必给出完整推理过程和最终答案。" },
    { "when": "is_translation", "template": "你是一位双语翻译专家，请提供高质量翻译：\n\n{{question}}\n\n翻译要忠实原文，语言地道。" },
    { "when": "is_code", "template": "你是一位资深工程师，请写出可读、健壮的代码：\n\n{{question}}\n\n附上简短注释。" }
  ],
  "user_template": "你是一个 AI 助手，请回答：{{question}}"
}
```

variables 增加：

```json
[
  { "name": "is_writing", "source": "q.category", "transform": [{ "op": "eq", "value": "open_generation" }, { "op": "notEmpty" }] },
  { "name": "is_math", "source": "q.category", "transform": [{ "op": "eq", "value": "math" }, { "op": "notEmpty" }] },
  { "name": "is_translation", "source": "q.category", "transform": [{ "op": "eq", "value": "translation" }, { "op": "notEmpty" }] },
  { "name": "is_code", "source": "q.category", "transform": [{ "op": "eq", "value": "code" }, { "op": "notEmpty" }] },
  { "name": "question", "source": "q.question" }
]
```

> 验证 `eq` + `notEmpty` 组合在 evalyst 现有 transform pipeline 是否生效（见 `src/lib/schema/engine.ts`），如不生效需要降级到一个简单的 `map` transform。implementation 阶段确认。

### User Display `belle_persona_grid` (mode=grouped_grid)

```json
{
  "id": "belle_persona_grid",
  "name": "BELLE Persona 网格",
  "description": "primary by category, secondary by difficulty, cell 显示 answer 截断 + judge_score badge",
  "source": "builtin",
  "mode": "grouped_grid",
  "grouped_grid": {
    "primary_group": { "field": "input_preview.q.category", "label": "类目" },
    "secondary_group": {
      "field": "input_preview.q.difficulty",
      "label": "难度",
      "order": ["easy", "medium", "hard"],
      "value_labels": { "easy": "易", "medium": "中", "hard": "难" }
    },
    "header_fields": ["input_preview.q.subcategory"],
    "cell_columns": [
      { "field": "input_preview.q.question", "label": "题", "type": "text", "max_length": 60 },
      { "field": "output.answer", "label": "答", "type": "text", "max_length": 120 },
      { "field": "_annotation.overall_score", "label": "分", "type": "badge", "width": "60px" }
    ]
  }
}
```

> `_annotation.overall_score` 同样需要 grouped-grid display 加 mini annotation-pull 协议（从该 task_id 的 latest annotation 取 `scores.overall_score`）。implementation 阶段细化。

### Rubric `belle_quality`

| key | type | required | 描述 |
|---|---|---|---|
| `correctness` | pass_fail | true | 内容事实正确无幻觉（无幻觉=pass） |
| `instruction_following` | likert_1_5 | false | 严格扣题、覆盖 reference_criteria 各点 |
| `helpfulness` | likert_1_5 | false | 实用性、深度、信息密度 |
| `language_quality` | likert_1_5 | false | 中文表达 / 文采 / 流畅度 |
| `overall_score` | score_0_100 | false | 综合（对应 AlignBench 风格 1-10 × 10） |

Judge prompt 仿 §3 结构，inject `{question}` `{category}` `{reference_criteria}` `{model_answer}`，输出严格 JSON。

### Sample Experiment `belle_compare_v1`

- **名称**: "BELLE-eval · 朴素 vs Persona prompt · Gemini 3.1 Pro × Kimi K2.6"
- **filter_values**: 全 60 条
- **runs**: 2 schema × 2 模型 = 4 runs × 60 records = **240 records**
- **annotations**: GPT-4o-mini 当 judge 跑完 rubric 5 维度
- **预算**: ~¥6-12

## 5. Suite C · 多模态生图 + 视觉理解

### 5.1 Dataset `partiprompts_mini`（生图）

- **来源**: [google-research/parti-prompts](https://github.com/google-research/parti-prompts) `PartiPrompts.tsv`，BSD-3 license
- **抽样**: 60 条，6 大 category × 10 条每类
  - 6 类: People / Animals / World Knowledge / Outdoor Scenes / Artifacts / Abstract
  - challenge 维度二分: Basic（5 条/类）+ Complex（5 条/类）
  - 8 条 prompt 翻译为中文（is_chinese=true），分布于多个 category
- **id_field**: `pid`
- **字段**:

| 字段 | type | 说明 |
|---|---|---|
| `pid` | string | 主键 |
| `prompt` | string | T2I prompt（英文 52 / 中文 8） |
| `category` | string | 6 类 |
| `challenge` | string | `Basic` / `Complex` |
| `is_chinese` | boolean | 是否中文 prompt |

### 5.2 Schema `parti_t2i_v1`（生图）

- **compare_group**: `parti_t2i_v1`
- **inputs**: `[{ alias: "p", dataset_id: "partiprompts_mini", filters: [category multiselect, challenge multiselect, is_chinese checkbox, limit] }]`
- **variables**: `[{ name: "prompt", source: "p.prompt" }]`
- **default_prompt**: `{{prompt}}`（生图模型不需要 system prompt）
- **message_builder**: `{ user_template: "{{prompt}}" }`
- **output_schema**: `{ caption?: string, image_url: image_url }`
- **display_dimensions**:

```json
[
  { "field": "input_preview.p.category", "label": "类目" },
  { "field": "input_preview.p.challenge", "label": "难度" },
  { "field": "input_preview.p.is_chinese", "label": "语言", "value_labels": { "true": "中", "false": "英" } }
]
```

3 dim → 自动推断 `builtin_triple_grid`。

### 5.3 Rubric `t2i_quality`（HEIM-style + 1 维）

| key | type | required | 描述 |
|---|---|---|---|
| `prompt_alignment` | likert_1_5 | true | 与 prompt 对齐度 |
| `subject_clarity` | likert_1_5 | false | 主体清晰、结构完整 |
| `composition_correctness` | likert_1_5 | false | 复杂构图（数量/位置/属性）正确 — PartiPrompts 的核心评测维度 |
| `aesthetic` | likert_1_5 | false | 构图、色彩、整体观感 |
| `safety` | pass_fail | true | 不含不安全内容 |
| `overall_score` | score_0_100 | false | 综合 |

Judge prompt 接受图（多模态 judge），用 GPT-4o（vision 强）跑标注。

### 5.4 Dataset `refcoco_mini`（VQA pointing）

- **来源**: [lichengunc/refer](https://github.com/lichengunc/refer) RefCOCO（unc split），CC-BY 4.0；图来自 COCO 2014 val（CC-BY 4.0）
- **抽样**: 30 条，images 下载到 `public/sample-images/refcoco/{coco_image_id}.jpg`（约 3-5MB）
  - 5 条 referring_expression 翻译为中文（is_chinese=true）
- **id_field**: `vid`
- **字段**:

| 字段 | type | 说明 | 示例 |
|---|---|---|---|
| `vid` | string | 主键 | `refcoco_001` |
| `image_url` | string (url) | 本地图床 path | `/sample-images/refcoco/000000123456.jpg` |
| `referring_expression` | string | 指代表达式（英 25 / 中 5） | `"the cat on the right"` |
| `gt_point` | array (tuple) | 标注 [x, y]（bbox 中心） | `[412, 287]` |
| `gt_bbox` | array (4-tuple) | 备查 [x, y, w, h] | `[380, 240, 64, 94]` |
| `image_w` | number | 图原始宽 | `640` |
| `image_h` | number | 图原始高 | `480` |
| `is_chinese` | boolean | | `false` |

### 5.5 Schema `vqa_pointing_v1`（视觉理解 + 坐标定位）

- **compare_group**: `vqa_pointing_v1`
- **inputs**: `[{ alias: "v", dataset_id: "refcoco_mini", filters: [is_chinese checkbox, limit] }]`
- **variables**: `[{ name: "expr", source: "v.referring_expression" }]`
- **message_builder**:
  - `user_template: "Identify the object referred to: '{{expr}}'. Output the [x, y] pixel coordinates of its center on the image, plus a label and confidence."`
  - **`image: { field: "v.image_url", required: true }`** —— 演示多模态 image 输入
- **output_schema**: `{ label: string, point: tuple:number[] (length=2), confidence: number 1-5 }`
- **display**: 隐式，`tuple:number[]` + image 字段 → 自动推断 `builtin_bubble_overlay`，在原图上画出模型标的点

### 5.6 Rubric `pointing_accuracy`

| key | type | required | 描述 |
|---|---|---|---|
| `point_inside_bbox` | pass_fail | true | 程序化：模型 point 是否落在 gt_bbox 内 |
| `distance_from_center` | likert_1_5 | false | 程序化：归一化距离档（5=极近 / 1=远） |
| `referent_correct` | pass_fail | false | LLM-judge：是否选对了对象（应付歧义） |
| `overall_score` | score_0_100 | false | LLM-judge |

Judge prompt 接受图 + 模型 point + gt_bbox + referring_expression，输出严格 JSON。

### 5.7 Sample Experiments

#### `parti_t2i_compare_v1`

- **名称**: "PartiPrompts · GPT-Image-2 vs Gemini 3.1 Flash Image"
- **filter_values**: 全 60 条
- **runs**: 1 schema × 2 模型 = 2 runs × 60 records = **120 records**
- **生成图存储**: 使用 `src/lib/image-store.ts`，图落盘到 `data/images/`，`results.jsonl` 内 `output.image_url` 写本地相对 path
- **预算**: ~¥30-80（生图贵）
- **judge**: GPT-4o vision 跑 6 维 rubric

#### `vqa_pointing_baseline_v1`

- **名称**: "RefCOCO Pointing · Opus 4.6 × Gemini 3.1 Pro"
- **filter_values**: 全 30 条
- **runs**: 1 schema × 2 模型 = 2 runs × 30 records = **60 records**
- **预算**: ~¥3-8（含 judge）

## 6. 横切设计

### 6.1 Seed 机制改造（`src/lib/seed.ts`）

**当前**: 硬编 dataset / schema / rubric id 列表。

**新**: 扫子目录（保留幂等"存在则跳"语义）。

```
src/lib/seeds/
├── datasets/{*.meta.json, *.jsonl}   # 4 datasets
├── schemas/{*.json}                   # 7 schemas
├── rubrics/{*.json}                   # 4 rubrics
├── displays/{*.json}                  # 3 user displays
├── experiments/{*.json}               # 4 experiments meta
├── results/{*.jsonl}                  # 4 results
├── annotations/{*.jsonl}              # 4 annotations
├── judges/{*.judge.md}                # 4 judge prompts (文档参考用)
├── images/refcoco/{*.jpg}             # 30 sample images
└── LICENSES/                          # attributions
    ├── README.md
    ├── gsm8k-MIT.txt
    ├── belle-Apache-2.0.txt
    ├── partiprompts-BSD-3.txt
    ├── refcoco-CC-BY-4.0.txt
    └── coco-CC-BY-4.0.txt
```

**`seed.ts` 新签名**:

```ts
export function ensureSeeds() {
  seedFromDir('datasets', datasetsDir(), ['meta.json', 'jsonl'])
  seedFromDir('schemas', schemasDir(), ['json'])
  seedFromDir('rubrics', rubricsDir(), ['json'])
  seedFromDir('displays', displaysDir(), ['json'])
  seedFromDir('experiments', experimentsDir(), ['json'])
  seedFromDir('results', resultsDir(), ['jsonl'])
  seedFromDir('annotations', annotationsDir(), ['jsonl'])
  seedSampleImages()  // images 拷到 public/sample-images/
}
```

幂等性保留：每个目标文件 existsSync 跳过；用户删除任意单个 sample 资源后，下次访问自动恢复（与现机制一致）。

**测试**: 新增 `src/lib/__tests__/seed.test.ts`，覆盖：
- 全空 data 目录 → 全部 seed 成功
- 部分文件已存在 → 仅缺失项被复制
- 用户删除某个 → 重新运行后被恢复
- LICENSES / images 目录被正确处理

### 6.2 数据获取脚本（`scripts/build-sample-data.ts`）

**zero-dep 约束**：用 Node 18+ 内置 `fetch` / `fs/promises` / `path` / `crypto`，不引入 npm dev dependency。

脚本职责：
1. 拉 GSM8K：`https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl`，按 step_count 分桶 + category heuristic（关键词匹配）→ 抽 80 条
2. 拉 BELLE-eval：`https://raw.githubusercontent.com/LianjiaTech/BELLE/main/eval/eval_set.json`，按 class 分桶 → 抽 60 条
3. 拉 PartiPrompts：`https://raw.githubusercontent.com/google-research/parti-prompts/main/PartiPrompts.tsv`，按 category × challenge → 抽 60 条
4. 拉 RefCOCO 标注：`https://github.com/lichengunc/refer/raw/master/data/refcoco/refs(unc).p`（pickle，需 zero-dep 解析备选 → fallback：用 [refer-segmentation API](https://github.com/lichengunc/refer/blob/master/data/refcoco/instances.json) 的 JSON 镜像，或预先 commit 一份手工提取的 JSON 子集）
5. 下载对应 30 张 COCO val2014 图（`http://images.cocodataset.org/val2014/COCO_val2014_*.jpg`）到 `src/lib/seeds/images/refcoco/`
6. 中文 prompt / referring expression 注入（hard-coded list of 13 个翻译，避免依赖翻译 API）
7. 输出全部 jsonl / json 文件到 `src/lib/seeds/`，覆盖式写

脚本不进运行时 build pipeline，只在数据集需要更新时手动 `npm run build:samples` 跑一次。

`package.json` 新增:

```json
"scripts": {
  "build:samples": "tsx scripts/build-sample-data.ts"
}
```

> tsx 已在 devDependencies 中（项目其他脚本用），无需新增。

### 6.3 Sample Experiments 跑数据脚本

`scripts/run-sample-experiments.ts`（zero-dep，调用 evalyst 自己的 batch-runner 或直接调 LLM API）。

设计：
1. 读 `data/llm-config.json`（用户已配好 API key）
2. 顺序跑 4 个 sample experiment（对应 4 个 schema 的预跑组合）
3. 写出 `data/results/{exp_id}.jsonl`
4. 调 GPT-4o-mini 跑 judge → 写 `data/annotations/{exp_id}.jsonl`
5. 把 `data/results/*.jsonl` + `data/annotations/*.jsonl` + `data/experiments/*.json` 拷一份进 `src/lib/seeds/{results,annotations,experiments}/` ship 进 git

**注意**: 这是开发者一次性脚本，**只有作者本人在 spec 实施期跑过**。结果固化到 git 后所有用户开箱可用。

### 6.4 LICENSES 文件夹

`src/lib/seeds/LICENSES/README.md` 写明每份数据的来源、license、引用：

```
# Sample Data Licenses

evalyst sample 数据来自以下开源项目，所有 license 兼容 evalyst MIT license。

- gsm8k_mini  · GSM8K (Cobbe et al. 2021) · MIT · openai/grade-school-math
- belle_eval_mini · BELLE-eval · Apache-2.0 · LianjiaTech/BELLE
- partiprompts_mini · PartiPrompts (Yu et al. 2022) · BSD-3 · google-research/parti-prompts
- refcoco_mini · RefCOCO (Yu et al. 2016) · CC-BY 4.0 · lichengunc/refer
- COCO 图像 · CC-BY 4.0 · cocodataset.org
```

### 6.5 i18n

新 schema label / description / filter label / display name 等用户可见文本：

- 简单文本（"GSM8K mini" / "BELLE-eval mini"）直接英文（项目名本来就英文）
- 中文 description 直接写中文（label 字段允许）
- **PR 3** 暂不引入新 i18n key（除非新出现需要 zh/en 切换的字段）；如有新增，**zh.ts + en.ts 必须成对加**
- **PR 1**（前置 llm-client 改造）会引入 1-2 个 i18n key（如 `llm_endpoint_kind_label` 给"端点类型"下拉用），同样 zh/en 成对加

### 6.6 文档更新

- **CLAUDE.md** 主表"加新数据集 / 加新评测任务"说明无需改（路径不变）
- **CLAUDE.md** 直答表第 1 行"加新评测任务"+ 第 2 行"加新数据集"末尾追加："新 starter sample 见 §6.6 sample data 概览"
- **新增** `docs/sample-data.md`：sample data 概览（4 dataset / 7 schema / 4 rubric / 3 display / 4 experiment 的关系图 + 每个用来 demo 什么能力）
- **CLAUDE.md** 索引表新增一行 `Sample data 概览 → docs/sample-data.md`

## 7. 前置 PR · llm-client 加 `/images/generations` 端点支持

### 现状

`src/lib/llm-client.ts` 当前所有 LLM 调用走 `chat/completions` 端点（OpenAI / Anthropic 兼容协议），从 `data.choices[0].message.images[]` 取生图结果。

### 需求

GPT-Image-2 走 OpenAI Images API（`/v1/openai/native/images/generations`），请求/响应结构与 chat 不同：

**请求**:
```json
{ "model": "gpt-image-2", "prompt": "...", "size": "1024x1024", "quality": "low" }
```

**响应**: OpenAI Images API 标准 `{ data: [{ b64_json | url, revised_prompt }] }`

### 设计

在 `ApiConfig` / `LlmModelConfig` 上新增字段 `endpoint_kind?: "chat" | "images_generations"`（默认 `"chat"`），在 `callLlm` 入口按 kind 分发：

- `"chat"` → 现有逻辑
- `"images_generations"` → 走 `${baseURL}/images/generations` 端点，按 OpenAI Images API 协议构造 body，把响应 `data[0].b64_json` 转成 `LlmResponse.images[0]` 返回（与 chat 端点的 image 输出 shape 对齐，下游 parseResponse / image-store 复用）

`/settings/llm` UI 加一个"端点类型"下拉（chat / images_generations），用户在配 GPT-Image-2 等模型时选。

3 次 retry + 120s 超时复用现有逻辑。

### Tests

`src/lib/__tests__/llm-client.images-generations.test.ts`：mock fetch，覆盖：
- 请求 body shape（model / prompt / size / quality）
- 响应解析（b64_json → images[]）
- 错误处理（HTTP 4xx / 5xx → throw）
- size / quality 默认值

### Scope

**仅** 加端点支持 + UI 下拉 + tests + i18n key（如 `llm_endpoint_kind_label`）。**不**牵动批量调度 / display 逻辑。

预计代码量：~150 行 src + ~80 行 tests + 2 行 i18n。

## 8. 实施顺序（PR 拆分）

### PR 1 · llm-client images_generations 端点支持

- 改 `src/lib/llm-client.ts` 加 endpoint_kind 路由
- 改 `src/lib/llm-config.ts` + `/settings/llm` UI 加下拉
- 加 i18n key
- 加 unit test
- branch: `feat/llm-client-images-generations`
- 预计 1 个 commit；规模小好 review

### PR 2 · seed.ts 扫子目录改造

- 改 `src/lib/seed.ts` 为扫子目录机制
- 测试覆盖
- 老 seeds 仍兼容（这一步不删 / 不改老 sample，只改 seed 机制）
- branch: `refactor/seed-scan-subdirs`

> 也可以与 PR 3 合并，但拆开 review 更清晰。

### PR 3 · 全删旧 sample + 落新 sample 数据 + 预跑 experiments

- 删旧 8 个文件（`qa_*` / `image_*`）
- 跑 `scripts/build-sample-data.ts` 拉新数据 → ship `src/lib/seeds/` 全套（datasets / schemas / rubrics / displays / images / LICENSES）
- 作者本地跑 `scripts/run-sample-experiments.ts` → 4 套 results.jsonl + 4 套 annotations.jsonl ship 进 seeds
- 加 `docs/sample-data.md` 概览文档
- 改 CLAUDE.md 索引（最低改动）
- branch: `feat/sample-data-redesign`
- 预计 1 个 commit（数据 + 文档 + 测试一起）

### PR 4 · table display 的 `_computed.answer_match` + grouped_grid 的 `_annotation.*` 协议（如 implementation 阶段确认需要）

- 给 `display-table.tsx` 加 mini computed-field 协议：`_computed.answer_match`（程序化 output / input 字段相等比较）
- 给 `display-grouped-grid.tsx` 加 mini annotation-pull 协议：`_annotation.{criterion_key}`（取该 task_id 最新 annotation 的 scores[criterion_key]）
- 加 unit test
- branch: `feat/display-computed-fields`

> 这一步如果发现 implementation 复杂度过高，可降级：A2 table display 去掉 `_computed.answer_match` 列、B2 grouped_grid 去掉 `_annotation.overall_score` 列。降级后两个 user display 仍可用，只是失去"程序化对错 / judge 分嵌入"的演示力。

## 9. 验收标准

PR 全合并后，新用户首次启动 evalyst（`npm run dev`）应直接看到：

1. **Datasets 页**列出 4 个 sample dataset（gsm8k_mini / belle_eval_mini / partiprompts_mini / refcoco_mini）+ 没有任何 `qa_pairs` / `image_prompts_v1` 残留
2. **Schemas 页**列出 7 个 sample schema + 没有任何 `qa_answer_v1` / `image_gen_v1` 残留
3. **Rubrics 页**列出 4 个 sample rubric
4. **Displays 页**列出 3 个 user display
5. **Experiments 页**列出 4 个 sample experiment，每个进入后**直接看到完整 results + annotations**（无需自己跑）
6. 点开 `gsm8k_compare_v1` → 看到三种 display（single_list / table / jsx）的不同呈现效果
7. 点开 `parti_t2i_compare_v1` → 看到 triple_grid 的 6 类目 × Basic/Complex × 中英 3 维分组
8. 点开 `vqa_pointing_baseline_v1` → 看到 bubble_overlay 在原图上叠加的标注点
9. 任意删除一个 sample 文件后刷新 → 自动恢复
10. CI 五件套（`tsc --noEmit && npm test && npm run lint && npm run build && npm run knip`）+ Playwright E2E 全绿
11. 新 seed.ts 测试覆盖率 ≥ 老 seed.ts 不下降
12. CLAUDE.md 直答表更新到位、`docs/sample-data.md` 新文档可点击

## 10. 已知风险与约束

### R1 · `_computed.answer_match` / `_annotation.*` 协议作为 PR 4 兜底

A2 table display 的"✓✗ 列"和 B2 grouped_grid 的"judge 分 badge"列依赖一个 mini computed/annotation 协议，evalyst 现在没有。implementation 阶段 PR 4 做不出来时降级（去掉这两列）。spec 已明确降级路径。

### R2 · BELLE-eval 字段 / class 名以仓库实际为准

`eval_set.json` 字段名（`class` / `category` / `class_id`）需 implementation 时 git 上 verify，spec 里的 10 类目名是基于 BELLE README 描述推断，可能需要微调。

### R3 · RefCOCO 数据获取链路 zero-dep 风险

RefCOCO 原始格式是 pickle（Python `.p` 文件），Node 难直接解析。fallback 路径：使用 [refer-segmentation 官方 GitHub mirror](https://github.com/lichengunc/refer) 提供的 `instances.json`，或在 implementation 阶段一次性手工导出 30 条到 plain JSON 后 commit。spec 接受手工导出 fallback。

### R4 · `user_templates_by_cond` + `eq` transform 组合存在性

`belle_persona_v1` 用 `user_templates_by_cond` + `transform: eq + notEmpty` 实现"按 category 命中条件挑模板"。需要 implementation 阶段确认 `eq` transform（src/lib/schema/types.ts 已声明）+ `notEmpty` 的链式效果与 `user_templates_by_cond.when` 字段语义匹配。如不匹配，降级到 hard-coded 4 个 schema 变体（每类一个 schema），仍可演示但稍重。

### R5 · 生图模型 sample experiment 预算 ¥30-80 真烧钱

PR 3 实施时作者本人跑一次。如果觉得 60 条 × 2 模型超预算，可以降到 30 条 × 2 模型 = 60 records（PartiPrompts subset），结果占位还在，仅减少分组密度。spec 接受这个降级。

### R6 · COCO 图床 license 与图片版权

COCO 数据集 CC-BY 4.0，下载图到本仓 ship 是 OK 的（attribution 已在 LICENSES）。但仓 size 增量 ~3-5MB（30 张 jpg），属于可接受 scope。如需进一步缩，下采样到 max 720px 长边再 commit。spec 推荐 max 720px。

### R7 · `raw_text_output: true` 与 BELLE schema

`belle_plain_v1` / `belle_persona_v1` 用 `raw_text_output: true` 跳过强 JSON 输出。验证 `parseResponse` 对 `raw_text_output` 模式下的 `output_schema.{answer: string}` 是否会把 raw 内容塞进 `answer` 字段（而不是丢弃）。implementation 阶段 verify。

### R8 · 跨平台 path / fs 行为

新 seed scan 用 `fs.readdirSync` + `path.join`，需保证在 macOS / Linux / Docker 下都正常工作（项目 ship Docker）。

### R9 · 对话历史保留

PR 3 commit 体积可能不小（数据 jsonl + 30 张图 + LICENSES），但都是文本/小图，~5-8MB 在 git 可接受范围内。

## 11. 不在 scope

- 自动化 CI 脚本去定期 re-run sample experiments（一次 ship 静态结果，不做 freshness 维护）
- sample 数据的 i18n（中文化 PartiPrompts 全部 prompt 等）—— 仅 13 条手工翻译进去演示多语言
- 对 `compare_group` UI 入口 / 跨 schema 对比页本身的改动
- evalyst 现有 LLM-as-judge UI（rubric annotator）的改动
- 新增的"程序化对错"列若需要扩到所有 user display 类型 —— 仅 table display 内做最小实现

## 附录 A · 全文件清单（PR 3 拟新增）

```
src/lib/seeds/
├── datasets/
│   ├── gsm8k_mini.meta.json
│   ├── gsm8k_mini.jsonl
│   ├── belle_eval_mini.meta.json
│   ├── belle_eval_mini.jsonl
│   ├── partiprompts_mini.meta.json
│   ├── partiprompts_mini.jsonl
│   ├── refcoco_mini.meta.json
│   └── refcoco_mini.jsonl
├── schemas/
│   ├── gsm8k_cot_v1.json
│   ├── gsm8k_direct_v1.json
│   ├── gsm8k_fewshot_v1.json
│   ├── belle_plain_v1.json
│   ├── belle_persona_v1.json
│   ├── parti_t2i_v1.json
│   └── vqa_pointing_v1.json
├── rubrics/
│   ├── gsm8k_grading.json
│   ├── belle_quality.json
│   ├── t2i_quality.json
│   └── pointing_accuracy.json
├── displays/
│   ├── gsm8k_compact_table.json
│   ├── gsm8k_step_card.json
│   └── belle_persona_grid.json
├── experiments/
│   ├── gsm8k_compare_v1.json
│   ├── belle_compare_v1.json
│   ├── parti_t2i_compare_v1.json
│   └── vqa_pointing_baseline_v1.json
├── results/
│   ├── gsm8k_compare_v1.jsonl
│   ├── belle_compare_v1.jsonl
│   ├── parti_t2i_compare_v1.jsonl
│   └── vqa_pointing_baseline_v1.jsonl
├── annotations/
│   ├── gsm8k_compare_v1.jsonl
│   ├── belle_compare_v1.jsonl
│   ├── parti_t2i_compare_v1.jsonl
│   └── vqa_pointing_baseline_v1.jsonl
├── judges/
│   ├── gsm8k_grading.judge.md
│   ├── belle_quality.judge.md
│   ├── t2i_quality.judge.md
│   └── pointing_accuracy.judge.md
├── images/refcoco/
│   └── (30 个 .jpg, max 720px)
└── LICENSES/
    ├── README.md
    ├── gsm8k-MIT.txt
    ├── belle-Apache-2.0.txt
    ├── partiprompts-BSD-3.txt
    ├── refcoco-CC-BY-4.0.txt
    └── coco-CC-BY-4.0.txt

scripts/
├── build-sample-data.ts (新)
└── run-sample-experiments.ts (新)

docs/
└── sample-data.md (新)
```

PR 3 删除清单见 §1。

## 附录 B · 三象限 demo 卖点速记（用于 docs/sample-data.md）

| Suite | 一句话卖点 | 演示的核心 evalyst 能力 |
|---|---|---|
| A · GSM8K | "同一道数学题，CoT vs Direct vs Few-shot 三种 prompt 哪个更准？" | compare_group 跨 schema 对比；programmatic + LLM 混合 rubric；3 种 display 风格 |
| B · BELLE-eval | "中文 alignment 评测：朴素 prompt vs 角色 persona prompt，哪个更扣题？" | dual_list 双维分组；user_templates_by_cond 条件模板；grouped_grid 自定义网格 |
| C1 · PartiPrompts | "GPT-Image-2 vs Gemini 3.1 Flash Image 在 6 大类目 60 条 prompt 上的对比，谁更会画？" | 多模态生图；triple_grid 三维分组；HEIM-style 多维 rubric |
| C2 · RefCOCO Pointing | "给 LLM 一张图 + 一句话 'the cat on the right'，让它在图上点出位置——它点对了吗？" | 多模态图像输入；bubble_overlay 坐标可视化；程序化 IoU + LLM-judge 混合评分 |
