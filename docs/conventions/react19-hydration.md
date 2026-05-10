# React 19 `setState`-in-effect: when it's intentional

## Pattern

React 19's `react-hooks/set-state-in-effect` flags `setState` calls inside
`useEffect` bodies as anti-pattern, recommending `useSyncExternalStore` or
`useMemo`. Most of our flagged sites fall into one of four legitimate
categories where the rewrite buys nothing:

| Category | Example | Why intentional |
|---|---|---|
| **localStorage hydrate** | `if (saved) setLocale(saved)` | Sync read on mount; no live `subscribe` semantics |
| **Mount flag** | `setMounted(true)` | Gate SSR-unsafe rendering until client mount |
| **Sync from prop on change** | `if (initial) setName(initial.name)` | Derived state seeded from prop when prop changes (Dialog open, route param, etc.) |
| **Reset on dep change** | `if (sessionId) setMessages([])` | Clear stale local state when input changes before triggering load |

## Why we suppress, not rewrite

`useSyncExternalStore` requires `subscribe` / `getSnapshot` semantics that
fit live external sources (theme system, websocket). Our cases are one-shot
hydration or edge-driven resets: modeling them as a store inflates code and
catches no real bugs. The React Team itself accepts these patterns; the new
ESLint rule is conservative.

We suppress per-line with a short tag pointing back to this file:

```tsx
// eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydrate; see docs/conventions/react19-hydration.md
setLocale(saved)
```

## When to revisit

If the source becomes live (cross-tab sync, server push, multi-listener
subscription), migrate that specific call site to `useSyncExternalStore`
with a real subscriber. Until then the suppression is the right trade-off.
