// ---------- Rubric CRUD（文件存储） ----------

import fs from 'fs'
import path from 'path'
import type { Rubric } from './schema/types'
import { ensureDir, writeAtomic } from './fs-utils'
import { ensureSeeds } from './seed'

// 惰性解析：每次调用按当前 process.cwd() 重算，便于测试 chdir。
function rubricsDir() { return path.join(process.cwd(), 'data', 'rubrics') }

export function listRubrics(): Rubric[] {
  ensureSeeds()
  ensureDir(rubricsDir())
  if (!fs.existsSync(rubricsDir())) return []
  const files = fs.readdirSync(rubricsDir()).filter(f => f.endsWith('.json'))
  const out: Rubric[] = []
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(rubricsDir(), f), 'utf-8')
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
  const filePath = path.join(rubricsDir(), `${id}.json`)
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
  ensureDir(rubricsDir())
  const toWrite: Rubric = { ...r, source: r.source ?? 'user' }
  writeAtomic(path.join(rubricsDir(), `${r.id}.json`), JSON.stringify(toWrite, null, 2))
  return toWrite
}

export function deleteRubric(id: string): boolean {
  const filePath = path.join(rubricsDir(), `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}
