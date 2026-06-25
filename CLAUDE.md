# evalyst

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

## 找东西？快速跳转

| 我想找... | 直接答案 |
|---|---|
| LLM 调用入口（`callLlm` / OpenAI + Anthropic 适配 / 3 次 retry / 120s 超时） | `src/lib/llm-client.ts` |
| 批量评测主循环（pool / progress / abort / resume） | `src/lib/batch-runner.ts` + 文件锁 `src/lib/batch-runner-lock.ts` |
| 模型配置（baseURL / apiKey / pricing） | `src/lib/llm-config.ts` + UI `/settings/llm` |
| 加新评测任务（TaskSchema） | UI `/settings/templates/new`（表单）；类型 `src/lib/schema/types.ts`；表单组件 `src/components/template-builder/template-form-page.tsx`；agent 路径走 `evalyst-task` skill |
| 加新数据集 | UI `/settings/datasets/new`（CSV/JSONL/JSON 上传）；CRUD `src/lib/datasets.ts`；agent 路径走 `evalyst-dataset` skill |
| 文件存储 + 原子写 + concurrent 锁 | `data/{experiments,results,datasets,schemas,displays,rubrics}/*` + `data/llm-config.json`；写都走 `src/lib/fs-utils.ts` `writeAtomic`（tmp + rename）；批处理并发避冲突走 `src/lib/batch-runner-lock.ts`（per-experiment 文件锁，Phase E #9） |
| Copilot 子系统 | `src/copilot/{lib,components}/` 子树 + api routes 在 `src/app/api/copilot/`；详细见 [`docs/copilot.md`](docs/copilot.md) |
| Copilot 工具（**9 个**） | `src/copilot/lib/tools/` 一文件一工具（`*.metadata.ts` client-safe + `*.server.ts` server-only）；注册表 `client-registry.ts` / `server-registry.ts`；当前：`list-experiments` / `read-experiment-results` / `restart-experiment` / `read-page` / `read-context` / `read-resource` / `read-tool-result` / `read-dataset-records` / `edit-template` |
| Glass UI 7 档 | `docs/conventions/glass-ui.md` `## 7 档梯度` 段；4 primitive (`thin` / `regular` / `thick` / `tinted`) + 3 semantic (`success` / `warning` / `danger`)；典型：`thin`=数据密集行级卡 / `regular`=页面主外壳默认 / `thick`=浮层；每档 fill 走 **mode-aware `light-dark()`**（亮模式 = clean white frost 收敛 / 暗模式 = 更透让 glow 透出），实现 `getGlassStyleForVariant`（+ `getGlassHeroStyle`）于 `src/components/glass/shell.tsx`。Sticky 顶/底结构条已 inline 到 `sticky-chrome.tsx`（`stickyChromeStyle`），不算 7 档玻璃成员，用 `<GlassStickyHeader>` / `<GlassStickyFooter>` |
| Glass Track A premium-edge | hairline feathered rim（`RIM_THIN`/`REGULAR`/`THICK` = 1px 羽化 inset，thick 2px；旧 crisp 1px ring + 右下暗 bevel 在大档已撤）+ thick-only 色散 fringe/内折光/扫光（纯 box-shadow/bg-image，blur 半径不变、零 filter 成本、跨浏览器）；配方在 `src/components/glass/shell.tsx` 顶部 const 片段；详见 glass-ui.md `## 统一标尺` |
| Glass Track B 真折射 (refraction) | **真 `feDisplacementMap` 折射，Chromium-only**。**唯一看得见的**是「液态玻璃 BAR」：`<GlassStickyHeader lens>`（结果列表表头条，结果行从底下滚过时涟漪折射）；外加 Dialog/compare popover 的 thick portal 折射（基础设施、几乎看不见）。原语 `src/components/glass/glass-lens.tsx`（`useLensFilter('thick')` / `useClearLens()`）+ `<filter>` defs `glass-refraction-defs.tsx` + baked map `glass-lens-map.generated.ts`。**全页 hero 折射已废**（GPU 也 60fps 但视觉不可见——背后是平滑 glow；折射要弯锐利内容）。详见 glass-ui.md `## Track B · refraction lens` |
| 加新 i18n 文案 | `src/lib/i18n/zh.ts` + `en.ts` **必须成对加 key**（`en.ts` 用 `Record<keyof typeof zh, string>` 强制完整性）；组件用 `useT()` 消费；插值 `t("k", { var })`；日期走 `formatDate(value, locale, opts)` |
| 测试 / E2E | 单测 `src/**/__tests__/*.test.ts`（vitest）；E2E `e2e/*.spec.ts`（Playwright chromium）；CI `.github/workflows/ci.yml`（verify + e2e 两 job）；只测纯函数 |
| 历史 audit cleanup / Copilot v1-v2-v25 / Glass UI 等 plan / spec | `docs/superpowers/archive/2026-Q2/{plans,specs,findings}/`；按主题分类索引 [`docs/superpowers/plans/_index.md`](docs/superpowers/plans/_index.md) |
| API routes | `src/app/api/{datasets,schemas,displays,rubrics,experiments,llm-config,copilot,...}/route.ts` |
| 部署 | `Dockerfile` + `docker-compose.yml`（Next.js 16 standalone build） |

