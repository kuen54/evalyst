import { describe, it, expect } from 'vitest'
import { findComparableExperiments, buildCompareHref, compareGroupOf, rowLabel } from '../compare-helpers'

describe('compareGroupOf', () => {
  it('returns explicit compare_group when set', () => {
    expect(compareGroupOf({ id: 'cot_v1', compare_group: 'gsm8k_group' })).toBe('gsm8k_group')
  })

  it('falls back to schema id when compare_group absent', () => {
    expect(compareGroupOf({ id: 'cot_v1' })).toBe('cot_v1')
  })

  it('returns undefined for undefined schema', () => {
    expect(compareGroupOf(undefined)).toBe(undefined)
  })
})

describe('findComparableExperiments', () => {
  const schemas = [
    { id: 'cot_v1', compare_group: 'gsm8k_group' },
    { id: 'direct_v1', compare_group: 'gsm8k_group' },
    { id: 'fewshot_v1', compare_group: 'gsm8k_group' },
    { id: 'qa_answer_v1' },                              // no compare_group → fallback to id
    { id: 'belle_plain_v1', compare_group: 'belle_group' },
  ]

  it('finds experiments with same compare_group via different schemas', () => {
    const current = { id: 'exp1', schema_id: 'cot_v1' }
    const pool = [
      { id: 'exp1', schema_id: 'cot_v1' },                // self — should be excluded
      { id: 'exp2', schema_id: 'direct_v1' },             // same group via direct_v1
      { id: 'exp3', schema_id: 'fewshot_v1' },            // same group via fewshot_v1
      { id: 'exp4', schema_id: 'qa_answer_v1' },          // different group (fallback to qa_answer_v1)
      { id: 'exp5', schema_id: 'belle_plain_v1' },        // different group (belle_group)
    ]
    const result = findComparableExperiments(current, schemas, pool)
    expect(result.map(e => e.id)).toEqual(['exp2', 'exp3'])
  })

  it('returns empty when no other experiment shares group', () => {
    const current = { id: 'exp1', schema_id: 'cot_v1' }
    const pool = [
      { id: 'exp1', schema_id: 'cot_v1' },
      { id: 'exp99', schema_id: 'belle_plain_v1' },
    ]
    expect(findComparableExperiments(current, schemas, pool)).toEqual([])
  })

  it('treats schemas without compare_group as their own group', () => {
    const current = { id: 'exp_a', schema_id: 'qa_answer_v1' }
    const pool = [
      { id: 'exp_a', schema_id: 'qa_answer_v1' },
      { id: 'exp_b', schema_id: 'qa_answer_v1' },         // same fallback group
      { id: 'exp_c', schema_id: 'cot_v1' },               // different group
    ]
    const result = findComparableExperiments(current, schemas, pool)
    expect(result.map(e => e.id)).toEqual(['exp_b'])
  })

  it('excludes the current experiment from results', () => {
    const current = { id: 'exp1', schema_id: 'cot_v1' }
    const pool = [{ id: 'exp1', schema_id: 'cot_v1' }]
    expect(findComparableExperiments(current, schemas, pool)).toEqual([])
  })

  it('returns empty when current schema_id is unknown', () => {
    const current = { id: 'exp1' } as { id: string; schema_id?: string }
    const pool = [{ id: 'exp2', schema_id: 'cot_v1' }]
    expect(findComparableExperiments(current, schemas, pool)).toEqual([])
  })

  it('handles experiments whose schema is not in the schemas list (fallback to schema_id as group)', () => {
    const current = { id: 'exp1', schema_id: 'cot_v1' }
    const pool = [
      { id: 'exp1', schema_id: 'cot_v1' },
      { id: 'exp2', schema_id: 'gsm8k_group' },           // schema_id matches the group string itself
    ]
    // exp2 falls back to schema_id 'gsm8k_group'; current's group is also 'gsm8k_group' → match
    const result = findComparableExperiments(current, schemas, pool)
    expect(result.map(e => e.id)).toEqual(['exp2'])
  })
})

