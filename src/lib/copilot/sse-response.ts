// src/lib/copilot/sse-response.ts
//
// /chat 和 /tool-result 两个 SSE route 共享的脚手架：
// ReadableStream + encoder + write 吞吐 + error catch + headers。
//
// race fix（来自 CHANGELOG [0.4.0] / PR #4）：
// - controller.enqueue 在客户端 abort / 流已关时会抛 'Controller is already
//   closed'。write 必须 try/catch 吞掉，没法再回写客户端。
// - controller.close 走 finally 保证流一定关。
// - 任何 runner 抛 → 走 catch 写 { kind: 'error', message } 后再 close。

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

export type SseWrite = (payload: unknown) => void

export interface StreamSseOptions {
  /** 流打开后立即依次发的事件（如 user_message id / tool_result_message 回填等） */
  initialEvents?: readonly unknown[]
  /** runner 执行业务，可借 write 持续推 SSE 帧。runner return 之后流会 close。 */
  runner: (write: SseWrite) => Promise<void>
}

/**
 * 把 SSE 模板封装成一行调用。caller 只关心两件事：开头先发什么 + runner 跑什么。
 *
 * 用法：
 * ```
 * return streamSseResponse({
 *   initialEvents: [{ kind: 'user_message', id: msg.id }],
 *   runner: async (write) => {
 *     const r = await runToolAwareLlmStream({ ..., write })
 *     write({ kind: 'done', ...r })
 *   },
 * })
 * ```
 */
export function streamSseResponse(opts: StreamSseOptions): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // race fix：客户端已 abort / 流已关时 controller.enqueue 会抛
      // "Controller is already closed"；吞掉 —— 没法再回写客户端。
      const write: SseWrite = (payload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch { /* stream closed */ }
      }
      if (opts.initialEvents) {
        for (const ev of opts.initialEvents) write(ev)
      }
      try {
        await opts.runner(write)
      } catch (e) {
        write({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
