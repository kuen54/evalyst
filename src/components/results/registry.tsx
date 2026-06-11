"use client"

import { JsonDefaultResults, JsonDefaultCell } from "./json-default-results"
import { SingleListResults, SingleListCell } from "./single-list-results"
import { DualListResults, DualListCell } from "./dual-list-results"
import { TripleGridResults, TripleGridCell } from "./triple-grid-results"
import { BubbleAutoResults, BubbleAutoCell } from "./bubble-auto-results"
import { ConfigurableDisplay, ConfigurableCell } from "./configurable-display"
import type { Display, TaskSchema } from "@/lib/schema/types"
import type { ResultViewSpec, ResultViewProps, CellViewProps } from "./types"
import { inferDisplayBuiltinId } from "@/lib/display-inference"

// 内置组件绑定（builtin_component 值 → React 组件对）
const BUILTIN_COMPONENTS: Record<string, ResultViewSpec> = {
  single_list: { component: SingleListResults, Cell: SingleListCell },
  dual_list: { component: DualListResults, Cell: DualListCell },
  triple_grid: { component: TripleGridResults, Cell: TripleGridCell },
  bubble_overlay: { component: BubbleAutoResults, Cell: BubbleAutoCell },
  json_default: { component: JsonDefaultResults, Cell: JsonDefaultCell },
}

// builtin_* id → BUILTIN_COMPONENTS key
const BUILTIN_ID_TO_COMPONENT: Record<string, string> = {
  builtin_single_list: "single_list",
  builtin_dual_list: "dual_list",
  builtin_triple_grid: "triple_grid",
  builtin_bubble_overlay: "bubble_overlay",
  builtin_json_default: "json_default",
}

// 自定义 display 的 wrapper 按 display 对象引用缓存：React 按组件标识 diff，
// pickView 每次调用都新建箭头组件的话 ViewComp 恒为"新类型"→ 整棵结果树
// unmount + remount（运行中详情页 1s 轮询下 = 每秒重挂几百张 GlassCard）。
// WeakMap 键到对象引用上：display 重新 fetch / 表单重建时引用变 → 缓存自然
// 失效，恰好对应"配置可能真变了"。
const configurableViewCache = new WeakMap<Display, ResultViewSpec>()

/**
 * 优先级：
 *   1. 显式 display (mode=table/grouped_grid/jsx) → ConfigurableDisplay
 *   2. 显式 display (mode=builtin) → 对应组件
 *   3. 无显式 display → inferDisplayBuiltinId(schema) 推断
 *   4. 推断失败 → json_default
 */
export function pickView(schema: TaskSchema | undefined, display: Display | undefined): ResultViewSpec {
  if (display) {
    if (display.mode === "table" || display.mode === "grouped_grid" || display.mode === "jsx") {
      let spec = configurableViewCache.get(display)
      if (!spec) {
        const Comp = (props: ResultViewProps) => <ConfigurableDisplay {...props} display={display} />
        const Cell = (props: CellViewProps) => <ConfigurableCell {...props} display={display} />
        spec = { component: Comp, Cell }
        configurableViewCache.set(display, spec)
      }
      return spec
    }
    if (display.mode === "builtin" && display.builtin_component) {
      const comp = BUILTIN_COMPONENTS[display.builtin_component]
      if (comp) return comp
    }
  }

  // 自动推断
  if (schema) {
    const inferredId = inferDisplayBuiltinId(schema)
    const componentKey = BUILTIN_ID_TO_COMPONENT[inferredId]
    if (componentKey && BUILTIN_COMPONENTS[componentKey]) return BUILTIN_COMPONENTS[componentKey]
  }

  return BUILTIN_COMPONENTS.json_default!
}
