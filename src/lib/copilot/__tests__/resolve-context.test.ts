import { describe, it, expect } from 'vitest'
import { formatContextsForLlm, type ResolvedContext } from '../resolve-context'
import type { PageContext } from '../types'

function entity(overrides: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    tag: 1,
    type: 'experiment',
    id: 'exp_1',
    status: 'ok',
    summary: 'Exp One',
    data: { id: 'exp_1', name: 'Exp One', model: 'gpt-4' },
    ...overrides,
  }
}

describe('formatContextsForLlm', () => {
  it('returns empty string when nothing ok', () => {
    expect(formatContextsForLlm([])).toBe('')
    expect(formatContextsForLlm([entity({ status: 'missing' })])).toContain('解析失败')
  })

  it('emits single entity + single selection', () => {
    const out = formatContextsForLlm([entity()])
    expect(out).toContain('## 📚 Referenced entities')
    expect(out).toContain('### `experiment:exp_1` — Exp One')
    expect(out).toContain('## 🎯 User selections')
    expect(out).toMatch(/### ■ #1 · EXPERIMENT · Exp One/)
    expect(out).toContain('see entity `experiment:exp_1` in Referenced entities')
  })

  it('dedups shared ancestors across multiple contexts', () => {
    const ctx1: ResolvedContext = {
      tag: 1, type: 'task_field', id: 'task_A#young', status: 'ok',
      summary: 'young = foo',
      data: { field: 'young', value: 'foo' },
      context_chain: [
        { tag: 0, type: 'task_result', id: 'task_A', status: 'ok', summary: 'TR A', data: { task_id: 'task_A' } },
        { tag: 0, type: 'experiment', id: 'exp_1', status: 'ok', summary: 'Exp One', data: { name: 'Exp One' } },
      ],
    }
    const ctx2: ResolvedContext = {
      tag: 2, type: 'task_field', id: 'task_A#mom', status: 'ok',
      summary: 'mom = bar',
      data: { field: 'mom', value: 'bar' },
      context_chain: [
        { tag: 0, type: 'task_result', id: 'task_A', status: 'ok', summary: 'TR A', data: { task_id: 'task_A' } },
        { tag: 0, type: 'experiment', id: 'exp_1', status: 'ok', summary: 'Exp One', data: { name: 'Exp One' } },
      ],
    }
    const out = formatContextsForLlm([ctx1, ctx2])
    const expCount = (out.match(/### `experiment:exp_1` —/g) ?? []).length
    const trCount = (out.match(/### `task_result:task_A` —/g) ?? []).length
    expect(expCount).toBe(1)
    expect(trCount).toBe(1)
    expect(out).toMatch(/### ■ #1 · TASK_FIELD/)
    expect(out).toMatch(/### ■ #2 · TASK_FIELD/)
    // within path with backticked refs
    expect((out.match(/_within_: `task_result:task_A` → `experiment:exp_1`/g) ?? []).length).toBe(2)
  })

  it('inlines text_selection body as blockquote, not as entity', () => {
    const ctx: ResolvedContext = {
      tag: 3, type: 'text_selection', id: 'sel-abc', status: 'ok',
      summary: '清透岩韵里藏着',
      data: { text: '清透岩韵里藏着', length: 7 },
      context_chain: [
        { tag: 0, type: 'task_field', id: 'task_A#young', status: 'ok', summary: 'young', data: { field: 'young', value: 'foo' } },
        { tag: 0, type: 'task_result', id: 'task_A', status: 'ok', summary: 'TR A', data: { task_id: 'task_A' } },
      ],
    }
    const out = formatContextsForLlm([ctx])
    expect(out).toContain('### `task_field:task_A#young`')
    expect(out).toContain('### `task_result:task_A`')
    expect(out).not.toContain('### `text_selection:sel-abc`')
    expect(out).toMatch(/### ■ #3 · TEXT_SELECTION/)
    expect(out).toContain('> 清透岩韵里藏着')
    expect(out).toContain('_within_: `task_field:task_A#young` → `task_result:task_A`')
  })

  it('lists missing contexts in footer', () => {
    const ok = entity({ tag: 1 })
    const missing: ResolvedContext = {
      tag: 2, type: 'experiment', id: 'exp_gone', status: 'missing',
    }
    const out = formatContextsForLlm([ok, missing])
    expect(out).toContain('解析失败的 context')
    expect(out).toContain('**#2** `experiment:exp_gone`: missing')
  })

  it('skips context_chain entries with status != ok', () => {
    const ctx: ResolvedContext = {
      tag: 1, type: 'task_result', id: 'task_X', status: 'ok',
      summary: 'TR X',
      data: { task_id: 'task_X' },
      context_chain: [
        { tag: 0, type: 'experiment', id: 'exp_missing', status: 'missing' },
      ],
    }
    const out = formatContextsForLlm([ctx])
    expect(out).not.toContain('### `experiment:exp_missing`')
    expect(out).not.toMatch(/_within_:.*exp_missing/)
  })
})

describe('formatContextsForLlm with pageContext', () => {
  const pc: PageContext = {
    route_type: 'experiment_detail',
    path: '/experiments/exp_1',
    summary: { id: 'exp_1', name: 'test exp', status: 'completed', progress: { total: 10, success: 9, failed: 1 } },
    timestamp: 'ts',
  }

  it('prepends page_context header when pageContext is provided', () => {
    const out = formatContextsForLlm([], pc)
    expect(out).toContain('# 当前页面')
    expect(out).toContain('/experiments/exp_1')
    expect(out).toContain('experiment_detail')
    expect(out).toContain('- id: exp_1')
    expect(out).toContain('- name: test exp')
  })

  it('stringifies nested objects in summary', () => {
    const out = formatContextsForLlm([], pc)
    expect(out).toContain('- progress: `{"total":10,"success":9,"failed":1}`')
  })

  it('returns empty string when no pageContext and no resolved', () => {
    expect(formatContextsForLlm([])).toBe('')
    expect(formatContextsForLlm([], null)).toBe('')
  })

  it('renders both page_context and user selections', () => {
    const resolved = [{ tag: 1, type: 'experiment', id: 'exp_1', status: 'ok' as const, summary: 's', data: { id: 'exp_1' } }]
    const out = formatContextsForLlm(resolved, pc)
    expect(out).toContain('# 当前页面')
    expect(out).toContain('# 用户圈选的上下文 (context)')
  })
})
