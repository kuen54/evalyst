// ---------- Display (展示模板) 服务端层 ----------
// 两类来源：
//   1. 内置 Display（source='builtin'）：metadata 在这里声明，对应组件在 components/results/registry.tsx 注册
//   2. 用户 Display（source='user'）：JSON 存 data/displays/{id}.json
//
// 本文件不 import React，纯数据/文件层。

import fs from 'fs'
import path from 'path'
import type { Display } from './schema/types'
import { ensureDir, writeAtomic } from './fs-utils'

const DISPLAYS_DIR = path.join(process.cwd(), 'data', 'displays')

// --- 内置 displays ---

const BUILTINS: Display[] = [
  {
    id: 'builtin_single_list',
    name: '单字段列表',
    description: '1 维或无维度：每条 result 一行，展示所有 output 字段',
    source: 'builtin',
    mode: 'builtin',
    builtin_component: 'single_list',
  },
  {
    id: 'builtin_dual_list',
    name: '双维分组列表',
    description: '2 维：按第一维分组，第二维在组内展开成行',
    source: 'builtin',
    mode: 'builtin',
    builtin_component: 'dual_list',
  },
  {
    id: 'builtin_triple_grid',
    name: '三维分组网格',
    description: '3 维：按第一维分组，第二+三维在组内构成二维网格',
    source: 'builtin',
    mode: 'builtin',
    builtin_component: 'triple_grid',
  },
  {
    id: 'builtin_bubble_overlay',
    name: '气泡坐标叠加图',
    description: 'output 含坐标时用：图片 + 坐标标签；无坐标的气泡作为固定位置展示',
    source: 'builtin',
    mode: 'builtin',
    builtin_component: 'bubble_overlay',
  },
  {
    id: 'builtin_json_default',
    name: '通用 JSON',
    description: '推断失败时的兜底：原样显示 output JSON',
    source: 'builtin',
    mode: 'builtin',
    builtin_component: 'json_default',
  },
]

const BUILTIN_MAP = new Map(BUILTINS.map(d => [d.id, d]))

// --- API ---

export function listDisplays(): Display[] {
  ensureDir(DISPLAYS_DIR)
  const userDisplays: Display[] = []
  const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf-8')
    try {
      const d = JSON.parse(raw) as Display
      userDisplays.push({ ...d, source: 'user' })
    } catch {
      // skip broken JSON
    }
  }
  return [...BUILTINS, ...userDisplays]
}

export function getDisplay(id: string): Display | null {
  if (BUILTIN_MAP.has(id)) return BUILTIN_MAP.get(id)!
  const p = path.join(DISPLAYS_DIR, `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as Display
    return { ...d, source: 'user' }
  } catch {
    return null
  }
}

export function createUserDisplay(display: Display): Display {
  ensureDir(DISPLAYS_DIR)
  if (BUILTIN_MAP.has(display.id)) {
    throw new Error(`Cannot override builtin display: ${display.id}`)
  }
  if (!/^[a-z][a-z0-9_]*$/.test(display.id)) {
    throw new Error(`Invalid id: ${display.id} (only lowercase letters/digits/underscores, must start with letter)`)
  }
  const toWrite: Display = { ...display, source: 'user' }
  writeAtomic(path.join(DISPLAYS_DIR, `${display.id}.json`), JSON.stringify(toWrite, null, 2))
  return toWrite
}

export function deleteUserDisplay(id: string): boolean {
  if (BUILTIN_MAP.has(id)) return false
  const p = path.join(DISPLAYS_DIR, `${id}.json`)
  if (!fs.existsSync(p)) return false
  fs.rmSync(p)
  return true
}

// --- Validators ---

export interface DisplayValidationError {
  field: string
  message: string
}

export function validateDisplay(d: unknown): { ok: boolean; errors: DisplayValidationError[] } {
  const errors: DisplayValidationError[] = []
  if (typeof d !== 'object' || d === null) {
    return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] }
  }
  const x = d as Record<string, unknown>
  if (typeof x.id !== 'string' || !x.id) errors.push({ field: 'id', message: 'required string' })
  if (typeof x.name !== 'string' || !x.name) errors.push({ field: 'name', message: 'required string' })
  if (!['table', 'grouped_grid', 'jsx'].includes(x.mode as string)) {
    errors.push({ field: 'mode', message: 'must be one of: table | grouped_grid | jsx' })
  }
  if (x.mode === 'table') {
    const t = x.table as { columns?: unknown[] } | undefined
    if (!t || !Array.isArray(t.columns) || t.columns.length === 0) {
      errors.push({ field: 'table.columns', message: 'required non-empty array when mode=table' })
    }
  }
  if (x.mode === 'grouped_grid') {
    const g = x.grouped_grid as Record<string, unknown> | undefined
    if (!g) errors.push({ field: 'grouped_grid', message: 'required when mode=grouped_grid' })
    else {
      if (!g.primary_group) errors.push({ field: 'grouped_grid.primary_group', message: 'required' })
      if (!g.secondary_group) errors.push({ field: 'grouped_grid.secondary_group', message: 'required' })
      if (!Array.isArray(g.cell_columns) || g.cell_columns.length === 0) {
        errors.push({ field: 'grouped_grid.cell_columns', message: 'required non-empty array' })
      }
    }
  }
  if (x.mode === 'jsx') {
    const j = x.jsx as { source?: unknown } | undefined
    if (!j || typeof j.source !== 'string' || !j.source.trim()) {
      errors.push({ field: 'jsx.source', message: 'required non-empty string when mode=jsx' })
    }
  }
  return { ok: errors.length === 0, errors }
}
