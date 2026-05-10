# evalyst

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

## 技术栈

- Next.js 16.2.4 (App Router, Turbopack) + React 19 + TypeScript
- shadcn/ui v4 + Tailwind CSS v4
- next-themes（class 策略）
- 自建轻量 i18n（`src/lib/i18n/`，zh / en，localStorage 持久化）
- `@babel/standalone` 浏览器端 JSX 编译（用户自定义展示模板）
- `papaparse` CSV 解析（数据集表单上传）
- 测试：`vitest`（纯函数单测，221 case）+ `playwright`（E2E smoke，9 case）
- 无数据库，文件存储（JSON + JSONL）

## 四件套 + Rubric 架构

```
LLM 模型    →   数据集 Dataset   →  评测任务 TaskSchema  ⟶ 实验 ⟶   展示模板 Display
 endpoint      原料素材           定义生产逻辑          批量跑      结果如何呈现
                                                                     （通常自动推断）
                                                           ↘
                                                            Rubric（可选）→ Annotation 评分记录
```

所有资源统一走文件存储：

| 资源 | 存储 | 说明 |
|---|---|---|
| LLM 模型列表 | `data/llm-config.json` | `{ models: ModelConfig[], active_model_id?: string }` |
| 数据集 | `data/datasets/{id}.{jsonl, meta.json}` | 一行一条 record |
| 评测任务 | `data/schemas/{id}.json` | 代码内部类型叫 `TaskSchema` |
| 实验 | `data/experiments/{id}.json` + `data/results/{id}/` | 配置 + JSONL 结果 + 进度 |
| 展示模板（用户自定义） | `data/displays/{id}.json` | 仅 JSX / table / grouped_grid 模式需要 |
| 评分量表 | `data/rubrics/{id}.json` | `Rubric` 定义（name + criteria[]） |
| 评分标注 | `data/results/{experiment_id}/annotations.jsonl` | append-only；同 (task_id, rubric_id, evaluator) 按 timestamp 取最新 |

**首次启动 seed**：`src/lib/seed.ts` 的 `ensureSeeds()` 在每次 `listDatasets()` / `listSchemas()` / `listRubrics()` 时调用，检测 `data/` 下缺失的示例文件就从 `src/lib/seeds/` 拷贝过来（幂等、用户删除后自动恢复）。当前包含：

- `qa_pairs` 数据集（12 条示例 QA）
- `qa_answer_v1` 评测任务（让 LLM 回答 QA + 自评置信度）
- `qa_accuracy` 评分量表（2 个 criteria：correct pass/fail + confidence_calibrated 1-5）

## LLM 模型列表

`data/llm-config.json`（首次启动为空，用户必须显式配置）：

```ts
interface ModelConfig {
  id: string                 // slug，nanoid(6)
  name: string               // 展示名
  model: string              // 模型标识（API 的 model 字段）
  api_format: 'openai' | 'anthropic'
  base_url: string
  api_key: string
  default_temperature?: number
  default_max_tokens?: number
  pricing?: { input_per_mtok, output_per_mtok, currency? }
}

interface LlmConfig {
  models: ModelConfig[]
  active_model_id?: string   // 新建实验时的默认选中
}
```

新建实验时 `createExperiment` 按 `req.model_id ?? active_model_id` 挑一条，snapshot `api_format/base_url/api_key` 到 `ExperimentConfig.api_config` —— 之后改 / 删 model 不影响已跑实验。

`src/lib/llm-client.ts` 对两种 API 格式的差异完全封装：
- `buildApiRequest(config, body) → { url, headers, body }`：按 `api_format` 分支（OpenAI 用 `/chat/completions` + `Authorization`；Anthropic 用 `/messages` + `x-api-key` + `anthropic-version`）
- `executeWithRetry(req, signal)`：3 次重试 / 120s 超时 / AbortController 共享脚手架
- `callLlm` 主流程：`buildRequestBody → buildApiRequest → executeWithRetry → parseResponse`

图像字段在 Anthropic 格式下会自动转成 `{ type: 'image', source: { type: 'url', url: ... } }`。

成本计算 `batch-runner.executeTask`：每个 task 实时 `findPricing(cfg, model, model_id)` 读当前配置，算 `cost_value` + `cost_currency`。

## Display 自动推断

评测任务声明 `display_dimensions: DisplayDimension[]`，`src/lib/display-inference.ts` 按规则选内置 display：

| 条件 | Display |
|---|---|
| output 含 `tuple:number[]` 字段 + inputs 有图片字段 | `builtin_bubble_overlay` |
| `display_dimensions.length` ∈ {0, 1} | `builtin_single_list` |
| = 2 | `builtin_dual_list` |
| = 3 | `builtin_triple_grid` |
| ≥ 4 | `builtin_single_list`（header 合并维度） |
| 推断失败 | `builtin_json_default` |

评测任务可通过 `display_id` 显式覆盖（例如指向自建 JSX display）。

`DisplayDimension` 结构：

```ts
{
  field: string                           // 'input_refs.qa' / 'input_preview.qa.topic' / 'output.answer'
  label?: string
  value_labels?: Record<string, string>
  order?: Array<string | number>
}
```

## 评测任务创建：表单 + JSON 导入

`/settings/templates/new` 是结构化表单（`src/components/template-builder/template-form-page.tsx`），覆盖 inputs / variables / prompt / output / display_dimensions / display override。

- 顶部「JSON 导入」按钮可粘贴 agent 产的 JSON 一键填表（便于走 `src/lib/meta-prompts/template.ts` 的 meta-prompt 流程）
- 右栏实时预览：`src/lib/mock-data.ts` 用数据集前 3 条 record + 按 `output_schema` 生成的 mock output 组合成 `GenericResultRecord`，调 `pickView` 真实渲染 4 件套（所见即所得）
- `FieldPicker` 组件（`src/components/template-builder/field-picker.tsx`）给三处提供字段路径下拉：
  - `variable.source` → scope=inputs_only，`alias.field` 格式
  - `image_field` → scope=inputs_only + filterType=url
  - `display_dimensions.field` → scope=all（含 input_refs / input_preview / output）

