// ---------- Seed 机制 ----------
// 首次访问时把 src/lib/seeds/ 下的示例资源（dataset / schema）复制到 data/ 目录。
// 幂等：存在就不动，用户删除后下次访问会自动恢复。

import fs from 'fs'
import path from 'path'
import { ensureDir } from './fs-utils'

const SEEDS_DIR = path.join(process.cwd(), 'src', 'lib', 'seeds')
const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets')
const SCHEMAS_DIR = path.join(process.cwd(), 'data', 'schemas')
const RUBRICS_DIR = path.join(process.cwd(), 'data', 'rubrics')

/**
 * 每次都快速 existsSync 一下已 seed 文件，存在则跳过（成本极低）。
 * 不做进程级 cache，确保用户删除后能自动恢复。
 */
export function ensureSeeds() {
  try {
    seedDatasets()
    seedSchemas()
    seedRubrics()
  } catch (e) {
    console.error('[ensureSeeds] failed:', e)
  }
}

function seedDatasets() {
  ensureDir(DATASETS_DIR)
  const datasets = [
    { id: 'qa_pairs', meta: 'qa_pairs.meta.json', jsonl: 'qa_pairs.jsonl' },
  ]
  for (const ds of datasets) {
    const metaDst = path.join(DATASETS_DIR, `${ds.id}.meta.json`)
    const jsonlDst = path.join(DATASETS_DIR, `${ds.id}.jsonl`)
    if (!fs.existsSync(metaDst)) {
      const metaSrc = path.join(SEEDS_DIR, ds.meta)
      if (fs.existsSync(metaSrc)) fs.copyFileSync(metaSrc, metaDst)
    }
    if (!fs.existsSync(jsonlDst)) {
      const jsonlSrc = path.join(SEEDS_DIR, ds.jsonl)
      if (fs.existsSync(jsonlSrc)) fs.copyFileSync(jsonlSrc, jsonlDst)
    }
  }
}

function seedSchemas() {
  ensureDir(SCHEMAS_DIR)
  const schemas = ['qa_answer_v1']
  for (const id of schemas) {
    const dst = path.join(SCHEMAS_DIR, `${id}.json`)
    if (!fs.existsSync(dst)) {
      const src = path.join(SEEDS_DIR, `${id}.schema.json`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    }
  }
}

function seedRubrics() {
  ensureDir(RUBRICS_DIR)
  const rubrics = ['qa_accuracy']
  for (const id of rubrics) {
    const dst = path.join(RUBRICS_DIR, `${id}.json`)
    if (!fs.existsSync(dst)) {
      const src = path.join(SEEDS_DIR, `${id}.rubric.json`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    }
  }
}
