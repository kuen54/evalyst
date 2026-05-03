// Server-only: 按 type 把 CopilotContextRef 解析成结构化数据。
// 同时被 /api/copilot/contexts/resolve 和 /api/copilot/sessions/{id}/chat 使用。

import { getExperiment, readResults } from '@/lib/store'
import { getSchema } from '@/lib/schema'
import { getDataset } from '@/lib/datasets'
import { getDisplay } from '@/lib/displays'
import { getRubric } from '@/lib/rubric-store'
import { aggregateAnnotations } from '@/lib/annotation-store'
import type { CopilotContextRef } from './types'

export interface ResolvedContext {
  tag: number
  type: string
  id: string
  status: 'ok' | 'missing' | 'error'
  data?: unknown
  error?: string
  summary?: string
  /** 内到外的祖先链（已 resolve 好），反映选中对象所处的层级关系 */
  context_chain?: ResolvedContext[]
}

/** 只 resolve 这一层的对象本身，不展开 ancestors（供 resolveContext 内部使用） */
function resolveContextSelf(ref: CopilotContextRef): ResolvedContext {
  const base = { tag: ref.tag, type: ref.type, id: ref.id }

  try {
    switch (ref.type) {
      case 'experiment': {
        const exp = getExperiment(ref.id)
        if (!exp) return { ...base, status: 'missing' }
        return {
          ...base,
          status: 'ok',
          summary: `${exp.name} · ${exp.model} · ${exp.status}`,
          data: {
            id: exp.id,
            name: exp.name,
            status: exp.status,
            schema_id: exp.schema_id,
            display_id: exp.display_id,
            rubric_id: exp.rubric_id,
            model: exp.model,
            temperature: exp.temperature,
            prompt_template: exp.prompt_template,
            notes: exp.notes,
            run_stats: exp.run_stats,
          },
        }
      }

      case 'task_result': {
        const expId = (ref.extra as { experiment_id?: string } | undefined)?.experiment_id
        if (!expId) return { ...base, status: 'error', error: 'missing experiment_id in extra' }
        const results = readResults(expId)
        const found = results.find(r => r.task_id === ref.id)
        if (!found) return { ...base, status: 'missing' }
        return {
          ...base,
          status: 'ok',
          summary: found.status === 'success'
            ? summarizeOutput(found.output ?? {})
            : `[${found.status}] ${(found.error ?? '').slice(0, 60)}`,
          data: found,
        }
      }

      case 'task_field': {
        const extra = ref.extra as { experiment_id?: string; task_id?: string; field?: string } | undefined
        const expId = extra?.experiment_id
        const taskId = extra?.task_id
        const field = extra?.field
        if (!expId || !taskId || !field) {
          return { ...base, status: 'error', error: 'task_field requires extra.experiment_id / task_id / field' }
        }
        const results = readResults(expId)
        const found = results.find(r => r.task_id === taskId)
        if (!found) return { ...base, status: 'missing', error: `task ${taskId} not found` }
        const value = found.status === 'success' ? (found.output as Record<string, unknown> | undefined)?.[field] : undefined
        return {
          ...base,
          status: 'ok',
          summary: `${field} = ${String(value).slice(0, 60)}`,
          data: {
            experiment_id: expId,
            task_id: taskId,
            field,
            value,
            task_status: found.status,
            input_refs: found.input_refs,
            input_preview: found.input_preview,
          },
        }
      }

      case 'text_selection': {
        const extra = ref.extra as { text?: string } | undefined
        const text = extra?.text ?? ''
        if (!text) return { ...base, status: 'error', error: 'text_selection requires extra.text' }
        return {
          ...base,
          status: 'ok',
          summary: text.length > 40 ? text.slice(0, 40) + '…' : text,
          data: {
            text,
            length: text.length,
          },
        }
      }

      case 'template': {
        const schema = getSchema(ref.id)
        if (!schema) return { ...base, status: 'missing' }
        return {
          ...base,
          status: 'ok',
          summary: `${schema.label ?? schema.id}`,
          data: schema,
        }
      }

      case 'dataset': {
        try {
          const { def, records } = getDataset(ref.id)
          return {
            ...base,
            status: 'ok',
            summary: `${def.name} · ${records.length} records`,
            data: { def, sample: records.slice(0, 3), total: records.length },
          }
        } catch {
          return { ...base, status: 'missing' }
        }
      }

      case 'display': {
        const d = getDisplay(ref.id)
        if (!d) return { ...base, status: 'missing' }
        return {
          ...base,
          status: 'ok',
          summary: `${d.name}`,
          data: d,
        }
      }

      case 'rubric': {
        const r = getRubric(ref.id)
        if (!r) return { ...base, status: 'missing' }
        return {
          ...base,
          status: 'ok',
          summary: `${r.name} · ${r.criteria.length} criteria`,
          data: r,
        }
      }

      case 'rubric_stats': {
        const rubricId = (ref.extra as { rubric_id?: string } | undefined)?.rubric_id
        if (!rubricId) return { ...base, status: 'error', error: 'missing rubric_id in extra' }
        const rubric = getRubric(rubricId)
        if (!rubric) return { ...base, status: 'missing', error: `rubric ${rubricId} not found` }
        const totalTasks = readResults(ref.id).length
        const agg = aggregateAnnotations(ref.id, rubric, totalTasks)
        return {
          ...base,
          status: 'ok',
          summary: `${rubric.name} · ${agg.annotated_tasks}/${agg.total_tasks} annotated`,
          data: agg,
        }
      }

      default:
        return { ...base, status: 'error', error: `unknown type: ${ref.type}` }
    }
  } catch (e) {
    return { ...base, status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

type AncestorRef = { type: string; id: string; extra?: Record<string, unknown> }

/**
 * 基于 ref 已有信息推导出隐式祖先：
 *   - task_field 知道 experiment_id + task_id → 补 task_result + experiment
 *   - task_result 知道 experiment_id → 补 experiment
 *   - text_selection 的 explicit ancestors 里含 task_field / task_result → 进一步展开
 *
 * 去重：已在 explicit 里的不重复加。
 */
function deriveImplicitAncestors(ref: CopilotContextRef, explicit: AncestorRef[]): AncestorRef[] {
  const has = (type: string, id: string) => explicit.some(a => a.type === type && a.id === id)
  const implicit: AncestorRef[] = []

  const addTaskResult = (taskId: string, expId?: string) => {
    if (!has('task_result', taskId)) implicit.push({ type: 'task_result', id: taskId, extra: { experiment_id: expId } })
  }
  const addExperiment = (expId: string) => {
    if (!has('experiment', expId)) implicit.push({ type: 'experiment', id: expId })
  }

  const maybeExpandFrom = (a: { type: string; extra?: Record<string, unknown> }) => {
    if (a.type === 'task_field') {
      const e = a.extra as { experiment_id?: string; task_id?: string } | undefined
      if (e?.task_id) addTaskResult(e.task_id, e.experiment_id)
      if (e?.experiment_id) addExperiment(e.experiment_id)
    }
    if (a.type === 'task_result') {
      const e = a.extra as { experiment_id?: string } | undefined
      if (e?.experiment_id) addExperiment(e.experiment_id)
    }
  }

  // 从 ref 本身推
  maybeExpandFrom({ type: ref.type, extra: ref.extra as Record<string, unknown> | undefined })
  // 从 explicit ancestor 继续推
  for (const a of explicit) maybeExpandFrom(a)

  return implicit
}

/**
 * Resolve 一条 context：包括它自身 + `extra.ancestors` 里记录的显式祖先 + 通过 extra 推导出的隐式祖先。
 * 隐式祖先的价值：实验详情页的 experiment 数据挂在状态卡上，不是整页外层 → DOM 走不到它 →
 * 需要通过 task_result.extra.experiment_id 显式补回来。
 */
export function resolveContext(ref: CopilotContextRef): ResolvedContext {
  const self = resolveContextSelf(ref)
  const explicit = ((ref.extra as { ancestors?: AncestorRef[] } | undefined)?.ancestors) ?? []
  const implicit = deriveImplicitAncestors(ref, explicit)
  const allAncestors = [...explicit, ...implicit]
  if (allAncestors.length === 0) return self
  const chain: ResolvedContext[] = allAncestors.map(a => resolveContextSelf({
    tag: 0,
    type: a.type,
    id: a.id,
    extra: a.extra,
  }))
  return { ...self, context_chain: chain }
}

export function resolveContexts(refs: CopilotContextRef[]): ResolvedContext[] {
  return refs.map(resolveContext)
}

/** 把 resolved contexts 拼成给 LLM 的 system message 附加块。
 *
 *  结构（markdown 友好，预览渲染出来就是层级清晰的 heading + blockquote）：
 *    # 当前页面                 —— 若提供 pageContext
 *    # 用户圈选的上下文 (context)
 *    ## 📚 Referenced entities  —— 去重的实体目录
 *    ## 🎯 User selections       —— 显眼的 `### ■ #N · TYPE` header + `_within_: A → B` 层级
 *    ## ⚠️ 解析失败的 context    —— 若有
 */
export function formatContextsForLlm(
  resolved: ResolvedContext[],
  pageContext?: import('./types').PageContext | null,
): string {
  const parts: string[] = []

  if (pageContext) {
    parts.push('# 当前页面')
    parts.push('')
    parts.push(`path: \`${pageContext.path}\``)
    parts.push(`route_type: \`${pageContext.route_type}\``)
    parts.push('')
    parts.push('## Summary')
    parts.push('')
    for (const [k, v] of Object.entries(pageContext.summary ?? {})) {
      const line = typeof v === 'object' && v !== null
        ? `- ${k}: \`${JSON.stringify(v)}\``
        : `- ${k}: ${String(v)}`
      parts.push(line)
    }
    parts.push('')
  }

  if (resolved.length === 0 && !pageContext) return ''
  if (resolved.length === 0) return parts.join('\n')

  const ok = resolved.filter(r => r.status === 'ok')
  const missing = resolved.filter(r => r.status !== 'ok')
  if (ok.length === 0 && missing.length === 0) return parts.join('\n')

  // 1. 收集所有被引用的实体（主 context + 所有 ancestors），按 type:id 去重
  const entities = new Map<string, ResolvedContext>()
  const asEntity = (r: ResolvedContext): boolean => r.type !== 'text_selection'

  for (const r of ok) {
    if (asEntity(r)) entities.set(`${r.type}:${r.id}`, r)
    if (r.context_chain) {
      for (const anc of r.context_chain) {
        if (anc.status === 'ok' && asEntity(anc)) {
          entities.set(`${anc.type}:${anc.id}`, anc)
        }
      }
    }
  }

  if (ok.length > 0) {
    parts.push('# 用户圈选的上下文 (context)')
    parts.push('')
    parts.push('用户在下方消息里用 **#1 / #2 / 1、2** 等数字引用下面 "User selections" 里对应编号的条目。请对号入座。')
    parts.push('')

    if (entities.size > 0) {
      parts.push('## 📚 Referenced entities')
      parts.push('')
      parts.push('_所有被引用的对象去重后各出现一次。User selections 里用 "see entity" 引到这里。_')
      parts.push('')
      for (const e of entities.values()) {
        parts.push(`### \`${e.type}:${e.id}\`${e.summary ? ' — ' + e.summary : ''}`)
        parts.push('')
        parts.push('```json')
        parts.push(safeStringify(e.data))
        parts.push('```')
        parts.push('')
      }
    }

    parts.push('## 🎯 User selections')
    parts.push('')
    for (const r of ok) {
      parts.push(`### ■ #${r.tag} · ${r.type.toUpperCase()}${r.summary ? ' · ' + r.summary : ''}`)
      parts.push('')
      if (r.type === 'text_selection') {
        const data = r.data as { text?: string } | undefined
        if (data?.text) {
          for (const line of data.text.split(/\r?\n/)) parts.push(`> ${line}`)
          parts.push('')
        }
      } else {
        parts.push(`_see entity \`${r.type}:${r.id}\` in Referenced entities above._`)
        parts.push('')
      }
      if (r.context_chain && r.context_chain.length > 0) {
        const okChain = r.context_chain.filter(a => a.status === 'ok')
        if (okChain.length > 0) {
          parts.push(`_within_: ${okChain.map(a => `\`${a.type}:${a.id}\``).join(' → ')}`)
          parts.push('')
        }
      }
    }
  }

  if (missing.length > 0) {
    parts.push('## ⚠️ 解析失败的 context')
    parts.push('')
    for (const m of missing) {
      parts.push(`- **#${m.tag}** \`${m.type}:${m.id}\`: ${m.status}${m.error ? ' · ' + m.error : ''}`)
    }
  }
  return parts.join('\n')
}

function summarizeOutput(out: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(out)) {
    if (parts.join(' · ').length > 80) break
    if (v == null) continue
    if (typeof v === 'object') continue
    parts.push(`${k}=${String(v).slice(0, 24)}`)
  }
  return parts.join(' · ') || '(empty)'
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// ---------- v2 · per-id + per-scope resolver ----------
//
// read_context(id, scope) 工具的后端实现。id 是 "ctx_N"；session-scoped，
// 指向 active branch 最后一条 user 消息 contexts 里 tag===N 的那条 ref。
//
// scope 语义（spec §5.10.4 表）：
//   self   —— 只含对象本身最小信息
//   parent —— 对象 + 上一层元数据（task_field → 完整 task_result；task_result → + experiment 元数据）
//   full   —— 预留，当前与 parent 等价
//
// 返 null 表示 ctx_N 在当前 session 里不存在（可能是用户已取消圈选）。

import { getActiveContextByTag } from './session-store'

export type ContextScope = 'self' | 'parent' | 'full'

export interface ScopedContextResolution {
  type: string
  ref: CopilotContextRef
  self_value: unknown
  parent_value?: unknown
  full_value?: unknown
}

function parseCtxId(ctxId: string): number | null {
  const m = ctxId.match(/^ctx_(\d+)$/)
  if (!m) return null
  return Number(m[1])
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => {
    if (o && typeof o === 'object') return (o as Record<string, unknown>)[k]
    return undefined
  }, obj)
}

export function resolveContextById(
  session_id: string,
  ctx_id: string,
): ScopedContextResolution | null {
  const tag = parseCtxId(ctx_id)
  if (tag === null) return null

  const ref = getActiveContextByTag(session_id, tag)
  if (!ref) return null

  // 复用既有 resolveContextSelf：拿到 .data（完整结构化数据）
  const resolved = resolveContextSelf(ref)
  if (resolved.status !== 'ok') return null

  switch (ref.type) {
    case 'task_field': {
      const extra = (ref.extra ?? {}) as { experiment_id?: string; task_id?: string; field?: string }
      const field = extra.field ?? ref.id
      const taskId = extra.task_id
      const expId = extra.experiment_id
      if (!expId || !taskId) {
        return { type: ref.type, ref, self_value: resolved.data }
      }
      const results = readResults(expId)
      const task = results.find((r) => r.task_id === taskId)
      const fieldValue =
        task && task.status === 'success'
          ? getByPath(task.output, field)
          : undefined
      return {
        type: ref.type,
        ref,
        // self：只 field 自己
        self_value: { targeted_field: field, targeted_value: fieldValue },
        // parent：带出整条 task
        parent_value: { targeted_field: field, targeted_value: fieldValue, task },
      }
    }

    case 'task_result': {
      const extra = (ref.extra ?? {}) as { experiment_id?: string }
      const expId = extra.experiment_id
      const exp = expId ? getExperiment(expId) : null
      return {
        type: ref.type,
        ref,
        self_value: resolved.data,
        parent_value: exp ? { task: resolved.data, experiment: exp } : undefined,
      }
    }

    // experiment / template / dataset / display / rubric / rubric_stats / text_selection
    default:
      return { type: ref.type, ref, self_value: resolved.data }
  }
}
