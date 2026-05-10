# Copilot Glass System Implementation Plan

> **Status (2026-04-28): ✅ 全部 12 task + 首轮验证后的 5 处调整均已落地。** 见文末 §"首轮验证后的调整"以及 spec §12。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate copilot-mode UI from ad-hoc shell mixing to a unified 4-tier glass system (Thin / Regular / Thick / Tinted), eliminating the material inconsistencies identified in the design spec.

**Architecture:** Extend `src/components/copilot/shell.tsx` to expose 4 glass components driven by a single `useGlassStyle(variant)` hook. Replace all call sites of the legacy `CopilotShell` / `GlassSurface` with the new components, and migrate shadcn `Card` wrappers at specific locations to the glass equivalents. Overlay components (Dialog / Popover / DropdownMenu) get content-layer glass injected via className override. Copilot-off state falls through to shadcn defaults unchanged.

**Tech Stack:** Next.js 16 / React 19 / Tailwind CSS v4 / shadcn ui v4 / base-ui / CSS `backdrop-filter` / CSS `@media (prefers-*)` queries / vitest.

**Spec:** `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`

---

## File Structure Map

| File | Role | Change |
|---|---|---|
| `src/components/copilot/shell.tsx` | Glass style hook + components | Rewrite: 4 variants (thin/regular/thick/tinted) + 4 components (`GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted`). Remove old `CopilotShell`, `GlassSurface` names. |
| `src/components/copilot/__tests__/shell.test.ts` | Unit test (NEW) | Assert each variant emits correct CSS when copilot open/closed. |
| `src/app/globals.css` | Keyframes + a11y | Add `prefers-reduced-transparency` / `prefers-contrast` / `prefers-reduced-motion` fallbacks. Add `copilot-press-squish` + `copilot-hover-lift` + `copilot-scroll-edge` utilities. |
| `src/components/ui/button.tsx` | Add `tinted` variant | Add one variant entry that pulls glass via data attribute (driven by outer wrapper or direct style). |
| `src/app/page.tsx` | Dashboard | `ExperimentCard` outer `<Card>` → `<GlassRegular>`. Remove `bg-card` / `ring` duplication. |
| `src/app/experiments/new/page.tsx` | New experiment form | `CopilotShell` → `GlassRegular`. Primary CTA `Button` → `variant="tinted"`. |
| `src/app/compare/page.tsx` | Compare page | Outer `CopilotShell` → `GlassRegular`. Sticky header `GlassSurface` → `GlassThin` + scroll-edge mask. Inner cell `<Card>` → `<GlassThin>`. |
| `src/app/settings/layout.tsx` | Settings layout | `CopilotShell` → `GlassRegular`. |
| `src/app/settings/datasets/page.tsx` | Datasets list | List card `<Card>` → `<GlassRegular>`. |
| `src/app/settings/templates/page.tsx` | Templates list | Same treatment. |
| `src/app/settings/rubrics/page.tsx` | Rubrics list | Same treatment. |
| `src/app/settings/displays/page.tsx` | Displays list | Same treatment. |
| `src/components/settings/relation-diagram.tsx` | Relation tabs | Active tab → tinted glass style. |
| `src/app/experiments/[id]/page.tsx` | Experiment detail | Outer `CopilotShell` → `GlassRegular`. Inner Cards (Progress / Scoring / FailedPanel / result rows) → `<GlassRegular>`. |
| `src/components/sidebar.tsx` | Sidebar | Mount `GlassThin` style when copilot open. |
| `src/components/ui/sticky-save-bar.tsx` | Sticky save bar | `GlassSurface` → `GlassThin` + scroll-edge mask. |
| `src/components/copilot/panel.tsx` | Copilot panel | Background → `GlassThick`. |
| `src/components/copilot/chat-view.tsx` | Chat view send button | Use `variant="tinted"` on send button. Replace any remaining `CopilotShell` / `GlassSurface` references. |
| `src/components/ui/dialog.tsx` | Dialog overlay | `DialogContent` class + style: glass-thick when copilot open. |
| `src/components/ui/popover.tsx` | Popover overlay | Content → glass-thick when copilot open. |
| `src/components/ui/dropdown-menu.tsx` | DropdownMenu overlay | Content → glass-thick when copilot open. |

---

### Task 1: Extend `shell.tsx` to 4-tier glass API

**Files:**
- Create: `src/components/copilot/__tests__/shell.test.tsx`
- Modify: `src/components/copilot/shell.tsx` (rewrite entirely)

- [ ] **Step 1: Write the failing test**

