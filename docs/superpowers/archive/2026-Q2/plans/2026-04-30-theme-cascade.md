# Theme Cascade v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主题切换时：glass 卡片镜像 reveal cascade 的 R→L stagger（copilot 开态）或同步 crossfade（copilot 关态）；非 glass chrome（body/aside/main）走一条和 glass baseline 同 320ms 的无 stagger crossfade —— 整屏同节奏起步，开态 glass 独自做 R→L ripple。

**Architecture:** glass 元素镜像 reveal cascade 的完整 transition shorthand override（已在产验证稳定）；chrome 独立 selector + 无 stagger 长 duration transition；移除 `<ThemeProvider>` 的 `disableTransitionOnChange`（否则 class 切换时 transition 被吞）。

**Tech Stack:** next-themes · React 19 · CSS transition + CSS var · 已有 `applyThemeClass` helper · vitest · jsdom

---

## File Structure

**新增**：
- `src/lib/theme/cascade.ts` — `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()`
- `src/lib/theme/__tests__/cascade.test.ts` — 4 case 单测

**改**：
- `src/components/sidebar.tsx` — `cycleTheme` 重构：调 `applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 2000)`；`cascadeTimeoutRef` 防连点残留；unmount 清
- `src/app/layout.tsx` — `<ThemeProvider>` 删 `disableTransitionOnChange` prop
- `src/app/globals.css` — 文末追加两段：glass shorthand override（镜像 reveal cascade 结构）+ chrome 320ms crossfade（和 glass 同节奏）

**文档**：
- `CHANGELOG.md` — 0.5.4 条目
- `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md` §18.4 更新

---

## Task 1：`applyThemeCascade` + `clearThemeCascade` 纯函数 + 单测（TDD）

**Files:**
- Create: `src/lib/theme/cascade.ts`
- Create: `src/lib/theme/__tests__/cascade.test.ts`

- [ ] **Step 1.1：写失败测试**

```ts
// src/lib/theme/__tests__/cascade.test.ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyThemeCascade, clearThemeCascade } from "../cascade"

function createGlassCard(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("data-glass-variant", "regular")
  el.getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: 0,
    left: rect.left ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 100),
    width: rect.width ?? 100,
    top: 0,
    bottom: 100,
    height: 100,
    toJSON: () => ({}),
  }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe("applyThemeCascade + clearThemeCascade", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    delete document.documentElement.dataset.themeCascading
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true, writable: true })
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })

  it("copilot closed：sets flag but writes no delay (全 0 同步 crossfade)", () => {
    const el = createGlassCard({ left: 500, width: 100 })
    applyThemeCascade(false, 0)
    expect(document.documentElement.dataset.themeCascading).toBe("true")
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
  })

  it("copilot open：writes per-element delay by x-position (rightmost 0, leftmost ~ startVw*14)", () => {
    // viewport=1000, panel=200px → startVw=80
    // Card right edge at x=900, center=950, cx=95 → delay = (80-95)*14 = -210 → clamp to 0
    const right = createGlassCard({ left: 900, width: 100 })
    // Card left edge at x=0, center=50, cx=5 → delay = (80-5)*14 = 1050ms
    const left = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    expect(document.documentElement.dataset.themeCascading).toBe("true")
    expect(right.style.getPropertyValue("--theme-cascade-delay")).toBe("0ms")
    expect(left.style.getPropertyValue("--theme-cascade-delay")).toBe("1050ms")
  })

  it("prefers-reduced-motion：no flag, no delay (让调用方继续 applyThemeClass 以 0 delay snap)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    const el = createGlassCard({ left: 0, width: 100 })
    applyThemeCascade(true, 200)
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
  })

  it("clearThemeCascade：removes delays and flag, idempotent", () => {
    const el = createGlassCard({ left: 0, width: 100 })
    el.style.setProperty("--theme-cascade-delay", "500ms")
    document.documentElement.dataset.themeCascading = "true"
    clearThemeCascade()
    expect(el.style.getPropertyValue("--theme-cascade-delay")).toBe("")
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()

    // idempotent second call
    clearThemeCascade()
    expect(document.documentElement.dataset.themeCascading).toBeUndefined()
  })
})
```

- [ ] **Step 1.2：验证失败**

```bash
npx vitest run src/lib/theme/__tests__/cascade.test.ts
```

Expected: FAIL, cannot resolve `../cascade`

- [ ] **Step 1.3：写实现**

