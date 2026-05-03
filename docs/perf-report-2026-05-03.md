# 实验详情页性能优化报告 · 2026-05-03

> 本轮两个 PR 的实测汇总。全部基于 Playwright 在 http://localhost:3000（dev）上的真实点击测量：
> - `click_to_paint_ms` = click 触发到浏览器 2× rAF 后测得的时间（即首个稳定 paint）
> - `long_tasks` = PerformanceObserver 捕获的 ≥ 30ms 长任务

## 用户痛点

`反应有点慢`：实验详情页（104 条结果 + 52 失败任务的最重实验）点击 `▸ Experiment config` 折叠按钮有可感知的卡顿。

## Baseline（PR 前）

| 场景 | click_to_paint_ms | long_tasks |
|---|---|---|
| **Config Collapsible expand**（最痛的点） | **169** | **151ms** |
| Config Collapsible collapse | 105 | 97ms |
| FailedPanel collapse | 25 | 0 |
| Theme toggle | 19 | 0 |
| Dashboard → settings 首次 | ~1180ms（Turbopack 首编） | dev-only |
| Dashboard → settings 热缓存 | 53 | 0 |
| Running polling | 每秒 547 KB `/results` JSON.parse | 持续 ~100ms/s |

其他路由（dashboard / compare / 首页 → 实验详情首屏）**本来就快**（51-123ms / 0 long tasks），Copilot 开关 43ms 0 long task。

## 第一轮（PR #26，已合并）

| 优化 | 生效机制 |
|---|---|
| Running polling 改增量 | 只在 `completed_tasks / failed_tasks` 变化时才拉 `/api/experiments/:id/results` |
| `statsAgg` / `FailedPanel.failed` 加 `useMemo` | 每次 render 不再重跑 `aggregateResults(results)` |
| `handleRun / handleRetryTask / handleStop` 改 `useCallback` | 让 `React.memo(FailedPanel)` 的 props 引用稳定 |
| `CollapsibleContent` 加 `contain: layout paint` | 切断内部反流溢出 |
| `ExperimentPromptPreview` 抽 `React.memo` 子组件 | prompt 文本不随父 state 重渲 |
| `/api/.../results` 加 `?exclude=` 字段裁剪 | 向后兼容新参数，留给前端瘦身时用 |
| ~~Config Collapsible `GlassCard` → `Card`~~ | ❌ **已回退**：破坏 copilot 玻璃一致性 |

**实测**：config expand 169 → 110-170ms, collapse 105 → 70-130ms（浮动大，平均 ~30% 提升）。残余 100-150ms long task 定位到下方 104 result 的反流。

## 第二轮（本 PR）

> 设计约束：**禁止动 `GlassCard` → `Card` 类视觉降级手段**（用户明确纠正：copilot UI 一致性 > 微性能）。

| 优化 | 生效机制 |
|---|---|
| `startTransition(() => setConfigOpen(v))` 等 3 处 | 把 Collapsible state 切换标记为 non-urgent transition，click-to-paint 关键路径只剩 state 提交本身，Collapsible 动画 + 内容展开让到下一帧 |
| `viewBundle / resultsNode` 用 `useMemo` | 父组件因 configOpen 状态变更重渲染时，`resultsNode` 的 React element 引用稳定 → React 跳过 104 条 result item 的 diff（子树约 2K+ 节点） |
| FailedPanel / Scoring Collapsible 外层 `contain: layout paint` | 保底：layout 反流不向外传播 |

**实测**：config toggle **12-21ms, 0 long task**（expand 和 collapse 都是）。验证过 `<pre>` 在 6ms 内实际展开到 320px 高度，不是"只更新状态没渲染"。

## 对比总表

| 指标 | Baseline | PR #26 后 | PR 本轮后 | 降幅 |
|---|---|---|---|---|
| Config expand click_to_paint | **169ms** | ~140ms | **14ms** | **-92%** |
| Config expand long_tasks | 151ms | 100-150ms | **0** | -100% |
| Config collapse click_to_paint | **105ms** | ~80ms | **15ms** | **-86%** |
| Config collapse long_tasks | 97ms | 60-80ms | **0** | -100% |
| Running polling results traffic | 547 KB/s | ~10 KB/s*(※) | ~10 KB/s | -98% |