Create `src/components/copilot/__tests__/shell.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useGlassStyle } from "../shell"
import * as storeModule from "../store"

function mockStoreOpen(open: boolean) {
  vi.spyOn(storeModule, "useCopilotStore").mockReturnValue({
    open,
    setOpen: vi.fn(),
    toggleOpen: vi.fn(),
    width: 420,
    setWidth: vi.fn(),
    activeSessionId: undefined,
    setActiveSessionId: vi.fn(),
    mounted: true,
    inspectorActive: false,
    setInspectorActive: vi.fn(),
    contexts: [],
    addContext: vi.fn(),
    removeContext: vi.fn(),
    clearContexts: vi.fn(),
    busy: false,
    setBusy: vi.fn(),
  })
}

describe("useGlassStyle", () => {
  it("returns transparent transition-only style when copilot closed", () => {
    mockStoreOpen(false)
    const { result } = renderHook(() => useGlassStyle("regular"))
    expect(result.current.backdropFilter).toBeUndefined()
    expect(result.current.backgroundColor).toBeUndefined()
    expect(result.current.transition).toContain("background-color")
  })

  it("thin variant: blur 16px, transparent background", () => {
    mockStoreOpen(true)
    const { result } = renderHook(() => useGlassStyle("thin"))
    expect(result.current.backdropFilter).toContain("blur(16px)")
    expect(result.current.backgroundColor).toBe("transparent")
  })

  it("regular variant: blur 28px, ~35% card bg", () => {
    mockStoreOpen(true)
    const { result } = renderHook(() => useGlassStyle("regular"))
    expect(result.current.backdropFilter).toContain("blur(28px)")
    expect(result.current.backgroundColor).toContain("var(--card) 35%")
  })

  it("thick variant: blur 40px, ~55% card bg, heavier shadow", () => {
    mockStoreOpen(true)
    const { result } = renderHook(() => useGlassStyle("thick"))
    expect(result.current.backdropFilter).toContain("blur(40px)")
    expect(result.current.backgroundColor).toContain("var(--card) 55%")
    expect(result.current.boxShadow).toContain("30px")
  })

  it("tinted variant: blur 28px with primary color-mix overlay", () => {
    mockStoreOpen(true)
    const { result } = renderHook(() => useGlassStyle("tinted"))
    expect(result.current.backdropFilter).toContain("blur(28px)")
    expect(result.current.backgroundImage).toContain("var(--primary)")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Command: `npm test -- shell.test`
Expected: FAIL — `useGlassStyle` signature mismatch or assertion failures on `thin`/`tinted` variants (old code only supports `"shell" | "surface"`).

- [ ] **Step 3: Install @testing-library/react if missing**

```bash
cd /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval
npm ls @testing-library/react 2>&1 | head -5
```

If not installed, run: `npm install --save-dev @testing-library/react @testing-library/dom`

- [ ] **Step 4: Rewrite shell.tsx with 4-variant API**

Overwrite `src/components/copilot/shell.tsx` with:

```tsx
"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotStore } from "./store"

export type GlassVariant = "thin" | "regular" | "thick" | "tinted"

/**
 * Copilot 玻璃梯度系统 4 档：
 * - thin     — chrome / sticky / 数据单元格（blur 16, bg transparent）
 * - regular  — 页面主外壳 + 内容卡（blur 28, bg 35% card）
 * - thick    — 浮层 / copilot panel / dialog（blur 40, bg 55% card, 更重阴影）
 * - tinted   — primary CTA / active tab（blur 28, bg 35% card + primary 染色）
 *
 * copilot 关闭时返回 transition-only style，让外部 className 的 bg-card/bg-background 原样工作。
 *
 * 为什么全 inline style：Tailwind v4 / LightningCSS 会把自由规则塞回 @layer base 并吃掉
 * !important + backdrop-filter，utilities 层 bg-card 稳赢。只有 inline style 能穿透。
 */
export function useGlassStyle(variant: GlassVariant = "regular"): CSSProperties {
  const { open } = useCopilotStore()

  const baseTransition =
    "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

  if (!open) {
    return { transition: baseTransition }
  }

  if (variant === "thin") {
    return {
      backgroundColor: "transparent",
      backdropFilter: "blur(16px) saturate(1.2)",
      WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
      transition: baseTransition,
    }
  }

  if (variant === "thick") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 55%, transparent)",
      backdropFilter: "blur(40px) saturate(1.3)",
      WebkitBackdropFilter: "blur(40px) saturate(1.3)",
      borderColor: "color-mix(in oklab, var(--border) 60%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.7), inset 0 -1px 0 oklch(1 0 0 / 0.15), inset 0 0 0 1px oklch(1 0 0 / 0.12), 0 30px 60px -15px oklch(0 0 0 / 0.32), 0 6px 16px -8px oklch(0 0 0 / 0.12)",
      transition: baseTransition,
    }
  }

  if (variant === "tinted") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backgroundImage:
        "linear-gradient(color-mix(in oklab, var(--primary) 28%, transparent), color-mix(in oklab, var(--primary) 28%, transparent))",
      backdropFilter: "blur(28px) saturate(1.3)",
      WebkitBackdropFilter: "blur(28px) saturate(1.3)",
      borderColor: "color-mix(in oklab, var(--primary) 40%, transparent)",
      boxShadow:
        "inset 0 1px 0 oklch(1 0 0 / 0.55), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 20px 50px -20px oklch(0 0 0 / 0.22), 0 4px 12px -6px oklch(0 0 0 / 0.08)",
      transition: baseTransition,
    }
  }

  // regular (default)
  return {
    backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
    backdropFilter: "blur(28px) saturate(1.25)",
    WebkitBackdropFilter: "blur(28px) saturate(1.25)",
    borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
    boxShadow:
      "inset 0 1px 0 oklch(1 0 0 / 0.6), inset 0 -1px 0 oklch(1 0 0 / 0.1), inset 0 0 0 1px oklch(1 0 0 / 0.1), 0 20px 50px -20px oklch(0 0 0 / 0.22), 0 4px 12px -6px oklch(0 0 0 / 0.08)",
    transition: baseTransition,
  }
}

interface GlassProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "main" | "header" | "article" | "aside" | "nav"
}

function makeGlass(variant: GlassVariant, defaultClass: string) {
  return function Glass({ children, className = "", style, as: Tag = "div" }: GlassProps) {
    const glass = useGlassStyle(variant)
    return (
      <Tag className={`${defaultClass} ${className}`} style={{ ...glass, ...style }}>
        {children}
      </Tag>
    )
  }
}

export const GlassThin = makeGlass("thin", "")
export const GlassRegular = makeGlass("regular", "rounded-xl border bg-card")
export const GlassThick = makeGlass("thick", "rounded-xl border bg-card")
export const GlassTinted = makeGlass("tinted", "rounded-xl border bg-card")

