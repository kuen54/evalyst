# Plan · Phase E · #2 Copilot 物理切边

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase E #2
> **execution gate**：必须等 Phase D **PR-1**（`refactor/tsconfig-strict`）合 main 才开工——D 的 line-level strict fix 与本 PR rename 撞，git rename detection 失效、review 看不动。**PR-2**（eopt）视 R7：若 PR-2 走 R7 延后到 Next 17 升级，本 PR 仅依赖 PR-1；若 PR-2 按节奏合，则 PR-2 也需先于本 PR 合 main。
> Branch: `refactor/copilot-boundary` · 估 2d

## 1. 当前文件清单（plan-write 时刻：2026-05-10）

| 子树 | 文件数 | 备注 |
|---|---|---|
| `src/lib/copilot/**` | 91 | 含 `tools/` + `__tests__/` |
| `src/components/copilot/**` | 25 | 含 panel / chat-view / glass-* |
| `src/app/api/copilot/**` | 7 | **不搬**（见 §2 例外） |
| 引用 `@/lib/copilot/...` 或 `@/components/copilot/...` 的文件 | 81 | 跨 src/ + e2e/ + docs/ + CLAUDE.md |

跨子树深相对 import (`../../lib/...` 等) **0 处**——本 PR 的 git mv 只破坏 alias 引用，不破坏相对路径。

## 2. 目标结构 + Next.js api 例外

```
src/copilot/
├── lib/        ← 原 src/lib/copilot/      （91 文件）
├── components/ ← 原 src/components/copilot/（25 文件）
└── (api 不搬)
```

**例外**：`src/app/api/copilot/` 必须**留原位置**——Next.js App Router 强制 api routes 在 `src/app/api/<route>/route.ts` 下，搬走立刻 routing fail。本 PR 只改 api routes 内部的 import path（`@/lib/copilot/...` → `@/copilot/lib/...`）。

**实施护栏**：commit 1 `git mv` 跑前 dry-run `git status` 确认 `src/app/api/copilot/` 仍在；commit 1 跑后再确认一次（手滑则立刻撤回）。

## 3. tsconfig + test runner 配置

`tsconfig.json` paths 加 `"@/copilot/*": ["./src/copilot/*"]`（`@/*` 已能解，加显式条目是**符号意义**——把"独立子域"写进类型系统）。`vitest.config.ts` alias `@: src` 走前缀自动解析、`playwright.config.ts` 不用 alias，**两者都不改**。本 PR 只改 `tsconfig.json` 一处。

## 4. Commit 策略（3 commit 拆分）

**commit 1: pure git mv（不改任何文件 content）**
```bash
git mv src/lib/copilot src/copilot/lib
git mv src/components/copilot src/copilot/components
git status   # 确认 src/app/api/copilot/ 仍在原位
git commit -m "refactor(copilot): rename only — types broken until next commit (#2)"
```
此 commit 后 `tsc / test / build` **全爆，预期**——commit message 标明。`git log --stat -1` 应主要是 R(ename) 行。

**commit 2: import path rewrite + tsconfig paths**
- 全 `src/` + `e2e/` 扫 `@/lib/copilot/` → `@/copilot/lib/`
- 全 `src/` + `e2e/` 扫 `@/components/copilot/` → `@/copilot/components/`
- `src/app/api/copilot/**/route.ts` 内部 import 也走这条
- `tsconfig.json` paths 加 `@/copilot/*`
- 此 commit 后 `tsc / test / build` 应**全绿**

```bash
git commit -m "refactor(copilot): rewrite imports to @/copilot/* + tsconfig paths (#2)"
```

**commit 3: README + AGENTS + CLAUDE.md 顶部声明 + spec/plan 命名整理**
- README + AGENTS.md 顶部加："评测核心 ≈ 9k LOC，Copilot 助手 ≈ 18k LOC，可独立理解"段（一段话，不是新 section）
- CLAUDE.md `@/components/copilot/shell` 字面量（line :398）改 `@/copilot/components/shell`（grep 出剩余字面量一并改）
- `docs/superpowers/specs/` + `plans/` 中纯 Copilot 文件确认 prefix `copilot-`（多数已有，扫一遍补缺）
- 领域核心相关如 `2026-04-30-theme-cascade-design.md` 不挪（§7 禁区）

```bash
git commit -m "docs(copilot): declare boundary in README/AGENTS, fix stale import paths (#2)"
```

## 5. Cross-cutting（commit 2 内确认；plan-write 时已验过）

- `--copilot-accent` (globals.css) / `i18n copilot.*` namespace / `data/copilot/` 运行时路径——**全不挪**
- `<GlassCard>` / `useGlassStyle` 仍从 `@/copilot/components/shell` import；JSX display helpers 签名不变
- `src/lib/types.ts` 不再 re-export Copilot type（Phase C Tier 3 已清完）——本 PR **只验证不动**。execution 启动前跑 `grep -nE "from ['\"].*copilot|export.*from ['\"].*copilot" src/lib/types.ts` 应返 0 行；非 0 则 plan 假设破，停下问用户
- CLAUDE.md / AGENTS.md / MEMORY.md 字面量同步改（CLAUDE.md :398 已知 1 处；AGENTS / MEMORY 当前 0 处）
- 测试 mock factory 字符串：grep `vi\.mock\(['"]@/(lib|components)/copilot` 一并扫——**不只改 import 语句**

