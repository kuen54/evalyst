# Copilot v2.5 P0 二轮采纳 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 v0.9.0 ship 后的三 repo 调研结论落地为 4 处可测的代码修正：approxTokens 分岔 + image 补偿 / cache break noise floor / session deny list / hermes 三档 chain cap。

**Architecture:** 全部走纯函数 + 测试驱动。新增 1 个文件（tool-loop-detector），修改 11 个文件。所有逻辑 server / client 共用纯函数；UI 改动遵循 Copilot Glass UI 约定（panel 内部扁平 + 轻量 tinted 表面）。

**Tech Stack:** TypeScript / vitest / Next.js 16 App Router / SSE。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md`

---

## 工作流约定

- 每个 Task 独立 commit。失败的 commit hook 跑出来必须修，不要 `--no-verify`。
- 每个 Task 写测试 → 跑失败 → 写实现 → 跑通过 → commit。
- 整个 PR feature branch：`feat/copilot-v25-p0-ccb-hermes-openclaw`。
- 不要在 main 上跑实施。
- 实施前：`git checkout -b feat/copilot-v25-p0-ccb-hermes-openclaw && git push -u origin <branch>`
- 全 PR 完成后跑：`npx tsc --noEmit && npm run lint && npm test && npm run build`，全绿才发 PR。

---

## Task 1: approxTokens 分岔 + image 补偿

**Files:**
- Modify: `src/lib/copilot/micro-compact.ts:55-59`
- Test: `src/lib/copilot/__tests__/micro-compact.test.ts`（追加新 describe block）

- [ ] **Step 1: 写失败测试 — approxTokens 分三层分岔**

在 `src/lib/copilot/__tests__/micro-compact.test.ts` 末尾追加：

```ts
import { __testOnlyApproxTokens } from '../micro-compact'

describe('approxTokens content-type 分岔（v2.5 P0）', () => {
  it('JSON 格式（{ ... }）按 length / 2 估算', () => {
    const json = JSON.stringify({ x: 'hello world', y: [1, 2, 3] })
    // length = 32, ÷2 ≈ 16
    expect(__testOnlyApproxTokens(json)).toBe(Math.ceil(json.length / 2))
  })

  it('JSON 格式（[ ... ]）按 length / 2 估算', () => {
    const json = JSON.stringify([1, 2, 3, 4, 5])
    expect(__testOnlyApproxTokens(json)).toBe(Math.ceil(json.length / 2))
  })

  it('中文 heavy（>30% CJK）按 length / 1.5 估算', () => {
    const cn = '你好世界这是一段中文文本中文占比超过百分之三十'
    expect(__testOnlyApproxTokens(cn)).toBe(Math.ceil(cn.length / 1.5))
  })

  it('英文为主（<30% CJK）按 length / 4 估算', () => {
    const en = 'Hello world this is mostly English with one 字 in it'
    expect(__testOnlyApproxTokens(en)).toBe(Math.ceil(en.length / 4))
  })

  it('空字符串返回 0', () => {
    expect(__testOnlyApproxTokens('')).toBe(0)
  })

  it('JSON 优先级高于中文判定（JSON 里含中文也走 ÷2）', () => {
    const jsonCn = JSON.stringify({ msg: '中文内容比较多需要超过百分之三十' })
    expect(__testOnlyApproxTokens(jsonCn)).toBe(Math.ceil(jsonCn.length / 2))
  })
})

describe('approxTokens image 补偿（v2.5 P0）', () => {
  it('每个 https:// 图片 url 补偿 1600 tokens', () => {
    const s = '{"img":"https://example.com/foo.png"}'
    // base text = ceil(37/2) = 19；image = 1600 → 1619
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 1600)
  })

  it('多张图叠加', () => {
    const s = '{"a":"https://x.com/1.jpg","b":"https://x.com/2.webp"}'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 3200)
  })

  it('data:image/...;base64 也算一张', () => {
    const s = 'data:image/png;base64,iVBORw0KGgoAAAA'
    // base 是英文（无 JSON brace 包裹），走 ÷4 + 1600
    const baseTokens = Math.ceil(s.length / 4)
    expect(__testOnlyApproxTokens(s)).toBe(baseTokens + 1600)
  })

  it('不带扩展名的 url 不算 image', () => {
    const s = '"https://example.com/api/foo"'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2))
  })

  it('image url query string 不影响匹配', () => {
    const s = '"https://example.com/foo.png?v=2"'
    expect(__testOnlyApproxTokens(s)).toBe(Math.ceil(s.length / 2) + 1600)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/lib/copilot/__tests__/micro-compact.test.ts
```

Expected: 上面新加的 11 个 case 全部 FAIL（`__testOnlyApproxTokens` 还没 export）。

- [ ] **Step 3: 改 `src/lib/copilot/micro-compact.ts`**

把现有 `approxTokens`（约 56-59 行）替换：

```ts
/** Hermes context_compressor.py:65 _IMAGE_TOKEN_ESTIMATE = 1600 */
export const IMAGE_TOKEN_COST = 1600

/**
 * 匹配 image url（http/https + 常见图片扩展名）和 data URL。
 * 用 \\.(?:png|jpe?g|webp|gif|bmp) 兜常见扩展名；不区分大小写。
 */
const IMAGE_URL_PATTERN =
  /(["'])(https?:\/\/[^"'\s]*\.(?:png|jpe?g|webp|gif|bmp)(?:\?[^"'\s]*)?)\1|data:image\/[a-z]+;base64,/gi

const CJK_PATTERN = /[一-鿿]/g

/**
 * v2.5 P0 §3.1: 分三层分岔 + image 补偿。
 *
 * - JSON content（tool_result 都是）：~2 chars/token（CCB tokenEstimation.ts:227）
 * - 中文 heavy（>30% CJK）：~1.5 chars/token（中文经验，hermes 没处理这个）
 * - 其他（英文 / 代码）：~4 chars/token（CCB / hermes 都用 4）
 *
 * 加 image 补偿：每张图固定 1600 tokens（hermes context_compressor.py:65）。
 */
function approxTokens(s: string): number {
  if (!s) return 0

  const imageCount = (s.match(IMAGE_URL_PATTERN) ?? []).length
  const imageTokens = imageCount * IMAGE_TOKEN_COST

  const trimmed = s.trim()
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (looksLikeJson) return Math.ceil(s.length / 2) + imageTokens

  const cjkCount = (s.match(CJK_PATTERN) ?? []).length
  if (cjkCount > s.length * 0.3) return Math.ceil(s.length / 1.5) + imageTokens

  return Math.ceil(s.length / 4) + imageTokens
}

// 测试导出
export const __testOnlyApproxTokens = approxTokens
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/copilot/__tests__/micro-compact.test.ts
```

Expected: 11 个新 case + 原 case 全 PASS。如果原 case fail（比如 `maxTotalReplayableTokens=4000` 的 token cap 测试因为分母变化），更新原 case 的预期值（以新 approxTokens 输出为准）。

- [ ] **Step 5: 跑全部 vitest 确认无回归**

```bash
npm test
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/lib/copilot/micro-compact.ts src/lib/copilot/__tests__/micro-compact.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot): approxTokens 分三层分岔 + image 补偿

v0.9.0 用 length / 4 一刀切估 token，对 tool_result（JSON 形态）
低估 2 倍、对中文 content 低估 2-3 倍。基于三 repo 调研：
- CCB tokenEstimation.ts:227 → JSON 用 bytesPerToken=2
- hermes context_compressor.py:65 → 每张图 1600 tokens 补偿
- 中文经验 → CJK > 30% 走 / 1.5

Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: detectCacheBreak + countRecentBreaks + chip UI 第三段