// Backward-compat aliases (to be removed once all call sites migrate)
export const CopilotShell = GlassRegular
export const GlassSurface = GlassThin
```

- [ ] **Step 5: Run test to verify it passes**

Command: `npm test -- shell.test`
Expected: PASS — all 5 cases green.

- [ ] **Step 6: Run full test suite to ensure no regression**

Command: `npm test`
Expected: 156 tests pass (151 existing + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/components/copilot/shell.tsx src/components/copilot/__tests__/shell.test.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): extend glass shell to 4-tier system (Thin/Regular/Thick/Tinted)

Adds tier variants per design spec. Legacy CopilotShell / GlassSurface
kept as aliases for backward compat during migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add a11y media queries + interactive keyframes to `globals.css`

**Files:**
- Modify: `src/app/globals.css` (append to end of file)

- [ ] **Step 1: Append a11y + interactive CSS block**

Read the end of `src/app/globals.css` with `Read`, then append:

```css
/* ---------------- Copilot Glass · Accessibility fallbacks ---------------- */

@media (prefers-reduced-transparency: reduce) {
  html[data-copilot-open="true"] [data-glass-variant] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background-color: var(--card) !important;
    background-image: none !important;
  }
}

@media (prefers-contrast: more) {
  html[data-copilot-open="true"] [data-glass-variant] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background-color: var(--card) !important;
    background-image: none !important;
    border-color: var(--foreground) !important;
    border-width: 1.5px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .copilot-press-squish,
  .copilot-hover-lift,
  .copilot-scroll-edge-top,
  .copilot-scroll-edge-bottom {
    transition: none !important;
    animation: none !important;
  }
}

/* ---------------- Copilot Glass · Interactive states ---------------- */

.copilot-press-squish {
  transition: transform 150ms ease-out, backdrop-filter 150ms ease-out;
}
.copilot-press-squish:active {
  transform: scale(0.98);
}

.copilot-hover-lift {
  transition: transform 200ms ease, box-shadow 200ms ease, backdrop-filter 200ms ease;
}
@media (hover: hover) {
  html[data-copilot-open="true"] .copilot-hover-lift:hover {
    transform: translateY(-1px);
  }
}

/* 用于 sticky 表头 / 吸底条下方 8–24px mask gradient 软边 */
.copilot-scroll-edge-bottom {
  mask-image: linear-gradient(to bottom, black calc(100% - 16px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 16px), transparent 100%);
}
.copilot-scroll-edge-top {
  mask-image: linear-gradient(to top, black calc(100% - 16px), transparent 100%);
  -webkit-mask-image: linear-gradient(to top, black calc(100% - 16px), transparent 100%);
}
```

- [ ] **Step 2: Start dev server + verify no CSS parse error**

```bash
lsof -i :3013 -t > /dev/null 2>&1 || npm run dev &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3013/
```

Expected: `200`.

- [ ] **Step 3: Run full test suite**

Command: `npm test`
Expected: still green (no tests for CSS).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(copilot): add glass-tier a11y fallbacks + interactive keyframes

prefers-reduced-transparency / prefers-contrast: more / prefers-reduced-motion
downgrade glass to solid surface per HIG. Adds press-squish / hover-lift /
scroll-edge utility classes for interactive state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `tinted` variant to Button component

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Update button.tsx to support tinted variant**

In `buttonVariants` config, add a new entry under `variants.variant`:

```ts
tinted:
  "text-primary-foreground data-[copilot-tinted=on]:[&]:shadow-[inset_0_1px_0_oklch(1_0_0_/_0.55),_0_20px_50px_-20px_oklch(0_0_0_/_0.22)] bg-primary data-[copilot-tinted=on]:bg-transparent hover:bg-primary/80",