## 结构化编辑器 —— "能不手写 JSON 就不手写"

评测任务和展示模板表单里，过去需要粘贴 JSON 的地方全部换成了结构化控件。各 editor 组件：

| 组件 | 替代的 JSON | 用法 |
|---|---|---|
| `FieldPicker` (`template-builder/field-picker.tsx`) | 手输字段路径 | 下拉分组显示所有可选路径（按 input alias 聚类），仍允许手输（支持 `literal:xxx`），不合法路径加红边提示 |
| `FiltersEditor` (`template-builder/filters-editor.tsx`) | `inputs[i].filters` JSON | 5 种 filter kind（multiselect / literal_set / checkbox / number / text_in）各有结构化参数行；options 可「从数据推断」 |
| `TransformChainEditor` (`template-builder/transform-chain-editor.tsx`) | `variable.transform` JSON 数组 | 下拉选 10 种 op（`join / truncate / slice / eq / notEmpty / default / map / prompt_excerpt / spu_desc_list / js`），每种 op 独立参数表单；可上下排序 |
| `KeyValueEditor` (`template-builder/key-value-editor.tsx`) | `value_labels` / transform `mapping` 字典 | key / value 两列行编辑 |
| `OrderListEditor` (`template-builder/order-list-editor.tsx`) | `dimension.order` 数组 | 一行一值 + 上下箭头 |
| `HeaderFieldsEditor` (`template-builder/header-fields-editor.tsx`) | `header_fields` JSON | FieldPicker + label，每行一个字段 |

Display 表单（`src/components/settings/display-form-page.tsx`）也全表单化：顶部三选一（table / grouped_grid / jsx），每种模式有对应的列编辑器（field 路径 + type 下拉 + max_length）；JSX 模式直接写函数体，右栏实时预览 3 条 mock 数据。

**JSON 入口仍保留作为 fallback**：三个资源的 new 页（`datasets/new`、`templates/new`、`displays/new`）都是 Tabs 结构，第一个 tab 是表单，第二个 tab 是 meta-prompt + JSON 粘贴。表单顶部也有「JSON 导入」一键覆盖整个表单状态。

## 详情 / 编辑 / 复制

- `/settings/templates/[id]`：详情页（schema 全貌 + 关联实验列表 + 三个按钮：复制到新模板 / 编辑 / 删除）
- `/settings/templates/[id]/edit`：复用 `TemplateFormPage`（`mode=edit` → PATCH）
- `/settings/templates/new?from=xxx`：复制到新模板（预填表单但清空 ID）
- `/settings/datasets/[id]`：详情页（字段定义表 + 记录预览 + 被哪些评测任务引用）
- `/settings/datasets/[id]/edit`：复用 `DatasetFormPage`（`mode=edit` → PATCH，ID 不可改）

列表卡片点击跳转详情（数据集 / 评测任务 / 展示模板卡片均可点）。

## 数据集表单：JSONL / JSON / CSV 上传

`DatasetFormPage`（`src/components/settings/dataset-form-page.tsx`）支持三种上传格式：
- **JSONL**：一行一条 JSON
- **JSON 数组**：`[{...}, {...}]`
- **CSV**：首行字段名，走 `papaparse`（正确处理引号、转义、换行）

CSV 导入时，如果表单还没声明字段，自动推断字段类型（`string / number / boolean / url`）并填 `id_field` 为第一个字段；已声明字段则只更新 records 文本。全客户端解析，下游预览 / 校验链路不变。

Seeded 数据集（`source === 'builtin'`）也可编辑，顶部 banner 提示"修改立即生效；seed 只在文件缺失时恢复，不会覆盖你的编辑"。

## 评分系统（Rubric + Annotation）

给实验结果打分的闭环。**可选**——未绑定 rubric 的实验照跑照看，只是不能评分。

### Rubric（评分量表）

`data/rubrics/{id}.json`：

```ts
interface Rubric {
  id: string
  name: string
  description?: string
  source?: 'builtin' | 'user'
  criteria: Array<{
    key: string                     // slug，如 'correct'
    label: string
    type: 'pass_fail' | 'likert_1_5' | 'score_0_100'
    description?: string
    required?: boolean              // 为 true 时未填则该 task 算"未完成评分"
  }>
}
```

CRUD 路径：`/settings/rubrics`（list）→ `/{id}`（详情：criteria 表 + 关联实验）→ `/{id}/edit`。pattern 和 templates / datasets 一致。

### Annotation（标注）

`data/results/{experiment_id}/annotations.jsonl`，一行一条：

```ts
interface Annotation {
  annotation_id: string             // nanoid(10)
  task_id: string                   // 指向 GenericResultRecord.task_id
  rubric_id: string
  evaluator: 'human' | 'llm' | 'rule'
  scores: Record<string, number | boolean>  // criterion.key → value
  rationale?: string
  timestamp: string
}
```

**Append-only**；同 `(task_id, rubric_id, evaluator)` 多次打分产生多条记录，`latestAnnotations()` 按 timestamp 取最新。删实验时 `data/results/{id}/` 整目录清掉，annotations 一起没。

### 聚合 `aggregateAnnotations`

`src/lib/annotation-store.ts`：对每个 criterion 算：
- `pass_fail` → pass rate + pass/fail 计数
- `likert_1_5` → avg + min/max + 1-5 分布 dist
- `score_0_100` → avg + min/max

### UI

