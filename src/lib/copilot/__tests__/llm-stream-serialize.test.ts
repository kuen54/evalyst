import { describe, it, expect } from 'vitest'
import { serializeMessagesForProvider, __testOnly } from '../llm-stream'
import type { LlmMessage } from '../../llm-client'

describe('serializeMessagesForProvider — OpenAI', () => {
  it('serializes a lone tool_use into a composite assistant (content: null + tool_calls)', () => {
    const msgs: LlmMessage[] = [
      {
        role: 'tool_use',
        call_id: 'call_abc',
        tool_name: 'list_experiments',
        tool_input: { status: 'completed', limit: 5 },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'list_experiments',
              arguments: JSON.stringify({ status: 'completed', limit: 5 }),
            },
          },
        ],
      },
    ])
  })

  it('merges assistant text + tool_use into one composite assistant', () => {
    const msgs: LlmMessage[] = [
      { role: 'assistant', content: 'Let me check the experiments first' },
      {
        role: 'tool_use',
        call_id: 'call_abc',
        tool_name: 'list_experiments',
        tool_input: { status: 'completed' },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: 'Let me check the experiments first',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'list_experiments',
              arguments: JSON.stringify({ status: 'completed' }),
            },
          },
        ],
      },
    ])
  })

  it('merges multiple consecutive tool_use messages into one tool_calls array', () => {
    const msgs: LlmMessage[] = [
      { role: 'assistant', content: 'Checking both' },
      { role: 'tool_use', call_id: 'call_1', tool_name: 'list_experiments', tool_input: {} },
      {
        role: 'tool_use',
        call_id: 'call_2',
        tool_name: 'read_experiment_results',
        tool_input: { experiment_id: 'exp_x' },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: 'Checking both',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_experiments', arguments: JSON.stringify({}) },
          },
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'read_experiment_results',
              arguments: JSON.stringify({ experiment_id: 'exp_x' }),
            },
          },
        ],
      },
    ])
  })

  it('serializes tool_result message to role=tool + tool_call_id', () => {
    const msgs: LlmMessage[] = [
      { role: 'tool_result', call_id: 'call_abc', content: '{"experiments":[],"total":0}' },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_abc',
        content: '{"experiments":[],"total":0}',
      },
    ])
  })

  it('passes system/user text messages through unchanged; standalone assistant text too', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'You are Evalyst Copilot.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      { role: 'system', content: 'You are Evalyst Copilot.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
    ])
  })

  it('echoes Gemini thought_signature in tool_calls[].extra_content.google slot when present', () => {
    // Gemini 2.5 / 3.x thinking 模式下，tool_use 必须带 thought_signature 回显；
    // 缺失会让 Vertex 400 "function call ... missing a thought_signature"。
    // Sankuai/Vertex OpenAI-compat 把签名放在 tool_call.extra_content.google 槽，不在 function 里。
    const msgs: LlmMessage[] = [
      {
        role: 'tool_use',
        call_id: 'call_abc',
        tool_name: 'list_experiments',
        tool_input: { status: 'completed' },
        thought_signature: 'sig_abc',
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'list_experiments',
              arguments: JSON.stringify({ status: 'completed' }),
            },
            extra_content: { google: { thought_signature: 'sig_abc' } },
          },
        ],
      },
    ])
  })

  it('omits extra_content field when signature absent (non-Gemini providers unchanged)', () => {
    const msgs: LlmMessage[] = [
      {
        role: 'tool_use',
        call_id: 'call_xyz',
        tool_name: 'list_experiments',
        tool_input: {},
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'openai')
    const composite = out[0] as { tool_calls: Array<Record<string, unknown>> }
    expect(composite.tool_calls[0]).not.toHaveProperty('extra_content')
  })
})