```ts
// src/lib/theme/cascade.ts
/**
 * 同步写 --theme-cascade-delay 到每个 [data-glass-variant]；激活 cascade CSS override flag。
 *
 * 必须在 applyThemeClass 之前同步调用——否则 transition 已经按 inline 的 0 delay 起跑了，
 * 后写的 delay 对 in-flight transition 不生效。
 *
 * @param copilotOpen - 决定是否 stagger（关态 = 全 0 同步 crossfade）
 * @param panelPx - copilot panel 当前像素宽度（copilotOpen=false 时无关紧要）
 */
export function applyThemeCascade(copilotOpen: boolean, panelPx: number): void {
  if (typeof document === "undefined") return
  const prefersReduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // a11y：不写 delay、不设 flag。调用方继续 applyThemeClass → 所有元素走 inline
  // transition 0 delay 同步 crossfade，符合"reduced-motion 下减少运动"预期。
  if (prefersReduce) return

  if (copilotOpen) {
    const vw = window.innerWidth
    if (vw > 0) {
      const panelVw = panelPx > 0 ? (panelPx / vw) * 100 : 0
      const startVw = 100 - panelVw
      document
        .querySelectorAll<HTMLElement>("[data-glass-variant]")
        .forEach(el => {
          const rect = el.getBoundingClientRect()
          const cx = ((rect.left + rect.width / 2) / vw) * 100
          const delay = Math.max(0, Math.min(1400, ((startVw - cx) / 100) * 1400))
          el.style.setProperty("--theme-cascade-delay", `${delay}ms`)
        })
    }
  }
  // copilot 关态：不写 delay（全 0 = 所有元素同步 crossfade）

  document.documentElement.dataset.themeCascading = "true"
}

/**
 * 清理 cascade 副作用：移除所有 --theme-cascade-delay 和 data-theme-cascading flag。
 * 幂等——对没有属性的元素调 removeProperty 是 no-op。
 */
export function clearThemeCascade(): void {
  if (typeof document === "undefined") return
  document
    .querySelectorAll<HTMLElement>("[data-glass-variant]")
    .forEach(el => el.style.removeProperty("--theme-cascade-delay"))
  delete document.documentElement.dataset.themeCascading
}
```

- [ ] **Step 1.4：验证通过**

```bash
npx vitest run src/lib/theme/__tests__/cascade.test.ts
```

Expected: PASS 4/4

- [ ] **Step 1.5：commit**

```bash
git add src/lib/theme/cascade.ts src/lib/theme/__tests__/cascade.test.ts
git commit -m "feat(theme): add applyThemeCascade / clearThemeCascade helpers"
```

---

## Task 2：CSS override rule（glass 镜像 reveal + chrome 同 320ms crossfade）

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 2.1：追加 Theme switch cascade section 到文末**

在 `src/app/globals.css` 文末（所有现有规则之后）append：

```css
/* ---------------- Theme switch cascade ---------------- */

/* 1. Glass elements：镜像 reveal cascade 的完整 transition shorthand override + delay var。
      reveal cascade 用同样的形式已经稳定在产；不再玩"只 override delay"的过保守姿态。
      !important：覆盖 glass card 的 inline `transition` shorthand（useGlassStyle 产的 author 级）。 */
html[data-theme-cascading="true"] [data-glass-variant] {
  transition:
    background-color 320ms ease-out var(--theme-cascade-delay, 0ms),
    backdrop-filter  320ms ease-out var(--theme-cascade-delay, 0ms),
    border-color     320ms ease-out var(--theme-cascade-delay, 0ms),
    box-shadow       320ms ease-out var(--theme-cascade-delay, 0ms),
    background-image 320ms ease-out var(--theme-cascade-delay, 0ms)
    !important;
}

/* 2. Chrome elements（非 glass 的大块背景）：和 glass baseline 同 320ms，无 stagger。
      只覆盖 body、两个 aside（sidebar + copilot panel 都是 aside）、main——
      用户感知最强的大块底色。不覆盖 text/icon/button，避免 v0.5.3 的 `*` paint 风暴。
      关态 glass + chrome 同步 320ms 一次 crossfade；开态 chrome 快速到位，glass R→L ripple 在干净背景上可见。 */
html[data-theme-cascading="true"] body,
html[data-theme-cascading="true"] aside,
html[data-theme-cascading="true"] main {
  transition: background-color 320ms ease-out, border-color 320ms ease-out !important;
}

@media (prefers-reduced-motion: reduce) {
  html[data-theme-cascading="true"] [data-glass-variant],
  html[data-theme-cascading="true"] body,
  html[data-theme-cascading="true"] aside,
  html[data-theme-cascading="true"] main {
    transition: none !important;
  }
}
```

