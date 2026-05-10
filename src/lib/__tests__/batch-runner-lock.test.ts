import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  acquireLock,
  releaseLock,
  touchHeartbeat,
  clearStaleLocksOnBoot,
  __resetBootCleanupForTests,
} from "@/lib/batch-runner-lock"

/**
 * Plan §4 — 4 cases:
 *  (1) acquireLock on empty dir succeeds, file shape correct
 *  (2) second acquireLock with live PID + fresh heartbeat returns false
 *  (3) lock held by a dead PID is auto-cleared on next acquire
 *  (4) clearStaleLocksOnBoot wipes all .runner.lock files in dev mode
 *
 * Each case chdir's to a fresh tmp directory. The lock helpers resolve
 * paths via process.cwd() lazily (mirrors llm-config.ts pattern), so
 * chdir affects them.
 */

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "batch-runner-lock-"))
  fs.mkdirSync(path.join(tmp, "data", "results"), { recursive: true })
  process.chdir(tmp)
  __resetBootCleanupForTests()
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function lockPathFor(experimentId: string): string {
  return path.join(tmp, "data", "results", experimentId, ".runner.lock")
}

function readLockFile(experimentId: string): Record<string, unknown> {
  const raw = fs.readFileSync(lockPathFor(experimentId), "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

describe("batch-runner-lock", () => {
  it("acquireLock on empty dir writes a valid lock", () => {
    expect(acquireLock("exp_a")).toBe(true)
    const lock = readLockFile("exp_a")
    expect(lock).toMatchObject({
      pid: process.pid,
      node_version: process.version,
    })
    expect(typeof lock.started_at).toBe("string")
    expect(typeof lock.last_heartbeat).toBe("string")
    // started_at and last_heartbeat written together
    expect(lock.started_at).toBe(lock.last_heartbeat)

    releaseLock("exp_a")
  })

  it("second acquireLock with live holder is rejected", () => {
    expect(acquireLock("exp_b")).toBe(true)

    // The first acquire wrote process.pid which is alive (we are it).
    // process.kill(process.pid, 0) returns true → second acquire must reject.
    expect(acquireLock("exp_b")).toBe(false)

    // Lock file was NOT overwritten (started_at / pid still match the first).
    const lock = readLockFile("exp_b")
    expect(lock.pid).toBe(process.pid)

    releaseLock("exp_b")
  })

  it("stale lock (dead PID via ESRCH) is auto-cleared on next acquire", () => {
    // Pre-write a lock claiming pid 999999 (vanishingly unlikely to exist).
    fs.mkdirSync(path.join(tmp, "data", "results", "exp_c"), { recursive: true })
    fs.writeFileSync(
      lockPathFor("exp_c"),
      JSON.stringify({
        pid: 999999,
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        node_version: process.version,
      }),
    )

    // Mock process.kill so the test does not depend on whether pid 999999
    // happens to exist on the test machine. ESRCH = "no such process".
    vi.spyOn(process, "kill").mockImplementationOnce(() => {
      const e = new Error("ESRCH") as NodeJS.ErrnoException
      e.code = "ESRCH"
      throw e
    })

    expect(acquireLock("exp_c")).toBe(true)

    // Lock has been overwritten — pid is now ours, not 999999.
    const lock = readLockFile("exp_c")
    expect(lock.pid).toBe(process.pid)
    expect(lock.pid).not.toBe(999999)

    releaseLock("exp_c")
  })

  it("clearStaleLocksOnBoot wipes all .runner.lock files in dev mode", () => {
    vi.stubEnv("NODE_ENV", "development")

    // Seed 3 locks across different experiment directories.
    for (const id of ["exp_d1", "exp_d2", "exp_d3"]) {
      fs.mkdirSync(path.join(tmp, "data", "results", id), { recursive: true })
      fs.writeFileSync(
        lockPathFor(id),
        JSON.stringify({
          pid: 12345,
          started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
          node_version: process.version,
        }),
      )
    }

    // Sanity: all 3 lock files exist before cleanup.
    for (const id of ["exp_d1", "exp_d2", "exp_d3"]) {
      expect(fs.existsSync(lockPathFor(id))).toBe(true)
    }

    clearStaleLocksOnBoot()

    // After cleanup: all 3 lock files gone, but the experiment directories
    // themselves remain (cleanup only targets .runner.lock, not the dir).
    for (const id of ["exp_d1", "exp_d2", "exp_d3"]) {
      expect(fs.existsSync(lockPathFor(id))).toBe(false)
      expect(fs.existsSync(path.join(tmp, "data", "results", id))).toBe(true)
    }
  })

  it("touchHeartbeat refreshes only last_heartbeat, leaves started_at alone", async () => {
    expect(acquireLock("exp_e")).toBe(true)
    const before = readLockFile("exp_e")

    // Sleep 5ms to ensure ISO timestamp delta > 0.
    await new Promise((r) => setTimeout(r, 5))
    touchHeartbeat("exp_e")

    const after = readLockFile("exp_e")
    expect(after.started_at).toBe(before.started_at)
    expect(typeof after.last_heartbeat).toBe("string")
    expect(after.last_heartbeat).not.toBe(before.last_heartbeat)
    // last_heartbeat is more recent than started_at.
    expect(Date.parse(after.last_heartbeat as string)).toBeGreaterThanOrEqual(
      Date.parse(after.started_at as string),
    )

    releaseLock("exp_e")
  })

  it("clearStaleLocksOnBoot is a no-op in production", () => {
    vi.stubEnv("NODE_ENV", "production")

    fs.mkdirSync(path.join(tmp, "data", "results", "exp_f"), { recursive: true })
    fs.writeFileSync(
      lockPathFor("exp_f"),
      JSON.stringify({
        pid: 12345,
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        node_version: process.version,
      }),
    )

    clearStaleLocksOnBoot()

    // Lock survives production cleanup.
    expect(fs.existsSync(lockPathFor("exp_f"))).toBe(true)
  })
})
