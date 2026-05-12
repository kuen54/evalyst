# Evalyst 第三次代码质量审视报告

> **Round 3** · 基于 `0b88d20` (HEAD on tag v0.14.2)
> 视角：Linus / Carmack / DHH / Abramov（同 r1 / r2）
> 上轮报告：[`docs/code-review-round-2.md`](./code-review-round-2.md)（v0.13.0 baseline）+ r2 follow-up 三 PR 收到 v0.14.2

## 第 0 步 · 总判断

**基本干净。0 项新 finding。**

R2 三阶段 + r2-followup 三 PR 全部 land（v0.13.0 → v0.14.2，14 commits / 2,715 insert / 415 delete in 20 天）。R2 标的 4 项 fix（A Glass primitive 切边 / B middleware CSRF 真名化 / C file-lock O_EXCL / D 域核心 4 模块 0% 覆盖）都已 ship 且**仍立得住**。这 20 天 cumulative churn 里 ~73% 是 tests + import-path renames（Glass primitive 物理迁移），真新行为代码只有 **52 行**（probe-session.ts 21 + copilot-context.tsx 31）+ confirm-glass.spec.ts 60 行。

按用户在 brief 里写的 litmus（"6 个月后会怎么样"），扫了一遍我没找到任何"会持续吃 onboarding / 会让某次改动炸 / 会让某条数据丢"的 surface。npm audit 从 r2 的 6 项降到 2 项，knip / lint / tsc / madge / build 全绿，覆盖 75.66% statements（r2 时是 68.14%），810 测试 / 79 文件全过。

**结论**：直接推 r3 backlog 8 项即可，无需新一轮 cleanup phase。

---

## 第 1 步 · 量化 baseline (round 3)

### 代码规模 (vs r2)

| 区块 | 文件 | LOC code | r2 → r3 |
|---|---|---|---|
| `src/` 全量 (scc, code only) | 308 TS | **35,235** | 35,069 → 35,235 (+166) |
| `src/copilot/` (含 tests) | 124 | 14,726 | 18,218 → 14,726 (Glass primitive 迁出) |
| `src/lib/` (含 tests) | 61 | 8,044 | ~8k → 8,044 |
| **`src/components/glass/`（新）** | 4 + tests | ~280 | 0 → 280（r2 #A 切出） |

scc 全量：**35,790 LOC TS / 5,028 复杂度 / 310 文件**（r2: 35,069 / 5,005 / 302 — 几乎平）。

### 工具量化（r2 → r3）

```
tsc --noEmit:                0 → 0           ✓
npm run lint:                clean → clean   ✓
npm run knip:                clean → clean   ✓ (5 config hints, 不是 unused)
madge --circular:            0 → 0           ✓
lizard 警告 (CCN>15):        27 → 27         ⚪ 同样 27 个，applyTransforms CCN 47 / validateJson CCN 61 不变
npm audit:                   6 (5M+1H) → 2 (M)   ✓ R2 #T3 sub-a "npm audit fix" 拿掉了 4 项
npm outdated:                17 → 6           ✓ patch-only batch (R2 #T3 sub-c) 收完
clean build time:            9.75s → 9.05s    ⚪ 平
prod bundle (.next/server):  51 MB → 45 MB    ⚪ 微缩
as unknown as (prod):        8 → 8           ⚪ 不变
console.* (prod):            7 → 7           ⚪ 不变
```

### 测试 (vs r2)

- vitest unit: 74 → **79 文件**（+5：probe-session / domain core 4 个）
- e2e specs: 10 → **11 文件**（+1：confirm-glass.spec.ts）
- 测试用例：772 → **810 cases pass**（+38）
- **Coverage**（v8 报告，全量）：
  - Statements **75.66%** (r2: 68.14%, **+7.5pp**)
  - Branches **68.72%** (r2: 62.5%)
  - Functions **74.86%** (r2: 68.19%)
  - Lines **78.5%** (r2: 71.22%)
- 域核心 4 个 0% 模块（r2 #D）现在：`datasets.ts` 98% / `displays.ts` 98% / `result-parser.ts` 97% / `rubric-store.ts` ~95%

### git churn (since v0.13.0, 20 天)

```
14 PR / 52 commits / 72 files changed / 2,715 insert / 415 delete
+2,300 net LOC（其中 1,073 是 4 个域核心 test files + 31 line confirm-glass spec）
top-touched: CHANGELOG.md (17), shell.tsx (3), sticky-chrome.tsx (3), package.json (3),
             middleware.ts (2), batch-runner-lock.ts (1), store.tsx (2)
```