**Files:**
- Modify: `src/lib/copilot/cache-stats-store.ts`（追加函数 + 常量）
- Modify: `src/app/api/copilot/cache-stats/route.ts`（response 加 breaks 字段）
- Modify: `src/components/copilot/cache-stats-chip.tsx`（render 第三段）
- Modify: `src/lib/i18n/zh.ts` + `en.ts`（新 i18n key）
- Test: `src/lib/copilot/__tests__/cache-stats-store.test.ts`

- [ ] **Step 1: 写失败测试 — detectCacheBreak / countRecentBreaks**

在 `src/lib/copilot/__tests__/cache-stats-store.test.ts` 末尾追加：

```ts
import { detectCacheBreak, countRecentBreaks, CACHE_BREAK_MIN_DROP_TOKENS, CACHE_BREAK_MAX_RATIO } from '../cache-stats-store'

describe('detectCacheBreak (v2.5 P0 §3.2)', () => {
  it('prev undefined 永不算 break', () => {
    expect(detectCacheBreak(undefined, stat({ cache_read_tokens: 100 }))).toBe(false)
  })

  it('drop < 1000 tokens 不算 break', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: 4500 })
    expect(detectCacheBreak(a, b)).toBe(false)  // drop=500 < 1000
  })

  it('drop >= 1000 但 ratio >= 0.95 不算 break', () => {
    const a = stat({ cache_read_tokens: 100_000 })
    const b = stat({ cache_read_tokens: 96_000 })
    // drop = 4000, ratio = 0.96 → 不算
    expect(detectCacheBreak(a, b)).toBe(false)
  })

  it('drop >= 1000 且 ratio < 0.95 算 break', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: 3000 })
    // drop = 2000, ratio = 0.6 → break
    expect(detectCacheBreak(a, b)).toBe(true)
  })

  it('prev.cache_read_tokens = 0 时不算 break（无可掉的基线）', () => {
    const a = stat({ cache_read_tokens: 0 })
    const b = stat({ cache_read_tokens: 0 })
    expect(detectCacheBreak(a, b)).toBe(false)
  })

  it('curr.cache_read_tokens undefined 视作 0', () => {
    const a = stat({ cache_read_tokens: 5000 })
    const b = stat({ cache_read_tokens: undefined })
    // drop=5000, ratio=0 → break
    expect(detectCacheBreak(a, b)).toBe(true)
  })

  it('阈值常量值正确', () => {
    expect(CACHE_BREAK_MIN_DROP_TOKENS).toBe(1000)
    expect(CACHE_BREAK_MAX_RATIO).toBe(0.95)
  })
})

describe('countRecentBreaks (v2.5 P0 §3.2)', () => {
  it('空数组返 0/0', () => {
    expect(countRecentBreaks([])).toEqual({ recent_breaks: 0, total_pairs_considered: 0 })
  })

  it('单条返 0/0（没有前一条对比）', () => {
    expect(countRecentBreaks([stat({ cache_read_tokens: 100 })])).toEqual({
      recent_breaks: 0, total_pairs_considered: 0,
    })
  })

  it('两条全稳：0 breaks / 1 pair', () => {
    const stats = [
      stat({ cache_read_tokens: 5000 }),
      stat({ cache_read_tokens: 4900 }),
    ]
    expect(countRecentBreaks(stats)).toEqual({ recent_breaks: 0, total_pairs_considered: 1 })
  })

  it('三条 ABA 模式：第一对 break，第二对回升不 break', () => {
    const stats = [
      stat({ cache_read_tokens: 5000 }),
      stat({ cache_read_tokens: 1000 }),  // drop=4000, ratio=0.2 → break
      stat({ cache_read_tokens: 5000 }),  // 回升不算 break
    ]
    expect(countRecentBreaks(stats)).toEqual({ recent_breaks: 1, total_pairs_considered: 2 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/lib/copilot/__tests__/cache-stats-store.test.ts
```

Expected: 11 个新 case 全部 FAIL（函数未定义）。

- [ ] **Step 3: 实现 cache-stats-store 新函数**

在 `src/lib/copilot/cache-stats-store.ts` 末尾追加：

```ts
/**
 * v2.5 P0 §3.2: 与 openclaw `prompt-cache-observability.ts:51` 对齐的 noise floor。
 * 小波动不视为 break；避免"重启一次实验就让 chip 抖一下"。
 */
export const CACHE_BREAK_MIN_DROP_TOKENS = 1000
export const CACHE_BREAK_MAX_RATIO = 0.95

export function detectCacheBreak(
  prev: CacheUsageStat | undefined,
  curr: CacheUsageStat,
): boolean {
  if (!prev) return false
  const prevRead = prev.cache_read_tokens ?? 0
  if (prevRead === 0) return false  // 从 0 出发谈不上"掉"
  const currRead = curr.cache_read_tokens ?? 0
  const drop = prevRead - currRead
  if (drop < CACHE_BREAK_MIN_DROP_TOKENS) return false
  const ratio = currRead / prevRead
  return ratio < CACHE_BREAK_MAX_RATIO
}

export interface CacheBreaksSummary {
  recent_breaks: number
  total_pairs_considered: number
}

export function countRecentBreaks(stats: CacheUsageStat[]): CacheBreaksSummary {
  let breaks = 0
  for (let i = 1; i < stats.length; i++) {
    if (detectCacheBreak(stats[i - 1], stats[i])) breaks++
  }
  return { recent_breaks: breaks, total_pairs_considered: Math.max(0, stats.length - 1) }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/copilot/__tests__/cache-stats-store.test.ts
```

Expected: 全绿。

- [ ] **Step 5: 把 breaks 加进 cache-stats route response**

修改 `src/app/api/copilot/cache-stats/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { readCacheStats, aggregateCacheHitRate, countRecentBreaks } from '@/copilot/lib/cache-stats-store'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_LIMIT = 10

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id') ?? undefined

  const sessionStats = sessionId ? readCacheStats({ session_id: sessionId }) : []
  const weeklyStats = readCacheStats({ since_ms: SEVEN_DAYS_MS })

  const sessionAgg = aggregateCacheHitRate(sessionStats)
  const weeklyAgg = aggregateCacheHitRate(weeklyStats)
  const weeklyBreaks = countRecentBreaks(weeklyStats)

  return NextResponse.json({
    session: {
      ...sessionAgg,
      recent: sessionStats.slice(-RECENT_LIMIT).reverse(),
    },
    weekly: {
      ...weeklyAgg,
      ...weeklyBreaks,
    },
  })
}
```

- [ ] **Step 6: 加 i18n key**

在 `src/lib/i18n/zh.ts` 找 `copilot.cache.*` 段，追加：

```ts
"copilot.cache.weekly_breaks": "{{n}} 次 break",
"copilot.cache.tooltip.breaks_explain": "缓存命中骤降事件（>1000 tokens 且降幅 >5%）",
```

`src/lib/i18n/en.ts` 对应：

```ts
"copilot.cache.weekly_breaks": "{{n}} breaks",
"copilot.cache.tooltip.breaks_explain": "Cache hit drop events (>1000 tokens and >5% drop)",
```

- [ ] **Step 7: chip UI 加第三段**

修改 `src/components/copilot/cache-stats-chip.tsx`，把 `interface ApiResponse` 的 `weekly` 字段改成：

```ts
interface ApiResponse {
  session: CacheHitRateResult & { recent: CacheUsageStat[] }
  weekly: CacheHitRateResult & { recent_breaks: number; total_pairs_considered: number }
}
```

在 chip 渲染处（return 块），在 weekly 段后加：

```tsx
{data.weekly.recent_breaks > 0 && (
  <>
    <span className="opacity-60">·</span>
    <span title={t("copilot.cache.tooltip.breaks_explain")}>
      {t("copilot.cache.weekly_breaks", { n: String(data.weekly.recent_breaks) })}
    </span>
  </>
)}
```