## 6. 验收

- `npx tsc --noEmit && npm test && npm run build` 全绿（commit 2 起）
- `npm run test:e2e` smoke + copilot-v2 + copilot-v25 全绿
- `git log --oneline -3` 三 commit 主题分明；`git log --stat -1 HEAD~2` 主要是 R(ename) 行
- `git grep -e "@/lib/copilot/" -e "@/components/copilot/" -- src/ e2e/ docs/ CLAUDE.md AGENTS.md MEMORY.md` 返 0 行
- README + AGENTS 顶部有"9k vs 18k LOC"声明段；`src/app/api/copilot/` 仍在原位
- CHANGELOG `[Unreleased]` 加 `refactor(copilot): physical boundary split (#2)`

## 7. 风险

- **R1（高）· cross-phase 锁**：Phase D PR-1 / PR-2（除非 PR-2 走 R7 延后）必须先于本 PR 合 main——否则 D line-level diff + 本 PR rename 撞，rename detect 失效，reviewer 看到 "91 deleted + 91 added"。**gate** 已写文件顶部
- **R2（高）· api routes 误搬**：手滑 `git mv src/app/api/copilot ...` 立刻 Next routing 404。commit 1 跑前 + 跑后 dry-run `git status` 确认 `src/app/api/copilot/` 还在
- **R3（中）· git rename detection 失败**：commit 1 不改 content 应稳；若某文件极小（纯 re-export 1 行）git 可能不识别——可接受，reviewer 自查 commit 1 整体 diff
- **R4（中）· 跨子树相对 import**：plan-write 时验证 0 处（§1）；execution 启动**重跑** grep（仓库可能变），若有跨边界相对 import，commit 2 一并改 alias

## 8. 边界 / 禁区

- 不动 Glass UI 视觉系统（spec §Non-Goals）；不引入新功能 / 新抽象——只动结构
- README + AGENTS 改动只做"声明边界"段，**不重写章节**（章节重写是 Phase F #5）
- 不挪 i18n / `--copilot-accent` / `data/copilot/` / `src/app/api/copilot/` / 领域核心 doc（如 `2026-04-30-theme-cascade-*.md`）
- **与 spec 偏离**：spec §Phase E #2 提到「领域核心相关挪 `docs/specs/`」——本 PR **推迟到 Phase F #5**（doc 重组）。理由：与 #2 路径切换在同 PR 内打架，scope 也更聚焦；F 的 doc 拆分是更合适的 home
- 单文件 strict 修复属 D 范围，本 PR 不做
- 实施中发现改动涉及行为修改而非纯路径重组，**停下问用户**
- 不自合 PR；push 后等用户 review

## 9. Post-cleanup 重核（2026-05-09，main = 31f35f0）

v0.11.5 / v0.11.6 / knip / lint-fix / rules-of-hooks 全部合并后实测：

| 数字 | plan-write | 实测 | 备注 |
|---|---|---|---|
| `src/lib/copilot/**` | 91 | 91 | 不变 |
| `src/components/copilot/**` | 25 | 25 | 不变 |
| `src/app/api/copilot/**` | 7 | 7 | 不变 |
| alias-import 文件数 | 81 | **82** | +1（容差内） |
| 跨子树相对 import | 0 | 0 | 不变 |

cross-cutting 复核：

- **knip 配置文件名是 `knip.jsonc`**（plan §3/§5 未提，但配置内 zero copilot 路径——`ignore` 都是 `.claude/**` / `.next/**` / `data/**` / `docs/**` / `src/**/__tests__/**` / `src/components/ui/**`——本 PR 无需联动改 knip）
- **eslint.config.mjs**：zero copilot 路径；`globalIgnores` 都是构建产物 / `.claude/**` / `coverage/**`——本 PR 无需联动改
- **§6 grep 形式**：line 80 已用 `-e ... -e ...` 形式，无需再修
- **CLAUDE.md 字面量**：除 line :398（plan §4 commit 3 已点名）外，prose 路径还在 :259 / :278 / :307 / :336 / :406；AGENTS.md :169（`src/lib/copilot/tools/{name}.ts`）。commit 3 grep 一并改即可（plan 原文「grep 出剩余字面量一并改」已覆盖）。MEMORY.md 仓库根无此文件
- **`src/lib/types.ts`**：grep 0 行 copilot ref（Phase C Tier 3 + knip cleanup 后假设仍成立）
- **`vi.mock` copilot 字面量**：1 处 `src/lib/copilot/__tests__/build-llm-messages.image.test.ts:7`（plan §5 已点名）

**结论**：plan 主体仍正确，无需重写或大幅修订。execution 启动时按 §4 commit 1/2/3 顺序执行，commit 2 内 grep + 替换覆盖上面所列字面量即可。
