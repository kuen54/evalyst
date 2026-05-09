// ---------- Evalyst Copilot 类型 ----------
// 所有数据走 data/copilot/：index.json（session 索引）+ sessions/{id}.jsonl（消息 append-only）。
// fork 语义：消息带 parent_id；session 记 head_message_id；编辑一条 user 消息 = 新建同 parent_id
// 的新消息，head 跟过去；旧分支保留，从 head 回溯构造当前视图。

export type CopilotRole = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'

/**
 * v2 tool_result 三态内容：
 * - `inline`：小 payload，LLM 直接看完整 value
 * - `ref`：超过 maxResultSizeChars 时 payloadGuardHook 落盘 data/copilot/tool-results/{sid}/{ref}.json，
 *   transcript 里只放 preview（500 字）+ ref URL，LLM 需要细节时调 read_tool_result(ref)
 * - `compacted`：microCompact 把老 tool_result 压成 summary；原 ref（若有）保留
 *
 * jsonl 存储：CopilotMessage.content 仍是 string（JSON.stringify(ToolResultContent)），
 * 向后兼容既有裸 output 数据——normalizeToolResult 读时包装为 {kind:'inline', value:...}。
 */
/**
 * 图像引用 —— 圈选 task_result/task_field 时由 image-attach.collectImageRefs 产出，
 * 工具调用产出时由 image-attach.extractImageRefsFromOutput 产出。
 * url 是公开可寻址形式（/api/results/{exp}/images/{f}.png  |  data:image/...  |  http(s)://...），
 * 不是磁盘路径。disk 路径在 readImageBytes 内部解析。
 */
export interface ImageRef {
  url: string                   // /api/results/{exp}/images/{f}.png  |  data:image/...;base64,...  |  http(s)://...
  source_label: string          // human-readable, e.g. "task_result#abc123 · field=image_url"
  ctx_tag?: number              // 圈选路径填；工具路径不填
}

export type ToolResultContent =
  | { kind: 'inline'; value: unknown; attachments?: ImageRef[] }
  | { kind: 'ref'; ref: string; preview: string; attachments?: ImageRef[] }
  | { kind: 'compacted'; summary: string; ref?: string }

/**
 * 单条消息。PR-3 不把 CopilotMessage 拆成 discriminated union（plan §5.1 里的方案），
 * 而是在同一个 interface 上加一组可选字段——只在 role === 'tool_use' / 'tool_result'
 * 的消息上填。理由：CopilotMessage 贯穿 session-store / chat-view / chat route 等多个文件，
 * 拆 union 会把 Task 1 放大成多文件重构；加可选字段在 jsonl 层也向后兼容。
 *
 * 字段约定：
 * - role === 'tool_use'
 *     call_id, tool_name, tool_input 必填；content 可为空字符串或 JSON.stringify(tool_input) 的冗余副本（便于 grep/审计）。
 * - role === 'tool_result'
 *     call_id, tool_name 必填；content 装工具返回值的 JSON string（失败/denied 时仍然是 JSON string）；
 *     denied=true 表示用户拒绝执行此写操作，reason 可选。
 * - role === 'user' / 'assistant' / 系统其他：这些 tool_* 字段都不出现。
 */
export interface CopilotMessage {
  id: string                     // nanoid(10)
  session_id: string
  parent_id?: string             // 为空 = 根消息（session 内第一条 user message）
  role: CopilotRole
  content: string                // user/assistant：纯文本；tool_use/tool_result：冗余 JSON string（主字段见下方 tool_* 扩展）
  contexts?: CopilotContextRef[] // 该消息附带的 context 引用（仅 user 消息）
  timestamp: string              // ISO
  usage?: {                      // assistant 消息收到 done 后填
    input_tokens: number
    output_tokens: number
  }
  model_id?: string              // assistant 消息：哪个 model 生成的

