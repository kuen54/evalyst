/**
 * Shadcn 扁平 segmented control 状态 class —— active / inactive 两套 border + bg。
 *
 * 只处理 copilot 关闭态（shadcn 扁平）。copilot 打开态的 glass 版本见
 * `src/components/copilot/glass-segmented.tsx` 的 `GlassSegmentedItem`。
 *
 * 用于 sidebar / copilot session-list 等"永远不走玻璃"的位置。
 */
export function segmentedItem(active: boolean): string {
  return active
    ? "border-foreground bg-accent/70"
    : "border-border bg-transparent hover:bg-muted/50"
}
