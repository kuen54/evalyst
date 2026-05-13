#!/usr/bin/env -S npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- script-only file; tolerate any for jsonl record shapes from external LLM responses */
/**
 * scripts/run-pcw-samples.ts
 *
 * 一次性跑完 3 套 sample experiment（pcw_xhs_baseline / pcw_douyin_baseline /
 * pcw_friends_baseline）+ 4o-mini LLM-as-judge 标注 → 输出到嵌套约定的
 * data/results/<exp_id>/{results,annotations}.jsonl。
 *
 * Skip-if-exists：单条 result 已落盘则跳过（避免重复烧钱）。
 * Strip：跑完后从 ship 文件里去掉 status!=success（lessons §6.4 #4 硬约束）。
 * 用法：npm run run:pcw-samples
 *
 * Zero-dep（仅 Node 18+ 内置 fetch / fs / path）。
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { callLlm } from '../src/lib/llm-client'
import { getLlmConfig, type LlmConfig, type ModelConfig } from '../src/lib/llm-config'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATA = path.join(process.cwd(), 'data')

// 主跑模型：claude-opus-4-6（避开 kimi，lessons §6.4）
const PRIMARY_MODEL_NAME = 'claude-opus-4-6'
// Judge 模型：gpt-4o-mini（便宜稳）
const JUDGE_MODEL_NAME = 'gpt-4o-mini'

const EXPERIMENTS: Array<{ id: string; schemaId: string; platformStyle: string; max_tokens: number }> = [
  { id: 'pcw_xhs_baseline', schemaId: 'pcw_xhs_v1', platformStyle: '小红书', max_tokens: 2048 },
  { id: 'pcw_douyin_baseline', schemaId: 'pcw_douyin_v1', platformStyle: '抖音', max_tokens: 2048 },
  { id: 'pcw_friends_baseline', schemaId: 'pcw_friends_v1', platformStyle: '朋友圈', max_tokens: 1024 },
]

async function main() {
  const cfg = getLlmConfig()
  const opus = pickModel(cfg, PRIMARY_MODEL_NAME)
  const judge = pickModel(cfg, JUDGE_MODEL_NAME)
  if (!opus) {
    console.error(`[run-pcw] ${PRIMARY_MODEL_NAME} 没在 llm-config.json，先去 /settings/llm 配上`)
    process.exit(1)
  }
  if (!judge) {
    console.error(`[run-pcw] ${JUDGE_MODEL_NAME} 没在 llm-config.json，先去 /settings/llm 配上（judge 用）`)
    process.exit(1)
  }
  console.log(`[run-pcw] primary=${opus.model} (${opus.api_format}) · judge=${judge.model}`)

  // 读 dataset
  const records = await loadJsonl(path.join(SEEDS, 'datasets', 'product_copywriting_v1.jsonl'))
  console.log(`[run-pcw] dataset: ${records.length} records`)

  for (const exp of EXPERIMENTS) {
    console.log(`\n[run-pcw] === ${exp.id} (${exp.platformStyle}) ===`)
    const schema = JSON.parse(await fs.readFile(path.join(SEEDS, 'schemas', `${exp.schemaId}.json`), 'utf-8'))
    await runOneExperiment(exp, schema, records, opus)
    await runJudge(exp, judge)
    await stripErrorsAndCopyToSeeds(exp.id)
  }

  console.log('\n[run-pcw] all done. Run `git status` 看 src/lib/seeds/results/ 增量。')
}

async function runOneExperiment(
  exp: { id: string; schemaId: string; max_tokens: number },
  schema: any,
  records: any[],
  model: ModelConfig,
) {
  const expDir = path.join(DATA, 'results', exp.id)
  await ensureDir(expDir)
  const resultsPath = path.join(expDir, 'results.jsonl')

  // 读已存在的 results 用作 skip-if-exists
  const existing = await readJsonlSafe(resultsPath)
  const seenTaskIds = new Set(existing.map(r => r.task_id))

  let success = 0
  let failed = 0
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const taskId = `${exp.id}__${rec.pid}`
    if (seenTaskIds.has(taskId)) {
      console.log(`  [${i + 1}/${records.length}] ${rec.pid} (skip — already done)`)
      continue
    }

    const prompt = renderPrompt(schema.default_prompt, rec)
    const start = Date.now()
    try {
      const res = await callLlm({
        messages: [
          { role: 'user', content: prompt },
          { role: 'user', content: schema.message_builder?.user_template ?? '' },
        ],
        config: {
          api_format: model.api_format,
          base_url: model.base_url,
          api_key: model.api_key,
        },
        model: model.model,
        temperature: 0.7,
        max_tokens: exp.max_tokens,
      })
      const output = tryParseJSON(res.content)
      const result = {
        schema_id: exp.schemaId,
        schema_version: schema.version ?? 1,
        task_id: taskId,
        experiment_id: exp.id,
        input_refs: { p: rec.pid },
        input_preview: flattenInputPreview('p', rec),
        output,
        status: output && typeof output === 'object' && !('_raw' in output) ? 'success' : 'parse_error',
        raw_response: res.content,
        latency_ms: Date.now() - start,
        model: model.model,
        model_id: model.id,
        timestamp: new Date().toISOString(),
        ...(res.usage ? {
          input_tokens: res.usage.prompt_tokens,
          output_tokens: res.usage.completion_tokens,
        } : {}),
      }
      await appendJsonl(resultsPath, result)
      if (result.status === 'success') success++
      else failed++
      console.log(`  [${i + 1}/${records.length}] ${rec.pid} (${result.status}, ${result.latency_ms}ms)`)
    } catch (e: any) {
      failed++
      const errResult = {
        schema_id: exp.schemaId,
        schema_version: schema.version ?? 1,
        task_id: taskId,
        experiment_id: exp.id,
        input_refs: { p: rec.pid },
        input_preview: flattenInputPreview('p', rec),
        status: 'error',
        error: String(e?.message ?? e),
        latency_ms: Date.now() - start,
        model: model.model,
        model_id: model.id,
        timestamp: new Date().toISOString(),
      }
      await appendJsonl(resultsPath, errResult)
      console.log(`  [${i + 1}/${records.length}] ${rec.pid} (error: ${e?.message ?? e})`)
    }
  }
  console.log(`  [${exp.id}] success=${success} failed=${failed}`)
}

async function runJudge(exp: { id: string; platformStyle: string }, judgeModel: ModelConfig) {
  const expDir = path.join(DATA, 'results', exp.id)
  const resultsPath = path.join(expDir, 'results.jsonl')
  const annotationsPath = path.join(expDir, 'annotations.jsonl')
  const results = await readJsonlSafe(resultsPath)
  const successResults = results.filter(r => r.status === 'success')

  const judgeTemplate = await fs.readFile(path.join(SEEDS, 'judges', 'pcw_quality.judge.md'), 'utf-8')

  // skip-if-exists
  const existing = await readJsonlSafe(annotationsPath)
  const seenTaskIds = new Set(existing.map(a => a.task_id))

  console.log(`  [${exp.id}] judging ${successResults.length} success records (existing ${existing.length})`)
  for (let i = 0; i < successResults.length; i++) {
    const r = successResults[i]
    if (seenTaskIds.has(r.task_id)) continue

    const prompt = fillJudgePrompt(judgeTemplate, r, exp.platformStyle)
    try {
      const res = await callLlm({
        messages: [{ role: 'user', content: prompt }],
        config: {
          api_format: judgeModel.api_format,
          base_url: judgeModel.base_url,
          api_key: judgeModel.api_key,
        },
        model: judgeModel.model,
        temperature: 0,
        max_tokens: 1024,
      })
      const parsed = tryParseJSON(res.content)
      const ann = {
        annotation_id: nanoid10(),
        task_id: r.task_id,
        rubric_id: 'pcw_quality',
        evaluator: 'llm',
        scores: parsed?.scores ?? {},
        rationale: parsed?.rationale ?? '',
        timestamp: new Date().toISOString(),
      }
      await appendJsonl(annotationsPath, ann)
      if ((i + 1) % 10 === 0) console.log(`    judge ${i + 1}/${successResults.length}`)
    } catch (e: any) {
      console.log(`    [judge] ${r.task_id} failed: ${e?.message ?? e}`)
    }
  }
}

async function stripErrorsAndCopyToSeeds(expId: string) {
  const srcResults = path.join(DATA, 'results', expId, 'results.jsonl')
  const srcAnn = path.join(DATA, 'results', expId, 'annotations.jsonl')
  const dstDir = path.join(SEEDS, 'results', expId)
  await ensureDir(dstDir)

  const results = await readJsonlSafe(srcResults)
  const success = results.filter(r => r.status === 'success')
  const stripped = results.length - success.length
  await fs.writeFile(
    path.join(dstDir, 'results.jsonl'),
    success.map(r => JSON.stringify(r)).join('\n') + (success.length > 0 ? '\n' : ''),
  )

  if (fsSync.existsSync(srcAnn)) {
    const ann = await readJsonlSafe(srcAnn)
    // 只保留对应到 success result 的 annotation
    const successTaskIds = new Set(success.map(r => r.task_id))
    const annFiltered = ann.filter(a => successTaskIds.has(a.task_id))
    await fs.writeFile(
      path.join(dstDir, 'annotations.jsonl'),
      annFiltered.map(a => JSON.stringify(a)).join('\n') + (annFiltered.length > 0 ? '\n' : ''),
    )
    console.log(`  [${expId}] shipped ${success.length} results + ${annFiltered.length} annotations to seeds (stripped ${stripped} non-success)`)
  } else {
    console.log(`  [${expId}] shipped ${success.length} results to seeds (stripped ${stripped} non-success); no annotations file`)
  }
}

// ---------- helpers ----------

function pickModel(cfg: LlmConfig, modelName: string): ModelConfig | undefined {
  return cfg.models.find(m => m.model === modelName)
}

function renderPrompt(template: string, rec: Record<string, any>): string {
  // 处理 features array → "、" 拼接（schema variables.features.transform 已声明 join）
  const features = Array.isArray(rec.core_features) ? rec.core_features.join('、') : String(rec.core_features ?? '')
  return template
    .replace(/\{\{name\}\}/g, String(rec.name ?? ''))
    .replace(/\{\{category\}\}/g, String(rec.category ?? ''))
    .replace(/\{\{price\}\}/g, String(rec.price ?? ''))
    .replace(/\{\{features\}\}/g, features)
    .replace(/\{\{target_user\}\}/g, String(rec.target_user ?? ''))
}

function fillJudgePrompt(template: string, result: any, platformStyle: string): string {
  const inp = result.input_preview ?? {}
  const out = result.output ?? {}
  const features = Array.isArray(inp['p.core_features']) ? inp['p.core_features'].join('、') : String(inp['p.core_features'] ?? '')
  const hashtags = Array.isArray(out.hashtags) ? out.hashtags.join(' / ') : String(out.hashtags ?? '')
  return template
    .replace(/\{\{name\}\}/g, String(inp['p.name'] ?? ''))
    .replace(/\{\{category\}\}/g, String(inp['p.category'] ?? ''))
    .replace(/\{\{price\}\}/g, String(inp['p.price'] ?? ''))
    .replace(/\{\{features\}\}/g, features)
    .replace(/\{\{target_user\}\}/g, String(inp['p.target_user'] ?? ''))
    .replace(/\{\{platform_style\}\}/g, platformStyle)
    .replace(/\{\{output_title\}\}/g, String(out.title ?? ''))
    .replace(/\{\{output_body\}\}/g, String(out.body ?? ''))
    .replace(/\{\{output_hashtags\}\}/g, hashtags)
    .replace(/\{\{output_cta\}\}/g, String(out.cta ?? ''))
}

function flattenInputPreview(alias: string, rec: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    out[`${alias}.${k}`] = v
  }
  return out
}

function tryParseJSON(s: string): any {
  if (!s) return null
  // Strip markdown code fences if present
  const cleaned = s.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return { _raw: s }
  }
}

async function loadJsonl(p: string): Promise<any[]> {
  const text = await fs.readFile(p, 'utf-8')
  return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

async function readJsonlSafe(p: string): Promise<any[]> {
  if (!fsSync.existsSync(p)) return []
  const text = await fs.readFile(p, 'utf-8')
  if (!text.trim()) return []
  return text.trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
}

async function appendJsonl(p: string, obj: any): Promise<void> {
  await fs.appendFile(p, JSON.stringify(obj) + '\n')
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}

function nanoid10(): string {
  return Math.random().toString(36).slice(2, 12)
}

main().catch(e => { console.error(e); process.exit(1) })
