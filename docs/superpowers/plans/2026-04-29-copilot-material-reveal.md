# Copilot Material Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 copilot 面板打开（`open: false → true`）加一次性 "AI 波纹扫过 + UI 级联翻成玻璃态" 的入场动效

**Architecture:** 全屏 `<MaterialRevealOverlay>` 客户端组件订阅 store 的 `lastOpenedAt` rising-edge → useLayoutEffect 里遍历 `[data-glass-variant]` 按水平位置写 `--reveal-delay` CSS var → 挂 `html[data-copilot-revealing="true"]` → 渲染两层渐变 div 走 700ms `background-position-x` 动画 → 850ms 后清理所有 var + dataset flag 并 unmount

**Tech Stack:** React 19 / Next.js 16 App Router / TypeScript / Tailwind v4 + 原生 CSS（@keyframes、`color-mix`、`mix-blend-mode`、`prefers-*` media queries）/ vitest for pure-function unit tests

**Spec:** `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`

---

## Context engineers need before starting

- 项目根：`/Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval`
- 现有 copilot glass 机制：`src/components/copilot/shell.tsx` 暴露 `useGlassStyle(variant)` hook，把玻璃相关的 `background-color / backdrop-filter / border-color / box-shadow / background-image` 作为 **inline style** 挂到元素上。切换靠 `open` 布尔触发 React re-render。inline transition 已设为 `320ms ease`
- 已有的 `html[data-copilot-open="true"]`（由 `store.tsx:211-215` 的 useEffect 写入）只服务 a11y @media query 和 hover-lift，**不**驱动玻璃渲染本身
- 本次新增的 `html[data-copilot-revealing="true"]` 必须用 `!important` 才能覆盖 shell 的 inline `transition`
- 项目测试：vitest 纯函数单测。不要测 React hook 行为或 DOM 交互。人工在 `npm run dev` 目视验证 UI
- 不动 `glow-overlay.tsx`（背景漂移光斑，和本功能正交）
- 不动 `panel.tsx`、不动 `shell.tsx`
- 中文技术文档 + 英文代码变量名

---

## File Structure

### Create
- `src/components/copilot/material-reveal-overlay.tsx` — 组件 + `computeRevealDelay` 纯函数
- `src/components/copilot/__tests__/material-reveal-overlay.test.ts` — `computeRevealDelay` 单测

### Modify
- `src/components/copilot/store.tsx` — 加 `lastOpenedAt: number` 字段 + rising-edge 检测
- `src/app/globals.css` — 追加 @keyframes + 两个 class + cascade override + 两条 a11y media query
- `src/app/layout.tsx` — 挂 `<MaterialRevealOverlay />`

---

### Task 1: `computeRevealDelay` 纯函数 + 单测

**Files:**
- Create: `src/components/copilot/__tests__/material-reveal-overlay.test.ts`
- Create: `src/components/copilot/material-reveal-overlay.tsx` (仅函数导出)

- [ ] **Step 1: 写失败单测**

Create `src/components/copilot/__tests__/material-reveal-overlay.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { computeRevealDelay } from "../material-reveal-overlay"

describe("computeRevealDelay", () => {
  it("returns 0 at right edge (centerXvw = 100)", () => {
    expect(computeRevealDelay(100)).toBe(0)
  })

  it("returns ~292 at screen middle (centerXvw = 50)", () => {
    const v = computeRevealDelay(50)
    expect(v).toBeGreaterThanOrEqual(290)
    expect(v).toBeLessThanOrEqual(295)
  })

  it("returns ~583 at left edge (centerXvw = 0)", () => {
    const v = computeRevealDelay(0)
    expect(v).toBeGreaterThanOrEqual(580)
    expect(v).toBeLessThanOrEqual(585)
  })

  it("clamps to 600 ceiling when centerXvw is negative (off-screen left)", () => {
    expect(computeRevealDelay(-20)).toBe(600)
    expect(computeRevealDelay(-100)).toBe(600)
  })

  it("clamps to 0 floor when centerXvw > 100 (off-screen right)", () => {
    expect(computeRevealDelay(120)).toBe(0)
    expect(computeRevealDelay(200)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑一下确认测试红**

Run: `cd /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval && npm test -- --run material-reveal-overlay`

Expected: FAIL — 错误消息含 `Cannot find module '../material-reveal-overlay'`。

- [ ] **Step 3: 建 overlay 文件，只导出 `computeRevealDelay`**

Create `src/components/copilot/material-reveal-overlay.tsx`:

```tsx
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
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `npm test -- --run material-reveal-overlay`