- 新建实验表单「评分量表 (可选)」下拉从 `/api/rubrics` 拉，提交带 `rubric_id`
- 实验详情页绑定 rubric 时顶部显示 Scoring card：`{annotated}/{total} 已评` + per-criterion 聚合；下面列每条 result + `Score` 按钮
- 点按钮弹 `RubricAnnotator` Dialog：pass_fail 渲染 Pass/Fail 两键；likert_1_5 渲染 1-5 数字键；score_0_100 渲染 number Input；+ rationale textarea。保存 POST `/api/experiments/{id}/annotations`

**未绑 rubric**：UI 不渲染 Scoring card，实验照样能跑。

## 失败 task 单条 retry

实验详情页有红色 `FailedPanel`（Collapsible Card）列所有 `status !== 'success'` 的 result，每条：
- task_id + error（截断 200 字符）
- `↻ 重试` 按钮

点击 → POST `/api/experiments/{id}/run` with `{ task_ids: [task_id] }` → 后端 `batch-runner.startBatch(cfg, resume=true, concurrency, taskIds)` 把 pendingTasks 过滤到只包含该 task_id，其他保留；历史 stats 累加照旧。Running 期间按钮 disabled；1s poll 刷新结果，该 task success 后自动从 panel 消失。

"重试所有失败" = 原 resume 语义（保留），按钮在状态栏里。

## 单元测试（vitest）

`src/**/*.test.ts` → `npm test` / `npm run test:watch`。

| 测文件 | 覆盖 |
|---|---|
| `src/lib/schema/__tests__/transform.test.ts` | 10 种 op（join/truncate/slice/eq/notEmpty/default/map/prompt_excerpt/spu_desc_list/js）+ readPath |
| `src/lib/schema/__tests__/validate.test.ts` | `validateJson` 全 type 分支 + required/enum/length |
| `src/lib/__tests__/results-aggregate.test.ts` | per-currency 分桶 + has_token_data/has_cost_data |
| `src/lib/__tests__/annotation-aggregate.test.ts` | `latestAnnotations` 去重 + `aggregateAnnotations` 三种 criterion |
| `src/lib/__tests__/format.test.ts` | formatCost 档位 × 币种符号；formatTokens；formatCostMap |
| `src/lib/__tests__/llm-config.migrate.test.ts` | V1/V2/V3 三层兼容 + pickModel + findPricing + isLlmConfigured |
| `src/lib/__tests__/store.migrate.test.ts` | `migrateExperimentInMemory`（`run_stats.total_cost_usd` → `total_cost_by_currency.USD`；保留已有 `total_cost_by_currency` 不覆盖） |

221 个 test case，~180ms 跑完。**只测纯函数**——API route / UI 组件不测。

**惰性路径**：`llm-config.ts` / `annotation-store.ts` 的 `configDir()` / `resultsDir()` 是惰性函数（不在模块加载时 freeze `process.cwd()`），测试里 chdir 到 tmp 目录能生效。生产 cwd 固定，无副作用。

## E2E smoke（Playwright）

`e2e/smoke.spec.ts` → `npm run test:e2e`（首次需 `npx playwright install chromium`）。覆盖：

- 每条关键路由（`/` / `/experiments/new` / `/compare` / `/settings/llm,datasets,templates,displays,rubrics`）navigate → HTTP < 400 → 侧栏 chrome 渲染 → 页面自带 anchor 文本渲染 → 运行时无 `pageerror`
- `/api/skills/evalyst-dataset` 返回 200 + markdown 正文（防止 Docker 部署漏拷 `.claude/skills/` 这类回归）

Playwright 配置在 `playwright.config.ts`：`webServer` 跑 `npm run dev`（本地 `reuseExistingServer: true`），默认只用 chromium；失败时产出 `test-results/` 和 `playwright-report/`（已加 gitignore）。

CI（`.github/workflows/ci.yml`）两个 job：
- `verify` — `tsc --noEmit → lint（fail-on-warning）→ test → build`
- `e2e`（依赖 verify 通过）— `npx playwright install --with-deps chromium → npm run test:e2e`，失败上传 HTML report 作为 artifact

## Copilot（内嵌 AI 助手）

`⌘K` 打开的右侧滑出对话面板。核心诉求：把"结果不满意 → 把系统 context 复制到另一个对话窗口 → 调 prompt → 复制回来 → 重启实验"的拷贝粘贴链路，换成一条"圈选 + Copilot 直接改模板/重跑"的路径。

### 状态（2026-05-03 · v2）

- ✅ **Session + 流式对话**：`src/lib/copilot/session-store.ts` jsonl append-only + fork + prune-descendants；`llm-stream.ts` OpenAI + Anthropic SSE 归一化
- ✅ **Share Context + Inspector**：9 种 context 类型（experiment / task_result / task_field / text_selection / template / dataset / display / rubric / rubric_stats），Chrome DevTools 风格元素圈选，彩色 mask + 数字徽章，context 层级链（ancestors → `within: A → B → C`）
- ✅ **划线选中**：选区 → "+加入 Copilot" 胶囊 → 持久化高亮（TextSelectionMask 用 TreeWalker 按 offset 重建 Range）
- ✅ **Liquid Glass UI 系统**（见下一节）
- ✅ **v2 架构重构（2026-05-03）**：metadata-first tool descriptor + progressive disclosure + tool result 落盘护栏 + micro-compact。system prompt 恒定小，LLM 按需 tool 拉详情。
  - **工具 8 个**：`list_experiments` · `read_experiment_results`（带 `group_by/aggregate/filter` 聚合）· `restart_experiment` · `read_page` · `read_context(ctx_N, scope?)` · `read_resource(type,id,fields?)` · `read_tool_result(ref)` · `edit_template`（写工具，Confirm gate）
  - **Progressive disclosure**：SystemHeader 只放 `route_type + path + active_contexts[{id,type,ref,summary,within}]`；LLM 看到 ctx_N 后按需调 `read_context`；想查没圈过的资源调 `read_resource`
  - **护栏**：超 `maxResultSizeChars` 的 tool output 自动落盘到 `data/copilot/tool-results/{sid}/tr_xxx.json`，transcript 只留 preview+ref；LLM 想要完整 payload 调 `read_tool_result(ref)`
  - **Micro-compact**：每轮组装 LLM messages 前跑一次，老的可重放 tool_result 压成 summary（保最近 3 条），cache 前缀稳定
  - **Hooks**：`preToolCall`（confirmGate + audit）+ `postToolCall`（payloadGuard + telemetry）；Confirm 完全 metadata 驱动（`isDestructive` / `requiresConfirm`），不再写在 UI
  - Spec: `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`
  - Plan: `docs/superpowers/plans/2026-05-03-copilot-context-tool-v2.md`