真新行为代码 surface：
- `src/copilot/components/probe-session.ts`（21 LOC）—— session id 三态 probe（exists / not_found / unknown）
- `src/components/glass/copilot-context.tsx`（31 LOC）—— Glass primitive 与 Copilot store 的最小耦合接口
- `src/app/layout.tsx` Provider 嵌套换序（PR-2，3 行有效 diff）

剩下都是：(a) Glass primitive 从 `src/copilot/components/` → `src/components/glass/` 物理迁移 + 31 import 路径更新；(b) 4 个 domain core test 文件新增；(c) middleware.ts JSDoc 重写；(d) batch-runner-lock O_EXCL 切换（acquireLock 30 行重写）。

---

## 第 2 步 · 维度评估（聚焦 r2 → r3 变化）

每条只写状态变化；"vs r2 不变"直说。

### 1. 架构与边界 — **r2 #A 闭环，但 R2 acceptance ≤5 sites 没达到**

`src/components/glass/{shell,sticky-chrome,glass-segmented,copilot-context}.tsx` 已切出，shadcn `button/dialog/select/sticky-save-bar` 现 import `@/components/glass/*` 而非 `@/copilot/components/*`。验证：

```
$ grep -rln '@/copilot/components' src/components src/app | wc -l
17
```

R2 #A 期望 ≤5。剩下 17 是什么——

- `useRegisterPageContext` × **14 pages** —— 每个登记到 Copilot 的页面都要 import 这一个 hook（按设计如此）
- `src/app/layout.tsx` 8 行 import —— `CopilotStoreProvider` / `CopilotPanel` / `InspectorOverlay` / `ContextMask` / `GlowOverlay` / `MaterialRevealOverlay` / `TextSelector` / `TextSelectionMask`（layout 顶层挂 Copilot 浮层）

- **Linus**："这 17 个不是反向耦合——是 Copilot 自己的合法消费点。R2 写 ≤5 是假设把 page-context registration 也外提到中性接口；没做就不做了，14 个 page 都 import 同一 hook 不算坏味。"
- **Carmack**："验证是 'rm -rf src/copilot 编不编'。试——理论上现在 layout / 14 pages / api/copilot/* 都会断，但断的都是 Copilot 自己的 entry point。Glass primitive 子系统能编（在 `src/components/glass/`）——边界画对了。"
- **DHH**："R2 acceptance 写 ≤5 是 spec bug，不是实现 bug。"
- **Abramov**："这条算关。"

**裁决**：四人一致 **r2 #A 实质完成**，R2 写的 ≤5 是 spec 写时没意识到 useRegisterPageContext 是 14-page 集成 hook。**不修**——补一句 R2 errata 即可。

### 2-12 各维度 — **vs r2 无变化**

| # | 维度 | r2 状态 | r3 |
|---|---|---|---|
| 2 | 代码质量 | minor (大文件削峰失败) | **不变**——`use-chat-stream.ts` 597 行（r2 时也是）。无紧迫修复理由。 |
| 3 | 抽象成本 | minor 改善（manifest unused 全清） | **不变**——knip 仍 0 unused。 |
| 4 | 错误处理 | minor (DNS rebinding by-design) | **不变**。 |
| 5 | TS 严格度 | 修复成功（三严格全开） | **不变**——tsc --noEmit 仍 0 错。`as unknown as` 8 处不增不减。 |
| 6 | 测试 | major 未解决（域核心 0%） | **修好**——4 模块 0% → 95-98%。覆盖 68% → 75.66%。 |
| 7 | 性能 | 解决（cartesian cap） | **不变**。 |
| 8 | 安全 | major 改善但有残留 | **微改善**——npm audit 6 → 2；middleware 真名化 + docker loopback 都已 ship；DNS rebinding 仍 future hardening。 |
| 9 | 依赖卫生 | 未处理 (17 outdated, 6 audit) | **改善**——audit 6 → 2 (postcss via Next.js bundle，等 Next.js 16.3 patch)；outdated 17 → 6（patch-only batch 完成）。剩 6 个全是 major bump（typescript 5.9→6 / eslint 9→10 / @types/node 20→25 等），无紧迫修复理由。 |
| 10 | DX 与文档 | major 改善（CLAUDE.md 索引化） | **不变**。 |
| 11 | 可演化性 | minor 改善 | **不变**。 |
| 12 | git 卫生 | good（branch + PR + tag 流水线） | **不变**——20 天 14 PR，全部 squash-free merge + tag-on-merge-commit。 |