- [ ] **Step 8: 跑全 vitest + tsc**

```bash
npm test
npx tsc --noEmit
```

Expected: 全绿。

- [ ] **Step 9: Commit**

```bash
git add src/lib/copilot/cache-stats-store.ts \
        src/lib/copilot/__tests__/cache-stats-store.test.ts \
        src/app/api/copilot/cache-stats/route.ts \
        src/components/copilot/cache-stats-chip.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "$(cat <<'EOF'
feat(copilot): cache break noise floor + chip 第三段显示

来源 openclaw prompt-cache-observability.ts:51 的 hasCacheReadDropped 检测。
- detectCacheBreak: drop ≥ 1000 tokens AND ratio < 0.95 才算
- countRecentBreaks: 反向扫 stats 数对计数
- chip 在 session/weekly 后加 "· N breaks" 段（仅 >0 时显示）

避免"重启一次实验就让 chip 抖一下"的视觉噪声。

Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: session_deny_list 对称 + UI checkbox

**Files:**
- Modify: `src/lib/copilot/session-allow.ts`（追加 deny 函数）
- Modify: `src/lib/copilot/tools/hooks.ts`（confirmGateHook deny 短路）
- Modify: `src/app/api/copilot/sessions/[id]/chat/route.ts`（read body session_deny_list）
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`（同上）
- Modify: `src/components/copilot/use-chat-stream.ts`（body 带 deny + confirmTool/denyTool 签名）
- Modify: `src/components/copilot/tool-call-card.tsx`（Deny 旁加 alwaysDeny checkbox）
- Modify: `src/lib/i18n/zh.ts` + `en.ts`
- Test: `src/lib/copilot/__tests__/session-allow.test.ts`
- Test: `src/lib/copilot/tools/__tests__/hooks.test.ts`

- [ ] **Step 1: 写失败测试 — isSessionDenied + deny > allow 优先级**

在 `src/lib/copilot/__tests__/session-allow.test.ts` 末尾追加：

```ts
import { isSessionDenied } from '../session-allow'

describe('isSessionDenied (v2.5 P0 §3.3)', () => {
  it('返 false 当 denyList undefined', () => {
    expect(isSessionDenied(undefined, 'restart_experiment')).toBe(false)
  })
  it('返 false 当 denyList 空', () => {
    expect(isSessionDenied([], 'restart_experiment')).toBe(false)
  })
  it('返 true 当 toolName 在列表里', () => {
    expect(isSessionDenied(['restart_experiment', 'edit_template'], 'restart_experiment')).toBe(true)
  })
  it('返 false 当 toolName 不在列表里', () => {
    expect(isSessionDenied(['restart_experiment'], 'edit_template')).toBe(false)
  })
  it('精确匹配，不做 substring', () => {
    expect(isSessionDenied(['restart'], 'restart_experiment')).toBe(false)
  })
})
```

在 `src/lib/copilot/tools/__tests__/hooks.test.ts` 末尾追加：

```ts
describe("confirmGateHook deny 短路 (v2.5 P0 §3.3)", () => {
  const writeTool = makeTool({ isReadOnly: false, isDestructive: true, maxResultSizeChars: 1000 })

  it("deny in deny_list → action: 'deny'", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_deny_list: ["t"],
    })
    expect(r.action).toBe("deny")
    if (r.action === "deny") expect(r.reason).toContain("denied")
  })

  it("不在 deny_list 走原逻辑（destructive → require_confirm）", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_deny_list: ["other_tool"],
    })
    expect(r.action).toBe("require_confirm")
  })

  it("deny > allow 优先级：同时在两个 list 也算 deny", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_allow_list: ["t"],
      session_deny_list: ["t"],
    })
    expect(r.action).toBe("deny")
  })

  it("deny_list undefined 不影响 allow 短路", async () => {
    const r = await confirmGateHook({
      tool: writeTool, input: {}, session_id: "s",
      session_allow_list: ["t"],
    })
    expect(r.action).toBe("proceed")
  })
})
```

- [ ] **Step 2: 跑失败**

```bash
npx vitest run src/lib/copilot/__tests__/session-allow.test.ts src/lib/copilot/tools/__tests__/hooks.test.ts
```

Expected: 9 新 case 全 FAIL。

- [ ] **Step 3: 在 session-allow.ts 加 deny 函数**

在 `src/lib/copilot/session-allow.ts` 末尾追加：

```ts
const DENY_KEY = (sessionId: string) => `evalyst-copilot-deny-${sessionId}`

/**
 * 纯函数：client + server 共用。
 * 优先级 deny > allow > 默认 confirm 在 confirmGateHook 里实现。
 */
export function isSessionDenied(
  denyList: string[] | undefined,
  toolName: string,
): boolean {
  return Array.isArray(denyList) && denyList.includes(toolName)
}

export function getSessionDenyList(sessionId: string): string[] {
  if (!isBrowser()) return []
  try {
    const raw = sessionStorage.getItem(DENY_KEY(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

export function addSessionDeny(sessionId: string, toolName: string): void {
  if (!isBrowser()) return
  try {
    const current = getSessionDenyList(sessionId)
    if (current.includes(toolName)) return
    const next = [...current, toolName]
    sessionStorage.setItem(DENY_KEY(sessionId), JSON.stringify(next))
  } catch {
    /* 静默失败 */
  }
}
```

- [ ] **Step 4: 改 hooks.ts confirmGateHook**

修改 `src/lib/copilot/tools/hooks.ts`：

```ts
import type { AnyToolDescriptor } from "./registry"
import { maybePersistToolResult } from "../tool-result-store"
import { isSessionAllowed, isSessionDenied } from "../session-allow"

export interface PreToolCallCtx {
  tool: AnyToolDescriptor
  input: unknown
  session_id: string
  session_allow_list?: string[]
  session_deny_list?: string[]  // v2.5 P0
}

// ... 原有 type 定义不动

export const confirmGateHook: PreToolCallHook = async ({
  tool,
  session_allow_list,
  session_deny_list,
}) => {
  // v2.5 P0 §3.3: deny 优先级最高（防越权），先于 allow 检查。
  if (isSessionDenied(session_deny_list, tool.name)) {
    return { action: "deny", reason: "user-denied for this session" }
  }
  if (isSessionAllowed(session_allow_list, tool.name)) {
    return { action: "proceed" }
  }
  const needsConfirm = tool.metadata.requiresConfirm ?? tool.metadata.isDestructive
  return needsConfirm ? { action: "require_confirm" } : { action: "proceed" }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run src/lib/copilot/__tests__/session-allow.test.ts src/lib/copilot/tools/__tests__/hooks.test.ts
```

Expected: 全绿。

- [ ] **Step 6: 改两条 route 读 body deny_list**

修改 `src/app/api/copilot/sessions/[id]/tool-result/route.ts` body schema：

```ts
const body = (await req.json().catch(() => ({}))) as {
  call_id?: string
  tool_name?: string
  input?: Record<string, unknown>
  denied?: boolean
  reason?: string
  client_snapshot?: ClientSnapshot
  session_allow_list?: string[]
  session_deny_list?: string[]  // 新增
}
```

并在 `runTool` 调用处把 deny_list 传过去：

```ts
const r = await runTool(
  tool,
  body.input,
  { session_id: sessionId, signal: req.signal },
  {
    skipConfirm: true,
    sessionAllowList: body.session_allow_list,
    sessionDenyList: body.session_deny_list,  // 新增
  },
)
```

修改 `src/lib/copilot/tool-runtime.ts` 的 runTool opts：