  // ---------- tool_use / tool_result 专用扩展（仅这两种 role 填）----------
  /** 配对 tool_use 与 tool_result 的稳定 id（LLM 生成，如 OpenAI 的 call_id 或 Anthropic 的 tool_use.id） */
  call_id?: string
  /** 调用的工具名（tool_result 上也保留一份，便于审计） */
  tool_name?: string
  /** tool_use：LLM 发出的参数（已 JSON.parse 后的对象） */
  tool_input?: Record<string, unknown>
  /**
   * tool_use：Gemini 2.5 / 3.x thinking 模式下，proxy 会在 tool_call chunk 上带
   * `thought_signature`（不透明字符串）。下一轮把该 tool_use 历史重新发回
   * Vertex/Gemini 时，必须原样回显，否则 Gemini 会 400
   * "function call ... missing a thought_signature"。只有 Gemini thinking 模型
   * 才有此字段；其他模型（OpenAI / Claude / 非 thinking Gemini）不出现。
   * 序列化时放在 OpenAI 兼容格式的 `tool_calls[].function.thought_signature`。
   */
  thought_signature?: string
  /** tool_result：用户拒绝执行此写工具 */
  denied?: boolean
  /** tool_result：denied 的原因（可选）；或 compact_boundary：压缩触发原因（可选） */
  reason?: string

  // ---------- v2.5 §5: compact_boundary 专用扩展（仅 role === 'system' 时填）----------
  /** 'compact_boundary' 表示这条 system 消息是 microCompact 完成后插入的边界标记 */
  kind?: 'compact_boundary'
  /** boundary 生成时的 ISO 时间戳 */
  at?: string
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
// 注：plan 里称为 CopilotEvent；这里沿用既有的类型名 StreamEvent，不改名以避免大量 import 改动。
// 字段命名按 plan §5.2：tool_name / input_json_delta / input（parsed object）。
// - tool_use_start: 工具调用开始，带 tool_name
// - tool_use_delta: Anthropic 会流式增量吐 JSON 参数；OpenAI 也可能分片给 arguments。input_json_delta 原样转发
// - tool_use_end: 参数拼齐后服务端 JSON.parse 一次，emit 解析后的 input 对象（parse 失败则由 emitter 决定是否降级）

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use_start'; call_id: string; tool_name: string }
  | { type: 'tool_use_delta'; call_id: string; input_json_delta: string }
  | { type: 'tool_use_end'; call_id: string; tool_name: string; input: Record<string, unknown>; thought_signature?: string }
  | {
      type: 'done'
      usage?: {
        input_tokens: number
        output_tokens: number
        cache_creation_tokens?: number
        cache_read_tokens?: number
      }
      stop_reason?: string
    }
  | { type: 'error'; message: string }

// ---------- PR-4: Page Context + Viewport Index ----------

export type RouteType =
  | 'dashboard'
  | 'experiment_new' | 'experiment_detail'
  | 'compare'
  | 'settings_hub'
  | 'datasets_list' | 'dataset_new' | 'dataset_detail'
  | 'templates_list' | 'template_new' | 'template_detail'
  | 'displays_list' | 'display_new' | 'display_detail'
  | 'rubrics_list' | 'rubric_new' | 'rubric_detail'
  | 'models_list'
  | 'unknown'

/** 打开 copilot 时注入的当前页面摘要。每个路由自定义 summary 字段（具体 shape 见 spec §5.1.2）。 */
export interface PageContext {
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  summary: Record<string, unknown>
  timestamp: string
}

/** 当前页面中一个可被圈选元素的轻量索引条目。 */
export interface ViewportIndexEntry {
  key: string
  type: string
  preview_text: string
  ancestors?: string[]
}

/** 客户端每次 chat / tool-result 请求附带的页面快照。 */
export interface ClientSnapshot {
  session_id: string
  route_type: RouteType
  path: string
  search_params?: Record<string, string>
  page_context: PageContext
  viewport_index: ViewportIndexEntry[]
  timestamp: string
}
