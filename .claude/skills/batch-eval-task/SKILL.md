---
name: batch-eval-task
description: "为 batch-eval 评测平台创建新「评测任务」（代码里叫 TaskSchema）。Use when: 用户在 batch-eval 项目里说「建个评测任务」「帮我建个 schema」「new task for eval 平台」「再来一个 xxx 版本」等，需要产出 data/schemas/{id}.json 以及（按需）data/displays/{id}.json。NOT for: 编辑已有 schema（直接聊）、数据集创建（用 /batch-eval-dataset）、LLM 配置。"
---

# batch-eval · 新建评测任务

本 skill 帮你（Claude）为 batch-eval 评测平台创建一份合规的「评测任务」（`TaskSchema`），直接把文件写到 `data/schemas/{id}.json`（以及按需的 `data/displays/{id}.json`）。平台下次访问 `/settings/templates` 时会自动扫到（`listSchemas()` 每次调用都幂等扫目录），无需重启 dev server。

## Step 1 · 前置确认

1. 用 Bash `pwd` 确认当前工作目录在 batch-eval 项目根（有 `package.json` 且依赖含 `next`）。否则停止，告诉用户 `cd` 进去。
2. 读以下三个文件作为权威参考：
   - `src/lib/meta-prompts/template.ts` —— TaskSchema 的完整 JSON 结构 + 详尽示例（**严格按它**）
   - `src/lib/schema/types.ts` —— `TaskSchema` / `InputSourceDef` / `VariableDef` / `TransformStep` / `FilterDef` / `MessageBuilderDef` / `JsonSchemaDef` / `DisplayDimension` / `Display` 全套类型定义
   - `src/lib/schema/transform.ts` —— 所有 transform op 的实际行为
3. 列可用数据集：Glob `data/datasets/*.meta.json`。`inputs[].dataset_id` 引用的数据集**必须**存在（或者你引导用户先跑 `/batch-eval-dataset` 建好）。
4. 看现有 schema 范式：`data/schemas/*.json`（比如内置 seed `qa_answer_v1.json`）。

## Step 2 · 与用户对齐需求

把下面几项问清（已经在初始请求里给足的跳过）：

1. **Prompt**：完整的 system prompt（里面的 `{{变量名}}` 占位符用什么）；user_template 一句话即可（绝大多数场景只是「请按系统提示直接输出 JSON」）
2. **Inputs**：用哪些 dataset 做输入？
   - 多个 input 是**笛卡尔积**（A × B = A 数 × B 数 条任务）
   - 用 `dedupe_by: ["field"]` 去重；用 `hard_filter: { field, equals }` 硬过滤；用 `filters[]` 暴露 UI 过滤器
   - **如果一次 LLM 调用产出多条**（prompt 返回嵌套对象），只声明需要的 input；差异化由 prompt 内部处理
3. **Variables**：`{{变量名}}` 怎么从 input 取值？链式 transform（join / truncate / map 等）
4. **Output schema**：LLM 返回的 JSON keys + type（string / number / boolean / array / object / tuple:number[]）
5. **Display 策略**：三选一
   - 走 auto 推断：只声明 `display_dimensions`，0-1 维 → single_list，2 维 → dual_list，3 维 → triple_grid
   - 走 builtin：`display_id: "builtin_json_default"` 保底
   - 自建 JSX display：当 output 结构特殊（如单 result 里藏多条对象），需要**额外**写一个 `data/displays/{id}.json`

## Step 3 · 产出 schema 文件

`data/schemas/{id}.json` 的顶层结构见 `meta-prompts/template.ts`。写的时候注意几个容易翻车的点：