```ts
export async function runTool(
  tool: AnyToolDescriptor,
  input: unknown,
  ctx: ToolContext,
  opts: { skipConfirm?: boolean; sessionAllowList?: string[]; sessionDenyList?: string[] } = {},
): Promise<RunToolResult> {
  if (!opts.skipConfirm) {
    for (const hook of preToolCallHooks) {
      const r = await hook({
        tool,
        input,
        session_id: ctx.session_id,
        session_allow_list: opts.sessionAllowList,
        session_deny_list: opts.sessionDenyList,  // 新增
      })
      // ... 原逻辑
    }
  }
  // ... 原逻辑
}
```

修改 `src/app/api/copilot/sessions/[id]/chat/route.ts` 同样加 `session_deny_list?: string[]` body 字段并透传到 runTool（搜该文件 `runTool` / `preToolCallHooks` 调用点；如果 chat route 不直接跑 tool 而是依赖 stream-response.ts 转发，则改 stream-response 的入口签名）。

读 `src/app/api/copilot/sessions/[id]/chat/route.ts` 全文确认 deny_list 应注入哪一层后，按现有 allow_list 透传链做对称改动。

- [ ] **Step 7: client 改 use-chat-stream.ts**

修改 `src/components/copilot/use-chat-stream.ts`：

```ts
import { isSessionAllowed, getSessionAllowList, addSessionAllow,
         isSessionDenied, getSessionDenyList, addSessionDeny } from "@/copilot/lib/session-allow"
```

`postToolResult` body 加 deny_list：

```ts
body: JSON.stringify({
  call_id, tool_name, input, denied, reason,
  client_snapshot: pageContext ? collectClientSnapshot(pairSessionId, pageContext) : undefined,
  session_allow_list: pairSessionId ? getSessionAllowList(pairSessionId) : [],
  session_deny_list: pairSessionId ? getSessionDenyList(pairSessionId) : [],  // 新增
}),
```

`send` 同样加 deny_list 字段。

`denyTool` 加 alwaysDeny 参数：

```ts
const denyTool = (
  call_id: string,
  tool_name: string,
  tool_input: Record<string, unknown>,
  reason: string,
  alwaysDeny: boolean = false,  // 新增
) => {
  if (alwaysDeny && sessionId) {
    addSessionDeny(sessionId, tool_name)
  }
  void postToolResult(call_id, tool_name, tool_input, true, reason)
}
```

更新 `UseChatStreamResult` interface 的 `denyTool` 签名同上。

- [ ] **Step 8: tool-call-card.tsx Deny 侧加 checkbox**

修改 `src/components/copilot/tool-call-card.tsx`，把 Props 的 `onDeny` 签名改成：

```ts
interface Props {
  toolUse: CopilotMessage
  toolResult?: CopilotMessage
  onConfirm: (alwaysAllow: boolean) => void
  onDeny: (reason: string, alwaysDeny: boolean) => void  // 改签名
  pending: boolean
}
```

在 `WriteVariant` 的 deny stage（`denyOpen ? <div>...</div>`）改：

```tsx
{denyOpen ? (
  <div className="space-y-1.5">
    <Input
      value={denyReason}
      onChange={(e) => setDenyReason(e.target.value)}
      placeholder={t("copilot.tool.deny_reason_placeholder")}
      className="h-7 text-xs"
      disabled={pending}
    />
    <div className="flex items-start gap-2 mt-2 mb-1">
      <Checkbox
        id={`always-deny-${toolUse.call_id ?? toolUse.id}`}
        checked={alwaysDeny}
        onCheckedChange={(v) => setAlwaysDeny(v === true)}
      />
      <label
        htmlFor={`always-deny-${toolUse.call_id ?? toolUse.id}`}
        className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none"
        title={t("copilot.tool.always_deny_hint")}
      >
        {t("copilot.tool.always_deny")}
      </label>
    </div>
    <div className="flex gap-1.5">
      <Button size="sm" onClick={() => onDeny(denyReason, alwaysDeny)} disabled={pending}>
        {t("copilot.tool.deny_confirm")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setDenyOpen(false)
          setDenyReason("")
          setAlwaysDeny(false)
        }}
        disabled={pending}
      >
        {t("copilot.tool.cancel")}
      </Button>
    </div>
  </div>
) : (
  // 原 confirm + alwaysAllow 块不动
  ...
)}
```

在 `WriteVariant` 顶部加 `const [alwaysDeny, setAlwaysDeny] = useState(false)`。

确认所有调用 `<ToolCallCard onDeny={...} />` 的位置（应在 `chat-view-parts.tsx` 或 `chat-view.tsx`）签名同步更新；对应 hook 链：UI `onDeny` → `denyTool(call_id, tool_name, input, reason, alwaysDeny)` → `addSessionDeny`。

- [ ] **Step 9: 加 i18n key**

`src/lib/i18n/zh.ts` 找 `copilot.tool.always_allow*` 段附近，加：

```ts
"copilot.tool.always_deny": "本会话内永久阻止此工具",
"copilot.tool.always_deny_hint": "本会话期间，下次 LLM 调用此工具会被自动阻止",
```

`en.ts`：

```ts
"copilot.tool.always_deny": "Always deny in this session",
"copilot.tool.always_deny_hint": "Automatically deny this tool for the rest of this session",
```

- [ ] **Step 10: 跑测试 + tsc**

```bash
npm test
npx tsc --noEmit
```

Expected: 全绿。lint 跑一下：`npm run lint`。

- [ ] **Step 11: Commit**

```bash
git add src/lib/copilot/session-allow.ts \
        src/lib/copilot/tools/hooks.ts \
        src/lib/copilot/tool-runtime.ts \
        src/lib/copilot/__tests__/session-allow.test.ts \
        src/lib/copilot/tools/__tests__/hooks.test.ts \
        src/app/api/copilot/sessions/[id]/tool-result/route.ts \
        src/app/api/copilot/sessions/[id]/chat/route.ts \
        src/components/copilot/use-chat-stream.ts \
        src/components/copilot/tool-call-card.tsx \
        src/components/copilot/chat-view-parts.tsx \
        src/components/copilot/chat-view.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "$(cat <<'EOF'
feat(copilot): session-level alwaysDeny 对称到 alwaysAllow

来源 CCB alwaysDenyRules + openclaw allow-once/always/deny UI。
- session-allow.ts: isSessionDenied + getSessionDenyList + addSessionDeny
- confirmGateHook: deny > allow > 默认 confirm 优先级
- ToolCallCard WriteVariant: Deny stage 加 alwaysDeny checkbox
- /chat + /tool-result body 携带 session_deny_list

用户场景：永远不想 Copilot 跑 restart_experiment，直接 Deny + 勾 always。

Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: tool-loop-detector + warn UI（hermes 三档阈值）

**Files:**
- Create: `src/lib/copilot/tool-loop-detector.ts`
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`（移除硬 cap，插 analyzeToolLoop + emit loop_warn SSE）
- Modify: `src/components/copilot/use-chat-stream.ts`（处理 loop_warn）
- Modify: `src/components/copilot/chat-view-parts.tsx`（加 SystemNoticeBubble + UiMessage union）
- Modify: `src/components/copilot/chat-view.tsx`（render system_notice 分支）
- Modify: `src/lib/i18n/zh.ts` + `en.ts`（6 条 loop warn/block key）
- Test: `src/lib/copilot/__tests__/tool-loop-detector.test.ts`
- Test: `src/lib/copilot/__tests__/tool-loop-detector.integration.test.ts`

- [ ] **Step 1: 写 detector 单测**

