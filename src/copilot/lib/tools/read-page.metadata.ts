import type { ToolMetadataDescriptor } from "./types"

export interface ReadPageInput {
  query: string
}

export const readPageMetadata: ToolMetadataDescriptor = {
  name: "read_page",
  description:
    "Search the current page for nodes matching a natural-language query. Returns the top 5 matching data nodes with their full structured content. Use this when the user asks about something visible on their page but you don't have the detail in context yet.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "自然语言搜索词，例如 'status 为 failed 的 task' / '第三条结果的输出' / 'experiment exp_123 的失败样本'",
      },
    },
  },
  metadata: {
    isReadOnly: true,
    isDestructive: false,
    maxResultSizeChars: 3000,
  },
}
