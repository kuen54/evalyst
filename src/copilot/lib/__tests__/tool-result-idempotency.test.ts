/**
 * v0.18.12 H5：tool-result POST 幂等性 —— 同 call_id 已落盘则 409。
 *
 * 触发场景：用户 Confirm 双触 / fork 后旧链尾的 tool_use 被新链重激活 /
 *   客户端重试。客户端 pendingCallIds 仅防 in-flight，不防 already-completed。
 *
 * 重点防护：edit_template / restart_experiment 等 mutating tool 重复执行
 *   会让 schema.version 翻倍 / 重复 startBatch。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { POST } from '@/app/api/copilot/sessions/[id]/tool-result/route'
import { createSession, appendMessage } from '../session-store'
import { writeAtomic } from '@/lib/fs-utils'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-result-idemp-'))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
  // 写一份 mock llm-config.json，让 model 校验过
  const configDir = path.join(tmpDir, 'data')
  fs.mkdirSync(configDir, { recursive: true })
  writeAtomic(
    path.join(configDir, 'llm-config.json'),
    JSON.stringify({
      models: [
        {
          id: 'm1',
          name: 'mock',
          api_format: 'anthropic',
          base_url: 'https://x',
          api_key: 'k',
          model: 'mock-model',
          copilot_enabled: true,
        },
      ],
    }),
  )
})

afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeReq(sessionId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/copilot/sessions/${sessionId}/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /tool-result idempotency', () => {
  it('returns 409 when tool_result with same call_id already exists in active branch', async () => {
    const session = createSession({ title: 't', model_id: 'm1' })
    const sessionId = session.id

    // pre-append: user → tool_use → tool_result (existing call_id)
    const userMsg = appendMessage({
      session_id: sessionId,
      role: 'user',
      content: 'do',
    })
    const tu = appendMessage({
      session_id: sessionId,
      role: 'tool_use',
      content: '{}',
      call_id: 'call_dup',
      tool_name: 'list_experiments',
      tool_input: {},
      parent_id: userMsg.id,
    })
    appendMessage({
      session_id: sessionId,
      role: 'tool_result',
      content: JSON.stringify({ kind: 'inline', value: { items: [] } }),
      call_id: 'call_dup',
      tool_name: 'list_experiments',
      parent_id: tu.id,
    })

    // re-POST same call_id → expect 409
    const req = makeReq(sessionId, {
      call_id: 'call_dup',
      tool_name: 'list_experiments',
      input: {},
    })
    const resp = await POST(req as never, { params: Promise.resolve({ id: sessionId }) })
    expect(resp.status).toBe(409)
    const data = await resp.json()
    expect(data.error).toContain('already exists')
    expect(data.call_id).toBe('call_dup')
    expect(data.existing_message_id).toBeTruthy()
  })

  it('allows new call_id even if same tool was previously called', async () => {
    const session = createSession({ title: 't2', model_id: 'm1' })
    const sessionId = session.id

    // pre-append: same tool with different call_id
    const userMsg = appendMessage({
      session_id: sessionId,
      role: 'user',
      content: 'do',
    })
    const tu = appendMessage({
      session_id: sessionId,
      role: 'tool_use',
      content: '{}',
      call_id: 'call_old',
      tool_name: 'list_experiments',
      tool_input: {},
      parent_id: userMsg.id,
    })
    appendMessage({
      session_id: sessionId,
      role: 'tool_result',
      content: JSON.stringify({ kind: 'inline', value: { items: [] } }),
      call_id: 'call_old',
      tool_name: 'list_experiments',
      parent_id: tu.id,
    })

    // POST with NEW call_id → must NOT 409 (cleanly proceed past idempotency check)
    const req = makeReq(sessionId, {
      call_id: 'call_new',
      tool_name: 'list_experiments',
      input: {},
    })
    const resp = await POST(req as never, { params: Promise.resolve({ id: sessionId }) })
    // 新 call_id 不命中 409；状态码可能是 200 (SSE) 或其他（依赖下游 LLM mock），
    // 但绝不是 409
    expect(resp.status).not.toBe(409)
  })
})
