import { test, expect, type Page } from "@playwright/test"

/**
 * E2E coverage for feat/experiment-seed (#8): the optional Seed input on
 * /experiments/new. Verifies the integer flows through to POST /api/experiments
 * body, and that empty input omits the key entirely (matches buildRequestBody
 * "skip undefined" contract).
 *
 * Backend mocked via page.route. Same monkey-patch pattern as cartesian-cap.
 */

interface MockOpts {
  estimate?: number
  onCreate?: (body: unknown) => void
  onRun?: () => void
}

async function mockBackend(page: Page, opts: MockOpts = {}) {
  await page.route("**/api/llm-config", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{
          id: "test_model",
          name: "Test Model",
          model: "test-model",
          api_format: "openai",
          base_url: "https://example.com",
          api_key: "sk-test",
          default_temperature: 1,
          default_max_tokens: 4096,
        }],
        active_model_id: "test_model",
      }),
    })
  })

  await page.route("**/api/estimate", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ task_count: opts.estimate ?? 5 }),
    })
  })

  await page.route("**/api/experiments", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON()
      opts.onCreate?.(body)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "exp_seed_test" }),
      })
    } else {
      await route.continue()
    }
  })

  await page.route("**/api/experiments/exp_seed_test/run", async route => {
    opts.onRun?.()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "started", total_tasks: opts.estimate ?? 5 }),
    })
  })
}

async function patchDialogs(page: Page, confirmReturns: boolean) {
  await page.evaluate((accept) => {
    const stub = { alerts: [] as string[], confirms: [] as string[] }
    ;(window as unknown as { __dialogStub: typeof stub }).__dialogStub = stub
    window.alert = (msg?: string) => { stub.alerts.push(String(msg ?? "")) }
    window.confirm = (msg?: string) => {
      stub.confirms.push(String(msg ?? ""))
      return accept
    }
  }, confirmReturns)
}

async function fillName(page: Page, name: string) {
  await page.getByPlaceholder("v1-qa-gpt4o").fill(name)
}

async function clickRun(page: Page) {
  await page.getByRole("button", { name: /保存并运行|Save and run/i }).click()
}

test.describe("experiment seed UI gate (#8)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", e => {
      throw new Error(`Page runtime error: ${e.message}`)
    })
  })

  test("seed input rendered with hint text + placeholder", async ({ page }) => {
    await mockBackend(page)
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByText(/Seed \(可选\)|Seed \(optional\)/)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByPlaceholder(/留空 = 随机|Leave blank/)).toBeVisible()
    await expect(page.getByText(/OpenAI.*透传|OpenAI-format providers/)).toBeVisible()
  })

  test("integer seed flows to POST /api/experiments body", async ({ page }) => {
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByPlaceholder(/留空 = 随机|Leave blank/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "seed-flow")
    // Find the seed input by its placeholder
    await page.getByPlaceholder(/留空 = 随机|Leave blank/).fill("42")
    await patchDialogs(page, true)

    await clickRun(page)
    await page.waitForURL(/\/experiments\/exp_seed_test/, { timeout: 5_000 })

    expect(captured).not.toBeNull()
    expect((captured as { seed?: number }).seed).toBe(42)
  })

  test("empty seed input → 'seed' key OMITTED from POST body (not null/undefined)", async ({ page }) => {
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByPlaceholder(/留空 = 随机|Leave blank/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "no-seed-flow")
    // Do NOT touch the seed input — leave it empty
    await patchDialogs(page, true)

    await clickRun(page)
    await page.waitForURL(/\/experiments\/exp_seed_test/, { timeout: 5_000 })

    expect(captured).not.toBeNull()
    // Critical contract: omit the key entirely. Some downstream gateways 400
    // on null/undefined seed. The OpenAI buildRequestBody unit test enforces
    // the same on the lower layer; this test enforces the UI contributes
    // nothing on empty input.
    expect("seed" in (captured as object)).toBe(false)
  })

  test("POST /api/experiments stores seed on the created config (server-side end-to-end)", async ({ request }) => {
    // Direct API hit: real createExperiment + writeAtomic path. Uses the qa_answer_v1
    // seed schema. Asserts the returned config includes seed: 7. Cleanup follows.
    const create = await request.post("/api/experiments", {
      data: {
        name: "_seed-e2e-roundtrip",
        schema_id: "qa_answer_v1",
        prompt_template: "answer the question",
        model: "gpt-4o-mini",
        temperature: 1,
        max_tokens: 100,
        seed: 7,
      },
    })
    expect(create.status()).toBe(201)
    const body = await create.json()
    expect(body.seed).toBe(7)
    expect(typeof body.id).toBe("string")

    // Cleanup so this test is idempotent
    await request.delete(`/api/experiments/${body.id}`).catch(() => {})
  })
})
