import { NextRequest, NextResponse } from 'next/server'
import { getRubric, saveRubric, deleteRubric } from '@/lib/rubric-store'
import type { Rubric } from '@/lib/schema/types'

const ID_RE = /^[a-z][a-z0-9_]*$/

function validate(body: unknown): { ok: true; value: Rubric } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be object' }
  const r = body as Partial<Rubric>
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return { ok: false, error: 'id must match /^[a-z][a-z0-9_]*$/' }
  if (typeof r.name !== 'string' || !r.name.trim()) return { ok: false, error: 'name is required' }
  if (!Array.isArray(r.criteria) || r.criteria.length === 0) return { ok: false, error: 'criteria must be a non-empty array' }
  const keySet = new Set<string>()
  for (const c of r.criteria) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'each criterion must be an object' }
    if (typeof c.key !== 'string' || !ID_RE.test(c.key)) return { ok: false, error: `criterion.key invalid: ${c.key}` }
    if (keySet.has(c.key)) return { ok: false, error: `duplicate criterion.key: ${c.key}` }
    keySet.add(c.key)
    if (typeof c.label !== 'string' || !c.label.trim()) return { ok: false, error: `criterion.label required for key=${c.key}` }
    if (c.type !== 'pass_fail' && c.type !== 'likert_1_5' && c.type !== 'score_0_100') {
      return { ok: false, error: `criterion.type invalid for key=${c.key}` }
    }
  }
  return { ok: true, value: body as Rubric }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = getRubric(id)
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(r)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const existing = getRubric(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const v = validate(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  if (v.value.id !== id) return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  // builtin 可以编辑（跟 datasets 一致）；保留 source 字段
  const saved = saveRubric({ ...v.value, ...(existing.source !== undefined ? { source: existing.source } : {}) })
  return NextResponse.json(saved)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteRubric(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
