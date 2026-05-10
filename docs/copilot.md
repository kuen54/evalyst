# Copilot 子系统

`⌘K` 打开的右侧滑出 AI 助手面板。把"结果不满意 → 复制 context 到另一个对话窗口 → 调 prompt → 复制回来 → 重启实验"的拷贝粘贴链路换成"圈选 + Copilot 直接改模板/重跑"。

> 本 doc 是 Copilot 子系统参考。Glass UI（Copilot 打开时主内容区切换的视觉系统）见 [`conventions/glass-ui.md`](./conventions/glass-ui.md)；项目整体架构见 [`architecture.md`](./architecture.md)。

## 状态（2026-05-03 · v2）

- ✅ **Session + 流式对话**：`src/copilot/lib/session-store.ts` jsonl append-only + fork + prune-descendants；`llm-stream.ts` OpenAI + Anthropic SSE 归一化
- ✅ **Share Context + Inspector**：9 种 context 类型（experiment / task_result / task_field / text_selection / template / dataset / display / rubric / rubric_stats），Chrome DevTools 风格元素圈选，彩色 mask + 数字徽章，context 层级链（ancestors → `within: A → B → C`）
- ✅ **划线选中**：选区 → "+加入 Copilot" 胶囊 → 持久化高亮（TextSelectionMask 用 TreeWalker 按 offset 重建 Range）
- ✅ **Liquid Glass UI 系统**（见 [`conventions/glass-ui.md`](./conventions/glass-ui.md)）
- ✅ **v2 架构重构（2026-05-03）**：metadata-first tool descriptor + progressive disclosure + tool result 落盘护栏 + micro-compact。system prompt 恒定小，LLM 按需 tool 拉详情。
  - **工具 8 个**：`list_experiments` · `read_experiment_results`（带 `group_by/aggregate/filter` 聚合）· `restart_experiment` · `read_page` · `read_context(ctx_N, scope?)` · `read_resource(type,id,fields?)` · `read_tool_result(ref)` · `edit_template`（写工具，Confirm gate）
  - **Progressive disclosure**：SystemHeader 只放 `route_type + path + active_contexts[{id,type,ref,summary,within}]`；LLM 看到 ctx_N 后按需调 `read_context`；想查没圈过的资源调 `read_resource`
  - **护栏**：超 `maxResultSizeChars` 的 tool output 自动落盘到 `data/copilot/tool-results/{sid}/tr_xxx.json`，transcript 只留 preview+ref；LLM 想要完整 payload 调 `read_tool_result(ref)`
  - **Micro-compact**：每轮组装 LLM messages 前跑一次，老的可重放 tool_result 压成 summary（保最近 3 条），cache 前缀稳定
  - **Hooks**：`preToolCall`（confirmGate + audit）+ `postToolCall`（payloadGuard + telemetry）；Confirm 完全 metadata 驱动（`isDestructive` / `requiresConfirm`），不再写在 UI
  - Spec: `docs/superpowers/archive/2026-Q2/specs/2026-05-03-copilot-context-tool-v2-design.md`
  - Plan: `docs/superpowers/archive/2026-Q2/plans/2026-05-03-copilot-context-tool-v2.md`
- ✅ **PR-3 工具调用闭环（2026-04-28，PR #3 + #4）**：v2 保留的 pipeline 时序 race fix（appendMessage 并发 / auto-run 串行 / abortRef / SSE write-after-close / Confirm race / Gemini thinking `thought_signature` 原样回传 / chain 上限 5）
  - Spec: `docs/superpowers/archive/2026-Q2/specs/2026-04-28-copilot-pr3-tool-calling-design.md`
  - Plan: `docs/superpowers/archive/2026-Q2/plans/2026-04-28-copilot-pr3-tool-calling.md`

## 关键文件

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
├── shell.tsx                  # 9 档玻璃系统 + useGlassStyle hook（见 conventions/glass-ui.md）
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

## 加新工具流程（v2）

1. 写 `src/copilot/lib/tools/{name}.ts`，export `ToolDescriptor`：name / description / inputSchema / metadata (`isReadOnly` / `isDestructive` / `maxResultSizeChars` / 可选 `requiresConfirm`) / call
2. 在 `tools/registry.ts` 的 `TOOLS` 数组加入 import
3. 在 `tools/metadata-client.ts` 的 `CLIENT_TOOL_METADATA` 镜像一条（测试会强制两边对齐）
4. 若是写工具，在 `tool-call-card.tsx` 的 `VARIANT_BY_TOOL` 映射到 `"write"`（大部分写工具走默认 isDestructive 兜底即可）
5. 写纯函数单测到 `tools/__tests__/{name}.test.ts`，`call` 依赖 mock
6. `requiresConfirm` / `isDestructive` 会自动驱动 UI Confirm gate；`maxResultSizeChars` 自动走 payloadGuard 落盘

## 交互

| 快捷键 | 动作 |
|---|---|
| `⌘K` / `Ctrl+K` | 开/关面板 |
| `⌘Enter` / `Ctrl+Enter` | 发送消息 |
| `Esc` | 关闭面板（不在 input/textarea 焦点内） |
| Inspector 按钮 | 进入 DevTools 风格圈选模式 |
| 在任何地方选中文本 | 底部出现 "+加入 Copilot" 胶囊 |

## Context 抽取约定

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
