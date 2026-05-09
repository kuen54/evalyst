# Hardcode Audit — 2026-05-09

Branch: `chore/hardcode-audit`. Triggered by PR #54 (`fix/copilot-vision-defense-cleanup`) e2e regression on CI: vision-gate spec hardcoded `gemini-31-pro` / `opus-46-anthropic` model IDs that only existed in dev's local `data/llm-config.json`. CI ships a clean `data/`, so those tests broke. The fix was to self-provision fixture LLM models via `PUT /api/llm-config` + restore originalConfig in `afterAll`. This audit looks for sibling landmines.

Scope as defined: `e2e/*.spec.ts` (5 files), `src/**/__tests__/*.test.ts` (~68 files), `playwright.config.ts`, and source files referencing fixed resource IDs as defaults outside seed data. Skipped: `src/lib/seeds/*`, `src/lib/meta-prompts/*`, docs, `data/`, `node_modules/`, `.next/`, `playwright-report/`, `test-results/`.

Reference patterns audited against:
- `e2e/vision-gate.spec.ts` (the FIXED reference: snapshot original `/api/llm-config`, append fixture models, restore in `afterAll`, `describe.configure({ mode: "serial" })`).
- `src/lib/__tests__/llm-config.migrate.test.ts` (per-case `chdir` to tmp dir + `afterEach` restore).
- `playwright.config.ts` (`baseURL: \`http://localhost:${E2E_PORT ?? 3000}\``).

## Summary

- P0: 1 finding (will fail CI / cross-test pollution risk)
- P1: 2 findings (cross-env / hygiene)
- P2: 2 findings (smell, optional)
- Skipped: 9 explicitly noted as intentional / out-of-scope

The good news: the rest of the e2e + vitest suite already follows the post-PR-54 hygiene model. No other test hardcodes model_id / schema_id / experiment_id that requires a developer's local `data/` to pass. The only true CI-fragile finding is one vitest file that does module-level `process.chdir` instead of the per-case pattern.

## P0

### P0-1: `annotation-aggregate.test.ts` performs module-level `process.chdir` without per-case isolation

- **File**: `src/lib/__tests__/annotation-aggregate.test.ts:9-11` (chdir at import time), `:141-144` (cleanup is `afterAll` only).
- **Current**:
  ```ts
  // Module-level side effect — runs at file import:
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evalyst-test-"))
  const origCwd = process.cwd()
  process.chdir(tmp)
  ...
  // Cleanup deferred until ALL describes finish:
  afterAll(() => {
    process.chdir(origCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  ```
- **Issue**:
  1. `process.chdir` runs at module-load. If vitest later evolves to share workers across files (e.g. someone flips to `pool: 'threads'` or `fileParallelism: false` for speed), this file will leak its cwd into sibling test files that assume `process.cwd()` is the repo root (notably `src/lib/copilot/__tests__/real-session-smoke.test.ts:18` which reads `path.join(process.cwd(), "data", "copilot", "sessions")`).
  2. Even today, if any test in this file throws between `chdir(tmp)` and `afterAll`, the registered `afterAll` still fires — but if the *vitest runtime itself* errors before reaching `afterAll`, cwd never restores. `llm-config.migrate.test.ts` avoids this by using `beforeEach`/`afterEach`, where the restore is per-case and survives any single-case crash.
  3. The pattern is inconsistent with every other chdir-using test in the repo (12+ files use `beforeEach`/`afterEach`). It's a foot-gun waiting to confuse the next agent.
- **Suggested fix**: Convert to the `llm-config.migrate.test.ts` pattern — `beforeEach` does `mkdtempSync` + `chdir(tmp)`, `afterEach` does `chdir(origCwd)` + `rmSync(tmp)`. Move `write()` helper to take `tmp` from a shared `let` instead of a const.
- **Impact**: Today, harmless (vitest runs each test file in its own worker via the default forks pool); tomorrow, a single config tweak by another agent flips this into a chained-failure landmine. P0 because it's a coiled spring, not because it's currently red.

## P1

### P1-1: cache-stats path uses POSIX-only string component

- **File**: `src/lib/copilot/__tests__/cache-stats-store.test.ts:66`, `src/lib/copilot/__tests__/cache-stats-prune.test.ts:92`.
- **Current**:
  ```ts
  fs.appendFileSync(path.join(tmp, 'data/copilot/cache-stats.jsonl'), '{not json}\n')
  ```
- **Issue**: The 2nd argument to `path.join` is `'data/copilot/cache-stats.jsonl'` — a single string with embedded `/` separators. On darwin/linux this works, but it's not the project's house style: every other test in the repo passes the segments as separate args (`path.join(tmp, 'data', 'copilot', 'cache-stats.jsonl')`). Listed under P1 (cross-env hygiene) because the user explicitly noted "we're darwin-only so windows compat isn't required, but file `path.join` is just hygiene."
- **Suggested fix**: Split into segments — `path.join(tmp, 'data', 'copilot', 'cache-stats.jsonl')`. Two-line change in two files.
- **Impact**: None today. Pure consistency / discoverability.

