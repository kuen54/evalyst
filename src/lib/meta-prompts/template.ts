// Meta-prompt 用于引导 agent 产出合规的评测任务（TaskSchema）JSON

export const TEMPLATE_META_PROMPT = `# 任务
为 evalyst 评测平台创建一个「评测任务」JSON。评测任务描述了一次评测任务的完整生产逻辑：用哪些数据源、怎么抽取变量、怎么拼 prompt、LLM 输出要符合什么 JSON 结构、用哪个展示模板呈现。

# 顶层结构

\`\`\`json
{
  "id": "lowercase_snake_case_id",
  "label": "展示名",
  "description": "一句话说明",
  "version": 1,
  "compare_group": "可选：相同 compare_group 的模板可跨实验对比，默认=id",
  "inputs": [ /* 数据源声明，见下 */ ],
  "variables": [ /* 变量抽取，见下 */ ],
  "default_prompt": "system prompt 模板字符串（用 {{变量名}} 插值）",
  "message_builder": { /* user 消息构造，见下 */ },
  "output_schema": { /* LLM 输出的 JSON Schema，见下 */ },
  "display_id": "展示模板 ID，如 builtin_json_default 或用户自建"
}
\`\`\`

## inputs（数据源组合成笛卡尔积）
每个 input 声明一个数据源别名。平台会对所有 input 做笛卡尔积生成任务。

\`\`\`json
{
  "alias": "qa",                     // 模板里用 qa.xxx 引用
  "dataset_id": "qa_pairs",          // 指向已注册的数据集
  "dedupe_by": ["topic"],            // 可选：按这些字段去重，每组只留一条
  "hard_filter": { "field": "difficulty", "equals": "easy" },  // 可选：运行时强制过滤
  "filters": [                       // 可选：UI 上暴露的用户可选过滤器
    {
      "kind": "multiselect",
      "key": "topics",
      "field": "topic",
      "label": "Topic",
      "options": [{ "value": "geography", "label": "Geography" }, { "value": "science", "label": "Science" }],
      "defaultValue": ["geography", "science"]
    },
    { "kind": "number", "key": "limit", "role": "limit", "label": "Limit" }
  ]
}
\`\`\`

filter kinds: multiselect / checkbox / number / text_in / literal_set

## variables（从输入抽取成 prompt 变量）

\`\`\`json
{
  "name": "question",                 // 模板里用 {{question}}
  "source": "qa.question",            // 从 input alias.field.path 取值
  "transform": [                      // 可选：链式处理
    { "op": "truncate", "max": 200 }
  ],
  "fallback": "(no question)"         // 可选：源为空时的默认值
}
\`\`\`

transform ops：
- \`{ "op": "join", "sep": "、" }\` 数组 → 字符串
- \`{ "op": "truncate", "max": 200, "suffix": "..." }\` 限长
- \`{ "op": "slice", "start": 0, "end": 3 }\` 切片
- \`{ "op": "eq", "value": "fallback" }\` 等值 → 'true' / ''（用于 {{#cond}}）
- \`{ "op": "notEmpty" }\` → 'true' / ''
- \`{ "op": "default", "value": "..." }\` 空时默认
- \`{ "op": "map", "mapping": { "key": "label" } }\` 键值查表

## message_builder

\`\`\`json
{
  "user_template": "Reply with JSON only.",
  "user_templates_by_cond": [        // 可选：按变量条件切模板
    { "when": "is_fallback", "template": "Fallback task..." }
  ],
  "image": { "field": "item.image_url", "required": false }  // 可选：多模态
}
\`\`\`

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

# 完整示例 —— QA answer

让 LLM 回答一个问题并给 1-5 的置信度。单个 input（qa_pairs），按 qa 分组展示。

\`\`\`json
{
  "id": "qa_answer_v1",
  "label": "QA Answer",
  "description": "Ask the model to answer a factual question and self-rate confidence.",
  "version": 1,
  "compare_group": "qa_answer",
  "inputs": [
    {
      "alias": "qa",
      "dataset_id": "qa_pairs",
      "filters": [
        { "kind": "multiselect", "key": "topics", "field": "topic", "label": "Topic", "options": [{"value":"geography","label":"Geography"},{"value":"science","label":"Science"}], "defaultValue": ["geography","science"] },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit" }
      ]
    }
  ],
  "variables": [
    { "name": "question", "source": "qa.question" },
    { "name": "reference", "source": "qa.reference_answer" }
  ],
  "default_prompt": "You are a helpful assistant. Return JSON: {\\"answer\\": \\"...\\", \\"confidence\\": 1-5}\\n\\nQuestion: {{question}}\\nReference (for self-assessment): {{reference}}",
  "message_builder": {
    "user_template": "Reply with JSON only."
  },
  "output_schema": {
    "type": "object",
    "required": ["answer", "confidence"],
    "properties": {
      "answer": { "type": "string", "max_length": 500 },
      "confidence": { "type": "number", "enum": [1, 2, 3, 4, 5] }
    }
  },
  "display_dimensions": [
    {
      "field": "input_refs.qa",
      "label": "Question",
      "header_fields": [
        { "field": "input_preview.qa.question", "label": "Q" },
        { "field": "input_preview.qa.topic", "label": "Topic" }
      ]
    }
  ]
}
\`\`\`

> 注意：
> - \`qa_pairs\` 是平台自带的 seed 数据集；可以在 /settings/datasets 换成你自己的。
> - **不用再指定 \`display_id\`**：平台会根据 \`display_dimensions.length\` + output_schema 自动推断展示（本例 1 维 → 单列表）。
>   如果需要覆盖可单独加 \`display_id\` 字段（如 \`"builtin_json_default"\`）

# 推断规则
平台根据以下规则自动选 display：
- output 含坐标字段（tuple:number[]）+ 有图片字段 → **气泡坐标叠加图**
- display_dimensions 数量：0/1 → **单字段列表**；2 → **双维分组列表**；3 → **三维分组网格**；≥ 4 → 单字段列表（header 合并维度）
- 其它 → json 兜底

# 我的需求
[描述你的评测任务：要生成什么类型的输出、用哪些数据源、输出字段结构、针对什么场景、需要按哪些字段分组展示。]
`
