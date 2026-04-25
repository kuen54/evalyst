# batch-eval

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

## 技术栈

- Next.js 16.2.4 (App Router, Turbopack) + React 19 + TypeScript
- shadcn/ui v4 + Tailwind CSS v4
- next-themes（class 策略）
- 自建轻量 i18n（`src/lib/i18n/`，zh / en，localStorage 持久化）
- `@babel/standalone` 浏览器端 JSX 编译（用户自定义展示模板）
- `papaparse` CSV 解析（数据集表单上传）
- 测试：`vitest`（纯函数单测，110 case）+ `playwright`（E2E smoke，9 case）
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

110 个 test case，~180ms 跑完。**只测纯函数**——API route / UI 组件不测。

**惰性路径**：`llm-config.ts` / `annotation-store.ts` 的 `configDir()` / `resultsDir()` 是惰性函数（不在模块加载时 freeze `process.cwd()`），测试里 chdir 到 tmp 目录能生效。生产 cwd 固定，无副作用。

## E2E smoke（Playwright）

`e2e/smoke.spec.ts` → `npm run test:e2e`（首次需 `npx playwright install chromium`）。覆盖：

- 每条关键路由（`/` / `/experiments/new` / `/compare` / `/settings/llm,datasets,templates,displays,rubrics`）navigate → HTTP < 400 → 侧栏 chrome 渲染 → 页面自带 anchor 文本渲染 → 运行时无 `pageerror`
- `/api/skills/batch-eval-dataset` 返回 200 + markdown 正文（防止 Docker 部署漏拷 `.claude/skills/` 这类回归）

Playwright 配置在 `playwright.config.ts`：`webServer` 跑 `npm run dev`（本地 `reuseExistingServer: true`），默认只用 chromium；失败时产出 `test-results/` 和 `playwright-report/`（已加 gitignore）。

CI（`.github/workflows/ci.yml`）两个 job：
- `verify` — `tsc --noEmit → lint（continue-on-error）→ test → build`
- `e2e`（依赖 verify 通过）— `npx playwright install --with-deps chromium → npm run test:e2e`，失败上传 HTML report 作为 artifact

## Claude Code skill 集成

产品定位：**agent 驱动是主推路径**（尤其复杂配置），UI 同时保持一流体验、手工用户不降级。两条路都是一等公民。

### skill 目录

`.claude/skills/{slug}/SKILL.md` 都 git-tracked，Dockerfile runner 阶段 `COPY --from=builder /app/.claude/skills ./.claude/skills`。三个已登记：

| slug | 层级 | 作用 |
|---|---|---|
| `batch-eval` | 平台级 | 教 agent 端到端跑一轮评测（REST API 为主，含 curl 示例）。心智模型 + LLM 配置 + 估算 + 建实验 + 跑 + 读 result + annotation；委托两个子 skill 处理资源的详细 JSON shape |
| `batch-eval-dataset` | 单资源级 | 产 `data/datasets/{id}.{meta.json,jsonl}` |
| `batch-eval-task` | 单资源级 | 产 `data/schemas/{id}.json`（+ 按需 display） |

### 下载入口

`src/app/api/skills/[name]/route.ts` 按 slug 返回 markdown，`Content-Disposition: attachment; filename="SKILL.md"`。曝光位置：

| 位置 | 装哪个 skill | 触发条件 |
|---|---|---|
| Dashboard 空态（`/`） | `batch-eval` | `filtered.length === 0 && !schemaFilter` |
| `/settings` 顶栏 | `batch-eval` | 常驻 |
| `/settings/datasets/new` 顶部 | `batch-eval-dataset` | 常驻 |
| `/settings/templates/new` 顶部 | `batch-eval-task` | 常驻 |

### `AgentHintBanner` 组件

`src/components/settings/agent-hint-banner.tsx`。Props：
- `slashCommand: string` —— 对应 skill slug（决定下载 URL + 展示在 `<code>/batch-eval</code>` 里的文字）
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

**HTML `lang` 属性**：SSR 默认 `zh-CN`，客户端 provider 根据 localStorage 更新到 `zh-CN` / `en-US`。`<metadata.title>` 服务端渲染，使用中英并置字符串 `"Batch Eval · 批量评测"`。

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
npm test             # 跑所有单测（vitest，110 case ~180ms）
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
