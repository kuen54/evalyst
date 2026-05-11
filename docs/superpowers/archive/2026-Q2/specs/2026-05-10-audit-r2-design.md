# Round 2 Audit · Master Spec

> **Source**: [`docs/code-review-round-2.md`](../../../code-review-round-2.md) · baseline `b26c6a9` (v0.13.0).
> **Purpose**: 把 round 2 的 5 项 fix（Tier 1 #A + #D / Tier 2 #B + #C / Tier 3 cleanup）拆 Phase + 锁 scope，写明本轮**不修**的项 + 理由。
> **同期 plan**：每个 ≥ 1d 的项配独立 lightweight plan（≤ 100 行）。

## 1. Phase 排序 + Rationale

```
Phase 1 — 域核心补测       1.5d  #D   ← 本 spec 触发
Phase 2 — 速胜批 (3 项)    1.5d  #B + #C + Tier 3
Phase 3 — Glass primitive 切边  2d   #A
                                 ─────
                                 ~5d
```

**为什么 Phase 1 先于 #A**：

- #A 触 40+ import 站点；TS 抓引用，行为破不破靠测试 + UI 实测兜底
- 4 个 0% 模块意味着改 Glass primitive 时若不慎触发 `datasets / displays / result-parser / rubric-store` 调用链没人告诉你 → e2e 5 分钟才知道
- Phase 1 的 1.5d 投入换 Phase 3 的"敢动"

**Phase 2 居中**：3 项各 0.5d、互不依赖、零阻塞——批量进 PR 收完，让 Phase 3 看到的是干净基线（file-lock / docker-compose / Dockerfile 不再是"需要测的变量"）。

**跨 Phase 顺序硬**；同 Phase 内可独立 commit / PR。

## 2. 五项 Fix · Scope / 验收 / 文件

### Phase 1 · #D · 域核心 4 个 0% 模块单测（1.5d）

> 详见 [`docs/superpowers/plans/2026-05-10-audit-r2-domain-tests.md`](../plans/2026-05-10-audit-r2-domain-tests.md)。

**Scope**：纯增量测试，**零行为变更**。

**验收硬指标**：
- `src/lib/{datasets,displays,result-parser,rubric-store}.ts` 各自 statements ≥ 80%
- 域 `lib/` 整体 stmts 56.86% → ≥ 75%
- 每模块覆盖：业务 happy path + ≥ 2 条 error / edge case
- `npm test` 全绿；`npm run knip` 干净；`npx tsc --noEmit` 0 错

**受影响文件**：仅 `src/lib/__tests__/{datasets,displays,result-parser,rubric-store}.test.ts` 4 个新增文件。**不动 implementation**——`as unknown as` 也好、CCN 23 的 `parseResponse` 也好都按现状测，签名不动。

**模块顺序**（难度递增）：rubric-store → result-parser → displays → datasets。每模块独立 branch + commit + PR + merge。

### Phase 2 · #B · middleware 真名化 + LAN 攻击者 doc（0.5d）

**Scope**：
- `src/middleware.ts` 注释顶头改 "CSRF gate (NOT auth)"
- `README.md` 加 "Deployment caveat — does NOT support exposing :3000 to LAN"
- `docker-compose.yml` 改 `127.0.0.1:3000:3000` 绑 loopback

**验收**：grep `RCE` / `auth gate` 在 middleware 注释里 → 0；README 出现 caveat 段；compose 端口绑 loopback。**不改实现**（CSRF gate 本身正确）。

### Phase 2 · #C · file-lock O_EXCL + 并发 race test（0.5d）

**Scope**：`acquireLock` 改 `fs.openSync(p, 'wx')`，EEXIST → 走 stale 检测；新增 `Promise.all([acquireLock, acquireLock])` race test 期望恰好 1 true / 1 false。

**验收**：新测试 fail-on-current-impl → pass-after-fix。

**注**：不预设 "时间溢出退降级" 路径——5 行 + 1 测试是 0.5d 内绝对量级。若实际碰到拦路问题（不该有），开新 PR 单独讨论降级方案，不在本 spec 留口子。

### Phase 2 · Tier 3 cleanup batch（0.5d）

**Scope**：
- `Dockerfile` 加 `USER node`（round 1 §S7 漏项）
- `npm audit` 评估升级爆炸半径，至少处理 postcss 直接依赖
- chrome-up / chrome-down Glass variant 折叠回 chrome 通用变体或 inline 到唯一调用点
- `npm outdated` 17 个 patch 升级（lucide-react / @babel/standalone / nanoid 等）— 仅 patch，不跨 minor

**验收**：`docker run` 默认 user 非 root；audit 报告高危项处理；GlassVariant union 减少；`npm outdated` 绿色项 ≥ 80% 清零。

> **Errata E7 (2026-05-10)**: Dockerfile USER/chown 子项已在 R1 commit 98be5f1 完成（v0.13.0 baseline），本 Phase 2 T3 omit。详见 docs/code-review-round-2.md §Errata E7。

### Phase 3 · #A · Glass primitive 物理切边（2d）