- `compare_group`：不写的话默认等于 `id`。想让同一个功能的多个版本（v1/v2/v3）在 `/compare` 页跨对比，**把所有 schema 的 compare_group 设成同一个值**
- `raw_text_output: true`：LLM 直接输出纯文本（不是 JSON）时设为 true；仍然需要声明一个 string 字段的 `output_schema`，parseResponse 会把整段响应塞进去
- `display_dimensions[].field` 的合法路径前缀：`input_refs.*` / `input_preview.*.*` / `output.*`
- `default_prompt` 里的 `{{#cond}}...{{/cond}}` 条件块不算变量（渲染引擎看某变量渲染后是否非空决定）
- 多模态图片用 `message_builder.image = { field: "item.image_url", required: false }`（自动在 Anthropic 格式下转 `{ type: 'image', source: ... }`）

## Step 4 · 按需产出 display 文件

**什么时候需要自建 display**：
- output 里单条 result 藏了多条内容（如嵌套对象多 key）——auto 推断不够用
- 要特殊视觉（气泡叠加、表格、定制卡片）

`data/displays/{id}.json` 结构参考 `src/lib/meta-prompts/display.ts` 和 `src/lib/schema/types.ts` 的 `Display` 接口，支持 `table` / `grouped_grid` / `jsx` 三种模式。

### JSX display 的写法约定

- props 是 `{ result, schema, helpers }`，其中 `helpers = { readField, formatValue, renderField, Badge }`
- **用 `React.createElement(...)` 而不是 JSX 语法**——JSON 字符串里写 `<>` 转义地狱，`React.createElement` 里只用单引号就能避开所有 `\"`
- 不能 `import / require / fetch`；babel-standalone 浏览器端编译，只有 React 和 helpers 可用
- source 字段就是一个函数表达式的字符串：`"({ result, helpers }) => React.createElement(...)"`

然后在 schema 里 `display_id: "{display_id}"`。

## Step 5 · 自我校验

写完后自己过一遍：

### schema 文件

- [ ] `id` 匹配 `/^[a-z][a-z0-9_]*$/`
- [ ] 目标文件不存在（不覆盖）
- [ ] `inputs[i].dataset_id` 都存在于 `data/datasets/*.meta.json`
- [ ] `default_prompt` 中 `/\{\{(\w+)\}\}/g` 提取的所有变量名（**除 `#cond` / `/cond` 之类**）都在 `variables[].name` 里
- [ ] `variables[i].source` 格式正确：`alias.field.path` 或 `literal:xxx`；alias 必须在 `inputs[].alias` 里
- [ ] `output_schema.required` 都在 `output_schema.properties` keys 里
- [ ] `display_id` 如果设置了，对应文件存在（`data/displays/{id}.json` 或 builtin 前缀 `builtin_*`）
- [ ] `display_dimensions[].field` 路径格式合法（`input_refs.*` / `input_preview.*.*` / `output.*`）
- [ ] JSON.parse 成功（Bash `python3 -c "import json; json.load(open('data/schemas/{id}.json'))"`）

### display 文件（如果建了）

- [ ] `mode` 是 `table` / `grouped_grid` / `jsx` 之一
- [ ] `source: "user"`
- [ ] JSX 模式的 `jsx.source` 是非空字符串
- [ ] JSX source 能 `node --check` 过（写到 `/tmp/xxx.js` 前面加 `const fn = ` 再 check）

发现问题就自己改。

## Step 6 · 引导用户下一步

产出完成后简短告诉用户：

1. schema / display 文件路径
2. 刷新 `/settings/templates` 能看到新评测任务
3. **建议接下来**：进 `/experiments/new` 选这个 schema 跑 1-2 条（可以在 filter 里给个 `limit=2`）快速验证 prompt 产出符合预期

## 不在本 skill 范围内

- 编辑已有 schema：让用户直接对话说「把 xxx schema 的 prompt 改成 yyy」，Claude 读 + Edit 即可，不需要走 skill
- seed schemas（如 `qa_answer_v1`）的修改：源在 `src/lib/seeds/xxx.schema.json`，直接改 seed 源 + 删除 `data/schemas/` 下对应文件让 ensureSeeds 重生
- 数据集创建：走 `/batch-eval-dataset`
- LLM 接口配置：一次性手动 `/settings/llm` 填就行
