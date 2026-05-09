import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { ExperimentConfig, ProgressState } from "@/lib/types"
import type { TaskSchema, GenericResultRecord, DatasetDef } from "@/lib/schema/types"
import type { LlmResponse } from "@/lib/llm-client"

// ----- Hoisted mocks (shared between vi.mock factories and test bodies) -----
// 全部 hoisted 提前到 vi.mock factory 之上，避免 module-level 缓存 race（plan §5 R2）

const mocks = vi.hoisted(() => {
  const fns = {
    callLlm: vi.fn(),
    appendResult: vi.fn(),
    writeProgress: vi.fn(),
    updateExperiment: vi.fn(),
    getProgress: vi.fn(),
    readResults: vi.fn(),
    getLlmConfig: vi.fn(),
    findPricing: vi.fn(),
    parseResponse: vi.fn(),
    saveImagesForTask: vi.fn(),
    assignImagePathsToOutput: vi.fn(),
    getDataset: vi.fn(),
    getSchema: vi.fn(),
  }
  const store = {
    results: new Map<string, Map<string, unknown>>(),
    progress: new Map<string, unknown>(),
    experiments: new Map<string, unknown>(),
    writeProgressLog: [] as unknown[],
    updateExperimentLog: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  }
  return { fns, store }
})

vi.mock("@/lib/llm-client", () => ({ callLlm: mocks.fns.callLlm }))
vi.mock("@/lib/store", () => ({
  appendResult: mocks.fns.appendResult,
  writeProgress: mocks.fns.writeProgress,
  updateExperiment: mocks.fns.updateExperiment,
  getProgress: mocks.fns.getProgress,
  readResults: mocks.fns.readResults,
}))
vi.mock("@/lib/llm-config", () => ({
  getLlmConfig: mocks.fns.getLlmConfig,
  findPricing: mocks.fns.findPricing,
}))
vi.mock("@/lib/datasets", () => ({ getDataset: mocks.fns.getDataset }))
vi.mock("@/lib/schema", () => ({ getSchema: mocks.fns.getSchema }))
vi.mock("@/lib/result-parser", () => ({ parseResponse: mocks.fns.parseResponse }))
vi.mock("@/lib/image-store", () => ({
  saveImagesForTask: mocks.fns.saveImagesForTask,
  assignImagePathsToOutput: mocks.fns.assignImagePathsToOutput,
}))

// Import AFTER vi.mock declarations
import { BatchRunner } from "@/lib/batch-runner"

// ----- Fixture helpers -----

const fakeUsage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }

function makeResponse(content = '{"answer":"a"}'): LlmResponse {
  return { content, latency_ms: 5, usage: fakeUsage }
}

function makeSchema(): TaskSchema {
  return {
    id: "sch_test",
    label: "test",
    version: 1,
    inputs: [{ alias: "q", dataset_id: "ds_test" }],
    variables: [],
    default_prompt: "Answer: {{q.text}}",
    message_builder: { user_template: "{{q.text}}" },
    output_schema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    },
  }
}

function makeDataset(numRecords: number, idPrefix = "t"): { records: Record<string, unknown>[]; def: DatasetDef } {
  const records = Array.from({ length: numRecords }, (_, i) => ({
    id: `${idPrefix}${i + 1}`,
    text: `q${i + 1}`,
  }))
  const def: DatasetDef = {
    id: "ds_test",
    name: "Test dataset",
    source: "upload",
    id_field: "id",
    fields: [
      { key: "id", type: "string" },
      { key: "text", type: "string" },
    ],
  }
  return { records, def }
}

function makeConfig(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    id: "exp_test",
    name: "test exp",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    schema_id: "sch_test",
    model_id: "m_usd",
    model: "gpt-test",
    temperature: 0.7,
    max_tokens: 1024,
    api_config: { api_format: "openai", base_url: "https://x", api_key: "sk-x" },
    prompt_template: "p",
    status: "draft",
    ...overrides,
  }
}

// 复刻 src/lib/llm-config.ts:149 findPricing 的真语义（id 优先，回退 model name 匹配）
function realFindPricing(cfg: { models?: Array<Record<string, unknown>> }, model: string, modelId?: string) {
  if (modelId) {
    const e = cfg.models?.find(m => m.id === modelId)
    if (e?.pricing) return e.pricing
  }
  return cfg.models?.find(m => m.model === model && m.pricing)?.pricing
}

const flush = () => new Promise<void>(r => setImmediate(r))

