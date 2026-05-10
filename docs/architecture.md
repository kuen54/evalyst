# Evalyst 架构

通用 LLM prompt 批量评测平台的核心架构、数据流、文件存储约定。

> 本 doc 是项目级架构参考。Copilot 子系统见 [`copilot.md`](./copilot.md)；Glass UI 视觉规范见 [`conventions/glass-ui.md`](./conventions/glass-ui.md)。

## 目录

- 技术栈
- 四件套 + Rubric 架构
- LLM 模型列表
- Display 自动推断
- 评测任务创建（表单 + JSON 导入）
- 结构化编辑器
- 数据集表单（CSV/JSONL/JSON）
- 评分系统（Rubric + Annotation）
- 失败 task 单条 retry
- 单元测试（vitest）
- E2E smoke（Playwright）
- Claude Code skill 集成
- i18n（中英双语）
- 目录结构
- 运行
- 注意事项

> _Section 内容由 commit 2 从 CLAUDE.md 迁入_
