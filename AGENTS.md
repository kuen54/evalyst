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
- **Claude Code 助手 skill**：`.claude/skills/{slug}/SKILL.md`（git-tracked，Dockerfile runner 阶段会 copy 进镜像）。三个已登记：
  - `evalyst` —— 平台级，教 agent 端到端跑一轮（REST API 为主，带 curl 示例）；推荐给「agent 独立驱动」场景
  - `evalyst-dataset` / `evalyst-task` —— 单资源级，产数据集 / TaskSchema JSON

  `/api/skills/[name]` route 按 slug 返回 markdown；`AgentHintBanner` 组件 render 出「Download SKILL.md」按钮给用户一键装到自己的 Claude Code。曝光位置：
  - Dashboard 空态 + `/settings` 顶栏 → 装 `evalyst` 平台级 skill
  - `/settings/datasets/new` / `/settings/templates/new` 顶部 → 装对应的单资源 skill

  `AgentHintBanner` 默认文案面向「创建单个资源」场景；平台级入口用 `title` / `bodyPrefix` / `bodySuffix` props 覆盖成 `app.agent_hint_*` 文案。新加 skill 时 `.dockerignore` 已经 `!.claude/skills` 过，不用动配置。

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
- 命名空间：`common / sidebar / dashboard / experiment / compare / settings.{llm,datasets,templates,displays,rubrics} / results / form.error / editor / filters / transform / field_picker / relation / new_res / app`（`app.*` 是平台级 agent 引导文案）

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

## Copilot & Glass UI 约定

完整 spec 在 `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`；v2 架构（工具 + 上下文）spec 在 `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`。快速总结如下。

### 做 copilot UI 相关改动前先读

1. `CLAUDE.md` 的 Copilot + Glass 章节
2. Spec §12「首轮验证后的调整」—— 记录了三处反直觉的强约束
3. 项目记忆 `feedback_copilot_glass_scope.md`

### 加 / 改 copilot 工具

- 每工具一文件 `src/lib/copilot/tools/{name}.ts`，`export const xxxTool: ToolDescriptor<Input, Output>`
- 必填 metadata：`isReadOnly` / `isDestructive` / `maxResultSizeChars`；可选 `requiresConfirm`（覆盖 isDestructive 默认）
- `isDestructive: true` 自动走 preToolCall confirmGateHook → UI 弹 Confirm 卡
- 超 `maxResultSizeChars` 的 output 自动被 payloadGuardHook 落盘到 `data/copilot/tool-results/{sid}/tr_xxx.json`，transcript 留 preview + ref
- Registry 登记两处：`tools/registry.ts` (TOOLS) + `tools/metadata-client.ts` (CLIENT_TOOL_METADATA)，`metadata-client-sync.test.ts` 强制对齐
- 读工具（`isReadOnly: true`）会参与 `microCompact` 压缩；写工具不会（保留完整执行痕迹）
- UI 视觉变体走 `tool-call-card.tsx` 的 `VARIANT_BY_TOOL`：context / resource / retrieval / write / default。写工具默认命中 write（通过 metadata.isDestructive 兜底）

### 玻璃档位选择（9 档：6 primitive + 3 semantic）

| 角色 | 档 |
|---|---|
| 页面主外壳 + 内容卡 | **GlassRegular** / **GlassCard** |
| 数据密集行级卡 / 表格 cell | **GlassThin** / **GlassCardThin** |
| Dialog / Select content / 自建浮层 | **GlassThick** |
| Primary CTA / active tab | Button `variant="tinted"` 或手工 `useGlassStyle("tinted")` |
| Sticky 顶部结构条 | **`<GlassStickyHeader>`**（chrome-up 档 + 向下投影） |
| Sticky 底部结构条 | **`<GlassStickyFooter>`**（chrome-down 档 + 向上投影） |
| Segmented item / nav selected | **`<GlassSegmentedItem active render={...}>`** (thin ↔ tinted 自动切) |
| 正向状态卡（评分 / ok） | **GlassSuccess**（emerald border + ambient） |
| 提示 / 引导 banner | **GlassWarning**（amber border + ambient） |
| 错误 / 警告卡（failed / err） | **GlassDanger**（red border + ambient） |
| ❌ Sidebar / Copilot panel / panel 内部 | **不玻璃**，走 shadcn 扁平 |
| ❌ Toast / Sonner | **不玻璃**，HIG 明确 toast 不玻璃 |

**同档不 DOM 嵌套**（Regular 套 Regular 浑浊）。Dashboard 的多张 Regular 卡并排不算嵌套 —— 它们是网格同级。

**Semantic 档的 border class 要保留**：`<GlassSuccess className="border-emerald-200/60">` / `<GlassDanger className="border-red-200/60">` / `<GlassWarning className="border-amber-200 bg-amber-50/50">`。copilot 开态 inline `borderColor` 接管；关态 class 级 border 色是 shadcn 扁平 fallback。

### 色 token

