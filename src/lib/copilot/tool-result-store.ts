// tool-result-store：把超过 maxResultSizeChars 的 tool output 落盘到
// data/copilot/tool-results/{session_id}/{tr_id}.json，transcript 里只留
// preview + ref。v2 目标之一：防止大 payload 撑爆后续 chain。
//
// 借 claude-code-best `toolResultStorage`；不做 CCB 的 `contentReplacementState`
// 聚合预算（YAGNI，规模不值得）。

import fs from 'node:fs/promises'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import type { ToolResultContent } from './types'

// 10 位小写字母 + 数字；session_store 里也是这套 alphabet，尺寸更大是因为 tool-result 数量会多
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

// v2.5 P1a §3.2: head + tail 双端夹截断常量
// 实际总长 head 400 + sep 19 + tail 100 = 519 字符；测试用 ≤520 留 1 字符
// 安全余量。与 v0.9.0 的 slice(0, 500) 同量级。来源 hermes context_compressor.py:692
// （hermes 用 4000+1500，但 evalyst transcript context budget 紧；500 字够 LLM 决定
// 要不要 read_tool_result 回捞）。
const PREVIEW_HEAD = 400
const PREVIEW_TAIL = 100
const PREVIEW_SEP = '\n...[truncated]...\n'

function buildPreview(serialized: string): string {
  if (serialized.length <= PREVIEW_HEAD + PREVIEW_TAIL + PREVIEW_SEP.length) {
    return serialized
  }
  return serialized.slice(0, PREVIEW_HEAD) + PREVIEW_SEP + serialized.slice(-PREVIEW_TAIL)
}

function storeDir(session_id: string): string {
  return path.join(process.cwd(), 'data', 'copilot', 'tool-results', session_id)
}

/**
 * 若 output 序列化后 <= maxSize，返 `{kind:'inline', value: output}`；
 * 否则落盘到 data/copilot/tool-results/{sid}/{tr_xxx}.json，返
 * `{kind:'ref', ref:'ref://tool-result/tr_xxx', preview: head+tail 双端夹}`。
 *
 * preview 用 `\n...[truncated]...\n` 分隔头尾，head 400 + tail 100 字符（来源
 * hermes context_compressor.py:692），保留 error stack 尾部 root cause。LLM 想拿
 * 完整 payload 时调 read_tool_result(ref) 工具回捞。
 */
export async function maybePersistToolResult(
  session_id: string,
  output: unknown,
  maxSize: number,
): Promise<ToolResultContent> {
  const serialized = JSON.stringify(output)
  // 序列化失败（undefined / 循环引用）走 inline 保全 — JSON.stringify 对 undefined / function
  // 返 undefined，对循环引用抛 TypeError。外层调用方已 try/catch 包裹工具调用。
  if (!serialized) {
    return { kind: 'inline', value: output }
  }
  if (serialized.length <= maxSize) {
    return { kind: 'inline', value: output }
  }
  const id = `tr_${nanoid()}`
  const dir = storeDir(session_id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${id}.json`), serialized)
  const preview = buildPreview(serialized)
  return { kind: 'ref', ref: `ref://tool-result/${id}`, preview }
}

/**
 * 读回 maybePersistToolResult 落盘的 ref。支持传完整 ref URL 或裸 id。
 * 缺失文件抛 Error —— caller（read_tool_result 工具 / UI 调试）自行呈现。
 */
export async function loadPersistedToolResult(
  session_id: string,
  refOrId: string,
): Promise<unknown> {
  const m = refOrId.match(/^ref:\/\/tool-result\/(.+)$/)
  const id = m ? m[1] : refOrId
  const file = path.join(storeDir(session_id), `${id}.json`)
  const text = await fs.readFile(file, 'utf-8')
  return JSON.parse(text)
}

/**
 * 删 session 时顺手把落盘的 tool-result 目录一起清掉。
 * 目录不存在时静默。
 */
export async function deleteToolResultDir(session_id: string): Promise<void> {
  await fs.rm(storeDir(session_id), { recursive: true, force: true })
}