**Scope**：
- 新 `src/components/glass/` 收 `shell.tsx` / `sticky-chrome.tsx` / `glass-segmented.tsx`
- `src/copilot/components/store.tsx` 提最小接口到 `src/components/glass/copilot-context.ts`，shell/segmented 用 prop 而非直接 import store
- `src/copilot/` 子树只保 panel / chat-view / tool-call-card / inspector / use-chat-stream / use-page-context

**验收硬指标**：`grep -rln '@/copilot/components' src/components src/app | wc -l` ≤ 5（剩下应是真 Copilot 触点：⌘K hook / store consume）。

**受影响**：4 shadcn ui (button/dialog/select/sticky-save-bar) + 9 settings 页面 = ~40 import 站点。**前置依赖**：Phase 1 全 merge（domain 测兜底）+ Phase 2 全 merge（隔离变量）。

## 3. 决策日志 · Round 2 不修的项

| 项 | round 2 评 | 决策 | 理由 |
|---|---|---|---|
| `applyTransforms` CCN 47-48 仍未拆 | round 1 漏 | **不修** | round 2 四人组：Carmack "CCN 大不一定坏" + DHH "不是必修" + Abramov "拆要拆好，缓即可"。等真碰需求时再拆，cosmetic 拆只会引 bug。 |
| `validateJson` CCN 61 + default 分支已加 | OK | **不修** | exhaustive `never` check 已守未来；CCN 高纯逻辑 not bug。round 2 §第 0 步明示 "够了"。 |
| Glass UI 9 档死变体（chrome-up/down 各 1 用例） | 记一笔 | **Phase 2 Tier 3 处理** | DHH "证据说话——不是 9 档系统" — 折叠回 chrome 通用变体或 inline 到唯一调用点（已纳入 Tier 3）。 |
| `as unknown as` 8 处（round 1 5 → round 2 8） | OK | **不修** | 全是预存 + 1-2 迁移期遗留；tsc strict 没强迫多写。Linus "证明域代码本来就健康"。 |
| 88/96 use-client（React 19 hydration） | 沿用 errata E4 决定 | **不修** | 已在 round 1 errata E4 决定走 localStorage hydration suppress + 链 `docs/conventions/react19-hydration.md`，不在本轮 audit scope。 |
| `parseResponse` CCN 23 的实现 | 测试驱动建议 | **不重构实现** | 测试驱动的 "顺手 refactor" 是 Plan-外偏离。先靠 Phase 1 单测把 4 路径锁住；CCN 真碰瓶颈再独立 PR 拆。 |
| `validateDisplay` CCN 22 的实现 | 同上 | **不重构实现** | 同上。 |
| S3 middleware 不拦 LAN curl | 已注释自陈 | **Phase 2 #B 仅文档** | 实现走 Sec-Fetch-Site 是对的（browser-attested CSRF），名字错的部分纯 doc/comment 修。 |
| Copilot tools count 文档说 9 个 | 验过对 | **不动** | round 2 §FAQ 抽查 15/15 ✓ 准确。 |
| Lock TOCTOU 残留 | major | **Phase 2 #C 修** | O_EXCL 5 行修复，已纳入 Phase 2。 |

## 4. 工作流约定（沿用 round 1）

- **本 spec**（≤ 200 行）：Phase 顺序 + scope + 决策日志，**不复述 round 2 报告**。
- **Phase 1 plan**（≤ 100 行）→ `docs/superpowers/plans/2026-05-10-audit-r2-domain-tests.md`
- **Phase 2 plan**（3 项打包，每项 ≤ 30 行块） → `docs/superpowers/plans/2026-05-10-audit-r2-quick-wins.md`（Phase 1 后再写）
- **Phase 3 plan**（2d，最大风险） → `docs/superpowers/plans/2026-05-10-audit-r2-glass-extraction.md`（Phase 2 后再写）
- 每项一个 PR，分支命名按 AGENTS.md（`test/r2-{module}-coverage` / `fix/r2-csrf-rename` / `refactor/r2-glass-primitive-extraction` 等）
- 跨 Phase 严格按顺序；同 Phase 内可独立 commit / PR
- **严禁**：1000+ 行史诗 plan（round 1 反模式）；Plan-外 scope 偏离（AGENTS.md §5）；自合 PR

## 5. CHANGELOG 锚点

每 PR 在 `[Unreleased]` 段加：
- Phase 1 → `### 测试 (#R2-D)`
- Phase 2 #B → `### Security (#R2-B)`  
- Phase 2 #C → `### Fixed (#R2-C)`
- Phase 2 Tier 3 → `### Cleanup (#R2-T3)`
- Phase 3 → `### Refactor (#R2-A)`

全 Phase 合完 + 实测一轮稳定，再考虑 tag v0.14.0（按 AGENTS.md §4，"merge 后观察一两天稳定再打"）。

## 6. 不在本 spec 的事项

- **本轮 audit 后的下一轮**：round 3 等 v0.14 + 一段时间 churn 后再启动，本 spec 不预测下一轮 scope。
- **Copilot 内部测试**：Copilot lib/ 78% 已健康，本轮不补；如 Phase 3 切边引出新 gap 则补。
- **e2e 扩展**：Phase 1 是单测增量；e2e 现有 10 specs 在 Phase 3 后跑全套验收一次即可。
