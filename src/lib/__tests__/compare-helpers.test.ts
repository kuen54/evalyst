import { describe, it, expect } from 'vitest'
import { findComparableExperiments, buildCompareHref, compareGroupOf } from '../compare-helpers'

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
