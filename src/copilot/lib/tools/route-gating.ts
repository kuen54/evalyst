// src/lib/copilot/tools/route-gating.ts
//
// v2.5 P2: per-route tool gating
//
// 设计原则（保守起步）：
//   - **always 集（5 个 read 工具）**：任何 route 都暴露。这些是 LLM 通用查询能力
//   - **按 route 增量加**：experiment / template / dataset 各自的写工具
//   - **未知 / 缺失 route fallback always 集**：不破，仅工具少
//
// 实测后调整 mapping：如果某 route 下 LLM 频繁说"this tool is not available here"，
// 把对应工具加进 ROUTE_EXTRA。

import type { AnyToolDescriptor } from "./registry"
import type { RouteType } from "../types"

/** 任何 route 都暴露的工具 —— 通用查询 + 进阶上下文获取 */
const ALWAYS_AVAILABLE: ReadonlySet<string> = new Set([
  "read_context",
  "read_resource",
  "read_page",
  "read_tool_result",
  "list_experiments",
])

/** Route → 额外暴露的工具集 */
const ROUTE_EXTRA: Record<RouteType, ReadonlySet<string>> = {
  // Dashboard / Hub —— 仅 always
  dashboard: new Set(),
  settings_hub: new Set(),
  models_list: new Set(),
  // 极端 fallback：types.ts 的 unknown route_type
  unknown: new Set(),

  // 实验相关
  experiment_new: new Set(),  // 新建态没 results
  experiment_detail: new Set([
    "read_experiment_results",
    "restart_experiment",
    "read_dataset_records",
  ]),
  compare: new Set([
    "read_experiment_results",
    "read_dataset_records",
  ]),

  // Templates
  templates_list: new Set(["edit_template"]),
  template_new: new Set(["edit_template"]),
  template_detail: new Set(["edit_template"]),

  // Datasets
  datasets_list: new Set(["read_dataset_records"]),
  dataset_new: new Set(["read_dataset_records"]),
  dataset_detail: new Set(["read_dataset_records"]),

  // Displays / Rubrics —— 只 always（read-only 浏览）
  displays_list: new Set(),
  display_new: new Set(),
  display_detail: new Set(),
  rubrics_list: new Set(),
  rubric_new: new Set(),
  rubric_detail: new Set(),
}

/**
 * 按 route 过滤 TOOLS。route_type 缺失或未识别时退回 always 集。
 *
 * 顺序保留 allTools 原顺序（cache prefix 稳定 = 减少同 route 内的 reorder break）。
 */
export function visibleToolsForRoute(
  allTools: ReadonlyArray<AnyToolDescriptor>,
  route_type: RouteType | undefined | null,
): ReadonlyArray<AnyToolDescriptor> {
  const extras = route_type && route_type in ROUTE_EXTRA ? ROUTE_EXTRA[route_type] : new Set<string>()
  const visible = new Set<string>([...ALWAYS_AVAILABLE, ...extras])
  return allTools.filter((t) => visible.has(t.name))
}

/** 给测试用：检查一个工具是否会在某 route 暴露 */
export function isToolVisibleAtRoute(
  toolName: string,
  route_type: RouteType | undefined | null,
): boolean {
  if (ALWAYS_AVAILABLE.has(toolName)) return true
  if (!route_type || !(route_type in ROUTE_EXTRA)) return false
  return ROUTE_EXTRA[route_type].has(toolName)
}
