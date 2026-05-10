# evalyst

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

## 索引

| 主题 | 文件 |
|---|---|
| 项目架构 / 技术栈 / 数据流 / 资源 CRUD / 测试 / i18n / 目录结构 / skill 集成 / 运行 | [`docs/architecture.md`](docs/architecture.md) |
| Copilot 子系统（v2 工具协议、关键文件、加新工具流程、context 抽取、交互） | [`docs/copilot.md`](docs/copilot.md) |
| Glass UI 视觉系统（9 档梯度 + tinted 名额 + 玻璃作用域 + 轻量 alpha 配方 + a11y 降级） | [`docs/conventions/glass-ui.md`](docs/conventions/glass-ui.md) |
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
