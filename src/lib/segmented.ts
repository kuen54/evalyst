/**
 * 统一 segmented control / tab / nav active 态的设计 token。
 *
 * 选中态 = Copilot accent（sky blue，比 --primary 的暗褐色更"亮"）+ 内白高光 + accent ambient shadow
 * 未选中态 = 透明 + muted hover
 *
 * copilot 打开时调用方另外在 style 里叠 Thin/Tinted 玻璃 inline style，
 * 关闭时由这里的 class 驱动静态外观。
 */
export function segmentedItem(active: boolean): string {
  if (active) {
    return [
      "text-foreground",
      // accent 浅染
      "bg-[color:color-mix(in_oklab,var(--copilot-accent)_14%,transparent)]",
      // accent border（比灰色 border 亮）
      "border-[color:color-mix(in_oklab,var(--copilot-accent)_55%,transparent)]",
      // 三层 shadow：顶部白高光 + accent 1px 光圈 + accent ambient 落影
      "shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7),_0_0_0_1px_color-mix(in_oklab,var(--copilot-accent)_25%,transparent),_0_3px_10px_-2px_color-mix(in_oklab,var(--copilot-accent)_40%,transparent)]",
    ].join(" ")
  }
  return "border-border bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground hover:border-foreground/20"
}
