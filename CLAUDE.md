# evalyst

通用 LLM prompt 批量评测平台。资源（模型 / 数据集 / 评测任务 / 展示模板）都是 `data/` 下的文件，首次启动时从 `src/lib/seeds/` 种子示例过来。

> **项目架构 / 技术栈 / 数据流 / 资源管理 / 测试 / i18n / 目录结构 / skill 集成 / 注意事项** 见 [`docs/architecture.md`](docs/architecture.md)。

<!-- 评测核心架构内容已迁至 docs/architecture.md (commit 2)；Copilot 子系统已迁至 docs/copilot.md (commit 3)。Glass UI 章节由 commit 4 迁出，commit 5 重写顶部为索引 + 反直觉 3 强约束。 -->

> **Copilot 子系统**（v2 工具协议、关键文件、加新工具流程、context 抽取）见 [`docs/copilot.md`](docs/copilot.md)。
> **Glass UI 视觉系统**（9 档梯度 + tinted 名额 + 玻璃作用域 + 轻量 alpha 配方 + a11y 降级）见 [`docs/conventions/glass-ui.md`](docs/conventions/glass-ui.md)。

@AGENTS.md
