#!/usr/bin/env -S npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- script-only file; tolerate any for jsonl record shapes from external API responses */
/**
 * scripts/run-pcw-image-samples.ts
 *
 * 跑 3 套生图 sample experiment (pcw_xhs_image_baseline / pcw_douyin_image_baseline /
 * pcw_friends_image_baseline) × gemini-2.5-flash-image → 输出到嵌套约定
 * data/results/<exp_id>/{results.jsonl, images/}。
 *
 * Standalone：直接 fetch sankuai gateway 的 google native imageGenerate
 * 端点（异步 submit + poll），**不走 evalyst llm-client**——因为 evalyst
 * 现在只支持 OpenAI Images API endpoint_kind，google native 路径未集成。
 *
 * Skip-if-exists：单条 result 已落盘则跳过（避免重复烧钱）。
 * Strip：跑完后从 ship 文件里去掉 status!=success（lessons §6.4 #4 硬约束）。
 * 不带 judge / 不写 annotations（lessons §6.4 #6 红线 buffer，业务评测员手打）。
 *
 * 用法：
 *   SANKUAI_KEY=xxxxx npm run run:pcw-image-samples
 *
 * Zero-dep（仅 Node 18+ 内置 fetch / fs / path + macOS sips for resize）。
 *
 * Rate limit：sankuai gateway gemini-2.5-flash-image RPM=5。submit 走 sliding-window
 * 限流；query polling 间隔 5s 不算 submit RPM（observed empirically）。
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATA = path.join(process.cwd(), 'data')

const ENDPOINT_BASE = 'https://aigc.sankuai.com/v1/google/models'
const MODEL = 'gemini-2.5-flash-image'
const SUBMIT_URL = `${ENDPOINT_BASE}/${MODEL}:imageGenerate`

const RPM_LIMIT = 5
const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 240_000  // 4 min per task max
const RESIZE_TARGET_PX = 768  // longest dimension; 768x768 PNG ~250-400 KB

const EXPERIMENTS: Array<{ id: string; schemaId: string; promptKey: 'xhs' | 'douyin' | 'friends' }> = [
  { id: 'pcw_xhs_image_baseline', schemaId: 'pcw_xhs_image_v1', promptKey: 'xhs' },
  { id: 'pcw_douyin_image_baseline', schemaId: 'pcw_douyin_image_v1', promptKey: 'douyin' },
  { id: 'pcw_friends_image_baseline', schemaId: 'pcw_friends_image_v1', promptKey: 'friends' },
]

// 每品类抽取条数 (固定，加起来 = 20)
const CATEGORY_PICK: Record<string, number> = {
  '美妆': 4, '数码': 4, '食品饮料': 4, '家居': 4, '服饰': 2, '母婴': 2,
}

interface Product {
  pid: string
  name: string
  category: string
  price: string
  core_features: string[]
  target_user: string
}

interface QueryResponse {
  status: number  // 1 = done observed; assume 0/2 = pending/error
  data?: {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
      finishReason?: string
    }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
}

class SubmitRateLimiter {
  private timestamps: number[] = []
  async wait(): Promise<void> {
    while (true) {
      const now = Date.now()
      this.timestamps = this.timestamps.filter((t) => now - t < 60_000)
      if (this.timestamps.length < RPM_LIMIT) {
        this.timestamps.push(now)
        return
      }
      const oldest = this.timestamps[0]!
      const waitMs = 60_000 - (now - oldest) + 200
      await sleep(waitMs)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function readDataset(): Product[] {
  const filePath = path.join(SEEDS, 'datasets', 'product_copywriting_v1.jsonl')
  const text = fsSync.readFileSync(filePath, 'utf8')
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Product)
}

function pickSamples(dataset: Product[]): Product[] {
  const byCategory: Record<string, Product[]> = {}
  for (const p of dataset) {
    if (!byCategory[p.category]) byCategory[p.category] = []
    byCategory[p.category]!.push(p)
  }
  const out: Product[] = []
  for (const [cat, n] of Object.entries(CATEGORY_PICK)) {
    const list = byCategory[cat] ?? []
    out.push(...list.slice(0, n))
  }
  return out
}

async function submitImageGen(prompt: string, key: string, limiter: SubmitRateLimiter): Promise<string> {
  await limiter.wait()
  const resp = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`submit HTTP ${resp.status}: ${body.slice(0, 300)}`)
  }
  const taskId = (await resp.text()).trim()
  if (!taskId || taskId.length < 8) throw new Error(`submit returned unexpected body: ${taskId.slice(0, 100)}`)
  return taskId
}

async function queryImageGen(taskId: string, key: string): Promise<QueryResponse> {
  const url = `${ENDPOINT_BASE}/${taskId}:imageGenerateQuery`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: key, Accept: '*/*' },
  })
  if (!resp.ok) throw new Error(`query HTTP ${resp.status}`)
  return (await resp.json()) as QueryResponse
}

async function pollUntilDone(taskId: string, key: string): Promise<QueryResponse> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS)
    const r = await queryImageGen(taskId, key)
    if (r.status === 1) return r  // done
    // status === 0 means still pending; loop continues
  }
  throw new Error(`poll timeout after ${POLL_TIMEOUT_MS / 1000}s for taskId=${taskId}`)
}

function extractImageUrl(qr: QueryResponse): string | null {
  const parts = qr.data?.candidates?.[0]?.content?.parts
  if (!parts) return null
  for (const p of parts) {
    if (p.inlineData?.data && p.inlineData.data.startsWith('http')) return p.inlineData.data
  }
  return null
}