Expected: PASS — 5 tests pass。

- [ ] **Step 5: 全量 tsc 确认没破坏**

Run: `npx tsc --noEmit`

Expected: 无 error 输出（返回码 0）。

- [ ] **Step 6: 提交**

```bash
git add src/components/copilot/material-reveal-overlay.tsx src/components/copilot/__tests__/material-reveal-overlay.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): add computeRevealDelay pure fn + tests

第一步：material reveal cascade 的位置→延迟映射函数。
5 case 覆盖右边缘 / 中线 / 左边缘 / 负坐标钳位 / 超屏钳位。

Spec: docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Store 加 `lastOpenedAt` rising-edge

**Files:**
- Modify: `src/components/copilot/store.tsx`

- [ ] **Step 1: 读当前 store**

Run: `cat src/components/copilot/store.tsx | head -80`

确认现有结构：`CopilotStore` interface、`setOpen` / `toggleOpen` 两处需要挂 rising-edge 钩子、`NOOP_STORE` fallback 在文件尾。

- [ ] **Step 2: 加 `lastOpenedAt` 到 `CopilotStore` interface**

在 `src/components/copilot/store.tsx` 的 `interface CopilotStore` 里（约第 31-53 行 block），在 `mounted: boolean` 这一行之后插入：

```typescript
  /** rising-edge 时间戳，供 MaterialRevealOverlay 订阅。0 = 从未开过或刚 mount。 */
  lastOpenedAt: number
```

- [ ] **Step 3: 加 `lastOpenedAt` state + NOOP_STORE**

在 `CopilotStoreProvider` 函数体里的 state 声明区（约 66-71 行附近）加：

```typescript
  const [lastOpenedAt, setLastOpenedAt] = useState(0)
```

在文件底部 `NOOP_STORE` 对象里（约 263-289 行 block）加一行：

```typescript
  lastOpenedAt: 0,
```

- [ ] **Step 4: 改 `setOpen` 检测 rising edge**

找到现有 `setOpen`（约 97-102 行）：

```typescript
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    try { localStorage.setItem(LS_OPEN, v ? "1" : "0") } catch {}
    if (!v) setInspectorActive(false)
  }, [])
```

改成：

```typescript
  const setOpen = useCallback((v: boolean) => {
    setOpenState(prev => {
      if (v && !prev) setLastOpenedAt(performance.now())
      return v
    })
    try { localStorage.setItem(LS_OPEN, v ? "1" : "0") } catch {}
    if (!v) setInspectorActive(false)
  }, [])
```

- [ ] **Step 5: 改 `toggleOpen` 检测 rising edge**

找到现有 `toggleOpen`（约 103-110 行）：

```typescript
  const toggleOpen = useCallback(() => {
    setOpenState(prev => {
      const next = !prev
      try { localStorage.setItem(LS_OPEN, next ? "1" : "0") } catch {}
      if (!next) setInspectorActive(false)
      return next
    })
  }, [])
```

改成：

```typescript
  const toggleOpen = useCallback(() => {
    setOpenState(prev => {
      const next = !prev
      if (next && !prev) setLastOpenedAt(performance.now())
      try { localStorage.setItem(LS_OPEN, next ? "1" : "0") } catch {}
      if (!next) setInspectorActive(false)
      return next
    })
  }, [])