※ 仅在 `completed_tasks / failed_tasks` 变化时才取一次 /results，空转秒零 /results 请求

## 保留 / 放弃的方案

### 保留
- `startTransition` on Collapsible state setters —— 决定性贡献
- `useMemo(resultsNode)` + `useMemo(viewBundle)` —— 决定性贡献
- `React.memo(FailedPanel)` + `useMemo(statsAgg / failed)` + `useCallback(handlers)` —— PR #26 打底
- `contain: layout paint` on Collapsible 外层 + CollapsibleContent —— 保险层
- 增量 polling（按 completed 变化） —— 大节流
- `/api/experiments/[id]/results?exclude=` —— 未使用但向后兼容新增

### 放弃
- ~~`content-visibility: auto` + `contain-intrinsic-size`~~ on 结果列表 —— 实测反而慢了（浏览器对在视口内的元素有额外 bookkeeping 开销）
- ~~`GlassCard` → `Card` swap~~ —— 用户明确纠正破坏玻璃一致性
- ~~`prompt-template` lazy mount~~ —— startTransition + useMemo 已把成本压到 21ms 以内，不必要

## 不是瓶颈、跳过的

- **StrictMode 双触发 fetch**（dev-only）：`/api/experiments/:id` 等在 dev 被调 2 次是 React 19 StrictMode 特性，生产无此行为。改成手工 ref 去重反而复杂化。
- **Turbopack dev 首编 RSC 1178ms**：`npm run build` 生产构建后消失。
- **`/api/compare` 72KB + `/api/schemas` 38KB**：dashboard/compare 页本身已经很快（51-123ms），这些响应不是瓶颈。
- **Dashboard / compare / 首页**：各路径 click-to-paint 51-123ms 0 long task，不需要动。

## 剩余成本预估

- **Running 1s polling 仍会拉 `experiment + progress`**（~10 KB）：量很小，不是瓶颈。
- **Running 实验中 `completed_tasks` 变化时仍会拉完整 /results 547KB**：batch 跑完一条 task 触发一次全量拉。可进一步改成增量（只拉新 task_id）但：
  - 需要加后端接口 `?since=<last_task_id>`
  - 收益递减（几秒才触发一次）
  - 目前 ROI 低，**留作 follow-up 观察**
- **实验详情首屏 JSON.parse 547KB**：~100ms 的 long task 是必然成本（浏览器无论如何要解析 JSON）。需要后端裁剪才能降，而后端裁剪会破坏 display dimension 分组。**接受**。

## 验证方法

```bash
# 本地复现 baseline（glass 全开的状态）
git checkout main
npm run dev
# Playwright browser click 控制按钮 + PerformanceObserver (longtask) + perf.now()

# 本轮验收
git checkout perf/experiment-detail-round-2
npm run dev
# 同路径 Playwright 脚本；click_to_paint 应稳定 <30ms，0 long tasks
```

回归：`npx tsc --noEmit` + `npm test`(376/376) + `npm run build` + `npm run test:e2e`(10/10)。

## 附：实测数据片段

### Round-2 最终（glass 保留，+ startTransition + useMemo）

```json
[
  {"label": "expand #1", "click_to_paint_ms": 21, "long_tasks": []},
  {"label": "collapse #2", "click_to_paint_ms": 16, "long_tasks": []},
  {"label": "expand #3", "click_to_paint_ms": 16, "long_tasks": []},
  {"label": "collapse #4", "click_to_paint_ms": 15, "long_tasks": []},
  {"label": "expand #5", "click_to_paint_ms": 12, "long_tasks": []},
  {"label": "collapse #6", "click_to_paint_ms": 15, "long_tasks": []}
]
```

### 验证真实展开（6ms 到 320px）

```json
{
  "state_before_click": { "pre_exists": false },
  "timeline": [
    {"at_ms": 6, "pre_exists": true, "pre_height": 320, "visible": true},
    {"at_ms": 49, "pre_exists": true, "pre_height": 320, "visible": true},
    ...
  ]
}
```