async function downloadAndResize(srcUrl: string, dstPath: string): Promise<void> {
  const tmpPath = dstPath + '.tmp'
  const resp = await fetch(srcUrl)
  if (!resp.ok) throw new Error(`download HTTP ${resp.status} fetching ${srcUrl}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  await fs.writeFile(tmpPath, buf)
  // sips --resampleHeightWidthMax keeps aspect ratio, scales longest dim to N
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('sips', ['-Z', String(RESIZE_TARGET_PX), tmpPath, '--out', dstPath], {
      stdio: 'ignore',
    })
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`sips exit ${code}`))))
    proc.on('error', reject)
  })
  await fs.unlink(tmpPath).catch(() => {})
}

async function main() {
  const key = process.env.SANKUAI_KEY
  if (!key) {
    console.error('[runner] missing SANKUAI_KEY env var')
    console.error('[runner] usage: SANKUAI_KEY=xxxxx npm run run:pcw-image-samples')
    process.exit(1)
  }

  const dataset = readDataset()
  const samples = pickSamples(dataset)
  if (samples.length !== 20) {
    console.error(`[runner] expected 20 samples, got ${samples.length}. Check dataset / CATEGORY_PICK.`)
    process.exit(1)
  }
  console.log(`[runner] model=${MODEL} (sankuai google native imageGenerate, RPM=${RPM_LIMIT})`)
  console.log(`[runner] picked ${samples.length} products: ${samples.map((s) => s.pid).join(', ')}`)
  console.log(`[runner] estimated wall: 60 records / ${RPM_LIMIT} RPM ≈ 12-15 min (submit) + poll latency`)

  const limiter = new SubmitRateLimiter()
  let totalSuccess = 0
  let totalFailed = 0
  let totalSkipped = 0
  const t0 = Date.now()

  for (const exp of EXPERIMENTS) {
    console.log(`\n[runner] === ${exp.id} (schema=${exp.schemaId}) ===`)
    const schemaPath = path.join(SEEDS, 'schemas', `${exp.schemaId}.json`)
    const schema = JSON.parse(fsSync.readFileSync(schemaPath, 'utf8'))
    const promptTemplate = schema.default_prompt as string

    const resultsDir = path.join(DATA, 'results', exp.id)
    const imagesDir = path.join(resultsDir, 'images')
    await fs.mkdir(imagesDir, { recursive: true })
    const resultsPath = path.join(resultsDir, 'results.jsonl')

    const existingTaskIds = new Set<string>()
    if (fsSync.existsSync(resultsPath)) {
      const lines = fsSync.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try { existingTaskIds.add((JSON.parse(line) as any).task_id) } catch {}
      }
    }

    for (const sample of samples) {
      const taskId = `${exp.id}:${sample.pid}`
      if (existingTaskIds.has(taskId)) {
        totalSkipped++
        process.stdout.write('s')
        continue
      }

      const features = sample.core_features.join('、')
      const renderedPrompt = promptTemplate
        .replace(/\{\{name\}\}/g, sample.name)
        .replace(/\{\{category\}\}/g, sample.category)
        .replace(/\{\{price\}\}/g, sample.price)
        .replace(/\{\{features\}\}/g, features)
        .replace(/\{\{target_user\}\}/g, sample.target_user)

      const baseRecord = {
        task_id: taskId,
        experiment_id: exp.id,
        schema_id: exp.schemaId,
        schema_version: 1,
        input_refs: { p: sample.pid },
        input_preview: { p: sample },
        prompt_excerpt: renderedPrompt.slice(0, 200),
        timestamp: new Date().toISOString(),
        model: MODEL,
      }

      const tStart = Date.now()
      try {
        const submittedTaskId = await submitImageGen(renderedPrompt, key, limiter)
        const qr = await pollUntilDone(submittedTaskId, key)
        const srcUrl = extractImageUrl(qr)
        if (!srcUrl) {
          const rec = { ...baseRecord, status: 'error' as const, error: 'no image url in response', latency_ms: Date.now() - tStart }
          await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
          totalFailed++
          process.stdout.write('F')
          continue
        }
        const localFilename = `${sample.pid}.png`
        const localPath = path.join(imagesDir, localFilename)
        await downloadAndResize(srcUrl, localPath)
        const apiUrl = `/api/results/${exp.id}/images/${localFilename}`

        const rec = {
          ...baseRecord,
          status: 'success' as const,
          output: { image_url: apiUrl },
          latency_ms: Date.now() - tStart,
          input_tokens: qr.data?.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: qr.data?.usageMetadata?.candidatesTokenCount ?? 0,
        }
        await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
        totalSuccess++
        process.stdout.write('.')
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        const rec = { ...baseRecord, status: 'error' as const, error, latency_ms: Date.now() - tStart }
        await fs.appendFile(resultsPath, JSON.stringify(rec) + '\n')
        totalFailed++
        process.stdout.write('F')
      }
    }
    process.stdout.write('\n')
  }

  const wallSec = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\n[runner] done. success=${totalSuccess} fail=${totalFailed} skipped=${totalSkipped} wall=${wallSec}s`)
  console.log(`[runner] results in data/results/{pcw_xhs|douyin|friends}_image_baseline/`)
  console.log(`[runner] next: run strip + copy to seeds (Task 12)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
