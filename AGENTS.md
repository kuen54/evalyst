# Agent / Dev Workflow

本仓库的开发协议：分支命名 / PR / commit / tag / CHANGELOG / Plan-外偏离 / AI 协议。

> 项目架构 / 资源 CRUD / i18n / 测试约定 → [`docs/architecture.md`](docs/architecture.md)。Copilot 工具协议 → [`docs/copilot.md`](docs/copilot.md)。Glass UI 视觉规则 → [`docs/conventions/glass-ui.md`](docs/conventions/glass-ui.md)。CLAUDE.md 反直觉 3 强约束 → [`CLAUDE.md`](CLAUDE.md)。

## 1. 分支命名

`feat/` 新特性 · `fix/` bug · `refactor/` 不改行为重构 · `tune/` 只改参数 · `docs/` 纯文档 · `archive/` 归档已放弃方案 · `test/` 仅测试 · `chore/` 配置/脚本

slug kebab-case + **语义化**（`theme-cascade-v2`），不写 `bugfix-1` 这种。

## 2. PR 流程

非 trivial 改动（>3 文件 或 改变行为）必走 feature branch + PR：

1. `git checkout -b <type>/<slug>`
2. 本地验证：`npx tsc --noEmit && npm test && npm run lint && npm run build`（UI 改动加 `npm run test:e2e`；本仓库还有 `npm run knip`）
3. `git push -u origin <type>/<slug>` → `gh pr create`
4. PR description 必含 4 段：**改了什么 / 为什么 / 怎么验证 / 向后兼容风险**
5. Merge：`gh pr merge <n> --merge`（不要 squash —— 保留 branch commits 让 tag-on-merge-commit 语义稳定）；merge 后 `git branch -D <branch>`

可直接 push main 的例外：typo / comment 清理 / CHANGELOG 微调。任何行为改动哪怕一行都走 PR。

## 3. Commit message

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: ...
```

- type: feat / fix / refactor / tune / docs / chore / test / perf / style / build / ci
- scope: 受影响主模块（copilot / theme / ui / settings / compare / i18n / schema），没有就省
- subject: 命令语气 / 小写开头 / < 70 字符
- body 解释**为什么**（diff 自己说做了什么）

## 4. Tag + CHANGELOG

**版本号是松散里程碑，不是 semver**——本项目无外部 consumer，tag 是稳定点 + release notes 锚点。

`vX.Y.Z`：X 重大架构（仍 0.*）/ Y 整块新能力 / Z 增量 / 调优 / hotfix。

何时打 tag：merge 后观察一两天稳定再打，或修 broken tag 的真 hotfix。**不要**每个 PR 都 tag、不要"以为做完了"瞬间 tag、不要 48h 内同特性 3 个 tag。Tag **永远放 merge commit 上**：

```bash
git checkout main && git pull
git tag -a v0.X.Y -m "v0.X.Y · <summary>" <merge-commit-sha>
git push origin v0.X.Y
HTTPS_PROXY=127.0.0.1:7890 gh release create v0.X.Y --title "..." --notes-file /tmp/notes.md
```

`HTTPS_PROXY` 走 ClashX（gh 不继承 git 代理）。Broken tag：`git tag -d v0.X.Y && git push origin :refs/tags/v0.X.Y` + CHANGELOG 加 `> Note` 标注（不重写历史）+ `gh release delete --cleanup-tag=false`。

**CHANGELOG**（[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)）：开发期间往 `[Unreleased]` 攒草稿；tag 时改为 `[X.Y.Z] — <date> · <summary>` + 顶部补新 `[Unreleased]`；同特性多轮 tune 合并到一个条目 `### Tuning`，不拆多版本。不当 commit log；不为每个 PR 写一条；`[Unreleased]` 攒了就消化别堆。

## 5. Standing rule · Plan-外 scope 偏离

PR 内任何**未在 master spec / 对应 plan 声明**的额外测试 / 文档 / 重构 / 文件改动，必须在 PR description 顶部 `## Plan deviation` 段显式声明并给出理由。Reviewer 默认拒绝隐式 scope 扩张。

合理偏离（指明命中哪条）：(a) 防已识别风险回归（如审视报告 §7/§15 blocker）/ (b) 量化 plan 声明却未具象化的契约（如 API shape）/ (c) 修复 plan 自身错漏（同时更新 plan/spec）。

不合理偏离（拆 follow-up PR）：(a) 顺手清 unused 代码 / (b) "多测点总好" / (c) 改公共 API 形态 / 引入新抽象 / 加新依赖。

## 6. AI 协议

AI assistant 身份工作时：

- 非 trivial 改动必走 branch + PR，**不**直接 push main
- 严禁**自合 PR**（review 通过也等用户决定）
- 严禁跳过 hooks / 签名（`--no-verify` / `--no-gpg-sign`），除非用户显式要求
- 严禁改 git config / force-push 到 main / `reset --hard` 公开历史
- 写代码前优先 plan（writing-plans）+ TDD；纯 refactor 也走 plan
- 大改前先 brainstorming 找方向；改完前 verification-before-completion 跑 5 件套
- plan 内可分配 task 给 subagent，但 review checkpoint 留给用户
- 文件注释默认**最少**：单行 max，只在 WHY 非 obvious 时写
- 标 pre-existing 测试 "已绿" 前必须 `--repeat-each` ≥ 5 stress-test。单跑 5/5 不能证明 stable——R2 follow-up `experiment-seed.spec.ts:106` 就栽在低频单跑误判（30 次 CI 全绿但本机 retries=0 + `--repeat-each=3` 下 ~8 % flake）。
- cleanup plan 写依赖升级 scope 时用 "patch + 兼容 minor"，**不**写 "patch-only"。npm `^x.y.z` resolution 在 minor 段也会动；"patch-only" 写死容易在 `npm install` 后偷偷漂到 minor。或者拆 PR：纯 patch 单 PR，跨 minor dep 升级单 PR。

## 7. 回顾 / 审计

合完大 PR 后、tag 前：

1. 实测一轮（UI 快乐路径 + 1-2 edge case）
2. 看 console：dev server 无 warning / error
3. 读自己 diff：dead code / stale 注释 / typo / doc drift
4. 发现问题开新 PR（`fix/` / `docs/`），别攒

系统审计：`tsc --noEmit && npm test && npm run lint && npm run build && npm run knip` 五件套 + Playwright 实测 + 读关键文件。
