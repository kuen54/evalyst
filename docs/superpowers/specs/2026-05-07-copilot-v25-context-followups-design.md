# Copilot v2.5 · 默认 context 收敛 + 三 repo 二轮采纳 · 设计规范

**Date**: 2026-05-07
**Status**: Design approved (brainstorm), ready for implementation plan
**Scope**: 圈选默认 context 收敛(8 type 重新定 manifest)+ `read_dataset_records` 新工具 + Micro-compact token 阈值 + CompactBoundaryMessage + 极简 cache 遥测 + 会话级 alwaysAllow + 4-breakpoint 预留
**Reference**: 延续 v2 spec(`docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`)的三 repo 调研框架,做二轮采纳。三 repo 仍为 `claude-code-best/claude-code`(CCB)、`NousResearch/hermes-agent`(hermes)、`openclaw/openclaw`

---

## 1 · Context

v2(PR #24,2026-05-03)落地后的三个事实:

1. **system header 已恒定小** —— `buildLlmMessages` 显式不传 `resolveInline`,`active_contexts[]` 永远是 `{id, type, ref, summary, within}`,LLM 看不到任何 inline data ✅
2. **v1 时砍掉的 5 项当时是对的,今天不全是** —— 三个项目都在做的事(metadata-first / context layering / progressive disclosure)v2 都接住了,但有些"当时砍是因为 session 不长 / 单机不需要"的判断在 v2 上线后产生了新的痛感
3. **默认 context 还是塞了多 LLM 不该看的 data** —— 圈选 `task_field` / `task_result` 时,`resolveContextSelf` 返的 `data` 自带 `input_preview`(测试集那一行),这其实违反了 v2 §3 第三条"工具是 LLM 获取 context 的唯一入口"的精神:input data 应该让 LLM 用 `read_resource` / `read_dataset_records` 按需拿,不该默认塞

v2.5 在 v2 之上做两件事:

| 维度 | v2 现状 | v2.5 收敛 |
|---|---|---|
| 圈选默认 data | `resolveContextSelf` 各 type 返"全量 data" | 8 type 重新定 manifest(self / parent),data 一律走专用工具 |
| 跨 session 上下文管理 | 无 boundary 概念 | `CompactBoundaryMessage` 显式标边界 |
| Tool result 累积膨胀 | `microCompact` 只按数量保最近 N 条 | 加 `maxTotalReplayableTokens` 防极端累加 |
| Prompt cache 健康 | 无观测 | 极简 cache hit rate 遥测 |
| Confirm 卡频率 | 每次都弹 | 会话级 alwaysAllow(单工具) |
| 多次 cache 命中 | 不显式 | 4-breakpoint 预留(spec 写出,触发条件后再实施) |

---

## 2 · 二轮调研采纳

v2 §11 当时显式列了"显式未采用清单",这一节复盘其中 6 项,记下"今天为什么捡(或不捡)"。

### 2.1 复盘 v2 砍掉的 12 项

| 当时砍掉的项 | 来源 | v2 当时砍的理由 | 今天评估 |
|---|---|---|---|
| `autoCompact` 全量 summary | CCB | session 不长,YAGNI | ❌ 仍不捡——session 仍 < 20 轮 |
| Fork subagent cache-identical | CCB | 不付 Anthropic cache 的账 | ❌ 仍不捡——没有 fork 场景 |
| 4 类 taxonomy 跨 session 记忆 | CCB | 没选跨 session | ❌ 仍不捡(本次 v2.5 brainstorm 复议过,理由见 §2.3) |
| `ToolSearch` + `lazySchema` | CCB | 8 工具不值得 | ❌ 仍不捡——v2.5 后 9 工具,仍不到 50+ |
| **`CompactBoundaryMessage`** | **CCB** | **session 短,不需要** | ✅ **捡(§3)** |
| `ToolPermissionContext` 4 源矩阵 | CCB | 单机过重 | 部分捡(取其精简版 alwaysAllow,§5) |
| `contentReplacementState` 聚合预算 | CCB | 个体阈值 + micro-compact 够 | 部分捡(微调 micro-compact 加 token 阈值,§4) |
| `<tool_call>` XML 协议 | hermes | provider 原生够 | ❌ 仍不捡 |
| Handoff framing summary | hermes | 不做摘要 | ❌ 仍不捡 |
| `ContextEngine` 可插拔接口 | hermes/openclaw | 单 engine YAGNI | ❌ 仍不捡 |
| FTS5 session 搜索 | hermes | 文件系统更准 | ❌ 仍不捡 |
| **`prompt_caching.py` 4-breakpoint 显式控制** | **hermes** | **当前规模不值得** | ⚠️ **预留(§7);触发条件:cache hit rate < 70% 持续一周** |
| Gateway / channels | openclaw | 不需多端 | ❌ 仍不捡 |
| Active Memory + Dreaming + LanceDB | openclaw | 没选记忆 | ❌ 仍不捡 |
| 4-kind tool owner taxonomy | openclaw | 没选 MCP | ❌ 仍不捡 |
| `ToolAvailabilityExpression` | openclaw | YAGNI | ❌ 仍不捡 |
| `rewriteTranscriptEntries` | openclaw | 单 session 用不到 | ❌ 仍不捡 |
| **`ContextEnginePromptCacheInfo`** | **openclaw** | **从源头控制不需观测** | ✅ **极简版捡(§4):只看 cache hit rate,不要 6 break 原因码** |

### 2.2 关键反思:"系统目标"和"实现复杂度"当时混在一起判断

v2 当时砍 `ContextEnginePromptCacheInfo` 的理由是"非目标,从源头控制 cache 稳定性而非观测"——这其实把两件事一刀切了:

- ❌ openclaw 6 种 break 原因码 + engine 反应(rewriteTranscript)—— 仍是过度工程
- ✅ **只观测 cache hit rate / miss reason**—— 几乎免费(provider response 已经返了 usage 字段)

v2 把后者也砍了是误判。本次 v2.5 显式把"观测"和"反应"分开:**只做最小观测,不做反应**。

类似的反思还有:

- `CompactBoundaryMessage` 当时按"session 不长"砍。但 v2 实际跑下来,即使 session 不长,**没有 boundary 概念让 build-llm-messages 每轮重扫整个历史**。一个 1-line marker 几乎免费,反过来让组装逻辑变线性、micro-compact 边界更稳

### 2.3 仍不捡的:跨 session feedback memory

CCB 的 4 类 taxonomy(`user / feedback / project / reference`)+ stopHook fork agent 抽取 + `MEMORY.md` 是个完整子系统。即使简化为"只做 feedback 一类":

- 需要新存储 `data/copilot/feedback.jsonl`
- 需要 session 起始读入注入 system header(同时确保不破 cache)
- 需要 `save_feedback` 工具让 LLM 主动调用
- 需要 UI(查 / 删 / 全局禁用)
- 需要隐私考量

这堆事的总和不轻。**v2.5 不做**——等真正出现"用户反复教 copilot 同一件事"的信号再做。

---

## 3 · 改动 1:默认 context 收敛(M1)

### 3.1 问题诊断

当前 `src/lib/copilot/resolve-context.ts` 三处泄漏:

```ts
// resolveContextSelf — task_field 分支(L82)
return {
  ...base,
  status: 'ok',
  summary: `${field} = ${String(value).slice(0, 60)}`,
  data: {
    experiment_id: expId,
    task_id: taskId,
    field,
    value,
    task_status: found.status,
    input_refs: found.input_refs,        // ⚠️ 测试集 ref
    input_preview: found.input_preview,  // ⚠️ 测试集那一行 raw data
  },
}

// resolveContextSelf — task_result 分支(L62)
return { ..., data: found }   // ⚠️ found 整条,含 input_preview / input_refs / output / metrics

// resolveContextSelf — dataset 分支(L128)
return { ..., data: { def, sample: records.slice(0, 3), total } }  // ⚠️ 3 条 sample
```

加上各路径中:

```ts
// experiment 分支 — 暴露 prompt_template / notes
data: { ..., prompt_template: exp.prompt_template, notes: exp.notes, run_stats: exp.run_stats }

// template 分支 — schema 全量(prompt_template / variables / inputs / output_schema / display_dimensions)
data: schema

// display 分支 — display 全量(含 JSX 源码)
data: d
```

而 v2 §5.10.4 的 `resolveContextById(scope='self'|'parent')` 路径中 `task_field` 已是 `{targeted_field, targeted_value}` 干净的,但 `task_result` self 仍 dump full task,`task_field` parent 也带 `input_preview`(因为 parent 拼了 task 全量)。

### 3.2 八种 context type 的 manifest

每种 type 的 self / parent 形态如下表。**self 是默认形态**,凡用户圈选了一个 context、LLM 没指定 scope 时返这个;**parent 是显式 `scope='parent'` 时的扩展**;**data 走专用工具**列出对应资源该走哪条工具拉详细。

| type | self(默认) | parent(scope=parent) | data 走工具 |
|---|---|---|---|
| `task_field` | `{targeted_field, targeted_value}` | `{targeted_field, targeted_value, task_meta: {task_id, status, metrics}}` —— **不含 input** | `read_dataset_records(dataset_id, task_id?, limit, offset)` 拉 input |
| `task_result` | `{task_id, status, output, metrics, error?}` —— **不含 input_preview / input_refs** | + `{experiment: {id, name, schema_id, model}}` | input 同上;experiment 全量走 `read_resource("experiment", id)` |
| `experiment` | `{id, name, status, schema_id, dataset_id, display_id, rubric_id, model, run_stats}` —— **不含 prompt_template / notes** | — | `read_resource("template", schema_id)` 拿 prompt;`read_resource("dataset", dataset_id)` 拿数据 |
| `dataset` | `{id, name, fields: def.fields, total_records}` —— **不含 sample** | — | `read_dataset_records(id, limit, offset)` |
| `template` | `{id, label, description, model, prompt_template_excerpt: ≤300字, variable_names, output_field_names}` | — | `read_resource("template", id, fields=["prompt_template", "variables", "inputs", "output_schema", "display_dimensions"])` 任意子集 |
| `display` | `{id, name, mode, dimension_count}` —— **不含 columns / JSX 源码** | — | `read_resource("display", id, fields=["jsx" \| "columns"])` |
| `rubric` | `{id, name, criteria_summary: criteria.map(c => ({key, type, label}))}` | — | `read_resource("rubric", id)` 拿全量(含 description / required) |
| `rubric_stats` | 不变(已是聚合数据,`{annotated_tasks, total_tasks, per_criterion}`) | — | — |
| `text_selection` | 不变(`{text, length}`) | — | — |

**统一规则**:

- self 大小目标 **≤ 300 chars JSON**(text_selection / rubric_stats 例外)
- parent 在 self 基础上加一层语义外延,不重复展开整个 task / experiment data
- 任何 LLM 想看 raw data 的需求都通过工具调用满足,不通过默认 inline

### 3.3 `read_dataset_records` 新工具

`read_resource` 保持简单的 `pick(resource, fields)` 不引入嵌套查询语法;**新增 `read_dataset_records(dataset_id, task_id?, limit, offset)` 工具**专门处理 dataset 分页读:

```ts
// src/lib/copilot/tools/read-dataset-records.ts
export const readDatasetRecordsTool: ToolDescriptor<
  {
    dataset_id: string
    task_id?: string  // 给定时只返该 task 对应的那条 record
    limit?: number    // 默认 5,最大 20
    offset?: number   // 默认 0
  },
  {
    records: Array<Record<string, unknown>>
    total: number
    has_more: boolean
  }
> = {
  name: "read_dataset_records",
  description: "Read raw records from a dataset. Use after read_resource(dataset) to inspect actual data when the user's question requires it.",
  inputSchema: { ... },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 8000,  // 比 read_resource 高,因为 records 可能较大
  },
  call: async ({ dataset_id, task_id, limit = 5, offset = 0 }) => {
    const { records } = getDataset(dataset_id)
    if (task_id) {
      const found = records.find(r => /* 按数据集 id_field 匹配 */)
      return { records: found ? [found] : [], total: records.length, has_more: false }
    }
    const cap = Math.min(limit, 20)
    const slice = records.slice(offset, offset + cap)
    return { records: slice, total: records.length, has_more: offset + cap < records.length }
  },
}
```

**为什么独立工具而非扩展 `read_resource`**:

- `read_resource` 设计初衷是 "按 id 拿**一条资源**",records 是"资源内**多条数据**"——语义层级不同
- 分页参数只对 dataset 有意义,塞 `read_resource` fields 会让 schema 显得脏(其他 type 没这套参数)
- LLM 通过工具名一眼就知道"想看测试集行就调这个"
- `task_id` 可选参数让 LLM 在已知圈选 `task_result` 时直接跳到对应 input 行,免去算 dataset row index

### 3.4 chip preview UI 同步走 manifest

`/api/copilot/contexts/resolve` 是 chip rail 展开"查看详情"时调的,当前返完整 data。改为同步走 manifest:

- chip 展开看到的内容 = LLM 看到的内容 = manifest(self 形态)
- 消除"我以为 LLM 看到这么多"的心智错配

进一步可选 affordance(M1 阶段不做,留 M5 视情况补):

> chip 展开后底部加一行 "📦 完整数据走 `read_dataset_records` 工具" 文案,带"复制工具调用"按钮 → 用户一键把建议的 tool call 复制到 chat 输入框

### 3.5 与 v2 spec §5.10.4 `read_context.scope` 表的关系

v2 spec 里 `read_context.scope` 表定义了 self / parent 的语义边界。本节的 manifest 表是该表的**实质化(具象化)**——把"self 返什么"从一句话描述具体到字段级。两表必须一致;实施时以本节 §3.2 表为准,v2 spec §5.10.4 表会在 implementation 后被本表替代(spec 之间的演进)。

### 3.6 `read_page` 命中结果也走 manifest

`src/lib/copilot/tools/read-page.ts` 当前对 top-5 命中**调用 `resolveContexts(refs)` 返回全量 data** —— 这和圈选路径的老 `resolveContextSelf` 是**同一个泄漏源**。§3.2 manifest 只改了圈选路径没改 `read_page`,相当于"用户不圈只问"这条路径仍然拼测试集数据。

改动:`read_page.call` 的 `matches[].content_tree` 切换到新 manifest(self 形态)——

```ts
// read-page.ts line 65 附近,改动后:
const resolved = resolveContextsAsManifest(refs, 'self')  // ← 新 resolver,统一 §3.2 manifest
return {
  matches: scored.map((x, i) => ({
    key: x.entry.key,
    type: x.entry.type,
    content_tree: resolved[i]?.data ?? null,  // 现在是 manifest,不是 full dump
  })),
  total_scanned: snapshot.viewport_index.length,
}
```

LLM 读 `read_page` 结果后如果想看某条的详细,沿用同样的 progressive disclosure:调 `read_context` / `read_resource` / `read_dataset_records`。`read_page` 的定位回归"按语义搜索帮你定位",**不负责 payload**。

**与 §3.2 manifest 的关系**:共享同一个 manifest resolver。实施时抽公共函数 `manifestForType(type, resource) → unknown`,`resolveContextSelf`(圈选路径)和 `read_page.call`(查询路径)都调它。

### 3.7 划线降权:互斥 + chip 重新呈现

evalyst 当前有两条圈选路径:

| 路径 | 触发 | 产出 context |
|---|---|---|
| 圈选点选(`inspector-overlay.tsx`) | Inspector mode → hover + click | 8 种结构化 type(`task_result` / `task_field` / `experiment` / ...)|
| 划线(`text-selector.tsx`) | drag-select 文本 → "+加入"浮按钮 | `text_selection` |

evalyst 几乎所有结构化内容都挂了 `data-copilot-context` 属性,划线能选到的大多数文本本质都是某个 `task_field` 的子字符串。**两条路径重合度高、心智重叠、维护成本翻倍**。但 v2.5 不直接砍掉划线(留给"长字段值取片段"和"非结构化纯文本"两个窄用例),做**降权**:

#### 3.7.1 Inspector 模式下禁用划线

进入 Inspector mode 后,**关闭** TextSelector 的 selectionchange 监听,不弹"+加入"浮按钮。两条路径**互斥**——避免"想圈一个 task_field 但意外划到一段文字"的混淆。

实施:`text-selector.tsx` line 32 改:

```ts
// 旧
const { open, addContext } = useCopilotStore()
const enabled = open

// 新
const { open, inspectorActive, addContext } = useCopilotStore()
const enabled = open && !inspectorActive
```

`inspector-overlay.tsx` line 153-156 现有的"drag-select 时让 TextSelector 接管"的反向避让逻辑可以删除——既然两者互斥,inspector active 时 TextSelector 不会工作,无需让位。

#### 3.7.2 text_selection chip 主语换成 host

当前 chip 展开 `text_selection` 时主语是 `"产品质量过硬..."`(选中文本本身),用户视觉上看到的是"我选了一段话"。新呈现:**主语换成 hostType#hostId**,文本作为副语:

```
┌ chip (collapsed)──────────────────────────────────┐
│  #2  text  in task_field#output.answer    [×]    │
│       └ "产品质量过硬,值得推荐..."(节选)         │
└──────────────────────────────────────────────────┘

┌ chip (expanded)────────────────────────────────────┐
│  #2  text  in task_field#output.answer    [×]    │
│       └ in Exp B / task_B1                         │
│  ──────────                                        │
│  Selected text:                                    │
│  "产品质量过硬,值得推荐..."                       │
│                                                    │
│  Context anchor:                                   │
│  · 取自 task_field output.answer                  │
│  · within Exp B (exp_B) / task_B1                 │
│  · 完整字段值走 read_context(ctx_2, scope='parent')│
└──────────────────────────────────────────────────┘
```

让用户**一眼看出"这段文字其实是某个结构化资源里的一段子串"**,引导他下次"想讨论字段值用圈选 task_field"——心智过渡而不是强切。

#### 3.7.3 后续观察

降权后 6 个月观察 `text_selection` 在所有圈选事件里的占比:

- < 5% → 提议下线 TextSelector 整条路径
- ≥ 5% → 保留并继续优化(可能加更多 affordance)

具体观察方式不上 telemetry,看 session jsonl 里 contexts 字段统计即可,**不增加任何工程成本**。

---

## 4 · 改动 2:Micro-compact token 阈值(M1)

### 4.1 问题

当前签名:

```ts
microCompact(messages, { keepRecentReadResults: 3 })
```

只按"最近 N 条可重放 tool_result 保原样,其余压成 summary"的策略。绝大多数场景 OK,但极端情况:

- 3 次连续 `read_context(scope='parent')` 各拉一个 task 全量(含 output / metrics 等大字段)
- 或者 3 次 `read_dataset_records(limit=20)` 各拉 20 条 records

每条 tool_result 5KB → 3 条累计 15KB,在保护范围内但 cache 前缀已经被推移。

### 4.2 加 token 阈值

新签名:

```ts
microCompact(messages, {
  keepRecentReadResults: 3,
  maxTotalReplayableTokens: 4000,  // 即使最近 N 条之内,累计超阈值就从老到新继续压
})
```

实施伪码:

```ts
// 反向遍历(从最近到老),累加每条可重放 tool_result 的 approxTokens
// 没超阈值且在 keepRecentReadResults 内的保留;超了就压
const reversed = [...readResults].reverse()
let acc = 0
const keepIdxs = new Set<number>()
for (let i = 0; i < reversed.length; i++) {
  if (i >= keepRecentReadResults) break
  const tokens = approxTokens(JSON.stringify(reversed[i].m.content))
  if (acc + tokens > maxTotalReplayableTokens) break
  acc += tokens
  keepIdxs.add(reversed[i].i)
}
// keepIdxs 之外的可重放 tool_result 全部压成 summary
```

### 4.3 来源

CCB `microCompact` 原版是"时间 + token 双阈值"。v2 当时简化为只按数量(§5.6)。本节是**部分回补**:

- ✅ 加 token 维度 —— 防御 3 条 read_context 各 5KB 这种极端累加
- ❌ 不加时间维度 —— evalyst session 几小时内结束,时间阈值没意义

### 4.4 阈值初值

`maxTotalReplayableTokens: 4000` 与 v2 §10 表里 `read_resource.maxResultSizeChars: 4000` 同档(单条工具结果上限),保证 N=3 条都顶到上限时不会超过 12K token,主流模型 cache 前缀仍稳定。

---

## 5 · 改动 3:CompactBoundaryMessage(M2)

### 5.1 来源(CCB)

v2 round-1 brief:

> 压缩边界作为显式消息插入 transcript,配合 `getMessagesAfterCompactBoundary`,下游逻辑用 boundary 而非 index 切片,支持 pre/postCompact hooks

CCB 里 boundary 是为 `autoCompact` 设计的(摘要式压缩配合 boundary 切片)。**evalyst v2.5 不做摘要,只取 boundary 这个 1-line marker 作为"现状起点"标记**。

### 5.2 数据结构

JSONL transcript 里加一类新消息:

```ts
type CopilotMessage =
  | { role: 'user'; ... }
  | { role: 'assistant'; ... }
  | { role: 'tool'; ... }
  | { role: 'system'; kind: 'compact_boundary'; at: string /* ISO timestamp */; reason?: string }
  // ↑ 新增
```

### 5.3 何时插入

- **micro-compact 完成后**(每次 build-llm-messages 跑过 microCompact 后,如果实际有消息被压缩,在被压消息**之后**插一条 boundary)
- **未来 autoCompact / 跨 session 续接**:同样语义复用

### 5.4 何时使用

`build-llm-messages` 组装 LLM 请求时:

- 读 active branch
- 找最近一条 `compact_boundary`,如果存在 → 从 boundary 之后开始组装 messages(不读 boundary 之前的)
- 如果没有 boundary → 维持现状(读 active branch 全部)

### 5.5 故意不抄

- ❌ `autoCompact` 摘要写入 boundary —— 不做摘要
- ❌ CCB 的 `getMessagesAfterCompactBoundary` 这个 helper 名 —— evalyst 用 `sliceAfterBoundary(branch)` 内部命名
- ❌ `pre/postCompact` hook —— 当前只一个压缩策略(microCompact),hook 是给"多策略切换"用的;v2 已经在 §11.8 里识别到这个反模式

### 5.6 与现有 microCompact 的关系

```
旧:                                                新:
[u, a, tool, tool, u, a, tool, tool, u]            [u, a, tool, tool, BOUNDARY, u, a, tool, tool, u]
    ↑ 老 tool_result 被 microCompact                              ↑ boundary 之前的 messages
      原地改成 {kind:"compacted",summary:...}                       BUILD 时直接跳过,不再扫
```

旧机制:每轮 build-llm-messages 都得线性扫 history 里所有 tool 消息判断该不该压。
新机制:跳到 boundary,从那之后开始组装。**O(n) → O(messages-since-boundary)**。

---

## 6 · 改动 4:极简 cache 遥测(M2)

### 6.1 收什么

每次 LLM 调用结束后从 provider response 抽:

```ts
interface CacheUsageStat {
  session_id: string
  message_id: string  // assistant 消息 id
  ts: string

  input_tokens: number
  output_tokens: number

  // Provider 各自字段(map 到统一结构)
  cache_creation_tokens?: number  // Anthropic: cache_creation_input_tokens
  cache_read_tokens?: number      // Anthropic: cache_read_input_tokens
                                  // OpenAI: prompt_tokens_details.cached_tokens
                                  // Gemini: cachedContentTokenCount
  provider: 'anthropic' | 'openai' | 'gemini'
  model: string
}
```

### 6.2 当前缺失

`src/lib/copilot/llm-stream.ts` 的 usage 累加器只有 `{input_tokens, output_tokens}`,cache 字段全部 dropped。M2 任务:

- `parseAnthropicEvent` 的 `message_start` 事件除了 `input_tokens` 还要读 `cache_creation_input_tokens` / `cache_read_input_tokens`
- `parseOpenaiEvent` 末轮 usage 除了 `prompt_tokens` 还要读 `prompt_tokens_details.cached_tokens`
- Gemini 走 OpenAI 兼容协议时通常 `prompt_tokens_details` 不带 cached;若 evalyst 直连 Gemini 原生 API 则读 `usageMetadata.cachedContentTokenCount`(目前 evalyst 通过兼容层走,本字段可暂为 undefined)

### 6.3 落盘

新文件 `data/copilot/cache-stats.jsonl`,append-only,每次 LLM 调用一行 `CacheUsageStat`。

### 6.4 在哪显示

Copilot panel 内 session 详情处(chat-view 顶部 chip rail 旁边)加一条 mini 状态:

```
Cache hit: 83% (本 session)  ·  近 7 天: 76%
```

- 鼠标 hover → tooltip 展开每次调用的 cache_creation / cache_read / input_tokens 原始数字
- 数据源:`data/copilot/cache-stats.jsonl` 读取
- 不新建 `/settings/copilot` 路由(YAGNI);趋势图如果需要,后续再加
- (不上告警、不上 6 break 原因码)

### 6.5 故意不抄

- ❌ openclaw 6 break 原因码(`cacheRetention / model / streamStrategy / systemPrompt / tools / transport`)—— 写出来需要 hash 比对 system prompt / tools schema 等,工作量大且只在 hit rate 低时才有用
- ❌ openclaw `ContextEnginePromptCacheInfo.observation.broke` 的 engine 反应逻辑 —— 不做"自动 rewrite transcript"
- ❌ hermes `prompt_caching.py` 的 4-breakpoint 显式 cache_control 标注 —— 见 §7,触发条件后再做

### 6.6 触发条件:cache hit < 70% 持续一周

cache 遥测上线后观察一周:

- 如果 cache hit rate 稳定 ≥ 70% → 当前"不显式 cache_control"足够,不动
- 如果 < 70% → 进入 §7 4-breakpoint 显式控制

---

## 7 · 改动 5:Anthropic 4-breakpoint 预留(M4 - spec only)

### 7.1 触发条件

§6.6 一周观察后 cache hit rate < 70%。**v2.5 不实施**,本节只把设计写下来供后续。

### 7.2 hermes 怎么做

hermes `agent/prompt_caching.py` 的 `system_and_3` 策略(round-1 brief 命名,代码细节未深读):

- 1 个 breakpoint 在 system prompt 末尾
- 3 个 breakpoint 在 conversation history 上(具体在哪没读到——猜测是滚动放在最近 3 条 user 消息上)

### 7.3 evalyst 实施草图(供后续 plan)

`src/lib/copilot/build-llm-messages.ts` 给 Anthropic 路径加 cache_control:

```ts
// 最稳定的两段先标 ephemeral cache:
//   1. system prompt(COPILOT_SYSTEM_PROMPT 是常量 → 永远 hit)
//   2. tools schema(只在 v2.5 后期可能因 alwaysAllow 变,大部分 hit)
//
// 然后第 3、4 个 breakpoint 滚动放在最近 2 条 user 消息上,
// 让"上一轮 + 上上轮"对话能 hit cache。

if (provider === 'anthropic') {
  // breakpoint 1: system prompt 末尾
  systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' }

  // breakpoint 2: tools schema(在 buildAnthropicTools 里塞 cache_control 到最后一个 tool)
  if (tools.length > 0) {
    tools[tools.length - 1].cache_control = { type: 'ephemeral' }
  }

  // breakpoint 3 & 4: 最近两条 user 消息
  const userIdxs = messages.map((m, i) => m.role === 'user' ? i : -1).filter(i => i >= 0)
  const lastTwo = userIdxs.slice(-2)
  for (const i of lastTwo) {
    const msg = messages[i]
    msg.content[msg.content.length - 1].cache_control = { type: 'ephemeral' }
  }
}
```

### 7.4 风险与边界

- Anthropic cache_control breakpoint 上限 4 个,超了 API 拒收
- 切换 model 会破 cache(reason: model);切换 LLM provider 同理
- microCompact 改动 tool_result kind 也会破 cache(reason: tools 段或 history 段)→ 这正是为什么 §5 CompactBoundaryMessage 之后 build-llm-messages 跳过 boundary 之前的 messages,**减少需要重组装的内容,提高 cache 命中率**

### 7.5 故意不抄

- ❌ 1h cache(`type: 'ephemeral_1h'`)—— evalyst session 平均几小时但活跃片段几分钟,5m cache 已够
- ❌ openclaw 的 6 种 break reason 检测(见 §6.5)
- ❌ hermes 的 `system_and_3` 这个具体名字 —— 我们用 spec 里的"4-breakpoint"通用名,内部命名按 evalyst 习惯

---

## 8 · 改动 6:会话级 alwaysAllow(M3)

### 8.1 来源(CCB)

CCB `ToolPermissionContext` 的 `alwaysAllow` 是 3×4 矩阵的一格(3 = `alwaysAllow / alwaysDeny / alwaysAsk`,4 = `policy / plugin / project / user`)。round-1 brief:

> 三段式 permission: validateInput → checkPermissions(返回 PermissionResult)→ canUseTool hook(PreToolUse/PostToolUse)。`ToolPermissionContext` 含 mode/alwaysAllow/alwaysDeny/alwaysAsk 分源规则(plugin/project/user/policy)。`preparePermissionMatcher` 支持 `Bash(git *)` 风格模式匹配

### 8.2 evalyst 收敛形态

只取**会话级 alwaysAllow**,1×1 的最简形态:

- 不做 4 源(只有"本次会话")
- 不做 alwaysDeny(不需要的工具不注册即可)
- 不做 alwaysAsk(那是当前默认行为)
- 不做 pattern 匹配(`Bash(git *)` 这类),只按工具名

### 8.3 数据结构

```ts
// 客户端 sessionStorage(浏览器),不持久化到 disk,不跨 session
interface SessionAllowList {
  session_id: string
  always_allow: Array<{
    tool_name: string
    granted_at: string
  }>
}

const KEY = (sid: string) => `evalyst-copilot-allow-${sid}`
```

会话关闭即清。**不进 sessionStorage 之外的任何持久化**——隐私默认。

### 8.4 UI 入口

Confirm 卡(`tool-call-card.tsx` 在 `kind: 'pending_confirm'` 时渲染):

```
┌─ Tool call · edit_template · 待确认 ─┐
│  diff 预览...                         │
│                                       │
│  ☐ 本次会话信任 edit_template 工具    │   ← 新加的 checkbox
│                                       │
│  [拒绝]                  [确认]       │
└──────────────────────────────────────┘
```

勾选 + 确认 → 写 sessionStorage + 当次正常确认。下次同工具调用 → preToolCall 跳过 confirm gate,直接执行。

### 8.5 短路位置

`src/lib/copilot/tools/hooks.ts` 的 `confirmGateHook`:

```ts
async function confirmGateHook(ctx: PreToolCallCtx): Promise<HookResult> {
  // 新增:先查 sessionStorage allow list
  if (isSessionAllowed(ctx.session_id, ctx.tool.name)) {
    return { action: "proceed" }
  }

  const requireConfirm = ctx.tool.metadata.requiresConfirm ?? ctx.tool.metadata.isDestructive
  if (requireConfirm) return { action: "require_confirm" }
  return { action: "proceed" }
}
```

`isSessionAllowed` 实现走客户端 → 后端的桥(client 在 /chat 请求 body 里带 `session_allow_list?: string[]` 字段,服务端 hook 就近读)。

### 8.6 故意不抄

- ❌ 4 源(policy/plugin/project/user)—— 单机不需要
- ❌ alwaysDeny / alwaysAsk —— 不需要的工具不注册;ask 是默认
- ❌ Pattern 匹配(`Bash(git *)`)—— evalyst 写工具是结构化(`edit_template(schema_id, patch)`)而非自由文本命令,不需要 glob
- ❌ 持久化跨 session —— 隐私 / 安全 default,会话关即清
- ❌ `preparePermissionMatcher` / `PermissionResult` interface —— 一个 boolean 函数即可

---

## 9 · 数据兼容

### 9.1 CompactBoundaryMessage(§5)

新加的 `role: 'system', kind: 'compact_boundary'` 消息,**老 session JSONL 不会有它**——当 sliceAfterBoundary 找不到 boundary 时回退到读全部 active branch(语义等价于 v2 现状)。

### 9.2 `resolveContextSelf` manifest 改动(§3)

后端改了 `resolveContextSelf` 的 data 形态,前端 chip preview 直接消费——**前后端一起 ship**(同 PR),无需迁移。

### 9.3 cache 遥测落盘(§6)

新文件 `data/copilot/cache-stats.jsonl`,首次写入时自动创建。老 session 的历史调用没有 cache 数据,/settings/copilot 7 天趋势卡上线后从那一刻开始累计。

### 9.4 sessionStorage allow list(§8)

完全客户端,无后端兼容问题。

---

## 10 · 测试策略

### 10.1 纯函数(vitest)

- `manifestForType(type, scope)` —— 表驱动测,每个 type 的 self / parent 形态对照 §3.2 表
- `microCompact(messages, { keepRecentReadResults, maxTotalReplayableTokens })` —— 既有测试加 token 阈值边界 case
- `sliceAfterBoundary(branch)` —— 有 boundary / 无 boundary / 多个 boundary(取最近)
- `parseAnthropicEvent` cache 字段提取
- `isSessionAllowed(allowList, toolName)` —— 简单的数组 contains

### 10.2 集成

- `read_dataset_records(dataset_id, task_id, limit)` —— mock fs,验证 task_id 命中 → 单条;limit 上限 20;has_more 逻辑
- `confirmGateHook` 短路:allow list 命中时 → proceed,不命中时按 metadata 走

### 10.3 e2e(Playwright)

- 圈选 `task_field` → 发消息 → 断 LLM 收到的 system header.active_contexts[0] 不含 input_preview
- 圈选 → chip 展开 → 断展开内容是 manifest 形态(不是 dump)
- Confirm 卡勾选"本次会话信任"→ 同工具下次调用不再弹 Confirm
- session 详情页打开 → 有 cache hit rate 进度条(老 session 上为空,新 session 跑两轮后有数据)

---

## 11 · 实施顺序(M1-M4)

| 里程碑 | 内容 | 估时(单人) | PR 范围 |
|---|---|---|---|
| **M1** 默认 context 收敛 | §3.1-3.4 八种 type manifest + read_dataset_records 工具 + chip preview 同步 + §3.6 read_page manifest 化 + §3.7 划线降权(inspector 互斥 + chip 重构) + §4 micro-compact token 阈值 | 5-6 天 | 1 PR |
| **M2** 压缩与状态跟踪 | §5 CompactBoundaryMessage + §6 极简 cache 遥测 | 3-4 天 | 1 PR(也可拆 2 个) |
| **M3** 交互体验 | §8 会话级 alwaysAllow | 1-2 天 | 1 PR |
| **M4** 4-breakpoint 预留 | §7 spec only,不实施 | — | — |

总预估 ~9-12 天单人专注。M2 cache 遥测上线后**等一周**观察 cache hit rate,再决定 M4 是否启动。

各 M 独立可测试可 ship,M1 行为对老 session 等价(只让新 session 默认更小,且 inspector 期间不再有划线浮按钮);M2 不改用户交互;M3 是纯 UX 加法(不改默认行为)。

---

## 12 · 开放问题

| Q | 倾向 |
|---|---|
| `read_dataset_records` 的 `task_id` 参数怎么映射到 dataset row?(dataset.id_field 决定)| 走 `dataset.id_field` —— 取 dataset records 里 `r[id_field] === task_id` 那条 |
| Manifest 写死在 spec 还是各 type resolver 里宣告?| 写在 resolver 里(`resolveContextSelf` 各 case 直接构造 manifest 形态),spec 表只是文档对照 |
| chip preview 的"复制工具调用"按钮在 M1 做还是延后?| 延后到 M5 视情况补 |
| sessionStorage allow list 跨 tab 同步?| 不做 —— 单 tab 即一会话,跨 tab 各自管自己的 |
| cache hit rate < 70% 触发 M4 由人决定还是脚本告警?| 人决定 —— 先看趋势卡,不上告警 |
| ChatGPT 兼容层(走 OpenAI API 但底层 Anthropic)的 cache 字段怎么读?| Plan 阶段实测;evalyst 已有 Sankuai gateway 经验,字段可能是 `prompt_tokens_details.cached_tokens` 也可能是 `cache_read_tokens` 顶层 |

---

## 13 · 总结:v2 → v2.5 的演进

v2.5 不是"v2 的下一步",而是"**v2 落地后,基于真实使用复盘三 repo 当时砍掉的清单,做了 6 项二轮采纳**"。每一项都遵循 v2 §11 的纪律:

- **来源清晰**:每一项追到 CCB / hermes / openclaw 的具体模块
- **裁剪到位**:每一项都比源项目"完整版"小(boundary 不带 summary,cache 遥测不带 6 break 原因码,alwaysAllow 不要 3×4 矩阵)
- **故意不抄的写下来**:§5.5 / §6.5 / §7.5 / §8.6 列出每个改动旁边的"不抄什么"
- **触发条件而非开关**:M4 4-breakpoint 写 spec 但不实施,等数据告诉我们要不要做

v2 是把 evalyst copilot 从 "硬编 + JSONL append-only" 拉到了 progressive disclosure 架构;v2.5 是**沿着同一条线把 v2 的当时妥协逐项打磨**——尤其是"圈选默认还是塞太多 data"这条,本质是 v2 §3 第 3 条原则没贯彻到底。
