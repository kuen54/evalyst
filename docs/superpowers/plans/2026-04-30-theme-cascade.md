# Theme Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 light ⇌ dark ⇌ system 主题切换加 cascade 动画，通过 View Transitions API 实现浏览器合成层 blit，从机制上规避 v0.5.3 cascade 方案的 cleanup 闪烁 + paint 风暴。

**Architecture:** 用 `document.startViewTransition` 包 `setTheme`；在 callback 里同步手动 toggle `.dark` class（让浏览器快照抓到新态，绕开 next-themes useEffect 异步延迟）；CSS `::view-transition-*` pseudo 驱动 clip-path 动画（copilot 关→ radial from theme button；copilot 开 → main R→L wipe + root 200ms fade）。Feature detect + `prefers-reduced-motion` fallback 到 `setTheme` 直接 snap（= 现状）。

**Tech Stack:** View Transitions API · next-themes · React 19 · CSS clip-path animations · vitest

---

## File Structure

**新增**：
- `src/lib/theme/apply.ts` — `applyThemeClass(next)` 纯函数，直接操作 `document.documentElement.classList`
- `src/lib/theme/__tests__/apply.test.ts` — 4 case 单测

**编辑**：
- `src/components/sidebar.tsx` — 加 `themeBtnRef`，`cycleTheme` 重构支持 view transitions
- `src/app/layout.tsx` — `<main>` 加 `viewTransitionName` inline style
- `src/app/globals.css` — 文末追加 Theme switch · View Transitions section

**文档**：
- `CHANGELOG.md` — 0.5.4 新条目
- `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md` §18.4 补一行"已在 0.5.4 落地"

---

## Task 1：`applyThemeClass` 纯函数 + 单测（TDD）

**Files:**
- Create: `src/lib/theme/apply.ts`
- Create: `src/lib/theme/__tests__/apply.test.ts`

- [ ] **Step 1.1：写失败测试**

写 `src/lib/theme/__tests__/apply.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyThemeClass } from "../apply"

describe("applyThemeClass", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
  })

  it("adds .dark when next=dark", () => {
    applyThemeClass("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("removes .dark when next=light", () => {
    document.documentElement.classList.add("dark")
    applyThemeClass("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("follows prefers-color-scheme dark when next=system", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    vi.unstubAllGlobals()
  })

  it("follows prefers-color-scheme light when next=system", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    document.documentElement.classList.add("dark")
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 1.2：验证失败**

Run: `npx vitest run src/lib/theme/__tests__/apply.test.ts`
Expected: FAIL with "Cannot find module '../apply'"

- [ ] **Step 1.3：写实现**

写 `src/lib/theme/apply.ts`：

```ts
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
```

- [ ] **Step 1.4：验证通过**

Run: `npx vitest run src/lib/theme/__tests__/apply.test.ts`
Expected: PASS 4/4

- [ ] **Step 1.5：commit**

```bash
git add src/lib/theme/apply.ts src/lib/theme/__tests__/apply.test.ts
git commit -m "feat(theme): add applyThemeClass helper for sync class toggle"
```

---

## Task 2：CSS view-transition rules + keyframes

**Files:**
- Modify: `src/app/globals.css`（文末 append）

- [ ] **Step 2.1：追加 Theme switch section**

在 `src/app/globals.css` 文末（`@media (prefers-reduced-motion: reduce) { .copilot-panel-enter { animation: none; } }` 之后，文件最末）append：

```css

/* ---------------- Theme switch · View Transitions ---------------- */

/* main 常驻命名：和 root 独立快照。copilot 开时 main 做 R→L wipe、root 做 chrome fade；
   copilot 关时 root 做 radial 扩散（main 的 pseudo 走 UA 默认但被 root 的动画覆盖看不出）。
   `view-transition-name` 只在实际 startViewTransition 时参与合成，平时无开销。 */
main {
  view-transition-name: main-content;
}

/* old 统一保持 opacity 1 不动——给 new 叠上来做"覆盖式"入场留底；
   默认 UA 行为是 old 淡出，会产生"两个主题并存"的中间帧观感差。 */
::view-transition-old(root),
::view-transition-old(main-content) {
  animation: none !important;
  opacity: 1;
}