### evalyst 特有雷达 (13-21) — **vs r2 无变化**

| # | 雷达 | r2 状态 | r3 |
|---|---|---|---|
| 13 | `@babel/standalone` 浏览器 JSX 编译 | 仍 high 风险 by-design | 不变。 |
| 14 | file-based 持久化 / TOCTOU | TOCTOU 残留 | **修好**——`acquireLock` 切到 `fs.openSync(p, 'wx')` (`O_EXCL`)，r2 #C 闭环。验证：[`src/lib/batch-runner-lock.ts:122`](../src/lib/batch-runner-lock.ts) + 并发测试 [`batch-runner-lock.test.ts`](../src/lib/__tests__/batch-runner-lock.test.ts)。 |
| 15 | Cartesian 边界 | 修好 | 不变。 |
| 16 | LLM 健壮性 | minor 改善 | **不变**——继续靠 raw fetch（无 SDK），`anthropic-version: 2023-06-01` pinned，OpenAI / Anthropic 两 adapter 形态稳定。R3 角度补：项目**不依赖 OpenAI / Anthropic SDK**，所以 SDK 升级 / 模型 deprecation 漂移这条 R3 angle 自动 N/A。 |
| 17 | knip 长尾真值 | 0 unused | 不变（5 个 config hints 不算）。 |
| 18 | 三大文档关系 | 改善 | 不变。 |
| 19 | shadcn + @base-ui | 不变 (12 直接 import) | 不变。 |
| 20 | "规划中"残留 | 修好 | 不变。 |
| 21 | zero-config 隐藏代价 | 不变 | **微改善**——README 部署须知段已加（PaaS 前置 router 终结 auth）；docker-compose 绑 127.0.0.1。 |

---

## 第 3 步 · R2 fix 健康度抽样（5 项）

每项一段，确认 r2 修的形态在 14 PR cumulative churn 后**没被反向破坏**。

### 1. **R2 #A · Glass primitive 切边** — ✅ 健康

`src/components/glass/{shell.tsx, sticky-chrome.tsx, glass-segmented.tsx, copilot-context.tsx}` 4 文件 + tests 全在；`src/copilot/components/sticky-chrome.tsx` 已删（R2 时还在）；shadcn primitive (`button/dialog/select/sticky-save-bar`) `import "@/components/glass/shell"`。最小 Copilot 耦合接口 `useCopilotOpen()` / `useCopilotPanelWidth()` 落在 `glass/copilot-context.tsx`，store.tsx 内层挂 `<CopilotShellProvider value={shellState}>`（[`store.tsx:329`](../src/copilot/components/store.tsx)）。无反向破坏。

### 2. **R2 #B · middleware CSRF 真名化** — ✅ 健康

[`src/middleware.ts:4`](../src/middleware.ts) 头注释 `CSRF gate (NOT auth)`；[line 19-25](../src/middleware.ts) 明示 `curl http://victim:3000/api/llm-config` 走 `Sec-Fetch-Site` undefined 放行（不防 LAN curl）；docker-compose.yml `127.0.0.1:3000:3000` 绑 loopback；README 部署须知段在。无反向破坏。

### 3. **R2 #C · file-lock O_EXCL** — ✅ 健康

[`batch-runner-lock.ts:122`](../src/lib/batch-runner-lock.ts) `const fd = fs.openSync(p, 'wx')`（O_WRONLY|O_CREAT|O_EXCL）；EEXIST 才走 stale 检测 + 覆写。[doc-comment line 99-110](../src/lib/batch-runner-lock.ts) 解释 atomicity 来源。`batch-runner-lock.test.ts` 17 行新增 case（r2-followup PR-3 sub-d 衍生）。无反向破坏。

### 4. **R2 #D · 域核心 4 模块覆盖** — ✅ 健康

```
File              | r2 stmts | r3 stmts
datasets.ts       |     0%   |   98%
displays.ts       |     4%   |   98%
result-parser.ts  |     0%   |   97%
rubric-store.ts   |     0%   |  ~95%
```

测试文件：`src/lib/__tests__/{datasets,displays,result-parser,rubric-store}.test.ts` 共 730 LOC / 35 cases。CI 全绿，本地 vitest 2.4s 全过。R2 期望 80%+，实际 95-98%，**超额**。

### 5. **r2-followup PR-2 · ConfirmDialog Provider 嵌套** — ✅ 健康

