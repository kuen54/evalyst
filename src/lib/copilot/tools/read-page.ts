import { getSnapshot } from "../snapshot-cache"
import { resolveContexts } from "../resolve-context"
import type { CopilotContextRef } from "../types"
import type { ToolDescriptor } from "./types"

interface Input {
  query: string
}

export const readPageTool: ToolDescriptor<Input, unknown> = {
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
  call: async (input, ctx) => {
    const snapshot = getSnapshot(ctx.session_id)
    if (!snapshot) {
      return { matches: [], total_scanned: 0, message: "当前没有页面快照可用" }
    }
    const query = String(input.query ?? "").toLowerCase().trim()
    let tokens = query.split(/\s+/).filter((t) => t.length >= 2)
    // 若全是短词（1 字符英文 / 未分词 CJK），退回整句当单 token，避免静默 0 匹配
    if (tokens.length === 0 && query.length > 0) {
      tokens = [query]
    }
    const scored = snapshot.viewport_index
      .map((entry) => {
        const haystack =
          `${entry.type} ${entry.preview_text} ${(entry.ancestors ?? []).join(" ")}`.toLowerCase()
        let score = 0
        for (const t of tokens) if (haystack.includes(t)) score += 1
        return { entry, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    if (scored.length === 0) {
      return {
        matches: [],
        total_scanned: snapshot.viewport_index.length,
        message: `未在当前页面找到匹配 "${input.query}" 的内容`,
      }
    }
    const refs: CopilotContextRef[] = scored.map((x, i) => {
      const [type, ...rest] = x.entry.key.split(":")
      const id = rest.join(":")
      return { tag: i + 1, type: type!, id }
    })
    try {
      // resolveContexts(refs).data 走 manifest 形态（v2.5 Task 2 后），等同于 spec §3.6 的
      // resolveContextsAsManifest(refs, 'self')。read_page 不再 dump 全量 TaskSchema / ExperimentConfig，
      // 避免泄漏 input_preview / default_prompt / JSX 源码到 LLM 上下文。
      const resolved = resolveContexts(refs)
      return {
        matches: scored.map((x, i) => {
          const hit = resolved[i]
          return {
            key: x.entry.key,
            type: x.entry.type,
            content_tree: hit?.data ?? null,
          }
        }),
        total_scanned: snapshot.viewport_index.length,
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      return {
        matches: scored.map((x) => ({ key: x.entry.key, type: x.entry.type, content_tree: null })),
        total_scanned: snapshot.viewport_index.length,
        message: `匹配到 ${scored.length} 条，但详情读取失败: ${errMsg}`,
      }
    }
  },
}