/* copilot 关：root 径向扩散（main 的 pseudo 走 UA 默认，但被 root 的扩散覆盖在上层看不出）*/
html:not([data-copilot-open="true"]) ::view-transition-new(root) {
  animation: theme-radial-expand 700ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

/* copilot 开：main R→L wipe（700ms）；root（chrome 区：sidebar + copilot panel + overlays）快速 fade（200ms）*/
html[data-copilot-open="true"] ::view-transition-new(main-content) {
  animation: theme-wipe-rl 700ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
html[data-copilot-open="true"] ::view-transition-new(root) {
  animation: theme-fade-in 200ms ease-out both;
}

@keyframes theme-radial-expand {
  from {
    clip-path: circle(0 at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%));
  }
  to {
    clip-path: circle(150vmax at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%));
  }
}

@keyframes theme-wipe-rl {
  from { clip-path: inset(0 0 0 100%); }
  to   { clip-path: inset(0 0 0 0); }
}

@keyframes theme-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-new(root),
  ::view-transition-new(main-content) {
    animation: none !important;
  }
}
```

- [ ] **Step 2.2：验证 tsc 和 lint 通过**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.3：commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): add view-transitions CSS keyframes + pseudo-element rules"
```

---

## Task 3：`<main>` 命名 view-transition

**Files:**
- Modify: `src/app/layout.tsx:50`

- [ ] **Step 3.1：给 `<main>` 加 inline style**

打开 `src/app/layout.tsx`，定位到：

```tsx
<main className="flex-1 h-screen flex flex-col overflow-hidden relative">
```

改成：

```tsx
<main
  className="flex-1 h-screen flex flex-col overflow-hidden relative"
  style={{ viewTransitionName: "main-content" } as React.CSSProperties}
>
```

**注**：React 19 内置 `viewTransitionName` 在 `CSSProperties` 类型；`as` 是给老 TS 类型兜底，如果 tsc 无警告可以省掉。

- [ ] **Step 3.2：验证 tsc 通过**

```bash
npx tsc --noEmit
```

Expected: no errors

如果报错 "Object literal may only specify known properties, and 'viewTransitionName' does not exist in type 'CSSProperties'"，保留 `as React.CSSProperties`。

- [ ] **Step 3.3：commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(theme): name <main> as main-content for view-transitions"
```

---

## Task 4：`cycleTheme` 重构 + button ref

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 4.1：import + ref**

在 `src/components/sidebar.tsx` 顶部 import 区加：

```tsx
import { applyThemeClass, type ResolvableTheme } from "@/lib/theme/apply"
```

在 `Sidebar()` 函数体内，其他 useRef 附近加：

```tsx
const themeBtnRef = useRef<HTMLButtonElement>(null)
```

- [ ] **Step 4.2：重构 cycleTheme**

找到现有 `cycleTheme`（sidebar.tsx:40-44，定义 4 行）：

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

  const prefersReduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // Feature detect：不支持 API 或 a11y 要求 reduced motion → 现状 snap
  const docWithVT = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => unknown
  }
  if (prefersReduce || typeof document === "undefined" || !docWithVT.startViewTransition) {
    setTheme(next)
    return
  }

  // 写 origin 坐标给 radial keyframe 用（copilot 关时生效；开时 selector 不命中，无副作用）
  const rect = themeBtnRef.current?.getBoundingClientRect()
  if (rect) {
    document.documentElement.style.setProperty(
      "--theme-origin-x",
      `${rect.left + rect.width / 2}px`
    )
    document.documentElement.style.setProperty(
      "--theme-origin-y",
      `${rect.top + rect.height / 2}px`
    )
  }

  docWithVT.startViewTransition(() => {
    // 同步改 DOM：View Transitions 在 callback 返回后立即取新快照，
    // next-themes 的 className 应用走 useEffect 异步，快照抓不到——必须这里手动同步 toggle。
    applyThemeClass(next)
    // next-themes 更状态 + localStorage；它的 useEffect 之后会再 apply 同值，no-op。
    setTheme(next)
  })
}
```

- [ ] **Step 4.3：attach ref 到主题按钮**

sidebar.tsx 里找到渲染主题按钮的 `<button onClick={cycleTheme}>`（搜 `cycleTheme` 调用点 / `themeIcon` / `themeLabel`）。加 `ref={themeBtnRef}`：

```tsx
<button
  ref={themeBtnRef}
  onClick={cycleTheme}
  /* ... */
>
```

- [ ] **Step 4.4：验证 tsc + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors（lint 可能 continue-on-error，关注 tsc）

- [ ] **Step 4.5：commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(theme): wrap cycleTheme in document.startViewTransition with fallback"
```

---

## Task 5：手动端到端验证

**不跑测试**——本 task 是纯手工 smoke，`npm run dev` + 浏览器。

- [ ] **Step 5.1：启动 dev server**

```bash
npm run dev
```

打开 `http://localhost:3000`（若占用看 console 实际端口）。

