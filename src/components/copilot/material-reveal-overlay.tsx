"use client"

/**
 * 计算某卡片受 wave 驱动的 glass transition 启动延迟（ms）。
 *
 * 波纹中心从 x=100vw 起，700ms 线性扫到 x=-20vw（覆盖 120vw 距离）。
 * 返回：wave 中心到达卡片中心的时刻，夹在 [0, 600] 区间。
 *
 * @param centerXvw 卡片水平中心位置（vw 单位，0=左边缘，100=右边缘）
 */
export function computeRevealDelay(centerXvw: number): number {
  const fromVw = 100
  const totalVwTraveled = 120 // 100 → -20
  const durationMs = 700
  const raw = ((fromVw - centerXvw) / totalVwTraveled) * durationMs
  return Math.max(0, Math.min(600, raw))
}
