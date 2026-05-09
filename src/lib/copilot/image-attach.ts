// Pure logic for image attachment:
// - collectImageRefs scans the active branch for circled task_result/task_field
//   contexts and tool_result wrapper attachments, dedupes by URL, caps at N=5,
//   user contexts win priority on the cap.
// - extractImageRefsFromOutput is the reusable helper for tools (Task 7).
// - readImageBytes / resolveImageDiskPath added in Task 6.
//
// Schema walk uses output_schema.properties (Record<fieldName, JsonPropDef>),
// NOT a .fields[] array — that property does not exist on JsonSchemaDef.

import type { CopilotMessage, CopilotContextRef, ImageRef, ToolResultContent } from './types'
import type { TaskSchema, JsonPropDef } from '@/lib/schema/types'
import { getExperiment, readResults } from '@/lib/store'
import { getSchema } from '@/lib/schema'
import { normalizeToolResult } from './session-store'

export const MAX_IMAGES_PER_TURN = 5

const IMAGE_FIELD_NAME_RE = /url|image|pic|img|photo/i
const PATH_PREFIX_RE = /^(images\/|\/api\/results\/[^/]+\/images\/)/

export interface CollectInput {
  branch: CopilotMessage[]
  schemaCache: Map<string, TaskSchema>   // per-call cache; caller builds + passes
  modelVisionCapable: boolean
}

export interface CollectOutput {
  user_image_refs: ImageRef[]
  tool_image_refs: Map<string, ImageRef[]>   // call_id → refs
  dropped_count: number
}

function getCachedSchema(cache: Map<string, TaskSchema>, schemaId: string): TaskSchema | null {
  const hit = cache.get(schemaId)
  if (hit) return hit
  const fresh = getSchema(schemaId)
  if (!fresh) return null
  cache.set(schemaId, fresh)
  return fresh
}

function normalizeUrl(raw: string, expId: string): string {
  if (raw.startsWith('data:') || raw.startsWith('http')) return raw
  if (raw.startsWith('/api/results/')) return raw
  if (raw.startsWith('images/')) return `/api/results/${expId}/${raw}`
  return raw
}

/** Tool helper: walk output_schema.properties, emit ImageRef[] (no cap, no dedup). */
export function extractImageRefsFromOutput(
  output: Record<string, unknown>,
  schema: TaskSchema,
  expId: string,
  ctx_tag?: number,
  task_id?: string,
): ImageRef[] {
  const props = schema.output_schema?.properties ?? {}
  const labelRoot = task_id ? `task_result#${task_id}` : 'task_result'
  const refs: ImageRef[] = []
  const declared: Set<string> = new Set()

  for (const [name, def] of Object.entries(props) as Array<[string, JsonPropDef]>) {
    if (def.type === 'image_url') {
      declared.add(name)
      const v = output[name]
      if (typeof v === 'string' && v) {
        refs.push({
          url: normalizeUrl(v, expId),
          source_label: `${labelRoot} · field=${name}`,
          ctx_tag,
        })
      }
    } else if (def.type === 'image_url_list') {
      declared.add(name)
      const v = output[name]
      if (Array.isArray(v)) {
        for (const u of v) {
          if (typeof u === 'string' && u) {
            refs.push({
              url: normalizeUrl(u, expId),
              source_label: `${labelRoot} · field=${name}`,
              ctx_tag,
            })
          }
        }
      }
    }
  }
  // Heuristic fallback: name matches AND value is a recognizable path
  for (const [name, def] of Object.entries(props) as Array<[string, JsonPropDef]>) {
    if (declared.has(name)) continue
    if (!IMAGE_FIELD_NAME_RE.test(name)) continue
    void def // declared via the loop type but unused after schema check
    const v = output[name]
    if (typeof v === 'string' && v && PATH_PREFIX_RE.test(v)) {
      refs.push({
        url: normalizeUrl(v, expId),
        source_label: `${labelRoot} · field=${name} (inferred)`,
        ctx_tag,
      })
    }
  }
  return refs
}