[`layout.tsx:80-93`](../src/app/layout.tsx) `CopilotStoreProvider` 包 `ConfirmProvider`；[`e2e/confirm-glass.spec.ts`](../e2e/confirm-glass.spec.ts) 新增 spec 验证 copilot 开/关两态下 `data-glass-variant` 行为。`--repeat-each=10` 全绿。无反向破坏。

### 6. **r2-followup PR-3 sub-d · session probe 三态** — ✅ 健康

[`probe-session.ts`](../src/copilot/components/probe-session.ts) 三态 `"exists" | "not_found" | "unknown"`；[`store.tsx:99-113`](../src/copilot/components/store.tsx) 只在 `not_found` 时清 LS（5xx / network 走 unknown，保留 LS）；[`probe-session.test.ts`](../src/copilot/components/__tests__/probe-session.test.ts) 34 行新 spec。设计避免 transient blip 抹掉用户最近 session 指针，符合 r2-followup execution notes 描述。

### 7. **R2 #T3 sub-b · chrome-up/down inline** — ✅ 健康

`src/copilot/components/sticky-chrome.tsx` 删 53 行（chrome-up / chrome-down 两个变体），inline 到唯一调用点 `glass/sticky-chrome.tsx`。chrome 通用变体保留。无反向破坏。

---

## 第 4 步 · r3 backlog 8 项当前状态

无任何项**已自然消失**或**变得更紧**——20 天的 churn 全在 r2 plan 内 + r2-followup scope。

| # | 项 | 出处 | r3 状态 |
|---|---|---|---|
| 1 | `experiment-seed.spec.ts:106` retries=0 ~8% flake | r2-followup PR-1 Errata Supplement | **未修**——retries=0 已确认 ([playwright.config.ts:19](../playwright.config.ts))；waitForURL 仍 5000ms timeout（[experiment-seed.spec.ts:120/139](../e2e/experiment-seed.spec.ts)）。诊断 + 修方向待 r3 实施。 |
| 2 | e2e cold-compile flake 4 spec 范围 | r2-followup PR-3 衍生 | **未修**——同上根因；`audit-cleanup-coverage:41/160` + `experiment-seed:106/126` 共 4 条本机 retries=0 全 suite 跑时 cold-compile race。 |
| 3 | 方法论补丁：标 pre-existing test "已绿" 前必须 `--repeat-each` ≥ 5 | r2-followup PR-1 Errata Supplement | **未补**——AGENTS.md / CLAUDE.md grep 0 命中"repeat-each"。元教训未沉淀。 |
| 4 | npm save-prefix=^ 自动 caret 风险 | r2-followup PR-3 sub-a | **未处理**——`.npmrc` 不存在；`npm install next` 仍会重新加 caret。 |
| 5 | `parseResponse(raw, schema)` 改 `Pick<TaskSchema,…>` 签名收窄 | r2-followup §C #1 | **未改**——[`result-parser.ts:10`](../src/lib/result-parser.ts) 仍吃完整 `TaskSchema`。但现 100% 测试覆盖意味着重构成本极低。 |
| 6 | API route 错误消息 vs lib 内部消息不一致 | r2-followup §C #2 | **未追**——需先调查是 i18n / API 重写 / 还是真有两套 validate 路径。 |
| 7 | "patch + 兼容 minor" plan 撰写约定 | r2-followup §C #3 | **未补**——AGENTS.md / CLAUDE.md 未加。 |
| 8 | `view-helpers.tsx` 独立 GlassVariant 4 变体副本 | r2-followup §C #4 | **不动**（plan 决策日志已写"强行修反引入新分歧"）。仍在 [`view-helpers.tsx:8`](../src/components/results/view-helpers.tsx)。 |

**8/8 项 untouched**。这是预期——r2-followup 三 PR scope 严格不碰 §C 类，留给 r3。

---

## 第 5 步 · 真新发现

**0 项**。

我尝试找 R3 specific angles（用户 brief §4.5 列的）每条都过了一遍：