describe('buildCompareHref', () => {
  it('places current id at the head and comma-joins others', () => {
    expect(buildCompareHref({ id: 'a' }, [{ id: 'b' }, { id: 'c' }])).toBe('/compare?ids=a,b,c')
  })

  it('returns null when comparable is empty', () => {
    expect(buildCompareHref({ id: 'a' }, [])).toBe(null)
  })

  it('encodes single comparable correctly', () => {
    expect(buildCompareHref({ id: 'exp1' }, [{ id: 'exp2' }])).toBe('/compare?ids=exp1,exp2')
  })
})

describe('rowLabel', () => {
  const preview = {
    'p.pid': 'prod_001',
    'p.name': '轻氧空气感蓬蓬粉',
    'p.category': '美妆',
    'p.price': '¥158',
    'p.target_user': '25-35 岁通勤女性，油性肌',
    'p.core_features': ['微米级粉体', '保湿不卡纹', '持妆8小时'],
  }

  it('uses header_fields when schema declares them', () => {
    const schema = {
      display_dimensions: [{
        field: 'input_preview.p.category',
        header_fields: [
          { field: 'input_preview.p.name', label: '商品' },
          { field: 'input_preview.p.target_user', label: '目标用户' },
          { field: 'input_preview.p.price', label: '价' },
        ],
      }],
    }
    const label = rowLabel({ p: 'prod_001' }, preview, schema)
    expect(label).toContain('商品: 轻氧空气感蓬蓬粉')
    expect(label).toContain('目标用户: 25-35 岁通勤女性，油性肌')
    expect(label).toContain('价: ¥158')
  })

  it('joins arrays with 、 in header_fields rendering', () => {
    const schema = {
      display_dimensions: [{
        field: 'input_preview.p.category',
        header_fields: [{ field: 'input_preview.p.core_features', label: '卖点' }],
      }],
    }
    expect(rowLabel({ p: 'prod_001' }, preview, schema))
      .toBe('卖点: 微米级粉体、保湿不卡纹、持妆8小时')
  })

  it('truncates long header field values to 60 chars + …', () => {
    const longPreview = { 'p.name': 'x'.repeat(80) }
    const schema = {
      display_dimensions: [{
        field: 'input_preview.p.category',
        header_fields: [{ field: 'input_preview.p.name', label: 'L' }],
      }],
    }
    const label = rowLabel({ p: 'prod_001' }, longPreview, schema)
    expect(label.length).toBeLessThan(80)
    expect(label.endsWith('…')).toBe(true)
  })

  it('accepts bare "p.name" form (without input_preview. prefix) in field path', () => {
    const schema = {
      display_dimensions: [{
        field: 'input_preview.p.category',
        header_fields: [{ field: 'p.name', label: '商品' }],
      }],
    }
    expect(rowLabel({ p: 'prod_001' }, preview, schema)).toContain('商品: 轻氧空气感蓬蓬粉')
  })

  it('skips empty / null header field values', () => {
    const sparse = { 'p.name': '商品 A', 'p.target_user': '' }
    const schema = {
      display_dimensions: [{
        field: 'input_preview.p.category',
        header_fields: [
          { field: 'input_preview.p.name', label: 'N' },
          { field: 'input_preview.p.target_user', label: 'T' },
        ],
      }],
    }
    const label = rowLabel({ p: 'prod_001' }, sparse, schema)
    expect(label).toContain('N: 商品 A')
    expect(label).not.toContain('T:')
  })

  it('falls back to first non-id field when schema has no header_fields', () => {
    const label = rowLabel({ p: 'prod_001' }, preview)
    // Skips p.pid (value === ref id "prod_001") → picks p.name
    expect(label).toBe('p#prod_001 · 轻氧空气感蓬蓬粉')
  })

  it('fallback: skips values equal to ref id (no more "p#prod_001 · prod_001")', () => {
    const previewIdOnly = { 'p.pid': 'prod_001' }
    const label = rowLabel({ p: 'prod_001' }, previewIdOnly)
    expect(label).toBe('p#prod_001')                         // no degenerate "· prod_001"
  })

  it('fallback: handles multiple aliases (e.g. RAG with both q and ctx)', () => {
    const refs = { q: 'q01', ctx: 'ctx_5' }
    const multiPreview = { 'q.text': '什么是评测', 'ctx.snippet': '评测就是...' }
    const label = rowLabel(refs, multiPreview)
    // sorted alias order: ctx, q
    expect(label).toContain('ctx#ctx_5 · 评测就是...')
    expect(label).toContain('q#q01 · 什么是评测')
  })
})
