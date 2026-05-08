import { describe, it, expect } from 'vitest'
import { analyzeToolLoop, DEFAULT_LOOP_CONFIG } from '../tool-loop-detector'
import type { CopilotMessage } from '../types'

function toolUse(callId: string, name: string, input: Record<string, unknown>): CopilotMessage {
  return {
    id: `tu_${callId}`, session_id: 's', role: 'tool_use',
    content: '', timestamp: 't',
    call_id: callId, tool_name: name, tool_input: input,
  }
}
function toolResult(callId: string, name: string, content: unknown): CopilotMessage {
  return {
    id: `tr_${callId}`, session_id: 's', role: 'tool_result',
    content: JSON.stringify(content), timestamp: 't',
    call_id: callId, tool_name: name,
  }
}
function fail(callId: string, name: string, input: Record<string, unknown>): CopilotMessage[] {
  return [toolUse(callId, name, input), toolResult(callId, name, { error: 'boom' })]
}
function ok(callId: string, name: string, input: Record<string, unknown>, output: unknown): CopilotMessage[] {
  return [toolUse(callId, name, input), toolResult(callId, name, output)]
}

describe('analyzeToolLoop · empty / proceed', () => {
  it('空 branch → proceed', () => {
    expect(analyzeToolLoop([], 'read_context', {})).toEqual({ action: 'proceed' })
  })
  it('1 次成功 → proceed', () => {
    const branch = ok('1', 'read_context', { id: 'ctx_1' }, { value: 'foo' })
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })).toEqual({ action: 'proceed' })
  })
})

describe('analyzeToolLoop · exact-failure（同 args 失败）', () => {
  it('1 次失败下次 proceed', () => {
    const branch = fail('1', 'read_context', { id: 'ctx_1' })
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })).toEqual({ action: 'proceed' })
  })
  it('2 次失败下次 warn', () => {
    const branch = [...fail('1', 'read_context', { id: 'ctx_1' }), ...fail('2', 'read_context', { id: 'ctx_1' })]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('warn')
  })
  it('5 次失败下次 block', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      ...fail('3', 'read_context', { id: 'ctx_1' }),
      ...fail('4', 'read_context', { id: 'ctx_1' }),
      ...fail('5', 'read_context', { id: 'ctx_1' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('block')
  })
  it('换 args 重置计数', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
    ]
    expect(analyzeToolLoop(branch, 'read_context', { id: 'ctx_2' })).toEqual({ action: 'proceed' })
  })
  it('4 次失败下次 warn（count >= threshold 边界，不触发 block）', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      ...fail('3', 'read_context', { id: 'ctx_1' }),
      ...fail('4', 'read_context', { id: 'ctx_1' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('warn')
    if (r.action === 'warn') expect(r.reasonVars.count).toBe(4)
  })
})

describe('analyzeToolLoop · same-tool（同工具任意 args 失败）', () => {
  it('3 次不同 args 失败下次 warn', () => {
    const branch = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_2' }),
      ...fail('3', 'read_context', { id: 'ctx_3' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_4' })
    expect(r.action).toBe('warn')
  })
  it('8 次不同 args 失败下次 block', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 8; i++) {
      branch.push(...fail(String(i), 'read_context', { id: `ctx_${i}` }))
    }
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_9' })
    expect(r.action).toBe('block')
  })
})

describe('analyzeToolLoop · no-progress（同 args 成功但输出 identical）', () => {
  it('2 次相同 args + 相同 output 下次 warn', () => {
    const branch = [
      ...ok('1', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
      ...ok('2', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
    ]
    const r = analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })
    expect(r.action).toBe('warn')
  })
  it('5 次相同 args + 相同 output 下次 block', () => {
    const branch: CopilotMessage[] = []
    for (let i = 1; i <= 5; i++) {
      branch.push(...ok(String(i), 'read_tool_result', { ref: 'r1' }, { value: 'foo' }))
    }
    const r = analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })
    expect(r.action).toBe('block')
  })
  it('output 不同（哪怕一字符）则不算 no-progress', () => {
    const branch = [
      ...ok('1', 'read_tool_result', { ref: 'r1' }, { value: 'foo' }),
      ...ok('2', 'read_tool_result', { ref: 'r1' }, { value: 'foo2' }),
    ]
    expect(analyzeToolLoop(branch, 'read_tool_result', { ref: 'r1' })).toEqual({ action: 'proceed' })
  })
})

describe('analyzeToolLoop · DEFAULT_LOOP_CONFIG 正确', () => {
  it('阈值常量值正确', () => {
    expect(DEFAULT_LOOP_CONFIG).toMatchObject({
      exactFailureWarn: 2, exactFailureBlock: 5,
      sameToolFailureWarn: 3, sameToolFailureHalt: 8,
      noProgressWarn: 2, noProgressBlock: 5,
    })
  })
})
