/**
 * 统一 segmented control / tab / nav active 态的设计 token。
 *
 * copilot 关闭：走 shadcn 原样（老 bg-accent 灰）
 * copilot 打开：新 accent（sky blue 发光效果）
 * 调用方另外在 style 里叠 Thin/Tinted 玻璃 inline style。
 */
export function segmentedItem(active: boolean, copilotOpen: boolean): string {
  if (!copilotOpen) {
    return active
      ? "border-foreground bg-accent/70"
      : "border-border bg-transparent hover:bg-muted/50"
  }
  if (active) {
    return [
      "text-foreground",
      "bg-[color:color-mix(in_oklab,var(--copilot-accent)_14%,transparent)]",
      "border-[color:color-mix(in_oklab,var(--copilot-accent)_55%,transparent)]",
      "shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7),_0_0_0_1px_color-mix(in_oklab,var(--copilot-accent)_25%,transparent),_0_3px_10px_-2px_color-mix(in_oklab,var(--copilot-accent)_40%,transparent)]",
    ].join(" ")
  }
  return "border-border bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground hover:border-foreground/20"
}
