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
 *   - cleans up in afterAll
 *
 * Reuses existing models from data/llm-config.json (no PATCH needed):
 *   - gemini-31-pro (no vision_capable flag → falsy)
 *   - opus-46-anthropic (vision_capable: true)
 * If your local config differs the test auto-skips Case C with a clear
 * message rather than mutating shared state.
 */

const FIXTURE_EXP_ID = "image_gen_v1_smoke"
const FIXTURE_TASK_ID = "smoke-task-1"

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
  let nonVisionModelId: string | null = null
  let visionModelId: string | null = null
  let sessionId: string | null = null

  test.beforeAll(async ({ request }) => {
    writeFixtures()

    // Discover available models from the live config (don't mutate it)
    const cfgResp = await request.get("/api/llm-config")
    expect(cfgResp.status(), "GET /api/llm-config must succeed").toBe(200)
    const cfg = (await cfgResp.json()) as {
      models: Array<{ id: string; copilot_enabled?: boolean; vision_capable?: boolean }>
    }
    for (const m of cfg.models) {
      if (!m.copilot_enabled) continue
      if (m.vision_capable === true && !visionModelId) visionModelId = m.id
      if (m.vision_capable !== true && !nonVisionModelId) nonVisionModelId = m.id
    }

    // We need at least a non-vision copilot-enabled model for cases A/B/D.
    expect(
      nonVisionModelId,
      "test fixture requires at least one non-vision copilot-enabled model in data/llm-config.json",
    ).not.toBeNull()

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
    // Best-effort: delete the session we created. If the API doesn't expose
    // delete, leave it — sessions are namespaced under data/copilot/sessions/
    // and don't pollute prod data.
    if (sessionId) {
      await request
        .delete(`/api/copilot/sessions/${sessionId}`)
        .catch(() => {})
    }
  })

  test("Case A — non-vision model + image task_result context → 400", async ({ request }) => {
    expect(sessionId).not.toBeNull()
    expect(nonVisionModelId).not.toBeNull()

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
    expect(nonVisionModelId).not.toBeNull()

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
    test.skip(
      visionModelId === null,
      "no vision_capable copilot model configured in data/llm-config.json — skip rather than mutate shared state",
    )

    const resp = await request.post(`/api/copilot/sessions/${sessionId}/chat`, {
      data: {
        user_message: "describe this image please",
        model_id: visionModelId!,
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
    expect(nonVisionModelId).not.toBeNull()

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