- ✅ **PR-3 工具调用闭环（2026-04-28，PR #3 + #4）**：v2 保留的 pipeline 时序 race fix（appendMessage 并发 / auto-run 串行 / abortRef / SSE write-after-close / Confirm race / Gemini thinking `thought_signature` 原样回传 / chain 上限 5）
  - Spec: `docs/superpowers/specs/2026-04-28-copilot-pr3-tool-calling-design.md`
  - Plan: `docs/superpowers/plans/2026-04-28-copilot-pr3-tool-calling.md`

### 关键文件

```
src/lib/copilot/
├── types.ts                   # CopilotSession/Message/Event/ContextRef + ToolResultContent
├── session-store.ts           # jsonl 会话存储 + fork + normalizeToolResult + getActiveContext*
├── llm-stream.ts              # callLlmStreaming OpenAI + Anthropic 归一化
├── context-registry.ts        # KNOWN_CONTEXT_TYPES + captureFromElement + elementKey
├── resolve-context.ts         # batch resolver + formatContextsForLlm + resolveContextById(scope)
├── snapshot-cache.ts          # per-session 页面快照 Map（不入 transcript）
├── system-header.ts           # v2: buildSystemHeader + inline 阈值 predicate
├── build-llm-messages.ts      # 组装 LLM messages：system header + micro-compact + tool_result kind 分发
├── tool-runtime.ts            # runTool pipeline + truncateJsonSemantic
├── tool-result-store.ts       # maybePersistToolResult / loadPersistedToolResult / deleteToolResultDir
├── micro-compact.ts           # 老 tool_result 压成 compacted summary（保最近 N 条）
├── tool-adapters.ts           # ToolDescriptor → OpenAI / Anthropic tools 格式
├── stream-response.ts         # runToolAwareLlmStream helper（/chat + /tool-result 共用）
├── tools/                     # v2 工具集（每工具一文件）
│   ├── types.ts                     # ToolDescriptor + ToolMetadata + ToolContext
│   ├── registry.ts                  # TOOLS array + toolByName Map + AnyToolDescriptor
│   ├── metadata-client.ts           # client-safe metadata 镜像（UI 不 import server fs 链）
│   ├── hooks.ts                     # preToolCall / postToolCall + confirmGate + payloadGuard
│   ├── list-experiments.ts
│   ├── read-experiment-results.ts   # 带 group_by / aggregate / filter
│   ├── restart-experiment.ts        # isDestructive
│   ├── read-page.ts
│   ├── read-context.ts              # 用户圈的 ctx_N，带 scope=self|parent|full
│   ├── read-resource.ts             # 顺藤摸瓜查没圈的资源
│   ├── read-tool-result.ts          # 按 ref 回捞落盘的 tool_result
│   └── edit-template.ts             # 第一个写工具，Confirm gate
└── __tests__/                 # 单测（含 v2 测）

src/components/copilot/
├── panel.tsx                  # 右侧 slide-in panel（resizable 360–720px）
├── session-list.tsx           # 顶部 session 切换 + 新建 + 改名 + 删除
├── chat-view.tsx              # markdown 渲染 + 流式 token + chip rail + expand textarea
├── context-chip-rail.tsx      # 圈选按钮 + chip 行（v2: chip 可展开看详情，懒加载 /contexts/resolve）
├── tool-call-card.tsx         # v2: variant 路由（context/resource/retrieval/write/default）
├── shell.tsx                  # 9 档玻璃系统 + useGlassStyle hook（见下）
├── store.tsx                  # React Context 全局状态 + localStorage/sessionStorage 持久化
├── inspector-overlay.tsx      # DevTools 风格元素圈选
├── context-mask.tsx           # 彩色蒙层 + 数字徽章 + × 移除按钮
├── glow-overlay.tsx           # 背景漂移光斑 + 点击 spawn 光点
├── text-selector.tsx          # 选区监听 + "+加入 Copilot" 胶囊
├── text-selection-mask.tsx    # 划线持久化高亮
├── use-chat-stream.ts         # SSE parse + messages state + send/confirm/deny
└── model-picker.tsx           # 筛 copilot_enabled 模型

src/app/api/copilot/
├── sessions/…                 # 会话 CRUD + chat (SSE)
├── sessions/[id]/messages/…   # prune 消息 + 后代
└── contexts/resolve           # POST → { resolved[], system_message }（前端 chip expand 直接消费 resolved）

data/copilot/
├── index.json                 # session 索引
├── sessions/{id}.jsonl        # 消息 append-only
└── tool-results/{sid}/{tr_xxx}.json  # v2 payloadGuard 落盘的大 tool output
```

### 加新工具流程（v2）

