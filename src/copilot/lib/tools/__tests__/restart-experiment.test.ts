import { describe, it, expect, vi, beforeEach } from "vitest"

const startBatchMock = vi.fn()
const getExperimentMock = vi.fn()

vi.mock("@/lib/batch-runner", () => ({
  startBatch: (...args: unknown[]) => startBatchMock(...args),
}))
vi.mock("@/lib/store", () => ({
  getExperiment: (...args: unknown[]) => getExperimentMock(...args),
}))

import { restartExperimentTool } from "../restart-experiment"

const ctx = { session_id: "s", signal: new AbortController().signal }

beforeEach(() => {
  startBatchMock.mockReset()
  getExperimentMock.mockReset()
})

describe("restart_experiment · metadata", () => {
  it("is destructive + not read-only", () => {
    expect(restartExperimentTool.metadata.isDestructive).toBe(true)
    expect(restartExperimentTool.metadata.isReadOnly).toBe(false)
  })
})

describe("restart_experiment · input validation (v2.5 P2)", () => {
  it("missing experiment_id → err(INVALID_INPUT)", async () => {
    const r = await restartExperimentTool.call({} as never, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("experiment_id") },
    })
    expect(getExperimentMock).not.toHaveBeenCalled()
    expect(startBatchMock).not.toHaveBeenCalled()
  })

  it("experiment not found → err(NOT_FOUND)", async () => {
    getExperimentMock.mockReturnValue(null)
    const r = await restartExperimentTool.call({ experiment_id: "nope" }, ctx)
    expect(r).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("not found") },
    })
    expect(startBatchMock).not.toHaveBeenCalled()
  })
})

describe("restart_experiment · success path", () => {
  it("valid input triggers batch and returns ok wrapping output", async () => {
    getExperimentMock.mockReturnValue({ id: "exp_1", schema_id: "sch" })
    startBatchMock.mockReturnValue({ totalTasks: 12 })
    const r = await restartExperimentTool.call({ experiment_id: "exp_1" }, ctx)
    expect(r).toMatchObject({
      ok: true,
      value: {
        triggered: true,
        experiment_id: "exp_1",
        task_count: 12,
      },
    })
    expect(startBatchMock).toHaveBeenCalledTimes(1)
  })

  it("valid input with task_ids subset", async () => {
    getExperimentMock.mockReturnValue({ id: "exp_1" })
    startBatchMock.mockReturnValue({ totalTasks: 12 })
    const r = await restartExperimentTool.call(
      { experiment_id: "exp_1", task_ids: ["t1", "t2"] },
      ctx,
    )
    expect(r).toMatchObject({
      ok: true,
      value: { task_count: 2 },
    })
    // task_ids forwarded to startBatch (4th arg)
    expect(startBatchMock).toHaveBeenCalledWith(
      { id: "exp_1" },
      true,
      3,
      ["t1", "t2"],
    )
  })
})
