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

// helpers for "real branch shape" tests below
function compactBoundary(): CopilotMessage {
  return {
    id: `cb_${Math.random().toString(36).slice(2, 8)}`,
    session_id: 's',
    role: 'system',
    content: '',
    timestamp: 't',
    kind: 'compact_boundary',
    at: 't',
  }
}
function asst(text: string): CopilotMessage {
  return { id: `a_${Math.random().toString(36).slice(2, 8)}`, session_id: 's', role: 'assistant', content: text, timestamp: 't' }
}
function userMsg(text: string): CopilotMessage {
  return { id: `u_${Math.random().toString(36).slice(2, 8)}`, session_id: 's', role: 'user', content: text, timestamp: 't' }
}

describe('analyzeToolLoop · isFailure 识别 v2.5 P2 ToolError shape (regression)', () => {
  // v2.5 P2 后 /tool-result route 把 runTool error 落盘成 { ok: false, error: { code, message } }
  // （runTool 不再 catch 后包装成 { error: msg }，而是 ToolError shape）。
  // isFailure() 必须能识别这种新 shape，否则 exact-failure / same-tool 两档对 ToolError
  // 静默失效 —— LLM 反复调失败工具不再被 block。
  function failNew(callId: string, name: string, input: Record<string, unknown>): CopilotMessage[] {
    return [
      toolUse(callId, name, input),
      {
        id: `tr_${callId}`, session_id: 's', role: 'tool_result',
        content: JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', message: 'x' } }),
        timestamp: 't',
        call_id: callId, tool_name: name,
      },
    ]
  }

  it('5 次新 ToolError shape 失败 → block (exact-failure)', () => {
    const branch: CopilotMessage[] = [
      ...failNew('1', 'read_context', { id: 'ctx_1' }),
      ...failNew('2', 'read_context', { id: 'ctx_1' }),
      ...failNew('3', 'read_context', { id: 'ctx_1' }),
      ...failNew('4', 'read_context', { id: 'ctx_1' }),
      ...failNew('5', 'read_context', { id: 'ctx_1' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('block')
  })

  it('2 次新 ToolError shape 失败 → warn (exact-failure)', () => {
    const branch = [
      ...failNew('1', 'read_context', { id: 'ctx_1' }),
      ...failNew('2', 'read_context', { id: 'ctx_1' }),
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('warn')
  })
})

describe('analyzeToolLoop · 真实 branch 形态（v2.5 P0 hotfix）', () => {
  it('hanging tool_use 在末端时仍能扫到前面的 pair', () => {
    // /tool-result POST 时 branchBefore 末尾是刚 append 的 tool_use（待计算 result），
    // collectTrailingPairs 必须先跳过这个 hanging tool_use 才能看到前面的 pair。
    const branch: CopilotMessage[] = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      toolUse('3', 'read_context', { id: 'ctx_1' }),  // hanging — 这次 LLM 调用还没拿到 result
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('warn')
    if (r.action === 'warn') expect(r.reasonVars.count).toBe(2)
  })

  it('compact_boundary 在每对 pair 之间不打断扫描', () => {
    // v2.5 M2 microCompact 会在每个 tool_result 后 append 一条 system_compact_boundary。
    // 检测器必须 hop over system messages 才能识别真实的 trailing pair 串。
    const branch: CopilotMessage[] = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      compactBoundary(),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      compactBoundary(),
      ...fail('3', 'read_context', { id: 'ctx_1' }),
      compactBoundary(),
      ...fail('4', 'read_context', { id: 'ctx_1' }),
      compactBoundary(),
      ...fail('5', 'read_context', { id: 'ctx_1' }),
      compactBoundary(),
      toolUse('6', 'read_context', { id: 'ctx_1' }),  // hanging
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('block')
    if (r.action === 'block') expect(r.reasonVars.count).toBe(5)
  })

  it('assistant text 在 pair 之间打断扫描（intentional：策略变更）', () => {
    const branch: CopilotMessage[] = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      asst('let me think differently'),
      ...fail('3', 'read_context', { id: 'ctx_1' }),
      toolUse('4', 'read_context', { id: 'ctx_1' }),  // hanging
    ]
    // 只有 fail('3') 那对在 trailing 段；exactFailCount=1 → proceed
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('proceed')
  })

  it('user text 在 pair 之间打断扫描（重新发问 = 重置）', () => {
    const branch: CopilotMessage[] = [
      ...fail('1', 'read_context', { id: 'ctx_1' }),
      ...fail('2', 'read_context', { id: 'ctx_1' }),
      asst('done'),
      userMsg('再来一次'),
      compactBoundary(),
      toolUse('3', 'read_context', { id: 'ctx_1' }),  // hanging
    ]
    const r = analyzeToolLoop(branch, 'read_context', { id: 'ctx_1' })
    expect(r.action).toBe('proceed')
  })
})