1. 写 `src/lib/copilot/tools/{name}.ts`，export `ToolDescriptor`：name / description / inputSchema / metadata (`isReadOnly` / `isDestructive` / `maxResultSizeChars` / 可选 `requiresConfirm`) / call
2. 在 `tools/registry.ts` 的 `TOOLS` 数组加入 import
3. 在 `tools/metadata-client.ts` 的 `CLIENT_TOOL_METADATA` 镜像一条（测试会强制两边对齐）
4. 若是写工具，在 `tool-call-card.tsx` 的 `VARIANT_BY_TOOL` 映射到 `"write"`（大部分写工具走默认 isDestructive 兜底即可）
5. 写纯函数单测到 `tools/__tests__/{name}.test.ts`，`call` 依赖 mock
6. `requiresConfirm` / `isDestructive` 会自动驱动 UI Confirm gate；`maxResultSizeChars` 自动走 payloadGuard 落盘


### 交互

| 快捷键 | 动作 |
|---|---|
| `⌘K` / `Ctrl+K` | 开/关面板 |
| `⌘Enter` / `Ctrl+Enter` | 发送消息 |
| `Esc` | 关闭面板（不在 input/textarea 焦点内） |
| Inspector 按钮 | 进入 DevTools 风格圈选模式 |
| 在任何地方选中文本 | 底部出现 "+加入 Copilot" 胶囊 |

### Context 抽取约定

UI 节点通过 DOM 属性声明自己是哪种 context：

```tsx
<div
  data-copilot-context="task_result"
  data-copilot-context-id={result.task_id}
  data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id })}
  data-copilot-context-summary={summary}
>
```

`captureFromElement` 会沿着 DOM 父链找到最近挂了这组属性的元素；`collectAncestorChain` 向上递归收集祖先链（用于 `within: A → B → C` 层级展示）。

**elementKey 消歧**：`task_result` / `task_field` 的 elementKey 会带 `${experiment_id}/` 前缀，`queryContextElement` 按 `extra.experiment_id` 过滤匹配 DOM —— 用于 compare 页两张卡片共享同 `task_id` 时的 context 分隔。

## Copilot Glass UI 系统（6 primitive + 3 semantic）

Copilot 打开时，**主内容区**统一切换到"玻璃梯度"视觉语言（关闭时恢复 shadcn 扁平）。设计参考 Apple HIG Materials + Liquid Glass + MD3 elevation —— spec 全文在 `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`，实施计划在 `docs/superpowers/plans/2026-04-28-copilot-glass-system.md`。

### 9 档梯度（6 primitive + 3 semantic）

**Primitive（材质 + 高度 + 基础配色）**：

| 档 | blur | bg opacity (亮) | 典型角色 |
|---|---|---|---|
| **thin** | 16px | 8% | 数据密集行级卡 / 表格单元格 |
| **regular** | 28px | 35% | 页面主外壳 + 内容卡（默认档） |
| **thick** | 40px | 55% | 浮层（Dialog / Select content / 自建 popover） |
| **tinted** | 28px | 35% + accent 22% | primary CTA / segmented selected / active tab |
| **chrome-up** | 28px | 35% + 顶部切边高光 + **向下**投影 | sticky 顶部结构条（compare header 等） |
| **chrome-down** | 28px | 35% + 底部切边高光 + **向上**投影 | sticky 底部结构条（StickySaveBar 等） |

**Semantic（Regular 材质 + 语义 border + 语义 ambient shadow）**：

| 档 | 语义色 (oklch) | 典型角色 |
|---|---|---|
| **success** | emerald-500 `oklch(0.696 0.17 162.48)` | 正向状态卡（Scoring Collapsible 等） |
| **warning** | amber-500 `oklch(0.769 0.188 70.08)` | 提示 / 引导 banner（AgentHintBanner 等） |
| **danger** | red-500 `oklch(0.637 0.237 25.33)` | 错误 / 警告卡（FailedPanel 等） |

Semantic 档的 border 色 class（如 `border-emerald-200/60`）要**保留在 className 上**，作为 copilot 关闭态（shadcn 扁平）下的 border fallback——inline `borderColor` 只在 copilot 开时生效。

组件 `GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted` / `GlassCard` / `GlassCardThin` / `GlassSuccess` / `GlassWarning` / `GlassDanger` 从 `@/components/copilot/shell` 导出。`GlassStickyHeader` / `GlassStickyFooter` 从 `@/components/copilot/sticky-chrome` 导出。`GlassSegmentedItem` 从 `@/components/copilot/glass-segmented` 导出。非 JSX 场景用 `useGlassStyle(variant)` hook 取 `CSSProperties`。

### `--copilot-accent` 而非 `--primary`

项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 基本 = 灰）。`bg-primary/10` 做激活染色出来灰扁不像"亮"。`--copilot-accent: oklch(0.76 0.16 225)` (sky blue, 与 glow 主色呼应) 才是 Tinted 和激活态的正确色。**动 copilot 玻璃 / segmented / primary CTA 染色时都用 copilot-accent，不要 primary。**

### Segmented 选中态

**`<GlassSegmentedItem>` (`src/components/copilot/glass-segmented.tsx`)** 是 segmented control / active tab / nav item 的统一组件。通过 `render` prop 支持 `<button>` / `<Link>` / `<a>` 等任意底层 element：
```tsx
<GlassSegmentedItem active={isActive} className="p-3 text-left" render={<button type="button" onClick={...} />}>
  ...
</GlassSegmentedItem>
```

- copilot 关 → 回退 shadcn 扁平（`border-foreground bg-accent/70` / 普通 border）
- copilot 开 → active 走 Tinted 配方 + accent 发光边 + accent ambient shadow（"发光"而非"染色"）；inactive 走 Thin 配方