```

- [ ] **Step 6: 把 `lastOpenedAt` 加进 `useMemo` 的 value 对象 + deps**

找到 `const value = useMemo<CopilotStore>(() => ({`（约 217 行）附近的对象字段，在 `mounted,` 后面加：

```typescript
    lastOpenedAt,
```

然后在下方 deps array 里（约 243-254 行）加 `lastOpenedAt`：

```typescript
  ], [
    open, setOpen, toggleOpen,
    width, setWidth,
    activeSessionId, setActiveSessionId,
    mounted,
    lastOpenedAt,
    inspectorActive,
    contexts, addContext, removeContext, clearContexts,
    busy,
    pageContext, setPageContext,
    typingSignal, bumpTypingSignal,
    routeChangeBanner, showRouteChangeBanner, dismissRouteChangeBanner,
    clearManualContexts,
  ])
```

- [ ] **Step 7: tsc 确认无编译错误**

Run: `npx tsc --noEmit`

Expected: 无 error（返回码 0）。

- [ ] **Step 8: 跑全量 vitest 确认无回归**

Run: `npm test`

Expected: 全绿（包含之前的 ~204 tests + Task 1 新增的 5 tests）。

- [ ] **Step 9: 提交**

```bash
git add src/components/copilot/store.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): store expose lastOpenedAt rising-edge timestamp

给 MaterialRevealOverlay 订阅。setOpen / toggleOpen 检测 open
从 false → true 时写入 performance.now()；仅首次打开或从关态再开触发。
刷新恢复 open=true 时不触发（因为走 setOpenState 而非 setOpen）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: globals.css 加 keyframes / classes / cascade override / a11y

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 定位文件末尾**

Run: `wc -l src/app/globals.css`

Expected: 输出约 409 行。最后一行约为 `}`，在 407 行的 `.copilot-scroll-edge-top { ... }` 段之后。

- [ ] **Step 2: 追加 Material Reveal CSS 段**

在 `src/app/globals.css` 文件末尾追加以下完整块：

```css

/* ---------------- Copilot Material Reveal ---------------- */

/* !important 必须：shell.tsx useGlassStyle 把 transition 作为 inline style（author 级），
   外部规则没有 !important 则落败。`!important` 挂在 shorthand 末尾覆盖整个 transition 声明。 */
html[data-copilot-revealing="true"] [data-glass-variant] {
  transition:
    background-color 280ms ease-out var(--reveal-delay, 0ms),
    backdrop-filter  280ms ease-out var(--reveal-delay, 0ms),
    border-color     280ms ease-out var(--reveal-delay, 0ms),
    box-shadow       280ms ease-out var(--reveal-delay, 0ms),
    background-image 280ms ease-out var(--reveal-delay, 0ms)
    !important;
}

.copilot-reveal-wave,
.copilot-reveal-tail {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  mix-blend-mode: overlay;
  will-change: background-position;
  contain: layout style paint;
}

.copilot-reveal-wave {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--copilot-accent), transparent 82%) 35%,
    color-mix(in oklab, white, transparent 60%) 50%,
    color-mix(in oklab, var(--copilot-accent), transparent 82%) 65%,
    transparent 100%
  );
  background-size: max(360px, 22vw) 100%;
  background-repeat: no-repeat;
  animation: copilot-reveal-wave 700ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

.copilot-reveal-tail {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--copilot-accent), transparent 92%) 50%,
    transparent 100%
  );
  background-size: 40vw 100%;
  background-repeat: no-repeat;
  opacity: 0.7;
  animation: copilot-reveal-wave 700ms cubic-bezier(0.25, 0.1, 0.25, 1) 80ms forwards;
}

@keyframes copilot-reveal-wave {
  from { background-position-x: 100vw; }
  to   { background-position-x: -30vw; }
}

@media (prefers-reduced-motion: reduce) {
  .copilot-reveal-wave,
  .copilot-reveal-tail {
    animation: none;
    display: none;
  }
  html[data-copilot-revealing="true"] [data-glass-variant] {
    transition:
      background-color 200ms ease,
      backdrop-filter  200ms ease,
      border-color     200ms ease,
      box-shadow       200ms ease,
      background-image 200ms ease
      !important;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .copilot-reveal-wave,
  .copilot-reveal-tail {
    display: none;
  }
}
```

- [ ] **Step 3: 生产构建验证 CSS 合法**

Run: `npm run build 2>&1 | tail -30`

Expected: Build succeeds（可能有 warnings，但不能有 `error` 字样；Turbopack 会按语法校验 CSS）。如果看到 `unknown function color-mix` 或 `unknown property` 类错误则是语法 typo，检查粘贴是否完整。

- [ ] **Step 4: 提交**

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(copilot): css keyframes + cascade override for material reveal