function refsFromTaskResultContext(
  ref: CopilotContextRef,
  cache: Map<string, TaskSchema>,
): ImageRef[] {
  const expId = (ref.extra as { experiment_id?: string } | undefined)?.experiment_id
  if (!expId) return []
  const exp = getExperiment(expId)
  if (!exp?.schema_id) return []
  const schema = getCachedSchema(cache, exp.schema_id)
  if (!schema) return []
  const found = readResults(expId).find((r) => r.task_id === ref.id)
  if (!found || found.status !== 'success' || !found.output) return []
  return extractImageRefsFromOutput(
    found.output as Record<string, unknown>,
    schema,
    expId,
    ref.tag,
    ref.id,
  )
}

function refsFromTaskFieldContext(
  ref: CopilotContextRef,
  cache: Map<string, TaskSchema>,
): ImageRef[] {
  const extra = (ref.extra ?? {}) as { experiment_id?: string; field?: string; field_type?: string }
  if (extra.field_type !== 'image_url') return []
  const expId = extra.experiment_id
  const fieldName = extra.field
  if (!expId || !fieldName) return []
  const exp = getExperiment(expId)
  if (!exp?.schema_id) return []
  const schema = getCachedSchema(cache, exp.schema_id)
  if (!schema) return []
  const found = readResults(expId).find((r) => r.task_id === ref.id)
  if (!found || found.status !== 'success' || !found.output) return []
  const v = (found.output as Record<string, unknown>)[fieldName]
  if (typeof v !== 'string' || !v) return []
  return [{
    url: normalizeUrl(v, expId),
    source_label: `task_result#${ref.id} · field=${fieldName}`,
    ctx_tag: ref.tag,
  }]
}

export function collectImageRefs(input: CollectInput): CollectOutput {
  const empty: CollectOutput = { user_image_refs: [], tool_image_refs: new Map(), dropped_count: 0 }
  if (!input.modelVisionCapable) return empty

  // 1) Gather user-side candidates from the last user message's contexts
  const lastUser = [...input.branch].reverse().find((m) => m.role === 'user')
  const userCandidates: ImageRef[] = []
  for (const ref of lastUser?.contexts ?? []) {
    if (ref.type === 'task_result') {
      userCandidates.push(...refsFromTaskResultContext(ref, input.schemaCache))
    } else if (ref.type === 'task_field') {
      userCandidates.push(...refsFromTaskFieldContext(ref, input.schemaCache))
    }
  }

  // 2) Gather tool-side candidates from in-window tool_result wrapper.attachments
  const toolCandidates: Array<{ call_id: string; ref: ImageRef }> = []
  for (const m of input.branch) {
    if (m.role !== 'tool_result' || !m.call_id) continue
    const parsed: ToolResultContent = normalizeToolResult(m.content)
    const attachments = (parsed as { attachments?: ImageRef[] }).attachments
    if (!attachments) continue
    for (const ref of attachments) toolCandidates.push({ call_id: m.call_id, ref })
  }

  // 3) Cap + dedupe; user wins priority
  const seen = new Set<string>()
  const userOut: ImageRef[] = []
  const toolOut = new Map<string, ImageRef[]>()
  let total = 0
  let dropped = 0
  for (const ref of userCandidates) {
    if (seen.has(ref.url)) continue
    if (total >= MAX_IMAGES_PER_TURN) { dropped++; continue }
    seen.add(ref.url); userOut.push(ref); total++
  }
  for (const { call_id, ref } of toolCandidates) {
    if (seen.has(ref.url)) continue
    if (total >= MAX_IMAGES_PER_TURN) { dropped++; continue }
    seen.add(ref.url)
    const arr = toolOut.get(call_id) ?? []
    arr.push(ref); toolOut.set(call_id, arr); total++
  }
  return { user_image_refs: userOut, tool_image_refs: toolOut, dropped_count: dropped }
}
