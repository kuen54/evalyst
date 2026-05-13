#!/usr/bin/env -S npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- script-only file; tolerate any for jsonl record shapes from external LLM responses */
/**
 * scripts/run-pcw-image-samples.ts
 *
 * 跑 3 套生图 sample experiment (pcw_xhs_image_baseline / pcw_douyin_image_baseline /
 * pcw_friends_image_baseline) × gpt-image-1 → 输出到嵌套约定
 * data/results/<exp_id>/{results.jsonl, images/}。
 *
 * Skip-if-exists：单条 result 已落盘则跳过（避免重复烧钱）。
 * Strip：跑完后从 ship 文件里去掉 status!=success（lessons §6.4 #4 硬约束）。
 * 不带 judge / 不写 annotations（lessons §6.4 #6 红线 buffer，业务评测员手打）。
 * 用法：npm run run:pcw-image-samples
 *
 * Zero-dep（仅 Node 18+ 内置 fetch / fs / path）。
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { callLlm } from '../src/lib/llm-client'
import { getLlmConfig, type LlmConfig, type ModelConfig } from '../src/lib/llm-config'
import { saveImagesForTask, assignImagePathsToOutput } from '../src/lib/image-store'

const SEEDS = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATA = path.join(process.cwd(), 'data')

// gpt-image-1 候选 model name（按顺序找第一个匹配）
const IMAGE_MODEL_CANDIDATES = ['gpt-image-1']

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

function pickModel(cfg: LlmConfig, candidates: string[]): ModelConfig | null {
  for (const c of candidates) {
    const found = cfg.models.find((m) => m.model === c)
    if (found) return found
  }
  return null
}

function readDataset(): Product[] {
  const filePath = path.join(SEEDS, 'datasets', 'product_copywriting_v1.jsonl')
  const text = fsSync.readFileSync(filePath, 'utf8')
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Product)
}

/**
 * 按 CATEGORY_PICK 配额从 dataset 中抽取 20 条。每品类按 dataset 行号顺序前 N 条。
 * 确定性：同一 dataset 多次调用返回完全相同 20 条（顺序也一致）。
 */
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

async function main() {
  const cfg = getLlmConfig()
  const imageModel = pickModel(cfg, IMAGE_MODEL_CANDIDATES)
  if (!imageModel) {
    console.error('[runner] missing LLM config: gpt-image-1')
    console.error('[runner] please add at /settings/llm with these fields:')
    console.error('  endpoint_kind=images_generations')
    console.error('  base_url=https://aigc.sankuai.com/v1/openai/native')
    console.error('  api_format=openai')
    console.error('  api_key=Bearer ...')
    console.error('[runner] then re-run.')
    process.exit(1)
  }
  if (imageModel.endpoint_kind !== 'images_generations') {
    console.error(`[runner] gpt-image-1 found but endpoint_kind="${imageModel.endpoint_kind}", expected "images_generations". Update /settings/llm.`)
    process.exit(1)
  }

  const dataset = readDataset()
  const samples = pickSamples(dataset)
  if (samples.length !== 20) {
    console.error(`[runner] expected 20 samples, got ${samples.length}. Check dataset / CATEGORY_PICK.`)
    process.exit(1)
  }
  console.log(`[runner] image_model=${imageModel.model} (${imageModel.api_format} / ${imageModel.endpoint_kind})`)
  console.log(`[runner] picked ${samples.length} products: ${samples.map((s) => s.pid).join(', ')}`)
  console.log(`[runner] estimated cost: 60 calls × ~$0.04 = ~$2.4 / ¥17`)

  // TODO Task 8: per-experiment loop
}

main().catch((e) => { console.error(e); process.exit(1) })
