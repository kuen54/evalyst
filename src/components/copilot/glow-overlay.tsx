"use client"

import { memo, useEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

// Copilot 光效 + 点击扩散光点。
//
// 视觉：
//   - `.copilot-glow::before` —— 四角慢速大色斑漂移
//   - `.copilot-glow-flow`   —— 中层长椭圆反向漂移
//   - busy(streaming) → 两层都加速 + 饱和度提升
//
// 交互：
//   - 鼠标点击 main 背景（非 panel/sidebar/overlay）→ 在点击位置生成一颗新的柔光，
//     淡入到 0.9 → 漂移到 0.55 常驻（animation fill-mode forwards），不再消失。
//   - copilot 关掉 → 立刻清光；否则上限 8 颗 FIFO 保留最近点击。
//
// 性能：
//   - 静态背景层 `StaticGlow` memo 隔离 —— 点击增删 spawn 不让背景层重渲染
//   - spawn 节流 120ms —— 连续快速点击不堆叠多个 blur surface

const SPAWN_MAX = 8
const SPAWN_THROTTLE_MS = 120
const SPAWN_COLORS = [
  "oklch(0.78 0.11 280)",
  "oklch(0.82 0.10 230)",
  "oklch(0.85 0.09 330)",
  "oklch(0.84 0.10 85)",
  "oklch(0.82 0.09 180)",
]

interface Spawn {
  id: number
  x: number
  y: number
  color: string
}

/** 静态背景层：enabled + busy 改变才 re-render，不受 spawn 增删影响 */
const StaticGlow = memo(function StaticGlow({
  enabled,
  busy,
  innerRef,
}: {
  enabled: boolean
  busy: boolean
  innerRef: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={innerRef}
      className="copilot-glow"
      data-enabled={enabled ? "true" : "false"}
      data-state={busy ? "active" : "idle"}
      aria-hidden
    >
      <div className="copilot-glow-flow" />
    </div>
  )
})

/** spawn 层：只渲染短寿命光点；独立 container 不沾染背景层 */
function SpawnLayer({ spawns }: { spawns: Spawn[] }) {
  if (spawns.length === 0) return null
  return (
    <div className="copilot-glow" aria-hidden style={{ opacity: 1, zIndex: 0, contain: "layout style paint" }}>
      {spawns.map(s => (
        <span
          key={s.id}
          className="copilot-glow-spawn"
          style={{
            top: s.y,
            left: s.x,
            ["--spawn-color" as string]: s.color,
          }}
        />
      ))}
    </div>
  )
}

export function GlowOverlay() {
  const { open, busy, inspectorActive } = useCopilotStore()
  const enabled = open
  const glowRef = useRef<HTMLDivElement | null>(null)
  const [spawns, setSpawns] = useState<Spawn[]>([])
  const spawnIdRef = useRef(0)
  const colorCursorRef = useRef(0)
  const lastSpawnAtRef = useRef(0)
  const inspectorActiveRef = useRef(inspectorActive)
  inspectorActiveRef.current = inspectorActive

  useEffect(() => {
    if (!enabled) {
      // 面板关了 → 立刻清掉仍在动画中的 spawn，避免残留光点继续可见
      setSpawns([])
      return
    }
    const glow = glowRef.current
    if (!glow) return
    const main = glow.parentElement
    if (!main) return

    const isInCopilotUI = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof Element)) return false
      return !!el.closest("[data-copilot-panel], [data-copilot-overlay], aside")
    }

    const onClick = (e: MouseEvent) => {
      if (inspectorActiveRef.current) return
      if (isInCopilotUI(e.target)) return
      const now = performance.now()
      if (now - lastSpawnAtRef.current < SPAWN_THROTTLE_MS) return
      lastSpawnAtRef.current = now

      const rect = main.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
      const id = ++spawnIdRef.current
      const color = SPAWN_COLORS[colorCursorRef.current++ % SPAWN_COLORS.length]
      setSpawns(prev => {
        const next = [...prev, { id, x, y, color }]
        return next.length > SPAWN_MAX ? next.slice(next.length - SPAWN_MAX) : next
      })
    }

    window.addEventListener("click", onClick, { capture: true })
    return () => {
      window.removeEventListener("click", onClick, { capture: true } as EventListenerOptions)
    }
  }, [enabled])

  return (
    <>
      {enabled && <StaticGlow enabled={enabled} busy={busy} innerRef={glowRef} />}
      <SpawnLayer spawns={spawns} />
    </>
  )
}
