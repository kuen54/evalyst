import { test, expect } from "@playwright/test"

/**
 * v2 copilot smoke: verify the refactor's UI contract without needing an actual LLM.
 *
 * We mock the chat SSE endpoint so the panel can open and we can assert basic
 * structure. LLM-dependent tool-call-card variants (context / resource / retrieval /
 * write) are better covered by unit tests — here we only check non-crash + key
 * UI invariants that agent-driven refactoring tends to regress.
 */

test("root page loads and /api/copilot/sessions responds with sessions list", async ({ page, request }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))

  // Stub the chat SSE endpoint BEFORE navigating so it's in place for any
  // spontaneous requests the panel might make.
  await page.route("**/api/copilot/sessions/*/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ kind: "done" })}\n\n`,
    })
  })

  const resp = await page.goto("/", { waitUntil: "domcontentloaded" })
  expect(resp?.status(), "HTTP status for /").toBeLessThan(400)

  // Sanity: the sessions list API responds with the documented shape.
  const sessionsResp = await request.get("/api/copilot/sessions")
  expect(sessionsResp.status()).toBe(200)
  const sessionsBody = (await sessionsResp.json()) as { sessions: unknown[] }
  expect(Array.isArray(sessionsBody.sessions)).toBe(true)

  // No "preview LLM will see" panel should exist — it was removed in v2.
  // Check both the Chinese and English phrasings from the deleted i18n key.
  const previewCount =
    (await page.getByText("预览 LLM 将看到的 context").count()) +
    (await page.getByText(/Preview.*LLM.*see/i).count())
  expect(previewCount, "v2 removed the 'preview LLM will see' panel").toBe(0)

  // Cmd+K / Ctrl+K should toggle the copilot panel. Use the platform-appropriate
  // modifier — on linux / CI playwright runs, Control is correct.
  // Wait for hydration (toggle button only renders after CopilotStoreProvider's
  // mount effect, which is also where the ⌘K window listener is registered) —
  // pressing before that is a race that fails on slow boxes.
  await expect(
    page.getByRole("button", { name: /打开 Copilot|Open Copilot/i })
  ).toBeVisible({ timeout: 6_000 })
  const mod = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.press(`${mod}+k`)
  // Panel presence: the role='complementary'|aside with copilot title, or the
  // close button (aria-label points at copilot.close_btn translation).
  // We settle for any element containing "Copilot" text (header), which only
  // renders when the panel is mounted open.
  const hasCopilotUi = await page.getByText(/Copilot/i).first().isVisible().catch(() => false)
  expect(hasCopilotUi, "Copilot panel opens on Cmd+K / Ctrl+K").toBe(true)

  // Close with the same shortcut — panel should go back to collapsed state.
  await page.keyboard.press(`${mod}+k`)

  expect(errors, "no pageerror during navigation + panel toggle").toEqual([])
})
