/**
 * 同步写 --theme-cascade-delay 到每个 [data-glass-variant]；激活 cascade CSS override flag。
 *
 * 必须在 applyThemeClass 之前同步调用——否则 transition 已按 inline 的 0 delay 起跑，
 * 后写的 delay 对 in-flight transition 不生效。
 *
 * @param copilotOpen 决定是否 stagger（关态 = 全 0 同步 crossfade）
 * @param panelPx copilot panel 当前像素宽度（copilotOpen=false 时不用）
 */
export function applyThemeCascade(copilotOpen: boolean, panelPx: number): void {
  if (typeof document === "undefined") return
  const prefersReduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // a11y：不写 delay、不设 flag。调用方继续 applyThemeClass → 所有元素走 inline
  // transition 0 delay 同步 crossfade，符合 reduced-motion 的"减少运动"预期。
  if (prefersReduce) return

  if (copilotOpen) {
    const vw = window.innerWidth
    if (vw > 0) {
      const panelVw = panelPx > 0 ? (panelPx / vw) * 100 : 0
      const startVw = 100 - panelVw
      // 给"点击主题 → cascade 启动"一点停顿感（非 0），但不到 reveal 的 750ms——
      // 那个阈值实测读作"等太久"。300ms 是主观节拍：用户能感知"发生了什么然后 ripple"，
      // 而不是"点了好像没反应然后才动"。
      const OFFSET_MS = 300
      // stagger window 0-1400ms：0 = 最右卡立刻起跑，1400ms = 最左卡最晚起跑
      const STAGGER_MS = 1400
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => {
          const rect = el.getBoundingClientRect()
          const cx = ((rect.left + rect.width / 2) / vw) * 100
          const stagger = Math.max(0, Math.min(STAGGER_MS, ((startVw - cx) / 100) * STAGGER_MS))
          el.style.setProperty("--theme-cascade-delay", `${OFFSET_MS + stagger}ms`)
        })
    }
  }
  // copilot 关态：不写 delay（全 0 = 所有元素同步 crossfade）

  document.documentElement.dataset.themeCascading = "true"
}

/**
 * 清 cascade 副作用：移除所有 --theme-cascade-delay 和 data-theme-cascading flag。
 * 幂等——对没有属性的元素调 removeProperty 是 no-op。
 */
export function clearThemeCascade(): void {
  if (typeof document === "undefined") return
  document
    .querySelectorAll<HTMLElement>("[data-glass-variant]")
    .forEach(el => el.style.removeProperty("--theme-cascade-delay"))
  delete document.documentElement.dataset.themeCascading
}