// ----- Lifecycle -----

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-batch-"))
  process.chdir(tmp)

  // R1: 跨测残留 singleton 显式清（测试虽走 new BatchRunner，仍防御）
  delete (globalThis as { __activeRunners?: unknown }).__activeRunners

  vi.clearAllMocks()
  mocks.store.results.clear()
  mocks.store.progress.clear()
  mocks.store.experiments.clear()
  mocks.store.writeProgressLog.length = 0
  mocks.store.updateExperimentLog.length = 0

  // appendResult / readResults: 内存 Map last-wins，对齐 store.ts:140-142 真实 dedupe 语义
  mocks.fns.appendResult.mockImplementation((expId: string, result: GenericResultRecord) => {
    const map = (mocks.store.results.get(expId) as Map<string, GenericResultRecord> | undefined)
      ?? new Map<string, GenericResultRecord>()
    map.set(result.task_id, result)
    mocks.store.results.set(expId, map as Map<string, unknown>)
  })
  mocks.fns.readResults.mockImplementation((expId: string) => {
    const map = mocks.store.results.get(expId) as Map<string, GenericResultRecord> | undefined
    return map ? Array.from(map.values()) : []
  })
  mocks.fns.writeProgress.mockImplementation((p: ProgressState) => {
    const snap = JSON.parse(JSON.stringify(p)) as ProgressState
    mocks.store.progress.set(p.experiment_id, snap)
    mocks.store.writeProgressLog.push(snap)
  })
  mocks.fns.getProgress.mockImplementation((expId: string) =>
    (mocks.store.progress.get(expId) as ProgressState | undefined) ?? null,
  )
  mocks.fns.updateExperiment.mockImplementation((id: string, updates: Record<string, unknown>) => {
    const cur = (mocks.store.experiments.get(id) as Record<string, unknown> | undefined) ?? {}
    const next = { ...cur, ...updates }
    mocks.store.experiments.set(id, next)
    mocks.store.updateExperimentLog.push({ id, updates: JSON.parse(JSON.stringify(updates)) })
    return next
  })

  mocks.fns.getSchema.mockReturnValue(makeSchema())
  mocks.fns.getDataset.mockReturnValue(makeDataset(0))

  mocks.fns.getLlmConfig.mockReturnValue({
    models: [{
      id: "m_usd", name: "usd", model: "gpt-test", api_format: "openai",
      base_url: "https://x", api_key: "k",
      pricing: { input_per_mtok: 10, output_per_mtok: 20, currency: "USD" },
    }],
  })
  mocks.fns.findPricing.mockImplementation(realFindPricing)

  mocks.fns.callLlm.mockResolvedValue(makeResponse())
  mocks.fns.parseResponse.mockReturnValue({ success: true, data: { answer: "a" } })
  mocks.fns.saveImagesForTask.mockResolvedValue([])
  mocks.fns.assignImagePathsToOutput.mockImplementation((output: unknown) => output)
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

// ----- Cases -----

describe("BatchRunner.run — case 1: resume + 部分 failed", () => {
  it("re-runs t9 (parse_error) plus new t11/t12; final state clean", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(12))

    const completedIds = Array.from({ length: 10 }, (_, i) => `q:t${i + 1}`)
    mocks.store.progress.set(expId, {
      experiment_id: expId, status: "paused",
      total_tasks: 12, completed_tasks: 10, failed_tasks: 1,
      completed_task_ids: completedIds, failed_task_ids: ["q:t9"],
      started_at: "x", updated_at: "x", error_log: [],
    } as ProgressState)
    mocks.store.results.set(expId, new Map([["q:t9", {
      schema_id: "sch_test", schema_version: 1, task_id: "q:t9",
      experiment_id: expId, input_refs: {}, input_preview: {},
      status: "parse_error", latency_ms: 5, model: "gpt-test", timestamp: "x",
    } as GenericResultRecord]]))

    const runner = new BatchRunner(makeConfig({ id: expId }), 4)
    await runner.run(true)

    expect(mocks.fns.appendResult).toHaveBeenCalledTimes(3)
    const ranIds = mocks.fns.appendResult.mock.calls
      .map(c => (c[1] as GenericResultRecord).task_id)
      .sort()
    expect(ranIds).toEqual(["q:t11", "q:t12", "q:t9"])

    const finalProgress = mocks.store.progress.get(expId) as ProgressState
    expect(finalProgress.status).toBe("completed")
    expect(finalProgress.completed_tasks).toBe(12)
    expect(finalProgress.failed_tasks).toBe(0)
    expect(finalProgress.completed_task_ids).toHaveLength(12)
    expect(finalProgress.failed_task_ids).toEqual([])
  })
})

describe("BatchRunner.run — case 2: taskIds 子集", () => {
  it("retries only the listed task_ids; other completed are preserved", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(8))

    const all = Array.from({ length: 8 }, (_, i) => `q:t${i + 1}`)
    mocks.store.progress.set(expId, {
      experiment_id: expId, status: "completed",
      total_tasks: 8, completed_tasks: 8, failed_tasks: 0,
      completed_task_ids: all, failed_task_ids: [],
      started_at: "x", updated_at: "x", error_log: [],
    } as ProgressState)

    const runner = new BatchRunner(makeConfig({ id: expId }), 4)
    await runner.run(true, ["q:t3", "q:t5"])

    expect(mocks.fns.appendResult).toHaveBeenCalledTimes(2)
    const ranIds = mocks.fns.appendResult.mock.calls
      .map(c => (c[1] as GenericResultRecord).task_id)
      .sort()
    expect(ranIds).toEqual(["q:t3", "q:t5"])

    const finalProgress = mocks.store.progress.get(expId) as ProgressState
    expect(finalProgress.completed_task_ids).toHaveLength(8)
    expect(finalProgress.completed_tasks).toBe(8)
  })
})

