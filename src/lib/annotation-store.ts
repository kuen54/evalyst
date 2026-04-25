// ---------- Annotation CRUD + 聚合 ----------
// 一个实验的所有 annotation 存在 data/results/{experiment_id}/annotations.jsonl
// append-only；同 (task_id, rubric_id, evaluator) 可以有多条，聚合时按 timestamp 取最新。

import fs from 'fs'
import path from 'path'
import type { Annotation, Rubric } from './schema/types'
import { ensureDir } from './fs-utils'

// 惰性：每次调用重新计算，方便测试 chdir
function resultsDir() { return path.join(process.cwd(), 'data', 'results') }

function filePathFor(experimentId: string): string {
  return path.join(resultsDir(), experimentId, 'annotations.jsonl')
}

function listAnnotations(experimentId: string): Annotation[] {
  const p = filePathFor(experimentId)
  if (!fs.existsSync(p)) return []
  const content = fs.readFileSync(p, 'utf-8').trim()
  if (!content) return []
  const out: Annotation[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as Annotation)
    } catch {
      /* skip malformed */
    }
  }
  return out
}

export function appendAnnotation(experimentId: string, a: Annotation): void {
  const dir = path.join(resultsDir(), experimentId)
  ensureDir(dir)
  fs.appendFileSync(filePathFor(experimentId), JSON.stringify(a) + '\n')
}

/** 取"当前生效"的 annotation 集合：同 (task_id, rubric_id, evaluator) 取 timestamp 最新 */
export function latestAnnotations(experimentId: string, rubricId?: string): Annotation[] {
  const all = listAnnotations(experimentId)
  const filtered = rubricId ? all.filter(a => a.rubric_id === rubricId) : all
  const map = new Map<string, Annotation>()
  for (const a of filtered) {
    const key = `${a.task_id}|${a.rubric_id}|${a.evaluator}`
    const prev = map.get(key)
    if (!prev || a.timestamp > prev.timestamp) map.set(key, a)
  }
  return Array.from(map.values())
}

export interface CriterionAggregate {
  key: string
  label: string
  type: 'pass_fail' | 'likert_1_5' | 'score_0_100'
  count: number                             // 有几条 annotation 给了这个 criterion
  // pass_fail
  pass?: number
  fail?: number
  pass_rate?: number
  // likert / numeric
  avg?: number
  min?: number
  max?: number
  dist?: Record<string, number>             // likert 的分布
}

export interface RubricAggregate {
  rubric_id: string
  total_tasks: number
  annotated_tasks: number                   // 至少有一条 annotation（不管 evaluator）的 task 数
  criteria: CriterionAggregate[]
}

/** 按 rubric 聚合：对每个 criterion 算 pass rate / avg 等 */
export function aggregateAnnotations(
  experimentId: string,
  rubric: Rubric,
  totalTasks: number,
): RubricAggregate {
  const latest = latestAnnotations(experimentId, rubric.id)
  const byTask = new Set(latest.map(a => a.task_id))

  const criteria: CriterionAggregate[] = rubric.criteria.map(c => {
    const agg: CriterionAggregate = { key: c.key, label: c.label, type: c.type, count: 0 }
    const values: Array<number | boolean> = []
    for (const a of latest) {
      const v = a.scores[c.key]
      if (v === undefined || v === null) continue
      values.push(v)
      agg.count++
    }
    if (c.type === 'pass_fail') {
      agg.pass = values.filter(v => v === true).length
      agg.fail = values.filter(v => v === false).length
      agg.pass_rate = agg.count > 0 ? agg.pass / agg.count : 0
    } else if (c.type === 'likert_1_5' || c.type === 'score_0_100') {
      const nums = values.filter(v => typeof v === 'number') as number[]
      if (nums.length > 0) {
        agg.avg = nums.reduce((a, b) => a + b, 0) / nums.length
        agg.min = Math.min(...nums)
        agg.max = Math.max(...nums)
        if (c.type === 'likert_1_5') {
          agg.dist = {}
          for (let i = 1; i <= 5; i++) agg.dist[String(i)] = 0
          for (const n of nums) {
            const k = String(Math.round(n))
            if (agg.dist[k] !== undefined) agg.dist[k]++
          }
        }
      }
    }
    return agg
  })

  return {
    rubric_id: rubric.id,
    total_tasks: totalTasks,
    annotated_tasks: byTask.size,
    criteria,
  }
}