新建 `src/lib/copilot/__tests__/tool-loop-detector.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { analyzeToolLoop, DEFAULT_LOOP_CONFIG } from '../tool-loop-detector'
import type { CopilotMessage } from '../types'

function toolUse(callId: string, name: string, input: Record<string, unknown>): CopilotMessage {
  return {
    id: `tu_${callId}`, session_id: 's', role: 'tool_use',
    content: '', timestamp: 't',
    call_id: callId, tool_name: name, tool_input: input,
  }
}
function toolResult(callId: string, name: string, content: unknown): CopilotMessage {
  return {
    id: `tr_${callId}`, session_id: 's', role: 'tool_result',
    content: JSON.stringify(content), timestamp: 't',
    call_id: callId, tool_name: name,
  }
}
function fail(callId: string, name: string, input: Record<string, unknown>): CopilotMessage[] {
  return [toolUse(callId, name, input), toolResult(callId, name, { error: 'boom' })]
}
function ok(callId: string, name: string, input: Record<string, unknown>, output: unknown): CopilotMessage[] {
  return [toolUse(callId, name, input), toolResult(callId, name, output)]
}

describe('analyzeToolLoop · empty / proceed', () => {
  it('空 branch → proceed', () => {
    expect(analyzeToolLoop([], 'read_context', {})).toEqual({ action: 'proceed' })
  })
  it('1 次成功 → proceed', () => {
    const branch = ok('1', 'read_context', { id: 'ctx_1' }, { value: 'foo' })
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })).toEqual({ action: 'proceed' })
  })
})

describe('analyzeToolLoop · exact-failure（同 args 失败）', () => {
  it('1 次失败下次 proceed', () => {
    const branch = fail('1', 'read_context', { id: 'ctx_1' })
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })).toEqual({ action: 'proceed' })
  })
  it('2 次失败下次 warn', () => {
    const branch = [...fail('1', 'read_context', { id: 'ctx_1' }), ...fail('2', 'read_context', { id: 'ctx_1' })]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('warn')
  })
  it('5 次失败下次 block', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      ...fail('3', 'read_context', { id: 'ctx_1' }),
      ...fail('4', 'read_context', { id: 'ctx_1' }),
      ...fail('5', 'read_context', { id: 'ctx_1' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('block')
  })
  it('换 args 重置计数', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
    ]
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_2' })).toEqual({ action: 'proceed' })
  })
})

describe('analyzeToolLoop · same-tool（同工具任意 args 失败）', () => {
  it('3 次不同 args 失败下次 warn', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_2' }),
      ...fail('3', 'read_context', { id: 'ctx_3' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_4' })
    expect(r.action).toBe('warn')
  })
  it('8 次不同 args 失败下次 halt', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 8; i++) {
      branch.push(...fail(String(i), 'read_context', { id: `ctx_${i}` }))
    }
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_9' })
    expect(r.action).toBe('block')
  })
})

describe('analyzeToolLoop · no-progress（同 args 成功但输出 identical）', () => {
  it('2 次相同 args + 相同 output 下次 warn', () => {
    const branch = [
      ...ok('1', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
      ...ok('2', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
    ]
    const r = analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })
    expect(r.action).toBe('warn')
  })
  it('5 次相同 args + 相同 output 下次 block', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 5; i++) {
      branch.push(...ok(String(i), 'read_tool_result', { ref: 'r1' }, { value: 'foo' }))
    }
    const r = analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })
    expect(r.action).toBe('block')
  })
  it('output 不同（哪怕一字符）则不算 no-progress', () => {
    const branch = [
      ...ok('1', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
      ...ok('2', 'read_tool_result', { ref: 'r1' }, { value: 'foo2' }),
    ]
    expect(analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })).toEqual({ action: 'proceed' })
  })
})

describe('analyzeToolLoop · DEFAULT_LOOP_CONFIG 正确', () => {
  it('阈值常量值正确', () => {
    expect(DEFAULT_LOOP_CONFIG).toMatchObject({
      exactFailureWarn: 2, exactFailureBlock: 5,
      sameToolFailureWarn: 3, sameToolFailureHalt: 8,
      noProgressWarn: 2, noProgressBlock: 5,
    })
  })
})
```

- [ ] **Step 2: 跑失败**

```bash
npx vitest run src/lib/copilot/__tests__/tool-loop-detector.test.ts
```

Expected: 全部 FAIL（文件不存在）。

- [ ] **Step 3: 实现 tool-loop-detector.ts**

新建 `src/lib/copilot/tool-loop-detector.ts`：

```ts
// src/lib/copilot/tool-loop-detector.ts
//
// v2.5 P0 §3.4: hermes tool_guardrails.py:71 三档阈值的 evalyst 翻译版。
// 替代 v0.9.0 的硬数步 chain cap 5，改成"按错误模式"判定。
//
// 三档（覆盖范围从严到宽）：
//   1. exact-failure：连续 N 次同 (tool, argsHash) 失败 → block
//   2. same-tool：连续 N 次同 tool（args 可不同）失败 → block
//   3. no-progress：连续 N 次同 (tool, argsHash) 成功但 output identical → block
//
// 输入：active branch + 即将调用的 (toolName, toolInput)
// 输出：proceed / warn / block；调用方按 action 决定 SSE 路径

import type { CopilotMessage } from "./types"

export interface ToolLoopDetectorConfig {
  exactFailureWarn: number
  exactFailureBlock: number
  sameToolFailureWarn: number
  sameToolFailureHalt: number
  noProgressWarn: number
  noProgressBlock: number
}

export const DEFAULT_LOOP_CONFIG: ToolLoopDetectorConfig = {
  exactFailureWarn: 2, exactFailureBlock: 5,
  sameToolFailureWarn: 3, sameToolFailureHalt: 8,
  noProgressWarn: 2, noProgressBlock: 5,
}

export type LoopReasonKey =
  | "exact_failure"
  | "same_tool"
  | "no_progress"

export type ToolLoopDecision =
  | { action: "proceed" }
  | { action: "warn"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }
  | { action: "block"; reasonKey: LoopReasonKey; reasonVars: { tool: string; count: number } }

/** 稳定 hash：JSON.stringify 已 sort key 不可保证，简单顺序拼。够用足。 */
function argsHash(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

function isFailure(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== "object" || parsed === null) return false
    const obj = parsed as Record<string, unknown>
    if ("error" in obj) return true
    if ("denied" in obj && obj.denied === true) return true
    return false
  } catch {
    return false
  }
}

interface PairSummary {
  toolName: string
  argsHash: string
  failed: boolean
  outputContent: string
}

function collectTrailingPairs(branch: CopilotMessage[]): PairSummary[] {
  // 反向扫，找连续的 tool_use+tool_result 对（assistant text 在中间会打断"trailing"）
  const pairs: PairSummary[] = []
  let i = branch.length - 1
  while (i >= 1) {
    const result = branch[i]
    const use = branch[i - 1]
    if (result.role !== "tool_result" || use.role !== "tool_use") break
    if (!use.tool_name || !use.call_id || result.call_id !== use.call_id) break
    pairs.unshift({
      toolName: use.tool_name,
      argsHash: argsHash((use.tool_input ?? {}) as Record<string, unknown>),
      failed: isFailure(result.content),
      outputContent: result.content,
    })
    i -= 2
  }
  return pairs
}

export function analyzeToolLoop(
  branch: CopilotMessage[],
  nextToolName: string,
  nextToolInput: Record<string, unknown>,
  config: ToolLoopDetectorConfig = DEFAULT_LOOP_CONFIG,
): ToolLoopDecision {
  const pairs = collectTrailingPairs(branch)
  if (pairs.length === 0) return { action: "proceed" }

  const nextHash = argsHash(nextToolInput)

  // exact-failure: 反向扫连续 (toolName, argsHash) 全失败
  let exactFailCount = 0
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (p.toolName === nextToolName && p.argsHash === nextHash && p.failed) {
      exactFailCount++
    } else break
  }
  if (exactFailCount + 1 >= config.exactFailureBlock) {
    return { action: "block", reasonKey: "exact_failure", reasonVars: { tool: nextToolName, count: exactFailCount + 1 } }
  }
  if (exactFailCount + 1 >= config.exactFailureWarn) {
    return { action: "warn", reasonKey: "exact_failure", reasonVars: { tool: nextToolName, count: exactFailCount + 1 } }
  }

  // same-tool: 连续同 toolName 都失败（不限 args）
  let sameToolFailCount = 0
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (p.toolName === nextToolName && p.failed) {
      sameToolFailCount++
    } else break
  }
  if (sameToolFailCount + 1 >= config.sameToolFailureHalt) {
    return { action: "block", reasonKey: "same_tool", reasonVars: { tool: nextToolName, count: sameToolFailCount + 1 } }
  }
  if (sameToolFailCount + 1 >= config.sameToolFailureWarn) {
    return { action: "warn", reasonKey: "same_tool", reasonVars: { tool: nextToolName, count: sameToolFailCount + 1 } }
  }

  // no-progress: 连续同 (toolName, argsHash) 成功但输出相同
  let noProgressCount = 0
  let firstOutput: string | undefined
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]
    if (p.toolName !== nextToolName || p.argsHash !== nextHash || p.failed) break
    if (firstOutput === undefined) firstOutput = p.outputContent
    if (p.outputContent !== firstOutput) break
    noProgressCount++
  }
  if (noProgressCount + 1 >= config.noProgressBlock) {
    return { action: "block", reasonKey: "no_progress", reasonVars: { tool: nextToolName, count: noProgressCount + 1 } }
  }
  if (noProgressCount + 1 >= config.noProgressWarn) {
    return { action: "warn", reasonKey: "no_progress", reasonVars: { tool: nextToolName, count: noProgressCount + 1 } }
  }

  return { action: "proceed" }
}
```

