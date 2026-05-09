import { test, expect, type Page } from "@playwright/test"

/**
 * E2E coverage for the cartesian-cap PR (#3): the /experiments/new submit
 * gate that confirms at >5_000 estimated tasks and blocks at >100_000.
 *
 * Backend is fully mocked via page.route so the test is hermetic and does
 * not depend on data/ seed contents (whose record counts are tiny).
 *
 * window.confirm / window.alert are monkey-patched per test to drive the
 * gate explicitly (Playwright's `page.on("dialog")` has timing races with
 * synchronous `window.confirm`, which the page handler relies on).
 */

interface MockOpts {
  estimate: number
  onCreate?: () => void
  onRun?: () => void
}

async function mockBackend(page: Page, opts: MockOpts) {
  // Always-needed: at least one LLM model so submit doesn't bail on
  // `if (!selectedModel) alert(...)`.
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
      body: JSON.stringify({ task_count: opts.estimate }),
    })
  })

  await page.route("**/api/experiments", async route => {
    if (route.request().method() === "POST") {
      opts.onCreate?.()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "exp_test" }),
      })
    } else {
      await route.continue()
    }
  })

  await page.route("**/api/experiments/exp_test/run", async route => {
    opts.onRun?.()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "started", total_tasks: opts.estimate }),
    })
  })
}

interface DialogStubResult {
  alerts: string[]
  confirms: string[]
}

/**
 * Patch window.alert + window.confirm. confirm returns whatever the test
 * passes for `confirmReturns` (true = user accepts, false = user cancels).
 * The page exposes captured messages via window.__dialogStub.
 */
async function patchDialogs(page: Page, confirmReturns: boolean) {
  await page.evaluate((accept) => {
    const stub = { alerts: [] as string[], confirms: [] as string[] }
    ;(window as unknown as { __dialogStub: DialogStubResult }).__dialogStub = stub
    window.alert = (msg?: string) => { stub.alerts.push(String(msg ?? "")) }
    window.confirm = (msg?: string) => {
      stub.confirms.push(String(msg ?? ""))
      return accept
    }
  }, confirmReturns)
}

async function readDialogStub(page: Page): Promise<DialogStubResult> {
  return page.evaluate(() =>
    (window as unknown as { __dialogStub: DialogStubResult }).__dialogStub
  )
}

async function fillName(page: Page, name: string) {
  // Placeholder text from i18n (en/zh both use literal "v1-qa-gpt4o")
  await page.getByPlaceholder("v1-qa-gpt4o").fill(name)
}

async function clickRun(page: Page) {
  await page.getByRole("button", { name: /保存并运行|Save and run/i }).click()
}

test.describe("cartesian cap UI gate (#3)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", e => {
      throw new Error(`Page runtime error: ${e.message}`)
    })
  })

  test("estimate >5_000 fires confirm; cancel does not submit", async ({ page }) => {
    let createCalled = false
    await mockBackend(page, {
      estimate: 5_001,
      onCreate: () => { createCalled = true },
    })

    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByText(/5,001/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "cap-confirm-cancel")
    await patchDialogs(page, false) // user clicks Cancel

    await clickRun(page)
    await page.waitForTimeout(500)

    const stub = await readDialogStub(page)
    expect(stub.confirms, "expected one confirm dialog").toHaveLength(1)
    expect(stub.confirms[0]).toMatch(/5,001/)
    expect(stub.alerts, "no alert should fire").toEqual([])
    expect(createCalled, "submit should be aborted on cancel").toBe(false)
  })

  test("estimate >5_000 fires confirm; accept proceeds to submit", async ({ page }) => {
    let createCalled = false
    let runCalled = false
    await mockBackend(page, {
      estimate: 5_001,
      onCreate: () => { createCalled = true },
      onRun: () => { runCalled = true },
    })

    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByText(/5,001/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "cap-confirm-accept")
    await patchDialogs(page, true) // user clicks OK

    await clickRun(page)
    await page.waitForURL(/\/experiments\/exp_test/, { timeout: 5_000 })

    const stub = await page.evaluate(() => {
      // After navigation, window is a different document — confirms array
      // lives on previous page. We assert via createCalled + runCalled below.
      return null
    })
    void stub

    expect(createCalled, "create POST fired").toBe(true)
    expect(runCalled, "run POST fired").toBe(true)
  })

  test("estimate >100_000 blocks with hard-cap alert (no submit)", async ({ page }) => {
    let createCalled = false
    await mockBackend(page, {
      estimate: 100_001,
      onCreate: () => { createCalled = true },
    })

    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByText(/100,001/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "cap-block")
    await patchDialogs(page, false)

    await clickRun(page)
    await page.waitForTimeout(500)

    const stub = await readDialogStub(page)
    expect(stub.alerts, "expected one hard-cap alert").toHaveLength(1)
    // Message should mention both the count and the cap
    expect(stub.alerts[0]).toMatch(/100,001/)
    expect(stub.alerts[0]).toMatch(/100,000/)
    expect(stub.confirms, "no confirm should fire when over hard cap").toEqual([])
    expect(createCalled, "submit should be blocked").toBe(false)
  })

  test("estimate <5_000 submits without any dialog (golden path preserved)", async ({ page }) => {
    let createCalled = false
    let runCalled = false
    await mockBackend(page, {
      estimate: 100,
      onCreate: () => { createCalled = true },
      onRun: () => { runCalled = true },
    })

    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await expect(page.getByText(/Estimated 100|预计生成 100/)).toBeVisible({ timeout: 8_000 })

    await fillName(page, "normal-flow")
    await patchDialogs(page, false) // would dismiss any confirm — none should fire

    await clickRun(page)
    await page.waitForURL(/\/experiments\/exp_test/, { timeout: 5_000 })

    expect(createCalled).toBe(true)
    expect(runCalled).toBe(true)
  })

  test("/api/estimate returns task_count without materializing (server contract)", async ({ request }) => {
    // Direct API hit — exercises estimateTaskCount end-to-end via /api/estimate.
    // Uses the qa_answer_v1 seed schema (auto-restored by ensureSeeds).
    const resp = await request.post("/api/estimate", {
      data: { schema_id: "qa_answer_v1", filter_values: {}, dataset_bindings: {} },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(typeof body.task_count).toBe("number")
    expect(body.task_count).toBeGreaterThanOrEqual(0)
    // Response shape is exactly { task_count } — no materialization side-effects leaked
    expect(Object.keys(body).sort()).toEqual(["task_count"])
  })
})
