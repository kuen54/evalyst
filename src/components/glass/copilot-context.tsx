"use client"

import { createContext, useContext } from "react"

/**
 * Glass primitive 与 Copilot store 的最小耦合接口。
 *
 * 视觉 primitive（src/components/glass/* + sidebar.tsx 的 theme cascade）只需要知道
 * Copilot panel 是否打开 + 当前宽度——不应触碰 CopilotStore 的完整 shape（contexts /
 * inspector / busy / pageContext / ...）。把这两个字段提到一个独立 context 上，让 domain
 * UI 通过两个 selector hook 按需消费：
 *
 * - `useCopilotOpen()`        —— 大多数 Glass 消费者只关心 open
 * - `useCopilotPanelWidth()`  —— sidebar 的 theme cascade 起点公式需要 width
 *
 * `CopilotStoreProvider`（src/copilot/components/store.tsx）负责在内层挂这个 Provider
 * 并把 `{ open, width }` 传进来。Provider 缺失时走 createContext 默认值，等价于以前的
 * NOOP_STORE 兜底（domain UI 在测试或独立场景渲染不会 crash）。
 */
const CopilotShellContext = createContext<{ open: boolean; width: number }>({ open: false, width: 0 })

export const CopilotShellProvider = CopilotShellContext.Provider

export function useCopilotOpen(): boolean {
  return useContext(CopilotShellContext).open
}

/**
 * Sidebar 的 theme cascade 起点公式需要当前 panel 宽度。在 PR 1 引入完整 API，
 * 在 PR 2 由 `src/components/sidebar.tsx` 消费——同 PR 完成 sidebar 切换 +
 * 31 站点 import 路径迁移，避免分两次动 sidebar。
 *
 * @public
 */
export function useCopilotPanelWidth(): number {
  return useContext(CopilotShellContext).width
}