### P1-2: `e2e/copilot-v25.spec.ts` writes to `data/copilot/cache-stats.jsonl` against `process.cwd()` (the live repo) and only filters its own seed in cleanup

- **File**: `e2e/copilot-v25.spec.ts:5-11` (paths derived from `process.cwd()`), `:104-163` (test 2: `cache stats chip renders with seeded weekly data`).
- **Current**:
  ```ts
  const COPILOT_DIR = path.join(process.cwd(), 'data', 'copilot')
  const CACHE_STATS_PATH = path.join(COPILOT_DIR, 'cache-stats.jsonl')
  ...
  fs.appendFileSync(CACHE_STATS_PATH, JSON.stringify(stat) + '\n')
  ...
  // cleanup filters only lines containing E2E_SEED_SESSION
  const filtered = raw
    .split('\n')
    .filter((l) => l.trim() && !l.includes(E2E_SEED_SESSION))
  fs.writeFileSync(CACHE_STATS_PATH, filtered.join('\n') + (filtered.length ? '\n' : ''))
  ```
- **Issue**:
  1. Unlike `vision-gate.spec.ts`, this spec writes directly into the repo's runtime `data/` dir rather than fixturing through an API endpoint. On CI this is fine (clean `data/`), but on a dev machine it commingles fixture state with the user's live cache-stats history.
  2. The cleanup is correct (`describe.configure({ mode: 'serial' })` is in place at line 63), so this isn't a current failure. But it's a different pattern than vision-gate's "snapshot + restore" — there's no snapshot, only a session-id filter on cleanup. If a future test reuses the same seed `session_id` literal, cleanup would corrupt cross-test state.
  3. Same comment about `process.cwd()`-based paths in tests — the e2e suite runs against a live dev server (which does its own `process.cwd()` resolution server-side), and the test writes to its own `process.cwd()` (which is the same repo root in practice). Coincidence keeps it working; if e2e tests ever ran from a packaged build, this would diverge.
- **Suggested fix**: Either (a) write fixture cache-stats through a server endpoint (no `/api/copilot/cache-stats` POST exists today, so this is a nontrivial refactor), or (b) accept the current pattern but rename `E2E_SEED_SESSION = 'e2e-seed-session'` to a UUID-suffixed value per run (`'e2e-seed-' + crypto.randomUUID()`) so concurrent dev iterations / forgotten cleanup don't collide. (b) is the lighter change.
- **Impact**: Low today. Cleanup currently works. Risk surface if (i) someone reuses the literal `'e2e-seed-session'` elsewhere, or (ii) test crashes between the seed write and cleanup, leaving a stranded line in the dev's real cache-stats.jsonl.

## P2

### P2-1: `real-session-smoke.test.ts` reads the live repo's `data/copilot/sessions/`

- **File**: `src/lib/copilot/__tests__/real-session-smoke.test.ts:16-18`.
- **Current**:
  ```ts
  // 用仓库根目录。process.cwd() 在 vitest 下就是 repo root（除非被别的 test chdir 了，
  // 但这个测试不 chdir，且 afterEach 在其他 test 会 restore）。
  const sessionsDir = path.join(process.cwd(), "data", "copilot", "sessions")
  ```
