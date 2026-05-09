// ---------- Seed 机制 ----------
// 首次访问时把 src/lib/seeds/ 下的示例资源（dataset / schema）复制到 data/ 目录。
// 幂等：存在就不动，用户删除后下次访问会自动恢复。

import fs from 'fs'
import path from 'path'
import { ensureDir } from './fs-utils'

// 惰性解析：每次调用按当前 process.cwd() 重算，便于测试 chdir。
function seedsDir() { return path.join(process.cwd(), 'src', 'lib', 'seeds') }
function datasetsDir() { return path.join(process.cwd(), 'data', 'datasets') }
function schemasDir() { return path.join(process.cwd(), 'data', 'schemas') }
function rubricsDir() { return path.join(process.cwd(), 'data', 'rubrics') }

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
  ensureDir(datasetsDir())
  const datasets = [
    { id: 'qa_pairs', meta: 'qa_pairs.meta.json', jsonl: 'qa_pairs.jsonl' },
    { id: 'image_prompts_v1', meta: 'image_prompts_v1.meta.json', jsonl: 'image_prompts_v1.jsonl' },
  ]
  for (const ds of datasets) {
    const metaDst = path.join(datasetsDir(), `${ds.id}.meta.json`)
    const jsonlDst = path.join(datasetsDir(), `${ds.id}.jsonl`)
    if (!fs.existsSync(metaDst)) {
      const metaSrc = path.join(seedsDir(), ds.meta)
      if (fs.existsSync(metaSrc)) fs.copyFileSync(metaSrc, metaDst)
    }
    if (!fs.existsSync(jsonlDst)) {
      const jsonlSrc = path.join(seedsDir(), ds.jsonl)
      if (fs.existsSync(jsonlSrc)) fs.copyFileSync(jsonlSrc, jsonlDst)
    }
  }
}

function seedSchemas() {
  ensureDir(schemasDir())
  const schemas = ['qa_answer_v1', 'image_gen_v1']
  for (const id of schemas) {
    const dst = path.join(schemasDir(), `${id}.json`)
    if (!fs.existsSync(dst)) {
      const src = path.join(seedsDir(), `${id}.schema.json`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    }
  }
}

function seedRubrics() {
  ensureDir(rubricsDir())
  const rubrics = ['qa_accuracy', 'image_quality_v1']
  for (const id of rubrics) {
    const dst = path.join(rubricsDir(), `${id}.json`)
    if (!fs.existsSync(dst)) {
      const src = path.join(seedsDir(), `${id}.rubric.json`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    }
  }
}
