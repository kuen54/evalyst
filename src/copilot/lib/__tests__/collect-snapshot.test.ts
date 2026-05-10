/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { collectClientSnapshot, truncatePreview } from '../collect-snapshot'
import type { PageContext } from '../types'

const pc: PageContext = {
  route_type: 'experiment_detail',
  path: '/experiments/exp_1',
  summary: { id: 'exp_1' },
  timestamp: '2026-04-28T00:00:00Z',
}

describe('truncatePreview', () => {
  it('returns text as-is when under 200 chars', () => {
    expect(truncatePreview('hello world')).toBe('hello world')
  })

  it('collapses whitespace', () => {
    expect(truncatePreview('hello   \n\n  world')).toBe('hello world')
  })

  it('truncates over 200 chars with …', () => {
    const long = 'a'.repeat(250)
    const r = truncatePreview(long)
    expect(r.length).toBe(198) // 197 + 1 unicode ellipsis char
    expect(r.endsWith('…')).toBe(true)
  })
})

describe('collectClientSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns empty viewport_index when no context elements', () => {
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index).toEqual([])
    expect(snap.session_id).toBe('sess')
    expect(snap.page_context).toBe(pc)
    expect(snap.route_type).toBe('experiment_detail')
    expect(snap.path).toBe('/experiments/exp_1')
  })

  it('picks up all data-copilot-context elements with id', () => {
    document.body.innerHTML = `
      <div data-copilot-context="experiment" data-copilot-context-id="exp_1">Experiment 1</div>
      <div data-copilot-context="task_result" data-copilot-context-id="t_1" data-copilot-context-extra='{"experiment_id":"exp_1"}'>Task 1 failed</div>
    `
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index.length).toBe(2)
    expect(snap.viewport_index[0]!.type).toBe('experiment')
    expect(snap.viewport_index[1]!.type).toBe('task_result')
  })

  it('truncates long preview_text', () => {
    const long = 'x'.repeat(300)
    document.body.innerHTML = `<div data-copilot-context="experiment" data-copilot-context-id="exp_1">${long}</div>`
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index[0]!.preview_text.length).toBeLessThanOrEqual(200)
    expect(snap.viewport_index[0]!.preview_text.endsWith('…')).toBe(true)
  })

  it('skips invalid elements (missing id or type)', () => {
    document.body.innerHTML = `
      <div data-copilot-context="experiment">No id</div>
      <div data-copilot-context-id="only-id">No type</div>
      <div data-copilot-context="unknown_type" data-copilot-context-id="x">Unknown type</div>
    `
    const snap = collectClientSnapshot('sess', pc)
    expect(snap.viewport_index).toEqual([])
  })
})
