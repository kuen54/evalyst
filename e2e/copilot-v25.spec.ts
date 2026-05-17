import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

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
})