- @keyframes copilot-reveal-wave 驱动 background-position-x 从 100vw 扫到 -30vw
- .copilot-reveal-wave / .copilot-reveal-tail 两层渐变 overlay（尾浪延后 80ms）
- html[data-copilot-revealing="true"] [data-glass-variant] 高优先级 transition
  以 --reveal-delay CSS var 错峰；!important 覆盖 shell.tsx inline transition
- prefers-reduced-motion: reduce → 不渲染 overlay、cascade 改 200ms 均匀
- prefers-reduced-transparency: reduce → 不渲染 overlay（玻璃本身走现有降级）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 完善 `<MaterialRevealOverlay>` 组件

**Files:**
- Modify: `src/components/copilot/material-reveal-overlay.tsx`

- [ ] **Step 1: 扩充组件代码**

把 `src/components/copilot/material-reveal-overlay.tsx` 完全替换成：

```tsx
"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useCopilotStore } from "./store"

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

/**
 * 一次性 Material Reveal overlay：订阅 store.lastOpenedAt rising-edge，
 * 扫一道 accent 色高光带 + 让 [data-glass-variant] 按水平位置级联翻成玻璃态。
 *
 * 刷新页面恢复 open=true 时不触发（首次 mount 被 firstMountRef 屏蔽）。
 * 关闭 copilot 时无动作（关闭不改 lastOpenedAt）。
 */
export function MaterialRevealOverlay() {
  const { lastOpenedAt } = useCopilotStore()
  const [active, setActive] = useState(false)
  const firstMountRef = useRef(true)

  useLayoutEffect(() => {
    // 首次 mount（含刷新恢复 open=true 的情况）不触发
    if (firstMountRef.current) {
      firstMountRef.current = false
      return
    }
    if (lastOpenedAt === 0) return

    const prefersReduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // 计算每个 [data-glass-variant] 的 --reveal-delay 并写成 inline CSS var
    const vw = typeof window !== "undefined" ? window.innerWidth : 0
    if (vw > 0 && !prefersReduce) {
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => {
          const rect = el.getBoundingClientRect()
          const centerXvw = ((rect.left + rect.width / 2) / vw) * 100
          el.style.setProperty("--reveal-delay", `${computeRevealDelay(centerXvw)}ms`)
        })
    }

    document.documentElement.dataset.copilotRevealing = "true"
    setActive(true)

    const cleanupDelay = prefersReduce ? 220 : 850

    /**
     * 清理：重新 querySelectorAll（不用前面捕获的集合），因为 850ms 内 DOM 可能变化。
     * 对没有 --reveal-delay 的元素调 removeProperty 是 no-op。
     */
    const cleanup = () => {
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => el.style.removeProperty("--reveal-delay"))
      delete document.documentElement.dataset.copilotRevealing
      setActive(false)
    }

    const timer = setTimeout(cleanup, cleanupDelay)

    // lastOpenedAt 再次变化（< 850ms 内二次打开）→ 先清再重起
    return () => {
      clearTimeout(timer)
      cleanup()
    }
  }, [lastOpenedAt])

  if (!active) return null
  return (
    <>
      <div className="copilot-reveal-wave" aria-hidden />
      <div className="copilot-reveal-tail" aria-hidden />
    </>
  )
}
```

- [ ] **Step 2: tsc 确认无编译错误**

Run: `npx tsc --noEmit`

Expected: 无 error。

- [ ] **Step 3: vitest 确认原 5 条 computeRevealDelay 测试仍全绿**

Run: `npm test -- --run material-reveal-overlay`

Expected: PASS — 5 tests pass（新代码不影响纯函数逻辑）。

- [ ] **Step 4: 全量 vitest**

Run: `npm test`

Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/components/copilot/material-reveal-overlay.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): MaterialRevealOverlay component

useLayoutEffect 订阅 store.lastOpenedAt 变化：
- 首次 mount 屏蔽（避免刷新恢复 open=true 时闪光）
- reduced-motion 跳过 overlay 本体，仅走加速 cascade transition
- 遍历 [data-glass-variant]，按 getBoundingClientRect 水平中心算 delay
- 写 --reveal-delay inline CSS var + data-copilot-revealing=true
- 渲染 .copilot-reveal-wave + .copilot-reveal-tail 两层 overlay
- 850ms 后 cleanup（fresh querySelectorAll）+ unmount

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 在 `layout.tsx` 挂载组件

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 找到现有 copilot overlay 的挂载位置**

