# Evalyst 第二次代码质量审视报告

> **Round 2** · 基于 `b26c6a9` (HEAD on main, tag v0.13.0)
> 视角：Linus / Carmack / DHH / Abramov（同 round 1）
> 上轮报告：[`docs/code-review-2026-05-09.md`](./code-review-2026-05-09.md)（v0.10.1 baseline）

## 第 0 步 · 总判断

Round 1 的 Top 5 + Tier 2 共 11 项，**形式上全部落地**——`js` op 删了、middleware 在了、file-lock 替了 globalThis、tool metadata 拆了、Cartesian cap 写了、SSRF allowlist 守住、tsconfig 三严格全开、CLAUDE.md 收到 7.5KB、AGENTS.md 收到 4.9KB。214 测试 → 772 测试，0 unused exports（knip 干净），TSC --noEmit 0 错误。这些是真实的工程产出，不是 PR title 自我宣告。

**但有两件事值得用同样冷的眼睛说出来**：

1. **"Copilot 物理切边"是个名义胜利。** 切目录之后，`src/components/ui/{button,dialog,select,sticky-save-bar}` + 9 个 settings 页面**反向** import `@/copilot/components/{shell,store,sticky-chrome,glass-segmented}`——shadcn primitive 依赖 Copilot store。删 `src/copilot/` 整库就死。这条边界画错了——Glass UI 这堆视觉 primitive **属于 evalyst-shell 不属于 Copilot**，但被留在 Copilot 子树里，必然反向耦合。Round 1 的判断被表面接受、根因没解决。

2. **"补测试"补在了不重要的地方。** Phase B 给了 batch-runner 6 个 case 单测，是真补丁。但 `datasets.ts` 0% / `displays.ts` 4% / `result-parser.ts` 0% / `rubric-store.ts` 0%——**484 行域核心代码彻底无单测**，包括 `parseResponse`（CCN 23，**LLM 响应解析的关键路径**）和 `validateDisplay`（CCN 22）。Copilot 78% / 域 57% 的测试不平衡 round 1 就指出过，audit cleanup 没收窄反而**加深了**（Copilot 又新加了 metadata-identity / route-gating-integration 测试）。

剩下的部分基本对得起标 v0.13.0 这个版号。但这两点是**round 1 真正想解决的事，没解决**。

---

## 第 1 步 · 量化 baseline (round 2)

### 代码规模

