# Contributing to evalyst

先感谢你愿意贡献 —— 这是个我个人用着写起来的工具，希望它也能对别人有用。

## 快速上手

```bash
git clone https://github.com/<you>/evalyst.git
cd evalyst
npm install
npm run dev
# http://localhost:3000
```

首次启动需要到 `/settings/llm` 配置至少一个模型（base_url / api_key / model）才能跑实验。

## 项目定位

evalyst 是**通用的 LLM prompt 批量评测平台**。seed 数据集 `qa_pairs` 和 seed 评测任务 `qa_answer_v1` 只是"让新用户 clone 下来能直接跑几条"的示例，不代表工具本身的用途。贡献代码时请保持代码、文档、示例对任何领域都适用；确实需要场景示例时，首选 "QA pair 评测 / 文本分类 / 摘要质量" 这类中性例子。

## 目录结构

```
src/
  app/                 Next.js App Router 页面 + API route
  components/          shadcn/ui 基础 + 业务组件
  lib/
    schema/            TaskSchema 类型 + transform + engine
    i18n/              中英双语（zh.ts + en.ts，键强制对齐）
    seeds/             首次启动 seed 内容
    batch-runner.ts    执行队列
    llm-client.ts      OpenAI/Anthropic 协议封装
    store.ts           实验 CRUD + 迁移层
data/                  运行时产出；.gitignore 的用户数据
```

详细架构在 `CLAUDE.md`，代码约定在 `AGENTS.md`，读一遍再动手。

## 代码约定

- **TypeScript 严格模式** + `npx tsc --noEmit` 必须过
- **函数式组件 + hooks**，不用 class（例外：`display-jsx.tsx` 的 ErrorBoundary）
- **shadcn/ui v4** 原语为主；不装新 UI 库
- **i18n 强制**：所有 UI 可见文案走 `useT()`，在 `src/lib/i18n/zh.ts` + `en.ts` 成对加 key；`en.ts` 的类型约束会阻止漏 key
- **文件存储**：写入统一走 `src/lib/fs-utils.ts` 的 `writeAtomic`（tmp + rename），不要 `fs.writeFileSync`
- **能不手写 JSON 就不手写**：新功能表单优先用结构化控件（见 `src/components/template-builder/*-editor.tsx`），JSON 粘贴只作为 AI agent 整份产出的兜底入口
- **迁移层只读不写**：`getLlmConfig()` / `migrateResultInMemory` 读老 shape 时 in-memory 合成新 shape，直到用户触发一次显式保存才落盘 —— 代码升级不偷偷改用户文件
- **写测试**：新的纯函数（transform op / 聚合 / 迁移 / 格式化）必须配套 `src/**/__tests__/*.test.ts`；改了迁移层（`store` / `llm-config`）必须更新对应 migrate test。UI / API route 暂不要求测
- **涉及 fs 的模块要惰性 cwd**：不要 `const PATH = path.join(process.cwd(), 'data')` 顶层常量，写成 `function dir() { return path.join(process.cwd(), 'data') }`—— 否则测试里 chdir 失效

## 提交流程

1. Fork + 新建分支（`feat/xxx` / `fix/xxx` / `refactor/xxx` / `tune/xxx` / `docs/xxx`）—— slug 用 kebab-case，语义化命名
2. 本地验证
   ```bash
   npx tsc --noEmit   # 类型必须过
   npm test           # 单测全绿（vitest）
   npm run test:e2e   # E2E smoke 全绿（playwright；首次需 `npx playwright install chromium`）
   npm run lint       # 最好没报错（CI 里 lint 目前 continue-on-error）
   npm run build      # 能 build
   ```
3. 手动过 UI 快乐路径 + 一两个边缘场景；改了数据 shape 确认老数据（`data/` 里的旧实验）打开不崩
4. commit 格式：`<type>(<scope>): <subject>`（types: `feat` / `fix` / `refactor` / `tune` / `docs` / `chore` / `test` / `perf` / `style` / `build` / `ci`；`tune` 专指"只改参数不改机制"）。详细规范见 `AGENTS.md` §Commit message 规范
5. 提 PR，description **必含 4 段**：
   - 改了什么
   - 为什么这样改（设计决策 / trade-off）
   - 怎么验证（步骤）
   - 有没有向后兼容风险（对现有 `data/` 的影响）
6. merge 策略走 **merge commit**（不用 squash），保留 branch commits 便于追溯

## 版本号 + Tag（仅 maintainer）

`vX.Y.Z` 是**松散里程碑**，不保证 semver——项目定位是个人评测工具，没有外部 API 稳定性承诺。Tag 由 maintainer 打在 PR 的 merge commit 上，表示"可回跳的稳定点"。

contributor 不需要管 tag，PR 合并后 maintainer 会在合适时机打。如果 PR 合并的是 hotfix（上一个 tag 指向 broken state），标注会写在下一个 CHANGELOG 条目里。

完整规范见 `AGENTS.md` §Tag + 版本号 / §CHANGELOG 规范。

## 我会优先 review 的

- 新的评测任务模板 / 展示模板（Display）贡献
- 对现有 transform / filter / display 的扩展
- 文档改进（README / CLAUDE.md / AGENTS.md）
- Bug 修复（请附 reproduction）

## 暂不接受

- 引入 ORM / 数据库依赖 —— 文件存储是明确设计选择
- 重写 i18n / 主题系统 —— 当前方案足够
- 强绑定某家 LLM 厂商 SDK —— llm-client 的 OpenAI / Anthropic 双协议抽象是底座
- AI 生成的 PR 但作者自己不理解 —— 请先看懂再提

## 有疑问

开 Issue 讨论方案，再写代码。大改动先 align 再动手，避免白做。