```

Then update the `Button` function to wrap with a `useGlassStyle("tinted")` consumer when `variant === "tinted"` and copilot is open:

```tsx
import { useGlassStyle } from "@/copilot/components/shell"
import { useCopilotStore } from "@/copilot/components/store"

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const { open: copilotOpen } = useCopilotStore()
  const isTinted = variant === "tinted"
  const glassStyle = useGlassStyle("tinted")
  const applyGlass = isTinted && copilotOpen
  return (
    <ButtonPrimitive
      data-slot="button"
      data-copilot-tinted={applyGlass ? "on" : undefined}
      data-glass-variant={applyGlass ? "tinted" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      style={applyGlass ? glassStyle : undefined}
      {...props}
    />
  )
}
```

**Why `data-copilot-tinted=on` toggle**: when copilot is closed, button keeps solid `bg-primary`. When open, bg becomes transparent so glass style can drive the visible surface.

- [ ] **Step 2: Typecheck**

Command: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run tests**

Command: `npm test`
Expected: still green.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add tinted variant to Button for copilot glass system

When copilot is open, tinted buttons render with glass + primary-color overlay.
When closed, fall back to solid bg-primary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dashboard — migrate ExperimentCard to `GlassRegular`

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Import GlassRegular + replace Card outer**

In `src/app/page.tsx`:

Add import:
```ts
import { GlassRegular } from "@/copilot/components/shell"
```

Replace the `ExperimentCard` return block. Find:
```tsx
return (
    <Card
      data-copilot-context="experiment"
      data-copilot-context-id={exp.id}
      data-copilot-context-summary={`${exp.name} · ${exp.model}`}
      className="group transition-colors hover:border-foreground/30 h-full"
    >
```

Replace with:
```tsx
return (
    <GlassRegular
      data-glass-variant="regular"
      data-copilot-context="experiment"
      data-copilot-context-id={exp.id}
      data-copilot-context-summary={`${exp.name} · ${exp.model}`}
      className="group transition-colors hover:border-foreground/30 h-full flex flex-col gap-4 py-4 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden"
    >
```

Note: `GlassRegular` already includes `rounded-xl border bg-card` base, but we need to preserve Card's `flex flex-col gap-4 py-4 text-card-foreground ring-1 ring-foreground/10 overflow-hidden` visuals that Card provided.

Close tag: change `</Card>` → `</GlassRegular>`.

- [ ] **Step 2: Add data-glass-variant prop support to GlassRegular**

Re-check `shell.tsx` `makeGlass` function — it currently does not forward arbitrary props to the underlying element. Fix:

Modify `makeGlass` in `shell.tsx`:

```tsx
type GlassProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "main" | "header" | "article" | "aside" | "nav"
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "style" | "children">

function makeGlass(variant: GlassVariant, defaultClass: string) {
  return function Glass({ children, className = "", style, as: Tag = "div", ...rest }: GlassProps) {
    const glass = useGlassStyle(variant)
    return (
      <Tag
        data-glass-variant={variant}
        className={`${defaultClass} ${className}`}
        style={{ ...glass, ...style }}
        {...rest}
      >
        {children}
      </Tag>
    )
  }
}
```

Now all GlassX components forward unknown props (including `data-copilot-context-*`) and auto-set `data-glass-variant` for the a11y media query selector.

Remove the duplicate `data-glass-variant="regular"` from the page.tsx change in Step 1.

- [ ] **Step 3: Verify page renders**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3013/
```

Expected: `200`. Open `http://localhost:3013/` in browser, toggle copilot with ⌘K, confirm cards glass when open + solid when closed.

- [ ] **Step 4: Run tests + typecheck**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/copilot/shell.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): migrate ExperimentCard to GlassRegular

Cards are now Regular glass when copilot open, solid when closed.
Resolves "dashboard 卡片是白的" inconsistency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/experiments/new` — rename to `GlassRegular` + tinted primary CTA

**Files:**
- Modify: `src/app/experiments/new/page.tsx`

- [ ] **Step 1: Swap CopilotShell → GlassRegular**

In `src/app/experiments/new/page.tsx`:

Replace:
```ts
import { CopilotShell } from "@/copilot/components/shell"
```

With:
```ts
import { GlassRegular } from "@/copilot/components/shell"
```

Replace `<CopilotShell className="p-6 space-y-0">` → `<GlassRegular className="p-6 space-y-0">`.
Replace `</CopilotShell>` → `</GlassRegular>`.

- [ ] **Step 2: Make primary CTA tinted**

Find (near line 295):
```tsx
<Button onClick={() => handleSubmit(true)} disabled={submitting}>
  {submitting ? t("experiment.new.submitting") : t("experiment.new.save_run")}
</Button>
```

Replace with:
```tsx
<Button variant="tinted" onClick={() => handleSubmit(true)} disabled={submitting}>
  {submitting ? t("experiment.new.submitting") : t("experiment.new.save_run")}
</Button>
```

- [ ] **Step 3: Visual verify**

Open `http://localhost:3013/experiments/new` in browser, toggle copilot. Confirm:
- Outer form = glass regular when open
- "保存并运行" / Save & Run button = tinted glass with primary overlay when open
- "保存草稿" button stays outline (unchanged)

- [ ] **Step 4: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 5: Commit**

```bash
git add src/app/experiments/new/page.tsx
git commit -m "$(cat <<'EOF'
feat(experiments/new): glass-regular shell + tinted save-run CTA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/compare` — outer Regular + sticky Thin + cells Thin + scroll-edge

**Files:**
- Modify: `src/app/compare/page.tsx`

- [ ] **Step 1: Update imports**

Replace:
```ts
import { CopilotShell, GlassSurface } from "@/copilot/components/shell"
```

With:
```ts
import { GlassRegular, GlassThin } from "@/copilot/components/shell"
```

- [ ] **Step 2: Swap outer shell**

Replace `<CopilotShell className="p-6 h-full flex flex-col">` → `<GlassRegular className="p-6 h-full flex flex-col">`.
Replace `</CopilotShell>` → `</GlassRegular>`.

- [ ] **Step 3: Swap sticky header + add scroll-edge**

Find:
```tsx
<GlassSurface
  className="col-span-full grid gap-3 sticky top-0 z-10 bg-background pb-3 border-b border-border"
  style={{ gridTemplateColumns: "subgrid" }}
>
```

Replace with:
```tsx
<GlassThin
  className="col-span-full grid gap-3 sticky top-0 z-10 pb-3 border-b border-border copilot-scroll-edge-bottom"
  style={{ gridTemplateColumns: "subgrid" }}
>
```

Remove the `bg-background` utility — GlassThin provides transparent-with-blur.
Close tag: `</GlassSurface>` → `</GlassThin>`.

- [ ] **Step 4: Swap inner cell Card → GlassThin**

Find the cell `<Card>` block:
```tsx
<Card
  key={expId}
  className={`p-3 ${result.status !== "success" ? "border-red-200 bg-red-50" : ""}`}
  data-copilot-context="task_result"
  data-copilot-context-id={result.task_id}
  data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id })}
  data-copilot-context-summary={row.label}
>
```

Replace with:
```tsx
<GlassThin
  key={expId}
  className={`p-3 rounded-lg border ${result.status !== "success" ? "border-red-200 bg-red-50" : ""}`}
  data-copilot-context="task_result"
  data-copilot-context-id={result.task_id}
  data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id })}
  data-copilot-context-summary={row.label}
>
```

Close: `</Card>` → `</GlassThin>`.

Note: `GlassThin` has no default class, so we add `rounded-lg border` explicitly. Failure state keeps its `bg-red-50` override (solid on failure — error > ritual).

- [ ] **Step 5: Remove now-unused Card import**

Remove `Card` from the import line at top of file if no other usages remain. Check with grep:

```bash
grep -n "Card" /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src/app/compare/page.tsx | head
```

If Card only appeared in the replaced block, remove from imports.

- [ ] **Step 6: Visual verify**

Open `http://localhost:3013/compare`, select 2 experiments, toggle copilot:
- Outer shell = Regular glass (thicker, with shadow)
- Sticky header = Thin glass (pure blur, no bg) + soft mask at bottom
- Inner cells = Thin glass
- Hierarchy reads: outer "container" > cells "data islands" > header "ephemeral chrome"

- [ ] **Step 7: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 8: Commit**

```bash
git add src/app/compare/page.tsx
git commit -m "$(cat <<'EOF'
feat(compare): 3-tier glass migration — outer Regular / sticky Thin / cells Thin

Sticky header gets scroll-edge mask so content fades as it scrolls under.
Cells drop to Thin per spec's table-cell anti-refraction rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Settings — layout + 4 list pages + RelationDiagram active tab

**Files:**
- Modify: `src/app/settings/layout.tsx`
- Modify: `src/app/settings/datasets/page.tsx`
- Modify: `src/app/settings/templates/page.tsx`
- Modify: `src/app/settings/rubrics/page.tsx`
- Modify: `src/app/settings/displays/page.tsx`
- Modify: `src/components/settings/relation-diagram.tsx`

- [ ] **Step 1: settings/layout.tsx → GlassRegular**

Replace `import { CopilotShell } from "@/copilot/components/shell"` with `import { GlassRegular } from "@/copilot/components/shell"`.
Replace `<CopilotShell className="p-6">` with `<GlassRegular className="p-6">`.
Replace `</CopilotShell>` with `</GlassRegular>`.

- [ ] **Step 2: datasets list page — Card → GlassRegular**

In `src/app/settings/datasets/page.tsx`:

Add import: `import { GlassRegular } from "@/copilot/components/shell"`.

Find:
```tsx
<Card className="transition-colors hover:border-foreground/30 hover:bg-muted/20 h-full">
```

Replace with:
```tsx
<GlassRegular className="transition-colors hover:border-foreground/30 hover:bg-muted/20 h-full flex flex-col gap-4 py-4 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden">
```

Close: `</Card>` → `</GlassRegular>`.

Remove `Card` from import line if unused after change.

- [ ] **Step 3: Read templates/rubrics/displays list pages, apply same pattern**

Read each file:

```bash
ls /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src/app/settings/templates/page.tsx \
   /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src/app/settings/rubrics/page.tsx \
   /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src/app/settings/displays/page.tsx
```

For each: import `GlassRegular`, replace `<Card className="...">` on list items with `<GlassRegular className="... flex flex-col gap-4 py-4 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden">`, close tag likewise. If that page has no list Card or uses a shared subcomponent, skip and log in comment.

- [ ] **Step 4: RelationDiagram active tab → tinted**

Read `src/components/settings/relation-diagram.tsx`. Find the tab button render function (search for "active" or the click handler that sets current tab).

For the button rendered as "active / selected", apply:
```tsx
import { useGlassStyle } from "@/copilot/components/shell"
import { useCopilotStore } from "@/copilot/components/store"

// inside component:
const { open: copilotOpen } = useCopilotStore()
const tintedStyle = useGlassStyle("tinted")

// on the active tab button:
style={isActive && copilotOpen ? tintedStyle : undefined}
data-glass-variant={isActive && copilotOpen ? "tinted" : undefined}
```

Exact merge depends on the component's existing render. Keep all current behavior intact, only augment active state.

- [ ] **Step 5: Visual verify**

Open `http://localhost:3013/settings/datasets`, toggle copilot. Confirm:
- Outer settings shell = glass regular
- Each dataset card = glass regular (same tier as outer — parallel, not nested)
- Active tab in RelationDiagram = tinted glass with primary color

Repeat for `/settings/templates`, `/settings/rubrics`, `/settings/displays`.

- [ ] **Step 6: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings/ src/components/settings/relation-diagram.tsx
git commit -m "$(cat <<'EOF'
feat(settings): glass migration — layout Regular, list cards Regular, active tab Tinted

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `/experiments/[id]` — outer + inner cards

**Files:**
- Modify: `src/app/experiments/[id]/page.tsx`

- [ ] **Step 1: Update imports**

Replace `import { CopilotShell } from "@/copilot/components/shell"` with `import { GlassRegular } from "@/copilot/components/shell"`.

- [ ] **Step 2: Swap outer shell**

Find all `<CopilotShell` and `</CopilotShell>` in the file and replace with `<GlassRegular` / `</GlassRegular>`.

Check:
```bash
grep -n "CopilotShell\|GlassSurface" /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src/app/experiments/\[id\]/page.tsx
```

After replacement, re-grep to confirm zero matches.

- [ ] **Step 3: Migrate inner cards**

Read the full file. For each `<Card` instance that renders:
- Progress section card
- Scoring card
- FailedPanel collapsible card
- Result row cards

Replace `<Card className="...">` with `<GlassRegular className="... flex flex-col gap-4 py-4 text-sm text-card-foreground ring-1 ring-foreground/10 overflow-hidden">`.
Replace `</Card>` with `</GlassRegular>`.

Keep `CardHeader` / `CardContent` / `CardTitle` subcomponents unchanged — they're structural, not surface.

Note: This may be many Card replacements. Do each carefully — check the className on each for special variants (e.g. red-200 for error states) and preserve them.

- [ ] **Step 4: Remove unused Card import**

After replacements, if only `Card` subcomponents remain (`CardHeader`, `CardContent`, `CardTitle`), keep those imports but drop `Card`.

- [ ] **Step 5: Visual verify**

Open `http://localhost:3013/experiments/<any-existing-id>`, toggle copilot. Confirm outer + all inner cards are Regular glass.

- [ ] **Step 6: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 7: Commit**

```bash
git add "src/app/experiments/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(experiments/detail): glass-regular for outer shell + all inner cards

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Chrome layer — sidebar + StickySaveBar

**Files:**
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/ui/sticky-save-bar.tsx`

- [ ] **Step 1: Sidebar — mount GlassThin when copilot open**

Read `src/components/sidebar.tsx`. Find the top-level `<aside>` / `<nav>` element. Add:

```tsx
import { useGlassStyle } from "@/copilot/components/shell"
// inside component:
const glass = useGlassStyle("thin")

// on the root element:
style={{ ...glass, ...existingStyleIfAny }}
data-glass-variant="thin"
```

Keep all other sidebar styling intact. When copilot is closed, `glass` is a transition-only CSSProperties object, so existing Tailwind `bg-card` / `bg-background` drives the surface. When open, inline style overrides to thin glass.

- [ ] **Step 2: StickySaveBar — GlassSurface → GlassThin + scroll-edge**

In `src/components/ui/sticky-save-bar.tsx`:

Replace import:
```ts
import { GlassSurface } from "@/copilot/components/shell"
```
→
```ts
import { GlassThin } from "@/copilot/components/shell"
```

Replace `<GlassSurface` → `<GlassThin`. Add `copilot-scroll-edge-top` utility to its className. Replace `</GlassSurface>` → `</GlassThin>`.

- [ ] **Step 3: Visual verify**

With copilot open, scroll any long page (e.g. `/experiments/new`). Sticky save bar should have soft mask at top edge as content scrolls under. Sidebar should have pure blur with no tint.

- [ ] **Step 4: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/ui/sticky-save-bar.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): sidebar + sticky save bar migrated to GlassThin with scroll-edge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Copilot panel → GlassThick + chat-view send button tinted

