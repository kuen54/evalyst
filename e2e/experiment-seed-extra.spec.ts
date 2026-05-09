import { test, expect, type Page } from "@playwright/test"

/**
 * Supplementary E2E coverage for feat/experiment-seed (#8). The base spec
 * (e2e/experiment-seed.spec.ts) covers: render + integer 42 + empty + server
 * roundtrip with seed=7. The unit suite (llm-client-seed.test.ts) covers
 * buildRequestBody-level branching for OpenAI vs Anthropic across 0/42/undefined.
 *
 * What this file adds (UI-layer real-world edge cases that neither the base
 * E2E nor the unit suite touches):
 *   1. Negative seed     — `<Input type="number">` may filter "-"; verify it
 *                          still flows. (Unit covers builder, not React state.)
 *   2. Zero seed         — JS-falsy edge case; an `if (seedNum)` UI bug would
 *                          drop a legitimate seed=0. Unit covers body, not
 *                          UI submit gating around `if (seedNum !== undefined)`.
 *   3. Decimal seed      — `Number.isFinite(3.14)` is true, so the form's
 *                          "must be number" gate passes; verify the float is
 *                          POSTed as-is (no silent Math.floor by UI/state).
 *   4. Very large seed   — int32-max boundary; verify no JS-engine scientific
 *                          notation (`2147483647` not `2.147e9`) reaches body.
 *   5. State stability   — fill seed, then change other fields (notes / max
 *                          tokens); verify Seed Input value AND POST body
 *                          retain the user's seed (regression vector: a stray
 *                          useEffect hooked on modelId already resets temp /
 *                          max_tokens; seed must NOT participate).
 *   6. Anthropic submit  — Anthropic-format model selected + seed=99: POST
 *                          succeeds (200), body still contains seed:99.
 *                          Server-side drop happens at the LLM call layer
 *                          (covered by unit), not at the /api/experiments
 *                          create-config layer — this distinction is exactly
 *                          what makes the warn surface to operators.
 *
 * Excluded by design:
 *   - Detail page seed visibility — confirmed via grep that
 *     src/app/experiments/[id]/page.tsx does NOT render config.seed anywhere;
 *     no test here, reported as a follow-up gap instead of a failing test.
 *
 * Same hermetic mocking pattern as e2e/experiment-seed.spec.ts: page.route
 * stubs all backend endpoints; window.confirm/alert monkey-patched so we drive
 * dialogs without Playwright dialog races.
 */

interface MockOpts {
  estimate?: number
  apiFormat?: "openai" | "anthropic"
  onCreate?: (body: unknown) => void
  onRun?: () => void
}

async function mockBackend(page: Page, opts: MockOpts = {}) {
  const apiFormat = opts.apiFormat ?? "openai"
  await page.route("**/api/llm-config", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{
          id: "test_model",
          name: apiFormat === "anthropic" ? "Test Anthropic" : "Test OpenAI",
          model: apiFormat === "anthropic" ? "claude-test" : "gpt-test",
          api_format: apiFormat,
          base_url: "https://example.com",
          api_key: apiFormat === "anthropic" ? "sk-ant-test" : "sk-test",
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
        body: JSON.stringify({ id: "exp_seed_extra" }),
      })
    } else {
      await route.continue()
    }
  })

  await page.route("**/api/experiments/exp_seed_extra/run", async route => {
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

/**
 * Wait for the POST /api/experiments response (the moment the route handler
 * fulfills + onCreate has run), rather than waiting on URL navigation. The
 * page does `await fetch(...).then(r => r.json())` then `router.push`, and on
 * a busy dev server (Next.js HMR / first-compile of the detail page chunk)
 * the navigation can lag past 5s even though the POST has long completed —
 * which is what the assertion actually cares about. This is more robust under
 * sequential-test load than waitForURL.
 */
async function clickRunAndWaitForCreate(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/experiments") && r.request().method() === "POST",
      { timeout: 15_000 },
    ),
    clickRun(page),
  ])
  return response
}

function seedInput(page: Page) {
  return page.getByPlaceholder(/留空 = 随机|Leave blank/)
}

/**
 * Wait until the form is fully hydrated. The seed Input renders synchronously
 * (before fetches resolve), but the submit handler bails on `if (!selectedModel)`
 * until /api/llm-config has populated the models list. We wait for the estimate
 * text to appear, which is the LAST piece of state set after schemas + datasets
 * + llm-config + estimate all resolve. Without this, submit can fire while
 * models are still empty → the page silently alerts "no models" instead of
 * POSTing /api/experiments → waitForResponse times out.
 */
async function waitForFormReady(page: Page, expectedTaskCount: number) {
  // The estimate text format is "预计生成 N 个任务" / "Estimated N tasks"
  await expect(page.getByText(
    new RegExp(`(预计生成 ${expectedTaskCount} 个任务|Estimated ${expectedTaskCount} task)`),
  )).toBeVisible({ timeout: 15_000 })
  // Belt-and-suspenders: also wait for the model name field to populate, which
  // is what actually unblocks the submit gate.
  await expect(page.locator("input[value='gpt-test']").or(page.locator("input[value='claude-test']")))
    .toBeVisible({ timeout: 5_000 })
}