- [ ] **Step 4: 跑测试通过**

```bash
npx vitest run src/lib/copilot/__tests__/tool-loop-detector.test.ts
```

Expected: 全绿。如果 fail 检查 isFailure / argsHash / collectTrailingPairs 是否符合 expectation，调实现而不是改测试预期（除非测试本身有错）。

- [ ] **Step 5: 移除硬 cap，插 analyzeToolLoop + emit loop_warn**

修改 `src/app/api/copilot/sessions/[id]/tool-result/route.ts`：

a) **删除** 旧 `countTrailingToolUsePairs` 函数 + 调用：

```ts
// 删除：
// const branchBefore = getActiveBranch(sessionId)
// const completedPairs = countTrailingToolUsePairs(branchBefore)
// if (completedPairs >= 5) return jsonError(429, 'chain call limit reached')
// 删除文件底部 countTrailingToolUsePairs 函数定义
```

b) 这里其实是处理"用户已 confirm 的 tool 结果"，**不需要在这里跑 analyzeToolLoop**（loop 检测应该在下一次 LLM tool_use_end 触发自动执行时）。但留个安全网仍合理：在 callling runTool 之前、有 `body.denied !== true` 的分支前加：

```ts
// v2.5 P0 §3.4: 从硬 cap 5 改成 hermes 三档重复检测。
// 这里的 next tool 是 body.tool_name + body.input
import { analyzeToolLoop } from '@/copilot/lib/tool-loop-detector'

// ... 拿到 branchBefore 之后:
const branchBefore = getActiveBranch(sessionId)
if (body.denied !== true) {
  const decision = analyzeToolLoop(branchBefore, body.tool_name, body.input)
  if (decision.action === 'block') {
    // 早返 429 + reasonKey 给 client
    return new Response(
      JSON.stringify({
        error: 'tool-loop blocked',
        loop_reason_key: decision.reasonKey,
        loop_reason_vars: decision.reasonVars,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )
  }
  // warn 不 block，记录 SSE 事件，下面 stream start 后 emit
  if (decision.action === 'warn') {
    // 留给后面 stream emit
    var loopWarnDecision = decision  // hoisted var 故意，stream 闭包用
  }
}
```

实现注意：因为 SSE stream 在 `new ReadableStream({ async start(controller) { ... } })` 才能 write，所以要把 `loopWarnDecision` 提到外层作用域：

```ts
// route handler 顶部:
let loopWarnDecision: ToolLoopDecision | null = null
// ... 在 if 块里赋值
loopWarnDecision = decision

// stream.start 闭包里:
if (loopWarnDecision && loopWarnDecision.action === 'warn') {
  write({
    kind: 'loop_warn',
    call_id: body.call_id,
    reason_key: loopWarnDecision.reasonKey,
    reason_vars: loopWarnDecision.reasonVars,
  })
}
```

c) 类似地在 `src/app/api/copilot/sessions/[id]/chat/route.ts` 加一遍（如果 chat 路由也涉及自动 tool_use 触发）。先读 chat/route.ts 全文确认是否有相同的硬 cap，再做对称改。注意 chat 路径上 LLM 的 tool_use_end 是流中产生的，stream-response.ts 才是 hook 的位置；如果 chat 不直接预检，跳过 chat 分支的改动。

- [ ] **Step 6: client 处理 loop_warn 事件**

修改 `src/components/copilot/use-chat-stream.ts`：

a) `ChatSseEvent` union 加 `loop_warn`：

```ts
type ChatSseEvent =
  | ... // 原有
  | { kind: "loop_warn"; call_id: string; reason_key: string; reason_vars: { tool: string; count: number } }
```

b) handler 里加分支：

```ts
} else if (ev.kind === "loop_warn") {
  setMessages(prev => [
    ...prev,
    {
      role: "system_notice",
      kind: "loop_warn",
      reasonKey: ev.reason_key,
      reasonVars: ev.reason_vars,
    },
  ])
}
```

c) `postToolResult` 里 `if (!resp.ok)` 块加 429 with `loop_reason_key` 处理：

```ts
if (!resp.ok) {
  const text = await resp.text()
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch {}
  const obj = parsed as { loop_reason_key?: string; loop_reason_vars?: { tool: string; count: number }; error?: string } | null
  if (resp.status === 429 && obj?.loop_reason_key) {
    setMessages(prev => [
      ...prev,
      {
        role: "system_notice",
        kind: "loop_block",
        reasonKey: obj.loop_reason_key!,
        reasonVars: obj.loop_reason_vars ?? { tool: tool_name, count: 0 },
      },
    ])
  } else if (resp.status === 429) {
    onError(p.tI18nChainLimit)
  } else {
    onError(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }
  return
}
```

- [ ] **Step 7: chat-view-parts UiMessage union 加 system_notice**

修改 `src/components/copilot/chat-view-parts.tsx`，找 `UiMessage` 定义，加：

```ts
| {
    role: "system_notice"
    kind: "loop_warn" | "loop_block"
    reasonKey: string
    reasonVars: Record<string, string | number>
    id?: string
  }
```

加 `SystemNoticeBubble` 组件（panel 内部扁平 + 轻量 amber tinted；遵循 AGENTS.md "轻量 tinted 表面"约定）：

```tsx
function SystemNoticeBubble({
  kind,
  reasonKey,
  reasonVars,
}: {
  kind: "loop_warn" | "loop_block"
  reasonKey: string
  reasonVars: Record<string, string | number>
}) {
  const t = useT()
  const i18nKey = `copilot.loop.${kind === "loop_warn" ? "warn" : "block"}.${reasonKey}`
  return (
    <div
      className={
        kind === "loop_block"
          ? "rounded-md px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-2"
          : "rounded-md px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-2"
      }
    >
      <span aria-hidden>{kind === "loop_block" ? "⛔" : "⚠️"}</span>
      <span>{t(i18nKey, reasonVars)}</span>
    </div>
  )
}

export { SystemNoticeBubble }
```