- **LLM SDK 行为漂移**：N/A——项目 raw fetch + `anthropic-version: 2023-06-01` pinned，无 SDK 暴露面
- **Next.js 16 minor jumps silent breaking**：未见——pinned 16.2.6 (r2-followup PR-3 sub-a)，build/dev/instrumentation hook 全工作
- **CHANGELOG 累积 promise 对得上代码**：抽 v0.13.0~v0.14.2 段全部对应 git log + 实际行为，无 drift
- **用户长 workflow 的 long-tail bug**：批量评测 / 多模态 / 长跑实验路径——`saveImagesForTask` SSRF 守住、`pruneCacheStats` 通过 [`src/instrumentation.ts`](../src/instrumentation.ts) Next.js 16 startup hook 自动跑（30 天 + 10K lines 双阈值）、`deleteExperiment` `fs.rmSync(recursive)` 清子树——三个长跑维度的卫生都已就位
- **资源累积 disk**：`data/` 总 5.1M（results 2.6M / copilot 876K / datasets 732K）。`pruneCacheStats` startup hook 已 wired（r3 起手时验证：[`instrumentation.ts:11`](../src/instrumentation.ts) `import('@/copilot/lib/cache-stats-store')` + console.log prune 行数）。无累积失控点。
- **CI 信号严化**：r2-followup PR-1 把 retries=1 → 0；PR-3 sub-c 把 `next` + `eslint-config-next` 从 `^16.2.6` 改回 pinned `16.2.6`。CI workflow 已严，"3 e2e 假阳性"那条 r2 误以为是真 fail 的项被 errata 推翻——CI 没撒谎。

---

## 第 6 步 · 修复清单

**无新发现 → 无 r3 cleanup phase**。

直接按 r3 backlog 8 项推进，工作量诚实估：

| # | 项 | 估时 | 备注 |
|---|---|---|---|
| 1+2 | e2e cold-compile flake 4 spec 统一诊断 + 修 | 0.5-1 人天 | 选项 A: timeout bump；B: `webServer.reuseExistingServer=false`；C: `--workers=2`。先诊断 root cause |
| 3 | AGENTS.md `--repeat-each` ≥ 5 standing rule | 5 分钟 | 一段话写进 §6 |
| 4 | `.npmrc save-exact=true` 评估 + 决策 | 20 分钟 | 看 1-2 个对照项目 + 写决策记录 |
| 5 | `parseResponse` 收窄签名 | 30 分钟 | 100% 覆盖背书，pure refactor |
| 6 | API/lib 错误消息一致性调查 | 30 分钟 | 先 grep 确认是不是真两套路径 |
| 7 | "patch + 兼容 minor" 约定 | 5 分钟 | 加一行 |
| 8 | view-helpers.tsx 4 变体副本 | 不修 | 决策日志已写 |

**总投入估计：1.5-2 人天**。无须独立 phase；混进下一次自然 PR cycle 的 cleanup 段即可。

---

## 第 7 步 · 评审视角四人组裁决

四人这轮没分歧。逐条结论一致：

| 议题 | 裁决 |
|---|---|
| R2 4 项 fix 是否仍立得住 | ✅ 全部立得住，无反向破坏 |
| v0.13.0 → v0.14.2 churn 是否引入新坏味 | ❌ 无——20 天 churn 都在 r2 plan + r2-followup scope，真新行为代码 52 LOC |
| R3 specific angles 是否找到 r1/r2 漏掉的视角 | ❌ 无——SDK 漂移 N/A、Next.js minor 稳、CHANGELOG 对得上、长跑 disk 已 wired、CI 信号严 |
| r3 backlog 8 项当前应推进否 | ✅ 推——但分散到下一 PR cycle，无须独立 phase |
| Top 5 要凑吗 | ❌ 不凑——0 新 finding 是事实 |

**Linus 总结**："R1 抓 RCE / 0% 测试 / 30+ archived plan 这种 'easy 大鱼'；R2 抓 Provider nesting / Glass 边界 / TOCTOU 这种 '聪明小鱼'；R3 没鱼了。这是 audit 该到的状态——不是失败。"

**Carmack**："关键 invariant 都守住了——文件锁原子、SSRF 边界、cartesian cap、cache-stats prune wired、experiment delete 清子树。下一轮发现的事会是从 evalyst 真投产 / 真有用户 / 数据规模真上来时露出来的，不是 audit 室能挖出来的。"

**DHH**："凑数 finding 比没 finding 危险——会让维护者把'有没有 audit'当 KPI 而不是'代码质量'。"

**Abramov**："r3 backlog 8 项最重的也就 0.5-1 人天 (cold-compile flake 诊断)，剩下都是分钟级。普通 PR cycle 顺手收即可。"

---

## 一句话结论

**v0.14.2 处于良好维护状态。0 新 finding；R2 4 项 fix 全部立得住；r3 backlog 8 项按出现顺序推即可，估总投入 1.5-2 人天，无须独立 cleanup phase。**

> R2 acceptance criteria 在 #A 写 "≤5 sites" 时漏算了 `useRegisterPageContext` 是 14-page Copilot 集成 hook（设计如此）；建议补一句 errata 到 r2 报告即可，不算 r3 finding。
