# evalyst

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

> **项目架构 / 技术栈 / 数据流 / 资源管理 / 测试 / i18n / 目录结构 / skill 集成 / 注意事项** 见 [`docs/architecture.md`](docs/architecture.md)。

<!-- 评测核心架构内容已迁至 docs/architecture.md (commit 2)。本文件保留 Copilot + Glass UI 章节，由后续 commit 3 / 4 迁出，commit 5 重写顶部为索引 + 反直觉 3 强约束。 -->

## Copilot（内嵌 AI 助手）

`⌘K` 打开的右侧滑出对话面板。核心诉求：把"结果不满意 → 把系统 context 复制到另一个对话窗口 → 调 prompt → 复制回来 → 重启实验"的拷贝粘贴链路，换成一条"圈选 + Copilot 直接改模板/重跑"的路径。

### 状态（2026-05-03 · v2）

- ✅ **Session + 流式对话**：`src/copilot/lib/session-store.ts` jsonl append-only + fork + prune-descendants；`llm-stream.ts` OpenAI + Anthropic SSE 归一化
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
src/copilot/lib/
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

src/copilot/components/
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

1. 写 `src/copilot/lib/tools/{name}.ts`，export `ToolDescriptor`：name / description / inputSchema / metadata (`isReadOnly` / `isDestructive` / `maxResultSizeChars` / 可选 `requiresConfirm`) / call
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

组件 `GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted` / `GlassCard` / `GlassCardThin` / `GlassSuccess` / `GlassWarning` / `GlassDanger` 从 `@/copilot/components/shell` 导出。`GlassStickyHeader` / `GlassStickyFooter` 从 `@/copilot/components/sticky-chrome` 导出。`GlassSegmentedItem` 从 `@/copilot/components/glass-segmented` 导出。非 JSX 场景用 `useGlassStyle(variant)` hook 取 `CSSProperties`。

### `--copilot-accent` 而非 `--primary`

项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 基本 = 灰）。`bg-primary/10` 做激活染色出来灰扁不像"亮"。`--copilot-accent: oklch(0.76 0.16 225)` (sky blue, 与 glow 主色呼应) 才是 Tinted 和激活态的正确色。**动 copilot 玻璃 / segmented / primary CTA 染色时都用 copilot-accent，不要 primary。**

### Segmented 选中态

**`<GlassSegmentedItem>` (`src/copilot/components/glass-segmented.tsx`)** 是 segmented control / active tab / nav item 的统一组件。通过 `render` prop 支持 `<button>` / `<Link>` / `<a>` 等任意底层 element：
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

@AGENTS.md