- **激活/发光色用 `var(--copilot-accent)`**（sky blue），**不要用 `var(--primary)`**。项目 primary 是暗褐色，/10 染色灰扁
- 玻璃 border 用 `color-mix(in oklab, var(--border) 50%, transparent)`，不用实色（破坏玻璃感）
- Semantic 档 border / shadow 用 tailwind-500 色的 oklch 值（emerald `oklch(0.696 0.17 162.48)` / amber `oklch(0.769 0.188 70.08)` / red `oklch(0.637 0.237 25.33)`）

### Segmented 选中态

**新调用点一律用 `<GlassSegmentedItem active render={...}>`** —— 不要再手写 `useGlassStyle("thin/tinted")` + `data-glass-variant` + `segmentedItem(active, copilotOpen)` 三件套。

`src/lib/segmented.ts` 的 `segmentedItem(active)` helper 只处理 copilot 关闭态的 class，给 `sidebar.tsx` / `copilot/session-list.tsx` 这种"永远不走玻璃"的位置用（两处硬编不在 copilot 主内容区）。

### 主 CTA 约定（**一页一个 tinted 名额**）

页面上承担**主动作**（"开始 / 保存 / 创建 / 运行"）的 CTA 用 `<Button variant="tinted">`，让用户一眼看到"这里点"。**严格规则：一个页面同时只能有一个 tinted 主 CTA**，不然"主"的信号稀释。具体裁定：

**占名额的位置**：
- `<Button variant="tinted">`
- `<GlassSegmentedItem>` 里当前 active 的那一项（玻璃 active tinted，属于"tab 级视觉主角"）

**不占名额的位置**：
- Sidebar 导航 active 项 —— `segmentedItem(active)` 硬编 shadcn 扁平，永不 tinted
- Copilot panel 内部的任何高亮 —— 永远扁平

**裁定表（现状 2026-05-06 PR 3 后）**：

| 页面 | 名额占用 | 主 CTA |
|---|---|---|
| `/` dashboard | 无 | 顶栏"新建实验" tinted；空态同文案 **outline**（避免两个 tinted） |
| `/experiments/new` | 无 | "开始实验" tinted；"保存为草稿" outline |
| `/experiments/[id]` | 无 | Run / Resume 互斥显示 tinted；Pause / Retry outline |
| `/compare` | 无 | 无主 CTA |
| `/settings/**`（layout 带 RelationDiagram） | ✅ RelationDiagram 当前 tab tinted | 顶栏"新建"保持 `default`；StickySaveBar 保存保持 `default`；详情页"编辑"保持 `default` —— 全部**不加 tinted** |

**互斥显示的按钮可共享名额**（如 Run / Resume / Pause / Retry 按 experiment.status 互斥渲染，同时只出现一个，共用一个 tinted 名额不算违反）。

**新加按钮的决策流**：
1. 这是"主动作"吗？否 → `default` / `outline` / `ghost`
2. 是主动作。看所在页的名额状态（先查 RelationDiagram tab / 既有 tinted）
   - 已有 → **保持 default**（让名额归首个占位者）
   - 没有 → `tinted`

### JSX display 兼容 copilot 态

用户自建 JSX display 写外层主卡时必须用 helpers API：
```js
const { glassStyle, glassAttr } = helpers;
React.createElement('div', {
  className: 'bg-card border rounded-lg p-3',
  style: glassStyle('regular'),
  'data-glass-variant': glassAttr('regular'),
}, children);
```
`glassStyle()` copilot 关返 undefined（走 className 实底），开时返 inline style 覆盖。

参照 `data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`。

### 可访问性降级（必须保持工作）

三条媒介查询在 `src/app/globals.css` 尾部：
- `prefers-reduced-transparency: reduce` → 全实底
- `prefers-contrast: more` → 实心 + 更强描边
- `prefers-reduced-motion: reduce` → 关所有动画

玻璃组件必须挂 `data-glass-variant` 属性才能被这三条规则选中降级。`makeGlass` 工厂自动挂。手写 inline glass style 时记得带 `data-glass-variant={copilotOpen ? "regular" : undefined}`。

## 开发流程（本仓库）

### 分支命名

- `feat/<slug>` — 新特性
- `fix/<slug>` — bug 修复
- `refactor/<slug>` — 不改行为的重构
- `tune/<slug>` — 只改参数（时长、阈值、色值等），不改机制
- `docs/<slug>` — 纯文档
- `archive/<slug>` — 归档已放弃的实验性方案（代码保留但不合 main）

slug 用 kebab-case，**语义化**（`theme-cascade-v2`、`copilot-v053-opening-experience`），不写"bugfix-1"这种。

### PR 流程

所有**非 trivial** 改动（影响 >3 文件 或 改变行为）走 feature branch + PR：

1. `git checkout -b <type>/<slug>`
2. 本地验证：`npx tsc --noEmit && npm test && npm run build`（UI 相关加 `npm run test:e2e`）
3. `git push -u origin <type>/<slug>`
4. `gh pr create --title "..." --body "..."`
5. PR description 必含 4 段：**改了什么 / 为什么 / 怎么验证 / 向后兼容风险**
6. merge 策略：**merge commit**（`gh pr merge <n> --merge` 或网页"Create a merge commit"），不要 squash —— 保留 branch commits 便于 `git log --graph` 追溯，也让 tag-on-merge-commit 语义稳定
7. merge 后本地清理：`git branch -D <branch>`

