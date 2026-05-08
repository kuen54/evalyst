import { describe, it, expect } from 'vitest'
import { __testOnly } from '../llm-stream'
import type { StreamEvent } from '../types'

type UsageAccumulator = {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
}

function sseBlock(event: string, data: unknown): string {
  if (event) return `event: ${event}\ndata: ${JSON.stringify(data)}`
  return `data: ${JSON.stringify(data)}`
}

describe('parseAnthropicEvent cache fields', () => {
  it('message_start: reads cache_creation_input_tokens + cache_read_input_tokens', () => {
    const usage: UsageAccumulator = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseAnthropicEvent(
      sseBlock('message_start', {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 100, output_tokens: 0,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 50,
          },
        },
      }),
      (_ev: StreamEvent) => {},  // onEvent
      usage,
      (_r: string) => {},         // setReason
      new Map(),                  // toolState
    )
    expect(usage.cache_creation_tokens).toBe(200)
    expect(usage.cache_read_tokens).toBe(50)
    expect(usage.input_tokens).toBe(100)
  })

  it('message_delta: updates cache_read_tokens when present', () => {
    const usage: UsageAccumulator = {
      input_tokens: 100, output_tokens: 10, cache_read_tokens: 50,
    }
    __testOnly.parseAnthropicEvent(
      sseBlock('message_delta', {
        type: 'message_delta',
        delta: {},
        usage: { cache_read_input_tokens: 80 },
      }),
      (_ev: StreamEvent) => {},
      usage,
      (_r: string) => {},
      new Map(),
    )
    expect(usage.cache_read_tokens).toBe(80)
  })
})

describe('parseOpenaiEvent cache fields', () => {
  // parseOpenaiEvent signature is 6 args: (block, onEvent, usage, setReason, emitDoneOnce, toolState)
  it('reads prompt_tokens_details.cached_tokens (standard path)', () => {
    const usage: UsageAccumulator = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseOpenaiEvent(
      sseBlock('', {
        choices: [],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 80,
          prompt_tokens_details: { cached_tokens: 300 },
        },
      }),
      (_ev: StreamEvent) => {},
      usage,
      (_r: string) => {},
      () => {},       // emitDoneOnce
      new Map(),      // toolState
    )
    expect(usage.cache_read_tokens).toBe(300)
    expect(usage.input_tokens).toBe(500)
  })

  it('falls back to top-level cache_read_tokens for non-standard compat layers', () => {
    const usage: UsageAccumulator = { input_tokens: 0, output_tokens: 0 }
    __testOnly.parseOpenaiEvent(
      sseBlock('', {
        choices: [],
        usage: {
          prompt_tokens: 200, completion_tokens: 20,
          cache_read_tokens: 100,
        },
      }),
      (_ev: StreamEvent) => {},
      usage,
      (_r: string) => {},
      () => {},
      new Map(),
    )
    expect(usage.cache_read_tokens).toBe(100)
  })
})