- [ ] **Step 8: chat-view 渲染 system_notice 分支**

修改 `src/components/copilot/chat-view.tsx`，找渲染 messages 的 map（应该在 MessageRow 调用周围），加：

```tsx
{stream.messages.map((m, i) => {
  if (m.role === "system_notice") {
    return <SystemNoticeBubble
      key={m.id ?? `notice-${i}`}
      kind={m.kind}
      reasonKey={m.reasonKey}
      reasonVars={m.reasonVars}
    />
  }
  if (m.role === "tool_use") {
    return <ToolCallCard ... />  // 原逻辑
  }
  return <MessageRow ... />  // 原逻辑
})}
```

import `SystemNoticeBubble` from chat-view-parts。

- [ ] **Step 9: 加 6 条 i18n key**

`src/lib/i18n/zh.ts` 新增：

```ts
"copilot.loop.warn.exact_failure": "工具 {{tool}} 以相同参数连续失败 {{count}} 次，下一次相同调用可能被中止",
"copilot.loop.warn.same_tool": "工具 {{tool}} 连续失败 {{count}} 次，可能陷入死循环",
"copilot.loop.warn.no_progress": "工具 {{tool}} 以相同参数重复 {{count}} 次但输出相同，可能无进展",
"copilot.loop.block.exact_failure": "已阻止：工具 {{tool}} 以相同参数连续失败 {{count}} 次",
"copilot.loop.block.same_tool": "已阻止：工具 {{tool}} 连续失败 {{count}} 次",
"copilot.loop.block.no_progress": "已阻止：工具 {{tool}} 重复调用但输出相同 {{count}} 次",
```

`en.ts`：

```ts
"copilot.loop.warn.exact_failure": "Tool {{tool}} failed {{count}} times with the same args; next identical call may be blocked",
"copilot.loop.warn.same_tool": "Tool {{tool}} failed {{count}} times in a row; possible loop",
"copilot.loop.warn.no_progress": "Tool {{tool}} called {{count}} times with same args + same output; no progress",
"copilot.loop.block.exact_failure": "Blocked: tool {{tool}} failed {{count}} times with the same args",
"copilot.loop.block.same_tool": "Blocked: tool {{tool}} failed {{count}} times in a row",
"copilot.loop.block.no_progress": "Blocked: tool {{tool}} called {{count}} times with no progress",
```

- [ ] **Step 10: integration 测试**

新建 `src/lib/copilot/__tests__/tool-loop-detector.integration.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { analyzeToolLoop } from '../tool-loop-detector'
import type { CopilotMessage } from '../types'

// 这个 integration 验证：原硬 cap 5 不再触发 block；新机制按"错误模式"工作。
describe('tool-loop-detector integration（v2.5 P0）', () => {
  let tmp: string, origCwd: string
  beforeEach(() => {
    origCwd = process.cwd()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-loop-'))
    process.chdir(tmp)
  })
  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('5 次成功 read_context 不被 block（原硬 cap 失效）', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 5; i++) {
      branch.push({
        id: `tu_${i}`, session_id: 's', role: 'tool_use',
        content: '', timestamp: 't',
        call_id: `c${i}`, tool_name: 'read_context', tool_input: { id: `ctx_${i}` },
      })
      branch.push({
        id: `tr_${i}`, session_id: 's', role: 'tool_result',
        content: JSON.stringify({ value: `v${i}` }), timestamp: 't',
        call_id: `c${i}`, tool_name: 'read_context',
      })
    }
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_6' })
    expect(r.action).toBe('proceed')  // 原 cap 5 这里会 block，新机制 proceed
  })
})
```

- [ ] **Step 11: 跑全 vitest + tsc + lint**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: 全绿。如果 lint warn 新代码（unused / no-var），修。

- [ ] **Step 12: Commit**

```bash
git add src/lib/copilot/tool-loop-detector.ts \
        src/lib/copilot/__tests__/tool-loop-detector.test.ts \
        src/lib/copilot/__tests__/tool-loop-detector.integration.test.ts \
        src/app/api/copilot/sessions/[id]/tool-result/route.ts \
        src/app/api/copilot/sessions/[id]/chat/route.ts \
        src/components/copilot/use-chat-stream.ts \
        src/components/copilot/chat-view-parts.tsx \
        src/components/copilot/chat-view.tsx \
        src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "$(cat <<'EOF'
feat(copilot): chain cap 从硬数步换成 hermes 三档重复检测

来源 hermes tool_guardrails.py:71。
- exact-failure: 同 (tool, argsHash) 失败 2 次 warn / 5 次 block
- same-tool: 同工具失败 3 次 warn / 8 次 halt
- no-progress: 同 args 成功但输出 identical 2 次 warn / 5 次 block

正常多步 LLM 任务（4 次 read_context + 1 次 edit）不再被误 429。
新增 system_notice 消息类型 + GlassWarning/GlassDanger 风格 SystemNoticeBubble
渲染 warn / block 提示，遵循 panel 扁平 + 轻量 tinted 约定。

Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CHANGELOG + build + 手动回归

- [ ] **Step 1: 更新 CHANGELOG.md `[Unreleased]`**

打开 `CHANGELOG.md`，找最顶部的 `## [Unreleased]` 段，添加（如已有 Unreleased 但内容为空就直接填）：

```md
## [Unreleased]

### Copilot (v2.5 P0 二轮采纳)

基于 v0.9.0 ship 后对 CCB / hermes / openclaw 三 repo 原代码的深入调研，对 v2.5 参数和机制做 4 处修正：

- **approxTokens 分三层分岔 + image 补偿**（CCB `tokenEstimation.ts:227` + hermes `context_compressor.py:65`）：JSON content ÷2、中文 heavy(>30% CJK) ÷1.5、其他 ÷4；每张图片 url 补偿 1600 tokens。修复 microCompact `maxTotalReplayableTokens=4000` 在 JSON tool_result 上被低估 2 倍的漏洞。
- **aggregateCacheHitRate noise floor**（openclaw `prompt-cache-observability.ts:51`）：drop ≥ 1000 tokens 且 ratio < 0.95 才算 break。chip 新增 `· N breaks (past 7d)` 段（仅 >0 时显示）。
- **session_deny_list 对称到 alwaysAllow**（CCB `alwaysDenyRules` + openclaw allow-once/always/deny UI）：Deny 卡新增 "Always deny in this session" checkbox。confirmGate 优先级 deny > allow > 默认 confirm。
- **chain cap 机制从硬数步 5 换成 hermes 三档重复检测**（`tool_guardrays.py:71`）：原硬 cap 移除，替换为 exact-failure 2/5、same-tool 3/8、no-progress 2/5 的 analyzeToolLoop。新增 SystemNoticeBubble UI 渲染 warn/block 提示。**用户感知**：以前 4 次 read_context + 1 次 edit 撞 429 的情况现在 proceed；新增"重复失败"block 场景。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md
```

- [ ] **Step 2: 跑完整验证**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: 全绿。如果 build fail 修后再来；如果 lint 只 warn 不 error 可放过（项目允许 warn）。

- [ ] **Step 3: 手动回归（dev server）**

```bash
npm run dev
```

打开 `http://localhost:3000`，按以下步骤验证：

1. **测 deny UI**：
   - ⌘K 打开 Copilot
   - 让 LLM 调 `restart_experiment`（在某 experiment 详情页发 "重跑这个实验"）
   - 等 Confirm 卡出现，点 "Deny" → 看到 reason input + "Always deny in this session" checkbox
   - 勾上 + 输入 reason + 点 Deny confirm
   - 再让 LLM 调 `restart_experiment`（同一 session 内）→ 应该直接 deny 不弹 Confirm 卡
   
