import { describe, it, expect } from 'vitest'
import { isSessionAllowed } from '../session-allow'

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