- [ ] **Step 2.2：验证 tsc**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.3：commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): glass mirrors reveal cascade shorthand; chrome matches 320ms baseline"
```

---

## Task 3：`<ThemeProvider>` 删 `disableTransitionOnChange`

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 3.1：删 prop**

找到（`src/app/layout.tsx` 约第 45 行）：

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

改成：

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
```

- [ ] **Step 3.2：验证 tsc**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3.3：commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(theme): remove disableTransitionOnChange from ThemeProvider"
```

Body:
> Required for element-level cascade: disableTransitionOnChange injects a brief
> `<style>* { transition: none !important }` during class swap, which would eat
> all transitions and kill the cascade. Initial-load flash protection is independent
> (via next-themes inline script injection), so removing this only affects runtime
> theme swaps — which is exactly what we want to be animated now.

---

## Task 4：`cycleTheme` 重构——串 cascade

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 4.1：import 补齐**

在 sidebar.tsx 顶部 import 区，加：

```tsx
import { applyThemeClass, type ResolvableTheme } from "@/lib/theme/apply"
import { applyThemeCascade, clearThemeCascade } from "@/lib/theme/cascade"
```

**注**：`applyThemeClass` 和 `ResolvableTheme` 是 v1 遗留的，保留。

- [ ] **Step 4.2：加 cascade timeout ref + 从 store 取 copilot width**

在 `Sidebar()` 函数里，其他 `useRef` 附近加：

```tsx
const cascadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

确认（应已存在）：
```tsx
const { open: copilotOpen, width: copilotWidth } = useCopilotStore()
```

如果原本只解构 `open`，扩展为 `open, width`。

- [ ] **Step 4.3：重构 cycleTheme**

找到现有 `cycleTheme`（应是 4 行的简单版）：

```tsx
const cycleTheme = () => {
  if (theme === "light") setTheme("dark")
  else if (theme === "dark") setTheme("system")
  else setTheme("light")
}
```

替换成：

```tsx
const cycleTheme = () => {
  let next: ResolvableTheme
  if (theme === "light") next = "dark"
  else if (theme === "dark") next = "system"
  else next = "light"

  // 抢前次 cycle 未完成的 cleanup：旧 setTimeout 在它本该触发之前被 clear，
  // 新 cycle 写新 delay + flag，旧 delay 和 flag 将由新 cycle 的 setTimeout 统一清。
  if (cascadeTimeoutRef.current) {
    clearTimeout(cascadeTimeoutRef.current)
    cascadeTimeoutRef.current = null
  }

  // 必须先 cascade apply（写 CSS var + 激活 flag），再 applyThemeClass（触发 transition）。
  applyThemeCascade(copilotOpen, copilotOpen ? copilotWidth : 0)
  applyThemeClass(next)  // sync DOM class toggle，触发 transition（各元素按 --theme-cascade-delay 错峰）
  setTheme(next)         // next-themes state + localStorage；其 useEffect 看到 class 已对，no-op

  // 2000ms = max delay 1400 + transition duration 320 + 280ms 余量
  cascadeTimeoutRef.current = setTimeout(() => {
    clearThemeCascade()
    cascadeTimeoutRef.current = null
  }, 2000)
}
```

- [ ] **Step 4.4：Unmount cleanup（防 memory leak）**

在 Sidebar 内已有的一个 `useEffect` 后面，加：

```tsx
// cycle 过程中 unmount（切页、热重载）时清 timeout + DOM flag，避免残留
useEffect(() => {
  return () => {
    if (cascadeTimeoutRef.current) {
      clearTimeout(cascadeTimeoutRef.current)
      cascadeTimeoutRef.current = null
    }
    clearThemeCascade()
  }
}, [])
```

