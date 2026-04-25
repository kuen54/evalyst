# Agent 约定

## Next.js 版本

本项目使用 Next.js 16.2.4，与训练数据中的版本存在 breaking changes。修改代码前先读 `node_modules/next/dist/docs/` 中的对应文档，注意废弃警告。

## 代码风格

- 函数式组件 + hooks，不用 class 组件（唯一例外：`display-jsx.tsx` 的 `JsxBoundary` ErrorBoundary）
- shadcn/ui v4 组件在 `src/components/ui/`，按需引用
- Tailwind CSS v4 语法（oklch 颜色、@custom-variant）
- 暗色模式用 `next-themes` class 策略，globals.css 中已有 `.dark` 变量块
- **UI 双语**：SSR 默认 `lang="zh-CN"`，客户端按 localStorage 切换到 `zh-CN` / `en-US`。所有新加的 UI 文案必须走 `useT()`，不要硬编码中文字符串

## 文件存储

没有数据库。

- `data/llm-config.json` — 模型列表配置（`{ models: ModelConfig[], active_model_id? }`）
- `data/experiments/{id}.json` — 实验配置
- `data/results/{id}/{results.jsonl, progress.json}` — 结果和断点
- `data/datasets/{id}.{jsonl, meta.json}` — 数据集
- `data/schemas/{id}.json` — 评测任务（代码里仍叫 TaskSchema）
- `data/displays/{id}.json` — 用户自建的展示模板（JSX / table / grouped_grid）

**所有写入统一走 `src/lib/fs-utils.ts` 的 `writeAtomic`**（tmp + rename）。不要直接 `fs.writeFileSync` 顶替。

## LLM 接口

`src/lib/llm-client.ts` 的 `callLlm` 按 `api_config.api_format` 分支到 OpenAI 或 Anthropic。两者共享 `executeWithRetry` + `buildApiRequest`。

敏感字段（base_url / api_key / model）**不内置默认值**——用户必须显式配置。`/settings/llm` 管理模型列表，每张卡独立测试连接 + 设为默认 + 定价。

## 评测任务（Schema）

- 术语：UI 叫「评测任务」，代码类型叫 `TaskSchema`（不要乱改名）
- Prompt 模板用 `{{variable}}` 占位，条件块 `{{#cond}}...{{/cond}}`
- 渲染在 `src/lib/schema/engine.ts` 的 `buildMessages` / `renderTemplate`

## 加新资源的流程

- **LLM 模型**：`/settings/llm` 表单（模型列表，点「+ 添加模型」新增一张卡）
- **数据集**：`/settings/datasets/new`：
  - Form tab（`DatasetFormPage`）—— 支持 JSONL / JSON 数组 / CSV 上传
  - JSON tab —— meta-prompt + JSON 粘贴
  - 编辑走 `/settings/datasets/[id]/edit`（ID 不可改，seed 可编辑，修改不被覆盖）
- **评测任务**：`/settings/templates/new` 走表单（`TemplateFormPage` 主组件）；表单顶部「JSON 导入」兜底
- **展示模板**：95% 不需要手建，`display_dimensions` 会自动推断；仅 JSX / table / grouped_grid 这种特殊场景进 `/settings/displays/new`（有 Form tab，三选一模式 + JSON tab 兜底）
- **评分量表**：`/settings/rubrics/new` 结构化表单（CriteriaEditor 子组件：key / label / type / description / required，支持上下排序 + 增删）；list → 详情（criteria 表 + 关联实验列表 + 编辑/删除）→ edit
- **Claude Code 助手 skill**：`.claude/skills/{slug}/SKILL.md`（git-tracked，Dockerfile runner 阶段会 copy 进镜像）。`/api/skills/[name]` route 按 slug 返回 markdown；`AgentHintBanner` 组件 render 出「Download SKILL.md」按钮给用户一键装到自己的 Claude Code。新加 skill 时在 `.dockerignore` 已经 `!.claude/skills` 过，不用动配置

## 评分资源的交互约定

- Rubric 是**可选资源**：实验可不绑、不打分。绑了的实验详情页顶部出现 Scoring card
- Annotation 存 `data/results/{exp_id}/annotations.jsonl`，append-only；重复打分产生多行；聚合用 `latestAnnotations()` 去重取最新
- Rubric 删除时**不清 annotation**（按 rubric 又重建同 id 即可恢复聚合展示）；实验删除时 `data/results/{id}/` 整目录清掉，annotation 一起没

## 失败 task 单条 retry

- 详情页 `FailedPanel` 列 failed task，每条 ↻ 按钮 POST `/api/experiments/{id}/run` with `{ task_ids: [task_id] }`
- `batch-runner.startBatch(cfg, resume, concurrency, taskIds?)` 第 4 参数精准过滤 pendingTasks
- 传 `taskIds` 时自动走 `resume=true` 累加历史 stats

## UI 原则：能不手写 JSON 就不手写

过去设置里多处直接暴露 JSON 输入，现已全部换成结构化控件：
- 字段路径 → `FieldPicker` 下拉分组
- `variable.transform` → `TransformChainEditor`（10 种 op，每种独立参数行）
- `inputs[i].filters` → `FiltersEditor`（5 种 kind 结构化）
- `value_labels` / mapping → `KeyValueEditor`
- `order` → `OrderListEditor`
- `header_fields` → `HeaderFieldsEditor`
- 数据集 records → 文件上传（CSV/JSONL/JSON）+ 智能字段推断
- 展示模板 → 模式选择器（table / grouped_grid / jsx）+ 列编辑器