- **Issue**: The test is a backward-compat smoke that intentionally reads real prod-shape session jsonl files. It's guarded by `if (!fs.existsSync(sessionsDir)) return` so it's a no-op on clean CI. Dev-side, it depends on `process.cwd()` being the repo root *at module-load time of this file* — which is fragile if P0-1 (annotation-aggregate's module-level chdir) ever survives past its file boundary. The author flagged this dependency in the comment.
- **Justification**: Intentional design choice — the test's whole point is to exercise real shipped data. Marking P2 (questionable, not blocking) rather than skip because the author already acknowledged the fragility in code comments and the no-op-on-CI guard makes it CI-safe today.
- **Suggested fix (optional)**: If P0-1 gets fixed (per-case `chdir`), this becomes safe automatically. No standalone change needed.

### P2-2: `setTimeout(..., 3000)` in experiment detail page

- **File**: `src/app/experiments/[id]/page.tsx:418`.
- **Current**:
  ```ts
  setTimeout(() => setBusy(prev => { const n = new Set(prev); n.delete(taskId); return n }), 3000)
  ```
- **Issue**: A 3-second debounce/timeout magic number for a UI busy-state release. Not user-configurable, not a constant.
- **Justification**: UI ergonomics tweak. Marking **questionable** because if the underlying restart-task API takes >3s, the busy badge would clear before the request completes and a user could re-click. But this is product polish, not a correctness or CI issue.
- **Suggested fix (optional)**: Replace with a state-machine that listens for the actual restart's completion event, or extract to a named constant `BUSY_AUTO_RELEASE_MS = 3000` with a comment explaining the choice.

## Intentional / Skipped (annotated)

- **`e2e/vision-gate.spec.ts:33-36`** — `FIXTURE_EXP_ID = "image_gen_v1_smoke"`, `FIXTURE_TASK_ID = "smoke-task-1"`, fixture model IDs. **Intentional**: these are fixture identifiers self-provisioned by the test (PR #54 fix). Distinct from a hardcoded *prod* ID.
- **`e2e/vision-gate.spec.ts:95,105`** — `schema_id: "image_gen_v1"`. **Intentional**: this is a seeded schema (`src/lib/seeds/image_gen_v1.schema.json`), guaranteed to exist on any clean checkout. Same justification as `qa_answer_v1` use elsewhere.
- **`e2e/vision-gate.spec.ts:161,171`** — `base_url: "http://localhost:1"` for fixture LLM models. **Intentional**: dummy URL chosen to fail-fast if the gate is bypassed; the test never expects the LLM call to succeed.
- **`e2e/copilot-v25.spec.ts:26,39`** — `schema_id: 'qa_answer_v1'`. **Intentional**: seeded schema (`src/lib/seeds/qa_answer_v1.schema.json`).
- **`e2e/copilot-v25.spec.ts:31`** — `api_config: { base_url: 'http://fake', api_key: 'fake' }`. **Intentional**: same fixture-pattern justification — the test uses a `status: 'completed'` no-LLM fixture, the api_config is never invoked.
- **`e2e/smoke.spec.ts:42`** — `'/api/skills/evalyst-dataset'`. **Intentional**: `evalyst-dataset` is a real shipped skill (`.claude/skills/evalyst-dataset/SKILL.md` and `.agents/skills/evalyst-dataset/SKILL.md` are both checked in). The endpoint test is a regression for the docker-skills fix in 5383de5.
- **`e2e/image-route.spec.ts:14`** — `'/api/results/nonexistent_exp_xyz/...'`. **Intentional**: deliberately non-existent ID, asserting 404 behaviour.
- **`src/lib/llm-client.ts:132`** — comment mentions `aigc.sankuai.com`. **Intentional**: it's a comment explaining a gateway compat case, not a literal URL in a fetch call. The actual `base_url` comes from `data/llm-config.json` (user state).
- **`src/lib/copilot/__tests__/cache-stats-*.test.ts` model `'claude-sonnet-4-6'`** — **Intentional**: passed as a label string into `CacheUsageStat` records the test constructs; never resolves against `data/llm-config.json`. The test exercises serialization, not model lookup.
- **`src/lib/copilot/__tests__/route-gating.integration.test.ts:12,29` and `src/lib/copilot/__tests__/llm-stream-serialize.test.ts:403` model `'claude-sonnet-4-6'`** — **Intentional**: passed into `__testOnly.buildStreamingRequestBody({ model: ... })` as a literal field. The test reads `body.tools` / `body.system`; the model name doesn't matter functionally.
- **`MAX_IMAGES_PER_TURN`-style spec constants** — none surfaced as concerning during the audit. The cache-break thresholds (`CACHE_BREAK_MIN_DROP_TOKENS = 1000`, `CACHE_BREAK_MAX_RATIO = 0.95`) are exported by `src/lib/copilot/cache-break-detect.ts` and asserted on in `cache-stats-store.test.ts:153-156` — that's the textbook "spec-defined constant" pattern, **intentional**.
- **All `process.cwd()`-based test paths** that follow the `beforeEach { chdir(tmp) } / afterEach { chdir(origCwd) }` pattern (12+ files) — **intentional and correct** per the `llm-config.migrate.test.ts` reference.

## Methodology notes (for the reviewer)

- Greps run: `process\.cwd\(\)`, `localhost:`, `aigc\.sankuai`, `/tmp/`, `gemini-31-pro|opus-46-anthropic|claude-sonnet|gpt-4o`, `data/llm-config|data/experiments|data/copilot|data/datasets|data/schemas|data/results|data/displays|data/rubrics`, `qa_answer_v1|image_gen_v1`, `'/' \+`, `fs\.writeFileSync|fs\.mkdirSync|fs\.appendFileSync`, `writeFile|appendFile|mkdir|chdir`, `request\.get|request\.post|request\.put|request\.delete`, `PORT|baseURL|3000|http://localhost`, `process\.env`.
- Files opened in full: `e2e/{vision-gate,smoke,image-route,copilot-v2,copilot-v25}.spec.ts`, `playwright.config.ts`, `vitest.config.ts`, `src/lib/__tests__/{llm-config.migrate,annotation-aggregate,store.migrate,image-store}.test.ts`, `src/lib/copilot/__tests__/{session-store,real-session-smoke,image-attach.read-bytes,route-integration,cache-stats-store,cache-stats-prune,v1-session-compat,tool-runtime-integration,tool-result-store,route-gating.integration,llm-stream-serialize}.test.ts`, `src/lib/copilot/tools/__tests__/{read-context,read-tool-result,read-context.image,hooks.attachments-lift,read-dataset-records}.test.ts`.
- Files explicitly out of scope per the task brief and not opened: `src/lib/seeds/*`, `src/lib/meta-prompts/*`, README/CLAUDE/AGENTS/docs, `data/`, `node_modules/`, `.next/`, `playwright-report/`, `test-results/`.