`src/lib/segmented.ts` 的 `segmentedItem(active)` helper 只处理 copilot 关闭态的 class（给 `sidebar.tsx` / `copilot/session-list.tsx` 这种"永远不走玻璃"的位置用）。**新 segmented 调用点请一律用 `<GlassSegmentedItem>`**，不要再手写 `useGlassStyle("thin/tinted")` + `data-glass-variant` 三件套。

### 玻璃作用域（**重要**）

**只有页面中间内容区玻璃化**。以下明确**不走玻璃，保持 shadcn 扁平**：

- **Sidebar** —— 左侧主导航。`bg-muted/20` 实底
- **Copilot panel 自身 + 内部**（session-list / chat-view 按钮 / textarea）—— 右侧 copilot 区
- **Toast / Sonner** —— HIG 明确 toast 不玻璃
- **Textarea / Input / Code 内部** —— 阅读密集

**例外**：带语义色的状态卡（Scoring / FailedPanel）和通知 banner（AgentHintBanner）通过 `GlassSuccess` / `GlassDanger` / `GlassWarning` **走玻璃 + 语义 border + 语义 ambient shadow**，而不是扁平 —— 这是 2026-05 统一的规则（原"amber banner 不玻璃"约定已废除）。copilot 关闭时 fallback 到 class 级 `border-amber-200 bg-amber-50/50` 等 shadcn 扁平。

中间内容区触发的**浮层**（Dialog / Select content / compare 的 PromptInfoIcon / custom popover divs）保留 Thick 玻璃，因为它们视觉上是"在中间渲染的浮层"。

### JSX display 兼容

用户自建的 JSX display（`display.mode === "jsx"`）源码里如果写死了 `bg-card`，copilot 打开也是实底。解决方式：`makeHelpers({ open, styles })` 暴露 `helpers.glassStyle(variant)` + `helpers.glassAttr(variant)`，用户源码按 pattern 应用：

```js
const { readField, Badge, glassStyle, glassAttr } = helpers;
React.createElement('div', {
  className: 'border rounded-lg p-3 bg-card',     // copilot 关走实底
  style: glassStyle('regular'),                    // copilot 开走玻璃（关时 undefined）
  'data-glass-variant': glassAttr('regular'),      // 供 a11y 媒介查询选择器用
}, children)
```

已改好参照：`data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`。新建 JSX display 必须带这个 pattern。

### 可访问性

`src/app/globals.css` 尾部 3 条媒介查询降级：
- `prefers-reduced-transparency: reduce` → 全部玻璃降为实底 `var(--card)`
- `prefers-contrast: more` → 实心 + 更强描边
- `prefers-reduced-motion: reduce` → 关 press-squish / hover-lift / scroll-edge 动画

### 轻量 tinted 表面（badge / inline 状态行 / 错误小格 / 软提示）

不占据 9 档玻璃档位，但仍需要在 dark mode 表现正常。**统一走 alpha 配方**，不要写 `bg-{color}-50` / `border-{color}-200`：

```
✅ bg-{color}-500/10  border-{color}-500/30–40  text-{color}-700 dark:text-{color}-300
❌ bg-{color}-50      border-{color}-200        text-{color}-700              # dark 模式刺眼，无 dark: 兜底
```

为什么 alpha 配方在两边都对：`/{X}` 透明度叠在 `bg-card` 之上，亮模式 card 是白 → 看到淡彩；暗模式 card 是深灰 → 看到柔和深彩。文字色 `text-X-700`/`dark:text-X-300` 一对足够保对比度。

**适用范围**：
- Schema 徽章池（`src/app/page.tsx` SCHEMA_COLOR_POOL）
- Results 4 件套里 `r.status !== "success"` 的错误格（`dual-list-results` / `triple-grid-results` / `display-grouped-grid` / `display-table` / `display-jsx`）
- Compare 错误格 / JSON paste 校验提示 / Template 表单粘贴预览
- 凡是「带语义色但不需要整张 GlassDanger/GlassWarning/GlassSuccess 卡」的小区域

**不适用**：
- 状态指示点（如 dashboard `bg-green-500` / `bg-amber-500`）—— 500 tier 是中饱和，亮暗都 OK
- 整张状态卡 / 整段 banner —— 走 `<GlassSuccess>` / `<GlassWarning>` / `<GlassDanger>`，spec 里有
- copilot tool-call-card 的 confirm/denied 框 —— 已经走 alpha 配方

## Claude Code skill 集成

产品定位：**agent 驱动是主推路径**（尤其复杂配置），UI 同时保持一流体验、手工用户不降级。两条路都是一等公民。

### skill 目录

`.claude/skills/{slug}/SKILL.md` 都 git-tracked，Dockerfile runner 阶段 `COPY --from=builder /app/.claude/skills ./.claude/skills`。三个已登记：

| slug | 层级 | 作用 |
|---|---|---|
| `evalyst` | 平台级 | 教 agent 端到端跑一轮评测（REST API 为主，含 curl 示例）。心智模型 + LLM 配置 + 估算 + 建实验 + 跑 + 读 result + annotation；委托两个子 skill 处理资源的详细 JSON shape |
| `evalyst-dataset` | 单资源级 | 产 `data/datasets/{id}.{meta.json,jsonl}` |
| `evalyst-task` | 单资源级 | 产 `data/schemas/{id}.json`（+ 按需 display） |

### 下载入口

`src/app/api/skills/[name]/route.ts` 按 slug 返回 markdown，`Content-Disposition: attachment; filename="SKILL.md"`。曝光位置：

| 位置 | 装哪个 skill | 触发条件 |
|---|---|---|
| Dashboard 空态（`/`） | `evalyst` | `filtered.length === 0 && !schemaFilter` |
| `/settings` 顶栏 | `evalyst` | 常驻 |
| `/settings/datasets/new` 顶部 | `evalyst-dataset` | 常驻 |
| `/settings/templates/new` 顶部 | `evalyst-task` | 常驻 |