- [ ] **Step 5.2：Chrome — copilot 关场景验证**

1. 确认 copilot 关闭（⌘K 可开/关）
2. 点 sidebar 底部主题按钮，观察切换动画：
   - 期望：700ms 径向扩散从按钮位置（sidebar 底部）铺满屏
3. 连续点 3 次（light → dark → system → light），观察：
   - 期望：每次都从按钮位置扩散；点得快时新动画替代旧动画，无重叠
4. 打开 DevTools → Rendering panel → "Emulate CSS media" → `prefers-reduced-motion: reduce`
5. 再切主题：
   - 期望：无动画，snap 切换

- [ ] **Step 5.3：Chrome — copilot 开场景验证**

1. 关掉 reduced-motion emulation
2. ⌘K 开 copilot
3. 等 reveal cascade 完全结束（~2.4s）
4. 切主题：
   - 期望：main 区（中间内容）R→L wipe 700ms；sidebar + copilot panel 200ms 快速淡入；整体无闪烁、无卡顿
5. 切 3 次观察一致性

- [ ] **Step 5.4：Safari 同步验证**

Safari 18+ 支持 View Transitions。走 Step 5.2 + 5.3 相同 checklist。

- [ ] **Step 5.5：Fallback 验证（可选）**

Firefox 127 以下或开发者设置手动关闭 view-transitions flag：切主题应直接 snap，无报错。

如果没有合适环境，跳过——`if (!docWithVT.startViewTransition)` 分支明显正确。

- [ ] **Step 5.6：如果任何场景有闪烁或卡顿**

1. 打开 DevTools Performance → record 切主题过程
2. 检查 "Long tasks" + paint flashes
3. 常见原因和修法：
   - `glow-overlay` 动画干扰：把 glow 放进 main（已经是）或 root 快照边界
   - `backdrop-filter` 元素的快照精度问题：可以尝试 `::view-transition-image-pair(main-content) { isolation: isolate; }`
   - 特定元素 `contain: layout style paint` 丢失

回到 Task 2 调整 CSS，不 revert 已 commit 的代码——按需加规则。

---

## Task 6：文档更新

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md:549`

- [ ] **Step 6.1：CHANGELOG 加 0.5.4 entry**

在 `CHANGELOG.md` 的 `## [Unreleased]` 行下方加：

```markdown
## [0.5.4] — 2026-04-30 · Theme switch cascade（View Transitions API）

v0.5.3 defer 的主题切换 cascade 重做——换到 View Transitions API，从机制上绕开"元素级 transition + delay"的 root cause。

### 体验

- **copilot 关**：从主题按钮位置径向扩散 700ms，`clip-path: circle()` 从按钮 center 涨到 150vmax
- **copilot 开**：`<main>` R→L wipe 700ms（和 reveal cascade 同方向）；sidebar + copilot panel 走 root 200ms opacity fade
- **原则**：old snapshot 不动（`animation: none; opacity: 1`），new snapshot 叠在上层 clip-path 逐渐覆盖

### 架构

- `src/lib/theme/apply.ts` 新增 `applyThemeClass(next)` —— 同步 toggle `html.classList`，镜像 next-themes 内部逻辑。给 `startViewTransition` callback 用，绕开 next-themes 的 useEffect 异步
- `src/components/sidebar.tsx` `cycleTheme` 重构：feature detect + `prefers-reduced-motion` fallback → `setTheme` snap；否则 `document.startViewTransition` wrap，callback 内同步 `applyThemeClass` + `setTheme`
- `src/app/layout.tsx` `<main>` 加 `viewTransitionName: "main-content"` 常驻命名
- `src/app/globals.css` 文末追加 Theme switch section：4 keyframes（radial-expand / wipe-rl / fade-in）+ pseudo-element rules by `html[data-copilot-open]` + reduced-motion 降级
- Origin 坐标（`--theme-origin-x/y`）由 JS 读按钮 getBoundingClientRect 写 html style，CSS keyframe `var(fallback 50% 50%)` 读取

### v0.5.3 失败到本方案的根因消除

| 问题 | v0.5.3 | 本方案 |
|---|---|---|
| Cleanup 闪烁 | `transition-property` 栈撤销补帧 | 无 element transition，pseudo 结束自动卸载 |
| Paint 风暴 | ~100 元素同时 transition | 2 个快照 blit，走 GPU 合成层 |
| `disableTransitionOnChange` 冲突 | 需要 element transition，但 next-themes 短暂禁掉 | 不依赖 element transition，正交 |

### 测试

- vitest: `applyThemeClass` 4 case（dark / light / system-prefers-dark / system-prefers-light）
- 手动 checklist: Chrome / Safari × copilot closed+open × 3 theme cycle + reduced-motion bypass
- E2E 不加（Playwright 对 View Transitions flaky）

### Fallback

浏览器不支持 `document.startViewTransition`（Firefox < 127 / 所有浏览器 reduced-motion 开启）→ 直接 `setTheme`，走现状 snap，无副作用。

- Spec: `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-theme-cascade.md`
```

