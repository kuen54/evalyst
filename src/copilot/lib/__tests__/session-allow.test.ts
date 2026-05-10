import { describe, it, expect } from 'vitest'
import { isSessionAllowed, isSessionDenied } from '../session-allow'

describe('isSessionAllowed (pure function, server + client shared)', () => {
  it('returns false when allowList is undefined', () => {
    expect(isSessionAllowed(undefined, 'edit_template')).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isSessionAllowed([], 'edit_template')).toBe(false)
  })

  it('returns true when toolName is in list', () => {
    expect(isSessionAllowed(['edit_template', 'restart_experiment'], 'edit_template')).toBe(true)
  })

  it('returns false when toolName missing', () => {
    expect(isSessionAllowed(['edit_template'], 'restart_experiment')).toBe(false)
  })

  it('is exact match, not substring', () => {
    expect(isSessionAllowed(['edit_template'], 'edit_template_v2')).toBe(false)
    expect(isSessionAllowed(['edit'], 'edit_template')).toBe(false)
  })
})

describe('isSessionDenied (v2.5 P0 §3.3)', () => {
  it('returns false when denyList is undefined', () => {
    expect(isSessionDenied(undefined, 'restart_experiment')).toBe(false)
  })
  it('returns false for empty array', () => {
    expect(isSessionDenied([], 'restart_experiment')).toBe(false)
  })
  it('returns true when toolName is in list', () => {
    expect(isSessionDenied(['restart_experiment', 'edit_template'], 'restart_experiment')).toBe(true)
  })
  it('returns false when toolName missing', () => {
    expect(isSessionDenied(['restart_experiment'], 'edit_template')).toBe(false)
  })
  it('is exact match, not substring', () => {
    expect(isSessionDenied(['restart'], 'restart_experiment')).toBe(false)
  })
})
