// Vision gate · spec §3.3 layer 2
//
// Defense-in-depth layer 2: server-side reject when the selected model isn't
// vision_capable AND the request carries image-bearing contexts. UI picker
// (layer 1) prevents most cases; build-llm-messages strip (layer 3) is the
// last-resort silent fallback. Layer 2 makes direct curl callers (e.g.
// agentic clients bypassing the UI) hit a clear 400 instead of degrading
// to text-only without telling them.
//
// Reuses collectImageRefs to do real schema-aware probing (not just type
// heuristics on contexts), so a task_result with no image fields, or a
// task_field of string type, won't false-reject.

import type { CopilotContextRef, CopilotMessage } from './types'
import type { ModelConfig } from '@/lib/llm-config'
import type { TaskSchema } from '@/lib/schema/types'
import { collectImageRefs } from './image-attach'

export type VisionGateResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Synthesize a minimal branch with a single user message bearing the request's
 * contexts so collectImageRefs's "last user message" lookup hits, then probe
 * with modelVisionCapable=true so the function actually walks schemas (it
 * short-circuits to empty when modelVisionCapable=false).
 *
 * If any user-side image refs are produced AND the model isn't vision_capable,
 * reject. Tool-side attachments are not gated here — they're produced by
 * tools mid-conversation, not at chat entry.
 */
export function validateVisionGate(
  contexts: CopilotContextRef[] | undefined,
  model: Pick<ModelConfig, 'vision_capable'>,
): VisionGateResult {
  if (model.vision_capable === true) return { ok: true }
  if (!contexts || contexts.length === 0) return { ok: true }

  const probeBranch: CopilotMessage[] = [{
    id: 'probe_user',
    session_id: 'probe',
    role: 'user',
    content: '',
    contexts,
    timestamp: new Date(0).toISOString(),
  }]

  const out = collectImageRefs({
    branch: probeBranch,
    schemaCache: new Map<string, TaskSchema>(),
    modelVisionCapable: true,
  })

  if (out.user_image_refs.length === 0) return { ok: true }
  return {
    ok: false,
    reason: 'selected model is not vision_capable; image contexts cannot be processed',
  }
}
