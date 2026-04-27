import { describe, it, expect } from 'vitest'
import { captureFromElement, elementKey, parseElementKey, toContextRef } from '../context-registry'

// 避免 jsdom 依赖：伪造一个最小的 Element，支持 closest() 和 dataset 访问。
interface FakeHost {
  dataset: {
    copilotContext?: string
    copilotContextId?: string
    copilotContextExtra?: string
    copilotContextSummary?: string
  }
}
interface FakeElement {
  __host: FakeHost | null
  closest(sel: string): FakeHost | null
}
function fakeElement(host: FakeHost | null): FakeElement {
  return {
    __host: host,
    closest(sel: string) {
      if (sel !== '[data-copilot-context]') return null
      return host
    },
  }
}

describe('context-registry', () => {
  describe('captureFromElement', () => {
    it('reads type + id from closest ancestor', () => {
      const host: FakeHost = {
        dataset: { copilotContext: 'experiment', copilotContextId: 'exp-abc' },
      }
      const captured = captureFromElement(fakeElement(host) as unknown as Element)
      expect(captured).toEqual({
        type: 'experiment',
        id: 'exp-abc',
        extra: undefined,
        summary: undefined,
        elementKey: 'experiment:exp-abc',
      })
    })

    it('parses JSON extra', () => {
      const host: FakeHost = {
        dataset: {
          copilotContext: 'task_result',
          copilotContextId: 'task-1',
          copilotContextExtra: '{"experiment_id":"exp-1"}',
        },
      }
      const captured = captureFromElement(fakeElement(host) as unknown as Element)
      expect(captured?.extra).toEqual({ experiment_id: 'exp-1' })
    })

    it('ignores malformed extra JSON', () => {
      const host: FakeHost = {
        dataset: {
          copilotContext: 'experiment',
          copilotContextId: 'a',
          copilotContextExtra: 'not-json',
        },
      }
      const captured = captureFromElement(fakeElement(host) as unknown as Element)
      expect(captured?.extra).toBeUndefined()
    })

    it('returns null for unknown type', () => {
      const host: FakeHost = {
        dataset: { copilotContext: 'nonsense', copilotContextId: 'x' },
      }
      expect(captureFromElement(fakeElement(host) as unknown as Element)).toBeNull()
    })

    it('returns null for missing id', () => {
      const host: FakeHost = {
        dataset: { copilotContext: 'experiment' },
      }
      expect(captureFromElement(fakeElement(host) as unknown as Element)).toBeNull()
    })

    it('returns null when no ancestor matches', () => {
      expect(captureFromElement(fakeElement(null) as unknown as Element)).toBeNull()
    })

    it('returns null for null element', () => {
      expect(captureFromElement(null)).toBeNull()
    })

    it('reads summary when present', () => {
      const host: FakeHost = {
        dataset: {
          copilotContext: 'template',
          copilotContextId: 't1',
          copilotContextSummary: 'QA v1',
        },
      }
      expect(captureFromElement(fakeElement(host) as unknown as Element)?.summary).toBe('QA v1')
    })
  })

  describe('elementKey / parseElementKey', () => {
    it('round trips', () => {
      const k = elementKey('experiment', 'exp-1')
      expect(k).toBe('experiment:exp-1')
      expect(parseElementKey(k)).toEqual({ type: 'experiment', id: 'exp-1' })
    })

    it('handles id containing colon', () => {
      const k = elementKey('task_result', 'exp:task-1')
      expect(parseElementKey(k)).toEqual({ type: 'task_result', id: 'exp:task-1' })
    })

    it('returns null for malformed key', () => {
      expect(parseElementKey('nosep')).toBeNull()
      expect(parseElementKey(':empty')).toBeNull()
    })

    it('prefixes task_result key with experiment_id when present in extra', () => {
      const k = elementKey('task_result', 'task-1', { experiment_id: 'exp-1' })
      expect(k).toBe('task_result:exp-1/task-1')
      expect(parseElementKey(k)).toEqual({
        type: 'task_result',
        id: 'task-1',
        extra: { experiment_id: 'exp-1' },
      })
    })

    it('prefixes task_field key with experiment_id when present in extra', () => {
      const k = elementKey('task_field', 'task-1#young', { experiment_id: 'exp-1' })
      expect(k).toBe('task_field:exp-1/task-1#young')
      expect(parseElementKey(k)).toEqual({
        type: 'task_field',
        id: 'task-1#young',
        extra: { experiment_id: 'exp-1' },
      })
    })

    it('captureFromElement on task_result embeds experiment_id into elementKey', () => {
      const host: FakeHost = {
        dataset: {
          copilotContext: 'task_result',
          copilotContextId: 'task-1',
          copilotContextExtra: '{"experiment_id":"exp-1"}',
        },
      }
      const captured = captureFromElement(fakeElement(host) as unknown as Element)
      expect(captured?.elementKey).toBe('task_result:exp-1/task-1')
    })

    it('leaves non-per-experiment types alone regardless of extra', () => {
      expect(elementKey('experiment', 'exp-1', { experiment_id: 'other' })).toBe('experiment:exp-1')
      expect(elementKey('text_selection', 'sel-abc', { experiment_id: 'x' })).toBe('text_selection:sel-abc')
    })
  })

  describe('toContextRef', () => {
    it('strips UI fields', () => {
      const ref = toContextRef({
        type: 'experiment',
        id: 'a',
        elementKey: 'experiment:a',
        summary: 'ignored',
        tag: 2,
      })
      expect(ref).toEqual({ tag: 2, type: 'experiment', id: 'a', extra: undefined })
    })
  })
})