describe('serializeMessagesForProvider — Anthropic', () => {
  it('serializes a lone tool_use into a composite assistant (only tool_use block)', () => {
    const msgs: LlmMessage[] = [
      {
        role: 'tool_use',
        call_id: 'toolu_01',
        tool_name: 'read_experiment_results',
        tool_input: { experiment_id: 'exp_123', status: 'error' },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'read_experiment_results',
            input: { experiment_id: 'exp_123', status: 'error' },
          },
        ],
      },
    ])
  })

  it('merges assistant text + tool_use into one composite assistant (text block + tool_use block)', () => {
    const msgs: LlmMessage[] = [
      { role: 'assistant', content: 'Let me check the experiments first' },
      {
        role: 'tool_use',
        call_id: 'toolu_01',
        tool_name: 'list_experiments',
        tool_input: { status: 'completed' },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check the experiments first' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'list_experiments',
            input: { status: 'completed' },
          },
        ],
      },
    ])
  })

  it('merges multiple tool_use messages under one composite assistant', () => {
    const msgs: LlmMessage[] = [
      { role: 'tool_use', call_id: 'toolu_01', tool_name: 'list_experiments', tool_input: {} },
      {
        role: 'tool_use',
        call_id: 'toolu_02',
        tool_name: 'read_experiment_results',
        tool_input: { experiment_id: 'exp_y' },
      },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_01', name: 'list_experiments', input: {} },
          {
            type: 'tool_use',
            id: 'toolu_02',
            name: 'read_experiment_results',
            input: { experiment_id: 'exp_y' },
          },
        ],
      },
    ])
  })

  it('serializes tool_result message to user + tool_result content block', () => {
    const msgs: LlmMessage[] = [
      { role: 'tool_result', call_id: 'toolu_01', content: '{"results":[],"total_matching":0}' },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: '{"results":[],"total_matching":0}',
          },
        ],
      },
    ])
  })

  it('filters out system messages (caller aggregates separately) and keeps user/assistant', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('handles full turn-cycle: user → [assistant+tool_use] → tool_result → assistant', () => {
    const msgs: LlmMessage[] = [
      { role: 'user', content: 'show me exp_a results' },
      { role: 'assistant', content: 'Let me read it.' },
      {
        role: 'tool_use',
        call_id: 'toolu_01',
        tool_name: 'read_experiment_results',
        tool_input: { experiment_id: 'exp_a' },
      },
      { role: 'tool_result', call_id: 'toolu_01', content: '{"results":[]}' },
      { role: 'assistant', content: 'No results found.' },
    ]
    const out = serializeMessagesForProvider(msgs, 'anthropic')
    expect(out).toEqual([
      { role: 'user', content: 'show me exp_a results' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read it.' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'read_experiment_results',
            input: { experiment_id: 'exp_a' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: '{"results":[]}' },
        ],
      },
      { role: 'assistant', content: 'No results found.' },
    ])
  })
})

describe('buildStreamingRequestBody · 4-breakpoint cache_control (v2.5 P1a)', () => {
  it('Anthropic format: system + 最后 3 条 messages 都被加 cache_control', () => {
    const body = __testOnly.buildStreamingRequestBody({
      config: { api_format: 'anthropic', base_url: 'https://x', api_key: 'k' },
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
    })
    // system 被转成 array + cache_control
    expect(Array.isArray(body.system)).toBe(true)
    const sys = body.system as Array<Record<string, unknown>>
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
    // 最后 3 条 messages 各带 cache_control
    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(3)
    for (const m of messages) {
      const content = m.content as Array<Record<string, unknown>>
      expect(content[content.length - 1].cache_control).toEqual({ type: 'ephemeral' })
    }
  })

  it('OpenAI format: body 里完全无 cache_control（防误注入）', () => {
    const body = __testOnly.buildStreamingRequestBody({
      config: { api_format: 'openai', base_url: 'https://x', api_key: 'k' },
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'q' },
      ],
    })
    const json = JSON.stringify(body)
    expect(json).not.toContain('cache_control')
    expect(json).not.toContain('ephemeral')
  })
})
