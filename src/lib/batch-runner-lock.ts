// ---------- batch-runner-lock ----------
//
// File-based per-experiment lock. Replaces the previous `globalThis.__activeRunners`
// singleton (#9 plan): the singleton survived HMR but failed under multi-worker
// `next start -w N` and could leave silently-stuck experiments after process
// crash. The lock encodes who is running (pid + node version) and when (started_at +
// last_heartbeat) so a fresh `startBatch` invocation can decide:
//   - lock missing → free, write lock + run
//   - lock exists, holder PID alive, heartbeat recent → reject ("already running")
//   - lock exists but holder is dead (ESRCH) OR heartbeat stale (> 1h) → reset + run
//
// Heartbeat freshness is critical for long-running experiments (>1h): the runner
// calls `touchHeartbeat` from each `writeProgress` cycle, so a healthy runner
// keeps its heartbeat <30s old.
//
// Dev-mode boot cleanup: on first `startBatch` invocation in dev (NODE_ENV !==
// 'production'), all `data/results/*/.runner.lock` files are wiped. HMR module
// reloads orphan locks held by a runner whose in-memory state is gone — those
// experiments can't be aborted, so wiping locks lets a fresh `/run` win the
// lock and start over. Production skips this hook.

import fs from 'fs'
import path from 'path'
import { ensureDir, writeAtomic } from './fs-utils'

interface RunnerLock {
  /** OS PID of the process holding the lock. */
  pid: number
  /** ISO timestamp of when this lock was first written. */
  started_at: string
  /** ISO timestamp refreshed by `touchHeartbeat` each progress cycle. */
  last_heartbeat: string
  /** `process.version` of the holder; informational. */
  node_version: string
}

/** Heartbeat older than this is treated as stale even if the PID is alive
 *  (a hung runner that no longer ticks `writeProgress`). */
const STALE_HEARTBEAT_MS = 60 * 60 * 1000

function resultsDir(): string {
  return path.join(process.cwd(), 'data', 'results')
}

function lockDir(experimentId: string): string {
  return path.join(resultsDir(), experimentId)
}

function lockPath(experimentId: string): string {
  return path.join(lockDir(experimentId), '.runner.lock')
}

function readLock(experimentId: string): RunnerLock | null {
  const p = lockPath(experimentId)
  if (!fs.existsSync(p)) return null
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.started_at === 'string' &&
      typeof parsed.last_heartbeat === 'string' &&
      typeof parsed.node_version === 'string'
    ) {
      return {
        pid: parsed.pid,
        started_at: parsed.started_at,
        last_heartbeat: parsed.last_heartbeat,
        node_version: parsed.node_version,
      }
    }
    return null
  } catch {
    // Corrupt lock → treat as absent so a fresh acquire wins.
    return null
  }
}

/** True if a process with this PID exists. EPERM means it exists but we
 *  can't signal it — still alive. ESRCH means it's gone. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM') return true
    return false
  }
}

function isStaleHeartbeat(iso: string): boolean {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return true
  return Date.now() - t > STALE_HEARTBEAT_MS
}

/**
 * Try to acquire the lock for `experimentId`. Returns true if the lock is
 * now held by this process; false if another live runner holds it.
 *
 * Stale locks (dead PID OR heartbeat older than 1h) are auto-cleared and
 * the new lock written.
 *
 * Atomicity: uses `fs.openSync(p, 'wx')` (O_WRONLY|O_CREAT|O_EXCL) to win
 * the lock fd-exclusively. Two concurrent acquires can't both succeed
 * the create; the loser falls into the EEXIST branch and, when the holder
 * is dead/stale, unlinks the stale lock and re-attempts the same O_EXCL
 * create — so even two concurrent stale-detectors resolve to a single
 * winner. Replaces the previous read-check-write pattern that had a
 * TOCTOU window.
 */
export function acquireLock(experimentId: string): boolean {
  ensureDir(lockDir(experimentId))
  const p = lockPath(experimentId)
  const now = new Date().toISOString()
  const payload = JSON.stringify({
    pid: process.pid,
    started_at: now,
    last_heartbeat: now,
    node_version: process.version,
  } satisfies RunnerLock)
  if (tryExclusiveCreate(p, payload)) return true
  // EEXIST: a lock file is already there. Decide if it's live or stale.
  const existing = readLock(experimentId)
  if (existing && isPidAlive(existing.pid) && !isStaleHeartbeat(existing.last_heartbeat)) {
    return false
  }
  // Stale (dead PID, hung heartbeat, or corrupt content): clear it and re-attempt
  // the O_EXCL create. A blind overwrite here would let two processes that both
  // judged the lock stale both "win"; after unlink only one racer's create succeeds —
  // the loser sees EEXIST (the winner's fresh lock) and backs off.
  try {
    fs.unlinkSync(p)
  } catch {
    // Already removed by a concurrent racer; proceed to the create attempt.
  }
  return tryExclusiveCreate(p, payload)
}

/** O_EXCL create-and-write. False on EEXIST (someone else holds it); rethrows other errors. */
function tryExclusiveCreate(p: string, payload: string): boolean {
  try {
    const fd = fs.openSync(p, 'wx')
    try {
      fs.writeSync(fd, payload)
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    return false
  }
}

/**
 * Refresh the holder's heartbeat to now. Called from `BatchRunner.run` after
 * each `writeProgress` so long-running experiments don't get misdiagnosed as
 * hung by `STALE_HEARTBEAT_MS`. Silently no-ops if the lock is missing
 * (released by `stopBatch` / a previous crash).
 */
export function touchHeartbeat(experimentId: string): void {
  const existing = readLock(experimentId)
  if (!existing) return
  const updated: RunnerLock = {
    ...existing,
    last_heartbeat: new Date().toISOString(),
  }
  writeAtomic(lockPath(experimentId), JSON.stringify(updated))
}

/**
 * Release the lock. Idempotent: missing file → no-op. Called from
 * `BatchRunner.run`'s finally block (covers normal completion, abort, crash
 * inside the awaited body — but NOT a process crash; that's what stale
 * detection is for).
 */
export function releaseLock(experimentId: string): void {
  const p = lockPath(experimentId)
  if (!fs.existsSync(p)) return
  try {
    fs.unlinkSync(p)
  } catch {
    // Race with a concurrent unlink (e.g. another process beat us). Ignore.
  }
}

let bootCleanupDone = false

/**
 * Dev-only: on first invocation, scan `data/results/*` and delete all
 * `.runner.lock` files. Idempotent across the lifetime of this Node process.
 *
 * Skipped in production (`NODE_ENV === 'production'`) — production runners
 * are expected to outlive the lock semantics naturally; if a prod process
 * crashes leaving a stale lock, the next `acquireLock` will detect ESRCH
 * (or heartbeat staleness for the rare case of a still-alive but hung pid).
 */
export function clearStaleLocksOnBoot(): void {
  if (bootCleanupDone) return
  bootCleanupDone = true
  if (process.env.NODE_ENV === 'production') return
  const dir = resultsDir()
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    const lockFile = path.join(dir, entry, '.runner.lock')
    if (!fs.existsSync(lockFile)) continue
    try {
      fs.unlinkSync(lockFile)
    } catch {
      // Best-effort; if some lock can't be removed (permissions etc.), the
      // subsequent acquire path will still work via stale-detection.
    }
  }
}

/** Test-only: reset the once-per-process boot guard so a test can invoke
 *  `clearStaleLocksOnBoot` again on a fresh tmp directory. */
export function __resetBootCleanupForTests(): void {
  bootCleanupDone = false
}
