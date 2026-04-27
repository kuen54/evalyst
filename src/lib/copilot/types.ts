// ---------- Evalyst Copilot 类型 ----------
// 所有数据走 data/copilot/：index.json（session 索引）+ sessions/{id}.jsonl（消息 append-only）。
// fork 语义：消息带 parent_id；session 记 head_message_id；编辑一条 user 消息 = 新建同 parent_id
// 的新消息，head 跟过去；旧分支保留，从 head 回溯构造当前视图。

export type CopilotRole = 'user' | 'assistant' | 'tool_use' | 'tool_result'

export interface CopilotMessage {
  id: string                     // nanoid(10)
  session_id: string
  parent_id?: string             // 为空 = 根消息（session 内第一条 user message）
  role: CopilotRole
  content: string                // user/assistant：纯文本；tool_use/tool_result：JSON string
  contexts?: CopilotContextRef[] // 该消息附带的 context 引用（仅 user 消息）
  timestamp: string              // ISO
  usage?: {                      // assistant 消息收到 done 后填
    input_tokens: number
    output_tokens: number
  }
  model_id?: string              // assistant 消息：哪个 model 生成的
}

/** 圈选的 context 引用 —— 由前端 data-copilot-context 捕获，后端 resolve */
export interface CopilotContextRef {
  tag: number                    // 数字徽章（1, 2, 3, ...）
  type: string                   // 'experiment' | 'task_result' | 'template' | 'dataset' | ...
  id: string                     // 资源 id
  extra?: Record<string, unknown> // 类型相关的额外参数，如 task_result 需要 experiment_id
}

export interface CopilotSessionMeta {
  id: string                     // nanoid(10)
  title: string                  // 默认 "新会话"，首条 user 消息的前 30 字自动填
  created_at: string
  updated_at: string
  head_message_id?: string       // 当前分支的叶子消息 id
  model_id?: string              // 会话选中的 copilot model（在 llm-config 的 models 里）
}

export interface CopilotSessionIndex {
  sessions: CopilotSessionMeta[]
}

// ---------- 流式事件（归一化后交给前端 / API 层）----------

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use_start'; call_id: string; name: string }
  | { type: 'tool_use_delta'; call_id: string; arguments_delta: string }
  | { type: 'tool_use_end'; call_id: string; arguments: string }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number }; stop_reason?: string }
  | { type: 'error'; message: string }
