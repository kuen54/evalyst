export type ResolvableTheme = "light" | "dark" | "system"

/**
 * 同步把 .dark class 应用到 document.documentElement。
 * 镜像 next-themes 内部 class 逻辑，给 View Transition callback 在
 * 快照之间同步改 DOM 用——next-themes 的 setTheme 走 useEffect 异步，
 * 快照之间来不及改，必须这里手动同步做。
 *
 * 调用方还要 setTheme 更状态/localStorage；本函数只改 class。
 */
export function applyThemeClass(next: ResolvableTheme): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (next === "dark") {
    root.classList.add("dark")
    return
  }
  if (next === "light") {
    root.classList.remove("dark")
    return
  }
  // system
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  root.classList.toggle("dark", prefersDark)
}
