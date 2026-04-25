import { test, expect } from "@playwright/test"

/**
 * Minimal smoke: each key route loads without throwing and renders the
 * sidebar chrome. Data-touching flows (create / run) live in a later
 * spec so this one can stay under a few seconds even on cold CI.
 */

const SIDEBAR_TITLE_RE = /文案批量评测|Batch Eval/i

const ROUTES: { path: string; expectText: RegExp }[] = [
  { path: "/", expectText: /实验列表|Experiments/i },
  { path: "/experiments/new", expectText: /新建实验|New Experiment/i },
  { path: "/compare", expectText: /实验对比|Compare/i },
  { path: "/settings/llm", expectText: /LLM/i },
  { path: "/settings/datasets", expectText: /数据集|Datasets/i },
  { path: "/settings/templates", expectText: /评测任务|Tasks|Templates/i },
  { path: "/settings/displays", expectText: /展示|Displays/i },
  { path: "/settings/rubrics", expectText: /评分|Rubric/i },
]

for (const route of ROUTES) {
  test(`loads ${route.path}`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))

    const resp = await page.goto(route.path, { waitUntil: "domcontentloaded" })
    expect(resp?.status(), `HTTP status for ${route.path}`).toBeLessThan(400)

    // Sidebar chrome should always be present — proves shell rendered.
    await expect(page.getByText(SIDEBAR_TITLE_RE).first()).toBeVisible()
    // Page-specific anchor — proves the route's own tree rendered.
    await expect(page.getByText(route.expectText).first()).toBeVisible()

    expect(errors, `runtime errors on ${route.path}`).toEqual([])
  })
}

test("skills download endpoint returns SKILL.md", async ({ request }) => {
  // Regression for the docker-skills fix in 5383de5: ensures /api/skills/{name}
  // serves the markdown body and not a 404.
  const resp = await request.get("/api/skills/batch-eval-dataset")
  expect(resp.status()).toBe(200)
  expect(resp.headers()["content-type"]).toContain("text/markdown")
  const body = await resp.text()
  expect(body).toMatch(/^---/) // SKILL.md frontmatter
  expect(body).toMatch(/batch-eval-dataset/)
})