**Files:**
- Modify: `src/components/copilot/panel.tsx`
- Modify: `src/components/copilot/chat-view.tsx`

- [ ] **Step 1: Panel → GlassThick**

Read `src/components/copilot/panel.tsx`. Find the panel root element (usually has `fixed right-0` or similar). Find whatever backdrop-filter / bg style is currently applied. Replace inline bg + backdrop-filter with:

```tsx
import { useGlassStyle } from "@/copilot/components/shell"
// inside component:
const glass = useGlassStyle("thick")

// on panel root:
style={{ ...glass, ...existingPositioning }}
data-glass-variant="thick"
```

Remove any existing bg-card / backdrop-filter that conflicts. Preserve width / position / z-index styles.

- [ ] **Step 2: Chat-view — send button tinted**

In `src/components/copilot/chat-view.tsx`, locate the send button. Typical pattern:

```tsx
<Button onClick={handleSend} disabled={!canSend}>
  Send <kbd>⌘↵</kbd>
</Button>
```

Replace with:
```tsx
<Button variant="tinted" onClick={handleSend} disabled={!canSend}>
  Send <kbd>⌘↵</kbd>
</Button>
```

Also audit chat-view for any remaining `CopilotShell` / `GlassSurface` usage. If any, rename to `GlassRegular` / `GlassThin`.

