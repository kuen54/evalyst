import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const COPILOT_DIR = path.join(process.cwd(), 'data', 'copilot')
const CACHE_STATS_PATH = path.join(COPILOT_DIR, 'cache-stats.jsonl')
const E2E_SEED_SESSION = 'e2e-seed-session'
const E2E_SEED_EXP = 'exp_e2e_v25_seed'

const EXP_DIR = path.join(process.cwd(), 'data', 'experiments')
const RESULTS_DIR = path.join(process.cwd(), 'data', 'results', E2E_SEED_EXP)

function seedExperiment() {
  fs.mkdirSync(EXP_DIR, { recursive: true })
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  // Minimal experiment json — a "completed" no-LLM fixture so the dashboard shows a link
  // and the detail page can render results rows with data-copilot-context.
  fs.writeFileSync(
    path.join(EXP_DIR, `${E2E_SEED_EXP}.json`),
    JSON.stringify({
      id: E2E_SEED_EXP,
      name: 'e2e-v25-seed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'completed',
      schema_id: 'qa_answer_v1',
      model_id: 'fake',
      model: 'fake-model',
      temperature: 1,
      max_tokens: 4096,
      api_config: { base_url: 'http://fake', api_key: 'fake' },
      prompt_template: 'unused',
      run_stats: { total_tasks: 1, completed_tasks: 1, failed_tasks: 0, started_at: new Date().toISOString() },
    }),
  )
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'results.jsonl'),
    JSON.stringify({
      schema_id: 'qa_answer_v1',
      schema_version: 1,
      task_id: 'qa_e2e_1',
      experiment_id: E2E_SEED_EXP,
      input_refs: { qa: 'qa_e2e_1' },
      input_preview: { qa: 'SEED_INPUT_PREVIEW' },
      status: 'success',
      output: { answer: 'e2e answer', confidence: 0.9 },
      latency_ms: 100,
      model: 'fake-model',
      timestamp: new Date().toISOString(),
      input_tokens: 10,
      output_tokens: 5,
    }) + '\n',
  )
}

function cleanExperiment() {
  try { fs.unlinkSync(path.join(EXP_DIR, `${E2E_SEED_EXP}.json`)) } catch {}
  try { fs.rmSync(RESULTS_DIR, { recursive: true, force: true }) } catch {}
}

// 第二条测对 cache-stats.jsonl 做 destructive 写：playwright fullyParallel 默认开，
// 多 worker 并发写文件会撕。强制本文件 serial。
test.describe.configure({ mode: 'serial' })

test.describe('Copilot v2.5 e2e', () => {
  test('chip preview shows manifest form (no input_preview leak)', async ({ page }) => {
    seedExperiment()
    try {
      await page.goto(`/experiments/${E2E_SEED_EXP}`)
      await page.waitForLoadState('networkidle')

      // 拿一条 task_result 的 task_id（从首条 result 元素的 data-attr）
      const firstResult = page.locator('[data-copilot-context="task_result"]').first()
      await expect(firstResult).toBeVisible({ timeout: 15_000 })
      const taskId = await firstResult.getAttribute('data-copilot-context-id')
      expect(taskId).toBe('qa_e2e_1')

      // 直接 fetch /api/copilot/contexts/resolve 校验响应形态——chip preview 在生产路径上消费同一个 API 响应。
      // 不依赖 DOM 上脆弱的 chip 展开按钮交互（依赖 chip rail 位置 / inspector 状态等）。
      const resolveResp = await page.request.post('/api/copilot/contexts/resolve', {
        data: {
          refs: [
            { tag: 1, type: 'task_result', id: taskId, extra: { experiment_id: E2E_SEED_EXP } },
          ],
        },
      })
      expect(resolveResp.ok()).toBe(true)
      const body = await resolveResp.json()
      const data = body.resolved?.[0]?.data as Record<string, unknown>
      expect(data).toBeTruthy()
      expect(data.task_id).toBe('qa_e2e_1')
      expect(data.input_preview).toBeUndefined()
      expect(data.input_refs).toBeUndefined()
      // system_message 也不应含 input_preview / SEED 字面字符串
      const systemMessage = body.system_message ?? ''
      expect(systemMessage).not.toContain('input_preview')
      expect(systemMessage).not.toContain('input_refs')
      expect(systemMessage).not.toContain('SEED_INPUT_PREVIEW')
    } finally {
      cleanExperiment()
    }
  })

  test('cache stats chip renders with seeded weekly data', async ({ page }) => {
    // 前置 1：在 data/copilot/cache-stats.jsonl 写一条最近的 stat（让 weekly.calls > 0）
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

    // 前置 2：在 CI 的干净 data/ 下没有 copilot session，panel 开了只看到空 session-list，
    // chat-view 不 mount → CacheStatsChip 不渲染。先 POST 创建一个空 session。
    const sessResp = await page.request.post('/api/copilot/sessions', { data: {} })
    const { id: newSid } = (await sessResp.json()) as { id: string }

    try {
      await page.goto('/')
      // 把 active_session 设到刚才创建的 session，chat-view 才会 mount
      await page.evaluate((sid) => {
        localStorage.setItem('copilot.active_session', JSON.stringify(sid))
      }, newSid)
      await page.reload()

      // 开 copilot
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
      const panel = page.locator('[data-copilot-panel]')
      await expect(panel).toBeVisible({ timeout: 5000 })

      // CacheStatsChip 渲染条件：weekly.calls > 0 → chip mount。
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
      // 清理 session
      try {
        await page.request.delete(`/api/copilot/sessions/${newSid}`)
      } catch {
        // ignore
      }
    }
  })
})
