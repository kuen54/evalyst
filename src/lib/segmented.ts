/**
 * 统一 segmented control / tab / list active 态的设计 token。
 * 选中 = primary 浅染 + primary border + shadow-sm；未选中 = 透明 + muted hover。
 * copilot 打开时调用方自行在 style 里叠 Thin/Tinted 玻璃 inline style，
 * 关闭时由这里的 class 驱动。
 */
export function segmentedItem(active: boolean): string {
  return active
    ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
    : "border-border bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground hover:border-foreground/20"
}
