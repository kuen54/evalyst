// Meta-prompt 用于引导用户的 agent 产出合规的数据集 JSON

export const DATASET_META_PROMPT = `# 任务
为 batch-eval 评测平台创建一个「数据集」JSON。我会把你的输出粘贴到平台，平台校验后保存。

# 格式
输出一个完整的 JSON 对象（不要加 markdown 代码块）：

\`\`\`json
{
  "id": "lowercase_snake_case_id",
  "name": "人类可读的展示名",
  "description": "一句话说明（可选）",
  "id_field": "records 每条数据的唯一 ID 字段名",
  "fields": [
    { "key": "字段名", "type": "string|number|boolean|array|object|url", "label": "可选的展示名" }
  ],
  "records": [
    { "字段名": "值" }
  ]
}
\`\`\`

# 约束
- \`id\` 只含小写字母、数字、下划线；必须全局唯一
- \`id_field\` 必须出现在 \`fields\` 的 key 里
- \`records\` 至少 1 条；每条必须包含所有 \`fields\` 声明的字段
- type 只能是：string / number / boolean / array / object / url（字符串是 URL 链接时用 url）

# 完整示例 —— 一个小型 QA 数据集

每条 record 是一个问答对，带主题和难度标签。

\`\`\`json
{
  "id": "qa_pairs",
  "name": "QA pairs",
  "description": "Small QA dataset with topic and difficulty labels.",
  "id_field": "qa_id",
  "fields": [
    { "key": "qa_id", "type": "string", "label": "QA ID" },
    { "key": "question", "type": "string", "label": "Question" },
    { "key": "reference_answer", "type": "string", "label": "Reference answer" },
    { "key": "topic", "type": "string", "label": "Topic" },
    { "key": "difficulty", "type": "string", "label": "Difficulty" }
  ],
  "records": [
    { "qa_id": "q01", "question": "What is the capital of France?", "reference_answer": "Paris", "topic": "geography", "difficulty": "easy" },
    { "qa_id": "q02", "question": "Who wrote 1984?", "reference_answer": "George Orwell", "topic": "literature", "difficulty": "easy" }
  ]
}
\`\`\`

# 我的需求
[在这里用一两段话描述你想创建什么样的数据集：业务背景、每条记录代表什么、需要哪些字段。]
`
