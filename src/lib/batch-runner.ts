import type { ExperimentConfig, ProgressState } from './types'
import type { GenericResultRecord } from './schema/types'
import { getSchema } from './schema'
import {
  generateTasks,
  buildMessages,
  buildInputPreview,
  buildInputRefs,
  type Task,
} from './schema/engine'
import { callLlm } from './llm-client'
import { parseResponse } from './result-parser'
import { appendResult, readResults, writeProgress, getProgress, updateExperiment } from './store'
import { getLlmConfig, findPricing } from './llm-config'

// Singleton map: at most one runner per experiment.
// 挂到 globalThis 上避免 Next.js dev 模式 HMR 重载模块时清空——否则 /run 启动的 runner
// 在下一次 /stop 路由加载时查不到，暂停按钮会返回 409 "not running"。
const globalForRunners = globalThis as unknown as { __activeRunners?: Map<string, BatchRunner> }
const activeRunners = (globalForRunners.__activeRunners ??= new Map<string, BatchRunner>())

export function startBatch(config: ExperimentConfig, resume: boolean, concurrency = 10, taskIds?: string[]): { totalTasks: number } {
  if (activeRunners.has(config.id)) {
    throw new Error('Experiment is already running')
  }

  const runner = new BatchRunner(config, concurrency)
  activeRunners.set(config.id, runner)
  runner.run(resume, taskIds).finally(() => {
    activeRunners.delete(config.id)
  })

  return { totalTasks: runner.totalTasks }
}

export function stopBatch(experimentId: string): boolean {
  const runner = activeRunners.get(experimentId)
  if (!runner) return false
  runner.stop()
  return true
}

class BatchRunner {
  private config: ExperimentConfig
  private schema: ReturnType<typeof getSchema>
  private tasks: Task[] = []
  private concurrency: number
  private abortController = new AbortController()
  private stopped = false
  totalTasks = 0

  constructor(config: ExperimentConfig, concurrency: number) {
    this.config = config
    this.concurrency = concurrency
    if (!config.schema_id) throw new Error('Experiment is missing schema_id')
    this.schema = getSchema(config.schema_id)
    if (!this.schema) throw new Error(`Unknown schema_id: ${config.schema_id}`)
    this.tasks = generateTasks(
      this.schema,
      config.filter_values ?? {},
      config.dataset_bindings ?? {},
    )
    this.totalTasks = this.tasks.length
  }

  stop() {
    this.stopped = true
    this.abortController.abort()
  }