> 上面 14 条**直答**——找得到就别 grep / ls。详细架构 / 子系统 spec 在下面索引里。

## 索引

| 主题 | 文件 |
|---|---|
| 项目架构 / 技术栈 / 数据流 / 资源 CRUD / 测试 / i18n / 目录结构 / skill 集成 / 运行 | [`docs/architecture.md`](docs/architecture.md) |
| Copilot 子系统（v2 工具协议、关键文件、加新工具流程、context 抽取、交互） | [`docs/copilot.md`](docs/copilot.md) |
| Glass UI 视觉系统（7 档梯度 + mode-aware `light-dark()` fill（亮 clean-frost / 暗更透）+ Track A premium-edge + Track B 真折射 lens + tinted 名额 + 玻璃作用域 + 轻量 alpha 配方 + a11y 降级） | [`docs/conventions/glass-ui.md`](docs/conventions/glass-ui.md) |
| 开发流程（branch / PR / commit / tag / CHANGELOG / Plan-外偏离 / AI 协议） | [`AGENTS.md`](AGENTS.md) |
| 历史 plan / spec | [`docs/superpowers/archive/2026-Q2/`](docs/superpowers/archive/2026-Q2/)（索引：[`plans/_index.md`](docs/superpowers/plans/_index.md)） |

## 反直觉 3 强约束（不点链接也必须读到）

下面三条是反直觉的——文档读了也容易忘、容易"看起来更合理就走错路"。新 session 开工前必读：

### 1. 激活色用 `var(--copilot-accent)`，**不要**用 `var(--primary)`

项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 基本 = 灰）。用 `bg-primary/10` 做激活染色出来灰扁不像"亮"，看起来"按钮没生效"。

`--copilot-accent: oklch(0.76 0.16 225)` (sky blue) 才是 Tinted 和激活态的正确色。**动 copilot 玻璃 / segmented / primary CTA 染色时都用 copilot-accent，不要 primary。**

### 2. Sidebar + Copilot panel 永远 shadcn 扁平，**不**走玻璃

Glass UI 只覆盖**页面中间内容区**。以下明确**不走玻璃**：

- **Sidebar**（左侧主导航）—— `bg-muted/20` 实底，硬编扁平
- **Copilot panel 自身 + 内部**（session-list / chat-view 按钮 / textarea）
- **Toast / Sonner** —— HIG 明确 toast 不玻璃
- **Textarea / Input / Code 内部** —— 阅读密集

`segmentedItem(active)` helper 只处理 copilot 关闭态的 class，给 `sidebar.tsx` / `copilot/session-list.tsx` 这种"永远不走玻璃"的位置用。**这两处的 segmented 选中态永远不会 tinted**，写代码时不要"为了一致性"补玻璃。

### 3. JSX display 外层主卡用 `helpers.glassStyle()` API

用户自建的 JSX display（`display.mode === "jsx"`）源码里如果只写 `bg-card`，copilot 打开也是实底——破坏整页玻璃语言。所有 JSX display 的外层主卡 div 必须按这个 pattern 三件套：

```js
const { glassStyle, glassAttr } = helpers;
React.createElement('div', {
  className: 'border rounded-lg p-3 bg-card',     // copilot 关走实底
  style: glassStyle('regular'),                    // copilot 开走玻璃（关时 undefined）
  'data-glass-variant': glassAttr('regular'),      // 供 a11y 媒介查询选择器用
}, children)
```

参照已改好的：`data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`。新建 JSX display 必须带这个 pattern。

## 注意事项（pinpoint）

- 加新评测任务：`/settings/templates/new` 表单；复杂场景用「JSON 导入」粘贴 meta-prompt 产物
- 加新数据集：`/settings/datasets/new` 表单可 JSONL / JSON 数组 / CSV 上传；或 JSON 粘贴 tab
- 加新评分量表：`/settings/rubrics/new` 结构化表单
- 加新内置示例：写 `src/lib/seeds/xxx.{schema,rubric}.json` 或 `.jsonl`，在 `src/lib/seed.ts` 的种子列表里加 id
- 删除 seeded 资源：下次访问自动恢复；想永久删除请从 seed 列表移除
- 编辑 seeded 资源：都可以编辑，seed 只在文件缺失时恢复，不会覆盖修改
- 自定义 JSX display：浏览器端 `@babel/standalone` 编译，函数 Props `{ result, schema, helpers }`；不支持 import/require/fetch
- 结果 JSONL 去重：同 `task_id` 取最后一条（重试覆盖旧失败）
- 单条 retry：详情页失败 panel 上的 ↻ 按钮；POST `/api/experiments/{id}/run` body.task_ids 精确过滤
- **原子文件写**：统一走 `src/lib/fs-utils.ts` 的 `writeAtomic`，不要直接 `fs.writeFileSync`
- **新增 UI 文案**：必在 `src/lib/i18n/zh.ts` + `en.ts` 成对加 key，组件用 `useT()` 消费；`en.ts` 的类型约束会强制完整性
- **新增纯函数**：配套写 `src/**/__tests__/*.test.ts`，`npm test` 本地验证

详见 [`docs/architecture.md`](docs/architecture.md)。

@AGENTS.md
