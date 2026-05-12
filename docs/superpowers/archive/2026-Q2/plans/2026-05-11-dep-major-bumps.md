# Dep Major Bumps Plan

> Trigger: v0.14.4 收尾 + r3 backlog 全 8 项闭环后的"维护层 Tier B"批
> Baseline: v0.14.4 (`49d2f07`, 实际 promote 后 main HEAD)
> Target: v0.14.5（3 PR 全 ship）or v0.14.5 partial（PR-3 defer 时）
> 工作量: ~1.5 人天（每 PR 0.5 人天上下）
> Source: code-review-round-3.md §"还要完善什么 · Tier B" + 用户对话确认 timing

## Background

R3 audit 收尾时列出的"维护层"事——npm outdated 6 项里 3 个 major bump 已经积累几个月：

```
typescript    5.9.3   →  6.0.3   (major)
eslint        9.39.4  → 10.3.0   (major)
@types/node  20.19.40 → 25.6.2   (major)
```

不紧迫但累积——半年不动 OK，一年不动会变成"3 个 major 一起升"的痛苦升级。
当前 v0.14.4 五件套全绿、testing 网最厚、codebase 记忆新鲜，**是 timing 最好的窗口**。

直接放 audit 之外的原因：

1. peer dep 验证过：`eslint-config-next@16.2.6` 的 peer dep 是 `eslint >=9.0.0` + `typescript >=3.3.1`——两边都开放上限，no peer dep wall
2. 项目用 raw fetch（非 OpenAI / Anthropic SDK），dep major bump 影响域窄于一般 Next.js 项目
3. R3 0 finding 已确认；不是为了再"找事做"——是真 maintenance backlog 推进

## 分类裁决

| PR | 风险 | 估时 | branch |
|---|---|---|---|
| PR-1 `@types/node 20 → 25` | 低（type-only） | 15-30 min | `chore/dep-types-node-25` |
| PR-2 `typescript 5.9 → 6.0` | 中（可能触发新 strict 检查） | 0.5 人天 | `chore/dep-typescript-6` |
| PR-3 `eslint 9 → 10` | 中-高（rule changes / plugin compat） | 0.5 人天 | `chore/dep-eslint-10` |

## Phase 顺序 + rationale

```
PR-1  @types/node 20 → 25           ────────  最先（type-only，最低风险，最快验证）
PR-2  typescript 5.9 → 6.0          ────────  其次（动类型系统底）
PR-3  eslint 9 → 10                 ────────  最后（动规则层；可 defer）
```

**为什么这个顺序**：

- **PR-1 必须最先**——type-only bump，跑五件套即可验证；任何 tsc 抛错都是 `@types/node` 单变量产出。如果它都炸，停手 + 全部 defer
- **PR-2 早于 PR-3**——typescript 升级动的是类型系统底，eslint 升级是规则层。两边同时动会让 lint 抛错难判定是 "ts 6 inference 变" 还是 "eslint 10 新规则"
- **PR-3 最后 + 可 defer**——eslint 10 + eslint-config-next 16.2.6 peer dep 写 `>=9.0.0` 但**未实测**。如果 plugin 抛 incompatibility，立即退 + defer，等 `eslint-config-next` 18 / Next.js 17 时一起升

跨 PR 严格按顺序；每个 PR 独立 review + merge；任意 PR 失败时后续 PR 自动 defer。

---

## PR-1：chore/dep-types-node-25

### 当前状态

- `package.json` devDependencies: `"@types/node": "^20.19.40"`
- 实际 install: 20.19.40（npm outdated 显示 latest 25.6.2）
- `Dockerfile` 实际 runtime: Node 20 LTS
- 项目 src/ 全部 Node API 用法都是 Node 18+ 已 stable 的（`fs` / `path` / `process` / `Buffer`）

### 目标

1. `npm install --save-dev @types/node@^25.6.2`
2. 五件套全绿
3. PR ship

### 已知不确定性 + fallback

