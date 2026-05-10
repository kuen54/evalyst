# Glass UI 系统（6 primitive + 3 semantic）

Copilot 打开时主内容区统一切换到"玻璃梯度"视觉语言（关闭时恢复 shadcn 扁平）。设计参考 Apple HIG Materials + Liquid Glass + MD3 elevation。

> 本 doc 解释 Copilot 打开态下的 9 档玻璃约定（6 primitive + 3 semantic）+ tinted 名额规则 + 轻量 alpha 配方 + 可访问性降级。Copilot 子系统的工具协议 / 交互见 [`../copilot.md`](../copilot.md)；项目整体架构见 [`../architecture.md`](../architecture.md)。Spec 全文：`docs/superpowers/archive/2026-Q2/specs/2026-04-28-copilot-glass-system-design.md`。

## 目录

- 9 档梯度（6 primitive + 3 semantic）
- `--copilot-accent` 而非 `--primary`
- Segmented 选中态
- 玻璃作用域（**重要**——sidebar / panel 不玻璃）
- JSX display 兼容
- 可访问性
- 主 CTA 约定（一页一个 tinted 名额）
- 轻量 tinted 表面（alpha 配方）

> _Section 内容由 commit 4 从 CLAUDE.md 迁入_