**加新字段时优先考虑结构化编辑器**。复用 UI：`shadcn/ui` 原语 + `Select` / `Checkbox` / `Input` / `Textarea` 为主；多行重排参考 `OrderListEditor` 的上下箭头模式；key-value 字典复用 `KeyValueEditor`；字段路径必走 `FieldPicker`。

JSON 粘贴入口仍保留给 "AI agent 整份产出" 这一种场景（new 页的第二个 tab + 表单顶部「JSON 导入」按钮）。新加资源类型时遵循这个 pattern。

## Display 推断

`src/lib/display-inference.ts` 的 `inferDisplayBuiltinId(schema)`：

1. output 含 `tuple:number[]` 字段 + inputs 有图片字段 → `builtin_bubble_overlay`
2. `display_dimensions.length` → `single_list` (0/1) / `dual_list` (2) / `triple_grid` (3) / `single_list` (≥4)
3. 兜底 → `builtin_json_default`

`src/components/results/registry.tsx` 的 `pickView(schema, display)`：显式 display > 推断 > json_default。

## Seed 机制

`src/lib/seed.ts` 的 `ensureSeeds()` 每次 list 调用都跑（**不缓存**，确保用户删了能自动恢复）。成本是几次 `existsSync`。

加新示例：写 `src/lib/seeds/xxx.{jsonl, meta.json, schema.json}`，在 `src/lib/seed.ts` 的种子列表里加 ID。

## Meta-prompt 维护

`src/lib/meta-prompts/{dataset,template,display}.ts` 的字符串常量。改的时候维护里面 JSON 示例结构和实际 `TaskSchema` / `DatasetDef` / `Display` 类型定义一致，否则用户 agent 产出的 JSON 会校验失败。

## 表单组件（template-form-page）

`/settings/templates/new` 和 `/settings/templates/[id]/edit` 共用 `TemplateFormPage`（`mode: "create" | "edit"`）。加字段时两种模式都要照顾：

- `emptyFormState()` 给 create 模式的默认值
- `formFromSchema(schema)` 给 edit / 复制模式的反序列化
- `buildSchemaFromForm(form)` → `TaskSchema`（含校验错误）

## 数据集表单（dataset-form-page）

`/settings/datasets/new` 和 `/settings/datasets/[id]/edit` 共用 `DatasetFormPage`（`mode: "create" | "edit"`，默认 `create`）。Edit 模式下 ID 禁用、PATCH 提交到 `/api/datasets/{id}`。

- `emptyState()` create 默认值
- `stateFromDataset(def, records)` 反序列化已有数据集
- CSV 导入走 `papaparse`，字段自动推断（`inferFieldsFromCsv`）+ 值类型 coerce（`coerceCsvRow`：数字→number、"true"/"false"→boolean、空→null）
- Seeded 数据集（source=builtin）顶部 banner 提示

## 气泡渲染

任何 `display_id` 指向 `builtin_bubble_overlay`（或推断命中）的评测任务共用 `BubbleAutoResults` 渲染。按「有/无 element_position」分桶：无坐标的 bubble 作为固定气泡放在右下角，有坐标的叠加到图片对应位置。不依赖 schema id。

## i18n 约定

- 所有新加的 UI 可见文案 **必须** 成对在 `src/lib/i18n/zh.ts` + `en.ts` 加 key（`en.ts` 用 `Record<keyof typeof zh, string>` 强制类型）
- 组件内 `const t = useT()`；插值用 `t("k", { var })`
- 非组件函数（工具、class ErrorBoundary）没法调 hook，两种办法：
  1. 让调用方组件 `useT()` 后把需要的字符串作为参数传进去（见 `display-jsx.tsx` 的 `JsxBoundary.errorLabel` / `compileUserJsx(source, compilerLoadingText, ...)`）
  2. 极少见场景可写"English / 中文"并置字符串（见 `form-state.ts` / `llm-client.ts`）
- 日期：调 `formatDate(value, locale, opts)`（`src/lib/i18n/format.ts`）
- **不需要翻译**：
  - 用户数据：数据集 `name/description`、schema `label/description/filter.label`、display `name/description`、dimension `label`、value_labels、seed jsonl 内容
  - Meta-prompts（`src/lib/meta-prompts/*.ts`）：发给 LLM 的 prompt，不是 UI
  - 业务内容：LLM 返回的输出内容本身永远不翻译
- 命名空间：`common / sidebar / dashboard / experiment / compare / settings.{llm,datasets,templates,displays,rubrics} / results / form.error / editor / filters / transform / field_picker / relation / new_res`

## 测试约定

- **只测纯函数**，不测 API route / UI 组件（第一轮建立地基）
- 测文件放 `src/**/__tests__/*.test.ts`，与被测模块就近
- vitest 配置在 `vitest.config.ts`（path alias `@` 复用 tsconfig）
- `npm test` 本地跑；`npm run test:watch` 开发时
- **E2E smoke**：`e2e/*.spec.ts`，Playwright chromium，覆盖每条路由 no-crash + 侧栏渲染 + `/api/skills` 下载。`npm run test:e2e` 本地跑（首次需 `npx playwright install chromium`）
- CI 两步：`verify` job（`tsc → lint (continue-on-error) → test → build`）+ `e2e` job（跑 Playwright，失败时上传 HTML report）
- 涉及 fs 的模块（`llm-config` / `annotation-store`）要**惰性解析** `process.cwd()`，不要在模块顶层 `const PATH = path.join(cwd, ...)`——否则测试里 chdir 无效。写成函数：
  ```ts
  function configDir() { return path.join(process.cwd(), 'data') }
  ```
- 加新纯函数时配套加 test 文件。迁移层改动（store / llm-config / results-aggregate / annotation-aggregate）必须更新 `__tests__/*.migrate.test.ts`
