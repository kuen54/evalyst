// ---------- Copilot Session Store ----------
// 文件布局：
//   data/copilot/index.json               — session 元数据索引
//   data/copilot/sessions/{id}.jsonl      — 该 session 所有消息（append-only）
//
// 迁移 / 测试友好：configDir() / sessionsDir() 惰性返回 process.cwd() 下的路径。
// 消息是 append-only 链表；fork = 新增一条 parent_id = 老消息 parent 的消息，session.head 跟过去。
// 渲染当前分支 = 从 head_message_id 一路 parent 回溯到根再反转。

import fs from 'fs'
import path from 'path'
import { customAlphabet } from 'nanoid'
import { ensureDir, writeAtomic } from '../fs-utils'
import type {
  CopilotMessage,
  CopilotSessionMeta,
  CopilotSessionIndex,
  CopilotContextRef,
  CopilotRole,
} from './types'

// 惰性路径（测试里 chdir 有效）
function configDir() { return path.join(process.cwd(), 'data', 'copilot') }
function indexPath() { return path.join(configDir(), 'index.json') }
function sessionsDir() { return path.join(configDir(), 'sessions') }
function sessionPath(id: string) { return path.join(sessionsDir(), `${id}.jsonl`) }

// 10 位小写字母 + 数字，避免文件名大小写冲突
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

function nowIso(): string {
  return new Date().toISOString()
}

// ---------- Index (session 元数据) ----------

function readIndex(): CopilotSessionIndex {
  if (!fs.existsSync(indexPath())) return { sessions: [] }
  try {
    const raw = fs.readFileSync(indexPath(), 'utf-8')
    const parsed = JSON.parse(raw) as CopilotSessionIndex
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] }
    return parsed
  } catch {
    return { sessions: [] }
  }
}

function writeIndex(idx: CopilotSessionIndex) {
  ensureDir(configDir())
  writeAtomic(indexPath(), JSON.stringify(idx, null, 2))
}

export function listSessions(): CopilotSessionMeta[] {
  const idx = readIndex()
  // 最新在前
  return idx.sessions.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getSession(id: string): CopilotSessionMeta | undefined {
  return readIndex().sessions.find(s => s.id === id)
}

export function createSession(opts: { title?: string; model_id?: string } = {}): CopilotSessionMeta {
  const id = nanoid()
  const meta: CopilotSessionMeta = {
    id,
    title: opts.title ?? '新会话',
    created_at: nowIso(),
    updated_at: nowIso(),
    model_id: opts.model_id,
  }
  const idx = readIndex()
  idx.sessions.push(meta)
  writeIndex(idx)
  // 初始化空 jsonl
  ensureDir(sessionsDir())
  writeAtomic(sessionPath(id), '')
  return meta
}

export function updateSession(id: string, patch: Partial<Pick<CopilotSessionMeta, 'title' | 'model_id' | 'head_message_id'>>): CopilotSessionMeta | undefined {
  const idx = readIndex()
  const i = idx.sessions.findIndex(s => s.id === id)
  if (i < 0) return undefined
  idx.sessions[i] = { ...idx.sessions[i], ...patch, updated_at: nowIso() }
  writeIndex(idx)
  return idx.sessions[i]
}

export function deleteSession(id: string): boolean {
  const idx = readIndex()
  const filtered = idx.sessions.filter(s => s.id !== id)
  if (filtered.length === idx.sessions.length) return false
  idx.sessions = filtered
  writeIndex(idx)
  if (fs.existsSync(sessionPath(id))) fs.rmSync(sessionPath(id))
  return true
}

// ---------- 消息（append-only jsonl） ----------

/** 读 session 下全部消息（原始顺序；包含所有分支） */
export function readAllMessages(sessionId: string): CopilotMessage[] {
  if (!fs.existsSync(sessionPath(sessionId))) return []
  const raw = fs.readFileSync(sessionPath(sessionId), 'utf-8')
  const lines = raw.split('\n').filter(l => l.trim())
  const out: CopilotMessage[] = []
  for (const line of lines) {
    try {
      const m = JSON.parse(line) as CopilotMessage
      if (m && typeof m.id === 'string') out.push(m)
    } catch {
      // 跳过坏行
    }
  }
  return out
}

/**
 * 从 head 回溯到根，返回线性当前分支（root → head）。
 * 未给 head 则从 session 元数据里取；仍没有则从 all messages 里自动挑一个叶子（最后一条无子的）。
 */
export function getActiveBranch(sessionId: string, headId?: string): CopilotMessage[] {
  const all = readAllMessages(sessionId)
  if (all.length === 0) return []
  const byId = new Map(all.map(m => [m.id, m]))

  let head = headId
  if (!head) {
    const meta = getSession(sessionId)
    head = meta?.head_message_id
  }
  if (!head) {
    // 挑最后写入的叶子（没有任何消息以它为 parent 的）
    const parents = new Set(all.map(m => m.parent_id).filter((x): x is string => !!x))
    const leaves = all.filter(m => !parents.has(m.id))
    head = leaves[leaves.length - 1]?.id ?? all[all.length - 1].id
  }

  const chain: CopilotMessage[] = []
  let cur: CopilotMessage | undefined = byId.get(head)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.push(cur)
    if (!cur.parent_id) break
    cur = byId.get(cur.parent_id)
  }
  return chain.reverse()
}

