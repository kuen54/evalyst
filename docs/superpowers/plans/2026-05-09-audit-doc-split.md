# Audit Cleanup Phase F · 文档分裂 + 收敛 (#5)

> Master spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase F。本 plan 不另写 spec，按 §修复清单 #5 prescription 执行。

## 1. Goal

CLAUDE.md (42KB) / AGENTS.md (24KB) 历史膨胀；Glass UI / writeAtomic / i18n / FieldPicker / GlassSegmentedItem 等核心约定在两边各写一份。Phase E 已让代码层面 Copilot 边界画清（src/copilot/ 子树独立），docs 现同步把"项目级 / Copilot 级 / glass UI 约定 / 开发协议"分文件。终态：CLAUDE.md ≤ 8KB（索引 + 反直觉 3 强约束）+ AGENTS.md ≤ 5KB（开发流程 + AI 协议）+ 3 份外置 doc + plans 历史归档。

## 2. 当前现状（pre-flight 实测）

- size：README 22KB · CLAUDE 42KB · AGENTS 24KB · CONTRIBUTING 5KB · CHANGELOG 130KB（不动）
- CLAUDE 19 §：技术栈/四件套/LLM 列表/Display 推断/评测任务/结构化编辑器/详情编辑/数据集表单/评分/失败 retry/单测/E2E/Copilot/Glass UI/skill 集成/i18n/目录结构/运行/注意事项
- AGENTS 20 §：Next.js 版本/代码风格/文件存储/LLM 接口/Schema/加资源/评分/失败 retry/UI 原则/Display 推断/Seed/Meta-prompt/Template-form/Dataset-form/气泡/i18n/测试/Copilot Glass/开发流程
- 重复探针：`Glass UI` `writeAtomic` `i18n` `FieldPicker` `GlassSegmentedItem` `data-glass-variant` 6/6 命中 CLAUDE+AGENTS 双份
- README L18 说"工具调用闭环规划中"——v0.4.0 PR-3 已 ship
- `docs/superpowers/plans/` 18 文件、`specs/` 12 文件、`findings/` 1 dir
- `docs/conventions/` 已存在（react19-hydration.md），新增 glass-ui.md 不冲突

## 3. 目标结构

```
docs/
├── architecture.md              ← 项目架构 / 数据流 / 文件存储 / 四件套+Rubric / Display 推断 / Seed / 运行
├── copilot.md                   ← Copilot 子系统 (v2 工具协议 / context 抽取 / session-store / cache / stream)
├── conventions/
│   ├── react19-hydration.md     (已有，不动)
│   └── glass-ui.md              ← 9 档 + tinted 名额 + 轻量 alpha 配方 + a11y 降级
└── superpowers/
    ├── archive/2026-Q2/         ← 18 plans + 12 specs + findings/ 全挪此处
    └── _index.md                ← archive 索引（按 phase + 主题双维度）

CLAUDE.md ≤ 8KB                  ← 索引指向上面 + 内嵌反直觉 3 强约束（不只链接）
AGENTS.md ≤ 5KB                  ← 开发流程（branch / PR / commit / tag / CHANGELOG）+ AI 协议
README.md                        ← 删 L18 "规划中"
CHANGELOG.md / CONTRIBUTING.md   ← 不动
```

CLAUDE.md 内嵌 3 强约束（AI session 加载时不展开链接，必须见即懂）：
1. 激活色用 `var(--copilot-accent)` 不用 `var(--primary)`（项目 primary 是暗褐 oklch(0.25 0.015 55)，染色灰扁）
2. Sidebar + Copilot panel 永远 shadcn 扁平，**不**走玻璃
3. JSX display 外层主卡用 `helpers.glassStyle()` + `data-glass-variant` API（兼容 copilot 关态）

## 4. Commit 策略（9 commits，分支 `docs/audit-cleanup-doc-split`）