**可直接 push main 的例外**：typo 修正、comment 清理、CHANGELOG 条目微调——commit 信息说清即可。**任何行为改动、哪怕一行**，都走 PR。

### Commit message 规范

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: ...
```

`<type>`: `feat` / `fix` / `refactor` / `tune` / `docs` / `chore` / `test` / `perf` / `style` / `build` / `ci`

- `feat`：新能力（新 API、新 UI、新交互路径）
- `fix`：修复 bug（现状不符合预期行为）
- `refactor`：重组代码但**不改外部行为**
- `tune`：只动参数（动画时长、offset、stagger 窗口、阈值等），不改机制
- `docs`：只改 md / 注释 / JSDoc
- `chore`：lockfile / 配置 / 脚本之类非代码变更

`<scope>`: 受影响的主模块（`copilot` / `theme` / `ui` / `settings` / `compare` / `i18n` / `schema` 等），没有就省。

`<subject>`: 命令语气、小写开头、<70 字符。

body 解释"为什么"而不是"做了什么"（diff 自己说"做了什么"）。

**AI 助手额外约定**：AI assistant 身份工作时，非 trivial 改动必须走 branch + PR，不直接 push main。

### Tag + 版本号

**版本号是松散里程碑，不是 semver**。本项目无外部 consumer，tag 的作用是"可跳回去的稳定点"和 release notes 锚点。

格式 `vX.Y.Z`：

- **X (major)**：保留给重大架构变动（目前 `0.*` 表示仍在快速演化）
- **Y (minor)**：整块新能力或新子系统（PR-3 tool calling 合进来时跳 0.4 → 0.5）
- **Z (patch)**：Y 范围内的增量特性、显著调优、hotfix

**什么时候打 tag**（收敛原则）：

- ✅ 特性**稳定且短期不再改**：merge 进 main 之后观察一两天，实际使用过几轮没发现需要调的，再 tag
- ✅ **真正的 hotfix**：前一个 tag 指向 broken state，fix 合进来后打新 tag 标明"从这个版本起才真能用"
- ❌ **不要**每次 PR 都 tag
- ❌ **不要**在"我以为它做完了"的瞬间 tag（很可能下个小时就发现要 tweak）
- ❌ 同一特性 48h 内打 3 个 tag 是信号错了——polish 应该属于 `[Unreleased]`，攒一攒再一起 tag

**Tag 放在哪**：**总是放在 merge commit 上**，不放在 feature branch 的 commit 上（因为 squash/rebase 可能让那个 commit 从 main 消失）：

```bash
git checkout main && git pull
git tag -a v0.X.Y -m "v0.X.Y · <one-line summary>" <merge-commit-sha>
git push origin v0.X.Y
```

**Broken tag 怎么办**：如果 tag 指向的 state 实测不工作，删除它（`git tag -d v0.X.Y && git push origin :refs/tags/v0.X.Y`），并在 CHANGELOG 对应条目加 `> Note: git tag <...> 已删除，首个可用版本是 <...>` 标注。条目**保留**作为设计/实现的历史记录。不重写 CHANGELOG 历史。

### CHANGELOG 规范

`CHANGELOG.md` 走 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格。

**条目格式**：

```md
## [X.Y.Z] — YYYY-MM-DD · <one-line summary>

<背景段：一两句话说为什么要做 / 上下文>

### 体验 / 架构 / Tuning / 测试 / 归档（按需选用 header）

- ...

- Spec: docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
- Plan: docs/superpowers/plans/YYYY-MM-DD-<topic>.md
```

**工作流**：

1. 开发期间往 `## [Unreleased]` 段写条目草稿
2. 打 tag 时把 `[Unreleased]` → `[X.Y.Z] — <date> · ...`，顶部补新的 `[Unreleased]` 占位
3. 同一特性的多轮 tune 应该**合并到一个条目里**（用 `### Tuning` 子段记录）而不是拆成多个版本

**Broken tag 标注**：如上 §Tag，条目开头加 `> Note (YYYY-MM-DD)：...`。

**不要**：
- 把 CHANGELOG 当 commit log（那是 `git log` 的工作）
- 为每个 PR 写一条 CHANGELOG 条目——除非它对应一个 tag
- 在 `[Unreleased]` 堆无数 bullet 不消化——及时整合成条目再 tag

### 回顾 / 审计节奏

合完一个大 PR 之后、tag 之前：

1. **实测一轮**（UI 走快乐路径 + 一两个 edge case）
2. **看 console**：dev server 无 warning / error
3. **读自己的 diff**：找 dead code、stale 注释、typo、doc drift
4. 发现问题就开新 PR（`fix/` 或 `docs/`），别攒

真要"审计"（比如发现某个 feature 可能引入回归），系统跑一遍：`tsc --noEmit && npm test && npm run build` + Playwright 实测 + 读关键文件。这次用 merge-audit-style 跑了一轮，捡到 reduced-motion 不一致 + 孤儿 CSS var + stale 注释（见 v0.5.7 CHANGELOG），总共 15 分钟值得。