2. **测 allow UI**（回归原行为）：
   - 让 LLM 调 `edit_template`
   - Confirm 卡 → 勾 "Always allow" → Confirm
   - 再让 LLM 调 `edit_template` → 直接 proceed
   
3. **测 chain loop（warn）**：
   - 造一个让 LLM 用相同参数重复调 `read_tool_result(ref="x")` 2 次成功但输出相同的对话
   - 第 2 次后，应该看到 ⚠️ amber SystemNoticeBubble，文案 "工具 read_tool_result 以相同参数重复 2 次但输出相同"
   
4. **测 chain loop（block）**：
   - 继续上面对话让 LLM 第 5 次调 `read_tool_result` 同 ref
   - 应该看到 ⛔ red SystemNoticeBubble，文案 "已阻止：工具 read_tool_result 重复调用但输出相同 5 次"
   - LLM 后续无该 tool 调用
   
5. **测 cache chip**：
   - 跑 2-3 轮 copilot 对话
   - chip 文字应该是 "Cache: 本会话 X% · 近 7 天 Y%"（原行为）
   - 如果触发过 cache break，第三段显示 "· N 次 break"（hover tooltip 解释 noise floor）
   - 如果没 break 第三段不显示（不要空白 chip）
   
6. **测 approxTokens 中文 / JSON 估算**（间接验证）：
   - 跑一个产 large JSON tool_result 的工具调用（比如 `read_experiment_results` group_by）
   - 同一 session 跑 5 轮，看 microCompact 是否在 4K token 阈值附近触发（可在 dev console 加 `console.log('compacted', didCompact)` 验证；或查 `data/copilot/sessions/{sid}.jsonl` 看 boundary 出现频率）

ALL 6 项绿才进 Step 4。

- [ ] **Step 4: Push branch + 创建 PR**

```bash
HTTPS_PROXY=127.0.0.1:7890 git push -u origin feat/copilot-v25-p0-ccb-hermes-openclaw
```

创建 PR：

```bash
HTTPS_PROXY=127.0.0.1:7890 gh pr create \
  --title "Copilot v2.5 P0: CCB / hermes / openclaw 二轮采纳" \
  --body "$(cat <<'EOF'
## 改了什么

基于 v0.9.0 ship 后对 CCB / hermes / openclaw 三 repo 的深入调研（agent 直接抓 GitHub 原代码），对 v2.5 做 4 处修正：

1. **approxTokens 分岔 + image 补偿** — JSON ÷2 / 中文 ÷1.5 / 其他 ÷4 / 每张图 +1600 tokens
2. **cache break noise floor** — drop ≥1000 且 ratio <0.95 才算 break + chip 加 "N breaks" 段
3. **session_deny_list 对称** — Deny 卡 alwaysDeny checkbox + confirmGate deny > allow 优先级
4. **chain cap 三档重复检测** — exact-fail 2/5、same-tool 3/8、no-progress 2/5 替代硬数步 5

## 为什么

- 上一轮 spec(`2026-05-07-copilot-v25-context-followups-design.md`) 砍 openclaw 6 break 原因码 / hermes 4-breakpoint 时基于"实施复杂度大"，但实际抓 repo 才发现都是几十行的事
- v0.9.0 实测 approxTokens=len/4 在 JSON tool_result 上低估 2 倍，maxTotalReplayableTokens=4000 失效
- 用户场景"我永远不想 LLM 跑 restart_experiment"现状只能改源码

## 怎么验证

- 单测全覆盖（30+ 新 case）：approxTokens 分岔 / image 补偿 / detectCacheBreak / countRecentBreaks / isSessionDenied / deny>allow / analyzeToolLoop 三档
- Integration 测试 1 条：硬 cap 5 已被取代，5 次成功 proceed
- 本地手动 6 条 dev server 回归（deny UI / allow UI / loop warn / loop block / cache chip / approxTokens 间接）

## 向后兼容风险

- **chain cap 行为变化用户可感知**：以前 4 次 read_context + 1 次 edit 撞 429，现在 proceed；新增"重复失败" block 场景
- session_deny_list 是 sessionStorage per-tab，关 tab 即清；不影响其他用户 session
- approxTokens 改动是内部纯函数，无外部 API 影响
- cache-stats response 新增 `weekly.recent_breaks/total_pairs_considered` 字段；旧 client 忽略不影响

Spec: `docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md`
Plan: `docs/superpowers/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md`
EOF
)"
```

PR 创建后等 CI（verify + e2e）跑通，告诉用户 PR URL，等 review。

- [ ] **Step 5: PR merge 后清理本地**

merge 后（用户走 `gh pr merge --merge`）：

```bash
git checkout main
git pull
git branch -D feat/copilot-v25-p0-ccb-hermes-openclaw
```

PR2（4-breakpoint + break detection）走另起一个 spec + plan，不在本 plan 范围。

---

## Self-Review

### Spec coverage 检查

| Spec 要求 | Plan Task | 覆盖？ |
|---|---|---|
| §3.1 approxTokens 分三层 | Task 1 Step 3 | ✅ |
| §3.1 image 补偿 1600 tokens | Task 1 Step 1+3 | ✅ |
| §3.2 detectCacheBreak | Task 2 Step 1+3 | ✅ |
| §3.2 countRecentBreaks | Task 2 Step 1+3 | ✅ |
| §3.2 chip 第三段 UI | Task 2 Step 7 | ✅ |
| §3.3 isSessionDenied + helpers | Task 3 Step 1+3 | ✅ |
| §3.3 confirmGateHook deny > allow | Task 3 Step 1+4 | ✅ |
| §3.3 wire format body 加 deny_list | Task 3 Step 6+7 | ✅ |
| §3.3 ToolCallCard alwaysDeny checkbox | Task 3 Step 8 | ✅ |
| §3.4 analyzeToolLoop 三档 | Task 4 Step 1+3 | ✅ |
| §3.4 移除硬 cap | Task 4 Step 5 | ✅ |
| §3.4 SystemNoticeBubble warn UI | Task 4 Step 7+8 | ✅ |
| §5.1 单测全覆盖 | Task 1/2/3/4 各 Step 1 | ✅ |
| §5.2 integration 测试 | Task 4 Step 10 | ✅ |
| §5.3 手动回归 | Task 5 Step 3 | ✅ |
| §6 向后兼容 | PR description | ✅ |
| §7 CHANGELOG | Task 5 Step 1 | ✅ |

### Placeholder scan

无 TODO / TBD / "implement later" / 空步骤。

### Type consistency

- `analyzeToolLoop` 返回 `ToolLoopDecision` discriminated union，handler 各处用 action 分流。✅
- `PreToolCallCtx.session_deny_list?: string[]` 与 `runTool` opts.sessionDenyList 名字一致。✅
- `ChatSseEvent` `loop_warn` 用 snake_case `reason_key` / `reason_vars`（wire format 习惯），UiMessage 改 camelCase `reasonKey` / `reasonVars`（TS 习惯）；handler step 6 已经做了转换。✅

### 可能的实施踩坑

1. **chat/route.ts 的对称改动需要先读全文**：Task 3 Step 6 + Task 4 Step 5 都说"chat 路由也要改但具体位置由 implementer 定"；implementer 先读 chat/route.ts 完整 200 行再做 —— spec 说的不能瞎传。
2. **`var loopWarnDecision` hoisted var 风格** lint 可能 warn；也可以用闭包外的 `let` 变量。implementer 自己选 —— 测试通过即可。
3. **chat-view.tsx 渲染 messages 的具体 map 位置** 我没读到文末；Task 4 Step 8 只给了 fragment 示意，implementer 要找到原 `stream.messages.map(...)` 然后 inject system_notice 分支。
