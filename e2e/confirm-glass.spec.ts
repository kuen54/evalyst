import { test, expect, type Page } from "@playwright/test"

/**
 * Verify ConfirmDialog gets `data-glass-variant="thick"` when the copilot
 * panel is open and stays attribute-free when it is closed.
 *
 * Regression target: PR-2 of the r2-followup batch. Before the layout.tsx
 * Provider swap, ConfirmProvider wrapped CopilotStoreProvider — the <Dialog>
 * rendered inside ConfirmProvider's own subtree saw the createContext default
 * `{ open: false, width: 0 }` from CopilotShellContext, so DialogContent
 * always picked the non-glass branch even with the copilot panel visibly
 * open. See docs/superpowers/plans/2026-05-11-audit-r2-followup.md §PR-2.
 */

function arm(page: Page, sink: string[]) {
  page.on("pageerror", e => { sink.push(`pageerror: ${e.message}`) })
}

const MOD = process.platform === "darwin" ? "Meta" : "Control"

test("ConfirmDialog glass variant follows copilot open state", async ({ page }) => {
  const errors: string[] = []
  arm(page, errors)

  await page.goto("/settings/datasets", { waitUntil: "domcontentloaded" })

  // Hydration gate (same pattern as copilot-v2 / audit-cleanup-coverage):
  // toggle button only renders after CopilotStoreProvider's mount effect, the
  // same effect that registers the global ⌘K listener. Pressing before this
  // is a hydration race.
  await expect(
    page.getByRole("button", { name: /打开 Copilot|Open Copilot/i })
  ).toBeVisible({ timeout: 8_000 })

  // At least one seeded dataset card with a delete button must be present.
  const deleteButton = page.getByRole("button", { name: /^删除$|^Delete$/ }).first()
  await expect(deleteButton).toBeVisible({ timeout: 8_000 })

  const dialog = page.locator('[data-slot="dialog-content"]')
  const cancelButton = page.getByRole("button", { name: /^取消$|^Cancel$/ })

  // ── Case A — copilot CLOSED: dialog has no data-glass-variant ──
  await deleteButton.click()
  await expect(dialog).toBeVisible({ timeout: 4_000 })
  await expect(dialog).not.toHaveAttribute("data-glass-variant", /.+/)
  await cancelButton.click()
  await expect(dialog).toBeHidden({ timeout: 4_000 })

  // ── Open the copilot panel ──
  await page.keyboard.press(`${MOD}+k`)
  const panel = page.locator("aside[data-copilot-panel]")
  await expect(panel).toHaveAttribute("aria-hidden", "false", { timeout: 4_000 })

  // ── Case B — copilot OPEN: dialog gets data-glass-variant="thick" ──
  // This is the regression target. Pre-fix, attribute would be missing here
  // because DialogContent's useCopilotOpen() resolved to the default `false`.
  await deleteButton.click()
  await expect(dialog).toBeVisible({ timeout: 4_000 })
  await expect(dialog).toHaveAttribute("data-glass-variant", "thick")
  await cancelButton.click()
  await expect(dialog).toBeHidden({ timeout: 4_000 })

  expect(errors, "no runtime errors during ConfirmDialog glass test").toEqual([])
})