- [ ] **Step 6.2：0.5.3 spec §18.4 更新**

打开 `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`。找到 §18.4 「不包含的改动（defer 到下版本）」那段（约 line 543-548）。在该 section 结尾（"本次完全 revert，下版本专题（可能从 CSS animation 或 mask-wipe 方向重做）" 之后）追加：

```markdown

**Update 2026-04-30**：已在 0.5.4 落地，走 View Transitions API 方案（不是 CSS animation 也不是 mask-wipe），见 `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`。
```

- [ ] **Step 6.3：commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md
git commit -m "docs: changelog + spec update for 0.5.4 theme cascade"
```

---

## Task 7：完整本地校验

在合并或开 PR 前最后一轮校验。

- [ ] **Step 7.1：tsc + test + build**

```bash
npx tsc --noEmit && npm test && npm run build
```

Expected:
- tsc: no errors
- test: 所有 test 绿（含本次新增 4 case）
- build: 成功

- [ ] **Step 7.2：git log 审阅**

```bash
git log --oneline main..HEAD
```

Expected: 6 个 commit（Task 1 + 2 + 3 + 4 + 6 × 2）。

- [ ] **Step 7.3：diff 自审**

```bash
git diff main..HEAD --stat
```

Expected 文件（限定在本 spec scope 内）：
- `CHANGELOG.md`（+entry）
- `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`（+一行 update 标记）
- `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`（新建，即本 spec）
- `docs/superpowers/plans/2026-04-30-theme-cascade.md`（新建，即本 plan）
- `src/app/globals.css`（+1 section）
- `src/app/layout.tsx`（+2 行 inline style）
- `src/components/sidebar.tsx`（+import, +ref, cycleTheme refactor）
- `src/lib/theme/apply.ts`（新建）
- `src/lib/theme/__tests__/apply.test.ts`（新建）

- [ ] **Step 7.4：没有意外文件改动**

检查不要改到：
- `src/components/copilot/material-reveal-overlay.tsx`（reveal cascade 逻辑无关）
- `src/app/layout.tsx` 中的 `ThemeProvider disableTransitionOnChange` 保留
- `package.json` / `package-lock.json`（不引入新依赖）

如有意外改动，revert 掉再 commit 一次。

---

## 风险和 fallback

| 风险 | 可能性 | 处理 |
|---|---|---|
| `startViewTransition` 在 React 19 + Next.js 16 里意外行为 | 低 | 功能测试覆盖；fallback 自动起效 |
| `viewTransitionName` 类型不识别 | 中（老 TS 版本） | Step 3.1 的 `as React.CSSProperties` 兜底 |
| Firefox 低版本 fallback 后视觉突兀 | 低 | Fallback = 现状，用户已经见过 |
| `next-themes` 内部实现变化后手动 toggle 和其 useEffect 竞争 | 低 | 两者最终都写同值，结果一致；如果出现差异，测试 Step 5 会暴露 |
| `clip-path: circle(150vmax)` 在视口超宽时不够覆盖 | 极低 | 150vmax 够 sqrt(2) * 100vmax 需求；出问题再调 200vmax |
| `backdrop-filter` 元素快照精度 | 低 | 视觉看不出；出问题在 Step 5.6 加 `isolation: isolate` |

## 成功标准

- ✅ vitest 213+ case 绿（209 基数 + 4 新增）
- ✅ `npx tsc --noEmit` clean
- ✅ `npm run build` 成功
- ✅ Chrome / Safari 手动 smoke 全通过（closed + open × 3 切换）
- ✅ `prefers-reduced-motion: reduce` 降级到 snap
- ✅ 无闪烁、无卡顿（不满足直接回到 Task 5.6 诊断）
- ✅ Git history 清晰：每 task 独立 commit
