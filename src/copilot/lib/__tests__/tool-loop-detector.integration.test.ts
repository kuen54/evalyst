import { describe, it, expect } from 'vitest'
import { analyzeToolLoop } from '../tool-loop-detector'
import type { CopilotMessage } from '../types'

describe('tool-loop-detector integration（v2.5 P0）', () => {
  it('5 次成功 read_context 不被 block（原硬 cap 5 已失效）', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 5; i++) {
      branch.push({
        id: `tu_${i}`, session_id: 's', role: 'tool_use',
        content: '', timestamp: 't',
        call_id: `c${i}`, tool_name: 'read_context', tool_input: { id: `ctx_${i}` },
      })
      branch.push({
        id: `tr_${i}`, session_id: 's', role: 'tool_result',
        content: JSON.stringify({ value: `v${i}` }), timestamp: 't',
        call_id: `c${i}`, tool_name: 'read_context',
      })
    }
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_6' })
    expect(r.action).toBe('proceed')
  })
})