| 不确定 | 预设动作 |
|---|---|
| **tsc 抛新 strict 错** | 大概率是 narrower types catching pre-existing weak code（如 `Buffer` deprecation、`process.argv` 元组化）。**修代码不退版本**。如果单文件 ≥ 5 处要改 → 停手报告，可能是 type 设计大变 |
| **类型新增暗示用 Node 24+ API** | runtime 不会真挂（@types 只描述不实现），但要避免**为新 type 顺手 refactor** 引入 Node 20 实际不支持的调用。**守纪：本 PR 0 行业务代码 refactor**，仅修被动 tsc 报错 |
| **`@types/node` 25 移除老 deprecated type** | 大概率不会（这种通常 minor 警告 / major 移除较少），但若发生 → 每处单独评估 |

### 验收

- 五件套：`npx tsc --noEmit && npm test && npm run lint && npm run build && npm exec knip`
- e2e：`npm run test:e2e` 全绿（46/46）
- `git diff` 限于 `package.json` + `package-lock.json` + 被动响应 tsc 错的最小 src 修改（≤ 5 个文件 / ≤ 20 行）

### 受影响文件

- `package.json`（@types/node 版本）
- `package-lock.json`（resolved + integrity）
- 可能：`src/**` 个别文件（被动响应 tsc 错）

### Branch / commit

- branch: `chore/dep-types-node-25`
- 单 commit（如有 src 修改则 2 commit）：
  ```
  chore(deps): bump @types/node 20 → 25

  type-only major bump. Dockerfile runtime 仍 Node 20。
  Co-Authored-By: ...
  ```
- 如有 src 修改：
  ```
  fix(types): adapt to @types/node 25 narrower types

  - <file>:<line> <description>
  ```

### 优先级

low——独立 PR 仅为干净 atomic rollback。不 ship 也不阻塞 PR-2 / PR-3。

---

## PR-2：chore/dep-typescript-6

### 当前状态

- `package.json` devDependencies: `"typescript": "^5.9.3"`
- 实际 install: 5.9.3
- `tsconfig.json` 三严格全开：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitReturns`
- 当前 `as unknown as` 8 处（R3 baseline 数字）；`as any` 0 处；`@ts-ignore` 0 处

### 目标

1. `npm install --save-dev typescript@^6.0.3`
2. 跑 `npx tsc --noEmit`，按 decision tree 处理新错
3. 五件套全绿
4. PR ship

### 升级前必读

**5 分钟**扫一眼 [TypeScript 6.0 release notes](https://devblogs.microsoft.com/typescript/) 的 "Breaking Changes" 段，预知会撞哪些点。常见 TypeScript major bump breakage 类型：

- `lib.dom.d.ts` 形态变（DOM API 类型紧）
- 默认 `target` / `module` 提升（如果用 `tsconfig` 默认）——本项目显式声明，应不受影响
- 新增 strictness 检查（如 `useDefineForClassFields` 默认变）
- 移除 deprecated 编译选项

预读笔记不入 PR；仅形成升级期心智模型。

### 已知不确定性 + decision tree

`tsc --noEmit` 新错抛出时按这个决策树处理：

```
 新 tsc 错
 ├─ 是真 unsafe？           → 修代码（narrow type / type-guard / 业务逻辑修正）
 ├─ 是 grey-zone（之前 ts 5 漏抓的）？  → 优先 narrow / type-guard，最后才 cast
 ├─ 是 ts 6 inference 风格大变？      → 单 case 修；同 pattern ≥ 5 处 → 停手报告
 └─ 是 dep 类型不兼容（如 @base-ui / next）？  → 看 dep 是否有 ts 6 兼容版本