Run: `grep -n "GlowOverlay\|CopilotPanel\|InspectorOverlay\|ContextMask\|TextSelector\|TextSelectionMask\|CopilotStoreProvider" src/app/layout.tsx`

Expected: 输出若干行（一般 5-10 行），展示上述组件 import + 使用位置。重点看 `<GlowOverlay />` 被挂在哪里（通常在 `<CopilotStoreProvider>` 内、`<CopilotPanel />` 前后）。

- [ ] **Step 2: 读 layout.tsx 全文**

Run: `cat src/app/layout.tsx`

确认 JSX 树结构、`"use client"` directive 情况、import 区顺序。

- [ ] **Step 3: 加 import**

在 `src/app/layout.tsx` 的 import 区，找到现有 `import { GlowOverlay } from "@/components/copilot/glow-overlay"`（或类似行），紧接其后加：

```typescript
import { MaterialRevealOverlay } from "@/components/copilot/material-reveal-overlay"
```

若 GlowOverlay import 不存在，则在任意 `@/components/copilot/...` import 之后加即可（保持 import 区分组有序）。

- [ ] **Step 4: JSX 里挂载**

找到 `<GlowOverlay />` 所在行（在 `CopilotStoreProvider` 子树内），紧接其后加：

```tsx
<MaterialRevealOverlay />
```

示例 —— 改前：
```tsx
<CopilotStoreProvider>
  <GlowOverlay />
  <InspectorOverlay />
  <ContextMask />
  <TextSelector />
  <TextSelectionMask />
  {children}
  <CopilotPanel />
</CopilotStoreProvider>
```

改后：
```tsx
<CopilotStoreProvider>
  <GlowOverlay />
  <MaterialRevealOverlay />
  <InspectorOverlay />
  <ContextMask />
  <TextSelector />
  <TextSelectionMask />
  {children}
  <CopilotPanel />
</CopilotStoreProvider>
```

如果现有结构不同（例如各 overlay 在不同容器），把 `<MaterialRevealOverlay />` 挂到和 `<GlowOverlay />` 同父节点、同兄弟位置即可。必须在 `CopilotStoreProvider` 子树内（因为它调 `useCopilotStore()`）。

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`

Expected: 无 error。

- [ ] **Step 6: 生产构建确认**

Run: `npm run build 2>&1 | tail -10`

Expected: `Compiled successfully` / `Collecting page data` / 无 error。

- [ ] **Step 7: 提交**

```bash
git add src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): mount MaterialRevealOverlay in layout

挂在 CopilotStoreProvider 子树内，与 GlowOverlay 同级。
没有 provider 外 render 路径，SSR 走默认 active=false 返回 null。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 人工目视验证 + e2e

**Files:** (无，仅验证)

- [ ] **Step 1: 启动 dev server**

Run: `npm run dev`

Expected: 输出包含 `Local: http://localhost:3000`（或 3002 等端口）。保持运行。

- [ ] **Step 2: Dashboard 页目视验证**

浏览器打开 `http://localhost:3000/`。

验证列表：
1. 按 ⌘K（macOS）/ Ctrl+K 打开 copilot → 看到从右向左一道淡蓝高光扫过整个主内容区，耗时约 0.7s
2. 扫光期间，各个实验卡片从扁平变成玻璃态，右边的卡先翻、左边的卡后翻（有明显级联感而非"整片一起 snap"）
3. 打开 Chrome DevTools → Elements → 找一张 `[data-glass-variant]` 元素 → reveal 期间看到 inline style 里有 `--reveal-delay: XXXms`，850ms 后消失
4. 再按 ⌘K 关闭 → 无动画，直接恢复扁平态
5. 反复按 ⌘K 多次 → 每次开都重新播放，关不播
6. 刷新页面（copilot 开着）→ 页面直接以玻璃态呈现，无扫光动画（因为走的是首次 mount 屏蔽路径）

若任何一条不符，记为 BLOCKER，回去排查。

- [ ] **Step 3: Experiment detail 页验证**

浏览器进入任意实验详情页（`/experiments/[id]`，可从 dashboard 点一张进去）。