```
1. 创建外置 doc 骨架：docs/architecture.md + docs/copilot.md + docs/conventions/glass-ui.md（仅 H1 + TOC 占位）
2. CLAUDE.md "技术栈/四件套/LLM 列表/Display 推断/数据集/评测任务/评分/失败 retry/单测/E2E/skill 集成/i18n/目录结构/运行/注意事项" → architecture.md；CLAUDE 留链接锚
3. CLAUDE.md "Copilot（内嵌 AI 助手）" 整段（line 253-369）→ copilot.md；CLAUDE 留链接锚
4. CLAUDE.md "Copilot Glass UI 系统（6 primitive + 3 semantic）" 整段（line 371-473）→ conventions/glass-ui.md；CLAUDE 留链接锚
5. CLAUDE.md 重写顶部：项目一句话 + 索引（4 个外置 doc 链接）+ **内嵌反直觉 3 强约束全文**；尾段保留 "注意事项" pinpoint 列表；目标 ≤ 8KB
6. AGENTS.md 收敛：删与 CLAUDE / architecture.md / copilot.md / glass-ui.md 重复段；保 "开发流程（branch/PR/commit/tag/CHANGELOG）" + "AI 助手协议（auto memory / TDD / 不自合 PR）"；目标 ≤ 5KB
7. README.md L18 改 "工具调用闭环（代用户改模板 + 触发重跑）规划中。" → "工具调用闭环已 ship（v0.4.0 PR-3 起）"
8. mkdir docs/superpowers/archive/2026-Q2/ → git mv plans/* + specs/* + findings/* 进去；新建 plans/_index.md（按 Phase A-F 主题分类列旧 plan + 链接到 archive；本 plan 自身不归档，仍在 plans/ 根）；CHANGELOG `[Unreleased]` 加 `docs(audit): split CLAUDE.md/AGENTS.md, archive historical plans (#5)`
9. docs/code-review-2026-05-09.md §Errata 末尾 append E5（Phase E #2 实测 LOC 修订）
```

每 commit 后 `git grep` 验内部链接：`git grep -lF "CLAUDE.md#"` / `git grep -lF "docs/architecture"` 等不能 404。

## 5. 链接修复

外置后必扫：

```bash
git grep -E "src/(lib|components)/copilot/" -- docs/ CLAUDE.md AGENTS.md README.md   # 应只剩 audit doc 自身（历史快照）
git grep -E "(CLAUDE|AGENTS)\.md#" -- docs/ CLAUDE.md AGENTS.md                       # 改完段落后旧锚要更新
git grep -F "docs/superpowers/plans/" -- src/ docs/ CLAUDE.md AGENTS.md               # archive 后路径变了
```

跨 ref 用相对路径：CLAUDE.md 引外置 doc 写 `docs/architecture.md§"四件套+Rubric 架构"`；外置 doc 互引同上。

## 6. 验收

- `wc -c CLAUDE.md AGENTS.md` → CLAUDE ≤ 8KB / AGENTS ≤ 5KB
- `grep -E "(规划中|planned|TBD|coming soon)" README.md` 0 行（关于 Copilot）
- `ls docs/superpowers/plans/` 仅剩 `_index.md` + `2026-05-09-audit-doc-split.md`（本 plan）
- `ls docs/superpowers/specs/` 全空（迁入 archive/）
- `git grep -lF "9 档" -- docs/ CLAUDE.md AGENTS.md` → 1 处（在 glass-ui.md）；`writeAtomic` 同
- `npx tsc --noEmit && npm test && npm run lint && npm run build && npm run knip` 全绿
- `npm run dev` 启动 → dashboard / 详情页 / settings 各路由 no-error console（验证 doc 改动零运行时影响）

## 7. 风险

- **R1（高）AI session 失忆**：CLAUDE.md 切外置后下次 session 加载只能见索引 + 3 强约束。缓解：3 强约束**完整文字嵌入**（不只链接）；外置 doc 文件名/§ 标题命名直白（"Glass UI" "Copilot 子系统" "项目架构"），让 grep / Skill 工具能 1 跳定位。验证：合 PR 后起新 session 问"项目用什么 LLM 调用框架"——能引出 architecture.md 即过
- **R2（中）AGENTS / CLAUDE 重复 60% 删错半边**：先 commit 6 前 `diff <(grep -nE "^### " CLAUDE.md) <(grep -nE "^### " AGENTS.md)` 找重复段，决定保留版本——倾向保 CLAUDE 删 AGENTS（CLAUDE 是 AI session 入口）
- **R3（中）archive _index 查找成本**：按 Phase A-F + Copilot v1/v2/v25 / glass / theme / image 多维分类，不只时间倒序 dump
- **R4（低）外置 doc 命名冲突**：实测 docs/conventions/ 只有 react19-hydration.md，新建 glass-ui.md 不冲突；docs/ 顶层有 code-review-2026-05-09.md / copilot-v1-to-v25-retrospective.md / perf-report-2026-05-03.md，新建 architecture.md / copilot.md 不冲突
- **R5（低）CHANGELOG 不动**：明确不切；如发现"顺手切"冲动停下——audit Errata 已锁

## 8. 边界 / 禁区

- 不动代码（src/ + e2e/ + scripts/）——纯 docs 重组
- 不动 CHANGELOG（已锁）；不动 audit master spec / 报告主体（仅 §Errata 末尾 append E5）
- 不动 .claude/skills/（agent 协议固化）
- 不引入新 doc 模板 / 新 frontmatter 格式（默认 Markdown 即可）
- 不顺手清代码 unused（Phase C/E 已搞定，本 phase 是 docs）
- 不自合 PR；CHANGELOG `[Unreleased]` 加条目供后续 tag 整合
- Plan 偏离按 master spec §"Plan-外 scope 偏离规则" 在 PR description `## Plan deviation` 段声明