/** 在同 parent 下有几个子消息，用于 UI 显示分支 pager 1/N */
export function siblingsOf(sessionId: string, messageId: string): { current: number; total: number; siblingIds: string[] } {
  const all = readAllMessages(sessionId)
  const msg = all.find(m => m.id === messageId)
  if (!msg) return { current: 0, total: 0, siblingIds: [] }
  const siblings = all.filter(m => m.parent_id === msg.parent_id && m.role === msg.role)
  const idx = siblings.findIndex(s => s.id === messageId)
  return { current: idx + 1, total: siblings.length, siblingIds: siblings.map(s => s.id) }
}

export interface AppendMessageInput {
  session_id: string
  role: CopilotRole
  content: string
  parent_id?: string
  contexts?: CopilotContextRef[]
  usage?: CopilotMessage['usage']
  model_id?: string
}

export function appendMessage(input: AppendMessageInput): CopilotMessage {
  const msg: CopilotMessage = {
    id: nanoid(),
    session_id: input.session_id,
    parent_id: input.parent_id,
    role: input.role,
    content: input.content,
    contexts: input.contexts,
    timestamp: nowIso(),
    usage: input.usage,
    model_id: input.model_id,
  }
  ensureDir(sessionsDir())
  const file = sessionPath(input.session_id)
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
  const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing
  const next = prefix + JSON.stringify(msg) + '\n'
  writeAtomic(file, next)
  // session 元数据：head 跟过去 + updated_at
  updateSession(input.session_id, { head_message_id: msg.id })
  return msg
}

/** 自动从首条 user 消息的前 30 字生成 title（若 session.title 仍是默认） */
export function autoTitleSessionIfNeeded(sessionId: string, firstUserText: string): void {
  const meta = getSession(sessionId)
  if (!meta) return
  if (meta.title && meta.title !== '新会话' && meta.title !== 'New session') return
  const snip = firstUserText.replace(/\s+/g, ' ').trim().slice(0, 30).trimEnd()
  if (snip) updateSession(sessionId, { title: snip })
}

/**
 * 删除一条消息及其所有后代（所有以它或其后代为 parent_id 的消息）。
 * 用于 chat UI 的"删除"动作，以及"编辑 = 删+重发"的先一步。
 * 如果 session.head_message_id 指向被删掉的消息，head 回退到该消息的 parent。
 * 返回被删掉的 id 集合。
 */
export function pruneMessageAndDescendants(sessionId: string, messageId: string): string[] {
  const all = readAllMessages(sessionId)
  const target = all.find(m => m.id === messageId)
  if (!target) return []

  // BFS 找所有后代
  const toRemove = new Set<string>([messageId])
  let grew = true
  while (grew) {
    grew = false
    for (const m of all) {
      if (m.parent_id && toRemove.has(m.parent_id) && !toRemove.has(m.id)) {
        toRemove.add(m.id)
        grew = true
      }
    }
  }

  const kept = all.filter(m => !toRemove.has(m.id))
  const file = sessionPath(sessionId)
  const body = kept.map(m => JSON.stringify(m)).join('\n') + (kept.length ? '\n' : '')
  writeAtomic(file, body)

  // 如果 head 在被删范围里，head 回到目标 message 的 parent
  const meta = getSession(sessionId)
  if (meta?.head_message_id && toRemove.has(meta.head_message_id)) {
    updateSession(sessionId, { head_message_id: target.parent_id })
  } else {
    // 还是要动一下 updated_at
    updateSession(sessionId, {})
  }

  return Array.from(toRemove)
}