重复 Step 2 的验证列表。这页卡片密度更高（progress card / scoring card / results 行卡 / failed panel），特别注意级联效果在密集卡片上是否流畅。

- [ ] **Step 4: Compare 页验证**

浏览器打开 `/compare?experiments=xxx&experiments=yyy`（或从 dashboard 多选后进入）。

重点：两张大卡并排，右边卡应该明显先翻面。

- [ ] **Step 5: Reduced motion 验证**

Chrome DevTools → Rendering tab（三个点菜单 → More tools → Rendering）→ 找 `Emulate CSS media feature prefers-reduced-motion` 下拉 → 选 `reduce`。

在 dashboard 页按 ⌘K：

验证：
1. 无扫光高光带
2. 卡片仍有 glass 过渡，但是所有卡同时均匀过渡（200ms），无级联错峰

- [ ] **Step 6: Reduced transparency 验证**

Rendering tab → `Emulate CSS media feature prefers-reduced-transparency` → `reduce`。

按 ⌘K：

验证：
1. 无扫光高光带
2. 卡片保持实底（现有 a11y 段降级生效），reveal 期间颜色过渡仍进行，观感是"底色渐入"

- [ ] **Step 7: DevTools Performance 录制**

Rendering tab 清掉 emulation 还原默认。

DevTools → Performance → Record → 按 ⌘K → 等 1s → Stop。

看 Main 轨：
1. reveal 触发瞬间应有一次 layout + paint（遍历 + setProperty）
2. 后续帧应全部为 paint-only（无长 JS 任务）
3. 没有任何 Task > 50 ms

若看到长任务或连续 JS 任务 > 1 帧，记为风险，排查。

- [ ] **Step 8: 停 dev server，跑 e2e smoke**

Ctrl+C 停 dev server。

Run: `npm run test:e2e`

Expected: 9 cases 全绿（本 feature 不破坏现有路由 no-crash + 侧栏渲染 + `/api/skills` 下载 smoke）。

- [ ] **Step 9: 无变更 commit，单做总结**

所有验证通过后不需要额外 commit。只做 verify-only 的任务不产生文件改动。

---

## Self-Review（计划完成前内部对照 spec）

✅ **Spec §1 目标** → 由 Tasks 1-5 合力实现
✅ **Spec §2 非目标** → 本 plan 明确不含 WebGL / 径向 / 关闭动画 / 光谱色等任何条目
✅ **Spec §3 决策（9 项）** → 全体决策在 Tasks 2/3/4 的代码常量里可追溯
✅ **Spec §4 时间轴** → Tasks 3/4 的 CSS 参数 + 组件 setTimeout 值吻合（700/280/850）
✅ **Spec §5 文件清单（4 个文件）** → Tasks 对应：T1+T4 创建，T2 store 改，T3 css 改，T5 layout 改
✅ **Spec §6 `computeRevealDelay`** → Task 1 测 + 实现
✅ **Spec §7 CSS 全文** → Task 3 原样追加
✅ **Spec §8 组件契约** → Task 4 原样落地
✅ **Spec §9 store 变更** → Task 2 完整落地（字段 + NOOP + setOpen + toggleOpen + useMemo deps）
✅ **Spec §10 layout.tsx 挂载** → Task 5
✅ **Spec §11 a11y 三段** → Task 3 CSS 里齐备
✅ **Spec §12 测试策略** → Task 1 单测 + Task 6 人工验证 + e2e smoke；不写 DOM / animation timing 测试
✅ **Spec §13 风险 4 条** → Task 6 Step 7 Performance 录制覆盖风险 #3（长任务）；风险 #1/2/4 为已知边界，留给运行期观察
✅ **Spec §14 回滚** → 4 文件改动边界清晰，每个任务独立 commit，逐个 revert 即可
✅ **Spec §15 后续** → 本 plan 不含 sparkle / hue shift / 密度调参 / AB 等

类型一致性：`computeRevealDelay`、`lastOpenedAt`、`--reveal-delay`、`data-copilot-revealing`、`.copilot-reveal-wave`、`.copilot-reveal-tail` 这些标识在 Task 1 / Task 2 / Task 3 / Task 4 之间拼写和含义一致。

无占位符：每个 step 都给出完整的代码、命令、期望输出。