| 区块 | 文件 | LOC (raw wc) | 备注 |
|---|---|---|---|
| `src/copilot/` (non-test) | 87 | **10,237** | round 1 18,474 是含 tests 的；现按 Errata E5 框架对齐 |
| `src/copilot/` tests | 39 | 7,981 | tests 比 prod 大 **78%** |
| `src/app/api/copilot/` | 7 | 468 | |
| 域核心 (src/* excl copilot, excl tests) | 138 | **18,245** | |
| 域核心 tests | 18 | 2,919 | |
| **Copilot ex-tests / 总 prod** | | **10,705 / 28,950 = 37%** | round 1 = 56% |

scc 全量：35,069 LOC TS / 5,005 复杂度 / 302 文件（round 1: 32,915 / 4,663 / 278 — **+2,154 LOC / +342 复杂度 / +24 文件 in 14 天**）。

### 工具量化（round 1 → round 2）

```
循环依赖:                1 → 0          ✓ 修复 (display-form-modes ⇄ display-form-page)
lizard 警告 (CCN>15):    28 → 27        ⚪ 几乎平
lizard 警告恶化的 funs:  ──────────────────
   argsHash@tool-loop-detector.ts:39    CCN 23 → 28
   analyzeToolLoop                      CCN 21 → 24
   resolveContextById                   CCN 20 → 25
新增 lizard 警告 funs:   ──────────────────
   assertSafeImageUrl@image-store.ts:47 CCN 17 (新引入,defensible)
   buildSchemaFromForm@form-state.ts    CCN 16 (从 round 1 没上榜)
未变 lizard 警告:        validateJson CCN 61, applyTransforms CCN 47-48, validateDisplay CCN 22, ...
knip unused exports:     16 → 0         ✓ 干净
knip unused types:       38 → 0         ✓ 干净
knip unlisted deps:      1 → 0          ✓ 干净
npm audit:               6 (5M+1H) → 6  ⚪ 不变（未处理）
npm outdated:            17 → 17 同步   ⚪ 不变
tsc --noEmit:            未跑 → 0 错误  ✓ 三严格通过
as unknown as (prod):    5 → 8          ⚠ +3（多数是预存，新增主要来自 form-state 和 lock dev cleanup）
as any (prod):           0 → 0
@ts-ignore:              0 → 0
console.* (prod):        5 → 7          ⚪ 微增
```

### 测试

- vitest unit: 68 → 74 文件 / **772 cases pass**（增 ~120 cases）
- e2e specs: 5 → 10 文件
- Coverage 总：**Statements 68.14% / Branches 62.5% / Functions 68.19% / Lines 71.22%**
- 域核心 `lib/` 整体 **57% statements / 47% branches**
- Copilot `copilot/lib/` **78% statements / 70% branches**
- **零覆盖 / 极低覆盖文件**：`datasets.ts` 0% · `displays.ts` 4% · `result-parser.ts` 0% · `rubric-store.ts` 0%（共 484 行）

### Build / bundle

```
clean build time:    9.75s   (small, fast)
.next prod size:     51 MB
largest static chunk: 2.98 MB  (babel-standalone, dynamic-imported as expected)
2nd largest:         231 KB
```

### git churn (since v0.10.1, 14 天)

```
114 commits / 291 files changed / 8004 insert / 2371 delete
+5,633 net LOC

since v0.12.0 (post-migration baseline):
14 commits — top 8 都是 docs 调整（CLAUDE.md / docs/copilot.md / FAQ pinpoint）
```

---

## 第 2 步 · 维度评估（聚焦 round 1 后的变化）

### 1. 架构与边界 — **major 未解决**

**核心发现：物理切边没画到 conceptual 边界上。**

`src/components/ui/button.tsx:5-6` / `dialog.tsx:9-10` / `select.tsx:8-9` / `sticky-save-bar.tsx:5` 反向 import `@/copilot/components/shell`、`@/copilot/components/store`。9 个 settings 页面（`src/app/settings/{llm,displays,datasets,rubrics}/page.tsx` 等）import `useRegisterPageContext` / `GlassCard` / `GlassRegular` 等。

```
domain ui  ──→  copilot/components/{shell,store,sticky-chrome,glass-segmented}
                                                        │
                                                        └── <- 这些是 evalyst-shell 视觉系统
                                                            被错放在 copilot/ 子树里
```

`src/copilot/lib/resolve-context.ts:4-9` 反向：Copilot 同时 import `@/lib/{store,datasets,displays,rubric-store,annotation-store}` 5 个域模块——shopping list 模式没改。

- **Linus**："改名不是切边。如果 Glass UI primitives 被 settings 页面用，它就是 shell 不是 copilot。重做：Glass primitives → `src/components/glass/`，Copilot 子树只剩 panel/chat/tools。"
- **Carmack**："验证可分离的方法是 'rm -rf src/copilot 编不编'。试，编不过——边界假的。"
- **DHH**："这是 conceptual compression 失败的典型表现：物理 layout 是为了让人 reason about it 简单，现在 reason 还是要在两处来回跳。"
- **Abramov**："边界不是路径选择，是 import 方向。Round 1 spec 没指明 'Glass primitives 留在哪儿'，agent 把它当 Copilot 子模块整体搬，错在搬之前没拆。"

**裁决**：四人一致——**Phase E #2 名义完成、实质未达**。这是 round 1 留下的最大债没还清。

证据：`grep -rln "@/copilot/components" src/components src/app/{settings,page.tsx} | wc -l` = **40+ sites**。

### 2. 代码质量 — minor

- 大文件削峰失败：`use-chat-stream.ts` 573 → 597 行（继续长）；`tool-call-card.tsx` 727 → 已改名拆掉算 ok；`llm-stream.ts` 700 → 690（基本平）
- 新出现大文件：`docs/architecture.md` 26.5KB（CLAUDE.md 抽出来的，不算代码）
- 0 dead code（knip 干净）—— 真胜利

### 3. 抽象的成本 — minor 改善

Round 1 的 `manifest.ts` 11 个 unused interface 全删（knip 验证）。`metadata-client.ts` 镜像反模式被拆成 per-tool `*.metadata.ts` + `*.server.ts`，sync test 也消失——这一项 round 1 # T2-10 真正修对了 **结构**而不是 cosmetic 删除。

但 `tool-loop-detector.ts` 在 round 1 已经是 unused exported types 候选，现在 still has `ToolLoopDetectorConfig` / `LoopReasonKey` 跨 module 暴露——只是 knip 默认包了 internal export。还行，不是问题。

### 4. 错误处理 — minor

`assertSafeImageUrl` 里写明 "DNS rebinding 是 future hardening" — Carmack 风格的诚实自报家门，可接受。中端攻击者可以用 DNS 解析时序绕过此静态 IP 检查；但威胁模型 "malicious LLM hands literal IP" 已守住。

### 5. TypeScript 严格度 — **修复成功**

`tsconfig.json` 现含：`strict / noUncheckedIndexedAccess / noImplicitReturns / exactOptionalPropertyTypes` 全部开。`validate.ts:123-129` 加了 default 分支 + `never` exhaustive check（per Phase D plan §4 注释明示）。`tsc --noEmit` 通过。

**但 `as unknown as` 长尾**：5 → 8 prod 实例。逐条审：
- `src/copilot/components/glass-segmented.tsx:74` 老的 RenderElement 强转
- `src/copilot/lib/context-registry.ts:154-155` window CSS.escape feature-detect（×2）
- `src/copilot/lib/llm-stream.ts:685` AnthropicBody 协议 cast
- `src/components/results/display-jsx.tsx:21` babel mod cast
- `src/components/template-builder/template-form-parts.tsx:171` JSON parse → TaskSchema
- `src/lib/store.ts:30` 老 result migration cast
- `src/app/api/experiments/[id]/results/route.ts:25` 历史

**8 个全是预存的 + 1-2 个迁移期遗留**——并没有因为开严格触发 `as unknown as` 雪崩。这是好现象。Linus："开 strict 没让代码绕过类型系统去搪塞——证明域代码本来就健康。"

### 6. 测试 — **major 未解决（恶化）**

**域核心 vs Copilot 测试不平衡**（round 1 已点名）：

| 模块 | LOC | Cov stmts | 测试文件 | 评价 |
|---|---|---|---|---|
| `lib/datasets.ts` | 201 | **0%** | 无 | CRUD + CSV/JSONL 推断 都没测 |
| `lib/displays.ts` | 156 | **4%** | 无 | `validateDisplay` CCN-22 没测 |
| `lib/result-parser.ts` | 71 | **0%** | 无 | `parseResponse` CCN-23 — LLM 输出解析关键路径 |
| `lib/rubric-store.ts` | 56 | **0%** | 无 | |
| `lib/store.ts` | 158 | 47% | 部分 | migration 路径有测 |
| `lib/schema/engine.ts` | ~270 | 47% | 部分 | `applyFilters` CCN 33 仅基本路径 |
| `lib/schema/user-schema-store.ts` | ~96 | 12% | 几乎无 | `validateUserSchema` CCN 19 |
| `copilot/lib/*` 平均 | | **78%** | 53 测 | |

新增的测试都在 Phase A/B/C 计划内点（mask-key / batch-runner / batch-runner-lock / image-store-ssrf / llm-client-seed / cartesian-cap）—— **8 个新测全是 plan 列出的，没人补 plan 外的 datasets/displays/result-parser/rubric-store**。

- **Linus**："你测了你新写的代码，没测之前就该测的代码。"
- **Carmack**："`parseResponse` 是评测平台的核心管道之一——LLM 文本→ schema-conformant JSON。0% 覆盖意味着任何 prompt template format 改动都靠 e2e 兜，慢且脆。"
- **DHH**："如果你要标 v0.13.0 'maturity'，不能让域核心 4 个文件 0% 测。"
- **Abramov**："这是 plan 自给自足症——agent 跟着 plan 走，plan 不写就不补。Plan 应该有一条 '检查 0% coverage 模块'。"

**裁决**：未解决，且**因为 audit cleanup 集中补 Copilot 周边而显得相对更不平衡**。

### 7. 性能 — **解决**

Cartesian cap (`engine.ts:21,76-89`) + `estimateTaskCount` (`engine.ts:54-66`) 两个独立函数，前者 throw `TooManyTasksError`，后者纯计数不物化。`/api/estimate/route.ts:21` 已切到 `estimateTaskCount`。

构建时间 9.75s / 51MB prod bundle / babel-standalone 2.98MB lazy chunk——健康。

### 8. 安全 — **major 改善但有残留**

Round 1 列了 7 个安全子项 (S1-S7)：

| 项 | round 1 状态 | round 2 状态 |
|---|---|---|
| S1(a) 服务端 RCE via `js` op | blocker | ✅ **删了**（grep 0 引用） |
| S1(b) 浏览器 JSX 编译 | high | ⚪ 仍在（by-design）`display-jsx.tsx:55` `new Function` |
| S2 GET /api/llm-config 明文 | blocker | ✅ `maskKey` 用了 `sk-***xxxx` 末 4 位 |
| S3 27 个 API route 无 auth | blocker | ⚠ **CSRF only**（见下） |
| S4 SSRF on saveImagesForTask | major | ✅ `assertSafeImageUrl` IPv4+IPv6 + IPv4-mapped 都覆盖 |
| S5 skills route | OK | ⚪ 不变 |
| S6 images route | OK | ⚪ 不变 |
| S7 Docker root + 0.0.0.0 | minor | ⚪ Tier 3 cleanup 是否做了？验证：Dockerfile 没新加 `USER`——**没改** |

**S3 的"修复"需要理性看待**：`src/middleware.ts:38` 的 gate 用 `Sec-Fetch-Site` header 拦 cross-site 请求。注释清楚自陈"minimal CSRF defense, NOT a token auth system"。

这意味着：
- ✅ 浏览器从 evil.com 发请求过来：`Sec-Fetch-Site: cross-site` → 403
- ❌ LAN 攻击者 `curl http://victim:3000/api/llm-config`：**header 不存在 → 直接放行**

Round 1 担心的"docker compose 把 :3000 暴露给局域网"威胁模型，**只关了浏览器 CSRF 一面，curl 那面还开着**。

- **Linus**："注释写了 'NOT a token auth system'，没乱标榜——可接受；但你 Phase A plan 标题是 'fix/auth-gate-rce'，agent / reviewer 心智里这是 RCE 防御。CSRF 防御不防 LAN curl，名字错了。"
- **Carmack**："Sec-Fetch-Site 是 modern browser-attested CSRF 的标准做法，针对 'evalyst 装在 localhost、有 logged-in browser session' 场景正确。"
- **DHH**："本地 dev 工具 + 不公网部署 + 单用户假设，CSRF only 够了。给说明，不要悄悄。"
- **Abramov**："关键是 README / docker-compose.yml 是否把这个限制说清。"

**裁决**：不算欺诈，但**门槛标低了一档**——是 CSRF 不是 auth gate。S7 (Docker root) 没改是 Tier 3 cleanup 漏项。

### 9. 依赖卫生 — **未处理**

`npm outdated` 17 个落后包跟 round 1 完全一样。`npm audit` 仍 5 moderate + 1 high。Tier 3 cleanup 没纳入 dep upgrade。

### 10. DX 与文档 — **major 改善**

| 项 | round 1 | round 2 |
|---|---|---|
| CLAUDE.md | 42KB / 669 行 | **7.5KB / 89 行** |
| AGENTS.md | 24KB / 411 行 | **4.9KB / 89 行** |
| CHANGELOG.md | 95KB | 133.5KB（+40%，**符合判断："不动它"**） |
| docs/architecture.md | — | 26.5KB（新） |
| docs/copilot.md | — | 9KB（新） |
| docs/conventions/glass-ui.md | — | 9.5KB（新） |
| docs/superpowers active | 14 plan / 8 spec | **2 plan / 0 spec**（30 archived） |
| FAQ literal-path 准确性 | — | **15/15 ✓**（抽查所有路径，全在） |

CLAUDE.md 的"反直觉 3 强约束"是真的留下来：copilot-accent vs primary 染色、sidebar 不走玻璃、JSX display helpers API。这是反直觉信息浓缩——是 round 1 没做出来但 round 2 做出来的提炼。

DHH："文档量从 188KB → ~70KB(top level) + 主题文件，conceptual compression 是真的发生了。索引到主题文件的 14 行 FAQ 那张表抓住了 cold-start 问题——比 1000 行 'agent working memory' 强。"

### 11. 可演化性 — minor 改善

- 新加 Copilot 工具流程：从 round 1 的 6 处改 → 现在 3 处（`{name}.metadata.ts` + `{name}.server.ts` + 加 client/server registry 两处 import = 真 3 处）。`metadata-client-sync.test.ts` 删了。这是真改善。
- 新加域资源：原 8-10 touch point 没解决，但本来就被 round 1 #11 评为"展开式合理"。

### 12. git 卫生 — good

114 commits / 14 天 / commit message 严格 conventional / merge commit 保留 / 24 个 tag 命中"松散里程碑"约定。`.claude/worktrees/` 现在被 knip ignore 了。

---

## evalyst 特有雷达（13-21 用新数据）

### 13. `@babel/standalone` 浏览器 JSX 编译 — **不变**
仍 high 风险（用户自定义 display 是 by-design）。`assertSafeImageUrl` 关了网络边那条；浏览器执行边没变。Bundle 验证：2.98 MB lazy chunk 在 dynamic import boundary 上，未进首屏。

### 14. file-based 持久化 — **TOCTOU 残留**

Phase E #9 file-lock 替了 globalThis 是真改进。但 `acquireLock` 实现有 TOCTOU 窗口：

```ts
// src/lib/batch-runner-lock.ts:105-124
export function acquireLock(experimentId: string): boolean {
  ensureDir(lockDir(experimentId))
  const existing = readLock(experimentId)        // ← read
  if (existing) {
    const alive = isPidAlive(existing.pid)
    if (alive && !isStaleHeartbeat(existing.last_heartbeat)) {
      return false
    }
  }
  const lock: RunnerLock = { ... }
  writeAtomic(lockPath(experimentId), JSON.stringify(lock))   // ← write
  return true
}
```

读-检查-写不是原子——两个 worker 同时见到 stale lock 会双双成功覆写，都返 true。正确做法是 `fs.openSync(path, 'wx')` (`O_EXCL`) 撞 EEXIST 重试。`batch-runner-lock.test.ts` 测了 6 个 case 但**没有并发 acquire 的 case**（`it("second acquireLock with live holder is rejected")` 是序列化的，不模拟 race）。

- **Linus**："`O_EXCL` 这个 flag 存在 50 年了就为这件事。你写了 read-check-write 然后说支持 `next start -w N`——race 漏。"
- **Carmack**："Heartbeat staleness detection ≥ 1h 兜底是 nice，但首次 race 进入运行后两个 BatchRunner 同时跑 + 同时 appendResult 是真伤——不仅 lock 失效，结果文件还可能交错。"
- **DHH**："单实例 dev 不会触发；docker compose 单服务也不会触发。多 worker 是声称的支持，没真支持就别 claim。"
- **Abramov**："文档 line 6 写 `next start -w N` 失败的 case，line 124 又承认 stale 重写覆盖——前后矛盾要么改文档要么改实现。"

**裁决**：file-lock 比 globalThis 强一档，但 doc-comment 把 multi-worker 说太满。修法 0.5d 内可改完（O_EXCL 5 行 + 一个 race test）。

### 15. Cartesian 边界 — **修好**
见 §7。

### 16. LLM 健壮性 — minor 改善
- `seed` 字段 ✅（OpenAI 透传，Anthropic 丢弃）`src/lib/__tests__/llm-client-seed.test.ts` 覆盖
- 域核心 `llm-client.ts` 57% 覆盖（不算高）
- Copilot `llm-stream.ts` 49% 覆盖——SSE 解析 + tool_use 归并那一大块仍依赖 e2e 兜底

### 17. knip 长尾真值 — **0 unused**

knip.jsonc 配置正确（ignore: `.claude/**`、`docs/**`、`src/**/__tests__`、`src/components/ui/**`）。`npm run knip` 输出空、退出 0。**round 1 §17 抓到的 16 unused exports + 38 unused exported types 全部清零**。这是 audit cleanup 最干净的一项胜利。

### 18. 三大文档关系 — **改善**

CLAUDE.md (89 行) 现在是**索引**：14 行 FAQ literal-path 直答表 + 5 行索引表 + 3 强约束 + pinpoint 注意事项。AGENTS.md (89 行) 收到开发流程 + AI 协议。重复消除（grep 验证两份没有 60% 重叠）。

DHH："如果新人开 5 分钟能找到 'LLM 调用入口' → `src/lib/llm-client.ts`，文档就立功了。"

### 19. shadcn + @base-ui — 不变

12 个直接 base-ui import 仍在；shadcn ui 19 个，**反向依赖 Copilot**（详 §1）。

### 20. "规划中" 残留 — **修好**

`README.md` 不再说 "Copilot 工具调用闭环规划中"——commit `42e03e2` 直接删了那行。

### 21. zero-config 隐藏代价 — 不变

依然没在 README 强调 docker compose 别 expose 公网。S3 的 CSRF gate 让浏览器场景安全，但 LAN curl 仍开。

---

## 评审视角四人组裁决摘要 (round 2)

只列**新分歧 / 状态变化**项，附行动指向。

| 议题 | Linus | Carmack | DHH | Abramov | 判断 + 行动 |
|---|---|---|---|---|---|
| Copilot 物理切边的实质 | "圈目录不算切边" | "rm -rf 测试不通过" | "改名 ≠ 边界" | "Glass primitive 应分出来" | **未解决** → Tier 1 #A |
| middleware 是 auth 还是 CSRF | "命名错——是 CSRF 不是 RCE 防" | "CSRF only 对 browser 模型对" | "本地工具够了，但要说清" | "README 标 known-limitation 即可" | **CSRF 真名化** → Tier 2 #B |
| file-lock 的 TOCTOU | "O_EXCL 5 行修法不写就别 claim multi-worker" | "race 真的伤数据" | "单实例不触发，文档别说大话" | "实现/文档至少对一个" | **守 doc 或修实现** → Tier 2 #C |
| 域核心 0% 覆盖 4 文件 | "测了新代码，没测老代码" | "parseResponse 0% 不能" | "v0.13.0 不能这样" | "plan 没 self-audit 0%" | **真该补** → Tier 1 #D |
| `applyTransforms` CCN 47 仍未拆 | "刚 round 1 漏了" | "CCN 大不一定坏" | "不是必修" | "拆要拆好，缓即可" | **不修** |
| `validateJson` CCN 61 + default 分支已加 | "default 加了 ok" | "exhaustive check 守住未来" | "够了" | "够了" | **不修** |
| `as unknown as` 8 处 | "全是预存的——好" | "tsc strict 没强迫多写——好" | "可接受" | "可接受" | **不修** |
| Glass UI 9 档使用分布 | "chrome-up/down 各 1 用例 = 死变体" | "可以容忍" | "证据说话——不是 9 档系统" | "未来 prune 即可" | **记一笔** |

---

## 第 3 步 · 修复清单（round 2）

按"修完解锁什么"：

### Tier 1 — 真未解决

#### A. 真切 Copilot 边界：把 Glass UI primitives 分出来

**当前状态**：`src/copilot/components/{shell,store,sticky-chrome,glass-segmented}.tsx` 被 40+ 域 UI sites 反向 import。`rm -rf src/copilot/` 整库不编。round 1 #2 的目标"可独立理解 Copilot"未达。

**期望状态**：
- 新 `src/components/glass/` 收容 `shell.tsx`、`sticky-chrome.tsx`、`glass-segmented.tsx`（视觉 primitive，不属于 Copilot 业务）
- `src/copilot/components/store.tsx`（CopilotStore） 提一个**最小接口**到 `src/components/glass/copilot-context.ts`，shell/segmented 用接口 prop 而不是直接 import store
- `src/copilot/` 子树只留 panel / chat-view / tool-call-card / inspector / use-chat-stream / use-page-context 等真业务组件
- 验收：`grep -rln '@/copilot/components' src/components src/app | wc -l` ≤ 5（剩下的应是真 Copilot 触点，比如 ⌘K 快捷键 hook）

**工作量**：1.5-2 人天

**解锁**：把 round 1 #2 的本意——"可独立理解 Copilot"——真做到。`rm -rf src/copilot/` 之后剩下的 evalyst 应该编。

#### D. 补域核心 4 个 0% 模块的单测

**当前状态**：`datasets.ts` 0% / `displays.ts` 4% / `result-parser.ts` 0% / `rubric-store.ts` 0%——共 484 行域代码，包括 `parseResponse` (CCN 23, LLM 输出解析关键路径) + `validateDisplay` (CCN 22)。

**期望状态**：
- `datasets.test.ts`：CRUD + `inferFieldsFromJsonl` + `validateDatasetJson` + `updateCustomDataset` (CCN 17)
- `displays.test.ts`：`validateDisplay` 全分支 + `getDisplay`
- `result-parser.test.ts`：JSON / fenced JSON / plain text / parse_error 全 4 路径
- `rubric-store.test.ts`：CRUD + 4 种 criteria type
- 域 `lib/` 整体覆盖 57% → 80%+

**工作量**：1.5 人天

**解锁**：把"评测平台"两个字立住——批量评测的解析 / 校验 / 数据集 CRUD **必须有单测**。

### Tier 2 — 改善

#### B. middleware 真名化 + LAN 攻击者 doc

**当前状态**：`src/middleware.ts` 是 CSRF gate，但分支命名 `fix/auth-gate-rce` + 注释开头说"closes RCE / key leak / no-auth"，agent / reviewer 心智里以为是 auth。

**期望状态**：
- `src/middleware.ts` 注释改为 "CSRF gate (NOT auth)" 顶部突出
- `README.md` 加一段 "Deployment caveat — does NOT support exposing :3000 to LAN"
- `docker-compose.yml` 改为 `127.0.0.1:3000:3000`（绑 loopback）

**工作量**：0.5 人天

**解锁**：消除"以为有 auth 实则没"的预期错配。

#### C. file-lock O_EXCL + 并发 race test

**当前状态**：`acquireLock` 读-检查-写非原子；测试无并发 case；doc-comment 声称 multi-worker。

**期望状态**：
- `acquireLock` 改 `fs.openSync(p, 'wx')`，EEXIST → 走 stale 检测；非 EEXIST → 写 lock 内容
- 加一个测试：用 `Promise.all([acquireLock(id), acquireLock(id)])` 期望恰好 1 个 true 1 个 false
- 或：保留实现 + doc 改 "single Node process per `data/` mount"

**工作量**：0.5 人天

**解锁**：让 doc 和实现一致。

#### Tier 3 — Cleanup batch（不重要但 cheap）

- `Dockerfile` 加 `USER node` (round 1 §S7 漏项，2 行改完)
- `npm audit fix --force` 评估 next 升级的爆炸半径，至少处理 postcss 直接依赖
- chrome-up / chrome-down Glass variant 各 1 个使用——折叠回 chrome 通用变体或 inline 到唯一调用点
- `npm outdated` 17 个 patch 升级（lucide-react / @babel/standalone / nanoid 等）

**工作量**：0.5 人天

### 总览

```
Tier 1 (真未解决)   2 项  3-3.5 人天
Tier 2 (改善)       2 项  1 人天
Tier 3 (cleanup)    1 PR  0.5 人天
                          ────────
                          ~5 人天
```

---

## 第 4 步 · 修复开发顺序

按 round 1 同样的 Phase 逻辑：先低风险增量、后结构性大改、文档收尾。

```
Phase 1 — 上安全网（域核心补测）  ─────── 1.5d
   #D  补 datasets / displays / result-parser / rubric-store 单测
       域 lib/ stmts 57% → 80%+；4 个 0% 文件全清零
   理由：纯增量、零行为变更、给 Phase 3 重构兜底

Phase 2 — 速胜（小且独立的 6 项）─────── 1.5d
   #B  middleware 真名化 + docker-compose 绑 127.0.0.1 + README 部署警告  0.5d
   #C  file-lock O_EXCL 修 + 并发 race test                              0.5d
   T3  Dockerfile USER node + npm audit fix + chrome-up/down 折叠         0.5d
   理由：修法各 0.5d，不互相依赖；批量进可单 PR 收

Phase 3 — 结构性切边（最大风险）─────── 2d
   #A  Glass UI primitive 分出 src/components/glass/ + Copilot 子树瘦身
       grep '@/copilot/components' 命中 ≤ 5（验收硬指标）
   理由：动 40+ import 站点；前置 Phase 1 给的域测保我们没顺手破域行为；
        前置 Phase 2 的 file-lock / docker / Dockerfile 收完，下一轮 audit 不被这些扰动干扰

Phase 总计：5 人天 / 一个人 1-1.5 周
```

**为什么 Phase 1 是补测试不是 #A 真切边？**

Round 1 同样问过："为什么先补测试不直接动 Copilot 切边"。答案不变——

- #A 触 40+ import 站点。即使 TS 抓引用错误，**行为是否破**只能靠运行+测+UI 实测兜底
- 域核心 4 个文件 0% 覆盖意味着改 Glass primitives 时，如果不小心 import 反向触发了哪条 datasets / displays 调用链，**没人会告诉你**——直到 e2e 跑一遍 5 分钟之后
- Phase 1 的 1.5d 投入换 Phase 3 的"敢动"——这是开发顺序里最值的 trade-off

**和 round 1 phase 排序的区别**：

- round 1 有 4 个安全 blocker (Phase A)；round 2 没有 → 直接进 "Phase B" 心智位置
- round 1 有大量"中型修复"分散在 5 个 phase；round 2 只 5 项 → 3 个 phase 收完
- 跨 Phase 顺序硬：Phase 1 → 2 → 3，同 Phase 内可独立 commit

### 工作流约定（沿用 round 1）

- **1 份 master spec**（≤ 200 行）→ `docs/superpowers/specs/2026-05-10-audit-r2-design.md`
  - Phase 顺序 + rationale；每项 scope / 验收 / 受影响文件
  - **决策日志**：哪些不修（applyTransforms CCN、validateJson CCN、glass UI 9 档、`as unknown as` 8 处）+ 理由
- **每项 ≥ 1d 的配 lightweight plan**（≤ 100 行）→ `docs/superpowers/plans/2026-05-10-audit-r2-{slug}.md`
  - Phase 1 #D 一份 (1.5d)
  - Phase 3 #A 一份 (2d)
  - Phase 2 三项打包写一份（每项 ≤ 30 行块）
  - 明确禁止 1000+ 行史诗 plan
- **每项一个 PR**，branch 命名按 AGENTS.md（`test/domain-coverage-r2`、`refactor/glass-primitive-extraction-r2` 等）
- 跨 Phase 严格按顺序；同 Phase 内可独立 commit / PR

---

## Errata（追溯订正）

### E7 (2026-05-10) · Dockerfile USER/chown 子项早已 ship

§第 0 步 / §S7 / §修复清单 T3 写「Dockerfile 没新加 USER——没改」是 stale 判断。
验证：`git show v0.13.0:Dockerfile` line 35 + 40 已含 `chown -R node:node /app` + `USER node`，
由 round-1 Phase C Tier 3 commit `98be5f1` (2026-05-10 00:10) 落地。
影响：Phase 2 T3 omit 该子项；T3 PR 实做剩 3 项（npm audit fix / chrome-up,down 折叠 / npm outdated patch）。
原因复盘：reviewer 在写 round-2 时未交叉复查 R1 已落地清单，仅看了主代码路径。
下次写 audit 应：跑工具量化前先 `git diff <prev-baseline-tag>..HEAD --stat` 列一遍 R(N-1) 实际 ship。

---

## 一句话结论

**v0.13.0 是真实的工程进步**——RCE 关了、文档收了、tsconfig 严了、type/build/knip 三盏绿灯——但**round 1 真正想解决的两件事还在原地**：Copilot 边界画在路径上没画在 import 方向上，0% 覆盖的域核心模块没人补测。1.5-2 周再交一轮就能把真正的 conceptual border 立住，**不要再把"目录已分"当切边的胜利领走**。
