// ---------- Rubric CRUD（文件存储） ----------

import fs from 'fs'
import path from 'path'
import type { Rubric } from './schema/types'
import { ensureDir, writeAtomic } from './fs-utils'
import { ensureSeeds } from './seed'

const RUBRICS_DIR = path.join(process.cwd(), 'data', 'rubrics')

export function listRubrics(): Rubric[] {
  ensureSeeds()
  ensureDir(RUBRICS_DIR)
  if (!fs.existsSync(RUBRICS_DIR)) return []
  const files = fs.readdirSync(RUBRICS_DIR).filter(f => f.endsWith('.json'))
  const out: Rubric[] = []
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(RUBRICS_DIR, f), 'utf-8')
      const r = JSON.parse(raw) as Rubric
      if (!r.source) r.source = 'user'
      out.push(r)
    } catch (e) {
      console.error(`[rubrics] failed to parse ${f}:`, e)
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function getRubric(id: string): Rubric | null {
  ensureSeeds()
  const filePath = path.join(RUBRICS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    const r = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Rubric
    if (!r.source) r.source = 'user'
    return r
  } catch {
    return null
  }
}

export function saveRubric(r: Rubric): Rubric {
  ensureDir(RUBRICS_DIR)
  const toWrite: Rubric = { ...r, source: r.source ?? 'user' }
  writeAtomic(path.join(RUBRICS_DIR, `${r.id}.json`), JSON.stringify(toWrite, null, 2))
  return toWrite
}

export function deleteRubric(id: string): boolean {
  const filePath = path.join(RUBRICS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}