- [ ] **Step 3: Visual verify**

Open `http://localhost:3013/`, open copilot with ⌘K. Confirm:
- Panel has thicker glass + stronger shadow than page content
- Send button = tinted glass with primary overlay
- Hierarchy reads: page Regular < panel Thick < send button Tinted (accent)

- [ ] **Step 4: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/panel.tsx src/components/copilot/chat-view.tsx
git commit -m "$(cat <<'EOF'
feat(copilot): panel GlassThick + send button tinted

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Overlay layer — Dialog / Popover / DropdownMenu content glass

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/popover.tsx`
- Modify: `src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1: Dialog content — inject GlassThick style when copilot open**

Read `src/components/ui/dialog.tsx`. Find the `DialogContent` (or equivalent) component render. Add:

```tsx
import { useGlassStyle } from "@/copilot/components/shell"

// inside DialogContent:
const glass = useGlassStyle("thick")

// on the content element:
style={{ ...glass, ...propsStyle }}
data-glass-variant="thick"
```

Keep existing class + structural styling. Remove conflicting `bg-popover` / `bg-background` only if it's a direct surface conflict.

- [ ] **Step 2: Popover content — same treatment**

Read `src/components/ui/popover.tsx`. Apply identical pattern to `PopoverContent`.

- [ ] **Step 3: DropdownMenu content — same treatment**

Read `src/components/ui/dropdown-menu.tsx`. Apply identical pattern to `DropdownMenuContent`.

- [ ] **Step 4: Visual verify**

With copilot open:
- Open any dropdown (e.g. dashboard schema filter) — content should be thick glass
- Open any popover (e.g. PromptInfoIcon in compare page header) — same
- Trigger any dialog (e.g. delete confirmation) — same

- [ ] **Step 5: Typecheck + tests**

```bash
npx tsc --noEmit
npm test
```

Both expected green.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/popover.tsx src/components/ui/dropdown-menu.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Dialog / Popover / DropdownMenu content → GlassThick when copilot open

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Verification pass — smoke all pages + a11y media queries + remove legacy aliases

**Files:**
- Modify: `src/components/copilot/shell.tsx` (remove backward-compat aliases)

- [ ] **Step 1: Grep for any remaining legacy references**

```bash
grep -rn "CopilotShell\|GlassSurface" /Users/lijiakun/Documents/blindbox/resultPage/eval/batch-eval/src
```

Expected: only `shell.tsx` itself (the alias export line). If any other file still references, go back and migrate it before proceeding.

- [ ] **Step 2: Remove backward-compat aliases from shell.tsx**

Delete these lines at bottom of `src/components/copilot/shell.tsx`:
```tsx
export const CopilotShell = GlassRegular
export const GlassSurface = GlassThin
```

- [ ] **Step 3: Typecheck confirms no stragglers**

```bash
npx tsc --noEmit
```

Expected: clean (all old references migrated).

- [ ] **Step 4: Run full test + e2e**

```bash
npm test
```

Expected: 156 tests pass.

```bash
npm run test:e2e
```

Expected: 9 cases pass (smoke, no regression).

- [ ] **Step 5: Manual visual walkthrough**

Open browser to `http://localhost:3013/`. For each of the following pages, toggle copilot with ⌘K and verify:

| Page | Expected open state |
|---|---|
| `/` | Regular cards in grid, light panel on right |
| `/experiments/new` | Regular form shell, tinted save-run button |
| `/compare` (select 2 experiments) | Regular outer, Thin sticky header with bottom mask, Thin cells |
| `/settings/datasets` | Regular layout shell, Regular list cards, tinted active RelationDiagram tab |
| `/settings/templates` | Same |
| `/settings/rubrics` | Same |
| `/settings/displays` | Same |
| `/experiments/<id>` | Regular outer, Regular progress/scoring/failed cards |