test.describe("experiment seed UI – supplementary edge cases (#8)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", e => {
      throw new Error(`Page runtime error: ${e.message}`)
    })
  })

  test("negative seed (-1) flows through to POST body", async ({ page }) => {
    // WHY: existing E2E only tests seed=42. <Input type="number"> historically
    // strips/blocks "-" in some browser locales; this verifies React state
    // captures the literal "-1" string, the form's Number("-1") = -1, and the
    // value reaches the POST body. The unit suite tests builder branching,
    // not the UI input's character-class filter.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-negative")
    await seedInput(page).fill("-1")
    await patchDialogs(page, true)

    await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect((captured as unknown as { seed?: number }).seed).toBe(-1)
  })

  test("zero seed (0) reaches POST body and is NOT dropped as falsy", async ({ page }) => {
    // WHY: 0 is JS-falsy. An accidental `if (seedNum) { body.seed = seedNum }`
    // anywhere in the submit pipeline would silently drop a legitimate seed=0.
    // Existing UI-level test only covers truthy 42. Unit suite covers
    // buildRequestBody for seed=0 at the LLM call layer (one step downstream),
    // not the experiment-create POST gating where the bug would actually live.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-zero")
    await seedInput(page).fill("0")
    await patchDialogs(page, true)

    await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect("seed" in (captured as unknown as object)).toBe(true)
    expect((captured as unknown as { seed?: number }).seed).toBe(0)
  })

  test("decimal seed (3.14) passes the finite-number gate and POSTs the float as-is", async ({ page }) => {
    // WHY: `Number.isFinite(3.14) === true`, so the alert("must be a number")
    // gate does not trip. The contract is "UI does not silently round" — if
    // a user types a float, downstream gateway rejection (400) is acceptable
    // and surfaces in result.error; silent UI rounding hides the user mistake.
    // Existing tests don't cover the float-passes-gate-and-reaches-body path.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-decimal")
    await seedInput(page).fill("3.14")
    await patchDialogs(page, true)

    await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect((captured as unknown as { seed?: number }).seed).toBe(3.14)
  })

  test("very large seed (int32-max) reaches POST body without scientific-notation rounding", async ({ page }) => {
    // WHY: integers near 2^31 occasionally get serialized as "2.147e9" by
    // toString in stringification edge cases; verify we transport the exact
    // integer. Also doubles as a sanity test that no max-int clamping was
    // introduced anywhere along the pipeline.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-int32-max")
    await seedInput(page).fill("2147483647")
    await patchDialogs(page, true)

    await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect((captured as unknown as { seed?: number }).seed).toBe(2147483647)
  })

  test("seed value stable when user edits unrelated fields after typing it", async ({ page }) => {
    // WHY: src/app/experiments/new/page.tsx has a useEffect on [modelId,
    // selectedModel] that overwrites temperature + max_tokens when model
    // changes. Any future "and also reset seed on model change" would silently
    // drop user input. Mid-form edits to notes / max_tokens / temperature
    // must NOT clobber a typed seed; verify both the input value and the
    // submitted body still carry the originally-entered seed.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })
    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-stability")
    await seedInput(page).fill("42")

    // Now perturb other fields — notes Input + max_tokens Input. These should
    // not touch seed state.
    await page.getByPlaceholder(/v1-qa-gpt4o/).fill("seed-stability-edited")
    // max_tokens is the second number input on the page (first is the Input
    // of `model` text, but it's not type=number; max_tokens is type=number).
    // Use getByLabel for resilience.
    const maxTokensLabel = page.locator("label").filter({ hasText: /max[_ ]?tokens/i }).first()
    if (await maxTokensLabel.count()) {
      const maxTokensInput = maxTokensLabel.locator("xpath=following::input[1]")
      await maxTokensInput.fill("8192")
    }

    // Re-read the seed input AFTER perturbation
    await expect(seedInput(page)).toHaveValue("42")

    await patchDialogs(page, true)
    await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect((captured as unknown as { seed?: number }).seed).toBe(42)
  })

  test("Anthropic-format model + seed=99: create POST still includes seed (server-side drop is downstream)", async ({ page }) => {
    // WHY: the warn-and-drop happens inside llm-client.buildRequestBody, which
    // runs at task-execution time, not at experiment-create time. So the
    // POST /api/experiments body MUST still carry seed:99 — the server
    // persists it onto ExperimentConfig, and the warn fires later when each
    // task makes the actual LLM call. This distinction is what gives the
    // operator a chance to see the warn at run time. Unit covers builder
    // branching; this verifies the form does not preemptively gate Anthropic
    // submissions on seed presence.
    let captured: Record<string, unknown> | null = null
    await mockBackend(page, {
      apiFormat: "anthropic",
      onCreate: (body) => { captured = body as Record<string, unknown> },
    })

    await page.goto("/experiments/new", { waitUntil: "domcontentloaded" })
    await waitForFormReady(page, 5)

    await fillName(page, "seed-anthropic")
    await seedInput(page).fill("99")
    await patchDialogs(page, true)

    const response = await clickRunAndWaitForCreate(page)

    expect(captured).not.toBeNull()
    expect((captured as unknown as { seed?: number }).seed).toBe(99)
    // Note: the warn surfaces from llm-client at task-execution time, not from
    // this UI submit path. We assert the create flow succeeded end-to-end.
    expect(response.status()).toBe(200)
  })
})