  async run(resume: boolean, taskIds?: string[]) {
    let completedIds = new Set<string>()
    const failedIds = new Set<string>()
    let completedCount = 0
    let failedCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const totalCostByCurrency: Record<string, number> = {}

    if (resume) {
      const existing = getProgress(this.config.id)
      if (existing) {
        completedIds = new Set(existing.completed_task_ids)
        // 从结果里反推失败的 task_id（兼容老 progress.json）+ 累加历史 token/cost
        const existingResults = readResults(this.config.id)
        for (const r of existingResults) {
          if (r.status !== 'success') failedIds.add(r.task_id)
          if (typeof r.input_tokens === 'number') totalInputTokens += r.input_tokens
          if (typeof r.output_tokens === 'number') totalOutputTokens += r.output_tokens
          if (typeof r.cost_value === 'number') {
            const ccy = r.cost_currency || 'USD'
            totalCostByCurrency[ccy] = (totalCostByCurrency[ccy] ?? 0) + r.cost_value
          }
        }
        // 失败项要重试，从 completed 里移除
        for (const fid of failedIds) completedIds.delete(fid)
        // 精准重试：如果传了 taskIds，再把这些从 completed 里剔除，下面 filter 会挑出来
        if (taskIds) for (const tid of taskIds) completedIds.delete(tid)
        completedCount = completedIds.size
        failedCount = 0
      }
    }

    // 精准 retry：若传了 taskIds，只跑这些；否则按常规 resume 跑没 completed 的
    const taskIdSet = taskIds ? new Set(taskIds) : undefined
    const pendingTasks = this.tasks.filter(t =>
      taskIdSet ? taskIdSet.has(t.task_id) : !completedIds.has(t.task_id)
    )
    const total = this.tasks.length

    const progress: ProgressState = {
      experiment_id: this.config.id,
      status: 'running',
      total_tasks: total,
      completed_tasks: completedCount,
      failed_tasks: failedCount,
      completed_task_ids: Array.from(completedIds),
      failed_task_ids: [],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_log: [],
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_cost_by_currency: { ...totalCostByCurrency },
    }

    updateExperiment(this.config.id, {
      status: 'running',
      run_stats: {
        total_tasks: total, completed_tasks: completedCount, failed_tasks: failedCount,
        started_at: progress.started_at,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cost_by_currency: { ...totalCostByCurrency },
      },
    })
    writeProgress(progress)

    let running = 0
    let taskIndex = 0
    const errors: Array<{ task_id: string; error: string; timestamp: string }> = []

    const runNext = async (): Promise<void> => {
      while (taskIndex < pendingTasks.length && !this.stopped) {
        if (running >= this.concurrency) {
          await new Promise(resolve => setTimeout(resolve, 100))
          continue
        }

        const task = pendingTasks[taskIndex++]
        running++

        this.executeTask(task)
          .then(result => {
            appendResult(this.config.id, result)
            completedIds.add(task.task_id)
            completedCount++
            if (result.status !== 'success') {
              failedCount++
              failedIds.add(task.task_id)
              errors.push({
                task_id: task.task_id,
                error: result.error || result.status,
                timestamp: new Date().toISOString(),
              })
            } else {
              failedIds.delete(task.task_id)
            }

            if (typeof result.input_tokens === 'number') totalInputTokens += result.input_tokens
            if (typeof result.output_tokens === 'number') totalOutputTokens += result.output_tokens
            if (typeof result.cost_value === 'number') {
              const ccy = result.cost_currency || 'USD'
              totalCostByCurrency[ccy] = (totalCostByCurrency[ccy] ?? 0) + result.cost_value
            }

            progress.completed_tasks = completedCount
            progress.failed_tasks = failedCount
            progress.completed_task_ids = Array.from(completedIds)
            progress.failed_task_ids = Array.from(failedIds)
            progress.updated_at = new Date().toISOString()
            progress.error_log = errors.slice(-20)
            progress.total_input_tokens = totalInputTokens
            progress.total_output_tokens = totalOutputTokens
            progress.total_cost_by_currency = { ...totalCostByCurrency }
            writeProgress(progress)

            updateExperiment(this.config.id, {
              run_stats: {
                total_tasks: total, completed_tasks: completedCount, failed_tasks: failedCount,
                started_at: progress.started_at,
                total_input_tokens: totalInputTokens,
                total_output_tokens: totalOutputTokens,
                total_cost_by_currency: { ...totalCostByCurrency },
              },
            })
          })
          .catch(() => { /* errors handled in executeTask */ })
          .finally(() => { running-- })
      }
    }

    const workers = Array.from({ length: this.concurrency }, () => runNext())
    await Promise.all(workers)

    while (running > 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const finalStatus = this.stopped ? 'paused' : 'completed'
    progress.status = finalStatus
    progress.completed_tasks = completedCount
    progress.failed_tasks = failedCount
    progress.completed_task_ids = Array.from(completedIds)
    progress.failed_task_ids = Array.from(failedIds)
    progress.updated_at = new Date().toISOString()
    progress.total_input_tokens = totalInputTokens
    progress.total_output_tokens = totalOutputTokens
    progress.total_cost_by_currency = { ...totalCostByCurrency }
    writeProgress(progress)

    updateExperiment(this.config.id, {
      status: finalStatus,
      run_stats: {
        total_tasks: total,
        completed_tasks: completedCount,
        failed_tasks: failedCount,
        started_at: progress.started_at,
        finished_at: new Date().toISOString(),
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cost_by_currency: { ...totalCostByCurrency },
      },
    })
  }

  private async executeTask(task: Task): Promise<GenericResultRecord> {
    const schema = this.schema!
    const baseRecord = (extra: {
      status: GenericResultRecord['status']
      output?: Record<string, unknown>
      error?: string
      raw_response?: string
      latency_ms: number
      input_tokens?: number
      output_tokens?: number
      cost_value?: number
      cost_currency?: string
    }): GenericResultRecord => ({
      schema_id: schema.id,
      schema_version: schema.version,
      task_id: task.task_id,
      experiment_id: this.config.id,
      input_refs: buildInputRefs(schema, task.inputs, this.config.dataset_bindings ?? {}),
      input_preview: buildInputPreview(task.inputs),
      model: this.config.model,
      timestamp: new Date().toISOString(),
      ...extra,
    })

    try {
      const messages = buildMessages(schema, this.config.prompt_template, task.inputs)
      const response = await callLlm(
        messages,
        this.config.api_config,
        this.config.model,
        this.config.temperature,
        this.config.max_tokens,
        this.abortController.signal,
      )

      const input_tokens = response.usage?.prompt_tokens
      const output_tokens = response.usage?.completion_tokens
      // 实时读配置，允许用户中途改价；历史结果不追溯
      const pricing = findPricing(getLlmConfig(), this.config.model, this.config.model_id)
      const cost_value = (pricing && typeof input_tokens === 'number' && typeof output_tokens === 'number')
        ? (input_tokens * pricing.input_per_mtok + output_tokens * pricing.output_per_mtok) / 1_000_000
        : undefined
      const cost_currency = cost_value != null ? (pricing?.currency || 'USD') : undefined

      const parsed = parseResponse(response.content, schema)
      if (!parsed.success) {
        return baseRecord({
          status: 'parse_error',
          error: parsed.error,
          raw_response: response.content,
          latency_ms: response.latency_ms,
          input_tokens,
          output_tokens,
          cost_value,
          cost_currency,
        })
      }

      return baseRecord({
        status: 'success',
        output: parsed.data,
        latency_ms: response.latency_ms,
        input_tokens,
        output_tokens,
        cost_value,
        cost_currency,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      return baseRecord({
        status: 'error',
        error,
        latency_ms: 0,
      })
    }
  }
}
