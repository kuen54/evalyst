import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const COPILOT_DIR = path.join(process.cwd(), 'data', 'copilot')
const CACHE_STATS_PATH = path.join(COPILOT_DIR, 'cache-stats.jsonl')
const E2E_SEED_SESSION = 'e2e-seed-session'

// 第二条测对 cache-stats.jsonl 做 destructive 写：playwright fullyParallel 默认开，
// 多 worker 并发写文件会撕。强制本文件 serial。
test.describe.configure({ mode: 'serial' })

test.describe('Copilot v2.5 e2e', () => {
  test('chip preview shows manifest form (no input_preview leak)', async ({ page }) => {
    await page.goto('/')

    // 找到第一个实验卡 → 进详情。selector 排除 `/experiments/new`（顶部"新建实验"按钮）
    const firstExpLink = page.locator('a[href^="/experiments/exp_"]').first()
    await expect(firstExpLink).toBeVisible({ timeout: 10_000 })
    await firstExpLink.click()
    await page.waitForURL(/\/experiments\/[^/]+/)
    // 等结果列表 render（避免 data-copilot-context 还没挂出来时 locator 打空）
    await page.waitForLoadState('networkidle')

    // 拿一条 task_result 的 task_id（从首条 result 元素的 data-attr）
    const firstResult = page.locator('[data-copilot-context="task_result"]').first()
    await expect(firstResult).toBeVisible({ timeout: 15_000 })
    const taskId = await firstResult.getAttribute('data-copilot-context-id')
    expect(taskId).toBeTruthy()

    const expId = await page.evaluate(() => {
      const m = window.location.pathname.match(/\/experiments\/([^/]+)/)
      return m?.[1] ?? null
    })
    expect(expId).toBeTruthy()

    // 直接 fetch /api/copilot/contexts/resolve 校验响应形态——chip preview 在生产路径上消费同一个 API 响应。
    // 不依赖 DOM 上脆弱的 chip 展开按钮交互（依赖 chip rail 位置 / inspector 状态等）。
    const resolveResp = await page.request.post('/api/copilot/contexts/resolve', {
      data: {
        refs: [
          { tag: 1, type: 'task_result', id: taskId, extra: { experiment_id: expId } },
        ],
      },
    })
    expect(resolveResp.ok()).toBe(true)
    const body = await resolveResp.json()
    const data = body.resolved?.[0]?.data as Record<string, unknown>
    expect(data).toBeTruthy()
    expect(data.task_id).toBe(taskId)
    expect(data.input_preview).toBeUndefined()
    expect(data.input_refs).toBeUndefined()
    // system_message 也不应含 input_preview 字面字符串
    const systemMessage = body.system_message ?? ''
    expect(systemMessage).not.toContain('input_preview')
    expect(systemMessage).not.toContain('input_refs')
  })

  test('cache stats chip renders with seeded weekly data', async ({ page }) => {
    // 前置：在 data/copilot/cache-stats.jsonl 写一条最近的 stat
    fs.mkdirSync(COPILOT_DIR, { recursive: true })
    const stat = {
      session_id: E2E_SEED_SESSION,
      message_id: 'm-seed',
      ts: new Date().toISOString(),
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_tokens: 800,
      cache_read_tokens: 600,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }
    fs.appendFileSync(CACHE_STATS_PATH, JSON.stringify(stat) + '\n')

    try {
      await page.goto('/')

      // 开 copilot
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
      const panel = page.locator('[data-copilot-panel]')
      await expect(panel).toBeVisible({ timeout: 5000 })

      // CacheStatsChip 渲染条件：weekly.calls > 0 → 文字含 "Cache:"。chip 在 panel 内
      const chip = panel.getByTestId('cache-stats-chip')
      await expect(chip).toBeVisible({ timeout: 15000 })

      // chip 整体文字含百分号或 — 占位（确认 hit_rate 渲染）
      const chipText = await chip.textContent()
      expect(chipText).toMatch(/%|—/)
    } finally {
      // 清理 seed（避免污染下一次跑）
      try {
        const raw = fs.readFileSync(CACHE_STATS_PATH, 'utf-8')
        const filtered = raw
          .split('\n')
          .filter((l) => l.trim() && !l.includes(E2E_SEED_SESSION))
        fs.writeFileSync(CACHE_STATS_PATH, filtered.join('\n') + (filtered.length ? '\n' : ''))
      } catch {
        // 文件可能不存在或读失败，忽略
      }
    }
  })
})
