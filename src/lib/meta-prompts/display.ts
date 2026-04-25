// Meta-prompt 用于引导 agent 产出合规的展示模板 JSON
//
// 重要：一般不需要自己建 Display。评测任务只要声明了 display_dimensions，
// 系统就会自动从内置 5 种展示里挑最合适的（单列表/双分组/三维网格/bubble坐标/JSON兜底）。
// 只有在需要特别样式（自定义 JSX 组件）或精细配置（table/grouped_grid DSL）时才建。

export const DISPLAY_META_PROMPT = `# 任务
为 evalyst 创建一个「自定义展示模板」JSON。

> 先确认是否真的需要：如果评测任务已经声明了 \`display_dimensions\`，系统会自动推断出合适的内置 display（单列表 / 双分组 / 三维网格 / 气泡叠加 / JSON 兜底）——这覆盖 95% 的场景。
> 只有当你需要**完全自定义的视觉样式**（用 JSX 画一个独特组件）时才走这个流程。

# JSX 模式（最常用）

用一个箭头函数接受 \`{ result, schema, helpers }\`，返回 JSX。可用的 helpers：
- \`helpers.readField(result, "output.answer")\` — 按路径取值
- \`helpers.formatValue(v, maxLen)\` — 格式化值
- \`helpers.renderField(v, type, maxLen)\` — 按 type 渲染节点
- \`helpers.Badge\` — shadcn Badge 组件

\`\`\`json
{
  "id": "compact_answer_card",
  "name": "Compact answer card",
  "description": "单卡片展示一条 QA result",
  "mode": "jsx",
  "jsx": {
    "source": "({ result, helpers }) => React.createElement('div', { className: 'p-2 border rounded' }, React.createElement(helpers.Badge, { variant: 'secondary', className: 'text-xs mb-1' }, 'confidence ' + helpers.readField(result, 'output.confidence')), React.createElement('p', { className: 'text-xs' }, helpers.readField(result, 'output.answer')))"
  }
}
\`\`\`

约束：
- JSX 源码是一个完整函数表达式
- 不支持 import / require / fetch / localStorage
- 只能用传入的 React / helpers
- 最安全写法：\`React.createElement(...)\`；也可直接写 JSX（平台用 Babel 编译）

# table / grouped_grid 模式（较少用）

见旧版 display.meta-prompt 备份；也可直接用评测任务的 display_dimensions 让系统自动推断。

# 字段路径语法

- \`input_refs.qa\` → \`result.input_refs.qa\`
- \`input_preview.qa.question\` → \`result.input_preview["qa.question"]\`
- \`output.answer\` → \`result.output.answer\`

# 约束
- \`id\` 只含小写字母、数字、下划线
- \`mode\` 必须是 \`table\` / \`grouped_grid\` / \`jsx\` 之一

# 我的需求
[描述你的展示需求。如果只是按某些字段分组展示，强烈建议不建 display，而是在评测任务里声明 display_dimensions 让系统自动推断。]
`
