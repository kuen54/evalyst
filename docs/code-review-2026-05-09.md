# Evalyst 代码质量审视报告

> 基于 `22efde3` (HEAD on main, 2026-05-09)
> 审视视角：Linus / Carmack / DHH / Abramov 四人组

> **2026-05-10 Errata**：执行 Phase C Tier 3 时发现 3 处 audit drift / measurement noise，统一修订在文末 [§Errata](#errata2026-05-10更新)。Tier 3 实际拆为「PR #60 已合」+「v0.11.1 / .2 patch 延后」两段，工作量从 0.5d 修订到 2.5-3d。原文不动。

## 第 0 步 · 读完即可消费的总判断

Evalyst 是一个名义上「LLM 批量评测平台」、实质上**45.6% 的 TS 代码花在了一个嵌入式 Copilot**（`src/lib/copilot/` + `src/components/copilot/` + `src/app/api/copilot/` = 18,474 LOC，整库 32,915）的项目。Carmack 会问"评测核心 9k 行，Copilot 18k 行——这个比例对吗？"；DHH 会指出文档体量 95KB CHANGELOG + 31k 行 superpowers/specs/plans 比代码还多——"心智模型已经撑不住了"。但抛开这层，**领域核心（schema 引擎、batch runner、文件存储）是干净、克制、可读的**，没有过度设计。问题集中在三个地方：(1) 没有边界假设的 zero-config 出厂设置，(2) 用户输入直接驱动两处任意代码执行通路，(3) Copilot 子系统是另一个项目寄生在主项目里。

---

## 第 1 步 · 量化 baseline

### 代码规模

| 区块 | 文件 | 代码 LOC | 圈复杂度 |
|---|---|---|---|
| `src/` (TS) | 230 | 32,455 | 4,663 |
| `src/lib/copilot` + `src/components/copilot` + `src/app/api/copilot` | 123 | **18,474** | 1,990 (43%) |
| `src/lib/i18n/zh.ts` + `en.ts` | 2 | 2,233 (1018 keys × 2) | — |
| `src/components/ui/` (shadcn) | 19 | — | — |
| `src/components/template-builder/` | — | ~2k | — |
| docs/ + 顶层 .md | 158 | **113,157** (markdown) | — |
| `docs/superpowers/` | 35 | **31,797** | — |

### 工具量化

```
1 circular dep:  components/settings/display-form-modes.tsx ⇄ display-form-page.tsx
28 lizard warnings (CCN > 15 OR length > 80)
   worst:  validateJson@validate.ts:14         CCN 61, NLOC 99, 1118 token
           applyTransforms@transform.ts:9      CCN 48, NLOC 79
           extractImageRefsFromOutput          CCN 35, NLOC 97 (9 params!)
           applyFilters@engine.ts:66           CCN 33, NLOC 65
           inferDisplayBuiltinId               CCN 28, NLOC 43
           run@batch-runner.ts:72              CCN 21, NLOC 98
16 unused exports (real, after stripping worktree noise)
38 unused exported types
1 unlisted dep:  postcss   (postcss.config.mjs)
6 npm audit issues:  5 moderate, 1 high  (transitively via next/postcss/express-rate-limit)
```

### TypeScript 严格度

- `strict: true` ✅
- `noUncheckedIndexedAccess` ❌ — 项目里 `combo[p.alias][p.idField]` 这种连续索引大量出现，缺这条
- `exactOptionalPropertyTypes` ❌
- `noImplicitReturns` ❌ — `validateProp` switch 没默认分支，将来加 `JsonFieldType` 就静默 returns undefined
- 逃生口：`as unknown as` × 26（其中 prod 代码 5 处）；`as any` × 0；`@ts-ignore` × 0；`@ts-expect-error` × 2（仅测试）— **逃生口控制做得好**

### git churn (60 天 top 8)

```
66  CHANGELOG.md
52  src/app/globals.css                ← 玻璃系统调色
29  src/lib/i18n/zh.ts / en.ts (× 2)
19  src/components/copilot/chat-view.tsx
18  src/app/api/copilot/sessions/[id]/tool-result/route.ts
17  src/components/copilot/material-reveal-overlay.tsx
15  src/lib/copilot/build-llm-messages.ts
```

**热点 7/10 在 Copilot**。CHANGELOG 一项 66 commits — release 节奏极快，441 commits / 14 天活跃 ≈ 一周 3 PR + 一周 30 commits。

### 测试

- 单测 68 / 源码 205 ts(x) 文件 ≈ 33%；**其中 Copilot 53 个、领域核心 15 个**——Copilot 的测试比域核多 3.5 倍
- e2e 5 spec / 610 行；smoke 跑每条路由 + skill API；`vision-gate` / `copilot-v25` 是 Copilot 专项

### 客户端组件占比

```
"use client" 文件:   88 / 96  tsx 文件 (= 91.7%)
```
Next.js App Router 的 RSC 故事**几乎完全没用上**，bundle 为这件事白付。

---

## 第 2 步 · 维度评估

每条：**判断 → 证据(file:line) → 严重度**。

### 1. 架构与边界 — major

**Copilot 是另一个项目，物理上贴在 evalyst 旁边。** `src/lib/copilot/` 70 文件 + `src/components/copilot/` 30+ 文件，耦合点只有：(a) `restart_experiment` tool 调 `batch-runner.ts:23`，(b) `read_*` tools 直读 `store.ts` / `datasets.ts`。Copilot 自己有 session-store / llm-stream / build-llm-messages / micro-compact / cache-stats / tool-runtime / hooks / route-gating / system-header / vision-gate / image-attach... 这些和评测没关系。

- 四件套（dataset / schema / display / experiment）的边界是干净的：`src/lib/store.ts` 158 行，`batch-runner.ts:72-229` 是整个评测引擎。Linus 会说 "好，数据流是单向的：dataset + schema → tasks → results.jsonl，没有回环"
- 但 Copilot 不接受这种边界——它要"圈选实验结果 → 改 schema → 重跑实验"，所以 `restart_experiment` tool 直接调 `batch-runner.startBatch()`（`src/lib/copilot/tools/restart-experiment.ts:50`）。Copilot 用 in-process 共享内存 (`globalThis.__activeRunners` at `batch-runner.ts:20`) 调度——多 worker 部署会立刻崩
- DHH 视角："这两个东西必须长成一个 monorepo 双 package（`@evalyst/core` + `@evalyst/copilot`），现在的合并意味着 'evalyst 评测' 和 'evalyst copilot 助手' 这两条产品线**不可分别理解**。" Carmack 视角："edges 都标好了，我能跟着 fn 跳到底，没问题。" **裁决：DHH 对**。一个新人想"我只要看评测怎么跑"——他会被 122 line 的 chat route + 700 行 llm-stream + 20+ 个 copilot tool 文件淹没

### 2. 代码质量 — minor / 局部 major

- **领域代码：好。** `engine.ts`、`batch-runner.ts`、`store.ts`、`datasets.ts`、`fs-utils.ts` 都是短函数 + 单职责；`writeAtomic` 12 行就解决问题
- **大文件**：`use-chat-stream.ts:1` 573 行，`tool-call-card.tsx:1` 727 行，`llm-stream.ts:1` 700 行。Carmack 阈值 ~300，超 500 几乎一定是上帝文件。`use-chat-stream.ts:284` / `:166` / `:352` lizard 都点名（CCN 16/16/19 + 长 length 89/177）
- **复杂度炸雷**：`validateJson` CCN 61。switch + 嵌套 if + 没有默认分支。换 `zod` 或者外加 `noImplicitReturns` 是该死的事。这个函数测试里只覆盖了 happy path（`schema/__tests__/validate.test.ts`），CCN 61 + 测试覆盖率薄 = 一个等着出错的角落
- **死代码**：knip（去掉 worktree 噪音）实数 16 unused exports + 38 unused exported types。`src/lib/types.ts:5` 一行 re-export 了 11 个 type，结果它们一个都没被消费——这是**故意为了"统一入口"做的无用 re-export**，Linus 视角"删掉，TS 知道哪条 import 路径是真的"

### 3. 抽象的成本 — major

**`src/lib/copilot/manifest.ts` 11 个未被消费的 manifest 类型**：`ExperimentManifest / TaskResultManifest / TaskResultManifestParent / TaskFieldTaskMeta / TaskFieldManifest / TaskFieldManifestParent / DatasetManifest / TemplateManifest / DisplayManifest / RubricManifest / ManifestScope`。

- DHH："为什么要给每个资源造一个 *Manifest 类型？这是 PRD 思维 ——'让 LLM 看到结构化信息' ——但实际 tool 实现里没人 import 它们。这是预先设计未发生的需求。"
- Abramov："这些 manifest 接口是 v2 重构时为了 'progressive disclosure' 设计的中间层，结果具体 tool 自己 hard-code 了想返的字段，manifest layer 没接通。**早抽象，付完了费没拿到货**。"
- 类似的还有 `tool-loop-detector.ts:11` 的 `ToolLoopDetectorConfig` / `LoopReasonKey`、`vision-gate.ts:19` 的 `VisionGateResult` 等

**Glass UI 9 档系统**：`docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md` 870 行 spec + 1372 行 plan。9 个 variant（thin/regular/thick/tinted/chrome-up/chrome-down/success/warning/danger）+ a11y 媒介查询 3 条。

- DHH："3 个真实角色（容器 / 浮层 / 状态卡）拆 9 档，是为了语义化命名而牺牲了 conceptual compression。新人的脑子没法装下'这个用 thin 还是 regular？什么时候 chrome-up vs chrome-down？'"
- Carmack："如果你能列出 9 个使用场景且每个都有 visual diff，9 档不算多"
- **裁决：DHH 对，因为 CLAUDE.md 里专门花一段写"主 CTA 一页一个 tinted 名额"——为了一个视觉系统要写规则手册说明它，systemic complexity 已经溢出**

### 4. 错误处理 — minor

- LLM call retry：3 次 + 指数退避 + 120s timeout（`llm-client.ts:242-244`）。clean
- AbortController + 外部 signal forward：`llm-client.ts:255-256`。clean
- `applyTransforms` 的 `js` op 有 try/catch swallow（`transform.ts:74-77`）—— 但默默 return ''，调用方分不清"用户脚本 throw 了" vs "字段值真的是空"
- `seed.ts:25` 的 `console.error('[ensureSeeds] failed:', e)` 是少有的 silent failure：seed 失败应当 throw 让用户知道

### 5. TypeScript 严格度 — major

**应该开但没开的三条**：

```jsonc
// tsconfig.json 当前
"strict": true,
// 缺这三条：
"noUncheckedIndexedAccess": true,    // 影响: combo[alias][idField] 索引返回 string | undefined
"exactOptionalPropertyTypes": true,
"noImplicitReturns": true,           // 影响: validateProp switch 漏 default 静默返 undefined
```

Carmack："`combo[p.alias][p.idField]` (`engine.ts:267`)，如果 idField 是 'spu_id' 而 record 没这个字段，运行时 `id` 是 undefined，`refs[input.alias] = id` 跳过——丢失了一个 task；不会崩，会**静默错**。"

### 6. 测试 — major

**测了对的东西吗？**

- 域核心：`transform / validate / batch-runner / store / datasets` 总共 15 个测——`batch-runner.ts:72-229` 这个 158 行 21 CCN 的状态机**没单测**，靠 e2e 兜
- Copilot：53 个测，覆盖 micro-compact / cache-stats / context-registry / build-llm-messages / 工具 hooks / metadata-client-sync 等。**Copilot 比平台本身测得严**
- e2e：smoke 8 路由 × HTTP 200 ✅；vision-gate 325 行专门测 Copilot 多模态拒绝路径

**裁决**：测试方向反了。正确顺序是"先测域引擎边界 → 再测 Copilot 的 read-only 工具 → 最后测 Copilot 的 write 工具"。现在是工具集 53 测、域引擎 15 测——**因为 Copilot 改得多，所以测得多；但 Copilot 改得多本身就该警惕**

### 7. 性能 — major (Cartesian) / minor (其他)

**`generateTasks` 笛卡尔积无上限**（`schema/engine.ts:39-48`）：

```ts
let combos: Array<Record<string, Record<string, unknown>>> = [{}]
for (const p of perAlias) {
  const next: typeof combos = []
  for (const base of combos) {
    for (const r of p.records) {
      next.push({ ...base, [p.alias]: r })   // ← O(N×M×...)
    }
  }
  combos = next
}
```

3 个 input alias × 1000 records 每个 = 10^9 数组项。`/api/estimate` (`route.ts:21`) 调用同一个函数**先生成完整数组再返 length**——估算和执行用的同一份 bytes。

任意一个用户在 `/experiments/new` 选 "QA × user × box" 三 alias 都满 1k record 时，dev server 立刻 OOM。**没有上界、没有 abort、没有"超 N 警告"。**

**其他 perf 问题**：

- `listDatasets()` (`datasets.ts:30-40`) 每次扫所有 .jsonl 再 split count 行——10MB 数据集每次列表 IO 一次。No cache. 加 `record_count` 字段进 meta.json + 写入时 update 即可
- 88/96 .tsx 是 "use client" → Next.js RSC 完全没用，dashboard 这种纯展示页可以是 Server Component
- `display-jsx.tsx` 用户自定义模板每次 render `useMemo` 重新 wrap，但**不缓存 `babelTransform(source)` 的结果**——同一 display 在每次 result 列表更新时重编译一次

### 8. 安全 — **blocker**

**完整威胁面（按"假设容器暴露在内网/公网"展开）：**

#### S1. 任意用户输入 → 服务端代码执行（two paths）

(a) **TaskSchema variable transform `js` op** (`schema/transform.ts:70-78`):
```ts
case 'js': {
  try {
    const fn = new Function('v', 'ctx', step.fn) as ...
    return fn(v, ctx)
  } catch { return '' }
}
```
TaskSchema 通过 `POST /api/schemas` 创建，任何能访问 API 的人都能塞一个 `step.fn = "require('child_process').execSync('rm -rf /')"`。这是 Node.js 进程内代码执行——**RCE**。

(b) **Display JSX `compileUserJsx`** (`display-jsx.tsx:43-62`): babel.transform → `new Function("React", code)`。运行在浏览器，访问到的是当前用户 origin 的 cookie / localStorage（其中可能存有 LLM API key 因为 `/api/llm-config` GET 返回明文 key）。**XSS / token-stealing**

#### S2. API key 明文 GET 暴露
`GET /api/llm-config` (`route.ts:4-6`) 直接返回 `getLlmConfig()`，每个 model 的 `api_key` 全在里面。无任何 auth。

#### S3. 没有 auth / rate-limit / CORS 配置
- 没有 `src/middleware.ts`
- `eslint.config.mjs` 没启用 `next/security` rules
- Docker `compose up` 后 0.0.0.0:3000 全开。同一局域网他人即可调 27 个 API route 的所有写接口

#### S4. 图片 URL 未校验来源
`batch-runner.ts:295` `saveImagesForTask` 把 LLM 返回的 `images[].url` 写到 `data/results/{exp_id}/images/`。如果是 `http://192.168.x.x/internal/secret.png` —— SSRF 攻击面（让 LLM proxy fetch 内网资源）。代码我读到了 `image-store.ts` 的 `SaveImagesArgs`，但没看到 URL allowlist。需要核实。

#### S5. Skills route OK
`/api/skills/[name]` (`route.ts:5,9`) 用 `^[a-z][a-z0-9_-]*$` regex + path.join，path traversal 拦得住

#### S6. images route 也 OK
`/api/results/[exp_id]/images/[filename]` (`route.ts:13,29-32`) 有正则白名单 + `path.resolve` 二次校验。Defense in depth 做得好

#### S7. Docker 以 root 跑
Dockerfile 没加 `USER node`。Container escape 风险扩大

**裁决：所有四人都会同意，S1 (RCE) + S2 (key leak) + S3 (no auth) 是 blocker。** 项目自我定位是「本地评测平台」，但 docker-compose.yml + HOSTNAME=0.0.0.0 已经为部署铺路。

### 9. 依赖卫生 — minor

- 19 prod / 13 dev — modest
- `npm audit`: 6 issues (5 moderate + 1 high transitive)。high 在 `express-rate-limit > ip-address` 路径下，应该是 dev 工具链 transitive
- knip 抓出 `postcss` unlisted（在 `postcss.config.mjs` 用，但不在 deps）
- `lucide-react` 1.8.0 → 1.14.0 落后；其他几个 patch 落后但不痛

### 10. DX 与文档 — major (反向)

**README + CLAUDE.md + AGENTS.md + CHANGELOG = 188KB**，加上 `docs/superpowers/` 的 31,797 行 markdown 共 113KB markdown。**文档量是 TS 代码 LOC 的 3.4 倍**。

- README 21KB 自带 ToC，新人能 30 分钟跑起来 ✅
- CLAUDE.md 42KB 是给 AI agent 看的 working memory，不是新人 onboarding 文档
- AGENTS.md 24KB 跟 CLAUDE.md 大段重复（"Glass UI 约定"两边都有；"Copilot 工具流程"两边都有）— 维护漂移风险高
- `docs/superpowers/plans/` 14 个 plan 文件，最长一个 5253 行 (2026-05-09 image-vision)。**Plan 文档比真正落地的代码长 3-5 倍**——这是 "通过 LLM 写 spec 比写代码便宜" 的 anti-pattern

DHH："一个人能 hold 这套吗？读完 188KB doc + 31k LOC plans 之后才能改 1 行代码。这违反 conceptual compression。" Carmack："文档量本身没问题——如果它们是参考资料，需要时去查；但 `superpowers/plans/2026-05-09-copilot-image-vision.md` 5253 行专门为一个 'vision gate' 子特性写——没人能在 PR review 时读完它。"

**裁决：DHH + Carmack 都对**。CHANGELOG 95KB 一个文件追溯 14 天 441 commit 是合理的；其他三处该砍。

### 11. 可演化性 — major

加新内置资源类型（比如"评测集合"）需要改的地方：`schema/types.ts`（加 type）→ `seed.ts`（加 seed）→ `lib/{xxx}.ts` 写一份 CRUD → API route 4 个（list/get/create/update）→ UI list / detail / edit / new 4 页 → i18n key 双语 → meta-prompt + skill markdown → relation-diagram 加个方框 → CLAUDE.md 加章节 → AGENTS.md 加章节 → README 加章节。

**8-10 个 touch point**。半天起步、稳态 1-2 天。这种"新加资源"成本能降到 1 文件吗？技术上可以——把资源类型抽成 `Resource<T>` HOF。但当前 4 件资源已经分别长出特殊性（dataset 有 record_count；schema 有 inputs/variables；display 有 jsx mode）—— Abramov："早抽象一定错——这 4 个看起来同构其实不是，强行 unify 会更糟。" 现在的"展开式"是合理选择。

**真正问题在 Copilot 的"加新工具"流程**：每个新 tool 要改 6 处（`tools/{name}.ts` + `tools/registry.ts` + `tools/metadata-client.ts` + `tool-call-card.tsx` VARIANT_BY_TOOL + 测试 + i18n）—— `metadata-client.ts` 是个**手动同步的镜像**，专门有一个测试 `metadata-client-sync.test.ts` 强制对齐。这是 build-step 应该做的事，被搬到了运行时（`metadata-client.ts:8` 的 `ClientToolMetadata` 复制了 server 的 `ToolMetadata`）。**Linus："你为什么不一份 metadata、客户端按需 import 一个 client-safe 子集？因为 server 那侧 import 了 fs，会污染 client bundle。把 fs import 移出 metadata 文件就行了。"**

### 12. git 卫生 — good

- Commit message 严格 conventional：`type(scope): subject`，CONTRIBUTING.md 里写明
- 441 commits / 14 天 = 高速迭代但 message 不糊
- Feature branch + PR 流程明确，merge commit 保留
- Tag 24 个，按 `vX.Y.Z` 松散里程碑使用
- **AGENTS.md 写明 broken tag 处理流程** —— 难得的工程严谨
- 唯一槽点：`.claude/worktrees/` 没在 .gitignore；`?? .claude/worktrees/` 已经污染 git status 几天

---

## evalyst 特有雷达

### 13. `@babel/standalone` 浏览器编译用户 JSX — high

见 §8 S1(b)。**没有沙箱**：用户函数能 `window.location` / `document.cookie` / `fetch('/api/llm-config')`。`compileUserJsx` 包了 `new Function("React", code)`——整个 page scope 全暴露。

唯一的"保护"是 `data/displays/` 文件需要管理员粘贴 JSX 进去，假设用户只信任自己粘的代码。但项目允许通过 `POST /api/displays` 创建 display（`route.ts`），**API 没 auth**——任何能访问的人能创建 display 并在另一用户的浏览器执行任意 JS。

**performance**: `@babel/standalone` ~3MB minified。`display-jsx.tsx:18` 用 dynamic import lazy-load——做得对 ✅。但每次 render display 都重新调 `babelTransform(source)`（`useCompiledJsx` 的 deps 是 `[source, ready, ...]`，但同一 display 多个 result 共享同 source 应当只编译一次——目前是的，因为 `useMemo` 在 source 不变时缓存）✅

DX：编译错误返回 babel 的错误 message，给用户行号——OK。运行时错误进 ErrorBoundary 显示 message——也 OK。

### 14. file-based 持久化的并发与原子性 — major

- **写：** `writeAtomic` (`fs-utils.ts:10`) 是 tmp + rename，单进程内是原子的。multi-instance 同 mount 下还是会 race（rename 是 last-writer-wins）— Docker compose 单实例 OK
- **读 results.jsonl：** `appendFileSync`（`store.ts:127`）不走 writeAtomic。POSIX 上 < PIPE_BUF (4KB) 的 append 是原子的，单条 result line 通常 < 4KB，但**若 result 含长 raw_response（大模型 100KB output），append 不是原子的，并发写有交错风险**
- **schema 演化：** `migrateExperimentInMemory` (`store.ts:18-23`) + `migrateResultInMemory` (`store.ts:29-47`)，**只在内存里迁移**——文件永远是旧 shape。Linus："好，避免迁移时损坏。" 但 `migrate` (`llm-config.ts:75-120`) 三层 V1/V2/V3 兼容，**保存时 (`saveLlmConfig:172`) 写入新 shape**——一旦保存就不再有旧 shape。两条策略不一致：experiments 永远只读迁移、llm-config 写时迁移
- **API key in `data/llm-config.json`：** 文件权限默认 0644。Container 用 root 跑，没 chmod。`fs.writeFileSync` 没指定 mode

### 15. 笛卡尔积边界 — blocker

见 §7。`/api/estimate` 自己就是 attack vector：3 个 1000 records 的 dataset 一次估算 = 进程 OOM。

### 16. LLM 调用健壮性 — minor (域核心) / major (Copilot)

- 域核心 (`llm-client.ts`): 3 retry / 120s timeout / abort signal forward / 429+5xx 重试 — clean
- 同样的逻辑**复制了一份**到 `src/lib/copilot/llm-stream.ts:1`（700 行），因为流式 SSE 不能复用非流式的 retry 框架。两个 `imageBlockForAnthropic` 几乎相同（`llm-client.ts:60` 和 `llm-stream.ts:20`）—— `llm-stream.ts:16` 自己注释了 "YAGNI 就地拷贝，避免跨模块依赖"。Linus："这是反 DRY，可以接受，因为 LLM API 各家差异不在这层。"
- **Cost 计算**：`batch-runner.ts:269` 每 task 实时 `findPricing()`——允许中途改价。文档说不追溯，但实际 retry 一条 task 的 cost 是按当时 pricing 重新算（覆盖旧），这点和"历史不追溯"轻微矛盾
- **可重现性**：temperature 配置存到 ExperimentConfig 但**没有 seed 字段**。同一 input 跑两次结果不一致是 LLM 本身的，但 Evalyst 没暴露 seed/top_p 设置——评测平台缺这条
- **超长 input**：没看到任何 token-counting / context-window 检查。`max_tokens` 是 output 限制，input 超了直接靠 provider 返 400，错信息会进 result.error。OK 但不优雅

### 17. knip 直接证据 — minor

> ⚠️ **本节数字不可信，详见 [§Errata E2](#errata2026-05-10更新)**。`knip` 当时未配置（in devDeps 但无 config / 无 script），下面 16 + 38 是默认行为输出，未排 worktrees / .next / 测试代码噪音。真要量化先把 knip 配上。

实际有效信号（去掉 worktree 噪音）：
- 16 unused exports（`pickVariant` `formatValue` `splitSseEvents` 等几个工具函数；shadcn ui 暴露了未使用的 sub-component 是常态）
- 38 unused exported types（约 11 个在 `manifest.ts`，是 §3 提到的早抽象）
- 1 unlisted dep: `postcss`

修复 30 分钟以内，但 `.claude/worktrees/` 没 ignore 让 knip 输出"2361 unused files"——首次跑 knip 的人会觉得整个项目都死了。**应当在 package.json 加 `knip.ignore: ['.claude/worktrees/**']`** —— Errata E2 修订：还要先加 `knip.json` 配置 + `npm run knip` script，本审视报告里这条假设了 knip 已正确配置，事实没。同样 ESLint 也没排 worktrees（[Errata E3](#errata2026-05-10更新)）。

### 18. 三大文档关系 — major

- README.md (21KB): 用户 onboarding，正确职能
- CLAUDE.md (42KB): "agent working memory"——大段 i18n 约定 / Glass 约定 / Copilot 约定 / 测试约定
- AGENTS.md (24KB): 几乎是 CLAUDE.md 的子集 + 开发流程（branch 命名 / commit / tag / CHANGELOG）。**和 CLAUDE.md 重复 60%+**
- CONTRIBUTING.md (5KB): 比 AGENTS.md 短的开发流程版

DHH："给 agent 看的应该是机器解析的格式（schema / config）；给人看的是 README。CLAUDE.md 这份'human-readable but written for AI'是中间形态，最难维护。"

**实际矛盾**：CLAUDE.md 和 AGENTS.md 都讲"加新资源流程"，但 CLAUDE 强调"i18n 双语"（"必须成对加 key"）、AGENTS 强调"原子写、走 writeAtomic"——这些应该是一份。两份各写一半。

### 19. shadcn + @base-ui/react 共存 — minor

`@base-ui/react` 直接 import 12 文件，shadcn 包了一层在 `src/components/ui/{select,dialog,checkbox,...}` 共 19 个。`components.json` 是 shadcn 配置 (`base-nova` 风格)。

抽样查了 shadcn 的 select.tsx ——它确实是 base-ui 的 wrapper。所以 12 个直接 base-ui 用法是**绕过 shadcn 自定义某些 popover / segmented 行为**——合理用法。不是双库混乱

### 20. "规划中" 功能在代码里的残留 — none

README 自称"Copilot 工具调用闭环规划中"——CHANGELOG 显示 v0.7.0 (PR #24) 已合入，且 5 个 Copilot e2e spec + 53 单测全在跑。**README 落后于现实。** 这种 doc drift 在文档量这么大的项目里几乎必然。

### 21. zero-config 隐藏代价 — minor

- `npm run dev` 启动后访问 `/`：seed 自动跑、读 data/ 不存在就建。**第一步是 `/settings/llm` 配置一个模型**——如果用户跳过这步去新建实验，`createExperiment` 会 throw "No LLM model configured" (`store.ts:73`)。错误信息**不告诉用户去 `/settings/llm`**——其实它告诉了 (`set one up in /settings/llm`)，OK
- Docker compose 没在 README 强调"端口 3000 别 expose 公网"——属于约定俗成
- `data/` 默认在 cwd 下——如果用户从别的目录起 `next start`，seed 跑到错地方。`process.cwd()` 是惰性解析，文档说"生产 cwd 固定"——不一定，systemd 服务会变 cwd

---

## 评审视角四人组裁决摘要

**这张表的作用是分歧解决，不是优先级排序。** Blocker（RCE / key leak / Cartesian OOM）不进表，因为四人**没有分歧**——`js` op、`/api/llm-config` 明文、`generateTasks` 全量物化，Linus/Carmack/DHH/Abramov 一致 "立刻修"，一致的事不需要 verdict。进表的是**他们会打架**的项：Glass UI 9 档要不要简化？文档量算不算债？88/96 use client 是 Next 学习成本还是工程懒散？这些没有客观对错——必须取一个立场，所以列出来给你看我怎么裁。

**裁决"判断成立"≠ "进修复清单"**。一件事可以"是问题"但**不优先修**——比如 Glass UI 是认知开销而非功能伤害，Manifest 早抽象是 free win 但不解锁什么。所以下表"行动"列明确给出"修 / 不修 / 哪一档"，对齐到下面的修复清单。

| 议题 | Linus | Carmack | DHH | Abramov | 判断 + 行动 |
|---|---|---|---|---|---|
| Copilot 是不是另一个项目 | "随便" | "数据流清晰" | "切" | "切" | DHH 对 → **Tier 1 #2** 切 |
| Glass UI 9 档系统 | "数据结构对，分支自然少" | "9 个真有 visual diff 就行" | "系统已有手册，说明撑不住" | "config 化 OK" | DHH 视角成立，但 **不修** —— 视觉系统没坏，认知开销不是 blocker |
| `js` op | "垃圾，就是 RCE" | "为啥要这功能" | "删" | "删" | 一致 → **Tier 1 #1** 删 |
| 文档量 vs 代码量 | "随便" | "doc 是参考资料就 OK，但 plan 不算" | "违反 conceptual compression" | "plan 用 LLM 写，便宜了 cost 但堆债" | DHH+Abramov 对 → **Tier 1 #5** 部分修（CLAUDE/AGENTS 拆，**CHANGELOG 不动**） |
| tsconfig 不开 noUncheckedIndexedAccess | "开" | "开" | "够用就行" | "开" | 三比一 → **Tier 1 #4** 开 |
| Manifest 早抽象 | "删" | "删" | "删" | "我说过早抽象错" | 一致 → **Tier 3 batch** 打包删（无伤害，不优先） |
| `appendFileSync` 不走 writeAtomic | "single-instance OK" | "够用" | "OK" | "OK" | 一致 → **不修**（未来多实例时再说） |
| Docker root + 0.0.0.0 | "改" | "改" | "随便" | "改" | 三比一 → **Tier 1 #1** 顺带 + **Tier 3** 加 USER node |
| 88/96 use client | "Next 是麻烦事" | "perf 算账没那么重要" | "用框架就用对" | "RSC 学习曲线在那" | 分歧无主，**不修**——记一笔 |

---

## 第 3 步 · 修复清单

按"修完解锁什么"排，分三档：Tier 1 是 blocker / 巨大边界，Tier 2 是该修但不紧急，Tier 3 是 cleanup batch PR。

### Tier 1 — blocker / 巨大解锁（5 条 · ~7 人天）

#### 1. 关掉 RCE：移除 `js` transform op + 把 `/api/llm-config` 锁住

**当前状态**：`schema/transform.ts:70-78` `new Function('v','ctx',step.fn)` + `/api/llm-config` GET 明文返 API key + 全部 27 个 API route 无任何 auth gate。

**期望状态**：
- 删 `js` op（确认 0 个 schema 在用——快速 grep `data/schemas/*.json` 查 `"op":"js"`）
- 删了之后该位置抛 "INVALID_TRANSFORM_OP"
- `/api/llm-config` GET 把 `api_key` 字段 mask 成 `sk-***...***xxx` 末 4 位（PUT 仍写明文，但 GET 不返）
- 在 `src/middleware.ts` 加 origin 白名单：`localhost:*` + `127.0.0.1:*`，其他来源直接 403。容器部署用户需要显式开 ENV `EVALYST_ALLOW_ORIGIN`

**工作量**：1 人天

**解锁**：从"localhost-only 不能部署"变成"可以装在内网工具机"。也是关掉 §8 S1+S2+S3 三个 blocker

#### 2. 拆出 `@evalyst/copilot` 的 conceptual border

**当前状态**：`src/lib/copilot/` + `src/components/copilot/` + `src/app/api/copilot/` 共 18,474 LOC 与平台耦合点只有 3 处（restart_experiment / read_*  tools / glass UI 共享 css var）。CHANGELOG 一半篇幅在改 Copilot；新人 onboarding 第一周打不到平台领域核心。

**期望状态**：
- 物理分目录但仍在 monorepo：`src/copilot/{lib,components,api}` 三目录全归一
- `src/lib/types.ts` 不 re-export Copilot type
- README + AGENTS.md 一开篇明示"评测核心 ≈ 9k LOC，Copilot 助手 ≈ 18k LOC，可独立理解"
- `docs/superpowers/` 下 plan/spec 全部 prefix `copilot-`，把 `theme-cascade.md` 这种领域核心相关的挪到 `docs/specs/`

**工作量**：2 人天（多数是文件移动 + import 路径修）

**解锁**：心智模型可以一个人扛起来；新人第二周才需要看 Copilot

#### 3. 给 Cartesian product 加 hard cap + 让 estimate 真的 estimate

**当前状态**：`engine.ts:39` 全量物化、`/api/estimate` 也是。

**期望状态**：
- `generateTasks` 内嵌 hard cap（默认 100k，超了 throw `TOO_MANY_TASKS`）
- `/api/estimate` 改成"算每 input 过 filter 后的 records.length，相乘"——不物化 array
- UI 在 estimate > 5000 时弹 confirm "你确认要跑 N 个 task？"

**工作量**：0.5 人天

**解锁**：把"用户随手点几下能 OOM dev server"封掉。也让 estimate 100x 快

#### 4. tsconfig 严格化 + 修 `validateProp` 默认分支

**当前状态**：tsconfig 缺 `noUncheckedIndexedAccess` / `noImplicitReturns` / `exactOptionalPropertyTypes`。`validate.ts:14` switch 没 default 分支。

**期望状态**：
- 三个 strict 选项都开
- `validateProp` 末尾加 `default: { const _: never = prop.type; throw new Error(\`unknown type: ${_}\`) }` exhaustive check
- 修 tsc 报出来的所有 indexed access errors（预估 30-50 处，多数是 `combo[alias][idField]` 这类）

**工作量**：1.5 人天

**解锁**：把"加新 JsonFieldType 静默坏"+"index undefined 静默丢 task"两类 future bug 关掉

#### 5. 文档分裂 + 砍冗余（CHANGELOG 不动）

**当前状态**：CLAUDE.md 42KB 与 AGENTS.md 24KB 重叠 60%；`docs/superpowers/plans/` 31k 行；CHANGELOG 95KB。

**期望状态**：
- AGENTS.md 收缩到 ≤ 5KB——只放"开发流程 + 命令速查 + AI assistant 约定"
- CLAUDE.md 拆成 3 份：`docs/architecture.md` + `docs/copilot.md` + `docs/conventions/glass-ui.md`，CLAUDE.md 自身只剩链接索引（≤ 8KB）
- README 同步 Copilot 已 ship 的事实（删 "规划中"）
- `docs/superpowers/plans/` 历史 plan 移到 `docs/superpowers/archive/`，根目录只留 `_index.md` 列出仍是工作内存的 plan
- **CHANGELOG.md 保留不动**——95KB / 24 tag ≈ 每 tag 4KB 是合理密度；它的成本只对做 release archaeology 的人收一次，而 CLAUDE.md 是每个 AI session 全文 load。等到 v1.0 时再考虑把 v0.x 折到 `CHANGELOG.history.md`

**工作量**：2 人天

**解锁**：onboarding 30 分钟变可能；AI session 加载成本降一半

### Tier 2 — 该修但不紧急（6 条 · ~5-5.5 人天）

#### 6. SSRF: LLM 返回的图片 URL 加 allowlist

**当前状态**：`batch-runner.ts:295` `saveImagesForTask` 把任意 URL 写盘前不过滤来源。恶意/被劫持 LLM 可以让 evalyst 拉内网资源。

**期望状态**：`image-store.ts` 写盘前 URL 白名单：接受 `data:image/*` + `https://`；拒绝 `file://` / `http://10.*` / `http://192.168.*` / `http://127.*` / `http://169.254.*`（cloud metadata）。

**工作量**：0.5 人天 · **解锁**：关 §8 S4

#### 7. `batch-runner.run` 写单测

**当前状态**：158 行 21 CCN 的状态机现在只有 e2e 兜——任何 concurrency / resume / retry / taskIds 改动都赌实测。

**期望状态**：mock `callLlm` + `appendResult`，覆盖：resume + 部分 failed + taskIds 子集 + 中途 stop + 三种 progress 累加路径。

**工作量**：1.5 人天 · **解锁**：以后改 batch-runner 不再需要先跑半小时 e2e

#### 8. ExperimentConfig 加 `seed` 字段 + 透传

**当前状态**：评测平台没 seed 字段是**领域功能缺失**——A/B 对照试验不可重现。

**期望状态**：`types.ts` 加 `seed?: number`；`llm-client.ts:163` `buildRequestBody` 透传到 OpenAI 的 `seed` body 字段（Anthropic 没原生支持就丢 + warn）；UI `experiments/new` 表单加一格"seed (optional)"。

**工作量**：0.5 人天 · **解锁**：可重现实验，A/B 对照试验有意义

#### 9. 干掉 `globalThis.__activeRunners` 单例 → 文件锁

**当前状态**：`batch-runner.ts:20` 的 HMR workaround 同时把"多 worker 部署不可能"焊死了。

**期望状态**：改成文件锁 `data/results/{exp_id}/.runner.lock` 写入 PID + 启动时间；`/run` 启动前检查锁，stale lock (PID 不存在) 自动清。

**工作量**：1 人天 · **解锁**：将来 `next start -w 4` / docker swarm 不会立刻翻车

#### 10. `metadata-client.ts` 镜像问题真正修掉

**当前状态**：tool 的 server 端和 client 端 metadata 是**两份手抄 + 一个 sync 测试守门**——build-step 应该做的事被搬到运行时。

**期望状态**：把 `tools/{name}.ts` 的 fs import 推到独立 `server-call.ts`；metadata 留在 `{name}.ts` 由 client 直接 import。删 `metadata-client.ts` + `metadata-client-sync.test.ts`。

**工作量**：1 人天 · **解锁**：加新 tool 从改 6 处变改 3 处

#### 11. 修 `react-hooks/rules-of-hooks` 5 处真 bug（2026-05-?? lint baseline 暴露）

> **2026-05-?? 状态：✅ closed via PR #67 + v0.11.6**——`fix/react-hooks-rules-of-hooks` branch 完整修复合入 main（重生成 commits `9e625ca` triple-grid + `413f1cf` dual-list + `1c19658` CHANGELOG），手法 Pattern B（useMemo bodies short-circuit when dim is undefined）。`npm run lint` 当前 0 处 rules-of-hooks errors。**v0.11.5 CHANGELOG 引用的原 commit hash (`ca5dfcb` / `60a833a`) 在 main 上已不存在**（merge 时重生成）—— 历史精度问题，不影响功能；v0.11.6 release 包含完整修复。Phase E gate 不再含此项前置依赖。

**当前状态**：`chore/lint-fix-batch` 跑 baseline 时发现 5 处 `useMemo` 在 early return 之后调用——`triple-grid-results.tsx:37,38,39` + `dual-list-results.tsx:37,38`。违反 React hook 顺序约束，触发会爆 `Rendered fewer hooks than expected` 或更阴险的状态错位。

**未爆原因**：early return 条件（如 `results.length === 0`）实际很少命中。这是定时炸弹不是已坏。

**期望状态**：把这些 useMemo 移到 early return 之前；e2e smoke 覆盖 early return 路径渲染稳定。

**工作量**：~~0.5–1 人天~~（实际 0.5d，含 branch fix + retrofit PR）· **解锁**：消除潜在 production crash 隐患 · **PR**：~~`fix/react-hooks-rules-of-hooks`~~ ✅ PR #67 已合

### Tier 3 — Cleanup Batch PR（原估 0.5 人天 · 实际 2.5-3d，详 [§Errata](#errata2026-05-10更新)）

> **2026-05-10 更新**：实际拆为 3 个 PR。原列表里有几项 audit drift（详 Errata），有几项 defer 到 v0.11.1 / .2 patch。下面保留原文备参考，**真实施工范围以 Errata 表格为准**。

打包成 `chore/audit-cleanup` 一个 PR：

- knip 加 `ignore: ['.claude/worktrees/**']`
- `.claude/worktrees/` 加进 `.gitignore`
- Dockerfile 加 `USER node` + builder 阶段 `npm prune --omit=dev`
- `src/lib/types.ts:5` 删 11 项 unused re-export
- `src/lib/copilot/manifest.ts` 删 11 个 unused interface
- `display-form-modes.tsx` ⇄ `display-form-page.tsx` 1 个循环依赖
- Lint CI 的 `continue-on-error` 改回 fail → 修现有 warning
- `extractImageRefsFromOutput` 9 参数 + CCN 35：拆参数对象 + 拆子函数
- README 加一条 "rm -rf .next 重启偶发清缓存"
- 清理其余 16 unused exports + 38 unused exported types（knip 列表过一遍）

**工作量**：0.5 人天 · **解锁**：knip / lint / 死代码清零，下一个 review 周期信号干净

### 总览

```
Tier 1 (blocker / 巨大解锁) ── 5 条 ── ~7 人天
Tier 2 (该修但不紧急)       ── 6 条 ── ~5-5.5 人天   (含 #11 rules-of-hooks 拾遗)
Tier 3 (cleanup batch PR)   ── 1 PR ── 0.5 人天 ⚠️ 实际 2.5-3d 详 §Errata
                                       ─────────
                                       ~12 人天 (修订后 ~14-15d 含 lint/hooks 拾遗)
```

一个人 2-3 周收尾，项目从"能跑但有 RCE"到"小开源工具水准"。

---

## 第 4 步 · 执行顺序（按 Phase，不按 Tier 序号）

Tier 序号是按"修完解锁什么"排的；**执行顺序按风险 / 依赖关系排**。

```
Phase A — 止血（安全 blocker） ────────── 1.5d
   #1  RCE + key leak + auth gate          1d
   #6  SSRF 图片 URL allowlist              0.5d   (同一威胁模型，搭车修)

Phase B — 上安全网（先有测试再重构） ──── 1.5d
   #7  batch-runner.run 单测                1.5d   (后面要改 Cartesian 和 file-lock，不能裸跑)

Phase C — 速胜（小且独立） ─────────────── 1.5d
   #3  Cartesian hard cap + estimate 不物化  0.5d
   #8  seed 字段透传                        0.5d
   T3  cleanup batch PR                     0.5d

Phase D — 类型补网 ────────────────────── 1.5d
   #4  tsconfig 三严格 + validateProp        1.5d   (会冒出 30-50 个 latent bug，要逐个修)

Phase E — 结构性重构（吃掉 Phase D 的红利） 4d
   #2  Copilot 物理切边                     2d
   #10 metadata-client mirror 拆掉           1d    (Copilot 切完顺手做)
   #9  globalThis → 文件锁                  1d    (Tier 1 #2 边界画清后再改)

Phase F — 文档收尾（最后做，反映最终状态） 2d
   #5  CLAUDE/AGENTS 拆 + 历史 plan archive  2d

post-v0.11.0 patch（串行优先，详 §Errata） ~1.5d
   ~~chore/knip-config-and-cleanup~~  ≈ 0.5d   (in-flight, knip session 进行中)
   ~~chore/lint-fix-batch~~           ≈ 0.5d   ✅ PR #65 合 main + v0.11.6
   ~~fix/react-hooks-rules-of-hooks~~ ≈ 0.5d   ✅ PR #67 合 main + v0.11.6
```

> **2026-05-?? 更新**：lint baseline 实测 27 problems 后（详 §E4），原计划的 `chore/lint-fix-batch` 拆成两个 PR——纯 lint cleanup（22 处）+ 真 bug 修复（5 处 rules-of-hooks）。**已落地状态**：PR #67 (rules-of-hooks) + PR #65 (lint-fix-batch + react19-hydration convention doc + CI lint enforce fail-on-warning) 都合 main，v0.11.6 tag 已打。剩 `chore/knip-config-and-cleanup` 一项 in-flight；合后 Phase E execution gate 完全开放。Phase E gate 现在 = "**knip 合 main**"。

**理由**：
- 安全 blocker 不能等 → A 必须最先
- 重构前先有 batch-runner 单测 → B 早于 E
- tsconfig 严格化必须在 Copilot 切边**之前**——切边时大量改 import，类型严格能立刻抓回归 → D 早于 E
- 文档放最后——任何代码改动都会让 docs drift，先改完再写 → F 最后

### 工作流约定

- **1 份 master spec**（≤ 200 行）→ `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md`
  - Phase 顺序 + rationale；每项 scope / 验收 / 受影响文件
  - **决策日志**：哪些不修（Glass UI / Manifest / appendFileSync / use client / CHANGELOG）+ 理由
- **每项 > 1d 的配 lightweight plan**（≤ 100 行）→ `docs/superpowers/plans/2026-05-09-audit-{slug}.md`
  - 共 7 项：#1 / #2 / #4 / #5 / #7 / #9 / #10
  - **明确禁止 1000+ 行的史诗 plan**——这是本次审视专门点名的反模式（见 §10）
- **<1d 的项**（#3 / #6 / #8 / Tier 3 batch）直接动手，不写 plan
- **每项一个 PR**，branch 命名按 AGENTS.md 约定（`fix/auth-gate-rce` / `refactor/copilot-boundary` / ...）；保持 git history 可追溯、可单点 revert
- 跨 Phase 严格按顺序；同 Phase 内可独立 commit

---

## Errata（2026-05-10 更新）

执行 Phase C Tier 3 cleanup（PR #60）时发现 3 处 audit drift / measurement noise。原文不动，此处统一修订。**不影响 Top 5 / Tier 1+2 的整体顺序**，但 Tier 3 工作量从 0.5d 修订到 2.5-3d，并产出 2 个 v0.11.0 后的 patch PR。

### E1 · `extractImageRefsFromOutput` 实际 5 params 不是 9

`src/lib/copilot/image-attach.ts:53` 实际签名：

```ts
export function extractImageRefsFromOutput(
  output: Record<string, unknown>,
  schema: TaskSchema,
  expId: string,
  ctx_tag?: number,
  task_id?: string,
): ImageRef[]
```

5 个 params。审视报告 §7 / Tier 3 引用 lizard `9 PARAM` 是 noise（疑似把 nested 闭包参数算进去）。CCN 35 仍属实但不需要"拆参数对象"。**Tier 3 batch 撤销此项，无工作量**。

### E2 · knip 未实际配置（§17 数字不可信）

审视报告 §17 给出"16 unused exports + 38 unused exported types"——这些数字源于 `npm exec knip` 的**默认行为**。事实：

- `knip` 在 devDependencies ✅
- 无 `knip.json` / `knip.config.ts` / `package.json#knip` ❌
- 无 `npm run knip` script ❌

意味着 §17 数字未排除 worktrees / `.next` / 测试代码等噪音，实际不可靠。**真要量化必须先把 knip 正式配上**——这是新增工作，记入 `chore/knip-config-and-cleanup`（~0.5d）：

1. 加 `knip.json`：`ignore: ['.claude/**', '.next/**', 'src/**/__tests__/**']`
2. 加 `npm run knip` script
3. 跑 + 重新量化"长尾 unused"
4. 删确认死掉的（PR #60 已删 22 项最高确信的：types.ts 11 + manifest.ts 11）

### E3 · ESLint scope bug（同样未排 worktrees）

审视报告 §17 / §12 只点了 knip 没排 worktrees，**漏了 ESLint 同样问题**。`eslint.config.mjs` 没 ignore `.claude/worktrees/agent-*/.next/`，跑出 62k+ warnings——掩盖了真实信号。

PR #60 中已修（加 `**/.next/**` + `.claude/**` ignore）。修后 src/ 真实 lint 状态：

| 类别 | 数量 | 性质 |
|---|---|---|
| `react-hooks/set-state-in-effect` errors | 23 | per-occurrence judgment（每个 setState in useEffect 要个案审，不是 mechanical fix）|
| `react-hooks/rules-of-hooks` 等其他 errors | ~few | 合并到上面的 batch |
| `react-hooks/exhaustive-deps` warnings | 3 | judgment call |
| 其他 mechanical warnings | ~22 | PR #60 已清 |

**审视报告 Tier 3 列表里 "lint continue-on-error 改 fail 0.5 人天" 严重低估**——23 个 setState-in-effect 是 eslint 9 + react 19 的新规则，per-occurrence review 工作量 ~1-1.5d。defer 到 `chore/lint-fix-batch`（含翻 CI lint fail）。

### Tier 3 实际拆分（替换原 §Tier 3 列表）

| 已合（PR #60 · `chore/audit-cleanup` · ~1d） | 延后（v0.11.0 后的 patch · ~1.5-2d） |
|---|---|
| `.claude/worktrees/` 进 `.gitignore` | **`chore/lint-fix-batch`** ≈ 1-1.5d |
| Dockerfile `USER node` + `npm prune --omit=dev` | · 23 errors（setState-in-effect / rules-of-hooks / no-use-before-define） |
| `src/lib/types.ts:5` 删 11 unused re-export | · 3 exhaustive-deps warnings |
| `src/lib/copilot/manifest.ts` 删 11 unused interface | · 翻 CI lint `continue-on-error: true` → `false` |
| `display-form-modes` ⇄ `display-form-page` 循环依赖修 | |
| ESLint ignore `**/.next/**` + `.claude/**`（E3 新增） | **`chore/knip-config-and-cleanup`** ≈ 0.5d |
| ~14 unused imports + underscore convention 修 | · 加 knip.json + script |
| README 加 `.next` 缓存清理注 | · 重量化长尾 + 删确认死掉的 |
| ~~`extractImageRefsFromOutput` 9→5 拆参数~~（E1 撤销） | |
| ~~"清理其余 16 + 38 unused"~~（E2 数字不可信，转 follow-up） | |

**总工作量修订**：原估 0.5d → 实际 ~3d（PR #60 `1d` + 两个 follow-up `~2d`）

### 时机：串行优先，knip 那条可与 D 并行

两个 follow-up 都不阻塞 Phase D / E / F 主线，但**推荐串行**而非全并行——理由是 `chore/lint-fix-batch` 与 Phase D 在 `use-chat-stream.ts` 等文件高度重叠（D 的 noUncheckedIndexedAccess 47 errors + lint-fix-batch 的 setState-in-effect 几个）会互相 rebase。

**推荐顺序**：

```
v0.11.0 tag (A+B+C 全合)
   ↓
chore/knip-config-and-cleanup (v0.11.1, ~0.5d)   ← 与 Phase D PR-1 可并行（不冲突）
   ↓
Phase D PR-1 (noUnchecked + noImplicitReturns)
   ↓
Phase D PR-2 (eopt)
   ↓
chore/lint-fix-batch (v0.11.2, ~1-1.5d)          ← 必须放 D 后，避开 use-chat-stream rebase
   ↓
Phase E (Copilot 切边)
```

**约束**：
- **Phase D plan §5 验收要改**：原本"`npm run lint` 0 warning"前提是 Tier 3 翻 fail；实际没翻。改成"≤ 合 #60 后 baseline（约 26 warnings 全在 deferred batch 范围），不新增 warning"。绝对零阈值前置依赖 `chore/lint-fix-batch` 先合
- **`chore/knip-config-and-cleanup`** 安全可与 D PR-1 并行——它只改 `knip.json` + 删确认死掉的 unused exports，触不到 D 的 strict 战场
- **`chore/lint-fix-batch`** **不要**与 D 并行——`use-chat-stream.ts` 是双方重灾区，并行只会互相 rebase
- D / E 重构 Copilot 时部分 setState-in-effect 可能自然消失，等 D / E 完了 `chore/lint-fix-batch` 量化更准

### Lint reality 的实际影响（系统 / 用户视角）

部分修复 deferred 不是大问题——**这是项目"自我代谢能力"指标，不是用户能看到的功能**。

| 维度 | 影响 | 严重度 |
|---|---|---|
| 安全 | 0 | 不影响 |
| 数据正确性 | 0 | 不影响 |
| 用户感知 | 极少数情况 Copilot 流式可能多渲染几次，本地评测工具几乎测不出 | 不影响 |
| 运行时风险 | `rules-of-hooks`（少数）真触发会随机崩，但不在生产路径上；`exhaustive-deps`（3 个）可能造成"刷新就好了"的偶发 bug | 低-中 |
| 开发者卫生 / 技术债 | CI lint `continue-on-error` + knip 未配 = 项目失去代码健康度实时信号；新增坏味道无人拦 | 中-高 |

23 errors 拆开看：
- `react-hooks/set-state-in-effect`（~80%）：项目能跑说明多半是 false positive 或循环被 guard 截断
- `rules-of-hooks`（少数）：定时炸弹但没在生产路径
- `exhaustive-deps`（3 warnings）：可能用户偶发遇到但归因为"刷新就好"
- `no-use-before-define`（5）：0 运行时风险，仅阅读混乱
- knip 62k+ 噪音：纯**警报疲劳**问题——不影响运行，影响"开发者每次跑 lint 看到这么多警告会麻木"

修它解锁的是**长期开发者体验**，不是即时用户价值。所以放在 v0.11.x patch 而非 v0.11.0 主 tag 内是对的。

### E4 · Lint baseline 实测后拆 `chore/lint-fix-batch` 为 2 个 PR（2026-05-?? 更新）

`chore/lint-fix-batch` session 跑 baseline，实际数字与 §E3 估计有出入：

| Rule | 实测 | §E3 估计 | 性质 |
|---|---|---|---|
| `react-hooks/set-state-in-effect` | **16** errors | 23 errors | per-occurrence judgment（多数是 localStorage hydrate）|
| `react-hooks/rules-of-hooks` | **5** errors | "少数" | **真 bug**（hooks 在 early return 后调用，hook 顺序违例） |
| `react-hooks/exhaustive-deps` | 3 warnings | 3 warnings | judgment call，多数 suppress + 注释 |
| `react-hooks/preserve-manual-memoization` | 1 error | — | React Compiler hint |
| `react-hooks/immutability` | 1 error | — | React Compiler hint |
| unused `eslint-disable` directive | 1 warning | — | 一行删 |
| `no-use-before-define` | **0** | 5 | 已在 PR #60 修完或 §E3 估计错 |

**总计 27 problems（23 errors + 4 warnings）**——落在 audit §修复决策树"1–30 直接干"区间，但 5 处 `rules-of-hooks` 是**真 bug 不是 lint cosmetic**。

#### 拆分决策

按 audit "警告里有任何'行为可疑'的 rule，停下问我——这不是 lint 修复是 bug 修复，应该独立 PR" 红线，5 处 `rules-of-hooks` **从 `chore/lint-fix-batch` 拆出**，新增 PR `fix/react-hooks-rules-of-hooks`（见 Tier 2 #11）：

| PR | 范围 | 性质 | 工作量 |
|---|---|---|---|
| `chore/lint-fix-batch`（v0.11.2） | 16 处 set-state-in-effect 逐处 suppress + 链 doc / 3 exhaustive-deps suppress / 3 cosmetic / 翻 `continue-on-error: false` | lint cleanup | ≈ 0.5d |
| `fix/react-hooks-rules-of-hooks`（v0.11.3） | `triple-grid-results.tsx:37-39` + `dual-list-results.tsx:37-38` 共 5 处 useMemo 移到 early return 之前 | 真 bug 修复，组件结构调整 | ≈ 0.5-1d |

#### `set-state-in-effect` 16 处的处理路径

3 选 1：

- **A. 逐处 `// eslint-disable-next-line` + 链 doc** ✅（选这个）
- B. 改 `useSyncExternalStore`——架构升级，4-8x 工作量，与 lint cleanup 失焦
- C. eslint config 把这条 rule 降为 `warn`——越界（audit 禁区："不引入新 lint rule / 不改 eslint config 严苛度"）

选 A 的理由：localStorage hydrate 是历史成熟 pattern；React 19 + React Compiler 这条 rule 还在调试期；本项目 88/96 是 client component，SSR mismatch 风险面有限；改 `useSyncExternalStore` 应作为独立 React 19 优化 PR 不混进 lint cleanup。

#### 配套：写一份 convention doc

`docs/conventions/react19-hydration.md`（≤ 30 行）解释：
1. localStorage hydration 为何要在 useEffect 里 setState
2. 为何**不**改 `useSyncExternalStore`（client-component 居多 / 风险面小 / ROI 不划算）
3. 未来若改时怎么改的备忘录
4. 16 处 disable 注释链向此 doc

避免每处写一长段注释（视觉债）。统一一份 doc 解释一次。

#### `chore/lint-fix-batch` 工作量从 §E3 的 1-1.5d 修订到 0.5d

原估包含 5 处 rules-of-hooks 修复 + per-occurrence review；现在 rules-of-hooks 拆出 + set-state-in-effect 走 mechanical suppress + 链 doc，工作量降到 0.5d。

#### Phase E execution gate 更新

原 gate："Phase D 全合 main 后启动 Phase E execution"。

新 gate：**"Phase D + chore/lint-fix-batch + fix/react-hooks-rules-of-hooks 全合 main 后启动 Phase E execution"**。

理由：E 的 `git mv` 会把所有 Copilot 文件搬到新路径；如果 lint-fix 或 rules-of-hooks 还没合，文件搬完后还得在新路径下再修一遍。让两个 follow-up 先合，E 看到的是干净基线。

### E5 · §1 / §0 步 LOC 数字 back-of-envelope，Phase E #2 实测后修订（2026-05-10 更新）

审视报告 §第 0 步 + §1 给的 "Copilot 占 45.6% / Copilot ≈ 18k LOC / 评测核心 ≈ 9k LOC" 是 audit 当时 back-of-envelope 估算（仓库总 LOC 数对，但 Copilot/核心拆分比例及 evalyst 核心 LOC 是眼估）。Phase E #2 commit 3 实测：

| 区块 | excl 测试 | incl 测试 |
|---|---|---|
| 评测核心（src/ 除 src/copilot/ 子树）| ~18k | ~21k |
| Copilot 子树（src/copilot/lib + src/copilot/components）| ~10k | ~17k |
| Copilot api routes（src/app/api/copilot/）| ~0.5k | ~0.5k |

**结构性结论不变**——Copilot 仍是嵌入式独立域，11k LOC（excl 测试）足以独立成域，Phase E 物理切边后边界已画清。原 §1 数字保留作 audit 当时估算的历史快照，本 errata 给读者实测对照。

### E6 · plan / spec 路径在 Phase F 后变化（2026-05-10 更新）

§修复清单 #5 / §6 所有引用 `docs/superpowers/{plans,specs,findings}/<...>.md` 的路径在 Phase F (本 PR) 后已 `git mv` 到 `docs/superpowers/archive/2026-Q2/{plans,specs,findings}/<...>.md`。本审视报告主体保留原路径作为 audit-time 快照（path drift 是 doc 整合的预期结果，不重写报告主体）；当前可定位的索引见 [`docs/superpowers/plans/_index.md`](../superpowers/plans/_index.md)。


---

## 一句话结论

**领域核心干净、Copilot 是另一个产品级模块寄生在主项目里、对外暴露面有 RCE 级 blocker**。Tier 1 不修就别给任何人 docker compose URL。修完之后这是一个值得长期投入的开源工具——但需要先把"评测平台"和"Copilot 助手"两条产品线的边界画清楚，否则两年后会因为重力相互拖死。