Toggle ⌘K off — everything returns to solid shadcn default.

- [ ] **Step 6: a11y media query manual verification**

In Chrome DevTools → Rendering tab → Emulate CSS media feature:

- Set `prefers-reduced-transparency: reduce`. Open copilot. All glass elements should render solid (no blur, no transparency), app still fully functional.
- Set `prefers-contrast: more`. Open copilot. Glass → solid + stronger borders + higher-contrast text.
- Set `prefers-reduced-motion: reduce`. Toggle copilot open/close. No squish / hover lift / mask transition animations.

Reset all three to default after verifying.

- [ ] **Step 7: Commit final cleanup + plan completion**

```bash
git add src/components/copilot/shell.tsx
git commit -m "$(cat <<'EOF'
chore(copilot): remove GlassShell/GlassSurface legacy aliases after full migration

All call sites now use GlassThin / GlassRegular / GlassThick / GlassTinted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Update project plan checkpoint**

Edit `/Users/lijiakun/.claude/plans/virtual-shimmying-squirrel.md`. After the PR-2.5 section, append:

```markdown
## PR-2.6 · Glass System (✅ 完成 2026-04-28)

Unified copilot-mode UI language to 4-tier glass (Thin / Regular / Thick / Tinted)
per `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`.

- 4 glass components exported from `src/components/copilot/shell.tsx`
- a11y fallbacks (`prefers-reduced-transparency` / `prefers-contrast` / `prefers-reduced-motion`)
- Tinted Button variant for primary CTAs
- All pages (dashboard / new / compare / settings / detail) migrated
- Overlay surfaces (Dialog / Popover / DropdownMenu) auto-glass when copilot open
- Tests: 151 existing + 5 new shell.test = 156 green
- Scroll-edge mask on sticky chrome
```

- [ ] **Step 9: Push to origin**

```bash
git push origin main
```

Expected: push succeeds.

---

## Spec Self-Review

**1. Spec coverage**:
- 玻璃梯度系统 4 档 → Task 1 ✓
- 组件 → 档位映射表 → Tasks 4–11 ✓
- 禁忌清单 → respected in Tasks 6 (cell Thin not Regular), 10 (textarea untouched), 11 (disabled via shadcn defaults) ✓
- 交互态（press squish / hover lift / scroll edge） → Task 2 (CSS utilities) + Task 6 (scroll edge mount) + Task 9 (sticky scroll edge) ✓
- 可访问性 3 条 media queries → Task 2 ✓
- Concentricity (out of scope) → respected ✓
- 改造文件表 → matches Tasks 4–11 ✓
- 测试策略 → Tasks 1 (unit), 12 (smoke + e2e + manual a11y) ✓

**2. Placeholder scan**:
- No TBD / TODO / "fill in later" ✓
- All code blocks are executable as-is ✓
- Test code complete ✓
- Commands exact ✓

**3. Type consistency**:
- `GlassVariant = "thin" | "regular" | "thick" | "tinted"` consistent across all references ✓
- `useGlassStyle(variant)` signature stable ✓
- `<GlassThin>` / `<GlassRegular>` / `<GlassThick>` / `<GlassTinted>` component names consistent ✓

---

## 首轮验证后的调整（2026-04-28）

12 task 落地后用户用了一轮，反馈了若干问题，对应调整已全部 ship（代码 push 到 origin/main）。细节见 spec §12。

### 调整 A · 引入 `--copilot-accent` token

**问题**：项目 `--primary = oklch(0.25 0.015 55)` 是暗褐色（色度 0.015 ≈ 灰），原 `GlassTinted` 用 `var(--primary) 28%` 做染色 → /10 出来灰扁，不是"亮"而是"染灰"。

**修**：
- `src/app/globals.css` 新增 `--copilot-accent: oklch(0.76 0.16 225)` (sky blue, 与 glow 主色呼应) + dark 变体
- `src/components/copilot/shell.tsx` GlassTinted 改用 copilot-accent
- test `src/components/copilot/__tests__/shell.test.ts` 同步更新断言

**Commit**: `ee3ebdd`（含调整 B、补充 Card 迁移）

### 调整 B · Glow 合并 idle/busy 色度

**问题**：打开 copilot 初始 glow 偏灰，点击任意位置后色度、对比度都会变深。

**修**：`src/app/globals.css` 的 `.copilot-glow::before` / `.copilot-glow-flow`：
- 把原 `[data-state="active"]` 的 `saturate(1.2) brightness(1.08)` 合并到默认状态
- 动画速度默认 6s/7s（比原 idle 9s/11s 快）
- `data-state="active"` 仅保留进一步提速到 3s/4s，不改色
- `color-mix` 百分比 +10–14%（如 `32%→48%`）让色斑更"实"

### 调整 C · 选中态 design token（`segmentedItem`）

**问题**：非 copilot 模式下，segmentedItem 把"选中"渲染成 sky-blue 发光 —— 用户说"非 copilot 模式应该还是以前的样式"。

**修**：
- `src/lib/segmented.ts`：`segmentedItem(active, copilotOpen)` 根据 `copilotOpen` 分支输出
  - 关：`border-foreground bg-accent/70` / `border-border hover:bg-muted/50`（shadcn 原样）
  - 开：accent 浅染 + 顶部白高光 + accent 光圈 + accent ambient shadow
- 5 个调用点传 `copilotOpen`（或硬编 `false`）：
  - `src/app/experiments/new/page.tsx` — `copilotOpen`
  - `src/components/settings/display-form-page.tsx` — `copilotOpen`
  - `src/components/settings/relation-diagram.tsx` — `copilotOpen`
  - `src/components/sidebar.tsx` — 硬编 `false`（sidebar 永远非 copilot 扁平）
  - `src/components/copilot/session-list.tsx` — 硬编 `false`（panel 内永远非 copilot 扁平）

**Commit**: `2f6c843`（含调整 D、E）

### 调整 D · Sidebar + Copilot panel 退出玻璃系统

**问题**：用户要求"只有页面中间部分应用 copilot 玻璃，最左侧导航 + 最右侧 copilot 都走非 copilot 扁平规范"。

**修**：
- `src/components/sidebar.tsx` — 删 `useGlassStyle("thin")` + tinted inline style；保持 `bg-muted/20` 实底
- `src/components/copilot/panel.tsx` — 删 `useGlassStyle("thick")`；保持 `bg-background` 实底
- `src/components/copilot/session-list.tsx` — 删所有 glass 应用
- `src/components/copilot/chat-view.tsx` — 两个 send / edit-resend 按钮从 `variant="tinted"` 改回默认

**Commit**: `2f6c843`

**注意**：中间内容区的浮层（Dialog / Select content / compare 的 PromptInfoIcon）保留 Thick glass，因为它们从中间内容触发、在中间渲染，不算"最右侧 copilot 区"。

### 调整 E · JSX display 兼容 copilot 态

**问题**：用户自建 JSX display（如 `fortune_v4_dual_list.json`）的源码直接写 `<div className="bg-card border rounded-lg p-3">`，copilot 开时仍然是 bg-card 实底，看起来是扁平的。

**修**：
- `src/components/results/view-helpers.tsx`：`makeHelpers({ open, styles })` 接受可选参数，暴露 `helpers.glassStyle(variant)` 和 `helpers.glassAttr(variant)`；copilot 关时返回 `undefined`，copilot 开时返回对应档的 CSS 或属性值
- `src/components/results/display-jsx.tsx`：在 `DisplayJsx` / `DisplayJsxCell` 组件内调用 4 档 `useGlassStyle`，传给 `makeHelpers`
- `data/displays/fortune_v3_dual_list.json` + `fortune_v4_dual_list.json`：外层主卡 `React.createElement('div', {...})` 的 props 里加：
  ```js
  style: glassStyle('regular'),
  'data-glass-variant': glassAttr('regular'),
  ```

用户后续自建 JSX display 的 pattern：
```js
({ result, helpers }) => {
  const { readField, Badge, glassStyle, glassAttr } = helpers;
  // ...
  return React.createElement('div', {
    className: 'border rounded-lg p-3 bg-card',     // copilot 关实底
    style: glassStyle('regular'),                    // copilot 开玻璃
    'data-glass-variant': glassAttr('regular'),
  }, children);
}
```

### 补充 · 剩余扁平 Card 全迁移（配合调整）

覆盖用户反馈"还有大量卡片扁平"：
- `src/components/settings/model-card.tsx`（LLM 模型卡）→ `<GlassRegular>`
- `src/app/experiments/[id]/page.tsx` L170 漏的 `rounded-lg border bg-card` 平 div → `<GlassRegular>`
- `src/app/settings/templates/[id]/page.tsx` + `src/app/settings/datasets/[id]/page.tsx` 详情页 Card → `<GlassRegular>`
- 4 个 form pages (`template-form-page.tsx` / `dataset-form-page.tsx` / `rubric-form-page.tsx` / `display-form-page.tsx`) 内部段落 Card → `<GlassRegular>`
- 7 个 results renderer (`single-list` / `dual-list` / `triple-grid` / `display-grouped-grid` / `display-jsx` / `bubble-auto` / `json-default`) 的行级 Card → `<GlassThin>`（数据密集用 Thin 最低扰动）
- `src/components/settings/agent-hint-banner.tsx` → **不迁**（amber notice banner，semantic 色码信号 > 装饰；符合 spec "toast/snackbar 实底不玻璃"禁忌）

**Commits**: `ee3ebdd`

### 额外修 · Sidebar 折叠态 btn 居中

**问题**：sidebar 收起后，底部 theme / language 按钮没水平居中。

**修**：`src/components/sidebar.tsx` + `src/components/language-toggle.tsx`：底部容器从固定 `px-3` 改为响应式 `collapsed ? "px-1.5" : "px-3"`，按钮去掉 no-op 的 `mx-auto` 改 `w-full + justify-center`，图标自然居中。

**Commit**: `002a863`

### 最终提交范围

```
d2f7d21 docs(copilot): add glass system implementation plan (12 tasks)
b109e44 feat(copilot): extend glass shell to 4-tier system
61f6f23 fix(copilot): align Thin glass opacity with spec (8%)
0f6c218 feat(copilot): add glass-tier a11y fallbacks + interactive keyframes
96fbe6c feat(ui): add tinted variant to Button
d2ac080 feat(dashboard): migrate ExperimentCard to GlassRegular
bef82ad feat(experiments/new): glass-regular shell + tinted save-run CTA
7e56398 feat(compare): 3-tier glass migration
a3581f9 feat(settings): glass migration + active tab Tinted
a6bcbd1 feat(experiments/detail): glass-regular for outer + all inner
4e313d3 feat(chrome): sidebar + sticky save bar GlassThin  (后续调整 D 撤销 sidebar)
d0c4e8c feat(copilot): panel GlassThick + send button tinted  (后续调整 D 撤销 panel + chat-view)
7558e49 feat(ui): Dialog content → GlassThick
cc66f54 feat(ui): Select content + custom popovers → GlassThick
83c4420 chore(copilot): remove legacy aliases after full migration
92368f6 fix(copilot): make useCopilotStore return no-op fallback outside provider
85d2ab2 feat(ui): unify segmented / tab / nav active state
ee3ebdd feat(copilot): brighter accent + glow always-active + migrate remaining Cards
2f6c843 fix(copilot): segmented state + chrome scope + JSX display glass awareness
002a863 fix(sidebar): center theme/language buttons when sidebar collapsed
```

Tests: 156 all green · E2E: 9/9 · tsc: clean · 全部 pushed to origin/main。
