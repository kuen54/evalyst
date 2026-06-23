/**
 * perf-fixture.ts — generate a data-dense synthetic experiment for the glass
 * perf spec (e2e/glass-perf.spec.ts).
 *
 * Run:  npx tsx scripts/perf-fixture.ts
 *
 * Produces:
 *   - data/experiments/perf_fixture.json     (ExperimentConfig, status: completed)
 *   - data/results/perf_fixture/results.jsonl (~300 GenericResultRecord rows)
 *
 * Targets the REAL seeded schema `qa_answer_v1` with NO explicit display_id, so
 * display-inference picks `single_list` → the SingleListResults view renders one
 * <GlassCardThin> (data-glass-variant="thin") per result row. That gives a long
 * scrollable list of glass cards — exactly the structural paint cost the Track A
 * premium-edge upgrade must not regress.
 *
 * Shapes are reverse-engineered from src/lib/schema/types.ts (GenericResultRecord)
 * and src/lib/types.ts (ExperimentConfig). We write with plain `fs` and absolute
 * paths from process.cwd()/data so this stays free of @-alias imports that tsx
 * might not resolve under a bare run.
 */

import fs from "fs"
import path from "path"

const ROW_COUNT = 300
const SCHEMA_ID = "qa_answer_v1"
const SCHEMA_VERSION = 1
const EXPERIMENT_ID = "perf_fixture"
const MODEL = "perf-fixture-model"
// Sprinkle a few error rows so the error-cell branch of SingleListResults also
// renders (red border + status/error text path).
const ERROR_EVERY = 37

type ResultStatus = "success" | "error" | "parse_error"

interface GenericResultRecord {
  schema_id: string
  schema_version: number
  task_id: string
  experiment_id: string
  input_refs: Record<string, string | number>
  input_preview: Record<string, unknown>
  output?: Record<string, unknown>
  status: ResultStatus
  error?: string
  raw_response?: string
  latency_ms: number
  model: string
  timestamp: string
  input_tokens?: number
  output_tokens?: number
  cost_value?: number
  cost_currency?: string
}

const TOPICS = ["geography", "literature", "science", "history", "art", "technology"]
const DIFFICULTIES = ["easy", "medium", "hard"]

function pad(n: number): string {
  return String(n).padStart(4, "0")
}

function makeRow(i: number): GenericResultRecord {
  const id = `q${pad(i)}`
  const taskId = `${EXPERIMENT_ID}__${id}`
  const topic = TOPICS[i % TOPICS.length]!
  const difficulty = DIFFICULTIES[i % DIFFICULTIES.length]!
  const isError = i % ERROR_EVERY === 0 && i !== 0

  // input_preview keys mirror what qa_answer_v1's display_dimensions.header_fields
  // read: input_preview.qa.question / .topic / .difficulty (alias "qa").
  const base: GenericResultRecord = {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    task_id: taskId,
    experiment_id: EXPERIMENT_ID,
    input_refs: { qa: id },
    input_preview: {
      qa: {
        question: `Synthetic perf question #${i}: in the field of ${topic}, what is fact number ${i}? (difficulty: ${difficulty})`,
        reference_answer: `Reference answer ${i} for ${topic}.`,
        topic,
        difficulty,
      },
    },
    status: "success",
    latency_ms: 200 + (i % 50) * 7,
    model: MODEL,
    timestamp: new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + i * 1000).toISOString(),
    input_tokens: 120 + (i % 40),
    output_tokens: 60 + (i % 30),
    cost_value: Number((0.0003 + (i % 25) * 0.00001).toFixed(6)),
    cost_currency: "USD",
  }

  if (isError) {
    return {
      ...base,
      status: "error",
      error: `Synthetic upstream failure for ${taskId}: simulated 503 from gateway after 2 retries (perf fixture).`,
    }
  }

  const answer = `Answer to perf question #${i} about ${topic}. ` +
    "This is a deliberately verbose answer so each glass card carries realistic " +
    "text density: multiple clauses, a few numbers (" + i + ", " + (i * 2) + ", " +
    (i * 3) + "), and enough length to exercise text layout inside the thin glass " +
    "card body while scrolling the long list."
  return {
    ...base,
    output: { answer, confidence: (i % 5) + 1 },
    raw_response: JSON.stringify({ answer, confidence: (i % 5) + 1 }),
  }
}

function main() {
  const dataDir = path.join(process.cwd(), "data")
  const experimentsDir = path.join(dataDir, "experiments")
  const resultsDir = path.join(dataDir, "results", EXPERIMENT_ID)
  fs.mkdirSync(experimentsDir, { recursive: true })
  fs.mkdirSync(resultsDir, { recursive: true })

  const now = new Date().toISOString()
  const experiment = {
    id: EXPERIMENT_ID,
    name: "Glass perf fixture · 300-row single_list",
    created_at: now,
    updated_at: now,
    schema_id: SCHEMA_ID,
    // No display_id → display-inference → single_list (one GlassCardThin per row).
    model: MODEL,
    temperature: 1,
    max_tokens: 1024,
    api_config: { base_url: "", api_key: "" },
    prompt_template:
      "You are a helpful assistant answering short factual questions.\n\nQuestion: {{question}}",
    status: "completed",
    run_stats: {
      total_tasks: ROW_COUNT,
      completed_tasks: ROW_COUNT - Math.floor(ROW_COUNT / ERROR_EVERY),
      failed_tasks: Math.floor(ROW_COUNT / ERROR_EVERY),
      started_at: now,
      finished_at: now,
    },
    notes: "Synthetic fixture generated by scripts/perf-fixture.ts for e2e/glass-perf.spec.ts. Safe to delete.",
  }

  fs.writeFileSync(
    path.join(experimentsDir, `${EXPERIMENT_ID}.json`),
    JSON.stringify(experiment, null, 2),
  )

  const lines: string[] = []
  for (let i = 0; i < ROW_COUNT; i++) {
    lines.push(JSON.stringify(makeRow(i)))
  }
  fs.writeFileSync(path.join(resultsDir, "results.jsonl"), lines.join("\n") + "\n")

  const errorRows = lines.filter(l => l.includes('"status":"error"')).length
  console.log(
    `[perf-fixture] wrote ${ROW_COUNT} rows (${errorRows} error) for experiment ` +
    `"${EXPERIMENT_ID}" (schema ${SCHEMA_ID}) → /experiments/${EXPERIMENT_ID}`,
  )
}

main()
