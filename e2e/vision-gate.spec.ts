import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * E2E for spec §3.3 layer 2 vision gate (PR fix/copilot-vision-defense-cleanup).
 *
 * Validates that POST /api/copilot/sessions/{id}/chat:
 *   - rejects with 400 when the selected model is NOT vision_capable AND
 *     the request body carries image-bearing contexts (task_result with an
 *     image schema field, or task_field with field_type:'image_url')
 *   - allows the request through when the model IS vision_capable, OR the
 *     contexts contain no image-bearing fields, OR contexts is empty
 *
 * API-level only (request fixture, no browser) — we don't need to validate
 * the LLM call itself; we only assert whether the gate fires before the
 * stream starts.
 *
 * Fixture strategy:
 *   - reuses seeded `image_gen_v1` schema (output has image_url field)
 *   - writes a fixture experiment `image_gen_v1_smoke` + a single-row
 *     results.jsonl so collectImageRefs has real data to walk
 *   - self-provisions two test fixture LLM models via PUT /api/llm-config
 *     (one non-vision, one vision_capable=true) so the test runs on a clean
 *     CI environment without depending on user-configured models
 *   - cleans up fixtures + restores original llm-config in afterAll
 *
 * Fixture model IDs:
 *   - vision-gate-test-no-vision (no vision_capable flag → falsy)
 *   - vision-gate-test-vision-capable (vision_capable: true)
 */

const FIXTURE_EXP_ID = "image_gen_v1_smoke"
const FIXTURE_TASK_ID = "smoke-task-1"
const FIXTURE_NO_VISION_MODEL_ID = "vision-gate-test-no-vision"
const FIXTURE_VISION_MODEL_ID = "vision-gate-test-vision-capable"

interface ModelConfigShape {
  id: string
  name: string
  model: string
  api_format: "openai" | "anthropic"
  base_url: string
  api_key: string
  copilot_enabled?: boolean
  vision_capable?: boolean
}

interface LlmConfigShape {
  models: ModelConfigShape[]
  active_model_id?: string
}

function dataDir() {
  return path.join(process.cwd(), "data")
}

function fixtureExperimentPath() {
  return path.join(dataDir(), "experiments", `${FIXTURE_EXP_ID}.json`)
}

function fixtureResultsDir() {
  return path.join(dataDir(), "results", FIXTURE_EXP_ID)
}

function fixtureResultsFile() {
  return path.join(fixtureResultsDir(), "results.jsonl")
}