- [ ] **Step 4.5：验证 tsc + lint**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4.6：commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(theme): wire cycleTheme with cascade + cleanup timeout"
```

---

## Task 5：完整验证

- [ ] **Step 5.1：vitest 全量**

```bash
npm test
```

Expected: 213+ passed（v1 的 applyThemeClass 4 case 保留 + 新增 cascade 4 case = 新 8 case theme 相关）

- [ ] **Step 5.2：tsc + lint + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: tsc clean, build succeeds

- [ ] **Step 5.3：手动 smoke（Chrome 最新）**

先确认 dev server 在跑（`npm run dev`）。

**Copilot 关态**：
1. 页面保持 copilot 关，点主题按钮：
   - Light → dark: 所有 card 同步淡入 dark 色，~320ms 完成。无"扫描线"
   - Dark → system: 同
   - System → light: 同
2. 快速连点 3 次：每次都跑一段 transition，无闪烁、无残留

**Copilot 开态**：
1. `⌘K` 开 copilot，等 reveal cascade 结束（~2.4s）
2. 点主题按钮：
   - 右边 card 先变色，肉眼可见"R→L 依次翻面"，约 1.3s 内完成
3. 快速连点 3 次：每次都跑 stagger，无残留 flicker

**`prefers-reduced-motion: reduce`（DevTools → Rendering → Emulate CSS media）**：
- 切主题 → 所有 card 同步淡入（0 delay，无 stagger），无 snap 突兀

- [ ] **Step 5.4：Playwright 自动断言**

```bash
node -e "console.log('navigate manually via MCP')"  # or skip; Playwright not strict for this
```

（可选，手动 smoke 优先）

- [ ] **Step 5.5：如有闪烁 / 卡顿**

回 Task 1/2 调整：
- 闪烁：`setTimeout` 延长到 2000ms；排查元素是否真的只 transition-delay 被 override
- 卡顿：给 glass card 加 `will-change: background-color, border-color`（谨慎；会占 GPU 内存）

**不应**：把 transition-property 加进 override rule——那就退化到 v0.5.3 的 flicker 陷阱

---

## Task 6：文档更新

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md` §18.4

- [ ] **Step 6.1：CHANGELOG 写 0.5.4 条目**

在 `CHANGELOG.md` 的 `## [Unreleased]` 下方插入：

```markdown
## [0.5.4] — 2026-04-30 · 主题切换 cascade（glass 镜像 reveal + chrome 同 320ms crossfade）

v0.5.3 defer、v0.5.4 v1（View Transitions API）被用户放弃（视觉是"扫描线"不是"每元素自己变"）后的第三次尝试。回到 element-level CSS transition 路线——这次**镜像已经在产的 reveal cascade 机制**做 glass 卡片；非 glass 大块背景（body / aside / main）也走 320ms 同节奏 crossfade，一次全屏同步变化。

### 体验

- **copilot 关**：所有 glass card 以 0 delay 同步 320ms transition；body/sidebar/panel bg 同步 320ms crossfade —— 一次全屏统一变色
- **copilot 开**：glass card R→L 错峰 stagger 0-1400ms（复用 reveal cascade 公式）；body/sidebar/panel bg 同时走 320ms 无 stagger crossfade —— 背景先 settle，前景 card 依次翻面 ripple

### 架构

- `src/lib/theme/cascade.ts` 新增 `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()`
  - 关态：只设 `html.dataset.themeCascading="true"` flag；不写 delay（全 0）
  - 开态：遍历 `[data-glass-variant]`，按 x 位置 + `panelPx` 换算 `(startVw - cx) / 100 * 1400` clamp [0, 1400] 写 `--theme-cascade-delay`
  - `prefers-reduced-motion: reduce`：不写 delay、不设 flag → 调用方仍 class swap 但无动画 scope
- `src/components/sidebar.tsx` `cycleTheme` 重构：`applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 2000)`；`cascadeTimeoutRef` 防连点残留；unmount useEffect 清 timeout + DOM flag
- `src/app/layout.tsx` **移除 `disableTransitionOnChange`** from `<ThemeProvider>`——它注入 `<style>* { transition: none !important }` 吞所有 transition；初次加载 flash 由 next-themes inline script（正交机制）保护，无影响
- `src/app/globals.css` 新增两段：
  - Glass rule：镜像 reveal cascade 结构（完整 shorthand + delay var + 5 个 property + !important）
  - Chrome rule：body / aside / main 320ms crossfade，无 stagger（和 glass baseline 同节奏）

### 相对 v0.5.3 + v0.5.4 v1 的定位

| 尝试 | 方案 | 结果 |
|---|---|---|
| v0.5.3 | Element-level + stagger + shorthand override + **`*` 全选** + 遇 `disableTransitionOnChange` 吞 | 失败：cleanup flicker + paint 风暴 |
| v0.5.4 v1 | View Transitions API + clip-path wipe/radial | 被放弃：视觉是"扫描线" |
| v0.5.4 v2.1 | Glass 镜像 reveal cascade + chrome breathing crossfade + 删 disableTransitionOnChange | 当前方案 |

**关键修正**：
1. Scope 从 `*` → `[data-glass-variant]`（glass）+ 手写 4 个 chrome selector；不再扫全页
2. 删 `disableTransitionOnChange`——v0.5.3 的第二个根因
3. Chrome 独立 crossfade，避免"card stagger / 背景 snap"割裂感

### 测试

- vitest: `applyThemeCascade` + `clearThemeCascade` 4 case（关态 / 开态 / reduced-motion / 幂等 cleanup）
- 手动 checklist：Chrome 关态 / 开态 × 3 cycle + reduced-motion bypass

### 归档

- v0.5.4 v1（View Transitions API）完整代码 + spec 保存在 `archive/theme-view-transitions` 分支；PR #12 closed 不合并

- Spec: `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-theme-cascade.md`
```

