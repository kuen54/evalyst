import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  updateSession,
  appendMessage,
  readAllMessages,
  getActiveBranch,
  siblingsOf,
  autoTitleSessionIfNeeded,
  pruneMessageAndDescendants,
} from '../session-store'

// session-store 读写 data/copilot/；每个 case chdir 到 tmp 隔离
let tmp = ''
let origCwd = ''

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-copilot-'))
  process.chdir(tmp)
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('session CRUD', () => {
  it('list empty when no file', () => {
    expect(listSessions()).toEqual([])
  })

  it('create / list / get', () => {
    const s = createSession({ title: 'hello', model_id: 'm1' })
    expect(s.id).toMatch(/^[a-z0-9]{10}$/)
    const list = listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('hello')
    expect(list[0].model_id).toBe('m1')
    expect(getSession(s.id)?.id).toBe(s.id)
  })

  it('update rename + model_id', () => {
    const s = createSession({})
    updateSession(s.id, { title: 'renamed', model_id: 'm2' })
    expect(getSession(s.id)?.title).toBe('renamed')
    expect(getSession(s.id)?.model_id).toBe('m2')
  })

  it('delete removes index entry + jsonl', () => {
    const s = createSession({})
    appendMessage({ session_id: s.id, role: 'user', content: 'hi' })
    expect(deleteSession(s.id)).toBe(true)
    expect(getSession(s.id)).toBeUndefined()
    expect(fs.existsSync(path.join(tmp, 'data', 'copilot', 'sessions', `${s.id}.jsonl`))).toBe(false)
  })

  it('list newest first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const a = createSession({ title: 'a' })
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'))
    const b = createSession({ title: 'b' })
    vi.useRealTimers()
    const list = listSessions()
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })
})

describe('messages append + read', () => {
  it('append writes jsonl and reads back', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'a1', parent_id: m1.id })
    const all = readAllMessages(s.id)
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe(m1.id)
    expect(all[1].parent_id).toBe(m1.id)
  })

  it('appendMessage updates session head_message_id', () => {
    const s = createSession({})
    const m = appendMessage({ session_id: s.id, role: 'user', content: 'q' })
    expect(getSession(s.id)?.head_message_id).toBe(m.id)
  })

  it('survives malformed lines', () => {
    const s = createSession({})
    appendMessage({ session_id: s.id, role: 'user', content: 'ok' })
    // 手动塞一坏行
    const file = path.join(tmp, 'data', 'copilot', 'sessions', `${s.id}.jsonl`)
    fs.appendFileSync(file, 'not-json-at-all\n')
    const all = readAllMessages(s.id)
    expect(all).toHaveLength(1)
  })
})

describe('getActiveBranch (fork semantics)', () => {
  it('returns root→head chain', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'a1', parent_id: m1.id })
    const m3 = appendMessage({ session_id: s.id, role: 'user', content: 'q2', parent_id: m2.id })
    const chain = getActiveBranch(s.id)
    expect(chain.map(m => m.id)).toEqual([m1.id, m2.id, m3.id])
  })

  it('edit-retry fork: new sibling message reuses parent, head follows new', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2a = appendMessage({ session_id: s.id, role: 'assistant', content: 'old answer', parent_id: m1.id })
    // 用户编辑 m1 → 新 user 消息 m1b（同 parent_id）→ 再回复 m2b
    const m1b = appendMessage({ session_id: s.id, role: 'user', content: 'q1 edited', parent_id: undefined })
    const m2b = appendMessage({ session_id: s.id, role: 'assistant', content: 'new answer', parent_id: m1b.id })
    // head 此时指向 m2b
    const chain = getActiveBranch(s.id)
    expect(chain.map(m => m.content)).toEqual(['q1 edited', 'new answer'])
    // 切到老分支
    const oldChain = getActiveBranch(s.id, m2a.id)
    expect(oldChain.map(m => m.content)).toEqual(['q1', 'old answer'])
  })

  it('empty session', () => {
    const s = createSession({})
    expect(getActiveBranch(s.id)).toEqual([])
  })
})

describe('siblingsOf', () => {
  it('returns correct pager 1/N', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'a' })
    const m2a = appendMessage({ session_id: s.id, role: 'assistant', content: 'old', parent_id: m1.id })
    const m2b = appendMessage({ session_id: s.id, role: 'assistant', content: 'new', parent_id: m1.id })
    const r1 = siblingsOf(s.id, m2a.id)
    expect(r1.total).toBe(2)
    expect(r1.current).toBe(1)
    const r2 = siblingsOf(s.id, m2b.id)
    expect(r2.current).toBe(2)
  })

  it('only counts same-role siblings', () => {
    // user 的兄弟只计 user；assistant 不算入
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'a1', parent_id: m1.id })
    // 两个 user 编辑分支
    const m1b = appendMessage({ session_id: s.id, role: 'user', content: 'q1 v2', parent_id: undefined })
    const m1c = appendMessage({ session_id: s.id, role: 'user', content: 'q1 v3', parent_id: undefined })
    const r = siblingsOf(s.id, m1.id)
    expect(r.total).toBe(3)
  })
})

describe('autoTitleSessionIfNeeded', () => {
  it('sets title from first user message when default', () => {
    const s = createSession({})
    autoTitleSessionIfNeeded(s.id, 'Help me debug this experiment please')
    expect(getSession(s.id)?.title).toBe('Help me debug this experiment')
  })

  it('does not overwrite user-named title', () => {
    const s = createSession({ title: 'My session' })
    autoTitleSessionIfNeeded(s.id, 'whatever')
    expect(getSession(s.id)?.title).toBe('My session')
  })
})

describe('pruneMessageAndDescendants', () => {
  it('removes target + all descendants, head retreats to parent', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'a1', parent_id: m1.id })
    const m3 = appendMessage({ session_id: s.id, role: 'user', content: 'q2', parent_id: m2.id })
    // 删 m2 → 应该把 m2 + m3 一起清理；head 回到 m1
    const removed = pruneMessageAndDescendants(s.id, m2.id)
    expect(new Set(removed)).toEqual(new Set([m2.id, m3.id]))
    const all = readAllMessages(s.id)
    expect(all.map(m => m.id)).toEqual([m1.id])
    expect(getSession(s.id)?.head_message_id).toBe(m1.id)
  })

  it('no-op on unknown id', () => {
    const s = createSession({})
    appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const removed = pruneMessageAndDescendants(s.id, 'does-not-exist')
    expect(removed).toEqual([])
    expect(readAllMessages(s.id)).toHaveLength(1)
  })

  it('pruning root user message leaves empty session', () => {
    const s = createSession({})
    const m1 = appendMessage({ session_id: s.id, role: 'user', content: 'q1' })
    const m2 = appendMessage({ session_id: s.id, role: 'assistant', content: 'a1', parent_id: m1.id })
    pruneMessageAndDescendants(s.id, m1.id)
    expect(readAllMessages(s.id)).toEqual([])
    expect(getSession(s.id)?.head_message_id).toBeUndefined()
  })
})
