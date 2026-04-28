import { listExperiments, getExperiment, readResults } from "@/lib/store"
import { startBatch } from "@/lib/batch-runner"
import { getSnapshot } from './snapshot-cache'
import { resolveContexts } from './resolve-context'
import type { CopilotContextRef } from './types'

export interface CopilotToolContext {
  sessionId: string
}

export interface CopilotTool {
  name: string
  description: string
  input_schema: {
    type: "object"
    required?: string[]
    properties: Record<string, unknown>
  }
  requiresConfirm: boolean
  run: (input: Record<string, unknown>, ctx: CopilotToolContext) => Promise<unknown>
}

export const tools: CopilotTool[] = [
  {
    name: "list_experiments",
    description: "列出平台上的实验，可按 status / schema_id 过滤。用于发现用户没圈选的相关实验。",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "running", "paused", "completed", "failed"] },
        schema_id: { type: "string", description: "按评测任务 ID 过滤" },
        limit: { type: "number", description: "最多返回多少条，上限 50" },
      },
    },
    requiresConfirm: false,
    run: async (input, _ctx) => {
      const all = listExperiments()
      let filtered = all
      if (input.status) filtered = filtered.filter(e => e.status === input.status)
      if (input.schema_id) filtered = filtered.filter(e => e.schema_id === input.schema_id)
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return {
        experiments: filtered.slice(0, limit).map(e => ({
          id: e.id,
          name: e.name,
          model: e.model,
          status: e.status,
          schema_id: e.schema_id,
          completed_tasks: e.run_stats?.completed_tasks ?? 0,
          total_tasks: e.run_stats?.total_tasks ?? 0,
          failed_tasks: e.run_stats?.failed_tasks ?? 0,
        })),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
      }
    },
  },
  {
    name: "read_experiment_results",
    description: "读取某个实验的 task 结果，可按 task_id 列表或 status 过滤。用于扫描失败样本或提取特定结果。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["success", "error", "parse_error"] },
        limit: { type: "number" },
      },
    },
    requiresConfirm: false,
    run: async (input, _ctx) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const all = readResults(String(input.experiment_id))
      let filtered = all
      if (Array.isArray(input.task_ids) && input.task_ids.length) {
        const set = new Set(input.task_ids as string[])
        filtered = filtered.filter(r => set.has(r.task_id))
      }
      if (input.status) filtered = filtered.filter(r => r.status === input.status)
      const limit = Math.min(Number(input.limit ?? 20), 50)
      return {
        results: filtered.slice(0, limit),
        total_matching: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
      }
    },
  },
  {
    name: "restart_experiment",
    description: "重新运行一个实验。可选：只跑指定的 task_ids 子集（用于修了 prompt 后只重跑失败的几条）。",
    input_schema: {
      type: "object",
      required: ["experiment_id"],
      properties: {
        experiment_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
      },
    },
    requiresConfirm: true,
    run: async (input, _ctx) => {
      if (!input.experiment_id) throw new Error("experiment_id is required")
      const expId = String(input.experiment_id)
      const exp = getExperiment(expId)
      if (!exp) throw new Error(`Experiment not found: ${expId}`)
      const taskIds = Array.isArray(input.task_ids) ? (input.task_ids as string[]) : undefined
      // ExperimentConfig has no concurrency field; default to 3 per run route convention
      const { totalTasks } = startBatch(exp, true, 3, taskIds)
      return {
        triggered: true,
        experiment_id: expId,
        task_count: taskIds?.length ?? totalTasks,
        message: taskIds?.length
          ? `已触发重跑 ${taskIds.length} 条指定 task`
          : `已触发全量重跑实验 ${expId}`,
      }
    },
  },
  {
    name: "read_page",
    description:
      "Search the current page for nodes matching a natural-language query. Returns the top 5 matching data nodes with their full structured content. Use this when the user asks about something visible on their page but you don't have the detail in context yet.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "自然语言搜索词，例如 'status 为 failed 的 task' / '第三条结果的输出' / 'experiment exp_123 的失败样本'",
        },
      },
    },
    requiresConfirm: false,
    run: async (input, ctx) => {
      const snapshot = getSnapshot(ctx.sessionId)
      if (!snapshot) {
        return { matches: [], total_scanned: 0, message: '当前没有页面快照可用' }
      }
      const query = String(input.query ?? '').toLowerCase().trim()
      const tokens = query.split(/\s+/).filter(t => t.length >= 2)
      const scored = snapshot.viewport_index
        .map(entry => {
          const haystack = `${entry.type} ${entry.preview_text} ${(entry.ancestors ?? []).join(' ')}`.toLowerCase()
          let score = 0
          for (const t of tokens) if (haystack.includes(t)) score += 1
          return { entry, score }
        })
        .filter(x => x.score > 0)
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
        const [type, ...rest] = x.entry.key.split(':')
        const id = rest.join(':')
        return { tag: i + 1, type, id }
      })
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
    },
  },
]
