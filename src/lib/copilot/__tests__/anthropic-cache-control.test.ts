import { describe, it, expect } from 'vitest'
import { applyAnthropicCacheControl } from '../anthropic-cache-control'

describe('applyAnthropicCacheControl system handling', () => {
  it('system 是 string → 转 array of one block + cache_control', () => {
    const body = {
      system: 'You are a helpful assistant',
      messages: [],
    }
    applyAnthropicCacheControl(body)
    expect(Array.isArray(body.system)).toBe(true)
    const arr = body.system as unknown as Array<Record<string, unknown>>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toEqual({
      type: 'text',
      text: 'You are a helpful assistant',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('system 是 array of blocks → cache_control 仅加在 last block', () => {
    const body = {
      system: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ] as Array<Record<string, unknown>>,
      messages: [],
    }
    applyAnthropicCacheControl(body)
    const arr = body.system as Array<Record<string, unknown>>
    expect(arr[0].cache_control).toBeUndefined()
    expect(arr[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('system 缺失 → no-op', () => {
    const body = { messages: [] }
    applyAnthropicCacheControl(body)
    expect((body as { system?: unknown }).system).toBeUndefined()
  })

  it('system 是空字符串 → no-op（不转 array）', () => {
    const body = { system: '', messages: [] }
    applyAnthropicCacheControl(body)
    expect(body.system).toBe('')
  })

  it('重复调用幂等（已有 cache_control 不重复加）', () => {
    const body = {
      system: 'x',
      messages: [],
    }
    applyAnthropicCacheControl(body)
    const firstArr = body.system as unknown as Array<Record<string, unknown>>
    const firstControl = firstArr[0].cache_control
    applyAnthropicCacheControl(body as typeof body & { system: typeof firstArr })
    const secondArr = body.system as unknown as Array<Record<string, unknown>>
    expect(secondArr).toHaveLength(1)
    expect(secondArr[0].cache_control).toEqual(firstControl)
  })
})

describe('applyAnthropicCacheControl messages handling', () => {
  it('messages 长度 = 0 → no-op', () => {
    const body = { messages: [] }
    applyAnthropicCacheControl(body)
    expect(body.messages).toEqual([])
  })

  it('messages 长度 = 1 → 对这一条 mutate', () => {
    const body = {
      messages: [{ role: 'user', content: 'hello' }] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    const m0 = body.messages[0]
    expect(Array.isArray(m0.content)).toBe(true)
    const content = m0.content as Array<Record<string, unknown>>
    expect(content[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('messages 长度 = 3 → 全部 3 条 mutate', () => {
    const body = {
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    for (const m of body.messages) {
      const content = m.content as Array<Record<string, unknown>>
      expect(content[0].cache_control).toEqual({ type: 'ephemeral' })
    }
  })

  it('messages 长度 = 5 → 只对最后 3 条 mutate，前 2 条不动', () => {
    const body = {
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'q3' },
      ] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    // 前 2 条保持 string content 不动
    expect(body.messages[0].content).toBe('q1')
    expect(body.messages[1].content).toBe('a1')
    // 后 3 条转 array + cache_control
    for (let i = 2; i < 5; i++) {
      const content = body.messages[i].content as Array<Record<string, unknown>>
      expect(content[0].cache_control).toEqual({ type: 'ephemeral' })
    }
  })

  it('message.content 是 array of multiple blocks（tool_use composite）→ cache_control 仅加在 last block', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'sure, calling' },
            { type: 'tool_use', id: 'c1', name: 'read_context', input: {} },
          ],
        },
      ] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    const content = body.messages[0].content as Array<Record<string, unknown>>
    expect(content).toHaveLength(2)
    expect(content[0].cache_control).toBeUndefined()
    expect(content[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('message.content 是 array with single tool_result block → cache_control on it', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }],
        },
      ] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    const content = body.messages[0].content as Array<Record<string, unknown>>
    expect(content[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('空 content array → 跳过（防御）', () => {
    const body = {
      messages: [{ role: 'user', content: [] }] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    // 不应抛错；content 仍空
    expect(body.messages[0].content).toEqual([])
  })
})

describe('applyAnthropicCacheControl 总 breakpoint 数 ≤ 4', () => {
  it('system + 3 messages = 4 个 breakpoints（Anthropic 上限）', () => {
    const body = {
      system: 'sys',
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ] as Array<Record<string, unknown>>,
    }
    applyAnthropicCacheControl(body)
    let count = 0
    const sys = body.system as unknown as Array<Record<string, unknown>>
    for (const b of sys) if (b.cache_control) count++
    for (const m of body.messages) {
      const content = m.content as Array<Record<string, unknown>>
      for (const b of content) if (b.cache_control) count++
    }
    expect(count).toBe(4)
  })
})