function writeFixtures() {
  // Fixture experiment pointing at seeded image_gen_v1 schema
  fs.mkdirSync(path.dirname(fixtureExperimentPath()), { recursive: true })
  fs.writeFileSync(
    fixtureExperimentPath(),
    JSON.stringify(
      {
        id: FIXTURE_EXP_ID,
        name: "vision-gate-smoke (auto-fixture, safe to delete)",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        copy_type: "image_gen",
        model: "fixture-model",
        temperature: 1,
        max_tokens: 4096,
        api_config: { base_url: "http://x", api_key: "x" },
        prompt_template: "{{prompt}}",
        status: "completed",
        run_stats: {
          total_tasks: 1,
          completed_tasks: 1,
          failed_tasks: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
        schema_id: "image_gen_v1",
      },
      null,
      2,
    ),
  )

  // Fixture result with image_url + caption (string) fields filled
  fs.mkdirSync(fixtureResultsDir(), { recursive: true })
  const result = {
    schema_id: "image_gen_v1",
    schema_version: 1,
    task_id: FIXTURE_TASK_ID,
    experiment_id: FIXTURE_EXP_ID,
    input_refs: { item: "fixture-1" },
    input_preview: { "item.prompt": "a fixture prompt", "item.category": "object" },
    output: {
      caption: "a small fixture caption",
      image_url: "/api/results/" + FIXTURE_EXP_ID + "/images/missing.png",
    },
    status: "success",
    raw_response: "{}",
    latency_ms: 1,
    model: "fixture-model",
    timestamp: new Date().toISOString(),
  }
  fs.writeFileSync(fixtureResultsFile(), JSON.stringify(result) + "\n")
}

function clearFixtures() {
  if (fs.existsSync(fixtureExperimentPath())) fs.rmSync(fixtureExperimentPath())
  if (fs.existsSync(fixtureResultsDir())) {
    fs.rmSync(fixtureResultsDir(), { recursive: true, force: true })
  }
}

test.describe("vision gate", () => {
  // Cases share the fixture llm-config + session created in beforeAll. With
  // playwright.config.ts having `fullyParallel: true`, default behavior would
  // run the 4 cases concurrently, racing on the global /api/llm-config state.
  // Force serial within this describe so beforeAll → A → B → C → D → afterAll
  // is a single linear chain.
  test.describe.configure({ mode: "serial" })

  const nonVisionModelId: string = FIXTURE_NO_VISION_MODEL_ID
  const visionModelId: string = FIXTURE_VISION_MODEL_ID
  let sessionId: string | null = null
  let originalConfig: LlmConfigShape | null = null

  test.beforeAll(async ({ request }) => {
    writeFixtures()

    // Snapshot live llm-config so we can restore it in afterAll. Then PUT a
    // config that PRESERVES existing models + APPENDS our two test fixture
    // models. This makes the test self-sufficient on a clean CI environment
    // (no models seeded) while not stomping on a developer's local config.
    const cfgResp = await request.get("/api/llm-config")
    expect(cfgResp.status(), "GET /api/llm-config must succeed").toBe(200)
    originalConfig = (await cfgResp.json()) as LlmConfigShape

    const fixtureModels: ModelConfigShape[] = [
      {
        id: FIXTURE_NO_VISION_MODEL_ID,
        name: "Vision Gate Test (no vision)",
        model: "fixture-test-model",
        api_format: "openai",
        base_url: "http://localhost:1",
        api_key: "test-fixture-key",
        copilot_enabled: true,
        // vision_capable intentionally omitted (falsy)
      },
      {
        id: FIXTURE_VISION_MODEL_ID,
        name: "Vision Gate Test (vision capable)",
        model: "fixture-test-model",
        api_format: "openai",
        base_url: "http://localhost:1",
        api_key: "test-fixture-key",
        copilot_enabled: true,
        vision_capable: true,
      },
    ]

    // Defensive: if a previous run crashed and left fixture models behind,
    // strip them out of the existing list before appending fresh ones.
    const existingFiltered = (originalConfig.models ?? []).filter(
      (m) => m.id !== FIXTURE_NO_VISION_MODEL_ID && m.id !== FIXTURE_VISION_MODEL_ID,
    )

    const putResp = await request.put("/api/llm-config", {
      data: {
        models: [...existingFiltered, ...fixtureModels],
        // Preserve user's active selection if any; don't promote a fixture model
        active_model_id: originalConfig.active_model_id,
      },
    })
    expect(putResp.status(), "PUT /api/llm-config must succeed").toBe(200)

    // Create one session shared by all 4 cases
    const sessResp = await request.post("/api/copilot/sessions", {
      data: { title: "vision-gate-test" },
    })
    expect(sessResp.status()).toBe(200)
    const sess = (await sessResp.json()) as { id: string }
    sessionId = sess.id
  })

  test.afterAll(async ({ request }) => {
    clearFixtures()
    // Restore original llm-config (drops our two fixture models)
    if (originalConfig) {
      await request.put("/api/llm-config", { data: originalConfig }).catch(() => {})
    }
    // Best-effort: delete the session we created.
    if (sessionId) {
      await request
        .delete(`/api/copilot/sessions/${sessionId}`)
        .catch(() => {})
    }
  })

  test("Case A — non-vision model + image task_result context → 400", async ({ request }) => {
    expect(sessionId).not.toBeNull()

    const resp = await request.post(`/api/copilot/sessions/${sessionId}/chat`, {
      data: {
        user_message: "describe this image please",
        model_id: nonVisionModelId,
        contexts: [
          {
            tag: 1,
            type: "task_result",
            id: FIXTURE_TASK_ID,
            extra: { experiment_id: FIXTURE_EXP_ID },
          },
        ],
      },
      // We expect a quick 400 — don't wait the full LLM timeout
      timeout: 15_000,
    })

    expect(resp.status(), "expected 400 from vision gate").toBe(400)
    const body = (await resp.json()) as { error?: string }
    expect(body.error ?? "", "error message should mention vision_capable").toMatch(
      /vision_capable/i,
    )
  })

  test("Case B — non-vision model + non-image task_field context → not 400", async ({
    request,
  }) => {
    expect(sessionId).not.toBeNull()

    const resp = await request.post(`/api/copilot/sessions/${sessionId}/chat`, {
      data: {
        user_message: "summarize the caption",
        model_id: nonVisionModelId,
        // task_field targeting the caption (string) field — gate must allow
        contexts: [
          {
            tag: 1,
            type: "task_field",
            id: FIXTURE_TASK_ID,
            extra: {
              experiment_id: FIXTURE_EXP_ID,
              field: "caption",
              field_type: "string",
            },
          },
        ],
      },
      timeout: 15_000,
    })

    // Whatever happens downstream (LLM call may fail without real creds),
    // status must NOT be the 400 from our gate. The route returns
    // text/event-stream when it accepts the request.
    expect(resp.status(), `unexpected ${resp.status()}: ${await safeText(resp)}`).not.toBe(400)
    expect(resp.status()).toBe(200)
    expect(resp.headers()["content-type"] ?? "").toContain("text/event-stream")
  })

  test("Case C — vision_capable model + image context → not 400", async ({ request }) => {
    expect(sessionId).not.toBeNull()

    const resp = await request.post(`/api/copilot/sessions/${sessionId}/chat`, {
      data: {
        user_message: "describe this image please",
        model_id: visionModelId,
        contexts: [
          {
            tag: 1,
            type: "task_result",
            id: FIXTURE_TASK_ID,
            extra: { experiment_id: FIXTURE_EXP_ID },
          },
        ],
      },
      timeout: 15_000,
    })

    expect(resp.status(), `unexpected ${resp.status()}: ${await safeText(resp)}`).not.toBe(400)
    expect(resp.status()).toBe(200)
    expect(resp.headers()["content-type"] ?? "").toContain("text/event-stream")
  })

  test("Case D — empty contexts + non-vision model → not 400", async ({ request }) => {
    expect(sessionId).not.toBeNull()

    const resp = await request.post(`/api/copilot/sessions/${sessionId}/chat`, {
      data: {
        user_message: "hi",
        model_id: nonVisionModelId,
        contexts: [],
      },
      timeout: 15_000,
    })

    expect(resp.status(), `unexpected ${resp.status()}: ${await safeText(resp)}`).not.toBe(400)
    expect(resp.status()).toBe(200)
    expect(resp.headers()["content-type"] ?? "").toContain("text/event-stream")
  })
})

async function safeText(resp: import("@playwright/test").APIResponse): Promise<string> {
  try {
    return (await resp.text()).slice(0, 200)
  } catch {
    return "<unreadable>"
  }
}
