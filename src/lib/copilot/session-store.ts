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
  ToolResultContent,
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
    ...(opts.model_id !== undefined ? { model_id: opts.model_id } : {}),
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
  idx.sessions[i] = { ...idx.sessions[i]!, ...patch, updated_at: nowIso() }
  writeIndex(idx)
  return idx.sessions[i]
}

/**
 * Clear head_message_id (eopt-safe: cannot use updateSession with explicit
 * `undefined` because of `exactOptionalPropertyTypes`).
 */
function clearSessionHead(id: string): CopilotSessionMeta | undefined {
  const idx = readIndex()
  const i = idx.sessions.findIndex(s => s.id === id)
  if (i < 0) return undefined
  const cur = idx.sessions[i]!
  const { head_message_id: _drop, ...rest } = cur
  void _drop
  idx.sessions[i] = { ...rest, updated_at: nowIso() }
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
    head = leaves[leaves.length - 1]?.id ?? all[all.length - 1]!.id
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
  // PR-3 tool calling: 仅在 role === 'tool_use' / 'tool_result' 时填。
  // 字段含义见 CopilotMessage 接口顶部注释。
  call_id?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  /** 仅 tool_use：Gemini thinking 模式的不透明签名，下一轮必须原样回显。 */
  thought_signature?: string
  denied?: boolean
  reason?: string
  // v2.5 §5: compact_boundary 专用扩展（仅 role === 'system' + kind === 'compact_boundary'）
  kind?: 'compact_boundary'
  at?: string
}

export function appendMessage(input: AppendMessageInput): CopilotMessage {
  const msg: CopilotMessage = {
    id: nanoid(),
    session_id: input.session_id,
    ...(input.parent_id !== undefined ? { parent_id: input.parent_id } : {}),
    role: input.role,
    content: input.content,
    ...(input.contexts !== undefined ? { contexts: input.contexts } : {}),
    timestamp: nowIso(),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.model_id !== undefined ? { model_id: input.model_id } : {}),
    ...(input.call_id !== undefined ? { call_id: input.call_id } : {}),
    ...(input.tool_name !== undefined ? { tool_name: input.tool_name } : {}),
    ...(input.tool_input !== undefined ? { tool_input: input.tool_input } : {}),
    ...(input.thought_signature !== undefined ? { thought_signature: input.thought_signature } : {}),
    ...(input.denied !== undefined ? { denied: input.denied } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  }
  ensureDir(sessionsDir())
  const file = sessionPath(input.session_id)
  // fs.appendFileSync 是 append-mode 的原子操作（O_APPEND + 单次 write），两个并发调用
  // 不会"读同一个 base → 覆盖彼此"导致整条消息丢失 —— 这是 read-modify-writeAtomic 会踩的坑。
  // 单条消息若超过 PIPE_BUF（macOS 默认 ~512B，Linux 4KB）理论上可能被交错写入，但
  // readAllMessages 对每行单独 JSON.parse + try/catch（见 ~line 111），最坏情况是单条消息被丢弃而不是数据全乱。
  fs.appendFileSync(file, JSON.stringify(msg) + '\n')
  // session 元数据：head 跟过去 + updated_at
  updateSession(input.session_id, { head_message_id: msg.id })
  return msg
}

/**
 * spec §5.3 方案 A：microCompact 完成后插 boundary。parent_id 默认取 session 当前 head，
 * 这样 boundary 串入 active branch；之后的 append 自然以 boundary 为 parent。
 */
export function appendCompactBoundary(
  sessionId: string,
  opts?: { reason?: string },
): CopilotMessage {
  const session = getSession(sessionId)
  return appendMessage({
    session_id: sessionId,
    role: 'system',
    content: '',
    ...(session?.head_message_id !== undefined ? { parent_id: session.head_message_id } : {}),
    kind: 'compact_boundary',
    at: nowIso(),
    ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
  })
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
    if (target.parent_id !== undefined) {
      updateSession(sessionId, { head_message_id: target.parent_id })
    } else {
      // 目标无 parent（被删的就是 root），head 应清空
      clearSessionHead(sessionId)
    }
  } else {
    // 还是要动一下 updated_at
    updateSession(sessionId, {})
  }

  return Array.from(toRemove)
}

// ---------- v2 · ToolResultContent 兼容 ----------
//
// tool_result 消息的 `content` 在 jsonl 里仍是 JSON string，但语义分两期：
//   v1（老数据）：content = JSON.stringify(rawOutput)，无 kind 字段
//   v2（新数据）：content = JSON.stringify(ToolResultContent)，带 kind: inline | ref | compacted
//
// 读取侧统一走此函数，input 既可是 string（刚从 jsonl 读出）也可是已 parse 的对象；
// 不带 kind 视为老格式，包装成 {kind:'inline', value:<原样>}。

export function normalizeToolResult(content: unknown): ToolResultContent {
  let parsed: unknown = content
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content)
    } catch {
      // 不是合法 JSON 就当裸字符串 inline
      return { kind: 'inline', value: content }
    }
  }
  if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
    const k = (parsed as { kind: unknown }).kind
    if (k === 'inline' || k === 'ref' || k === 'compacted') {
      return parsed as ToolResultContent
    }
  }
  return { kind: 'inline', value: parsed }
}

// ---------- v2 · active contexts 查询 ----------
//
// session 里"当前有效"的圈选 = active branch 里最后一条 user 消息的 contexts。
// 历史 user 消息的 contexts 是当时圈的，不代表当前视图；只取最新那条。
// read_context 工具按 ctx_N （= tag） 找对应 ref。

export function getActiveContexts(sessionId: string): CopilotContextRef[] {
  const branch = getActiveBranch(sessionId)
  const lastUser = [...branch].reverse().find((m) => m.role === 'user')
  return lastUser?.contexts ?? []
}

export function getActiveContextByTag(
  sessionId: string,
  tag: number,
): CopilotContextRef | undefined {
  return getActiveContexts(sessionId).find((c) => c.tag === tag)
}
