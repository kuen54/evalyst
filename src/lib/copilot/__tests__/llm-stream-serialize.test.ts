import { describe, it, expect } from 'vitest'
import { serializeMessagesForProvider } from '../llm-stream'
import type { LlmMessage } from '../../llm-client'

describe('serializeMessagesForProvider — OpenAI', () => {
  it('serializes tool_use message to assistant + tool_calls', () => {
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

  it('passes system/user/assistant text messages through unchanged', () => {
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
})

describe('serializeMessagesForProvider — Anthropic', () => {
  it('serializes tool_use message to assistant + tool_use content block', () => {
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
})
