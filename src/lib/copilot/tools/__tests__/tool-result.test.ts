import { describe, it, expect } from 'vitest'
import { ok, err, isToolErrorShape, type ToolErrorCode } from '../tool-result'

describe('ok / err helpers', () => {
  it('ok wraps value with kind:true', () => {
    expect(ok({ x: 1 })).toEqual({ ok: true, value: { x: 1 } })
  })

  it('err builds ToolError with required fields', () => {
    expect(err('NOT_FOUND', 'gone')).toEqual({
      ok: false, error: { code: 'NOT_FOUND', message: 'gone' },
    })
  })

  it('err with hint + retry_safe', () => {
    expect(err('RATE_LIMIT', 'slow down', { hint: 'wait 60s', retry_safe: true })).toEqual({
      ok: false, error: { code: 'RATE_LIMIT', message: 'slow down', hint: 'wait 60s', retry_safe: true },
    })
  })

  it('all 9 ToolErrorCodes type-check', () => {
    const codes: ToolErrorCode[] = [
      'INVALID_INPUT', 'NOT_FOUND', 'UNAUTHORIZED', 'CONFLICT',
      'RATE_LIMIT', 'NETWORK', 'USER_DENIED', 'AWAITING_CONFIRM', 'INTERNAL',
    ]
    expect(codes).toHaveLength(9)
  })
})

describe('isToolErrorShape', () => {
  it('new ToolResult err shape → true', () => {
    expect(isToolErrorShape({ ok: false, error: { code: 'INTERNAL', message: 'boom' } })).toBe(true)
  })

  it('new ToolResult ok shape → false', () => {
    expect(isToolErrorShape({ ok: true, value: { x: 1 } })).toBe(false)
  })

  it('legacy { error: "msg" } shape → true (route handler ad-hoc wrap)', () => {
    expect(isToolErrorShape({ error: 'experiment_id is required' })).toBe(true)
  })

  it('legacy { error: { ... } } object → true', () => {
    expect(isToolErrorShape({ error: { foo: 'bar' } })).toBe(true)
  })

  it('legacy { denied: true, reason } → true', () => {
    expect(isToolErrorShape({ denied: true, reason: 'user said no' })).toBe(true)
  })

  it('plain object without error/ok/denied → false', () => {
    expect(isToolErrorShape({ results: [], total: 0 })).toBe(false)
  })

  it('null / undefined / primitives → false', () => {
    expect(isToolErrorShape(null)).toBe(false)
    expect(isToolErrorShape(undefined)).toBe(false)
    expect(isToolErrorShape('error')).toBe(false)
    expect(isToolErrorShape(42)).toBe(false)
  })

  it('malformed { ok: false, error: "string" } falls through to legacy branch → true', () => {
    expect(isToolErrorShape({ ok: false, error: 'oops' })).toBe(true)
  })

  it('{ ok: false } with no error key → false', () => {
    expect(isToolErrorShape({ ok: false })).toBe(false)
  })

  it('{ ok: false, error: null } → true (legacy "error" key existence)', () => {
    expect(isToolErrorShape({ ok: false, error: null })).toBe(true)
  })
})
