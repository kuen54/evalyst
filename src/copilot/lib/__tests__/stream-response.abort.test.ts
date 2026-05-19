/**
 * v0.18.9 H1：post-stream abort 守卫
 *
 * 场景：客户端在 callLlmStreaming 关流到 appendMessage 之间 abort。
 * 没守卫前会落"孤儿 tool_use"消息（无匹配 tool_result），下次进入 session 时
 * chain-cap 误算 + LLM 看到不完整链。守卫后 signal.aborted=true 时跳过 append。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 必须在 import runToolAwareLlmStream 之前 vi.mock，hoisting 由 vitest 处理
vi.mock('../llm-stream', () => ({
  callLlmStreaming: vi.fn(async (_p: unknown, onEvent: (ev: unknown) => void) => {
    // 模拟一次正常关流：发一条 tool_use_end + done
    onEvent({ type: 'tool_use_end', call_id: 'cu_1', tool_name: 'mock', input: { x: 1 } })
    onEvent({ type: 'done', usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' })
  }),
}))

import { runToolAwareLlmStream } from '../stream-response'
import { createSession } from '../session-store'
import type { ModelConfig } from '@/lib/llm-config'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-abort-'))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const mockModel: ModelConfig = {
  id: 'm1',
  name: 'mock',
  api_format: 'anthropic',
  base_url: 'https://example.com',
  api_key: 'sk-mock',
  model: 'mock-model',
  default_temperature: 1,
  default_max_tokens: 4096,
  vision_capable: false,
}

function sessionFile(id: string): string {
  return path.join(tmpDir, 'data', 'copilot', 'sessions', `${id}.jsonl`)
}

describe('runToolAwareLlmStream post-stream abort guard', () => {
  it('skips appendMessage when signal aborted before stream returned', async () => {
    const session = createSession({ title: 't' })
    const ctrl = new AbortController()
    ctrl.abort()

    const r = await runToolAwareLlmStream({
      sessionId: session.id,
      branch: [],
      model: mockModel,
      tools: [],
      pageContext: null,
      startParentId: undefined,
      signal: ctrl.signal,
      write: () => {},
    })

    expect(r.toolUseMessageIds).toEqual([])
    expect(r.assistantMessageId).toBeUndefined()

    // 关键断言：session jsonl 不应该有任何 tool_use 落盘
    const jsonl = sessionFile(session.id)
    if (fs.existsSync(jsonl)) {
      const lines = fs.readFileSync(jsonl, 'utf-8').trim().split('\n').filter(Boolean)
      const toolUses = lines.filter(l => l.includes('"role":"tool_use"'))
      expect(toolUses).toEqual([])
    }
  })

  it('appends normally when signal NOT aborted (sanity baseline)', async () => {
    const session = createSession({ title: 't2' })
    const ctrl = new AbortController()
    // 不 abort

    const r = await runToolAwareLlmStream({
      sessionId: session.id,
      branch: [],
      model: mockModel,
      tools: [],
      pageContext: null,
      startParentId: undefined,
      signal: ctrl.signal,
      write: () => {},
    })

    expect(r.toolUseMessageIds.length).toBe(1)

    // 正常路径：jsonl 里能看到 tool_use
    const jsonl = sessionFile(session.id)
    expect(fs.existsSync(jsonl)).toBe(true)
    const lines = fs.readFileSync(jsonl, 'utf-8').trim().split('\n').filter(Boolean)
    const toolUses = lines.filter(l => l.includes('"role":"tool_use"'))
    expect(toolUses.length).toBe(1)
  })
})