describe("BatchRunner.run — case 3: 中途 stop", () => {
  it("stop() during first callLlm → in-flight finish, unstarted dropped, status=paused", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(6))

    let calls = 0
    let runnerRef: BatchRunner | null = null
    mocks.fns.callLlm.mockImplementation(async () => {
      calls++
      // 用 queueMicrotask 让 stop 在"第一次 resolve 之后"才生效——若同步 stop()
      // 会让 main loop 第 2 次 iter 直接 break（in-flight 只有 t1），不符合 spec 语义
      if (calls === 1) queueMicrotask(() => runnerRef!.stop())
      return makeResponse()
    })

    const runner = new BatchRunner(makeConfig({ id: expId }), 2)
    runnerRef = runner
    await runner.run(false)

    // 并发=2：t1 + t2 都已 in-flight；stop 在 t1 内触发；两者都跑完，t3+ 不启动
    expect(mocks.fns.appendResult).toHaveBeenCalledTimes(2)
    const finalProgress = mocks.store.progress.get(expId) as ProgressState
    expect(finalProgress.status).toBe("paused")

    const log = mocks.store.updateExperimentLog
    const lastUpdate = log[log.length - 1]
    expect(lastUpdate.updates.status).toBe("paused")
  })
})

describe("BatchRunner.run — case 4: progress 三路径累加", () => {
  it("input_tokens / output_tokens / total_cost_by_currency.USD; writeProgress 精确 5 次", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(3))
    // 默认定价 input_per_mtok=10, output_per_mtok=20 USD
    // 单 task cost = (10*10 + 20*20)/1e6 = 500e-6 = 5e-4
    // 3 task 总 cost = 1.5e-3

    const runner = new BatchRunner(makeConfig({ id: expId }), 4)
    await runner.run(false)

    const fp = mocks.store.progress.get(expId) as ProgressState
    expect(fp.total_input_tokens).toBe(30)
    expect(fp.total_output_tokens).toBe(60)
    expect(fp.total_cost_by_currency!.USD).toBeCloseTo(1.5e-3, 10)

    // 1 init (line 138) + 3 per-task (line 177) + 1 final (line 214) = 5
    expect(mocks.fns.writeProgress).toHaveBeenCalledTimes(5)
  })
})

describe("BatchRunner.run — case 5: concurrency 上限", () => {
  it("never runs more than concurrency=2 simultaneously; peak == 2 over 6 tasks", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(6))

    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    mocks.fns.callLlm.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>(r => releases.push(() => { active--; r() }))
      return makeResponse()
    })

    const runner = new BatchRunner(makeConfig({ id: expId }), 2)
    const runPromise = runner.run(false)

    // 控制释放节奏：每轮 flush 检查队列，pop 一个释放，直到全部完成
    for (let safety = 0; safety < 200; safety++) {
      await flush()
      if (releases.length === 0 && active === 0) break
      if (releases.length > 0) releases.shift()!()
    }
    await runPromise

    expect(peak).toBe(2)
    expect(mocks.fns.appendResult).toHaveBeenCalledTimes(6)
  })
})

describe("BatchRunner.run — case 6: cost per-currency 累加", () => {
  it("USD + CNY 交替 task → total_cost_by_currency 双键各自 close-to 期望值", async () => {
    const expId = "exp_test"
    mocks.fns.getDataset.mockReturnValue(makeDataset(4))

    const usdPricing = { input_per_mtok: 1, output_per_mtok: 2, currency: "USD" }
    const cnyPricing = { input_per_mtok: 8, output_per_mtok: 16, currency: "CNY" }
    let n = 0
    mocks.fns.findPricing.mockImplementation(() => (n++ % 2 === 0 ? usdPricing : cnyPricing))

    // concurrency=1 让 USD/CNY 交替顺序确定
    const runner = new BatchRunner(makeConfig({ id: expId }), 1)
    await runner.run(false)

    const fp = mocks.store.progress.get(expId) as ProgressState
    // USD 单 task: (10*1 + 20*2)/1e6 = 50e-6 = 5e-5；2 个 → 1e-4
    expect(fp.total_cost_by_currency!.USD).toBeCloseTo(1e-4, 12)
    // CNY 单 task: (10*8 + 20*16)/1e6 = 400e-6 = 4e-4；2 个 → 8e-4
    expect(fp.total_cost_by_currency!.CNY).toBeCloseTo(8e-4, 12)
  })
})