```

| 信号 | 预设动作 |
|---|---|
| **`as unknown as` baseline 8 处不变** | 理想态——证明项目类型健康 |
| **`as unknown as` 新增 ≤ 2 处** | 可接受，每处 commit body 写明理由 |
| **`as unknown as` 新增 ≥ 3 处** | 红旗——停手报告。可能是 ts 6 推出新 strict 检查，需要用户判断是修代码还是 cast |
| **单文件需要改 ≥ 5 处** | 停手报告——可能是 inference 风格大变，需要 codemod 而非手工修 |
| **`tsconfig.json` 需要新增 / 调整 compiler options 才能编译** | 视为 plan-外。**先报告再决定**：是接受新选项 / 关闭某 strict / 等 ts 6.x patch |
| **dep（@base-ui / next / @playwright/test）类型不兼容 ts 6** | 立即退版本 + defer。dep 升级周期窗口 |

### 验收

- 五件套全绿
- e2e 全绿（46/46）
- `as unknown as` 计数 ≤ 10（baseline 8 + 允许 ≤ 2 增量）
- `as any` 仍 0、`@ts-ignore` 仍 0
- `tsconfig.json` 不动；如必须动，停手报告

### 受影响文件

- `package.json` + `package-lock.json`
- `src/**` 被动响应 tsc 错的最小修改（应 ≤ 10 个文件）
- 不动 `tsconfig.json`（守纪）

### Branch / commit

- branch: `chore/dep-typescript-6`
- 至少 2 commit：
  ```
  chore(deps): bump typescript 5.9 → 6.0

  Co-Authored-By: ...
  ```
  ```
  fix(types): adapt to typescript 6 strict inference

  - <file>:<line> 修法 + 一句 why
  ...
  ```

### 优先级

medium——本批最大风险项，**值得仔细做**。如果决策树触发"停手报告"，立即给用户决策点。

---

## PR-3：chore/dep-eslint-10

### 当前状态

- `package.json` devDependencies: `"eslint": "^9.39.4"`, `"eslint-config-next": "16.2.6"` (pinned)
- `eslint-config-next@16.2.6` peer dep: `eslint >=9.0.0`（peer dep 形式开放，**实测兼容性未验证**）
- 当前 `npm run lint` 输出: clean
- ESLint 配置：使用 flat config（默认），通过 `eslint-config-next` 间接拉 typescript-eslint / next plugins

### 目标

1. `npm install --save-dev eslint@^10.3.0`
2. 跑 `npm run lint`，按 decision tree 处理
3. 五件套全绿
4. PR ship 或 defer + 决策记录

### 升级前必读

**5 分钟**扫 [ESLint 10.0 migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0)，预知 breaking changes：

- Deprecated rules retirement（哪些旧 rule 退役）
- Flat config 收紧
- Plugin API 变化（这个最关键——如果 `eslint-plugin-react` / `typescript-eslint` 没跟进 eslint 10 plugin API，会直接抛 incompatibility）

### 已知不确定性 + 三档 decision tree

```
 npm install 后第一次跑 lint
 ├─ 立即抛 plugin/config incompatibility       → 退 + defer（参 fallback A）
 ├─ 抛新 rule warning/error，可控数量          → 修 / disable 评估（参 decision table）
 └─ 全绿                                       → 直接 ship
```

#### Fallback A · 立即退 + defer

任何下列情况触发 → 当 PR-3 立即 abort：

- `eslint-plugin-react` / `eslint-plugin-jsx-a11y` / `typescript-eslint` 抛 "incompatible with eslint 10"
- `eslint-config-next` 自身抛 plugin API 不兼容
- npm install 完后 `npm run lint` 直接 crash（不抛 warning，是 throw）

退步骤：
```bash
git restore package.json package-lock.json
npm install   # 恢复 baseline lockfile
```

写决策记录到 `docs/superpowers/plans/2026-05-11-dep-major-bumps.md` 末尾的"PR-3 outcome 记录"段（本 plan 自身）：
> defer 原因 + 触发的具体 incompatibility + retry 条件（如 "等 eslint-config-next 18 出 + Next.js 17 ship"）。

#### Decision table（lint 报错可控时）

| 信号 | 预设动作 |
|---|---|
| 新规则触发 **≤ 5 处** lint error/warning | 修代码——成本低 |
| 新规则触发 **6-20 处** | 看个例 case-by-case：(a) 改善代码质量的规则 → 修；(b) 风格偏好的规则 → disable + 决策理由 |
| 新规则触发 **> 20 处** | 红旗——大概率是新 default rule 不适合本项目。disable 该规则 + 写较长决策理由 |
| 旧 deprecated rule 不再可用 | 移除 rule config，commit body 注明 |

#### 守纪

- **不引入新 rule**——本 PR scope 严格限于"升级到 eslint 10"，不含"顺便加 X 规则"
- **不重写 flat config 结构**——除非 eslint 10 强制要求
- **不动 `eslint-config-next` 版本**——本 PR 一次 dep bump，避免变量混淆

### 验收

- 五件套全绿（PR ship 路径）OR 决策记录写到位 + revert 干净（defer 路径）
- e2e 全绿（46/46）（PR ship 路径）
- `eslint-config-next` 16.2.6 不动

### 受影响文件

- `package.json` + `package-lock.json`
- 可能：`eslint.config.{js,mjs}`（如果有 disable 操作）
- 可能：`src/**` 个别文件（如果选 "修代码" 处理 lint 错）

### Branch / commit

- branch: `chore/dep-eslint-10`
- ship 路径 commit：
  ```
  chore(deps): bump eslint 9 → 10

  - <new rule X disabled with reason>
  - <file Y line Z fixed for new rule>
  ...
  Co-Authored-By: ...
  ```
- defer 路径：不 push branch；本地 abort + 写决策记录到本 plan + commit 决策记录到 main（CHANGELOG 微调例外）

### 优先级

medium-high——**最不确定**。defer 是合法结果；但如果 ship 成功，本 batch 三 dep 全收。

---

## Tag 计划

3 个 PR 落地结果有 4 种可能，对应 4 个 tag 形态：

| PR-1 | PR-2 | PR-3 | tag | message |
|---|---|---|---|---|
| ✅ | ✅ | ✅ | `v0.14.5` | "v0.14.5 · dep major bumps · @types/node 25 + typescript 6 + eslint 10" |
| ✅ | ✅ | defer | `v0.14.5` | "v0.14.5 · dep major bumps (partial) · @types/node 25 + typescript 6 (eslint 10 deferred)" |
| ✅ | defer | n/a | `v0.14.5` | "v0.14.5 · dep major bump · @types/node 25 (typescript 6 + eslint 10 deferred)" |
| defer | n/a | n/a | **不打 tag** | 不形成 milestone |

Tag 时机（per AGENTS.md §4 "merge 后观察一两天稳定再打"）：

```bash
git checkout main && git pull
MERGE_SHA=$(git log --merges --oneline -1 | awk '{print $1}')   # 最后 merge 的 PR
git tag -a v0.14.5 -m "<按上表 message>" $MERGE_SHA
git push origin v0.14.5
HTTPS_PROXY=127.0.0.1:7890 gh release create v0.14.5 --title "v0.14.5" --notes-file /tmp/notes-v0.14.5.md
```

观察期 1-2 天的具体观察点：

- 本机 `npm run dev` 起来无 warning
- 本机 e2e 仍 stable（重要：typescript 6 / eslint 10 跨版本可能让 vitest / playwright 出诡异 type 错——这种通常 patch release 修，但要看到才放心）
- CI 仍全绿

---

## CHANGELOG 草稿

往 `[Unreleased]` 段加（按实际 ship PR 调整）：

```markdown
### Changed

- **`@types/node` major bump 20 → 25**（PR-1）：type-only 升级，runtime 仍 Node 20 LTS。<如有 src 修改 列出 file:line>
- **`typescript` major bump 5.9 → 6.0**（PR-2）：<如有 strict 修改简述 + as unknown as baseline 不变 / 新增 N 处的理由>
- **`eslint` major bump 9 → 10**（PR-3）：<如有 disable rule 简述 + 修改 count>
  ▶ 或 PR-3 defer 时改写: **`eslint 10` 升级 deferred**——`eslint-config-next 16.2.6` 实际 plugin API 不兼容（<具体 plugin>）。等 `eslint-config-next 18` / Next.js 17 ship 后一起升。决策记录见 `docs/superpowers/plans/2026-05-11-dep-major-bumps.md`。
```

tag 时 promote 到 `[0.14.5] — YYYY-MM-DD · dep major bumps`。

---

## Plan deviation 守则

per AGENTS.md §5：

合理偏离（不需 plan deviation 段）：

- (a) tsc / lint 抛新错 → 按本 plan 各 PR 的 decision tree 处理（已是 plan 自身的契约）
- (b) `package-lock.json` 自动 cascade（peer dep 解析变化、其他 dep 的 indirect resolution 漂移）—— 不可避免，commit 进 PR 即可

不合理偏离（必须开 follow-up PR）：

- (a) 顺手清 unused（任何 src/ 删除 ≥ 1 行的非"被动响应 tsc/lint 错"修改）
- (b) 引入新 lint config（"既然在升 eslint 顺手加 X 规则"）
- (c) 改 `tsconfig.json` 任何 compiler option（除非 ts 6 强制要求；这种 case **必须**先停手报告而非自决）
- (d) Dockerfile / docker-compose.yml 改动
- (e) i18n 改动（type 收紧导致 i18n 类型抛错时仍属 plan-外，因为 i18n 是 src/ 之外的契约层）

---

## 工作流约定

- 严格按 PR-1 → PR-2 → PR-3 顺序，每个独立 merge 之后再开下一个
- 每个 PR description 4 段（改了什么 / 为什么 / 怎么验证 / 向后兼容风险）
- 每个 PR description 引用本 plan 对应 §
- PR-3 defer 路径：不 push branch；写决策到本 plan 末尾"PR-3 outcome 记录"段 + 直接 push main（CHANGELOG 微调例外，AGENTS.md §2）
- 不要自合 PR；review 完等用户决定 merge
- 本 plan 完成后归档到 `docs/superpowers/archive/2026-Q2/plans/`

## PR-3 outcome 记录

> 此段在 PR-3 完成时填——ship 路径填"shipped"+ 简短摘要；defer 路径填触发 plan A 的具体 incompatibility + retry 条件。

**outcome**: defer（fallback A 命中）—— 2026-05-12

### 触发原因

`npm install --save-dev eslint@^10.3.0` 后第一次 `npm run lint` 抛：

```
ESLint: 10.3.0
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
    at resolveBasedir (eslint-config-next/node_modules/eslint-plugin-react/lib/util/version.js:31:100)
    at detectReactVersion (.../version.js:85:19)
    at getReactVersionFromContext (.../version.js:116:25)
    ...
```

### 根因

`eslint-config-next 16.2.6` transitively 拉 `eslint-plugin-react ^7.37.0`、`eslint-plugin-jsx-a11y ^6.10.0`、`eslint-plugin-import ^2.32.0`——三个 plugin 的 peer dep 都声明 `eslint @^...^9`（不含 `^10`）。`npm install` 仅 ERESOLVE override warn 不 throw（peer dep 写得开放），但 runtime 一跑 lint 立即挂——`eslint-plugin-react` 调用了 ESLint 9 时代 `context.getFilename()` API，ESLint 10 改了 context 形态（`contextOrFilename` 不再有 `getFilename` 方法）。

完全契合 plan §PR-3 fallback A 第一条触发条件："`eslint-plugin-react` / `eslint-plugin-jsx-a11y` / `typescript-eslint` 抛 incompatible with eslint 10"。

### 退步骤已执行

```bash
git restore package.json package-lock.json
npm install   # 恢复 baseline (eslint 9.39.4)
npm run lint  # 复绿确认
```

local branch `chore/dep-eslint-10` 已删，未 push。

### Retry 条件

等以下任一条件满足后再开 retry PR：

1. **`eslint-config-next 18+` ship**——Next.js 17 大概率会一并升 transitive plugin 到 eslint 10 兼容版本（`eslint-plugin-react` v8+ 已支持 eslint 10 plugin context API；`eslint-config-next` 自身需要把 transitive dep 上限放开到 ^8）
2. **手工 override transitive plugin 版本**——理论可行（`overrides` 字段强升 `eslint-plugin-react` 到 v8）但本质是 patch `eslint-config-next` 内部 dep 树，引入维护成本。**不推荐**——属于 plan §PR-3 "不动 eslint-config-next 版本" 守纪的边界

retry 时顺带评估升级 `eslint-config-next` 自身（同一 PR 一起升或拆 PR）。

### v0.14.5 tag 计划

按 plan §Tag 计划行 3："PR-1 ✅ + PR-2 ✅ + PR-3 defer" → tag `v0.14.5` partial，message 写明 eslint 10 deferred + 引用本 outcome 记录。

待执行后回填。