- [ ] **Step 6.2：更新 0.5.3 spec §18.4**

打开 `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`。找到 §18.4 末尾"本次完全 revert，下版本专题（可能从 CSS animation 或 mask-wipe 方向重做）"。在其后 append：

```markdown

**Update 2026-04-30**：已在 0.5.4 落地。尝试过 View Transitions API（v0.5.4 v1，clip-path 扫过，视觉是"扫描线"——用户放弃，归档在 `archive/theme-view-transitions`）后，最终方案是 element-level CSS transition + 只 override `transition-delay`（v0.5.4 v2）—— 从机制上避开 v0.5.3 原路的 property 栈变化 flicker。见 `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`。
```

- [ ] **Step 6.3：commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md
git commit -m "docs: changelog 0.5.4 + v0.5.3 spec §18.4 update (v2 landed)"
```

---

## Task 7：归档 spec/plan 进新分支 + push + PR

**Files:**
- Already committed: `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`（v2 权威版）
- Already committed: `docs/superpowers/plans/2026-04-30-theme-cascade.md`（本 plan）

- [ ] **Step 7.1：确认 branch + 提交都在**

```bash
git branch --show-current
git log --oneline main..HEAD
```

Expected: on `feat/theme-cascade-v2`；commits 是 spec+plan、cascade helpers、CSS rule、ThemeProvider change、cycleTheme refactor、docs。

- [ ] **Step 7.2：push**

```bash
git push -u origin feat/theme-cascade-v2
```

- [ ] **Step 7.3：PR**

```bash
gh pr create --title "feat(theme): v0.5.4 theme cascade v2 — element-level transition + only delay override" --body "..."
```

PR body 包含：
- 关 / 开态体验描述
- 相对 v0.5.3 / v0.5.4 v1 的差异（三路线对比）
- Test plan：单测 + 手动 smoke
- 归档说明（v1 在 `archive/theme-view-transitions`）

---

## 风险

| 风险 | 可能性 | 处理 |
|---|---|---|
| Cleanup flicker 仍然出现 | 低（只改 delay 应该不会触发 reconcile） | 延长 cleanup 到 2000ms；排查是否有其他规则被意外匹配 |
| Paint 风暴 导致帧率下降 | 中（~100 元素 stagger 内 transition bg-color） | 给 glass card 加 `will-change: background-color, border-color`；或 stagger 时长拉到 1500ms 降低并发度 |
| 移除 `disableTransitionOnChange` 导致初次加载 flash | 低（next-themes inline script 独立保护） | 实测；若出现 flash，加 `useEffect` 在 mount 后延后启用 cascade 逻辑 |
| OS system 偏好切换（非按钮路径）带上 transition 看起来怪 | 低 | 可接受；本来也不是交互路径 |
| Reveal cascade 和 theme cascade 同时触发 | 极低（用户必须在开 copilot 过程中立刻切主题） | 两套 CSS var 正交；theme cascade 的 delay override 会赢，视觉合理（reveal 的 property/duration + theme 的 delay） |

---

## 成功标准

- ✅ vitest 213+ green (new cascade 4 case + apply.test.ts 4 case保留)
- ✅ `npx tsc --noEmit` clean
- ✅ `npm run build` success
- ✅ Chrome 手动 smoke：关态 crossfade、开态 R→L stagger 每张卡自己翻面、`prefers-reduced-motion` 降级
- ✅ 无闪烁 / 无扫描线 / 无 cleanup flicker
- ✅ Git history：task-per-commit
- ✅ PR 开出，归档分支（`archive/theme-view-transitions`）保留 v1 代码
