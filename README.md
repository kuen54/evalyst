# evalyst — LLM prompt 批量评测平台

[![CI](https://github.com/kuen54/evalyst/actions/workflows/ci.yml/badge.svg)](https://github.com/kuen54/evalyst/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

**本地跑的通用 LLM prompt 评测平台**：一个表单定义评测任务 → 批量跑 LLM → 按维度自动呈现结果 → 跨实验对比。文件存储，不需要数据库，`docker compose up` 一条命令起。

适合你的场景：
- 同一个 prompt 想在不同模型/温度下对比
- 同一个模型想在不同 prompt 版本下对比
- 同一个任务想看它在一堆测试输入上的表现批次

**UI 原则**：**能不手写 JSON 就不手写。** 三种资源（数据集 / 评测任务 / 展示模板）全部有结构化表单——字段路径用下拉、filter / transform / 维度全是结构化编辑器、CSV 文件直接上传。AI agent 产 JSON 的通道仍保留作为兜底。

**Agent 驱动（推荐）**：Dashboard 空态和 `/settings` 顶栏各有一个「下载 SKILL.md」按钮。装上 `evalyst` skill 后，Claude Code 里一句话就能从零建数据集、评测任务、实验并跑起来——UI 专心展示结果。不想用 agent 也完全 OK，表单 UI 保持一流体验。

**内嵌 Copilot**（`⌘K` 打开）：右侧滑出对话面板，能"看到"你当前屏幕上的东西 —— 圈选实验卡、task 行、prompt 模板、任意文本作为 context 发给 Copilot；切换到 copilot 模式时主内容区统一切到玻璃 UI 语言，和普通编辑模式视觉清晰区隔。工具调用闭环（代用户改模板 + 触发重跑）规划中。

---

## 目录

1. [快速开始](#快速开始)
2. [Docker 启动](#docker-启动)
3. [核心概念](#核心概念)
4. [完整教程：从零搭一个评测任务](#完整教程从零搭一个评测任务)
5. [用 Agent 驱动](#用-agent-驱动)
6. [进阶](#进阶)
7. [常见问题](#常见问题)
8. [贡献](#贡献)

---

## 快速开始

```bash
npm install
npm run dev
# 打开 http://localhost:3000 （被占用会自动切到 3002）
```

**第一步先去 `/settings/llm` 把你的 LLM 配上**——URL / API key / 模型标识。首次启动是空的，没配就跑不了实验。支持配置多个模型（OpenAI / Anthropic / DeepSeek / 自托管网关 …），每个模型独立一张卡。

配完之后平台已经为你预置了一个示例评测任务（`qa_answer_v1`：让 LLM 回答 12 条小型 QA 并给置信度），可以直接在「新建实验」里选它跑几条看看效果。

> 侧栏底部有 🌐 **语言切换**（中 ⇄ EN）和 🌓 **主题切换**（浅色 / 深色 / 跟随系统）。语言选择会写入 localStorage，刷新保留。

---

## Docker 启动

```bash
docker compose up -d
# 打开 http://localhost:3000
```

- 实验 / 数据集 / 模型配置都持久化到宿主机 `./data/`（已加到 `.gitignore`）
- 停/重启：`docker compose down` / `docker compose restart`
- 本地改代码想重新 build：`docker compose up -d --build`

镜像是多阶段 build 的 node:20-alpine，runner 只带 `.next` / `public` / 必要 `node_modules` / `src/lib/seeds`，不含源码。

---

## 核心概念

平台围绕**四件套 + 评分量表**组织：

```
LLM 模型   →   数据集   →  评测任务   ⟶ 实验 ⟶  展示模板
 endpoint    原料素材    生产逻辑       跑一批    结果呈现方式
                                          ↘
                                           评分量表（可选）→ 人工/后续 LLM 给结果打分
```

| 概念 | 是什么 | 举例 |
|---|---|---|
| **LLM 模型** | 一条完整可调用配置：name + model 标识 + api_format + base_url + api_key + 默认参数 + 定价 | `gpt-4o-mini` / `claude-haiku-4-5` / `deepseek-chat` |
| **数据集** | 一张二维表（一行一条 JSONL） | 12 条 QA / 自己的产品库 / 测试输入集 |
| **评测任务** | 一次评测的完整定义：用哪些数据源、怎么抽字段拼 prompt、输出什么结构 | "QA answer v1：按 qa 跑，输出 answer + confidence" |
| **实验** | 一次具体的跑动：绑定一个评测任务 + 模型参数 + prompt + 筛选范围 | "qa-v1-gpt4o-temp1" |
| **展示模板** | 结果怎么呈现 | 表格 / 分组网格 / 图片+坐标叠加 / JSX 自定义 |
| **评分量表（可选）** | 一组评分维度（criterion），每维度独立类型 | "correct" pass/fail + "confidence 校准度" 1-5 |

**关键：展示模板 95% 的场景不需要手建。** 评测任务声明 `display_dimensions`（用哪些字段分组），系统自动选最合适的内置展示（单列表 / 双维分组 / 三维网格 / 坐标叠加）。

**所有资源的「创建 / 编辑」入口都是结构化表单**，手写 JSON 只在「AI agent 产出后粘贴」这一个场景下出现（每个 new 页都有一个 JSON tab 作为 fallback）。

---

## 完整教程：从零搭一个评测任务

以内置的「QA answer v1」为例——让 LLM 回答一个问题并给 1-5 的置信度。

### 步骤 1：配置 LLM 模型

进入 `/settings/llm`（默认入口）。点「+ 添加模型」加一张卡。每张卡填：

- **名称**（展示名，任意）：如 `OpenAI gpt-4o-mini`
- **接口格式**：`openai` 或 `anthropic`（下拉选）
- **模型标识**（api 上报 model）：如 `gpt-4o-mini` / `claude-haiku-4-5` / `deepseek-chat`
- **Base URL**：如 `https://api.openai.com/v1`、`https://api.anthropic.com/v1`、或任何兼容代理
- **API Key**：对应密钥
- **默认温度 / max_tokens**：新建实验时的预填值
- **定价**：USD / CNY 等单价（可选；填了才算成本）

点「测试连接」发一个 ping。显示 ✓ 再「保存」。有多个模型时点「设为默认」决定新建实验的下拉默认选中哪个。

> 配置写到本地 `data/llm-config.json`，不上传任何外部服务。

### 步骤 2：准备数据集

进入 `/settings/datasets`。平台预置了一个示例：

- `qa_pairs`：12 条问答对（`qa_id / question / reference_answer / topic / difficulty`）

点卡片进详情页：字段表、记录预览、被哪些评测任务引用的反查。右上角「编辑」进入编辑页（ID 不可改）。seeded 数据集也可以编辑，修改立即生效且不会被 seed 覆盖。

**创建自己的数据集**：进入 `/settings/datasets/new`，两种方式：

**方式 A：Form 填写（推荐）**
1. 切到「📝 表单填写」tab
2. 填 ID / 展示名 / 字段定义
3. 在「记录数据」区域粘贴，或点「📂 上传文件」上传。**支持三种格式**：
   - **JSONL**：一行一条 JSON
   - **JSON 数组**：`[{...}, {...}]`
   - **CSV**：首行字段名（自动用 papaparse 处理引号、转义、换行）
4. CSV 导入时若字段表还没填，自动推断字段类型（`string / number / boolean / url`）并填 id_field
5. 右栏实时预览：记录数、字段覆盖率、前 5 条采样

**方式 B：AI agent 生成 JSON**
1. 切到「📋 AI agent 生成 JSON」tab
2. 左栏的 meta-prompt 复制丢给你的 AI agent
3. agent 返回 JSON 粘到右栏 → 「解析并校验」→「保存」

存到 `data/datasets/{id}.{jsonl, meta.json}`。

### 步骤 3：创建评测任务

进入 `/settings/templates`。点「+ 新建评测任务」。左边是表单，右边是实时预览。

#### 3.1 基本信息

- **ID**：`qa_answer_v2`（小写 + 下划线，不能和现有冲突）
- **展示名**：`QA Answer v2`
- **描述**：一句话说明
- **Compare group**：留空（默认 = ID，相同 group 的任务可互相对比）

#### 3.2 输入数据源（inputs）

定义这次评测对哪些数据做笛卡尔积。

示例一个 input：
- **Alias**：`qa`（后面 prompt 里用 `qa.xxx` 引用）
- **Dataset**：下拉选 `qa_pairs`
- **Filters**：点「+ 添加过滤器」，下拉选 5 种 kind：
  - `multiselect` / `literal_set` — 多选，options 可点「从数据推断」自动抽
  - `checkbox` — 开关
  - `number` — 数字（role: limit / min / max）
  - `text_in` — 文本包含
  每种 kind 有自己的结构化参数行，不再需要手写 JSON。

加多个 input 会做笛卡尔积（比如 `qa × user profiles`）。

#### 3.3 变量（variables）

从 inputs 抽字段给 prompt 用。点「+ 添加」。

| 字段 | 怎么填 |
|---|---|
| **name** | 手填，例如 `question` |
| **source** | FieldPicker 下拉选（`qa.question` / `qa.reference_answer` / 字面量 `literal:xxx`），也可手输 |
| **transform** | 结构化编辑器：下拉选 op（`join / truncate / slice / eq / notEmpty / default / map / prompt_excerpt / spu_desc_list / js`），每种 op 出对应参数行。可多步串联、上下重排。**不再是 JSON 输入**。 |
| **fallback** | 为空时的默认值 |

例如把数组拼成字符串 → 选 source 字段 + 加一个 `join` 步（分隔符 `、`）。

#### 3.4 Prompt 模板

System prompt 里用 `{{variable}}` 插值：

```
You are a helpful assistant answering short factual questions.

Return JSON: {"answer": "...", "confidence": 1-5}

Question: {{question}}
Reference: {{reference}}
```

下面的变量提示栏会列出可用变量，点击可直接复制。

**图片字段路径**（多模态场景）：下拉选，例如 `item.image_url`。

#### 3.5 输出字段（output_schema）

告诉平台 LLM 应该返回什么 JSON 结构。添加字段：
- `answer` : string, required
- `confidence` : number, required, enum: 1,2,3,4,5

平台会按类型校验每条 LLM 响应（不符合 → `parse_error` 状态）。

#### 3.6 展示维度（display_dimensions）

声明结果按哪些字段分组呈现。维度数量决定自动选哪个展示模板：

| 维度数 | 展示模板 | 形态 |
|---|---|---|
| 0 / 1 | single_list | 每条一行 |
| 2 | dual_list | 按 dim1 分组，dim2 作为行 |
| 3 | triple_grid | 按 dim1 分组，dim2 × dim3 二维网格 |
| ≥ 4 | single_list | header 合并所有维度值 |
| output 含 `tuple:number[]` 且 inputs 有图片字段 | bubble_overlay | 图片 + 坐标标签 |

点「+ 添加」。字段用 FieldPicker 下拉选（可选 `input_refs.*` / `input_preview.*.*` / `output.*`）。

**右栏预览**会实时反映推断结果：「推断的 display: `builtin_single_list`」，并用数据集前 3 条 + mock output 真实渲染出效果。

#### 3.7 保存

点底部「保存」。存到 `data/schemas/qa_answer_v2.json`，跳转到详情页。

### 步骤 4：新建实验

进入 `/experiments/new`。

1. **实验名称**：`v2-gpt4o-temp1`
2. **评测任务**：卡片选 `QA Answer v2`
3. **模型**：从模型列表下拉选（切换后 `model / 温度 / max_tokens` 自动填该条的 default，可就地改）
4. **Prompt 模板**：从评测任务预填，可就地改
5. **范围筛选**：根据评测任务的 filters 渲染

右下角实时显示「预计生成 N 个任务」。点「保存并运行」或「保存草稿」。

### 步骤 5：看结果

保存并运行后跳转到实验详情页。头部展示运行状态（running / completed / paused）+ tokens / 成本（按每个模型的 currency 聚合），下方按你声明的 `display_dimensions` 自动渲染。

**中途可以「暂停」**。重新进入点「继续运行」，平台从 progress.json 断点续跑（失败任务会重试）。

**失败 task 单条 retry**：跑完后详情页有红色「失败任务」Card，列所有 `status !== 'success'` 的 task，每条旁边一个 `↻ 重试` 按钮，只重跑这一条（不动其他成功结果）。

### 步骤 6（可选）：评分量表 + 打分

想量化评估结果？给实验绑一个 Rubric：

1. `/settings/rubrics` → 点「+ 新建量表」
2. 填 ID（如 `qa_accuracy`）+ 名称 + 评分维度（criteria）。每个 criterion 独立类型：
   - `pass_fail` — Pass / Fail 二选一
   - `likert_1_5` — 1-5 打分
   - `score_0_100` — 0-100 数值
3. 回 `/experiments/new`，「评分量表 (可选)」下拉选刚建的量表
4. 实验跑完回详情页，顶部出现 Scoring card —— 逐条 result 点「Score」打分
5. 打几条后实时看到聚合指标：`correct: 75% pass` · `confidence: avg 3.2 (1-5)`

平台自带 `qa_accuracy` 量表（correct pass/fail + confidence_calibrated 1-5）作为示例。

### 步骤 7：跨实验对比

跑多个实验（换模型 / 换 prompt / 换温度）后，进入「实验对比」页：

1. 左栏按 Schema 筛选，勾选 2 个以上同 `compare_group` 的实验
2. 右栏按 `input_refs` 对齐：每行对应一条输入 → 多列是不同实验的结果
3. Prompt 悬停 hover 可看当时用的 system prompt 全文

---

## 用 Agent 驱动

不想手点七步教程？用 Claude Code 一句话跑完。

### 装 skill

打开 Dashboard 空态或 `/settings` 顶栏，点「下载 SKILL.md」→ 保存到 `~/.claude/skills/evalyst/SKILL.md` → 重启 Claude Code 会话。同理可装两个子 skill：

| skill | 作用 | 入口 |
|---|---|---|
| `evalyst` | 平台级。教 agent 端到端跑一轮（建数据集/任务/实验/读 result/打分） | Dashboard 空态 · `/settings` 顶栏 |
| `evalyst-dataset` | 只产数据集 | `/settings/datasets/new` 顶栏 |
| `evalyst-task` | 只产评测任务（TaskSchema） | `/settings/templates/new` 顶栏 |

### 典型用法

在 Claude Code 对话框（确保 `cwd` 在项目根）：

```
/evalyst
帮我测 gpt-4o-mini 和 claude-haiku 在 20 条英译中上的质量。
```

agent 会：
1. 检查 dev server（没起来就提醒你 `npm run dev`）
2. 问清或自己推断出数据集（如果你让它从本地 CSV 读）
3. 建数据集 / 评测任务 / 两个实验
4. 跑起来，轮询进度
5. 给你打开 `http://localhost:3000/compare?...` 看对比

整个过程你只需要在浏览器看结果。复杂 JSON 配置（filter 结构、transform 链、display_dimensions）由 agent 负责写对。

### 不装 skill 走 API

skill 本质是一份 prompt 文档 + `curl` 用法指南，平台的 REST API 是权威接口：

- `GET / PUT /api/llm-config`
- `GET / POST /api/datasets` · `GET / PATCH / DELETE /api/datasets/[id]`
- `GET / POST /api/schemas` · `GET / PATCH / DELETE /api/schemas/[id]`
- `GET / POST /api/experiments` · `POST /api/experiments/[id]/run`（可带 `task_ids` 精准重试）· `/stop` · `/results` · `/annotations`
- `POST /api/estimate` —— 跑之前估算任务数
- `GET / POST /api/rubrics` · `GET / POST /api/displays`

类型签名见 `src/lib/types.ts` + `src/lib/schema/types.ts`。你自己写脚本 / 自己的 agent 也能跑。

> **注意**：当前 API 无鉴权，适合本地开发。开源前会补 token 机制。

---

## 进阶

### 自定义 JSX 展示模板

如果 4 件套覆盖不了你的视觉需求（比如想做彩色热力图 / 自定义图表），可以自建 display：

进入 `/settings/displays/new`，切到「📝 表单填写」tab。顶部三选一：

- **📊 表格（table）**：加列（field 路径 + type 下拉 + label + max_length），行是 result，列是你加的字段
- **🗂 分组网格（grouped_grid）**：primary_group + secondary_group 两个维度字段，单元格列用同样的结构化编辑器
- **🎨 JSX 自定义**：写一段 JSX 函数体

JSX 例子：

```jsx
({ result, schema, helpers }) => (
  <div className="p-3 border rounded">
    <helpers.Badge variant="secondary">
      conf {helpers.readField(result, 'output.confidence')}
    </helpers.Badge>
    <p className="text-sm mt-1">{helpers.readField(result, 'output.answer')}</p>
  </div>
)
```

可用 helpers：
- `helpers.readField(result, path)` — 按路径取值
- `helpers.formatValue(v, maxLen)` — 格式化
- `helpers.renderField(v, type, maxLen)` — 按 type 渲染节点
- `helpers.Badge` — shadcn Badge 组件

浏览器端 `@babel/standalone` 编译 + ErrorBoundary 兜底。错误 JSX 只影响该 cell，不会崩整个页面。

右栏还有 **实时预览**：用 3 条 mock 记录按当前配置渲染，改一行表单立刻看效果。

### 评测任务的 JSON 导入

表单覆盖不了的极少数场景（比如你让 AI agent 整份产出一个复杂 TaskSchema），点表单顶部「📋 JSON 导入」tab 粘贴即可。粘完会应用到表单并自动切回「表单填写」tab，你可以继续调。

Meta-prompt 模板在 `src/lib/meta-prompts/template.ts`，含完整示例可参考。数据集 / 展示模板 new 页也各有相应的 meta-prompt。

### 从现有评测任务复制

详情页右上角「复制到新模板」按钮，会跳到 `/settings/templates/new?from=xxx`，预填所有字段但清空 ID 让你填新的。

### 中英双语

侧栏底部有 🌐 语言切换按钮。整站 UI chrome（菜单、按钮、表单 label、toast、section 头）都支持中 ⇄ EN；用户自己写的内容（数据集 name、schema label、filter label、LLM 生成的业务文案）永远保留原样。

新增 UI 文案时要在 `src/lib/i18n/zh.ts` 和 `en.ts` 成对加 key，组件用 `useT()` 消费。详见 `CLAUDE.md` 的 i18n 章节。

### 多模态（图片）

评测任务的「图片字段路径」指定到一个 URL 字段（如 `item.image_url`），`callLlm` 会自动把图片附到消息里：
- OpenAI：`content: [{type: 'text', ...}, {type: 'image_url', image_url: {url: ...}}]`
- Anthropic：`content: [{type: 'text', ...}, {type: 'image', source: {type: 'url', url: ...}}]`

不需要自己改代码。

### 种子资源

`src/lib/seeds/` 下的文件在首次访问数据集 / 评测任务列表时会自动拷贝到 `data/`。想加新的"示例"给团队成员用，写 JSON 到 `src/lib/seeds/`，在 `src/lib/seed.ts` 里登记 ID 即可。

---

## 常见问题

**Q: 我删了示例数据集/评测任务，它又回来了？**  
A: seed 机制的设计。示例文件由 `src/lib/seeds/` 首次访问时 lazy-copy。想永久删除，从 `src/lib/seed.ts` 的种子列表移除那个 ID。

**Q: 配了模型但实验一直 `error`？**  
A: 在 `/settings/llm` 对应卡点「测试连接」确认能通。如果失败：① `base_url` 结尾别加 `/`；② OpenAI 兼容格式填纯 api_key 即可（会自动加 `Bearer ` 前缀）—— 如果你的 gateway 明确不要 Bearer，请开 issue 我们会补 `ModelConfig.auth_no_bearer_prefix` 选项；③ 检查模型名是否存在。

**Q: 跑到一半想停？**  
A: 实验详情页的「暂停」按钮。数据写到 `data/results/{id}/progress.json`，再进来「继续运行」会从未完成的任务继续（失败的会重试）。

**Q: 对比两个实验时只看到半边数据？**  
A: `compare_group` 必须一致才能对比。评测任务里没显式指定 compare_group 时默认 = ID。新版本改进时同 compare_group + 不同 ID 就能跨版本对比。

**Q: 展示效果不对 / 想换一种呈现？**  
A: 先看评测任务的 `display_dimensions` 是否符合你想要的分组结构。详情页底部会显示「推断到的 display」。想强制用另一个展示模板，在实验创建或评测任务里设置 `display_id` override。

**Q: 能用 Anthropic 的模型吗？**  
A: 能。`/settings/llm` 加一张模型卡，接口格式选「anthropic」，base_url 填 `https://api.anthropic.com/v1`，key 填 `sk-ant-...`，model 填 `claude-sonnet-4-6` 或 `claude-haiku-4-5`。图片会自动转成 Anthropic 的 `source.url` 格式。

**Q: 结果 JSONL 文件在哪？能直接看吗？**  
A: `data/results/{experiment_id}/results.jsonl`。一行一条 `GenericResultRecord`，含 `output` / `status` / `latency_ms` / `cost_value` / `cost_currency` 等字段。同 `task_id` 重复时取最后一条（重试覆盖旧失败）。

**Q: 本地数据如何备份/分享？**  
A: 整个 `data/` 目录打包即可。`data/llm-config.json` 含敏感 key，分享前记得清掉。

**Q: 有单测吗？**  
A: 有。`npm test` 跑一轮（vitest，217 case ~180ms），覆盖 transform 的 10 种 op、Schema validate、成本/currency 聚合、rubric 聚合、三层 LLM config 迁移等所有纯函数。`npm run test:e2e` 跑 Playwright 的端到端 smoke（遍历所有关键路由 + `/api/skills` 下载，首次需 `npx playwright install chromium`）。CI 两个 job 都会跑。

---

## 技术栈

Next.js 16.2.4（App Router + Turbopack）/ React 19 / TypeScript / shadcn/ui v4 / Tailwind CSS v4 / `@babel/standalone`（JSX display 编译）/ `papaparse`（CSV 导入）/ next-themes（主题）+ 自建轻量 i18n（中英双语）/ vitest（单测）/ Playwright（E2E smoke）。无数据库，全文件存储。

开发/架构文档见 `CLAUDE.md`；代码约定见 `AGENTS.md`。

---

## 贡献

欢迎 PR / issue。贡献前请读一遍 [CONTRIBUTING.md](./CONTRIBUTING.md)——里面有 setup、代码约定、提交流程。

大改动先开 issue 对齐方案再动手。

---

## License

[MIT](./LICENSE) — 随便用，原样保留版权声明即可。