### `AgentHintBanner` 组件

`src/components/settings/agent-hint-banner.tsx`。Props：
- `slashCommand: string` —— 对应 skill slug（决定下载 URL + 展示在 `<code>/evalyst</code>` 里的文字）
- `title? / bodyPrefix? / bodySuffix?: ReactNode` —— 可选覆盖默认文案；默认走 `new_res.agent_hint_*` i18n key（面向"创建单个资源"），平台级入口（Dashboard / Settings）传 `app.agent_hint_*` 覆盖成"让 Claude Code 端到端驱动"

新加 skill 时：
1. 写 `.claude/skills/{slug}/SKILL.md`（frontmatter 必须含 `name` + `description`，description 里明确 "Use when" / "NOT for"）
2. 曝光入口挑一个地方 mount `AgentHintBanner`（`slashCommand={slug}`）
3. `.dockerignore` 已经 `!.claude/skills` 过，不用动；Dockerfile 也已经显式 copy

## i18n（中英双语）

自建轻量 provider，不引入 `next-intl` / `i18next`。参照 `next-themes` 模式。

**入口文件**：

| 文件 | 作用 |
|---|---|
| `src/lib/i18n/types.ts` | `Locale = "zh" \| "en"`、`LOCALE_BCP47` 映射表 |
| `src/lib/i18n/zh.ts` / `en.ts` | 扁平 key-value 字典（点号命名空间） |
| `src/lib/i18n/provider.tsx` | `LocaleProvider` + `useT()` / `useLocale()` hooks、`{var}` 插值、localStorage 持久化（key=`locale`） |
| `src/lib/i18n/format.ts` | `formatDate(value, locale, opts)` |
| `src/components/language-toggle.tsx` | 侧栏底部 EN ⇄ ZH 切换按钮 |

**用法**：
```tsx
const t = useT()
t("common.save")
t("settings.datasets.detail.show_all", { n: total })  // 插值
```

未找到 key 时：先 fallback 到 zh，再 fallback 到 key 本身。

**命名空间约定**：`common.*` / `sidebar.*` / `dashboard.*` / `experiment.*` / `compare.*` / `settings.{llm,datasets,templates,displays}.*` / `results.*` / `form.error.*` / `editor.*` / `filters.*` / `transform.*` / `field_picker.*` / `relation.*` / `new_res.*` / `app.*`（平台级 agent 引导）。

**覆盖范围**：
- ✅ **UI chrome**：侧栏、页面标题、section header、表单 label / helper / placeholder、toast、dialog、section 头、按钮、badge
- ✅ **Results 组件**：bubble-auto / dual-list / triple-grid / display-grouped-grid / display-table / display-jsx 的分组头、过滤器、空态、错误边界
- ✅ **Template-builder 编辑器**：field-picker、filters-editor、transform-chain-editor（10 种 op）、key-value / order-list / header-fields editor
- ✅ **日期数字**：`toLocaleString` 全部走 `formatDate(value, locale, opts)`
- ❌ **用户数据不翻译**：数据集 `name/description`、schema `label/description`、`display_dimensions[i].label`、filter `label` / option `label`、seed jsonl 内容、LLM 返回的业务内容 —— 都存什么显示什么
- ❌ **Meta-prompts 不翻译**：`src/lib/meta-prompts/*.ts` 是发给 LLM 的 prompt，不是 UI
- ⚠️ **部分错误消息**：`form-state.ts` 的 `buildSchemaFromForm` 校验错误采用"English / 中文"并置，UI 层不过滤
- ⚠️ **`src/lib/displays.ts` 的 5 个 builtin display name/description**：目前仍是中文（属于应用资产的边界），用户自建的 display 保留用户输入

**HTML `lang` 属性**：SSR 默认 `zh-CN`，客户端 provider 根据 localStorage 更新到 `zh-CN` / `en-US`。`<metadata.title>` 服务端渲染，使用中英并置字符串 `"Evalyst · 批量评测"`。

**增量加 key 流程**：
1. 在 `src/lib/i18n/zh.ts` 新增条目
2. 在 `src/lib/i18n/en.ts` 对应加同 key（`en.ts` 的 `Record<keyof typeof zh, string>` 类型会强制完整性）
3. 组件里 `const t = useT()` + `t("your.key")`
4. 跑 `tsc --noEmit` 验证没缺 key

## 目录结构

```
src/
├── app/
│   ├── page.tsx                            # Dashboard（实验列表 + 按评测任务筛选）
│   ├── experiments/
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx                   # 按 display_id / 推断路由到 4 件套
│   ├── compare/page.tsx                    # 跨实验对比（按 compare_group 分桶 + input_refs 对齐）
│   ├── settings/
│   │   ├── layout.tsx                      # RelationDiagram 作为 tab 导航
│   │   ├── llm/page.tsx                    # 模型列表管理
│   │   ├── datasets/                       # 表单 + meta-prompt 创建
│   │   ├── templates/                      # 表单创建 + 详情 + 编辑
│   │   ├── displays/                       # 表单 + meta-prompt 创建（仅高级）
│   │   └── rubrics/                        # 评分量表 list + 详情 + new + edit
│   └── api/
│       ├── llm-config/route.ts             # GET / PUT
│       ├── datasets/ schemas/ displays/ rubrics/  # CRUD
│       ├── experiments/ + run (body.task_ids 支持单条 retry) / stop / results / annotations
│       ├── estimate/route.ts               # 表单预估任务数
│       └── compare/route.ts
├── components/
│   ├── language-toggle.tsx                 # 侧栏 ZH/EN 切换按钮
│   ├── sidebar.tsx                         # 侧栏导航 + 主题切换 + 语言切换
│   ├── theme-provider.tsx
│   ├── settings/
│   │   ├── relation-diagram.tsx            # 4 方框关系图，方框即 tab
│   │   ├── meta-prompt-pane.tsx / json-paste-pane.tsx
│   │   ├── dataset-form-page.tsx           # 数据集表单（create + edit 共用；CSV/JSONL/JSON 上传）
│   │   ├── display-form-page.tsx           # Display 表单（table / grouped_grid / jsx）
│   │   └── model-card.tsx                  # 单条模型配置的 form + 测试连接 + 内嵌 pricing
│   ├── template-builder/
│   │   ├── form-state.ts                   # TemplateFormState + buildSchemaFromForm / formFromSchema
│   │   ├── field-picker.tsx
│   │   ├── filters-editor.tsx / transform-chain-editor.tsx / header-fields-editor.tsx / key-value-editor.tsx / order-list-editor.tsx
│   │   └── template-form-page.tsx          # 表单主组件（create + edit 共用）
│   ├── filter-renderer.tsx
│   └── results/
│       ├── registry.tsx                    # pickView：显式 display > 推断 > json_default
│       ├── single-list-results.tsx / dual-list-results.tsx / triple-grid-results.tsx / bubble-auto-results.tsx / json-default-results.tsx
│       ├── configurable-display.tsx        # table / grouped_grid / jsx 用户 display
│       ├── display-jsx.tsx                 # babel-standalone 编译 + ErrorBoundary
│       ├── dimension-helpers.ts / output-structure.ts / view-helpers.tsx
└── lib/
    ├── fs-utils.ts                         # writeAtomic / ensureDir
    ├── seed.ts                             # ensureSeeds()
    ├── seeds/                              # 示例源文件
    │   ├── qa_pairs.{meta.json,jsonl}
    │   ├── qa_answer_v1.schema.json
    │   └── qa_accuracy.rubric.json
    ├── i18n/                               # 中英双语
    │   ├── types.ts / zh.ts / en.ts / provider.tsx / format.ts
    ├── llm-config.ts                       # LlmConfig / ModelConfig / findPricing / pickModel
    ├── llm-client.ts                       # buildApiRequest / executeWithRetry / callLlm
    ├── datasets.ts                         # 走文件系统（含 updateCustomDataset）
    ├── displays.ts                         # 5 件套 builtin + 用户 JSON
    ├── display-inference.ts                # inferDisplayBuiltinId
    ├── mock-data.ts
    ├── store.ts                            # 实验 CRUD + 迁移层（export migrate* for tests）
    ├── batch-runner.ts                     # startBatch(cfg, resume, concurrency, taskIds?)
    ├── result-parser.ts
    ├── format.ts                           # formatCost / formatCostMap / formatTokens
    ├── results-aggregate.ts                # aggregateResults (per-currency)
    ├── rubric-store.ts                     # Rubric CRUD
    ├── annotation-store.ts                 # latestAnnotations / aggregateAnnotations
    ├── __tests__/*.test.ts                 # 单测（vitest）
    ├── meta-prompts/{dataset,template,display}.ts
    └── schema/
        ├── types.ts                        # TaskSchema / Display / Rubric / Annotation / FilterDef
        ├── index.ts                        # listSchemas = listUserSchemas + ensureSeeds
        ├── user-schema-store.ts
        ├── transform.ts / validate.ts / engine.ts / common.ts
        └── __tests__/*.test.ts             # transform/validate 单测

data/
├── llm-config.json                          # 模型列表
├── experiments/{id}.json
├── results/{id}/{results.jsonl, progress.json, annotations.jsonl}
├── datasets/{id}.{jsonl, meta.json}
├── schemas/{id}.json
├── displays/{id}.json
└── rubrics/{id}.json
```

## 运行

```bash
npm run dev          # http://localhost:3000（被占用时自动切到 3002 等）
npm test             # 跑所有单测（vitest，221 case ~180ms）
npm run test:watch   # watch 模式
npm run test:e2e     # E2E smoke（playwright；首次需 `npx playwright install chromium`）
```

或 Docker：
```bash
docker compose up -d
```

## 注意事项

- 加新评测任务：`/settings/templates/new` 表单；复杂场景用「JSON 导入」粘贴 meta-prompt 产物
- 加新数据集：`/settings/datasets/new` 表单可 JSONL / JSON 数组 / CSV 上传；或 JSON 粘贴 tab
- 加新评分量表：`/settings/rubrics/new` 结构化表单（criteria 编辑器：key/label/type/description/required，支持排序）
- 加新内置示例：写 `src/lib/seeds/xxx.{schema,rubric}.json` 或 `.jsonl`，在 `src/lib/seed.ts` 的种子列表里加 id
- 删除 seeded 资源：下次访问自动恢复。想永久删除请从 seed 列表移除
- 编辑 seeded 资源（数据集 / 评测任务 / 量表）：都可以编辑，seed 只在文件缺失时恢复，不会覆盖修改
- 自定义 JSX display：浏览器端 `@babel/standalone` 编译，函数 Props `{ result, schema, helpers }`；不支持 import/require/fetch
- 结果 JSONL 去重：同 `task_id` 取最后一条（重试覆盖旧失败）
- 单条 retry：详情页失败 panel 上的 ↻ 按钮；POST `/api/experiments/{id}/run` body.task_ids 精确过滤
- 原子文件写：统一走 `src/lib/fs-utils.ts` 的 `writeAtomic`
- 新增 UI 文案：必在 `src/lib/i18n/zh.ts` + `en.ts` 成对加 key，组件用 `useT()` 消费；`en.ts` 的类型约束会强制完整性
- 新增纯函数：配套写 `src/**/__tests__/*.test.ts`，`npm test` 本地验证

@AGENTS.md
