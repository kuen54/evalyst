# Copilot × Image Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Evalyst Copilot actually see images when the user circles image-bearing task results, so vision-driven iteration loops ("why didn't this draw correctly", "compare #1 vs #2", "tweak prompt for brighter hair") finally work.

**Architecture:** Single transformation point in `build-llm-messages.ts`. When assembling `LlmMessage[]` from the active branch, scan the last user message's `contexts[]` and any in-window `tool_result` `_attachments` for image references; `fs.readFile` + base64 + cap N=5 (deduped); inject `{type:'image_url', image_url:{url:'data:...'}}` blocks alongside text. SystemHeader stays ref-only (v2 progressive disclosure preserved). Anthropic serializer detects `data:` prefix and converts to `source.type='base64'` form. Vision gating via 3-layer defense (model picker filter → chat route validation → build-llm-messages strip-and-note).

**Tech Stack:** TypeScript 5+ (strict mode), Next.js 16.2.4 App Router, vitest, fs/promises, Node.js Buffer for base64, shadcn/ui v4 + Tailwind 4 for the model card checkbox + chip thumbnail, existing `LlmMessage` discriminated union (already supports multimodal blocks).

**Spec:** `docs/superpowers/specs/2026-05-09-copilot-image-vision-design.md`

**Branch:** `feat/copilot-image-vision` (already created; cb4c613 base).

**Parallel-session warning:** Run `git branch --show-current` before each task. If it's not `feat/copilot-image-vision`, switch back. Another Claude session may be on `feat/copilot-v25-*`.

---

## File Structure (5 layers)

### Layer 1 · Foundation types & protocol

| File | Operation | Responsibility |
|---|---|---|
| `src/lib/llm-config.ts` | modify | Add `ModelConfig.vision_capable?: boolean` (optional, default false) |
| `src/lib/copilot/types.ts` | modify | Add `ImageRef` interface; add `ToolResultContent.attachments?: ImageRef[]` |
| `src/lib/llm-client.ts` | modify | Extend `LlmMessage.tool_result.content` union to `string \| Array<...>`; add `imageBlockForAnthropic` helper (data URL detection) |
| `src/lib/copilot/llm-stream.ts` | modify | Use `imageBlockForAnthropic` in `serializeAnthropicAssistantBlock` + `serializeAnthropicNonAssistant`; handle tool_result content array |

### Layer 2 · Image extraction core

| File | Operation | Responsibility |
|---|---|---|
| `src/lib/copilot/image-attach.ts` | **create** | Pure logic: `collectImageRefs(branch, modelVisionCapable)` → `{user_image_refs, tool_image_refs, dropped_count}`; `readImageBytes(ref)` → `{data_url} \| {error}`; `extractImageRefsFromOutput(output, schema, expId, ctx_tag?, task_id?)` reusable by tools — walks `output_schema.properties` (the canonical shape: `Record<string, JsonPropDef>`, NOT a `.fields[]` array; field name is the map key); `MAX_IMAGES_PER_TURN = 5` constant |
| `src/lib/copilot/__tests__/image-attach.test.ts` | **create** | Schema-aware extraction (image_url + image_url_list); heuristic fallback; dedup; cap=5 + dropped_count; URL normalization; non-vision short-circuit |
| `src/lib/copilot/__tests__/image-attach.read-bytes.test.ts` | **create** | data URL passthrough; disk file success; missing file error; path-traversal rejection; mime-by-ext fallback |

### Layer 3 · build-llm-messages multimodal rewrite

| File | Operation | Responsibility |
|---|---|---|
| `src/lib/copilot/build-llm-messages.ts` | modify | Make signature `async`; integrate image plan (collect → read bytes → rewrite user/tool_result content); 3rd-layer vision strip + system note |
| `src/lib/copilot/stream-response.ts` | modify | `await buildLlmMessages(...)`; pass `modelVisionCapable` opt |
| `src/lib/copilot/__tests__/build-llm-messages.image.test.ts` | **create** | User msg multimodal rewrite (with/without images); tool_result inline rewrite; tool_result ref-kind drops attachments; vision-strip note; dropped_count note |
| `src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts` | **create** | data URL → source.type=base64 + media_type; HTTP URL → source.type=url; mixed content array |
| `src/lib/copilot/__tests__/build-llm-messages.test.ts` | modify (existing) | Async-ify all existing test cases (mechanical `await` prefix) |

### Layer 4 · Tool integration (`_attachments`)

**Wrapper-vs-value protocol** (resolved during outline review): tools emit `_attachments: ImageRef[]` at the **value level** (inside their domain output). `payloadGuardHook` lifts that field up to the **wrapper level** (`ToolResultContent.attachments`) and strips it from the inner value, so:
- For `kind: 'inline'`: attachments accessible without parsing inner value JSON
- For `kind: 'ref'`: attachments survive on wrapper even when value is offloaded to disk; build-llm-messages re-attaches images for ref-kind tool_results too. read_tool_result回捞-then-rematerialize gets suppressed by `collectImageRefs`'s global URL dedupe.

| File | Operation | Responsibility |
|---|---|---|
| `src/lib/copilot/tools/read-context.ts` | modify | When type is task_result/task_field with image fields, return `{...domain, _attachments: ImageRef[]}` |
| `src/lib/copilot/tools/read-experiment-results.ts` | modify | After result aggregation, scan first N=5 with image fields → emit `_attachments` at value level |
| `src/lib/copilot/tools/read-resource.ts` | modify | When loading experiment-resource includes a sample task_result with image, attach |
| `src/lib/copilot/tools/hooks.ts` | modify | `payloadGuardHook` lifts `_attachments` from `output.value._attachments` (when shape is `{kind:'ok', value:{...}}`) into the resulting `ToolResultContent.attachments`; strips from inner value before `maybePersistToolResult` |
| `src/lib/copilot/tool-result-store.ts` | modify | Persist `attachments` field through `maybePersistToolResult` + `loadPersistedToolResult` (JSON pass-through; no extraction logic — extraction lives in hooks.ts) |
| `src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts` | **create** | _attachments populated; cap=5 truncation; non-image-schema returns no attachments |
| `src/lib/copilot/tools/__tests__/read-context.image.test.ts` | **create** | task_result + task_field both attach; non-image result doesn't |
| `src/lib/copilot/tools/__tests__/hooks.attachments-lift.test.ts` | **create** | payloadGuardHook lifts `_attachments` from value to wrapper for inline + ref kinds; absent _attachments → wrapper has no attachments |

### Layer 5 · UI surfaces

| File | Operation | Responsibility |
|---|---|---|
| `src/components/results/single-list-results.tsx` (and dual-list, triple-grid, grouped_grid, jsx variants where applicable) | modify | When the wrapped `task_field` extras object is built, add `field_type: 'image_url'` (or `'image_url_list'`) to the JSON when `JsonPropDef.type` indicates image. The existing `data-copilot-context="task_field"` parent div + extras object is already in place — this is a 1-line addition per callsite. **Do NOT modify `view-helpers.tsx`** — `renderField` has no access to the result record metadata; existing parent-div wiring at the calling site is correct. |
| `src/components/copilot/context-chip-rail.tsx` | modify | Expanded chip detail: detect image_url field in detail.data → render 120px ClickableImage thumbnail (reuses ImageLightboxProvider) |
| `src/components/copilot/model-picker.tsx` | modify | Accept `requireVision?: boolean` prop; filter to `copilot_enabled && (!requireVision \|\| vision_capable)` |
| `src/components/copilot/chat-view.tsx` | modify | Compute `imageContextCount` from active contexts; pass `requireVision` to ModelPicker |
| `src/components/settings/model-card.tsx` | modify | Add `vision_capable` checkbox + label/description (i18n) |
| `src/lib/i18n/zh.ts` | modify | Add 5 new keys |
| `src/lib/i18n/en.ts` | modify | Mirror 5 new keys (typecheck enforced) |

---

## Task List

Tasks are ordered for **incremental green-bar TDD**: each task ends with `npm test` passing and a commit. Tasks 1–4 lay the foundation; 5–7 build the core extraction module; 8–11 wire it into build-llm-messages; 12–15 hook the tools; 16–19 the UI; 20–21 finalize.

**Open questions to resolve at specific tasks:**
- Open Q1 (OpenAI tool_result content array compat) → resolved at **Task 0 (curl probe)** before Layer 1 work
- Open Q2 (schema cache scope) → decided at **Task 5** as per-call Map (default; no config)
- Open Q3 (read_tool_result re-attach cap) → revised: ref-kind tool_result DOES carry attachments via wrapper; build-llm-messages re-attaches images on every replay; URL-level dedup in `collectImageRefs` suppresses double-counting from `read_tool_result` rematerialization. Decided at **Task 12** in payloadGuardHook lift logic.
- Open Q4 (frontend imageContextCount precision) → decided at **Task 17** as conservative "task_result/task_field by default"
- Open Q5 (vision_capable default migration) → decided at **Task 1** as "leave blank, doc only"

**Outline-review correction (during plan-fill subagent dispatch)**: The schema walk uses `output_schema.properties` (a `Record<string, JsonPropDef>` map; field name = map key), NOT `output_schema.fields[].name`. All extraction code in Tasks 5/7/13 reflects this. The `_attachments` (value-level, with leading underscore) → `attachments` (wrapper-level, no underscore) transformation happens in `payloadGuardHook` (Task 12), not silently in `tool-result-store.ts`. UI captures (Task 16) augment EXISTING `task_field` extras; `view-helpers.tsx::renderField` is NOT modified.

---

### Task 0: API compatibility probe (sankuai gateway tool_result content array)

**Why:** Spec §4.4.1 left this open. We need to confirm whether sankuai gateway's OpenAI-compat `/chat/completions` endpoint accepts `tool` role messages with `content: Array<{type:'text'} \| {type:'image_url'}>`. If yes → spec design A (Recommended). If no → fall back to design B (text-only tool_result + extra user message after with images).

**Files:** none code-side; produces a finding committed to `docs/superpowers/plans/findings/2026-05-09-tool-result-content-array.md`

**Steps:**

- [ ] **Step 1: Construct the probe**

  Save the script below to `/tmp/probe-tool-result-array.sh` (do NOT commit it):

  ```bash
  #!/usr/bin/env bash
  # Probe: does sankuai gateway accept tool role with content: Array<text|image_url>?
  # Usage: SANKUAI_TOKEN="Bearer xxxx" bash /tmp/probe-tool-result-array.sh
  # Expected env: SANKUAI_TOKEN must be a valid bearer (with "Bearer " prefix).

  set -u

  if [[ -z "${SANKUAI_TOKEN:-}" ]]; then
    echo "ERROR: set SANKUAI_TOKEN env var (with 'Bearer ' prefix)" >&2
    exit 2
  fi

  # 1×1 transparent PNG, base64-encoded (smallest possible image_url payload)
  IMG_DATA_URL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

  curl -sS -i -X POST \
    "https://aigc.sankuai.com/v1/openai/native/v1/chat/completions" \
    -H "Authorization: ${SANKUAI_TOKEN}" \
    -H "Content-Type: application/json" \
    -d @- <<JSON
  {
    "model": "anthropic.claude-sonnet-4",
    "max_tokens": 256,
    "messages": [
      {"role": "user", "content": "Look at the image I will provide via the tool result and tell me what colour it is."},
      {"role": "assistant", "content": null, "tool_calls": [
        {"id": "call_probe_1", "type": "function",
         "function": {"name": "fetch_image", "arguments": "{}"}}
      ]},
      {"role": "tool", "tool_call_id": "call_probe_1",
       "content": [
         {"type": "text", "text": "Here is the image you requested:"},
         {"type": "image_url", "image_url": {"url": "${IMG_DATA_URL}"}}
       ]
      }
    ]
  }
  JSON
  ```

  Notes:
  - Run from a shell where `SANKUAI_TOKEN` is set per `reference_sankuai_anthropic_gateway` memory (full string starts with `Bearer `).
  - Endpoint chosen: OpenAI-compatible path on sankuai gateway (`/v1/openai/native/v1`). If the user's actual deployed gateway differs, swap base URL but keep the message shape.
  - The empty-args `fetch_image` tool_call is purely synthetic — the gateway only checks payload schema, not whether the tool exists in `tools[]`.

- [ ] **Step 2: Run and observe**

  Run: `SANKUAI_TOKEN="Bearer <real-token>" bash /tmp/probe-tool-result-array.sh`

  Decision tree:

  - **HTTP 200 + JSON body with `choices[0].message.content` non-empty** → **Branch A** (gateway accepts content array as-is). Proceed with spec design A in Tasks 4/10. Save Branch A verdict.
  - **HTTP 4xx (most likely 400)** with body mentioning anything like `tool message content must be string`, `expected string for content`, `schema validation`, or `oneOf failed` → **Branch B** (gateway requires string content for tool role). Save Branch B verdict; Tasks 4/10 must take alternate design (string-only tool_result + extra user image message after).
  - **HTTP 5xx / network error** → not informative; rerun with smaller payload or different model. Do NOT commit a verdict on a transient failure.
  - **HTTP 200 but `choices[0].message.content` is empty / refusal-shaped (e.g., "I cannot see images in this response")** → ambiguous; treat as **Branch B** (gateway accepted the shape but model didn't actually receive image bytes — same downstream effect: we can't rely on this path).

- [ ] **Step 3: Save the finding**

  File: `/Users/lijiakun/Documents/evalyst/docs/superpowers/plans/findings/2026-05-09-tool-result-content-array.md`

  Template (replace `<...>` with actual observations from Step 2):

  ```md
  # Finding: sankuai gateway tool-result content array compatibility

  Date: 2026-05-09
  Probe script: see plan Task 0 Step 1 (not committed)
  Endpoint tested: `https://aigc.sankuai.com/v1/openai/native/v1/chat/completions`
  Model used: `<model id>`

  ## Observed response

  - HTTP status: `<200 | 400 | ...>`
  - Body excerpt: `<first ~300 chars>`

  ## Verdict

  **Branch <A | B>**: <one-line summary>

  ## Decision impact on plan

  - Task 4: <Branch A → extend `LlmMessage.tool_result.content` to union, both serializers handle array | Branch B → keep content as string, defer multimodal-on-tool_result to follow-up>
  - Task 10: <Branch A → push image blocks into tool_result content array | Branch B → emit text-only tool_result, then a user message with image blocks after>
  - Anthropic serializer (Task 4): unaffected by branch (Anthropic protocol always supports tool_result content array per its public docs)
  ```

- [ ] **Step 4: Commit the finding**

  ```bash
  git add docs/superpowers/plans/findings/2026-05-09-tool-result-content-array.md
  git commit -m "$(cat <<'EOF'
  docs(copilot): record sankuai gateway tool_result content array probe finding

  Branch A (recommended) vs Branch B (string-only fallback) decision recorded
  for Tasks 4/10 of copilot image-vision plan.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 1: ModelConfig.vision_capable + ModelCard checkbox + i18n

**Files:**
- Modify: `src/lib/llm-config.ts` (add `vision_capable?: boolean` to `ModelConfig`)
- Modify: `src/components/settings/model-card.tsx` (Checkbox after copilot_enabled)
- Modify: `src/lib/i18n/zh.ts`, `src/lib/i18n/en.ts` (`settings.llm.vision_capable_label`, `settings.llm.vision_capable_desc`)
- Test: `src/lib/__tests__/llm-config.migrate.test.ts` (extend: vision_capable round-trips through migrate; old config without field round-trips as undefined)

**Constraints:**
- Default `undefined` (NOT `false`) so existing JSON saved-back doesn't acquire the field unnecessarily
- Migration: vision_capable purely additive; legacy V1/V2/V3 paths leave it undefined
- `vision_capable_desc` text must mention this only matters for Copilot, not batch-runner

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/__tests__/llm-config.migrate.test.ts`

  Append the following block inside the `describe("getLlmConfig migrate", () => { ... })` block, just after the existing `"preserves copilot_enabled flag through migration"` case:

  ```ts
  it("preserves vision_capable flag through migration (V3 pass-through)", () => {
    writeCfg({
      models: [
        { id: "m1", name: "M1", model: "claude-sonnet-4", api_format: "anthropic", base_url: "x", api_key: "k", vision_capable: true },
        { id: "m2", name: "M2", model: "deepseek-chat", api_format: "openai", base_url: "y", api_key: "k2" },
      ],
      active_model_id: "m1",
    })
    const cfg = getLlmConfig()
    expect(cfg.models[0].vision_capable).toBe(true)
    expect(cfg.models[1].vision_capable).toBeUndefined()
  })

  it("V2 providers shape leaves vision_capable undefined (additive field)", () => {
    writeCfg({
      providers: [
        {
          id: "prov-1",
          name: "OpenAI",
          api_format: "openai",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-1",
          default_model: "gpt-4o-mini",
        },
      ],
      active_provider_id: "prov-1",
    })
    const cfg = getLlmConfig()
    expect(cfg.models).toHaveLength(1)
    expect(cfg.models[0].vision_capable).toBeUndefined()
  })

  it("V1 legacy single-instance leaves vision_capable undefined", () => {
    writeCfg({
      api_format: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-x",
      default_model: "gpt-4o-mini",
    })
    const cfg = getLlmConfig()
    expect(cfg.models[0].vision_capable).toBeUndefined()
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- llm-config.migrate`

  Expected: FAIL — TypeScript-level error from `vision_capable` being unknown property on `ModelConfig`, surfaced by the test runner. Sample error excerpt:

  ```
  Property 'vision_capable' does not exist on type 'ModelConfig'.
  ```

  (If vitest tolerates the property at runtime, the assertions still fail because the field is dropped during typed deserialization paths — but the typecheck failure is what blocks the green bar.)

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/llm-config.ts`

  ```ts
  // BEFORE (line 22-33):
  /** 单个可用的「模型」：一条完整的可调用配置（模型标识 + endpoint + key + 默认参数 + 定价） */
  export interface ModelConfig {
    id: string                     // slug，稳定引用；nanoid(6) 或迁移保留的 'default'
    name: string                   // 展示名（可留空；UI fallback 用 model）
    model: string                  // 模型标识，如 'gpt-4o-mini' / 'claude-haiku-4-5' / 'deepseek-chat'
    api_format: ApiFormat
    base_url: string
    api_key: string
    default_temperature?: number
    default_max_tokens?: number
    pricing?: ModelPricing         // 该模型的定价（单条）
    copilot_enabled?: boolean      // 是否允许 Evalyst Copilot 使用该模型（默认 false）
  }

  // AFTER:
  /** 单个可用的「模型」：一条完整的可调用配置（模型标识 + endpoint + key + 默认参数 + 定价） */
  export interface ModelConfig {
    id: string                     // slug，稳定引用；nanoid(6) 或迁移保留的 'default'
    name: string                   // 展示名（可留空；UI fallback 用 model）
    model: string                  // 模型标识，如 'gpt-4o-mini' / 'claude-haiku-4-5' / 'deepseek-chat'
    api_format: ApiFormat
    base_url: string
    api_key: string
    default_temperature?: number
    default_max_tokens?: number
    pricing?: ModelPricing         // 该模型的定价（单条）
    copilot_enabled?: boolean      // 是否允许 Evalyst Copilot 使用该模型（默认 false）
    vision_capable?: boolean       // 该模型支持图像输入；仅影响 Copilot 多模态注入路径，不影响 batch-runner（默认 false）
  }
  ```

  File: `/Users/lijiakun/Documents/evalyst/src/components/settings/model-card.tsx`

  ```tsx
  // BEFORE (line 218-230):
  <div className="flex items-center gap-2 py-1">
    <Checkbox
      id={`copilot-enabled-${entry.id}`}
      checked={!!entry.copilot_enabled}
      onCheckedChange={v => set("copilot_enabled", !!v)}
    />
    <Label htmlFor={`copilot-enabled-${entry.id}`} className="text-[13px] font-normal cursor-pointer">
      {t("settings.llm.copilot_enabled_label")}
    </Label>
    <span className="text-[11px] text-muted-foreground ml-1">
      {t("settings.llm.copilot_enabled_hint")}
    </span>
  </div>

  // AFTER:
  <div className="flex items-center gap-2 py-1">
    <Checkbox
      id={`copilot-enabled-${entry.id}`}
      checked={!!entry.copilot_enabled}
      onCheckedChange={v => set("copilot_enabled", !!v)}
    />
    <Label htmlFor={`copilot-enabled-${entry.id}`} className="text-[13px] font-normal cursor-pointer">
      {t("settings.llm.copilot_enabled_label")}
    </Label>
    <span className="text-[11px] text-muted-foreground ml-1">
      {t("settings.llm.copilot_enabled_hint")}
    </span>
  </div>
  <div className="flex items-center gap-2 py-1">
    <Checkbox
      id={`vision-capable-${entry.id}`}
      checked={!!entry.vision_capable}
      onCheckedChange={v => set("vision_capable", !!v)}
    />
    <Label htmlFor={`vision-capable-${entry.id}`} className="text-[13px] font-normal cursor-pointer">
      {t("settings.llm.vision_capable_label")}
    </Label>
    <span className="text-[11px] text-muted-foreground ml-1">
      {t("settings.llm.vision_capable_desc")}
    </span>
  </div>
  ```

  File: `/Users/lijiakun/Documents/evalyst/src/lib/i18n/zh.ts`

  ```ts
  // BEFORE (around line 1110-1111):
    "settings.llm.copilot_enabled_label": "Copilot 可用",
    "settings.llm.copilot_enabled_hint": "允许 Evalyst Copilot 使用该模型对话",

  // AFTER:
    "settings.llm.copilot_enabled_label": "Copilot 可用",
    "settings.llm.copilot_enabled_hint": "允许 Evalyst Copilot 使用该模型对话",
    "settings.llm.vision_capable_label": "支持图像输入",
    "settings.llm.vision_capable_desc": "允许此模型在 Copilot 接收圈选结果中的图像。仅影响 Copilot，不影响批量评测。",
  ```

  File: `/Users/lijiakun/Documents/evalyst/src/lib/i18n/en.ts`

  ```ts
  // BEFORE (around line 1111-1112):
    "settings.llm.copilot_enabled_label": "Available to Copilot",
    "settings.llm.copilot_enabled_hint": "Allow Evalyst Copilot to use this model for chat",

  // AFTER:
    "settings.llm.copilot_enabled_label": "Available to Copilot",
    "settings.llm.copilot_enabled_hint": "Allow Evalyst Copilot to use this model for chat",
    "settings.llm.vision_capable_label": "Vision capable",
    "settings.llm.vision_capable_desc": "Enable to allow this model to receive image attachments from circled task results in Copilot. Only affects Copilot, not batch experiments.",
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- llm-config.migrate`

  Expected: PASS — all 3 new cases plus the existing 12 cases green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit (no errors). Validates `en.ts` `Record<keyof typeof zh, string>` symmetry on the 2 new keys.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/llm-config.ts src/lib/__tests__/llm-config.migrate.test.ts src/components/settings/model-card.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
  git commit -m "$(cat <<'EOF'
  feat(llm-config): add ModelConfig.vision_capable flag + ModelCard checkbox

  Optional boolean signalling Copilot multimodal eligibility. Default undefined
  to leave legacy configs untouched on round-trip. Surfaced as a checkbox in
  /settings/llm; only Copilot consumes it (batch-runner unaffected).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: ImageRef type + ToolResultContent.attachments

**Files:**
- Modify: `src/lib/copilot/types.ts` (add `ImageRef`; extend `ToolResultContent` union arms with optional `attachments?: ImageRef[]`)

**Constraints:**
- `ImageRef.url` is the publicly-addressable form (`/api/results/{exp}/images/{f}.png` or `data:` or `http(s)://`); NOT the disk path (we resolve disk path in image-attach.ts)
- `source_label` is human-readable, used as text caption for LLM ("`task_result#abc · field=image_url`")
- `ctx_tag` optional — present when ref came from circled context, absent for tool-attached
- ToolResultContent: `attachments` is on the `inline` AND `ref` arms (ref form persists attachments to disk JSON; LLM only sees them after read_tool_result回捞 + re-materialize). `compacted` arm omits.

**Tests:** No new tests (pure type addition; verified by tsc and downstream consumers).

**Steps:**

- [ ] **Step 1: (no test step — type-only change; verification is `tsc --noEmit`)**

  This task adds two type declarations only. There are no behavioural changes to test directly. Verification happens via `tsc --noEmit` which catches structural mistakes (typos, wrong field membership). Subsequent tasks (5+) will exercise the new types via their own test suites.

- [ ] **Step 2: (skipped — no failing test)**

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/types.ts`

  ```ts
  // BEFORE (line 18-22):
  export type ToolResultContent =
    | { kind: 'inline'; value: unknown }
    | { kind: 'ref'; ref: string; preview: string }
    | { kind: 'compacted'; summary: string; ref?: string }

  // AFTER:
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
  ```

  Notes:
  - `attachments?` lives on `inline` and `ref` arms only. `compacted` is a lossy summary by design — image refs do not survive compaction (re-collected from upstream wrapper if still in window).
  - Optional throughout: legacy jsonl sessions deserialize to `attachments: undefined`, behaviourally identical to "no images".

- [ ] **Step 4: (skipped — no test to re-run)**

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. Catches any typo in the union arms or invalid `ImageRef` shape; downstream `tool-result-store.ts` / `build-llm-messages.ts` consumers (modified in later tasks) still compile because `attachments?` is optional.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/types.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): add ImageRef type and ToolResultContent.attachments field

  Foundation for image vision plan: ImageRef carries url + source_label + optional
  ctx_tag; ToolResultContent's inline/ref arms gain optional attachments[]. Pure
  type additions, all optional, jsonl backward compatible.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Anthropic data URL serializer (llm-client.ts non-streaming path)

**Files:**
- Modify: `src/lib/llm-client.ts` (`buildRequestBody` Anthropic branch: extract `imageBlockForAnthropic(url)` helper that detects `data:image/...;base64,...` → `{type:'image', source:{type:'base64', media_type, data}}`; HTTP(S) URL → `{type:'image', source:{type:'url', url}}`)
- Test: extend or create `src/lib/__tests__/llm-client.anthropic-data-url.test.ts`

**Constraints:**
- Regex must handle `image/png`, `image/jpeg`, `image/webp` media types (anything else falls through to `image/png` default — log a warn? skip warn for v1)
- Malformed `data:` URL (missing `;base64,`) → fall back to `source.type='url'` (provider will 400, not our problem to validate)
- Existing OpenAI branch unchanged; data URLs in OpenAI go through `image_url.url` natively

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/__tests__/llm-client.anthropic-data-url.test.ts`

  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildApiRequest } from '@/lib/llm-client'
  import type { ApiConfig } from '@/lib/types'

  // We exercise buildRequestBody indirectly via callLlm? No — buildRequestBody is
  // module-private. Easier path: verify the payload that buildApiRequest packages
  // when fed an Anthropic body that already contains image blocks.
  //
  // But the actual transformation (image_url block → source.type=base64) lives
  // in buildRequestBody (private). To test it directly we expose a thin helper
  // imageBlockForAnthropic via export. The Step 3 implementation adds that export.

  import { imageBlockForAnthropic } from '@/lib/llm-client'

  describe('imageBlockForAnthropic', () => {
    it('detects PNG data URL → source.type=base64 with media_type=image/png', () => {
      const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
      const block = imageBlockForAnthropic(url)
      expect(block).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUg==',
        },
      })
    })

    it('detects JPEG data URL → media_type=image/jpeg', () => {
      const url = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      const block = imageBlockForAnthropic(url) as { source: { media_type: string; data: string } }
      expect(block.source.media_type).toBe('image/jpeg')
      expect(block.source.data).toBe('/9j/4AAQSkZJRg==')
    })

    it('detects WebP data URL → media_type=image/webp', () => {
      const url = 'data:image/webp;base64,UklGRhwAAABXRUJQ'
      const block = imageBlockForAnthropic(url) as { source: { media_type: string } }
      expect(block.source.media_type).toBe('image/webp')
    })

    it('passes HTTP URL through as source.type=url', () => {
      const url = 'https://example.com/image.png'
      const block = imageBlockForAnthropic(url)
      expect(block).toEqual({
        type: 'image',
        source: { type: 'url', url: 'https://example.com/image.png' },
      })
    })

    it('falls back to source.type=url for malformed data: prefix (no ;base64,)', () => {
      const url = 'data:image/png,raw-not-base64'
      const block = imageBlockForAnthropic(url)
      expect(block).toEqual({
        type: 'image',
        source: { type: 'url', url: 'data:image/png,raw-not-base64' },
      })
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- llm-client.anthropic-data-url`

  Expected: FAIL — `imageBlockForAnthropic` is not exported. Sample error excerpt:

  ```
  SyntaxError: The requested module '@/lib/llm-client' does not provide an export named 'imageBlockForAnthropic'
  ```

  (or the equivalent `TypeError: imageBlockForAnthropic is not a function` at runtime depending on resolver behaviour.)

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/llm-client.ts`

  ```ts
  // BEFORE (line 144-160 — the Anthropic branch of buildRequestBody):
    if (p.config.api_format === 'anthropic') {
      // Anthropic: system 单独字段；messages 只能 user/assistant；image 用 source.url 格式
      const systemMsg = textMessages.find(m => m.role === 'system')
      if (systemMsg) {
        base.system = typeof systemMsg.content === 'string'
          ? systemMsg.content
          : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
      }
      base.messages = textMessages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(b => {
              if (b.type === 'text') return { type: 'text', text: b.text }
              return { type: 'image', source: { type: 'url', url: b.image_url.url } }
            }),
      }))

  // AFTER:
    if (p.config.api_format === 'anthropic') {
      // Anthropic: system 单独字段；messages 只能 user/assistant；image 走 imageBlockForAnthropic
      const systemMsg = textMessages.find(m => m.role === 'system')
      if (systemMsg) {
        base.system = typeof systemMsg.content === 'string'
          ? systemMsg.content
          : systemMsg.content.map(b => ('text' in b ? b.text : '')).join('\n')
      }
      base.messages = textMessages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(b => {
              if (b.type === 'text') return { type: 'text', text: b.text }
              return imageBlockForAnthropic(b.image_url.url)
            }),
      }))
  ```

  Then add the helper export. Insert near the top of the file (just below the `LlmResponse` interface, around line 50):

  ```ts
  // BEFORE (right after the LlmResponse interface, around line 51):
  /** 已构造好的 HTTP 请求（URL / headers / body 对 OpenAI / Anthropic 已就地适配） */
  export interface ApiRequestSpec {

  // AFTER:
  /**
   * 把 image_url 的 url 字符串转成 Anthropic content block：
   * - data:image/{png|jpeg|webp};base64,... → { type:'image', source:{ type:'base64', media_type, data } }
   * - HTTP(S) URL（或任何不匹配 data:...;base64,... 的字符串）→ { type:'image', source:{ type:'url', url } }
   * 不识别的 media_type（如 image/gif）按 image/png 兜底（Anthropic 当前接受 png/jpeg/webp/gif）；
   * 真正不支持时由 provider 返回 400，本函数不做白名单。
   */
  export function imageBlockForAnthropic(url: string): Record<string, unknown> {
    const m = /^data:([^;]+);base64,(.+)$/.exec(url)
    if (m) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: m[1],
          data: m[2],
        },
      }
    }
    return {
      type: 'image',
      source: { type: 'url', url },
    }
  }

  /** 已构造好的 HTTP 请求（URL / headers / body 对 OpenAI / Anthropic 已就地适配） */
  export interface ApiRequestSpec {
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- llm-client.anthropic-data-url`

  Expected: PASS — all 5 cases green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/llm-client.ts src/lib/__tests__/llm-client.anthropic-data-url.test.ts
  git commit -m "$(cat <<'EOF'
  feat(llm-client): handle data: URLs in Anthropic image blocks

  Anthropic source.type='url' rejects data: URLs; new imageBlockForAnthropic
  helper detects data:image/<mime>;base64,<data> and emits source.type='base64'
  with parsed media_type. HTTP(S) URLs continue through source.type='url'.
  Used by buildRequestBody Anthropic branch (non-streaming path).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Anthropic data URL serializer (llm-stream.ts streaming path) + LlmMessage.tool_result content union

**Conditional on Task 0 outcome** — write Steps 3-onward as a branch:
- **Branch A** (Task 0 confirmed gateway accepts tool_result content array): extend `LlmMessage.tool_result.content` union to `string | Array<{type:'text', text:string} | {type:'image_url', image_url:{url:string}}>`. Both serializers handle array.
- **Branch B** (Task 0 found content array NOT accepted): keep `LlmMessage.tool_result.content` as `string`. Tasks 10/11 then use design B (extra user message after tool_result with images). Note: this defers the multimodal-on-tool_result path; spec §4.4.1 mentions but doesn't elaborate. Plan would expand at execution time.

**Files:**
- Modify: `src/lib/llm-client.ts` (extend `LlmMessage` `tool_result` arm in branch A; type guard if needed)
- Modify: `src/lib/copilot/llm-stream.ts` (`serializeAnthropicAssistantBlock` + `serializeAnthropicNonAssistant`: use `imageBlockForAnthropic`; in branch A handle `tool_result.content` being array)
- Test: `src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts` (assert serialization for both inline image_url-block in user content AND tool_result content array; assert HTTP URL still maps to source.type=url)

**Constraints:**
- The Anthropic `imageBlockForAnthropic` helper from Task 3 is reused here (import or duplicate per YAGNI choice in Task 3)
- OpenAI's `tool` role serialization: when content is array, pass through unchanged (OpenRouter / sankuai accept array natively per Task 0 finding)
- `tool_result.content` array case: each text block stays text; image_url block converts via `imageBlockForAnthropic` for Anthropic, passes through for OpenAI

**Steps (Branch A — gateway accepted content array per Task 0):**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts`

  ```ts
  import { describe, it, expect } from 'vitest'
  import { __testOnly } from '@/lib/copilot/llm-stream'
  import type { LlmMessage } from '@/lib/llm-client'
  import type { ApiConfig } from '@/lib/types'

  // Indirect test: feed a streaming request body builder with messages containing
  // image blocks and inspect the serialized content. buildStreamingRequestBody is
  // exposed on __testOnly per existing convention (cf. llm-stream.ts line ~677).

  const baseConfig: ApiConfig = { api_format: 'anthropic', base_url: 'x', api_key: 'k' }

  describe('llm-stream Anthropic image serialization', () => {
    it('converts data: URL image_url block to source.type=base64', () => {
      const messages: LlmMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this image:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ]
      const body = __testOnly.buildStreamingRequestBody({
        messages,
        config: baseConfig,
        model: 'claude-sonnet-4',
        temperature: 0,
        max_tokens: 100,
      })
      const userMsg = (body.messages as Array<{ role: string; content: unknown[] }>)[0]
      expect(userMsg.role).toBe('user')
      expect(userMsg.content).toEqual([
        { type: 'text', text: 'Look at this image:' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
        },
      ])
    })

    it('keeps HTTP URL image_url block as source.type=url', () => {
      const messages: LlmMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/x.png' } },
          ],
        },
      ]
      const body = __testOnly.buildStreamingRequestBody({
        messages,
        config: baseConfig,
        model: 'claude-sonnet-4',
        temperature: 0,
        max_tokens: 100,
      })
      const content = (body.messages as Array<{ content: unknown[] }>)[0].content
      expect(content).toEqual([
        {
          type: 'image',
          source: { type: 'url', url: 'https://cdn.example.com/x.png' },
        },
      ])
    })

    it('handles tool_result with content array containing image_url (Branch A)', () => {
      const messages: LlmMessage[] = [
        {
          role: 'tool_result',
          call_id: 'call_1',
          content: [
            { type: 'text', text: 'Here is the rendered image:' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ==' } },
          ],
        },
      ]
      const body = __testOnly.buildStreamingRequestBody({
        messages,
        config: baseConfig,
        model: 'claude-sonnet-4',
        temperature: 0,
        max_tokens: 100,
      })
      // Anthropic wraps tool_result in user role with content: [{type:'tool_result', ...}]
      const userMsg = (body.messages as Array<{ role: string; content: unknown[] }>)[0]
      expect(userMsg.role).toBe('user')
      const tr = userMsg.content[0] as { type: string; tool_use_id: string; content: unknown[] }
      expect(tr.type).toBe('tool_result')
      expect(tr.tool_use_id).toBe('call_1')
      expect(tr.content).toEqual([
        { type: 'text', text: 'Here is the rendered image:' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ==' },
        },
      ])
    })

    it('OpenAI passes tool_result content array through unchanged', () => {
      const messages: LlmMessage[] = [
        {
          role: 'tool_result',
          call_id: 'call_2',
          content: [
            { type: 'text', text: 'image follows' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ]
      const body = __testOnly.buildStreamingRequestBody({
        messages,
        config: { api_format: 'openai', base_url: 'x', api_key: 'k' },
        model: 'gpt-4o',
        temperature: 0,
        max_tokens: 100,
      })
      const tr = (body.messages as Array<Record<string, unknown>>)[0]
      expect(tr.role).toBe('tool')
      expect(tr.tool_call_id).toBe('call_2')
      expect(tr.content).toEqual([
        { type: 'text', text: 'image follows' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ])
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- llm-stream.anthropic-data-url`

  Expected: FAIL — multiple cases. Two distinct failure modes:
  - The data-URL serialization test fails because the existing `serializeAnthropicNonAssistant` emits `source: { type: 'url', url: 'data:image/png;...' }` (wrong shape).
  - The tool_result-with-content-array tests fail at the type level because `LlmMessage.tool_result.content` is currently typed `string`, so the test file won't even compile until Task 4 widens the union.

  Sample error excerpt:

  ```
  Type 'Array<{ type: string; ... }>' is not assignable to type 'string'.
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/llm-client.ts`

  ```ts
  // BEFORE (line 31-37):
    | {
        role: 'tool_result'
        call_id: string
        content: string
        /** v2.5 P2: tool_result 是 error 时设为 true，仅 Anthropic 序列化生效（is_error 协议字段透传）。 */
        is_error?: boolean
      }

  // AFTER:
    | {
        role: 'tool_result'
        call_id: string
        /**
         * Branch A (image-vision spec §4.4.1): content 可以是 string（兼容现状）或
         * Array<{type:'text',text}|{type:'image_url',image_url:{url}}>。后者用于 build-llm-messages
         * 把 tool_result 升级为多模态 block（让 LLM 看见工具返回的图）。
         * Anthropic 序列化器把 image_url block 转成 imageBlockForAnthropic 输出；
         * OpenAI 序列化器原样透传给网关（sankuai/OpenRouter 接受 array per Task 0 probe）。
         */
        content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
        /** v2.5 P2: tool_result 是 error 时设为 true，仅 Anthropic 序列化生效（is_error 协议字段透传）。 */
        is_error?: boolean
      }
  ```

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/llm-stream.ts`

  Insert the `imageBlockForAnthropic` helper near the top of the file (just below the imports, before the first function). Per spec §4.2 "YAGNI 倾向就地" — duplicate the helper rather than importing from llm-client to keep server/client boundary clean:

  ```ts
  // BEFORE (anywhere near top of llm-stream.ts, e.g. after the imports block):
  // (no helper currently exists)

  // AFTER (add as new top-level function near top of llm-stream.ts):
  /**
   * 与 src/lib/llm-client.ts 同名 helper 同形（YAGNI 就地拷贝）：
   * data:image/{mime};base64,... → source.type='base64' + media_type + data
   * 其他 URL → source.type='url'
   */
  function imageBlockForAnthropic(url: string): Record<string, unknown> {
    const m = /^data:([^;]+);base64,(.+)$/.exec(url)
    if (m) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: m[1],
          data: m[2],
        },
      }
    }
    return {
      type: 'image',
      source: { type: 'url', url },
    }
  }
  ```

  Now patch `serializeAnthropicNonAssistant`:

  ```ts
  // BEFORE (line 612-638):
  function serializeAnthropicNonAssistant(m: LlmMessage): Record<string, unknown> {
    if (m.role === 'tool_result') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.call_id,
            content: m.content,
            // v2.5 P2: 透传 is_error（Anthropic 协议字段）让 Claude/Sonnet 一眼分清 success vs failure。
            ...(m.is_error ? { is_error: true } : {}),
          },
        ],
      }
    }
    // user text（system 已被 caller 过滤；assistant / tool_use 由 emitComposite 处理）
    if (isTextMessage(m)) {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return { type: 'image', source: { type: 'url', url: b.image_url.url } }
          })
      return { role: m.role, content }
    }
    return { role: 'user', content: '' }
  }

  // AFTER:
  function serializeAnthropicNonAssistant(m: LlmMessage): Record<string, unknown> {
    if (m.role === 'tool_result') {
      // Branch A: content 可能是 string 或 Array<text|image_url>; image_url 走 imageBlockForAnthropic
      const trContent = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return imageBlockForAnthropic(b.image_url.url)
          })
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.call_id,
            content: trContent,
            // v2.5 P2: 透传 is_error（Anthropic 协议字段）让 Claude/Sonnet 一眼分清 success vs failure。
            ...(m.is_error ? { is_error: true } : {}),
          },
        ],
      }
    }
    // user text（system 已被 caller 过滤；assistant / tool_use 由 emitComposite 处理）
    if (isTextMessage(m)) {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return imageBlockForAnthropic(b.image_url.url)
          })
      return { role: m.role, content }
    }
    return { role: 'user', content: '' }
  }
  ```

  And `serializeOpenaiNonAssistant` (no transformation needed for OpenAI — array passes through; just verify the existing pass-through still works for the new array shape):

  ```ts
  // BEFORE (line 596-610):
  function serializeOpenaiNonAssistant(m: LlmMessage): Record<string, unknown> {
    if (m.role === 'tool_result') {
      return {
        role: 'tool',
        tool_call_id: m.call_id,
        content: m.content,
      }
    }
    // system / user text 三元组（assistant / tool_use 由 emitComposite 处理）
    if (isTextMessage(m)) {
      return { role: m.role, content: m.content }
    }
    // 兜底（不应到达）
    return { role: 'user', content: '' }
  }

  // AFTER (no functional change — content: m.content already handles both string and array;
  // comment expanded for clarity):
  function serializeOpenaiNonAssistant(m: LlmMessage): Record<string, unknown> {
    if (m.role === 'tool_result') {
      // Branch A (image-vision spec §4.4.1): m.content 可能是 string 或
      // Array<{type:'text'}|{type:'image_url'}>; OpenAI 兼容网关接受 array，原样透传。
      return {
        role: 'tool',
        tool_call_id: m.call_id,
        content: m.content,
      }
    }
    // system / user text 三元组（assistant / tool_use 由 emitComposite 处理）
    if (isTextMessage(m)) {
      return { role: m.role, content: m.content }
    }
    // 兜底（不应到达）
    return { role: 'user', content: '' }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- llm-stream.anthropic-data-url`

  Expected: PASS — all 4 cases green.

  Also run the existing llm-stream test suite to confirm no regression on text/tool flows:

  Run: `npm test -- llm-stream`

  Expected: PASS for all existing cases.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The widened `tool_result.content` union may surface unhandled call sites; if any appear, narrow with `typeof m.content === 'string' ? ... : ...` at the call site before continuing.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/llm-client.ts src/lib/copilot/llm-stream.ts src/lib/copilot/__tests__/llm-stream.anthropic-data-url.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): widen tool_result content union, serialize Anthropic data URLs

  LlmMessage.tool_result.content now accepts string OR multimodal block array
  (Task 0 probe confirmed sankuai gateway accepts the array shape on tool role).
  Anthropic streaming serializer routes data: URLs through imageBlockForAnthropic
  (source.type='base64' + media_type + data); HTTP URLs stay source.type='url'.
  OpenAI path passes the array through unchanged.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

**Branch B alternative:** If Task 0 found the gateway rejects `tool` role with content array, keep `LlmMessage.tool_result.content` as `string` and skip the union widening. The Anthropic data-URL serializer changes (Steps 3 in `serializeAnthropicNonAssistant`'s text-message branch + the new `imageBlockForAnthropic` helper) still apply since user-message multimodal blocks remain in scope. Tasks 10/11 then implement design B: emit text-only tool_result and follow it with an extra `user` role message carrying the image blocks. Revisit this task before starting Task 4 if the Task 0 finding doc says "Branch B".

---

### Task 5: image-attach.ts — `collectImageRefs` (schema-aware + heuristic + dedup + cap)

**Files:**
- Create: `src/lib/copilot/image-attach.ts`
- Create: `src/lib/copilot/__tests__/image-attach.test.ts`

**Constraints:**
- `MAX_IMAGES_PER_TURN = 5` exported constant
- Schema cache: `Map<schema_id, TaskSchema>` per-call (passed in, not module-global) — keeps function pure for test isolation
- Heuristic regexes from spec: `IMAGE_FIELD_NAME_RE = /url|image|pic|img|photo/i`; `PATH_PREFIX_RE = /^(images\/|\/api\/results\/[^/]+\/images\/)/`
- **Schema walk shape** (correct usage): `output_schema.properties` is `Record<string, JsonPropDef>` — iterate via `Object.entries(properties)` where the **key is the field name** and value is `JsonPropDef` with `.type`. Do NOT use `output_schema.fields[].name` — that property does not exist on `JsonSchemaDef`.
- URL normalization: `images/foo.png` → `/api/results/{expId}/images/foo.png` (need expId from ref.extra)
- Dedupe by exact URL string match
- Cap order: user_image_refs (from circled contexts) first; then tool_image_refs (in tool_result chronological order); user wins priority on cap
- `task_field` ref with `extra.field_type === 'image_url'` collects 1 image; otherwise 0
- Non-vision-capable model → return empty {refs:[], dropped:0} (no fs read)

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/image-attach.test.ts`

  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest'
  import type { CopilotMessage, CopilotContextRef, ImageRef } from '@/lib/copilot/types'
  import type { TaskSchema, GenericResultRecord } from '@/lib/schema/types'
  import type { ExperimentConfig } from '@/lib/types'

  // Mock store + schema lookups so the pure function can be exercised without fs.
  vi.mock('@/lib/store', () => ({
    readResults: vi.fn(),
    getExperiment: vi.fn(),
  }))
  vi.mock('@/lib/schema', () => ({
    getSchema: vi.fn(),
  }))

  import { collectImageRefs, MAX_IMAGES_PER_TURN } from '@/lib/copilot/image-attach'
  import { readResults, getExperiment } from '@/lib/store'
  import { getSchema } from '@/lib/schema'

  // ---------- helpers ----------

  /** Build a TaskSchema with the canonical output_schema.properties Record shape. */
  function makeSchema(props: Record<string, { type: string }>): TaskSchema {
    return {
      id: 'sch_test',
      label: 'test',
      version: 1,
      inputs: [],
      variables: [],
      default_prompt: '',
      message_builder: {},
      output_schema: {
        type: 'object',
        // properties is Record<fieldName, JsonPropDef>; field name = map key
        properties: Object.fromEntries(
          Object.entries(props).map(([name, def]) => [name, { type: def.type } as never]),
        ),
      },
    } as TaskSchema
  }

  function makeResult(taskId: string, output: Record<string, unknown>): GenericResultRecord {
    return {
      schema_id: 'sch_test', schema_version: 1,
      task_id: taskId, experiment_id: 'exp_1',
      input_refs: {}, input_preview: {},
      status: 'success',
      output,
      timestamp: '2026-05-09T00:00:00Z',
      model: 'm',
    } as GenericResultRecord
  }

  function makeUserMsg(contexts: CopilotContextRef[]): CopilotMessage {
    return {
      id: 'msg_u', session_id: 's', role: 'user',
      content: 'hi', contexts, timestamp: 't',
    }
  }

  function ctx(tag: number, type: string, id: string, extra?: Record<string, unknown>): CopilotContextRef {
    return { tag, type, id, extra }
  }

  beforeEach(() => {
    vi.mocked(readResults).mockReset()
    vi.mocked(getExperiment).mockReset()
    vi.mocked(getSchema).mockReset()
    vi.mocked(getExperiment).mockReturnValue({ id: 'exp_1', schema_id: 'sch_test' } as ExperimentConfig)
  })

  // ---------- tests ----------

  describe('collectImageRefs — schema-aware extraction', () => {
    it('image_url field type → 1 ref per task_result context', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ caption: { type: 'string' }, image_url: { type: 'image_url' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { caption: 'a cat', image_url: '/api/results/exp_1/images/cat.png' }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(1)
      expect(out.user_image_refs[0].url).toBe('/api/results/exp_1/images/cat.png')
      expect(out.user_image_refs[0].source_label).toContain('field=image_url')
      expect(out.user_image_refs[0].ctx_tag).toBe(1)
      expect(out.dropped_count).toBe(0)
    })

    it('image_url_list field type → N refs', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ images: { type: 'image_url_list' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { images: [
          '/api/results/exp_1/images/a.png',
          '/api/results/exp_1/images/b.png',
          '/api/results/exp_1/images/c.png',
        ] }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(3)
      expect(out.user_image_refs.map(r => r.url)).toEqual([
        '/api/results/exp_1/images/a.png',
        '/api/results/exp_1/images/b.png',
        '/api/results/exp_1/images/c.png',
      ])
    })

    it('heuristic fallback: field name matches /url|image|pic|img|photo/i + value matches path prefix', () => {
      // No declared image_url field; only string field with name "photo_url"
      vi.mocked(getSchema).mockReturnValue(makeSchema({ photo_url: { type: 'string' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { photo_url: 'images/foo.png' }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(1)
      expect(out.user_image_refs[0].url).toBe('/api/results/exp_1/images/foo.png')
      expect(out.user_image_refs[0].source_label).toContain('(inferred)')
    })

    it('heuristic skips when name matches but value does NOT match path prefix', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ photo_url: { type: 'string' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { photo_url: 'just a description, not a path' }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(0)
    })

    it('dedupes by exact URL string', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { image_url: '/api/results/exp_1/images/dup.png' }),
        makeResult('t2', { image_url: '/api/results/exp_1/images/dup.png' }),
      ])
      const branch = [makeUserMsg([
        ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' }),
        ctx(2, 'task_result', 't2', { experiment_id: 'exp_1' }),
      ])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(1)
      expect(out.dropped_count).toBe(0)
    })

    it('caps at MAX_IMAGES_PER_TURN=5 and reports dropped_count', () => {
      expect(MAX_IMAGES_PER_TURN).toBe(5)
      vi.mocked(getSchema).mockReturnValue(makeSchema({ images: { type: 'image_url_list' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { images: Array.from({ length: 8 }, (_, i) => `/api/results/exp_1/images/i${i}.png`) }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(5)
      expect(out.dropped_count).toBe(3)
    })

    it('normalizes "images/foo.png" → "/api/results/{expId}/images/foo.png"', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { image_url: 'images/foo.png' }),
      ])
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs[0].url).toBe('/api/results/exp_1/images/foo.png')
    })

    it('task_field with extra.field_type === image_url collects exactly 1 image', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t1', { image_url: '/api/results/exp_1/images/cat.png' }),
      ])
      const branch = [makeUserMsg([
        ctx(1, 'task_field', 't1', { experiment_id: 'exp_1', field: 'image_url', field_type: 'image_url' }),
      ])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: true })
      expect(out.user_image_refs).toHaveLength(1)
      expect(out.user_image_refs[0].source_label).toContain('field=image_url')
    })

    it('non-vision-capable model short-circuits to empty result without reading store', () => {
      const branch = [makeUserMsg([ctx(1, 'task_result', 't1', { experiment_id: 'exp_1' })])]
      const out = collectImageRefs({ branch, schemaCache: new Map(), modelVisionCapable: false })
      expect(out.user_image_refs).toEqual([])
      expect(out.tool_image_refs.size).toBe(0)
      expect(out.dropped_count).toBe(0)
      expect(vi.mocked(readResults)).not.toHaveBeenCalled()
      expect(vi.mocked(getSchema)).not.toHaveBeenCalled()
    })

    it('cap order: user contexts win priority over tool refs when total exceeds 5', () => {
      vi.mocked(getSchema).mockReturnValue(makeSchema({ image_url: { type: 'image_url' } }))
      vi.mocked(readResults).mockReturnValue([
        makeResult('t_user_1', { image_url: '/api/results/exp_1/images/u1.png' }),
        makeResult('t_user_2', { image_url: '/api/results/exp_1/images/u2.png' }),
        makeResult('t_user_3', { image_url: '/api/results/exp_1/images/u3.png' }),
        makeResult('t_user_4', { image_url: '/api/results/exp_1/images/u4.png' }),
      ])
      const userMsg = makeUserMsg([
        ctx(1, 'task_result', 't_user_1', { experiment_id: 'exp_1' }),
        ctx(2, 'task_result', 't_user_2', { experiment_id: 'exp_1' }),
        ctx(3, 'task_result', 't_user_3', { experiment_id: 'exp_1' }),
        ctx(4, 'task_result', 't_user_4', { experiment_id: 'exp_1' }),
      ])
      const toolMsg: CopilotMessage = {
        id: 'msg_tr', session_id: 's', role: 'tool_result',
        call_id: 'call_x', tool_name: 'read_experiment_results',
        content: JSON.stringify({
          kind: 'inline',
          value: { results: [] },
          attachments: [
            { url: '/api/results/exp_1/images/tool1.png', source_label: 'tool#1' },
            { url: '/api/results/exp_1/images/tool2.png', source_label: 'tool#2' },
          ] satisfies ImageRef[],
        }),
        timestamp: 't',
      }
      const out = collectImageRefs({ branch: [userMsg, toolMsg], schemaCache: new Map(), modelVisionCapable: true })
      // 4 user + 1 tool = 5 total; second tool ref dropped
      expect(out.user_image_refs).toHaveLength(4)
      expect(out.tool_image_refs.get('call_x')).toHaveLength(1)
      expect(out.dropped_count).toBe(1)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- image-attach.test`

  Expected: FAIL — module does not exist. Sample error excerpt:

  ```
  Error: Failed to resolve import "@/lib/copilot/image-attach"
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/image-attach.ts`

  ```ts
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
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- image-attach.test`

  Expected: PASS — all 10 cases green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. Imports of `getSchema` from `@/lib/schema` and `getExperiment` / `readResults` from `@/lib/store` resolve to existing exports; `JsonPropDef` type from `@/lib/schema/types` matches the iteration shape.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/image-attach.ts src/lib/copilot/__tests__/image-attach.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): add collectImageRefs to image-attach module

  Pure scan of active branch for circled task_result/task_field contexts and
  tool_result wrapper attachments. Schema-aware via output_schema.properties
  (image_url + image_url_list types) plus name-based heuristic fallback. Dedupes
  by URL and caps at MAX_IMAGES_PER_TURN=5; user contexts win priority on cap.
  Non-vision-capable model short-circuits to empty without store reads.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: image-attach.ts — `readImageBytes` + URL → disk path resolver

**Files:**
- Modify: `src/lib/copilot/image-attach.ts` (add `readImageBytes(ref)` and `resolveImageDiskPath(url)` exports)
- Create: `src/lib/copilot/__tests__/image-attach.read-bytes.test.ts`

**Constraints:**
- data URL → return `{data_url: ref.url}` directly (no fs read)
- `/api/results/{expId}/images/{f}.{ext}` → `path.join(process.cwd(), 'data', 'results', expId, 'images', f.ext)`
- `images/foo.png` shape never reaches readImageBytes (caller normalizes to /api/ form)
- Path traversal defense: regex match `^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$` for filename component; reject otherwise
- mime-by-ext: png/jpg/jpeg/webp; default `image/png` for unknown
- Errors: file missing, permission denied, non-image extension → `{error: string}` (caller decides text-fallback)

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/image-attach.read-bytes.test.ts`

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import * as fs from 'fs'
  import * as path from 'path'
  import * as os from 'os'
  import { readImageBytes, resolveImageDiskPath } from '@/lib/copilot/image-attach'

  // readImageBytes resolves /api/results/{exp}/images/{f}.{ext} against process.cwd();
  // chdir into a tmp dir per case so each test has a clean filesystem.
  let tmp = ''
  let origCwd = ''

  beforeEach(() => {
    origCwd = process.cwd()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-attach-'))
    fs.mkdirSync(path.join(tmp, 'data', 'results', 'exp_test', 'images'), { recursive: true })
    process.chdir(tmp)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // Smallest valid PNG (1×1 transparent) bytes
  const ONE_PX_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  )

  describe('readImageBytes', () => {
    it('passes through a data: URL without filesystem access', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
      const out = await readImageBytes({ url: dataUrl, source_label: 'x' })
      expect(out).toEqual({ data_url: dataUrl })
    })

    it('reads a real file off disk and emits data:image/png;base64,...', async () => {
      const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.png')
      fs.writeFileSync(target, ONE_PX_PNG)
      const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.png', source_label: 'x' })
      expect(out).toEqual({ data_url: `data:image/png;base64,${ONE_PX_PNG.toString('base64')}` })
    })

    it('emits {error} for missing file (ENOENT)', async () => {
      const out = await readImageBytes({ url: '/api/results/exp_test/images/missing.png', source_label: 'x' })
      expect('error' in out).toBe(true)
      expect((out as { error: string }).error).toMatch(/ENOENT|no such file/i)
    })

    it('rejects path traversal attempts', async () => {
      const out = await readImageBytes({ url: '/api/results/../../../etc/passwd', source_label: 'x' })
      expect('error' in out).toBe(true)
    })

    it('mime-by-ext: .jpg → image/jpeg', async () => {
      const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.jpg')
      fs.writeFileSync(target, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
      const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.jpg', source_label: 'x' })
      expect((out as { data_url: string }).data_url.startsWith('data:image/jpeg;base64,')).toBe(true)
    })

    it('mime-by-ext: .webp → image/webp', async () => {
      const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.webp')
      fs.writeFileSync(target, Buffer.from('RIFF????WEBP', 'binary'))
      const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.webp', source_label: 'x' })
      expect((out as { data_url: string }).data_url.startsWith('data:image/webp;base64,')).toBe(true)
    })

    it('rejects file with disallowed extension via the path resolver', async () => {
      // Even if the user crafts a request, the regex denies non-(png|jpg|jpeg|webp) → resolver returns null → error
      const out = await readImageBytes({ url: '/api/results/exp_test/images/passwd.txt', source_label: 'x' })
      expect('error' in out).toBe(true)
    })
  })

  describe('resolveImageDiskPath (path traversal regex)', () => {
    it('accepts a clean filename', () => {
      const p = resolveImageDiskPath('/api/results/exp_test/images/foo.png')
      expect(p).toBe(path.join(process.cwd(), 'data', 'results', 'exp_test', 'images', 'foo.png'))
    })

    it('rejects ".." path components', () => {
      expect(resolveImageDiskPath('/api/results/exp_test/images/../foo.png')).toBeNull()
    })

    it('rejects non-image extension', () => {
      expect(resolveImageDiskPath('/api/results/exp_test/images/foo.txt')).toBeNull()
    })

    it('rejects non-conforming experiment id', () => {
      expect(resolveImageDiskPath('/api/results/exp/test/images/foo.png')).toBeNull()
    })

    it('returns null for non-/api/results URL shapes', () => {
      expect(resolveImageDiskPath('https://cdn.example.com/x.png')).toBeNull()
      expect(resolveImageDiskPath('images/foo.png')).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- image-attach.read-bytes`

  Expected: FAIL — `readImageBytes` and `resolveImageDiskPath` are not exported yet. Sample error excerpt:

  ```
  SyntaxError: The requested module '@/lib/copilot/image-attach' does not provide an export named 'readImageBytes'
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/image-attach.ts`

  Append the following exports at the bottom of the existing file:

  ```ts
  // BEFORE (end of file after collectImageRefs):
  // (no further exports)

  // AFTER (append):
  import * as fs from 'fs/promises'
  import * as path from 'path'

  const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }

  // Filename component must be a single segment with allowed extension; expId
  // must be a single slug. The regex captures (expId, filename, ext).
  const URL_RE = /^\/api\/results\/([a-zA-Z0-9_-]+)\/images\/([a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp))$/

  /**
   * Resolve a public-facing /api/results/{expId}/images/{f}.{ext} URL to a disk
   * path under process.cwd()/data/results/. Returns null for any URL that
   * doesn't match the strict regex (data:, http(s):, traversal attempts, wrong
   * extension, etc.) — caller decides the fallback.
   */
  export function resolveImageDiskPath(url: string): string | null {
    const m = URL_RE.exec(url)
    if (!m) return null
    const [, expId, filename] = m
    return path.join(process.cwd(), 'data', 'results', expId, 'images', filename)
  }

  /**
   * Read the bytes for an ImageRef:
   * - data: URL → return as-is (no fs read)
   * - /api/results/.../images/x.png → resolve to disk + base64-encode
   * - anything else (http, malformed, traversal) → {error}
   * Caller (build-llm-messages) decides whether to show text fallback or skip.
   */
  export async function readImageBytes(
    ref: ImageRef,
  ): Promise<{ data_url: string } | { error: string }> {
    if (ref.url.startsWith('data:')) return { data_url: ref.url }
    const diskPath = resolveImageDiskPath(ref.url)
    if (!diskPath) return { error: `unsupported url: ${ref.url}` }
    try {
      const buf = await fs.readFile(diskPath)
      const ext = path.extname(diskPath).slice(1).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'image/png'
      return { data_url: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- image-attach.read-bytes`

  Expected: PASS — all 12 cases green (7 readImageBytes + 5 resolveImageDiskPath).

  Also re-run the Task 5 suite to confirm no regression:

  Run: `npm test -- image-attach`

  Expected: all cases from both suites green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. `fs/promises` and `path` are stdlib modules; the `ImageRef` import added in Task 2 is reused here.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/image-attach.ts src/lib/copilot/__tests__/image-attach.read-bytes.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): add readImageBytes + URL→disk path resolver to image-attach

  data: URLs pass through; /api/results/{expId}/images/{f}.{ext} resolves to
  data/results/.../images/ under cwd and is base64-encoded with mime-by-ext.
  Path-traversal defense via strict regex on filename component (alnum + .-_;
  ext ∈ png|jpg|jpeg|webp); non-conforming URLs return {error} for the caller
  to handle.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: image-attach.ts — `extractImageRefsFromOutput` (tool reuse helper)

**Files:**
- Modify: `src/lib/copilot/image-attach.ts` (export `extractImageRefsFromOutput`)
- Modify: `src/lib/copilot/__tests__/image-attach.test.ts` (add tests for the helper directly, beyond what collectImageRefs already covers)

**Constraints:**
- Pure function: `(output, schema, expId, ctx_tag?, task_id?) → ImageRef[]`
- Walks `schema.output_schema.properties` via `Object.entries`; for `image_url` type → 1 ref; `image_url_list` → N refs
- Heuristic fallback at the end: any string property whose key matches name regex AND value matches path prefix → 1 ref (marked `(inferred)` in source_label)
- No cap or dedup (caller's responsibility)

**Note:** `extractImageRefsFromOutput` is already authored as part of Task 5's image-attach.ts (it's the schema walker that `collectImageRefs` delegates to). Task 7 is the direct-coverage step: add tests that exercise the helper as a public API (independent of the branch-walking around it), and verify the export is accessible to downstream tool files (Tasks 13/14/15).

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/image-attach.test.ts`

  Append the following block at the end of the file (after the `describe('collectImageRefs — schema-aware extraction', ...)` block):

  ```ts
  describe('extractImageRefsFromOutput — direct helper coverage', () => {
    function makeSchemaT(props: Record<string, { type: string }>): TaskSchema {
      return {
        id: 'sch_t', label: 't', version: 1,
        inputs: [], variables: [], default_prompt: '',
        message_builder: {},
        output_schema: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(props).map(([n, d]) => [n, { type: d.type } as never]),
          ),
        },
      } as TaskSchema
    }

    it('image_url field with non-empty string → 1 ref, source_label includes field name', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ caption: { type: 'string' }, image_url: { type: 'image_url' } })
      const refs = extractImageRefsFromOutput(
        { caption: 'a cat', image_url: '/api/results/exp_1/images/cat.png' },
        schema,
        'exp_1',
        7,
        't_abc',
      )
      expect(refs).toHaveLength(1)
      expect(refs[0]).toEqual({
        url: '/api/results/exp_1/images/cat.png',
        source_label: 'task_result#t_abc · field=image_url',
        ctx_tag: 7,
      })
    })

    it('image_url_list with 3 entries → 3 refs', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ images: { type: 'image_url_list' } })
      const refs = extractImageRefsFromOutput(
        { images: [
          '/api/results/exp_1/images/a.png',
          '/api/results/exp_1/images/b.png',
          '/api/results/exp_1/images/c.png',
        ] },
        schema,
        'exp_1',
      )
      expect(refs).toHaveLength(3)
      expect(refs.map(r => r.url)).toEqual([
        '/api/results/exp_1/images/a.png',
        '/api/results/exp_1/images/b.png',
        '/api/results/exp_1/images/c.png',
      ])
      expect(refs[0].ctx_tag).toBeUndefined()  // tool path doesn't pass ctx_tag
    })

    it('heuristic catches "photo_url" with /api/results/... value (marked inferred)', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ photo_url: { type: 'string' } })
      const refs = extractImageRefsFromOutput(
        { photo_url: '/api/results/exp_1/images/x.png' },
        schema,
        'exp_1',
        undefined,
        't_abc',
      )
      expect(refs).toHaveLength(1)
      expect(refs[0].source_label).toBe('task_result#t_abc · field=photo_url (inferred)')
    })

    it('heuristic skips when name matches but value is empty string', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ photo_url: { type: 'string' } })
      const refs = extractImageRefsFromOutput({ photo_url: '' }, schema, 'exp_1')
      expect(refs).toHaveLength(0)
    })

    it('heuristic skips when name matches but value is non-path (e.g. a description)', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ image_caption: { type: 'string' } })
      const refs = extractImageRefsFromOutput(
        { image_caption: 'a brown dog with a red collar' },
        schema,
        'exp_1',
      )
      expect(refs).toHaveLength(0)
    })

    it('heuristic does not double-count a field already declared as image_url', async () => {
      const { extractImageRefsFromOutput } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ image_url: { type: 'image_url' } })
      const refs = extractImageRefsFromOutput(
        { image_url: '/api/results/exp_1/images/dup.png' },
        schema,
        'exp_1',
      )
      expect(refs).toHaveLength(1)  // declared path, NOT also picked up by heuristic
    })

    it('does not enforce cap or dedup (caller responsibility)', async () => {
      const { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } = await import('@/lib/copilot/image-attach')
      const schema = makeSchemaT({ images: { type: 'image_url_list' } })
      const arr = Array.from({ length: MAX_IMAGES_PER_TURN + 4 }, (_, i) => `/api/results/exp_1/images/i${i}.png`)
      const refs = extractImageRefsFromOutput({ images: arr }, schema, 'exp_1')
      expect(refs).toHaveLength(MAX_IMAGES_PER_TURN + 4)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- image-attach.test`

  Expected: PASS — `extractImageRefsFromOutput` is already exported as part of Task 5's implementation, so all new cases pass on first run. **This is intentional**: Task 7 records the contract via direct tests. If any of the new cases fail, fix the helper in image-attach.ts before proceeding (most likely culprit: the heuristic skipping declared fields, or source_label string format).

  Alternatively, if you took Task 5 as "minimal-to-make-collectImageRefs-pass" and only inlined the schema walk without a separate exported helper, this step will FAIL with:

  ```
  SyntaxError: The requested module '@/lib/copilot/image-attach' does not provide an export named 'extractImageRefsFromOutput'
  ```

  In that case proceed to Step 3 to lift the walker out into the named export.

- [ ] **Step 3: Implement (only if Step 2 was a true fail)**

  If Task 5's implementation already extracts and exports `extractImageRefsFromOutput` (as written in the Task 5 Step 3 code block above), no change is needed for Task 7 — skip to Step 4.

  Otherwise, refactor `image-attach.ts` to lift the schema-walk logic out of `refsFromTaskResultContext` and into a named export. The signature is:

  ```ts
  export function extractImageRefsFromOutput(
    output: Record<string, unknown>,
    schema: TaskSchema,
    expId: string,
    ctx_tag?: number,
    task_id?: string,
  ): ImageRef[]
  ```

  Body matches the implementation shown in Task 5 Step 3 (the standalone function defined above `refsFromTaskResultContext`). After the refactor, `refsFromTaskResultContext` becomes a thin wrapper:

  ```ts
  return extractImageRefsFromOutput(
    found.output as Record<string, unknown>,
    schema,
    expId,
    ref.tag,
    ref.id,
  )
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- image-attach.test`

  Expected: PASS — all cases (the original 10 from Task 5 + the 7 new ones from this task) green.

  Also confirm Task 6's read-bytes suite still passes:

  Run: `npm test -- image-attach`

  Expected: all suites green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The exported helper is now usable by Tasks 13/14/15 tool implementations.

- [ ] **Step 6: Commit**

  Two cases:

  **(a)** If Step 3 was a no-op (helper was already a separate export from Task 5):

  ```bash
  git add src/lib/copilot/__tests__/image-attach.test.ts
  git commit -m "$(cat <<'EOF'
  test(copilot): cover extractImageRefsFromOutput directly

  Direct-coverage suite for the schema-walking helper exported by image-attach.
  Validates image_url + image_url_list + heuristic-fallback branches, asserts
  no cap / dedup at this level (callers enforce), and verifies declared fields
  are not double-counted by the heuristic. Sets the contract Tasks 13/14/15
  rely on when emitting tool-side _attachments.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

  **(b)** If Step 3 lifted the helper out of an inlined schema-walk:

  ```bash
  git add src/lib/copilot/image-attach.ts src/lib/copilot/__tests__/image-attach.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(copilot): expose extractImageRefsFromOutput as a named export

  Lift the schema-walking logic out of refsFromTaskResultContext so tool
  implementations (read-experiment-results, read-context, read-resource) can
  call it directly when emitting _attachments. Direct-coverage tests pin the
  image_url + image_url_list + heuristic-fallback contract and assert no
  cap/dedup at this level (callers enforce).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: build-llm-messages async + image plan integration (no rewrite yet)

**Files:**
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts` (signature → `async`; new `opts.modelVisionCapable`; add `materializeImagePlan` private async helper; pre-compute `lastUserMsg`; build `ImagePlan`; thread `imageMap` through but keep existing rewrite paths unchanged for now)
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/stream-response.ts` (`await buildLlmMessages(...)` + pass `modelVisionCapable: p.model.vision_capable === true`)
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.test.ts` (mechanical `await` prefix on every `buildLlmMessages` call)

**Constraints:**
- Return type becomes `Promise<LlmMessage[]>`; signature is `export async function buildLlmMessages(branch, pageContext?, opts?)`
- New opts shape: `opts?: { sessionId?: string; modelVisionCapable?: boolean }`
- `materializeImagePlan(collected, expIdResolver?)` is async because `readImageBytes` is async; it produces an `ImagePlan` of pre-encoded blocks ready to splice in (Tasks 9/10/11 do the splice)
- `ImagePlan = { user_blocks: ContentBlock[]; tool_blocks_by_call_id: Map<string, ContentBlock[]>; system_notes: string[]; hadImageRefs: boolean }`
- Pre-compute `lastUserMsg` once before any rewrite loop — caller of compaction loop reads it for Task 9; do NOT recompute inside the for-of
- This task is **plumbing only**: imageMap is built but its blocks are NOT yet spliced into messages. The existing user-msg path still pushes plain string content; existing tool_result path still pushes plain string visible. Tasks 9/10/11 do the actual content rewrite.
- Existing tests must still pass after the mechanical `await` migration — same returned `LlmMessage[]` shape for all non-image branches (regression-style; no new test added in this task)

**Steps:**

- [ ] **Step 1: Migrate existing tests to async (mechanical `await`)**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.test.ts`

  Mechanical change: every `const msgs = buildLlmMessages(...)` becomes `const msgs = await buildLlmMessages(...)`, and the enclosing `it("...", () => { ... })` callback becomes `async () => { ... }`. Show two illustrative cases below; apply the same pattern to every other `it` block in the file.

  ```ts
  // BEFORE (lines 31-42):
  it("inline kind is flattened to JSON string", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", { kind: "inline", value: { experiments: [{ id: "a" }] } }),
    ]
    const msgs = buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(tr?.content).toContain("experiments")
    expect(tr?.content).not.toContain("ref://")
  })

  // AFTER:
  it("inline kind is flattened to JSON string", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
      toolUseMsg("c1", "list_experiments"),
      toolResultMsg("c1", { kind: "inline", value: { experiments: [{ id: "a" }] } }),
    ]
    const msgs = await buildLlmMessages(branch)
    const tr = msgs.find((m) => m.role === "tool_result")
    expect(tr).toBeTruthy()
    expect(tr?.content).toContain("experiments")
    expect(tr?.content).not.toContain("ref://")
  })
  ```

  ```ts
  // BEFORE (lines 89-96):
  it("system prompt is always first", () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = buildLlmMessages(branch)
    expect(msgs[0].role).toBe("system")
    if (msgs[0].role === "system") expect(msgs[0].content).toBe(COPILOT_SYSTEM_PROMPT)
  })

  // AFTER:
  it("system prompt is always first", async () => {
    const branch: CopilotMessage[] = [
      { id: "m_u1", session_id: "s", role: "user", content: "hi", timestamp: "t" },
    ]
    const msgs = await buildLlmMessages(branch)
    expect(msgs[0].role).toBe("system")
    if (msgs[0].role === "system") expect(msgs[0].content).toBe(COPILOT_SYSTEM_PROMPT)
  })
  ```

  Apply the same `async () =>` + `await buildLlmMessages(...)` pattern to every remaining `it(...)` block in this file. There are no `.then()`-shaped tests here — purely synchronous calls.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- build-llm-messages.test`

  Expected: FAIL — every test now `await`s a function that's still sync, so `msgs` is the return value (still an array) but TS will reject the `await` on a non-Promise return type once Step 3 widens the return. Actually before Step 3, await on a non-Promise is a no-op; the failure comes from a different angle: the existing assertions still pass against the sync return. To make the test genuinely fail BEFORE the impl change, we instead rely on the fact that Task 8's verification is regression-style — see Step 4 note. Skip the "test fails first" gate for this plumbing task (no new test is being added; existing tests must continue to pass after async migration).

  In practice: run the suite once to confirm green BEFORE implementing, then run again AFTER implementing to confirm still green. If anything breaks in between, the Step 3 implementation is wrong.

- [ ] **Step 3: Implement async signature + materializeImagePlan plumbing**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts`

  ```ts
  // BEFORE (lines 15-21):
  import type { CopilotMessage, CopilotContextRef } from './types'
  import type { LlmMessage } from '../llm-client'
  import { normalizeToolResult, appendCompactBoundary } from './session-store'
  import { buildSystemHeader } from './system-header'
  import { microCompact } from './micro-compact'
  import { sliceAfterBoundary } from './boundary'
  import { isToolErrorShape } from './tools/tool-result'

  // AFTER:
  import type { CopilotMessage, CopilotContextRef, ImageRef, ToolResultContent } from './types'
  import type { LlmMessage } from '../llm-client'
  import { normalizeToolResult, appendCompactBoundary } from './session-store'
  import { buildSystemHeader } from './system-header'
  import { microCompact } from './micro-compact'
  import { sliceAfterBoundary } from './boundary'
  import { isToolErrorShape } from './tools/tool-result'
  import { collectImageRefs, readImageBytes, MAX_IMAGES_PER_TURN } from './image-attach'
  import type { TaskSchema } from '@/lib/schema/types'

  /**
   * 把 collectImageRefs 输出（仍是 ImageRef[]）落成发给 LLM 的 ContentBlock[]：
   * - 每个 ref 调 readImageBytes（disk → base64 / data URL passthrough / error）
   * - 失败的 ref 退化为 text 块（"[Image unavailable: <reason>]"），不阻塞流程
   * - 块顺序：[text("[Image for #N · src_label]"), image_url, text("[Image for #M · ...]"), image_url, ...]
   *   text/image 交替；Anthropic / OpenAI 都接受。
   *
   * Task 8 只产出 plan；splicing 在 Task 9 / 10 / 11 完成。
   */
  export interface ImagePlan {
    user_blocks: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
    tool_blocks_by_call_id: Map<string, Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>>
    system_notes: string[]
    hadImageRefs: boolean
  }

  async function refsToBlocks(
    refs: ImageRef[],
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>> {
    const blocks: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
    for (const r of refs) {
      const tagPart = r.ctx_tag !== undefined ? `#${r.ctx_tag} · ` : ''
      const label = `[Image ${tagPart}${r.source_label}]`
      const bytes = await readImageBytes(r)
      if ('error' in bytes) {
        blocks.push({ type: 'text', text: `${label} (unavailable: ${bytes.error})` })
        continue
      }
      blocks.push({ type: 'text', text: label })
      blocks.push({ type: 'image_url', image_url: { url: bytes.data_url } })
    }
    return blocks
  }

  async function materializeImagePlan(
    branch: CopilotMessage[],
    modelVisionCapable: boolean,
  ): Promise<ImagePlan> {
    const empty: ImagePlan = {
      user_blocks: [],
      tool_blocks_by_call_id: new Map(),
      system_notes: [],
      hadImageRefs: false,
    }
    // 即使 model 不支持 vision 也要 collectImageRefs 一次（用 modelVisionCapable=true 强行收集）
    // 来知道 hadImageRefs 是否为 true —— 这是 Task 11 提示语依据。
    const probed = collectImageRefs({
      branch,
      schemaCache: new Map<string, TaskSchema>(),
      modelVisionCapable: true,
    })
    const hadImageRefs =
      probed.user_image_refs.length > 0 ||
      Array.from(probed.tool_image_refs.values()).some((arr) => arr.length > 0)

    if (!modelVisionCapable) {
      return { ...empty, hadImageRefs }
    }

    const user_blocks = await refsToBlocks(probed.user_image_refs)
    const tool_blocks_by_call_id = new Map<string, ImagePlan['user_blocks']>()
    for (const [callId, refs] of probed.tool_image_refs.entries()) {
      const blocks = await refsToBlocks(refs)
      if (blocks.length > 0) tool_blocks_by_call_id.set(callId, blocks)
    }
    const system_notes: string[] = []
    if (probed.dropped_count > 0) {
      system_notes.push(
        `${probed.dropped_count} image(s) not attached (per-turn cap is ${MAX_IMAGES_PER_TURN})`,
      )
    }
    return { user_blocks, tool_blocks_by_call_id, system_notes, hadImageRefs }
  }
  ```

  Now widen the function signature and pre-compute `lastUserMsg` plus `imageMap`:

  ```ts
  // BEFORE (lines 41-53):
  export function buildLlmMessages(
    branch: CopilotMessage[],
    pageContext?: import('./types').PageContext | null,
    opts?: { sessionId?: string },
  ): LlmMessage[] {
    const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

    // v2.5 §5.4: 找最近 boundary，之前的消息不参与本轮组装
    const usable = sliceAfterBoundary(branch)

    // 当前分支最后一条 user 消息挂的 contexts 渲染成 SystemHeader 并塞第二条 system message。
    // 历史 user 消息可能有 contexts，但那是旧状态，不再重放。
    const lastUser = [...usable].reverse().find((m) => m.role === 'user')

  // AFTER:
  export async function buildLlmMessages(
    branch: CopilotMessage[],
    pageContext?: import('./types').PageContext | null,
    opts?: { sessionId?: string; modelVisionCapable?: boolean },
  ): Promise<LlmMessage[]> {
    const out: LlmMessage[] = [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }]

    // v2.5 §5.4: 找最近 boundary，之前的消息不参与本轮组装
    const usable = sliceAfterBoundary(branch)

    // 当前分支最后一条 user 消息挂的 contexts 渲染成 SystemHeader 并塞第二条 system message。
    // 历史 user 消息可能有 contexts，但那是旧状态，不再重放。
    const lastUser = [...usable].reverse().find((m) => m.role === 'user')
    // image-vision §3.1: 预先 materializeImagePlan —— Task 9/10 复用 imageMap 决定 user / tool_result
    // 是否走多模态 content array；Task 11 用 imageMap.hadImageRefs + modelVisionCapable 决定加 strip note。
    const lastUserMsg = lastUser  // alias used by downstream rewrite tasks
    void lastUserMsg
    const imageMap = await materializeImagePlan(usable, opts?.modelVisionCapable === true)
    void imageMap  // Task 9/10/11 will splice; Task 8 just plumbs
  ```

  No further changes in this task — the existing for-of loop still pushes plain string content for both user and tool_result branches. The function is now async and `imageMap` is in scope but unused. Tasks 9/10/11 will reach in and splice.

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/stream-response.ts`

  ```ts
  // BEFORE (line 77):
    const llmMessages = buildLlmMessages(p.branch, p.pageContext, { sessionId: p.sessionId })

  // AFTER:
    const llmMessages = await buildLlmMessages(p.branch, p.pageContext, {
      sessionId: p.sessionId,
      modelVisionCapable: p.model.vision_capable === true,
    })
  ```

  No other call sites for `buildLlmMessages` exist outside the test file (verified via Grep on the codebase before this plan was written). If a new caller appears during execution, add `await` there too.

- [ ] **Step 4: Run test to verify it passes (regression-style)**

  Run: `npm test -- build-llm-messages.test`

  Expected: PASS — all existing cases green after the mechanical `await` migration. The function now returns a `Promise<LlmMessage[]>`; the assertions are unchanged because no rewrite path has been taken yet (`imageMap` is computed but discarded in this task).

  Also re-run the full test suite to confirm no other consumer broke:

  Run: `npm test`

  Expected: all suites green (including `image-attach.test` from Tasks 5-7, since `materializeImagePlan` now imports `collectImageRefs` and `readImageBytes`).

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. Catches:
  - `stream-response.ts` missing `await` (would error: "Type 'Promise<LlmMessage[]>' is not assignable to type 'LlmMessage[]'")
  - any other call site missing `await`
  - `ModelConfig.vision_capable` field accessed (added in Task 1)

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/build-llm-messages.ts src/lib/copilot/stream-response.ts src/lib/copilot/__tests__/build-llm-messages.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(copilot): make buildLlmMessages async and plumb image plan

  Signature widens to Promise<LlmMessage[]>; new opts.modelVisionCapable threads
  through stream-response (sourced from ModelConfig.vision_capable). Adds private
  materializeImagePlan helper that builds an ImagePlan (user_blocks +
  tool_blocks_by_call_id + system_notes + hadImageRefs) by combining
  collectImageRefs with per-ref readImageBytes. Pre-computes lastUserMsg once.
  No content rewrite yet — Tasks 9/10/11 splice imageMap into user / tool_result
  branches and emit the strip note.

  Existing tests migrated mechanically to async/await; assertions unchanged.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Multimodal rewrite for last user message

**Files:**
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts` (in the `m.role === 'user'` branch of the for-of: when `m === lastUserMsg && imageMap.user_blocks.length > 0`, push `{role:'user', content: [...imageMap.user_blocks, {type:'text', text: m.content}]}`; otherwise current `{role:'user', content: m.content}` path unchanged)
- Create: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts`

**Constraints:**
- Block order spec §4.4: text/image alternation `[text("[Image #N · src_label]"), image_url, text("[Image #M · ...]"), image_url, ..., text(<original user content>)]`
- Last text block carries the user's typed message even when empty string (Anthropic rejects content arrays containing only image blocks; an explicit text block keeps the array valid)
- Only the LAST user message gets the multimodal rewrite — historical user messages stay as plain string (their image refs were resolved in earlier turns; not re-attaching avoids context bloat)
- Both OpenAI and Anthropic accept this `[text, image_url, ...]` user content array natively (no Anthropic-specific transform needed at this layer; serialization happens later in `llm-stream.ts` via Task 4's `imageBlockForAnthropic`)
- New test file mocks `@/lib/copilot/image-attach` — provides deterministic `collectImageRefs` and `readImageBytes` implementations so tests don't depend on disk

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts`

  ```ts
  import { describe, it, expect, beforeEach, vi } from "vitest"
  import type { CopilotMessage, ImageRef } from "../types"
  import type { LlmMessage } from "../../llm-client"

  // Mock image-attach so the test doesn't touch fs / store / schema. The real
  // collectImageRefs is exercised in image-attach.test.ts.
  vi.mock("@/lib/copilot/image-attach", () => ({
    MAX_IMAGES_PER_TURN: 5,
    collectImageRefs: vi.fn(),
    readImageBytes: vi.fn(),
  }))

  import { buildLlmMessages } from "../build-llm-messages"
  import { collectImageRefs, readImageBytes } from "@/lib/copilot/image-attach"

  function userMsg(content: string, contexts?: CopilotMessage["contexts"]): CopilotMessage {
    return { id: "m_u", session_id: "s", role: "user", content, contexts: contexts ?? [], timestamp: "t" }
  }

  function refOf(url: string, tag: number, label: string): ImageRef {
    return { url, source_label: label, ctx_tag: tag }
  }

  function dataUrlOk(url: string) {
    return { data_url: url }
  }

  beforeEach(() => {
    vi.mocked(collectImageRefs).mockReset()
    vi.mocked(readImageBytes).mockReset()
    // Default: no images; tests override per-case
    vi.mocked(collectImageRefs).mockReturnValue({
      user_image_refs: [],
      tool_image_refs: new Map(),
      dropped_count: 0,
    })
    vi.mocked(readImageBytes).mockImplementation(async (r) => dataUrlOk(`data:image/png;base64,FAKE_${r.url}`))
  })

  describe("buildLlmMessages · last user message multimodal rewrite", () => {
    it("user message with 2 image contexts → content is array of 5 blocks (alternating text/image, ending with original text)", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [
          refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
          refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
        ],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("compare these two")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const u = msgs.find((m) => m.role === "user") as Extract<LlmMessage, { role: "user" }>
      expect(Array.isArray(u.content)).toBe(true)
      const arr = u.content as Array<Record<string, unknown>>
      expect(arr).toHaveLength(5)
      expect(arr[0]).toMatchObject({ type: "text" })
      expect((arr[0] as { text: string }).text).toContain("#1")
      expect((arr[0] as { text: string }).text).toContain("task_result#t1")
      expect(arr[1]).toMatchObject({ type: "image_url" })
      expect((arr[1] as { image_url: { url: string } }).image_url.url).toContain("FAKE_/api/results/exp_1/images/a.png")
      expect(arr[2]).toMatchObject({ type: "text" })
      expect((arr[2] as { text: string }).text).toContain("#2")
      expect(arr[3]).toMatchObject({ type: "image_url" })
      // Last block carries the user's typed text
      expect(arr[4]).toEqual({ type: "text", text: "compare these two" })
    })

    it("empty user content (only context, no text) → still pushes empty text block at end", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [refOf("/api/results/exp_1/images/x.png", 1, "task_result#tx · field=image_url")],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const u = msgs.find((m) => m.role === "user") as Extract<LlmMessage, { role: "user" }>
      const arr = u.content as Array<Record<string, unknown>>
      expect(arr).toHaveLength(3)
      // Last block is empty text — Anthropic rejects content arrays without trailing text;
      // we keep an empty string text block to preserve the contract.
      expect(arr[2]).toEqual({ type: "text", text: "" })
    })

    it("user message without any image refs → content stays as plain string", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("just a plain question")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const u = msgs.find((m) => m.role === "user") as Extract<LlmMessage, { role: "user" }>
      expect(u.content).toBe("just a plain question")
      expect(typeof u.content).toBe("string")
    })

    it("only the LAST user message gets the rewrite; older user messages stay plain string", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [refOf("/api/results/exp_1/images/x.png", 1, "task_result#tx · field=image_url")],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("old question"),
        { id: "m_a1", session_id: "s", role: "assistant", content: "old answer", timestamp: "t" },
        userMsg("new question with image"),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const userMsgs = msgs.filter((m) => m.role === "user") as Array<Extract<LlmMessage, { role: "user" }>>
      expect(userMsgs).toHaveLength(2)
      expect(userMsgs[0].content).toBe("old question") // older: plain string
      expect(Array.isArray(userMsgs[1].content)).toBe(true) // last: multimodal
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- build-llm-messages.image`

  Expected: FAIL — Task 8's plumbing computes `imageMap` but doesn't splice it. The current user branch always pushes plain string content. Sample failure:

  ```
  AssertionError: expected 'compare these two' to be array
   ❯ src/lib/copilot/__tests__/build-llm-messages.image.test.ts (test 1)
  ```

- [ ] **Step 3: Implement the user-message rewrite**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts`

  Locate the for-of loop (the `for (const m of compacted)` body); modify the user branch:

  ```ts
  // BEFORE (around line 89-90 of the post-Task-8 file):
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {

  // AFTER:
      if (m.role === 'user') {
        // image-vision §4.4: 仅当当前 m 是最后一条 user 且 imageMap 有 user_blocks 时，
        // 把 user 内容升级为多模态 content array。块顺序：[(text+image_url) × N, text(原 user content)]。
        // m.content 为空字符串时仍 push 一条空 text 块，避免 Anthropic 拒绝 image-only content array。
        if (m === lastUserMsg && imageMap.user_blocks.length > 0) {
          out.push({
            role: 'user',
            content: [
              ...imageMap.user_blocks,
              { type: 'text', text: m.content },
            ],
          })
        } else {
          out.push({ role: 'user', content: m.content })
        }
      } else if (m.role === 'assistant') {
  ```

  Note: the `void lastUserMsg` line added in Task 8 should now be removed — `lastUserMsg` is genuinely consumed:

  ```ts
  // BEFORE (Task 8 leftover, around the materializeImagePlan call):
      const lastUserMsg = lastUser  // alias used by downstream rewrite tasks
      void lastUserMsg
      const imageMap = await materializeImagePlan(usable, opts?.modelVisionCapable === true)
      void imageMap  // Task 9/10/11 will splice; Task 8 just plumbs

  // AFTER:
      const lastUserMsg = lastUser  // image-vision §4.4: alias for branch identity check in user/tool_result rewrite
      const imageMap = await materializeImagePlan(usable, opts?.modelVisionCapable === true)
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- build-llm-messages.image`

  Expected: PASS — all 4 cases green.

  Also re-run the original suite to confirm no regression:

  Run: `npm test -- build-llm-messages`

  Expected: both suites green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The user content array `[...imageMap.user_blocks, {type:'text', text}]` matches `LlmMessage.user.content`'s `string | Array<{type:'text',text}|{type:'image_url',image_url:{url}}>` union (already supported pre-this-plan; no widening needed).

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/build-llm-messages.ts src/lib/copilot/__tests__/build-llm-messages.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): rewrite last user message as multimodal content array

  When imageMap.user_blocks is non-empty AND the iterated message is the last
  user message, push {role:'user', content: [...image_blocks, text(content)]}
  instead of plain string. Block order: text/image alternation ending with the
  original user text (kept even when empty, since Anthropic rejects image-only
  content arrays). Older user messages in the same branch stay plain strings.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Multimodal rewrite for tool_result (inline AND ref kinds)

**Files:**
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts` (in the `m.role === 'tool_result'` branch: when `imageMap.tool_blocks_by_call_id.has(m.call_id)`, content becomes a multimodal block array; applies to BOTH `inline` and `ref` kinds; `compacted` never gets blocks; `is_error` flow still gets blocks)
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts` (extend with tool_result test cases)

**Constraints:**
- **ref kind DOES carry images** via wrapper attachments (revised from earlier "drop"). build-llm-messages re-attaches blocks even when the value was offloaded to disk; URL-level dedup in `collectImageRefs` (Task 5) suppresses double-counting if `read_tool_result` rematerializes the same URLs later in the conversation.
- For `kind: 'inline'`: content becomes `[{type:'text', text: JSON.stringify(parsed.value)}, ...image_blocks]` — note image blocks come AFTER the JSON text (different from user message; tool_result reads "result body, then attached images")
- For `kind: 'ref'`: content becomes `[{type:'text', text: <existing preview + ref note>}, ...image_blocks]`
- For `kind: 'compacted'`: never gets image blocks (compacted is by-design lossy summary; if the LLM wants images it must call `read_tool_result(ref)` — which itself may re-attach)
- `is_error` tool_result still gets attached images (LLM may want visual debug context for failures)
- The Task 4 widening of `LlmMessage.tool_result.content` to `string | Array<{type:'text'}|{type:'image_url'}>` is what makes this push valid; reads `parsed.attachments` (wrapper-level field placed there by Task 12's `payloadGuardHook`)

**Steps:**

- [ ] **Step 1: Write the failing tests (extend image.test.ts)**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts`

  Append the following block at the end of the existing `describe(...)` from Task 9 (or open a sibling `describe` — either works):

  ```ts
  describe("buildLlmMessages · tool_result multimodal rewrite", () => {
    function toolResultMsg(call_id: string, content: unknown): CopilotMessage {
      return {
        id: `m_${call_id}r`,
        session_id: "s",
        role: "tool_result",
        content: typeof content === "string" ? content : JSON.stringify(content),
        timestamp: "t",
        call_id,
        tool_name: "read_experiment_results",
      }
    }

    function toolUseMsg(call_id: string): CopilotMessage {
      return {
        id: `m_${call_id}u`,
        session_id: "s",
        role: "tool_use",
        content: "{}",
        timestamp: "t",
        call_id,
        tool_name: "read_experiment_results",
        tool_input: {},
      }
    }

    it("inline kind with attachments → content is array of [text(JSON), text+image_url pairs]", async () => {
      // imageMap.tool_blocks_by_call_id keyed by call_id 'c1'
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map([
          ["c1", [
            refOf("/api/results/exp_1/images/a.png", undefined as unknown as number, "task_result#t1 · field=image_url"),
          ]],
        ]),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("look at the result"),
        toolUseMsg("c1"),
        toolResultMsg("c1", { kind: "inline", value: { results: [{ id: "t1" }] } }),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const tr = msgs.find((m) => m.role === "tool_result") as Extract<LlmMessage, { role: "tool_result" }>
      expect(Array.isArray(tr.content)).toBe(true)
      const arr = tr.content as Array<Record<string, unknown>>
      // [text(JSON of value), text(label), image_url]
      expect(arr).toHaveLength(3)
      expect(arr[0]).toMatchObject({ type: "text" })
      expect((arr[0] as { text: string }).text).toContain("results")
      expect(arr[1]).toMatchObject({ type: "text" })
      expect((arr[1] as { text: string }).text).toContain("task_result#t1")
      expect(arr[2]).toMatchObject({ type: "image_url" })
    })

    it("ref kind with attachments → content is array (NOT just preview text)", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map([
          ["c1", [refOf("/api/results/exp_1/images/r.png", undefined as unknown as number, "task_result#tr · field=image_url")]],
        ]),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("look at the persisted result"),
        toolUseMsg("c1"),
        toolResultMsg("c1", {
          kind: "ref",
          ref: "ref://tool-result/tr_abc",
          preview: '{"results":[...(truncated)',
        }),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const tr = msgs.find((m) => m.role === "tool_result") as Extract<LlmMessage, { role: "tool_result" }>
      expect(Array.isArray(tr.content)).toBe(true)
      const arr = tr.content as Array<Record<string, unknown>>
      expect(arr.length).toBeGreaterThanOrEqual(3)
      expect((arr[0] as { type: string; text: string }).text).toContain("truncated")
      expect((arr[0] as { type: string; text: string }).text).toContain("read_tool_result")
      expect(arr[arr.length - 1]).toMatchObject({ type: "image_url" })
    })

    it("compacted kind never gets image blocks even if attachments somehow appear", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        // collectImageRefs would normally not surface attachments for compacted (no .attachments
        // on that union arm) — but to be defensive, even if a stale Map entry exists, the
        // tool_result rewrite must skip blocks for compacted kind.
        tool_image_refs: new Map([
          ["c1", [refOf("/api/results/exp_1/images/x.png", undefined as unknown as number, "stale")]],
        ]),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("hi"),
        toolUseMsg("c1"),
        toolResultMsg("c1", {
          kind: "compacted",
          summary: "(archived tool result; retrieve via read_tool_result if needed)",
          ref: "ref://tool-result/tr_old",
        }),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const tr = msgs.find((m) => m.role === "tool_result") as Extract<LlmMessage, { role: "tool_result" }>
      expect(typeof tr.content).toBe("string")
      expect(tr.content).toContain("archived tool result")
    })

    it("tool_result without attachments stays as plain string content (regression)", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("hi"),
        toolUseMsg("c1"),
        toolResultMsg("c1", { kind: "inline", value: { ok: true } }),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const tr = msgs.find((m) => m.role === "tool_result") as Extract<LlmMessage, { role: "tool_result" }>
      expect(typeof tr.content).toBe("string")
      expect(tr.content).toContain("\"ok\":true")
    })

    it("error tool_result with attachments still attaches images and sets is_error", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map([
          ["c1", [refOf("/api/results/exp_1/images/err.png", undefined as unknown as number, "task_result#te · field=image_url")]],
        ]),
        dropped_count: 0,
      })
      const branch: CopilotMessage[] = [
        userMsg("look at the failed result"),
        toolUseMsg("c1"),
        // Error shape detected by isToolErrorShape — value is a {kind: 'error', ...} envelope
        toolResultMsg("c1", { kind: "inline", value: { kind: "error", message: "boom" } }),
      ]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const tr = msgs.find((m) => m.role === "tool_result") as Extract<LlmMessage, { role: "tool_result" }>
      expect(Array.isArray(tr.content)).toBe(true)
      const arr = tr.content as Array<Record<string, unknown>>
      expect(arr.some((b) => b.type === "image_url")).toBe(true)
      expect(tr.is_error).toBe(true)
    })
  })
  ```

  Note: the Task 9 helper functions (`userMsg`, `refOf`, `dataUrlOk`) are reused; the new tool-specific helpers (`toolResultMsg`, `toolUseMsg`) live in this `describe` block.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- build-llm-messages.image`

  Expected: FAIL — the tool_result branch still pushes `content: visible` (plain string) regardless of `imageMap.tool_blocks_by_call_id`. Sample failure:

  ```
  AssertionError: expected '{"results":[{"id":"t1"}]}' to be array
  ```

- [ ] **Step 3: Implement the tool_result rewrite**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts`

  Modify the `tool_result` branch in the for-of loop:

  ```ts
  // BEFORE (around lines 105-131 of the post-Task-9 file):
      } else if (m.role === 'tool_result') {
        if (!m.call_id) continue
        // v2：content 是 JSON.stringify(ToolResultContent)。送给 LLM 前按 kind 决定可见内容：
        //   inline    → 完整 value JSON（老行为等价）
        //   ref       → preview + 提示用 read_tool_result(ref) 回捞
        //   compacted → summary 占位（原 payload 已释放）
        // normalizeToolResult 处理了裸字符串 / 裸对象的向后兼容。
        // v2.5 P2: inline kind 检测 isToolErrorShape → 标记 is_error 让 Anthropic 序列化透传协议字段。
        // ref / compacted 形态没法判 error（只有 preview / summary 字符串），保守 false。
        const parsed = normalizeToolResult(m.content)
        let visible: string
        let isError = false
        if (parsed.kind === 'inline') {
          visible = JSON.stringify(parsed.value ?? null)
          if (isToolErrorShape(parsed.value)) isError = true
        } else if (parsed.kind === 'ref') {
          visible = `${parsed.preview}\n\n[Full result available via read_tool_result(ref="${parsed.ref}")]`
        } else {
          visible = parsed.summary
        }
        out.push({
          role: 'tool_result',
          call_id: m.call_id,
          content: visible,
          ...(isError ? { is_error: true } : {}),
        })
      }

  // AFTER:
      } else if (m.role === 'tool_result') {
        if (!m.call_id) continue
        const parsed = normalizeToolResult(m.content)
        let visible: string
        let isError = false
        if (parsed.kind === 'inline') {
          visible = JSON.stringify(parsed.value ?? null)
          if (isToolErrorShape(parsed.value)) isError = true
        } else if (parsed.kind === 'ref') {
          visible = `${parsed.preview}\n\n[Full result available via read_tool_result(ref="${parsed.ref}")]`
        } else {
          visible = parsed.summary
        }
        // image-vision §4.4: 当 imageMap 为这个 call_id 准备了 tool_blocks AND parsed.kind 不是
        // compacted（compacted 是 lossy summary，按设计不附图；image_blocks 通过 read_tool_result
        // 回捞 ref 后由下一轮重新 collect 注入）→ 把 content 升级为 [text(visible), ...image_blocks]。
        const toolBlocks = imageMap.tool_blocks_by_call_id.get(m.call_id)
        if (parsed.kind !== 'compacted' && toolBlocks && toolBlocks.length > 0) {
          out.push({
            role: 'tool_result',
            call_id: m.call_id,
            content: [
              { type: 'text', text: visible },
              ...toolBlocks,
            ],
            ...(isError ? { is_error: true } : {}),
          })
        } else {
          out.push({
            role: 'tool_result',
            call_id: m.call_id,
            content: visible,
            ...(isError ? { is_error: true } : {}),
          })
        }
      }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- build-llm-messages.image`

  Expected: PASS — all 5 new tool_result cases (in addition to the 4 user-msg cases from Task 9) green.

  Also re-run the original suite + image-attach suites to confirm no regression:

  Run: `npm test -- build-llm-messages image-attach`

  Expected: all suites green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The new `content: [{type:'text', text: visible}, ...toolBlocks]` push relies on Task 4's widened `LlmMessage.tool_result.content` union — if Task 4 took the Branch B path (string-only), this won't compile and execution must revisit the Task 4 finding before continuing.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/build-llm-messages.ts src/lib/copilot/__tests__/build-llm-messages.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): rewrite tool_result content as multimodal array when attachments present

  When imageMap.tool_blocks_by_call_id has blocks for the call_id AND parsed.kind
  is not 'compacted', push tool_result content as [text(visible), ...image_blocks]
  array. Both inline and ref kinds carry images on the wrapper — ref kind sees the
  preview+read_tool_result hint as the leading text block, then the same image
  blocks. Error tool_result (is_error=true) still attaches images for visual debug.
  Compacted kind never attaches (by-design lossy summary; LLM uses read_tool_result
  to rematerialize, then collectImageRefs re-collects on next turn).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Vision strip + system note defense (3rd layer)

**Files:**
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts` (after `materializeImagePlan`, decide whether to emit a 3rd system message: `[Image attachments dropped: model not vision_capable]` if `opts.modelVisionCapable !== true && imageMap.hadImageRefs`; emit dropped_count note when vision-capable but cap exceeded)
- Modify: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts` (extend with vision-strip cases)

**Constraints:**
- The strip note is the LAST defense layer: model-picker filtering (Task 17) is the first; chat route validation is the second; build-llm-messages strip-and-note is the third (catches edge cases like in-flight model swap)
- Single system note even when many would-have-been-attached refs are stripped (no per-ref noise)
- `imageMap.hadImageRefs` is the truthy signal even when `modelVisionCapable === false` — Task 8's `materializeImagePlan` runs `collectImageRefs` with `modelVisionCapable: true` first to set `hadImageRefs`, then short-circuits the byte-reading and block production when the actual flag is false
- Distinct from `dropped_count > 0` note (which fires when vision-capable but >5 images would have been attached); both notes can co-exist when vision-capable AND >5 refs (only dropped_count fires; strip note doesn't)
- The dropped_count note text must match the i18n string declared in Task 19 (`copilot.image_dropped_warn` → English template `"{n} image(s) not attached (per-turn cap is {cap})"`); for consistency emit the same plain English in this server-side path (no i18n on the server; tests assert against the English literal)
- The strip note text: literal `[Image attachments dropped: model not vision_capable]`
- Both notes go in as 3rd system message (after COPILOT_SYSTEM_PROMPT and SystemHeader) — combine into one message if both fire

**Steps:**

- [ ] **Step 1: Write the failing tests**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/__tests__/build-llm-messages.image.test.ts`

  Append the following block at the end of the file:

  ```ts
  describe("buildLlmMessages · vision strip + dropped_count notes", () => {
    it("vision-capable=true + 0 image refs → no notes (clean baseline)", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("just a question")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const sysMsgs = msgs.filter((m) => m.role === "system")
      // Only COPILOT_SYSTEM_PROMPT (no SystemHeader because no contexts/pageContext, no image notes)
      expect(sysMsgs).toHaveLength(1)
    })

    it("vision-capable=true + 7 refs (cap=5) → 1 dropped_count note system message", async () => {
      // collectImageRefs already enforces cap; here we simulate the post-cap shape
      // returned from the helper: 5 refs in user_image_refs, dropped_count=2.
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [
          refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
          refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
          refOf("/api/results/exp_1/images/c.png", 3, "task_result#t3 · field=image_url"),
          refOf("/api/results/exp_1/images/d.png", 4, "task_result#t4 · field=image_url"),
          refOf("/api/results/exp_1/images/e.png", 5, "task_result#t5 · field=image_url"),
        ],
        tool_image_refs: new Map(),
        dropped_count: 2,
      })
      const branch = [userMsg("compare these")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: true })
      const sysMsgs = msgs.filter((m) => m.role === "system") as Array<Extract<LlmMessage, { role: "system" }>>
      // Expect a system message containing the dropped_count text
      const noteMsg = sysMsgs.find((s) => s.content.includes("not attached"))
      expect(noteMsg).toBeTruthy()
      expect(noteMsg!.content).toContain("2 image(s) not attached")
      expect(noteMsg!.content).toContain("per-turn cap is 5")
      // User content should still be multimodal with 5 attached image_url blocks
      const u = msgs.find((m) => m.role === "user") as Extract<LlmMessage, { role: "user" }>
      const arr = u.content as Array<Record<string, unknown>>
      expect(arr.filter((b) => b.type === "image_url")).toHaveLength(5)
    })

    it("vision-capable=false + 3 refs → 1 strip note + content stays plain string everywhere", async () => {
      // materializeImagePlan probes with modelVisionCapable=true to set hadImageRefs,
      // then short-circuits to empty user_blocks / tool_blocks because the actual
      // flag is false. The mock here mirrors that: collectImageRefs returns the refs
      // (probe path), and the implementation is responsible for not producing blocks
      // when modelVisionCapable=false.
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [
          refOf("/api/results/exp_1/images/a.png", 1, "task_result#t1 · field=image_url"),
          refOf("/api/results/exp_1/images/b.png", 2, "task_result#t2 · field=image_url"),
          refOf("/api/results/exp_1/images/c.png", 3, "task_result#t3 · field=image_url"),
        ],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("compare these")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: false })
      const sysMsgs = msgs.filter((m) => m.role === "system") as Array<Extract<LlmMessage, { role: "system" }>>
      const noteMsg = sysMsgs.find((s) => s.content.includes("Image attachments dropped"))
      expect(noteMsg).toBeTruthy()
      expect(noteMsg!.content).toContain("model not vision_capable")
      // User content stays plain string
      const u = msgs.find((m) => m.role === "user") as Extract<LlmMessage, { role: "user" }>
      expect(typeof u.content).toBe("string")
      expect(u.content).toBe("compare these")
    })

    it("vision-capable=false + 0 refs → no notes (clean path for non-image use)", async () => {
      vi.mocked(collectImageRefs).mockReturnValue({
        user_image_refs: [],
        tool_image_refs: new Map(),
        dropped_count: 0,
      })
      const branch = [userMsg("a non-image question")]
      const msgs = await buildLlmMessages(branch, null, { modelVisionCapable: false })
      const sysMsgs = msgs.filter((m) => m.role === "system")
      // Only COPILOT_SYSTEM_PROMPT
      expect(sysMsgs).toHaveLength(1)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- build-llm-messages.image`

  Expected: FAIL — neither the strip note nor the dropped_count note is emitted yet. Tasks 8/9/10 didn't add the system-note injection. Sample failure:

  ```
  AssertionError: expected sysMsgs.find(...) to be truthy
   ❯ src/lib/copilot/__tests__/build-llm-messages.image.test.ts (vision-capable=false + 3 refs case)
  ```

  The vision-capable=true + 7 refs case will also fail because Task 8's `materializeImagePlan` populated `system_notes` with the dropped_count message, but Task 8 didn't inject it into `out`.

- [ ] **Step 3: Implement the system-note injection**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/build-llm-messages.ts`

  Step 3a — fix `materializeImagePlan` to also emit the strip note when vision-incapable but image refs exist. The Task 8 implementation already pushes the `dropped_count` note via `system_notes`, but the strip-note logic was deferred. Add it now:

  ```ts
  // BEFORE (in materializeImagePlan, the early-return branch from Task 8):
      if (!modelVisionCapable) {
        return { ...empty, hadImageRefs }
      }

  // AFTER:
      if (!modelVisionCapable) {
        const system_notes: string[] = []
        if (hadImageRefs) {
          system_notes.push('[Image attachments dropped: model not vision_capable]')
        }
        return {
          user_blocks: [],
          tool_blocks_by_call_id: new Map(),
          system_notes,
          hadImageRefs,
        }
      }
  ```

  Step 3b — inject `imageMap.system_notes` as a 3rd system message right after the SystemHeader push. Locate the SystemHeader push (line 64-69 of pre-Task-8 code; will be slightly later post-Task-8):

  ```ts
  // BEFORE (right after the SystemHeader push):
    if (refs.length > 0 || pageContext) {
      out.push({
        role: 'system',
        content: 'Session context (JSON):\n' + JSON.stringify(header, null, 2),
      })
    }

    // v2 §5.6 + v2.5 §4.2: 进入 transcript 迭代前先 microCompact —— ...

  // AFTER:
    if (refs.length > 0 || pageContext) {
      out.push({
        role: 'system',
        content: 'Session context (JSON):\n' + JSON.stringify(header, null, 2),
      })
    }

    // image-vision §4.4: 把 imageMap.system_notes（dropped_count 提示 / vision-strip 提示）
    // 合并成一条 system 消息塞在 SystemHeader 之后。两类提示互斥多见但理论可共存（vision
    // 不支持 + 同时已被 cap=5 截断 —— 此时只有 strip 注释会被推入，因为 materializeImagePlan
    // 在 modelVisionCapable=false 时不计算 dropped_count）。
    if (imageMap.system_notes.length > 0) {
      out.push({
        role: 'system',
        content: imageMap.system_notes.join('\n'),
      })
    }

    // v2 §5.6 + v2.5 §4.2: 进入 transcript 迭代前先 microCompact —— ...
  ```

  Note: this push happens BEFORE microCompact runs and BEFORE the for-of message loop, so the strip note appears as a top-level system message and is never compacted away.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- build-llm-messages.image`

  Expected: PASS — all 4 vision-strip / dropped_count cases (in addition to the 4 user-msg cases from Task 9 and 5 tool_result cases from Task 10) green.

  Also re-run the full Copilot test surface to confirm no regression:

  Run: `npm test -- build-llm-messages image-attach llm-stream`

  Expected: all suites green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The new system message push uses the existing `LlmMessage.system` arm (no shape change).

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/build-llm-messages.ts src/lib/copilot/__tests__/build-llm-messages.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): emit vision-strip + dropped_count system notes (3rd-layer defense)

  When modelVisionCapable is false but the active branch contains image refs,
  inject a single system message "[Image attachments dropped: model not
  vision_capable]" so the LLM knows it can't ground claims on visuals. When
  vision-capable but per-turn cap (5) is exceeded, emit "{n} image(s) not
  attached (per-turn cap is 5)". Notes go in as a 3rd system message right
  after SystemHeader. Distinct paths: strip note never co-fires with
  dropped_count (strip path short-circuits before counting).

  Closes the 3-layer vision defense started by model-picker filter (forthcoming
  Task 17) and chat route validation; this is the last-resort backstop.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: payloadGuardHook lifts `_attachments`; tool-result-store transparent

**Files:**
- Modify: `src/lib/copilot/tools/hooks.ts` (`payloadGuardHook`: when output shape is `{kind: 'ok', value: {...} }` and `value._attachments` is an `ImageRef[]`, extract that array and strip from value before calling `maybePersistToolResult`; attach the extracted array to the resulting `ToolResultContent.attachments` for both inline and ref returns)
- Modify: `src/lib/copilot/tool-result-store.ts` (no logic change; just verify JSON serialization round-trips `attachments` field — type-level addition only via Task 2's `ToolResultContent` extension)
- Create: `src/lib/copilot/tools/__tests__/hooks.attachments-lift.test.ts` (lift from `{kind:'ok', value:{foo:1, _attachments:[ref1]}}` to wrapper `attachments:[ref1]` + value `{foo:1}`; absent _attachments → wrapper has no attachments; non-ok kinds skip lift)

**Constraints:**
- Tools emit `_attachments` (with underscore) at value level; wrapper field is `attachments` (no underscore) per Task 2 type. The lift renames.
- Lift only happens when `output.value` is plain object — for non-object values (rare; mostly tool errors), skip
- Lift happens BEFORE `maybePersistToolResult` so the stripped value can take advantage of size threshold without attachments inflating it
- For `kind: 'ref'` (value offloaded to disk), the persisted file holds the inner value MINUS `_attachments` — wrapper attachments survive in transcript
- read_tool_result回捞 returns the persisted inner value (no `_attachments` since stripped); if LLM needs images again, build-llm-messages re-collects from wrapper.attachments via collectImageRefs

**Note on `output` shape at the hook boundary:** by the time `payloadGuardHook` runs, `runTool` has already unwrapped any `ToolResult` (`{ok:true, value:X}` → `X`). So the hook receives the unwrapped domain output directly. The lift therefore inspects `output` itself (a plain object) for `_attachments`, not `output.value`. The phrasing in this task's intro frames the contract conceptually (tool returns `ok({...,_attachments})`); implementation tests the hook with the post-unwrap shape (a flat object with `_attachments`). This matches `tool-runtime.ts` lines 82-86.

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/__tests__/hooks.attachments-lift.test.ts`

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from "vitest"
  import fs from "node:fs/promises"
  import path from "node:path"
  import os from "node:os"
  import { payloadGuardHook } from "../hooks"
  import type { AnyToolDescriptor } from "../registry"
  import type { ImageRef, ToolResultContent } from "../../types"

  // payloadGuardHook receives the already-unwrapped tool output (see tool-runtime.ts:82-86).
  // It must:
  //   1. Detect plain-object output with `_attachments: ImageRef[]`
  //   2. Strip `_attachments` from the value before maybePersistToolResult
  //   3. Attach the extracted array to the wrapper as `attachments` (no underscore)
  //
  // Persistence happens via fs (data/copilot/tool-results/{sid}/tr_xxx.json),
  // hence the chdir-to-tmpdir pattern.

  function makeTool(
    metadata: Partial<AnyToolDescriptor["metadata"]> = {},
  ): AnyToolDescriptor {
    return {
      name: "t",
      description: "",
      inputSchema: {},
      metadata: {
        isReadOnly: true,
        isDestructive: false,
        maxResultSizeChars: 1000,
        ...metadata,
      },
      call: async () => ({}),
    }
  }

  const ref1: ImageRef = { url: "/api/results/exp_1/images/a.png", source_label: "task_result#t1 · field=image_url" }
  const ref2: ImageRef = { url: "/api/results/exp_1/images/b.png", source_label: "task_result#t2 · field=image_url" }

  let tmpDir: string
  let originalCwd: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-att-"))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe("payloadGuardHook · _attachments lift", () => {
    it("inline path: small payload with _attachments → wrapper {kind:'inline', value (stripped), attachments}", async () => {
      const tool = makeTool({ maxResultSizeChars: 10000 })
      const output = { foo: 1, _attachments: [ref1, ref2] }
      const r = (await payloadGuardHook({
        tool,
        input: {},
        output,
        session_id: "s_inline",
      })) as { output: ToolResultContent }
      expect(r.output.kind).toBe("inline")
      if (r.output.kind !== "inline") throw new Error("expected inline")
      expect(r.output.value).toEqual({ foo: 1 })
      expect(r.output.attachments).toEqual([ref1, ref2])
    })

    it("ref path: huge payload with _attachments → wrapper {kind:'ref', preview, ref, attachments}; persisted file has stripped value", async () => {
      const tool = makeTool({ maxResultSizeChars: 100 })
      // Build a payload guaranteed to exceed maxResultSizeChars after _attachments stripped
      const big = "x".repeat(5000)
      const output = { body: big, _attachments: [ref1] }
      const r = (await payloadGuardHook({
        tool,
        input: {},
        output,
        session_id: "s_ref",
      })) as { output: ToolResultContent }
      expect(r.output.kind).toBe("ref")
      if (r.output.kind !== "ref") throw new Error("expected ref")
      expect(r.output.attachments).toEqual([ref1])
      expect(r.output.ref.startsWith("ref://tool-result/")).toBe(true)
      expect(typeof r.output.preview).toBe("string")

      // Persisted file at data/copilot/tool-results/s_ref/{tr_xxx}.json contains the
      // stripped value (no _attachments)
      const id = r.output.ref.replace("ref://tool-result/", "")
      const file = path.join(tmpDir, "data", "copilot", "tool-results", "s_ref", `${id}.json`)
      const text = await fs.readFile(file, "utf-8")
      const parsed = JSON.parse(text)
      expect(parsed.body).toBe(big)
      expect(parsed._attachments).toBeUndefined()
    })

    it("no _attachments → unchanged behaviour (no attachments key on wrapper)", async () => {
      const tool = makeTool({ maxResultSizeChars: 10000 })
      const output = { foo: 1 }
      const r = (await payloadGuardHook({
        tool,
        input: {},
        output,
        session_id: "s_plain",
      })) as { output: ToolResultContent }
      expect(r.output.kind).toBe("inline")
      if (r.output.kind !== "inline") throw new Error("expected inline")
      expect(r.output.value).toEqual({ foo: 1 })
      expect(r.output.attachments).toBeUndefined()
    })

    it("non-object output (e.g. string) → no lift attempted, wrapper has no attachments", async () => {
      // Tools that return primitives skip the lift path entirely
      const tool = makeTool({ maxResultSizeChars: 10000 })
      const r = (await payloadGuardHook({
        tool,
        input: {},
        output: "just a string",
        session_id: "s_str",
      })) as { output: ToolResultContent }
      expect(r.output.kind).toBe("inline")
      if (r.output.kind !== "inline") throw new Error("expected inline")
      expect(r.output.value).toBe("just a string")
      expect(r.output.attachments).toBeUndefined()
    })

    it("_attachments present but not an array → ignored (no lift, value untouched)", async () => {
      const tool = makeTool({ maxResultSizeChars: 10000 })
      const output = { foo: 1, _attachments: "not-an-array" }
      const r = (await payloadGuardHook({
        tool,
        input: {},
        output,
        session_id: "s_bad_att",
      })) as { output: ToolResultContent }
      expect(r.output.kind).toBe("inline")
      if (r.output.kind !== "inline") throw new Error("expected inline")
      // Value left untouched; _attachments not stripped because not an array
      expect(r.output.value).toEqual({ foo: 1, _attachments: "not-an-array" })
      expect(r.output.attachments).toBeUndefined()
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- hooks.attachments-lift`

  Expected: FAIL — current `payloadGuardHook` does not lift `_attachments`. The first test asserts `r.output.attachments` equals `[ref1, ref2]` but the wrapper from `maybePersistToolResult({foo:1, _attachments:[...]}, ...)` produces `{kind:'inline', value:{foo:1, _attachments:[...]}}` — no top-level `attachments`. Sample failure excerpt:

  ```
  AssertionError: expected undefined to deeply equal [ ImageRef{...}, ImageRef{...} ]
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/hooks.ts`

  ```ts
  // BEFORE (line 9-11):
  import type { AnyToolDescriptor } from "./registry"
  import { maybePersistToolResult } from "../tool-result-store"
  import { isSessionAllowed, isSessionDenied } from "../session-allow"

  // AFTER:
  import type { AnyToolDescriptor } from "./registry"
  import { maybePersistToolResult } from "../tool-result-store"
  import { isSessionAllowed, isSessionDenied } from "../session-allow"
  import type { ImageRef } from "../types"
  ```

  ```ts
  // BEFORE (line 64-72 — the existing payloadGuardHook):
  /**
   * Payload guard：tool 返回后把 output 经 maybePersistToolResult 压成 ToolResultContent
   * (inline | ref)。caller 拿到的 output 就是 ToolResultContent 形态，可以直接
   * JSON.stringify 到 tool_result 消息 content 字段 —— 不用再区分"裸 output vs 封装"。
   */
  export const payloadGuardHook: PostToolCallHook = async ({ tool, output, session_id }) => {
    const wrapped = await maybePersistToolResult(session_id, output, tool.metadata.maxResultSizeChars)
    return { output: wrapped }
  }

  // AFTER:
  /**
   * 检测 tool 返回的 output 是否带 `_attachments: ImageRef[]`。命中即剥离并返还。
   * 仅对 plain-object output 生效；非对象 / `_attachments` 非 array 时按"无 attachments"处理。
   * 注意：`runTool` 已 unwrap `ToolResult`，所以这里看到的 `output` 是 tool.call 返回的
   * 内层 value（e.g. `{results, _attachments}`），不是 `{ok:true, value:{...}}`。
   */
  function liftAttachments(output: unknown): { value: unknown; attachments: ImageRef[] | undefined } {
    if (output === null || typeof output !== "object") {
      return { value: output, attachments: undefined }
    }
    const obj = output as Record<string, unknown>
    if (!Array.isArray(obj._attachments)) {
      return { value: output, attachments: undefined }
    }
    const { _attachments, ...rest } = obj
    return { value: rest, attachments: _attachments as ImageRef[] }
  }

  /**
   * Payload guard：tool 返回后把 output 经 maybePersistToolResult 压成 ToolResultContent
   * (inline | ref)。caller 拿到的 output 就是 ToolResultContent 形态，可以直接
   * JSON.stringify 到 tool_result 消息 content 字段 —— 不用再区分"裸 output vs 封装"。
   *
   * Image vision §4.5：先 lift `_attachments`（如有），再走 maybePersistToolResult。
   * 这样落盘的 inner value 不带 `_attachments`（避免 base64 路径名串撑大），
   * wrapper 上挂 `attachments` 让 build-llm-messages 后续 collectImageRefs 能识别。
   */
  export const payloadGuardHook: PostToolCallHook = async ({ tool, output, session_id }) => {
    const { value, attachments } = liftAttachments(output)
    const wrapped = await maybePersistToolResult(session_id, value, tool.metadata.maxResultSizeChars)
    if (attachments && attachments.length > 0 && wrapped.kind !== "compacted") {
      // ToolResultContent.inline / .ref 都接受 attachments?: ImageRef[]
      ;(wrapped as { attachments?: ImageRef[] }).attachments = attachments
    }
    return { output: wrapped }
  }
  ```

  No changes needed in `tool-result-store.ts` — the `attachments` field is purely on the wrapper produced post-persist (Task 2 already added the optional union arm). `JSON.stringify` round-trips cleanly because `attachments` lives at the same object level as `kind/value/ref/preview`.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- hooks.attachments-lift`

  Expected: PASS — all 5 cases green.

  Also re-run the existing hooks suite to confirm no regression:

  Run: `npm test -- hooks.test`

  Expected: PASS — confirmGateHook unchanged.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. Validates `ImageRef` import resolves and the inline cast on `wrapped` does not violate `ToolResultContent` union.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/tools/hooks.ts src/lib/copilot/tools/__tests__/hooks.attachments-lift.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): payloadGuardHook lifts _attachments to wrapper

  Tools emit `_attachments: ImageRef[]` on their domain output; payloadGuardHook
  now detects + strips that key before maybePersistToolResult, then re-attaches
  the array on the resulting ToolResultContent (inline or ref kind). Stripped
  inner value is what gets persisted to disk; transcript wrapper keeps the
  attachment list for build-llm-messages multimodal rewrite.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 13: read-experiment-results emits _attachments

**Files:**
- Modify: `src/lib/copilot/tools/read-experiment-results.ts`
- Create: `src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts`

**Constraints:**
- Reuse `extractImageRefsFromOutput` from image-attach.ts (Task 7)
- Iterate filtered results; for each successful one, extract refs; accumulate; cap at MAX_IMAGES_PER_TURN early-break
- `_attachments` goes on the tool's domain output as a top-level value field: `{results: [...], stats: {...}, _attachments: ImageRef[]}` — `payloadGuardHook` (Task 12) lifts it to wrapper
- Output JSON shape after lift: ToolResultContent wrapper has `.attachments`; LLM sees domain output WITHOUT `_attachments` plus narrative "(N images attached separately)" caption interleaved by build-llm-messages

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts`

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  import type { TaskSchema } from "@/lib/schema/types"
  import type { ExperimentConfig } from "@/lib/types"
  import type { ImageRef } from "@/lib/copilot/types"

  // Build a schema with a single declared image_url field so extractImageRefsFromOutput
  // produces deterministic refs without falling through to heuristic.
  const schema: TaskSchema = {
    id: "sch_img",
    label: "img",
    version: 1,
    inputs: [],
    variables: [],
    default_prompt: "",
    message_builder: {},
    output_schema: {
      type: "object",
      properties: {
        caption: { type: "string" },
        image_url: { type: "image_url" },
      } as never,
    },
  } as TaskSchema

  // Helpers that fabricate result rows for vi.mock
  function row(taskId: string, status: "success" | "error", output?: Record<string, unknown>) {
    return {
      task_id: taskId,
      status,
      experiment_id: "exp_img",
      schema_id: "sch_img",
      schema_version: 1,
      input_refs: {},
      input_preview: {},
      timestamp: "2026-05-09T00:00:00Z",
      model: "m",
      output: output ?? {},
    }
  }

  // exp_img_3 → 3 successful results, each with image_url; exp_img_10 → 10 successful
  // (used to verify cap=5); exp_img_failed → all error (no _attachments key);
  // exp_img_no_schema_image → schema with no image fields (no _attachments key).
  vi.mock("@/lib/store", () => ({
    readResults: (id: string) => {
      if (id === "exp_img_3") {
        return [
          row("t1", "success", { caption: "a", image_url: "/api/results/exp_img_3/images/a.png" }),
          row("t2", "success", { caption: "b", image_url: "/api/results/exp_img_3/images/b.png" }),
          row("t3", "success", { caption: "c", image_url: "/api/results/exp_img_3/images/c.png" }),
        ]
      }
      if (id === "exp_img_10") {
        return Array.from({ length: 10 }, (_, i) =>
          row(`t${i}`, "success", { caption: `c${i}`, image_url: `/api/results/exp_img_10/images/${i}.png` }),
        )
      }
      if (id === "exp_img_failed") {
        return [
          row("t1", "error"),
          row("t2", "error"),
        ]
      }
      if (id === "exp_no_schema_image") {
        return [
          row("t1", "success", { text: "no images here" }),
        ]
      }
      return []
    },
    getExperiment: (id: string) =>
      ({ id, schema_id: id === "exp_no_schema_image" ? "sch_text_only" : "sch_img" }) as ExperimentConfig,
  }))
  vi.mock("@/lib/schema", () => ({
    getSchema: (id: string) => {
      if (id === "sch_img") return schema
      if (id === "sch_text_only") {
        return {
          ...schema,
          id: "sch_text_only",
          output_schema: { type: "object", properties: { text: { type: "string" } } as never },
        } as TaskSchema
      }
      return null
    },
  }))

  // Import AFTER mocks
  import { readExperimentResultsTool } from "../read-experiment-results"

  const ctx = { session_id: "s_img", signal: new AbortController().signal }

  beforeEach(() => {
    // each test starts with mocks fresh (vi.mock returns module-level fns; nothing to reset)
  })

  describe("read_experiment_results · image attachments", () => {
    it("3 successful results each with image_url → _attachments has 3 entries", async () => {
      const r = (await readExperimentResultsTool.call(
        { experiment_id: "exp_img_3" },
        ctx,
      )) as { ok: true; value: { results: unknown[]; _attachments?: ImageRef[] } }
      expect(r.ok).toBe(true)
      expect(r.value._attachments).toBeDefined()
      expect(r.value._attachments).toHaveLength(3)
      expect(r.value._attachments!.map((a) => a.url)).toEqual([
        "/api/results/exp_img_3/images/a.png",
        "/api/results/exp_img_3/images/b.png",
        "/api/results/exp_img_3/images/c.png",
      ])
      // ctx_tag should be undefined (tool path, not user-circled)
      expect(r.value._attachments![0].ctx_tag).toBeUndefined()
    })

    it("10 successful results → _attachments capped at MAX_IMAGES_PER_TURN=5", async () => {
      const r = (await readExperimentResultsTool.call(
        { experiment_id: "exp_img_10" },
        ctx,
      )) as { ok: true; value: { results: unknown[]; _attachments?: ImageRef[] } }
      expect(r.value._attachments).toHaveLength(5)
    })

    it("0 successful results (all failed) → no _attachments key in output", async () => {
      const r = (await readExperimentResultsTool.call(
        { experiment_id: "exp_img_failed" },
        ctx,
      )) as { ok: true; value: Record<string, unknown> }
      expect(r.ok).toBe(true)
      expect("_attachments" in r.value).toBe(false)
    })

    it("schema with no image fields → no _attachments key", async () => {
      const r = (await readExperimentResultsTool.call(
        { experiment_id: "exp_no_schema_image" },
        ctx,
      )) as { ok: true; value: Record<string, unknown> }
      expect("_attachments" in r.value).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- read-experiment-results.image`

  Expected: FAIL — current `read_experiment_results` does not emit `_attachments`. Sample failure excerpt:

  ```
  AssertionError: expected undefined to be defined
   ❯ src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/read-experiment-results.ts`

  ```ts
  // BEFORE (line 1-4):
  import { readResults } from "@/lib/store"
  import type { GenericResultRecord } from "@/lib/schema/types"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"

  // AFTER:
  import { readResults, getExperiment } from "@/lib/store"
  import { getSchema } from "@/lib/schema"
  import type { GenericResultRecord } from "@/lib/schema/types"
  import type { ImageRef } from "../types"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"
  import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
  ```

  Then update both ok-returning branches (legacy mode + aggregated mode) to compute `_attachments` from the filtered successful rows. The legacy branch is line 125-134 in the current file:

  ```ts
  // BEFORE (line 125-134 — legacy mode return):
      // Legacy mode: no group_by → original shape
      if (!input.group_by) {
        const limit = Math.min(Number(input.limit ?? 20), 50)
        return ok({
          results: filtered.slice(0, limit),
          total_matching: filtered.length,
          returned: Math.min(filtered.length, limit),
          truncated: filtered.length > limit,
        })
      }

  // AFTER:
      // Helper: walk the first N successful results' outputs, extract image refs
      // via the schema-aware Task 7 helper. Caps at MAX_IMAGES_PER_TURN globally.
      // Returns undefined when zero refs collected so caller can omit the field
      // entirely (callers / tests assert "_attachments" key absent on text-only).
      function collectAttachmentsForFiltered(): ImageRef[] | undefined {
        const exp = getExperiment(String(input.experiment_id))
        if (!exp) return undefined
        const schema = getSchema(exp.schema_id)
        if (!schema) return undefined
        const refs: ImageRef[] = []
        for (const r of filtered) {
          if (r.status !== "success") continue
          if (refs.length >= MAX_IMAGES_PER_TURN) break
          const outRefs = extractImageRefsFromOutput(
            (r.output ?? {}) as Record<string, unknown>,
            schema,
            exp.id,
            undefined,
            r.task_id,
          )
          for (const ref of outRefs) {
            if (refs.length >= MAX_IMAGES_PER_TURN) break
            refs.push(ref)
          }
        }
        return refs.length > 0 ? refs : undefined
      }

      // Legacy mode: no group_by → original shape
      if (!input.group_by) {
        const limit = Math.min(Number(input.limit ?? 20), 50)
        const attachments = collectAttachmentsForFiltered()
        return ok({
          results: filtered.slice(0, limit),
          total_matching: filtered.length,
          returned: Math.min(filtered.length, limit),
          truncated: filtered.length > limit,
          ...(attachments ? { _attachments: attachments } : {}),
        })
      }
  ```

  And update the aggregated mode return (line 150-159 in current file):

  ```ts
  // BEFORE (line 150-159 — aggregated mode return):
      return ok({
        groups: Array.from(groups.entries()).map(([key, members]) => ({
          group_key: key,
          metrics: computeMetrics(members, aggs),
          ...(wantSampleIds
            ? { sample_ids: members.slice(0, 5).map((m) => m.task_id) }
            : {}),
        })),
        total: filtered.length,
      })

  // AFTER:
      const attachments = collectAttachmentsForFiltered()
      return ok({
        groups: Array.from(groups.entries()).map(([key, members]) => ({
          group_key: key,
          metrics: computeMetrics(members, aggs),
          ...(wantSampleIds
            ? { sample_ids: members.slice(0, 5).map((m) => m.task_id) }
            : {}),
        })),
        total: filtered.length,
        ...(attachments ? { _attachments: attachments } : {}),
      })
  ```

  Note: the function `collectAttachmentsForFiltered` closes over `filtered` + `input.experiment_id` so it must be **defined inside `call`**, before either return. Place it right after the filter block (around line 124, just before the legacy-mode `if (!input.group_by)` branch).

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- read-experiment-results`

  Expected: PASS — both the new `read-experiment-results.image` suite (4 cases) and the existing `read-experiment-results-aggregate` suite (the legacy / aggregate / validation cases) green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/tools/read-experiment-results.ts src/lib/copilot/tools/__tests__/read-experiment-results.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): read_experiment_results emits _attachments for image-bearing schemas

  After filtering / aggregating, walk first N=MAX_IMAGES_PER_TURN successful
  rows; for each, extractImageRefsFromOutput against the experiment's schema.
  Cap globally at 5; emit `_attachments: ImageRef[]` at the value root only
  when non-empty. payloadGuardHook lifts the field to the wrapper; LLM sees
  domain output sans _attachments plus the multimodal blocks added by
  build-llm-messages later in the plan.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 14: read-context emits _attachments

**Files:**
- Modify: `src/lib/copilot/tools/read-context.ts`
- Create: `src/lib/copilot/tools/__tests__/read-context.image.test.ts`

**Constraints:**
- Only fires for ref.type ∈ {task_result, task_field}
- task_field with field_type=image_url: 1 attachment
- task_result: scan output_schema for image fields, attach all (cap=5 within this single context)
- Open Q3 resolution: per-tool-result independent cap (this tool can attach up to 5 even if read_experiment_results already attached 5 in same turn — global cap enforced separately by build-llm-messages.collectImageRefs)

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/__tests__/read-context.image.test.ts`

  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
  import fs from "node:fs/promises"
  import path from "node:path"
  import os from "node:os"
  import type { ImageRef } from "@/lib/copilot/types"

  // Mock session store to return a controlled active context set (matches read-context.test.ts pattern)
  const mockTag = vi.fn<(sessionId: string, tag: number) => unknown>()
  vi.mock("../../session-store", async () => {
    const actual = await vi.importActual<typeof import("../../session-store")>("../../session-store")
    return {
      ...actual,
      getActiveContextByTag: (sessionId: string, tag: number) => mockTag(sessionId, tag),
    }
  })

  // Mock getSchema so resolve-context + extractImageRefsFromOutput share the same shape
  vi.mock("@/lib/schema", () => ({
    getSchema: (id: string) => {
      if (id === "sch_img") {
        return {
          id: "sch_img",
          label: "img",
          version: 1,
          inputs: [],
          variables: [],
          default_prompt: "",
          message_builder: {},
          output_schema: {
            type: "object",
            properties: {
              caption: { type: "string" },
              image_url: { type: "image_url" },
            },
          },
        }
      }
      if (id === "sch_text_only") {
        return {
          id: "sch_text_only",
          label: "text",
          version: 1,
          inputs: [],
          variables: [],
          default_prompt: "",
          message_builder: {},
          output_schema: { type: "object", properties: { text: { type: "string" } } },
        }
      }
      return null
    },
  }))

  import { readContextTool } from "../read-context"

  let tmpDir: string
  let originalCwd: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-ctx-img-"))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    mockTag.mockReset()

    // Seed exp_img with one image-bearing task
    await fs.mkdir(path.join(tmpDir, "data", "experiments"), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, "data", "experiments", "exp_img.json"),
      JSON.stringify({
        id: "exp_img",
        name: "Img Exp",
        model: "gpt-4o",
        status: "completed",
        schema_id: "sch_img",
        api_config: { api_format: "openai", base_url: "x", api_key: "k" },
        temperature: 1,
      }),
    )
    await fs.mkdir(path.join(tmpDir, "data", "results", "exp_img"), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, "data", "results", "exp_img", "results.jsonl"),
      JSON.stringify({
        task_id: "task_img_1",
        input: { prompt: "a cat" },
        output: { caption: "a cat", image_url: "/api/results/exp_img/images/cat.png" },
        status: "success",
        experiment_id: "exp_img",
      }) + "\n",
    )

    // Seed exp_text with text-only task
    await fs.writeFile(
      path.join(tmpDir, "data", "experiments", "exp_text.json"),
      JSON.stringify({
        id: "exp_text",
        name: "Text Exp",
        model: "gpt-4o",
        status: "completed",
        schema_id: "sch_text_only",
        api_config: { api_format: "openai", base_url: "x", api_key: "k" },
        temperature: 1,
      }),
    )
    await fs.mkdir(path.join(tmpDir, "data", "results", "exp_text"), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, "data", "results", "exp_text", "results.jsonl"),
      JSON.stringify({
        task_id: "task_text_1",
        input: {},
        output: { text: "no images here" },
        status: "success",
        experiment_id: "exp_text",
      }) + "\n",
    )
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const ctx = { session_id: "s_ctx_img", signal: new AbortController().signal }

  describe("read_context · image attachments", () => {
    it("task_result with declared image_url field → _attachments has 1 entry", async () => {
      mockTag.mockReturnValue({
        tag: 1,
        type: "task_result",
        id: "task_img_1",
        extra: { experiment_id: "exp_img" },
      })
      const r = (await readContextTool.call({ id: "ctx_1" }, ctx)) as {
        ok: true
        value: { _attachments?: ImageRef[] } & Record<string, unknown>
      }
      expect(r.ok).toBe(true)
      expect(r.value._attachments).toBeDefined()
      expect(r.value._attachments).toHaveLength(1)
      expect(r.value._attachments![0].url).toBe("/api/results/exp_img/images/cat.png")
    })

    it("task_field with extra.field_type='image_url' → _attachments has 1 entry", async () => {
      mockTag.mockReturnValue({
        tag: 2,
        type: "task_field",
        id: "output.image_url",
        extra: {
          experiment_id: "exp_img",
          task_id: "task_img_1",
          field: "image_url",
          field_type: "image_url",
        },
      })
      const r = (await readContextTool.call({ id: "ctx_2", scope: "self" }, ctx)) as {
        ok: true
        value: { _attachments?: ImageRef[] } & Record<string, unknown>
      }
      expect(r.value._attachments).toHaveLength(1)
      expect(r.value._attachments![0].url).toBe("/api/results/exp_img/images/cat.png")
      expect(r.value._attachments![0].source_label).toContain("field=image_url")
    })

    it("experiment ref → no _attachments key on output", async () => {
      mockTag.mockReturnValue({ tag: 3, type: "experiment", id: "exp_img" })
      const r = (await readContextTool.call({ id: "ctx_3" }, ctx)) as {
        ok: true
        value: Record<string, unknown>
      }
      expect("_attachments" in r.value).toBe(false)
    })

    it("task_result with text-only schema → no _attachments key", async () => {
      mockTag.mockReturnValue({
        tag: 4,
        type: "task_result",
        id: "task_text_1",
        extra: { experiment_id: "exp_text" },
      })
      const r = (await readContextTool.call({ id: "ctx_4" }, ctx)) as {
        ok: true
        value: Record<string, unknown>
      }
      expect("_attachments" in r.value).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- read-context.image`

  Expected: FAIL — current `read_context` returns plain `r.self_value` without `_attachments`. Sample failure excerpt:

  ```
  AssertionError: expected undefined to be defined
   ❯ src/lib/copilot/tools/__tests__/read-context.image.test.ts
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/read-context.ts`

  ```ts
  // BEFORE (line 1-4):
  import { resolveContextById } from "../resolve-context"
  import type { ContextScope } from "../resolve-context"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"

  // AFTER:
  import { resolveContextById } from "../resolve-context"
  import type { ContextScope } from "../resolve-context"
  import { getExperiment } from "@/lib/store"
  import { getSchema } from "@/lib/schema"
  import type { ImageRef } from "../types"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"
  import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
  ```

  Replace the `call` function (line 43-60 in current file) to wrap the value with `_attachments` for `task_result` / `task_field`:

  ```ts
  // BEFORE (line 43-60):
    call: async ({ id, scope }, ctx) => {
      if (!id || typeof id !== "string") {
        return err("INVALID_INPUT", "id is required", {
          hint: 'Pass id like "ctx_1" referring to active_contexts[]',
        })
      }
      const r = resolveContextById(ctx.session_id, id)
      if (!r) {
        return err("NOT_FOUND", `context ${id} not found in current session`, {
          hint: "Check active_contexts list in system header",
        })
      }
      const useScope = scope ?? defaultScope(r.type)
      if (useScope === "self") return ok(r.self_value)
      if (useScope === "parent") return ok(r.parent_value ?? r.self_value)
      // full 当前语义等价 parent
      return ok(r.full_value ?? r.parent_value ?? r.self_value)
    },

  // AFTER:
    call: async ({ id, scope }, ctx) => {
      if (!id || typeof id !== "string") {
        return err("INVALID_INPUT", "id is required", {
          hint: 'Pass id like "ctx_1" referring to active_contexts[]',
        })
      }
      const r = resolveContextById(ctx.session_id, id)
      if (!r) {
        return err("NOT_FOUND", `context ${id} not found in current session`, {
          hint: "Check active_contexts list in system header",
        })
      }
      const useScope = scope ?? defaultScope(r.type)
      const value =
        useScope === "self"
          ? r.self_value
          : useScope === "parent"
            ? (r.parent_value ?? r.self_value)
            : (r.full_value ?? r.parent_value ?? r.self_value)

      // Image vision §4.5: scan task_result / task_field self_value for image fields,
      // emit _attachments. payloadGuardHook lifts to wrapper. Per-tool independent
      // cap (5); global cap enforced by build-llm-messages.collectImageRefs.
      const attachments = collectImageAttachments(r)
      if (attachments && attachments.length > 0 && value && typeof value === "object") {
        return ok({ ...(value as Record<string, unknown>), _attachments: attachments })
      }
      return ok(value)
    },
  }

  /**
   * 仅对 task_result / task_field 收图。其他 ref.type 直接 undefined（短路）。
   * task_field 走 self_value.targeted_value（field_type='image_url' 时），任何其他
   * field_type 一律 0 张。
   */
  function collectImageAttachments(
    r: NonNullable<ReturnType<typeof resolveContextById>>,
  ): ImageRef[] | undefined {
    if (r.type !== "task_result" && r.type !== "task_field") return undefined

    const ref = r.ref
    const extra = (ref.extra ?? {}) as {
      experiment_id?: string
      task_id?: string
      field?: string
      field_type?: string
    }
    const expId = extra.experiment_id
    if (!expId) return undefined

    if (r.type === "task_field") {
      if (extra.field_type !== "image_url") return undefined
      // self_value shape: { targeted_field, targeted_value }
      const self = r.self_value as { targeted_value?: unknown; targeted_field?: string } | null
      const url = self?.targeted_value
      if (typeof url !== "string" || !url) return undefined
      return [
        {
          url,
          source_label: `task_field#${extra.task_id ?? ref.id} · field=${self?.targeted_field ?? extra.field ?? ref.id}`,
        },
      ]
    }

    // task_result: walk schema.output_schema.properties
    const exp = getExperiment(expId)
    if (!exp) return undefined
    const schema = getSchema(exp.schema_id)
    if (!schema) return undefined

    // self_value is manifestTaskResult — has .output (when self) plus task meta
    const self = r.self_value as { output?: Record<string, unknown> } | null
    const output = self?.output
    if (!output || typeof output !== "object") return undefined

    const refs = extractImageRefsFromOutput(
      output as Record<string, unknown>,
      schema,
      expId,
      undefined,
      ref.id,
    )
    if (refs.length === 0) return undefined
    return refs.slice(0, MAX_IMAGES_PER_TURN)
  ```

  Notes:
  - `collectImageAttachments` lives at module scope (after the `readContextTool` export); the `call` function closes over it via lexical scope.
  - For `task_field`, only `field_type === 'image_url'` paths attach. `image_url_list` task_fields are not currently supported (single targeted_value); the spec §4.5 only lists `image_url` for the field-level case.
  - `task_result` cap is 5 within this single context (per-tool cap; build-llm-messages still enforces global N=5 turn cap across all tool_results + circled refs).

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- read-context`

  Expected: PASS — both the new `read-context.image` suite (4 cases) and the existing `read-context.test` suite (which exercises self/parent scopes against text-only output) green. The new `_attachments` key is absent in the existing tests' assertions because the seed there has no image fields.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/tools/read-context.ts src/lib/copilot/tools/__tests__/read-context.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): read_context emits _attachments for task_result / task_field

  When the resolved context is task_result, walk the schema's output_schema
  via extractImageRefsFromOutput and attach up to MAX_IMAGES_PER_TURN refs.
  When task_field with extra.field_type='image_url', attach the targeted
  value as a single ref. payloadGuardHook lifts to wrapper. Other context
  types (experiment / template / dataset / display / rubric / rubric_stats /
  text_selection) emit no attachments.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 15: read-resource emits _attachments (when applicable)

**Files:**
- Modify: `src/lib/copilot/tools/read-resource.ts`

**Constraints:**
- type='experiment' + fields includes a sample task_result → attach first task's images (≤5)
- type='template'/'dataset'/'display'/'rubric' → no attachments (they're metadata, not output)
- Resist the urge to be "smart" — just simple branch on type

**Tests:** Optional (read-resource is thin pass-through; light coverage in existing read-resource tests if any)

**Steps:**

- [ ] **Step 1: Write the failing test**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/__tests__/read-resource.image.test.ts`

  ```ts
  import { describe, it, expect, vi } from "vitest"
  import type { ImageRef } from "@/lib/copilot/types"

  // Stub stores so resource lookups return controlled shapes.
  vi.mock("@/lib/store", () => ({
    getExperiment: (id: string) => {
      if (id === "exp_img") return { id, name: "Img", schema_id: "sch_img", model: "gpt-4o" }
      if (id === "exp_text") return { id, name: "Text", schema_id: "sch_text_only", model: "gpt-4o" }
      return null
    },
    readResults: (id: string) => {
      if (id === "exp_img") {
        return [
          {
            task_id: "t1",
            status: "success",
            experiment_id: "exp_img",
            output: { caption: "a", image_url: "/api/results/exp_img/images/a.png" },
          },
          {
            task_id: "t2",
            status: "success",
            experiment_id: "exp_img",
            output: { caption: "b", image_url: "/api/results/exp_img/images/b.png" },
          },
        ]
      }
      if (id === "exp_text") {
        return [{ task_id: "t1", status: "success", output: { text: "no images" } }]
      }
      return []
    },
  }))
  vi.mock("@/lib/schema", () => ({
    getSchema: (id: string) => {
      if (id === "sch_img") {
        return {
          id, label: "img", version: 1, inputs: [], variables: [], default_prompt: "",
          message_builder: {},
          output_schema: {
            type: "object",
            properties: { caption: { type: "string" }, image_url: { type: "image_url" } },
          },
        }
      }
      if (id === "sch_text_only") {
        return {
          id, label: "text", version: 1, inputs: [], variables: [], default_prompt: "",
          message_builder: {},
          output_schema: { type: "object", properties: { text: { type: "string" } } },
        }
      }
      return null
    },
  }))
  vi.mock("@/lib/datasets", () => ({ getDataset: () => null }))
  vi.mock("@/lib/displays", () => ({ getDisplay: () => null }))
  vi.mock("@/lib/rubric-store", () => ({ getRubric: () => null }))

  import { readResourceTool } from "../read-resource"

  const ctx = { session_id: "s_rr_img", signal: new AbortController().signal }

  describe("read_resource · image attachments", () => {
    it("type=experiment + image-bearing schema → _attachments has refs from first task", async () => {
      const r = (await readResourceTool.call({ type: "experiment", id: "exp_img" }, ctx)) as {
        ok: true
        value: { _attachments?: ImageRef[] } & Record<string, unknown>
      }
      expect(r.ok).toBe(true)
      expect(r.value._attachments).toBeDefined()
      // 2 results × 1 image_url field each = 2 refs (≤ MAX_IMAGES_PER_TURN=5)
      expect(r.value._attachments!.map((a) => a.url)).toEqual([
        "/api/results/exp_img/images/a.png",
        "/api/results/exp_img/images/b.png",
      ])
    })

    it("type=experiment + text-only schema → no _attachments key", async () => {
      const r = (await readResourceTool.call({ type: "experiment", id: "exp_text" }, ctx)) as {
        ok: true
        value: Record<string, unknown>
      }
      expect("_attachments" in r.value).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- read-resource.image`

  Expected: FAIL — `read_resource` currently returns the raw resource object with no `_attachments` augmentation. Sample failure excerpt:

  ```
  AssertionError: expected undefined to be defined
   ❯ src/lib/copilot/tools/__tests__/read-resource.image.test.ts
  ```

- [ ] **Step 3: Implement**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/copilot/tools/read-resource.ts`

  ```ts
  // BEFORE (line 1-7):
  import { getExperiment } from "@/lib/store"
  import { getSchema } from "@/lib/schema"
  import { getDataset } from "@/lib/datasets"
  import { getDisplay } from "@/lib/displays"
  import { getRubric } from "@/lib/rubric-store"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"

  // AFTER:
  import { getExperiment, readResults } from "@/lib/store"
  import { getSchema } from "@/lib/schema"
  import { getDataset } from "@/lib/datasets"
  import { getDisplay } from "@/lib/displays"
  import { getRubric } from "@/lib/rubric-store"
  import type { ImageRef } from "../types"
  import type { ToolDescriptor } from "./types"
  import { ok, err } from "./tool-result"
  import { extractImageRefsFromOutput, MAX_IMAGES_PER_TURN } from "../image-attach"
  ```

  Replace the `call` function final return (line 73-86 in current file):

  ```ts
  // BEFORE (line 73-86):
    call: async ({ type, id, fields }) => {
      if (!type || !id) {
        return err("INVALID_INPUT", "type and id are required", {
          hint: 'Pass both type (e.g. "experiment") and id',
        })
      }
      const res = loadResource(type, id)
      if (!res) {
        return err("NOT_FOUND", `${type}/${id} not found`, {
          hint: "Verify the resource exists",
        })
      }
      return ok(fields && fields.length > 0 ? pickFields(res, fields) : res)
    },

  // AFTER:
    call: async ({ type, id, fields }) => {
      if (!type || !id) {
        return err("INVALID_INPUT", "type and id are required", {
          hint: 'Pass both type (e.g. "experiment") and id',
        })
      }
      const res = loadResource(type, id)
      if (!res) {
        return err("NOT_FOUND", `${type}/${id} not found`, {
          hint: "Verify the resource exists",
        })
      }
      const value = fields && fields.length > 0 ? pickFields(res, fields) : res

      // Image vision §4.5: only experiment type may attach images (sample task_result
      // outputs). Other types (template / dataset / display / rubric) are metadata,
      // never images. Resist over-engineering — simple branch by type.
      if (type === "experiment") {
        const attachments = collectExperimentAttachments(id)
        if (attachments && attachments.length > 0 && value && typeof value === "object") {
          return ok({ ...(value as Record<string, unknown>), _attachments: attachments })
        }
      }
      return ok(value)
    },
  }

  /**
   * Walk the experiment's results.jsonl, attach images from successful rows up to
   * MAX_IMAGES_PER_TURN. Mirrors read_experiment_results' helper but called from
   * read_resource when type='experiment'.
   */
  function collectExperimentAttachments(expId: string): ImageRef[] | undefined {
    const exp = getExperiment(expId)
    if (!exp) return undefined
    const schema = getSchema(exp.schema_id)
    if (!schema) return undefined
    const all = readResults(expId)
    const refs: ImageRef[] = []
    for (const r of all) {
      if (r.status !== "success") continue
      if (refs.length >= MAX_IMAGES_PER_TURN) break
      const outRefs = extractImageRefsFromOutput(
        (r.output ?? {}) as Record<string, unknown>,
        schema,
        expId,
        undefined,
        r.task_id,
      )
      for (const ref of outRefs) {
        if (refs.length >= MAX_IMAGES_PER_TURN) break
        refs.push(ref)
      }
    }
    return refs.length > 0 ? refs : undefined
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- read-resource`

  Expected: PASS — both the new `read-resource.image` suite (2 cases) and the existing `read-resource.test` suite (which uses non-image stubs, so `_attachments` key is absent and assertions pass) green.

- [ ] **Step 5: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/copilot/tools/read-resource.ts src/lib/copilot/tools/__tests__/read-resource.image.test.ts
  git commit -m "$(cat <<'EOF'
  feat(copilot): read_resource emits _attachments for type='experiment'

  Mirror of read_experiment_results' image-collection logic, gated to type=
  'experiment'. Other resource types (template / dataset / display / rubric)
  are metadata only and emit no attachments. Cap at MAX_IMAGES_PER_TURN=5;
  payloadGuardHook lifts the field to the wrapper.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 16: Add `field_type` to existing task_field captures (NOT a view-helpers.tsx rewrite)

**Files:**
- Modify: `src/components/results/single-list-results.tsx` (2 callsites: `SingleListResults` line 67, `SingleListCell` line 100)
- Modify: `src/components/results/dual-list-results.tsx` (2 callsites: `GroupRow` inner cell line 141, `DualListCell` line 202)
- Modify: `src/components/results/triple-grid-results.tsx` (2 callsites: `TripleGridResults` line 142, `TripleGridCell` line 197)
- **NOT modifying** `configurable-display.tsx` — verified by Grep: it's a 35-line dispatcher that contains zero `data-copilot-context` wiring. The `display-grouped-grid.tsx` view it routes to also has no `task_field` capture sites today, so there's nothing to augment there. (Listed in plan stub but file inspection shows no callsite.)

**Constraints:**
- The existing parent-div `data-copilot-context="task_field"` + extras object IS already correctly wired; just augment the extras object
- One-line addition per callsite — `...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {})` spread into the existing JSON.stringify literal
- Do NOT modify `view-helpers.tsx::renderField`; it has no access to result/schema metadata and signature change would ripple to 6+ callers
- `f.type` is `JsonFieldType` which already includes `'image_url'` and `'image_url_list'` (from v0.10.0; verified by spec §4.1)

**Tests:** No new tests (UI-only tweak). Verification is manual: open Copilot in dev, circle a cell of an image-typed field, expand the chip, confirm the resolved context's `extra.field_type` is set to `image_url`.

**Steps:**

- [ ] **Step 1: Modify `src/components/results/single-list-results.tsx`**

  Two callsites to augment with the same conditional spread.

  File: `/Users/lijiakun/Documents/evalyst/src/components/results/single-list-results.tsx`

  ```tsx
  // BEFORE (line 67, inside SingleListResults output-fields loop):
                      data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name })}

  // AFTER:
                      data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

  ```tsx
  // BEFORE (line 100, inside SingleListCell loop):
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name })}

  // AFTER:
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

- [ ] **Step 2: Modify `src/components/results/dual-list-results.tsx`**

  Two callsites.

  File: `/Users/lijiakun/Documents/evalyst/src/components/results/dual-list-results.tsx`

  ```tsx
  // BEFORE (line 141, inside GroupRow cell output-fields loop):
                              data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name })}

  // AFTER:
                              data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

  ```tsx
  // BEFORE (line 202, inside DualListCell loop):
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name })}

  // AFTER:
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

- [ ] **Step 3: Modify `src/components/results/triple-grid-results.tsx`**

  Two callsites.

  File: `/Users/lijiakun/Documents/evalyst/src/components/results/triple-grid-results.tsx`

  ```tsx
  // BEFORE (line 142, inside TripleGridResults outputFields loop):
                              data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name })}

  // AFTER:
                              data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id, task_id: r.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

  ```tsx
  // BEFORE (line 197, inside TripleGridCell loop):
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name })}

  // AFTER:
            data-copilot-context-extra={JSON.stringify({ experiment_id: result.experiment_id, task_id: result.task_id, field: f.name, ...(f.type === 'image_url' || f.type === 'image_url_list' ? { field_type: f.type } : {}) })}
  ```

- [ ] **Step 4: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The conditional spread literal is well-typed against `JSON.stringify` arg.

- [ ] **Step 5: Manual verification in dev server**

  Run: `npm run dev`

  Steps in browser:
  1. Open `http://localhost:3000` (or whatever Next picks)
  2. Open the `image_gen_v1` experiment detail page (or any experiment whose schema declares an `image_url` / `image_url_list` field)
  3. Press `⌘K` to open Copilot
  4. Click the Inspector button on the chip rail; click an image cell to circle it
  5. The chip rail should show a new chip; click it to expand
  6. In the expanded body, verify the rendered metadata shows the captured ref carries `field_type: image_url` (the chip's `data` body in the `<pre>` block, OR the underlying `data-copilot-context-extra` attribute on the cell — visible via DevTools)
  7. Repeat with a non-image field — confirm `field_type` is absent (the spread evaluates to `{}`)

  Expected: image-typed fields produce extras with `field_type`; other fields produce extras without it. No console errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/results/single-list-results.tsx src/components/results/dual-list-results.tsx src/components/results/triple-grid-results.tsx
  git commit -m "$(cat <<'EOF'
  feat(results): add field_type to task_field copilot contexts on image cells

  Augments data-copilot-context-extra with field_type='image_url' (or
  'image_url_list') when the underlying JsonPropDef indicates an image. Lets
  collectImageRefs in build-llm-messages decide a task_field circle deserves
  exactly 1 image attachment without server roundtrip. Six callsites total
  across single-list / dual-list / triple-grid result views; configurable-display
  was inspected and has no task_field wiring (it's a 35-line dispatcher).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 17: model-picker requireVision filter + chat-view imageContextCount

**Files:**
- Modify: `src/components/copilot/model-picker.tsx` (add `requireVision?: boolean` prop; filter to `m.copilot_enabled && (!requireVision || m.vision_capable)`; warning text when current selection becomes invalid)
- Modify: `src/components/copilot/chat-view.tsx` (compute `imageContextCount` from contexts; pass `requireVision={imageContextCount > 0}` to ModelPicker)

**Constraints:**
- Open Q4 resolution: conservative — task_result and task_field captures count by default (regardless of `extra.field_type`); explicit `extra.field_type === 'image_url'` is also counted. Skips text_selection / page / experiment / template / dataset / display / rubric / rubric_stats. This is intentionally over-counting because we don't have a server roundtrip for the picker
- If currently selected model becomes invalid after filter → display warning text near picker using i18n key `copilot.model_picker_vision_required` (added in Task 19); don't auto-clear selection (let user notice)
- requireVision=false maintains current behavior unchanged
- Filter key is BOTH `m.copilot_enabled && m.base_url && m.api_key` (preserved from current code) AND the new vision predicate

**Tests:** No new tests (UI logic; covered by manual verification + spec §5.3 checklist).

**Steps:**

- [ ] **Step 1: Modify `src/components/copilot/model-picker.tsx` to accept `requireVision` + warn**

  File: `/Users/lijiakun/Documents/evalyst/src/components/copilot/model-picker.tsx`

  ```tsx
  // BEFORE (lines 8-26):
  interface Props {
    selectedModelId?: string
    onChange: (modelId: string) => void
  }

  export function ModelPicker({ selectedModelId, onChange }: Props) {
    const t = useT()
    const [models, setModels] = useState<ModelConfig[]>([])
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
      fetch("/api/llm-config")
        .then(r => r.json())
        .then((cfg: LlmConfig) => {
          setModels((cfg.models ?? []).filter(m => m.copilot_enabled && m.base_url && m.api_key))
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    }, [])

  // AFTER:
  interface Props {
    selectedModelId?: string
    onChange: (modelId: string) => void
    /** When true, also require m.vision_capable. Set by chat-view based on circled contexts. */
    requireVision?: boolean
  }

  export function ModelPicker({ selectedModelId, onChange, requireVision }: Props) {
    const t = useT()
    const [models, setModels] = useState<ModelConfig[]>([])
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
      fetch("/api/llm-config")
        .then(r => r.json())
        .then((cfg: LlmConfig) => {
          // Always require base_url + api_key + copilot_enabled. requireVision adds vision_capable.
          setModels((cfg.models ?? []).filter(m =>
            m.copilot_enabled && m.base_url && m.api_key
          ))
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    }, [])

    // Apply vision filter at render time so dropdown shrinks/grows live with circled contexts.
    const visibleModels = requireVision
      ? models.filter(m => m.vision_capable)
      : models
    const selectedModelStillVisible = !!visibleModels.find(m => m.id === selectedModelId)
    const showVisionWarn = requireVision && !!selectedModelId && !selectedModelStillVisible
  ```

  Then update the empty-state render to use `visibleModels` and the trigger / list to show warning + filtered models. Replace lines 32-64 of the BEFORE file:

  ```tsx
  // BEFORE (lines 32-64):
    if (models.length === 0) {
      return (
        <div className="text-[11px] text-muted-foreground leading-snug">
          {t("copilot.no_model_hint")}{" "}
          <a href="/settings/llm" className="underline hover:text-foreground">{t("copilot.go_settings_llm")}</a>
        </div>
      )
    }

    // base-ui Select.Value 在这个项目里对 select item 的 render label 识别不稳定（会只显示 raw value=model id 而不是 name），
    // 干脆绕开 SelectValue，直接在 trigger 里渲染当前选中模型的显示文本。
    const selected = models.find(m => m.id === selectedModelId)
    const display = selected
      ? (selected.name || selected.model)
      : t("copilot.model_picker_placeholder")

    return (
      <Select
        value={selectedModelId ?? ""}
        onValueChange={v => { if (v) onChange(v) }}
      >
        <SelectTrigger className="h-7 text-[12px] max-w-full">
          <span className="truncate text-left">{display}</span>
        </SelectTrigger>
        <SelectContent>
          {models.map(m => (
            <SelectItem key={m.id} value={m.id} className="text-[12px]">
              {m.name || m.model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // AFTER:
    if (visibleModels.length === 0) {
      return (
        <div className="text-[11px] text-muted-foreground leading-snug">
          {requireVision
            ? t("copilot.model_picker_vision_required")
            : t("copilot.no_model_hint")}{" "}
          <a href="/settings/llm" className="underline hover:text-foreground">{t("copilot.go_settings_llm")}</a>
        </div>
      )
    }

    // base-ui Select.Value 在这个项目里对 select item 的 render label 识别不稳定（会只显示 raw value=model id 而不是 name），
    // 干脆绕开 SelectValue，直接在 trigger 里渲染当前选中模型的显示文本。
    const selected = visibleModels.find(m => m.id === selectedModelId)
    const display = selected
      ? (selected.name || selected.model)
      : t("copilot.model_picker_placeholder")

    return (
      <div className="flex flex-col gap-1">
        <Select
          value={selectedModelId ?? ""}
          onValueChange={v => { if (v) onChange(v) }}
        >
          <SelectTrigger className="h-7 text-[12px] max-w-full">
            <span className="truncate text-left">{display}</span>
          </SelectTrigger>
          <SelectContent>
            {visibleModels.map(m => (
              <SelectItem key={m.id} value={m.id} className="text-[12px]">
                {m.name || m.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showVisionWarn && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
            {t("copilot.model_picker_vision_required")}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Modify `src/components/copilot/chat-view.tsx` to compute `imageContextCount`**

  File: `/Users/lijiakun/Documents/evalyst/src/components/copilot/chat-view.tsx`

  Add the computed value right above the canSend line (around line 79). The existing `contexts` is already destructured from `useCopilotStore()` on line 28:

  ```tsx
  // BEFORE (line 79, just before "const canSend"):
    const canSend = !!input.trim() && !stream.sending && !!sessionId && !!modelId

  // AFTER:
    // 含图 context 计数 — 用于 ModelPicker 过滤掉非 vision 模型。
    // 保守口径：task_result / task_field 默认按潜在含图记，无服务端 roundtrip。
    // 其他类型（text_selection / page / experiment / template / dataset / display / rubric / rubric_stats）不计。
    const imageContextCount = contexts.reduce((n, c) => {
      if (c.type === 'task_result' || c.type === 'task_field') return n + 1
      if ((c.extra as { field_type?: string } | undefined)?.field_type === 'image_url') return n + 1
      return n
    }, 0)

    const canSend = !!input.trim() && !stream.sending && !!sessionId && !!modelId
  ```

  Then update the ModelPicker invocation (around line 222):

  ```tsx
  // BEFORE (line 222):
              <ModelPicker selectedModelId={modelId} onChange={onPickModel} />

  // AFTER:
              <ModelPicker
                selectedModelId={modelId}
                onChange={onPickModel}
                requireVision={imageContextCount > 0}
              />
  ```

- [ ] **Step 3: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. `requireVision?: boolean` is optional so callsites without it (none expected outside chat-view) keep working.

- [ ] **Step 4: Manual verification in dev server**

  Run: `npm run dev`

  Sub-steps:
  1. Ensure `/settings/llm` has at least one `vision_capable=true` model AND one `vision_capable=false` model (both `copilot_enabled=true`)
  2. Open `image_gen_v1` experiment detail page; press `⌘K`
  3. With NO contexts circled — picker dropdown should show BOTH models
  4. Circle one image task_result → picker should immediately drop the non-vision model from the dropdown
  5. If the currently selected model is the non-vision one: warning text "含图 context 需要支持视觉的模型" / "Vision-capable model required for image contexts" appears below picker; selection is NOT auto-cleared
  6. Switch to vision model → warning disappears
  7. Remove the circled context (× on chip) → both models reappear

  Expected: dropdown filters live with contexts; warning appears only when current selection is invalid post-filter.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/copilot/model-picker.tsx src/components/copilot/chat-view.tsx
  git commit -m "$(cat <<'EOF'
  feat(copilot): filter ModelPicker to vision_capable when image contexts present

  Adds requireVision prop to ModelPicker; chat-view computes imageContextCount
  conservatively (task_result + task_field counted as potentially image-bearing
  + any context with extra.field_type='image_url') and passes requireVision when
  > 0. Selection is not auto-cleared on filter; instead a small amber warning
  surfaces under the picker until the user picks a vision-capable model. Layer 1
  of 3-layer vision defense (build-llm-messages strips images for non-vision in
  Task 11 as final fallback).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 18: context-chip-rail renders image thumbnail in expanded detail

**Files:**
- Modify: `src/components/copilot/context-chip-rail.tsx`

**Constraints:**
- Expanded chip body already shows `<pre>` of `detail.data` (lines 237-242 in the non-text branch); ADD (not replace) a thumbnail block after the `<pre>` and before the metadata block
- Thumbnail extraction: client-side scan via local helper `extractImageUrlsFromDetail(detail.data)` — walks object values, treats strings matching `/^(images\/|\/api\/results\/)/` OR starting with `data:` as image URLs. For `task_field` detail, also check `detail.data.targeted_value` (the field-targeted resolver shape).
- Path normalization: paths starting `images/` are unlikely to appear at chip level (server-side resolver already returns full `/api/results/...` URLs in v0.10.0+); but if they do, prepend `/api/results/{exp_id}/` using `ctx.extra.experiment_id`. Inline a tiny helper rather than reusing the `image-attach.ts` one (chip is client-only; that module imports server-side `@/lib/store`)
- Render with a local `ChipImageThumb` component (NOT the private `view-helpers.tsx::ClickableImage` — that one isn't exported and lives in a different module). The local one calls `useImageLightbox()` and renders a fixed-size `<img>` with `cursor-zoom-in`. Style: 120×120px, `object-contain`, rounded border
- Use `useT()` key `copilot.chip.image_preview_label` (added in Task 19) as the small section header
- Multiple images: render all (no cap at chip level — flex wrap, container scrolls if tall). De-dupe by exact URL string before rendering

**Tests:** No new tests (UI-only). Verification is manual.

**Steps:**

- [ ] **Step 1: Add `extractImageUrlsFromDetail` helper + `ChipImageThumb` component at bottom of file**

  File: `/Users/lijiakun/Documents/evalyst/src/components/copilot/context-chip-rail.tsx`

  Append BEFORE the closing of the file (after the `ContextChip` function ends, around line 263):

  ```tsx
  // ---------- chip-local image preview helpers ----------

  /** Walks any JSON-ish detail.data and extracts URLs that look like images. Loose. */
  function extractImageUrlsFromDetail(data: unknown, expId?: string): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const visit = (v: unknown) => {
      if (v == null) return
      if (typeof v === 'string') {
        const url = looksLikeImageUrl(v) ? normalizeChipImageUrl(v, expId) : null
        if (url && !seen.has(url)) { seen.add(url); out.push(url) }
        return
      }
      if (Array.isArray(v)) { v.forEach(visit); return }
      if (typeof v === 'object') {
        for (const inner of Object.values(v as Record<string, unknown>)) visit(inner)
      }
    }
    visit(data)
    // task_field shape — server resolver returns { targeted_value, ... }; visit covers it via the recursion
    return out
  }

  function looksLikeImageUrl(s: string): boolean {
    return s.startsWith('data:image/')
      || /^\/api\/results\/[^/]+\/images\//.test(s)
      || /^images\//.test(s)
      || /^https?:\/\/.*\.(png|jpe?g|webp|gif)(\?|$)/i.test(s)
  }

  function normalizeChipImageUrl(raw: string, expId?: string): string {
    if (raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('/api/')) return raw
    if (raw.startsWith('images/') && expId) return `/api/results/${expId}/${raw}`
    return raw
  }

  /** 120×120 thumbnail; click → ImageLightbox (mounted at root via ImageLightboxProvider). */
  function ChipImageThumb({ src, alt }: { src: string; alt: string }) {
    const { openLightbox } = useImageLightbox()
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        onClick={(e) => { e.stopPropagation(); openLightbox(src, alt) }}
        className="w-[120px] h-[120px] object-contain cursor-zoom-in rounded border bg-background/40"
      />
    )
  }
  ```

- [ ] **Step 2: Add the import for `useImageLightbox`**

  File: `/Users/lijiakun/Documents/evalyst/src/components/copilot/context-chip-rail.tsx`

  ```tsx
  // BEFORE (line 5):
  import { colorForTag } from "./context-mask"

  // AFTER:
  import { colorForTag } from "./context-mask"
  import { useImageLightbox } from "@/components/ui/image-lightbox"
  ```

- [ ] **Step 3: Inject thumbnail block in non-text expanded detail branch**

  File: `/Users/lijiakun/Documents/evalyst/src/components/copilot/context-chip-rail.tsx`

  Insert a new block after the `<pre>` and before the metadata block (around line 242, inside the non-text branch of the `detail && !loading` conditional):

  ```tsx
  // BEFORE (lines 236-254 — the non-text expanded branch):
            ) : (
              <>
                {detail.context_chain && detail.context_chain.length > 0 && (
                  <div className="text-muted-foreground">
                    {t("copilot.chip.within")}{" "}
                    {detail.context_chain.map((a, i) => (
                      <span key={`${a.type}:${a.id}:${i}`}>
                        {i > 0 && " / "}
                        <span className="text-foreground">{a.type}</span>
                        <span className="opacity-70">:{a.id}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.value_label")}</div>
                  <pre className="bg-background/60 p-1.5 rounded text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                    {detail.data !== undefined ? JSON.stringify(detail.data, null, 2) : "(empty)"}
                  </pre>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.metadata_label")}</div>

  // AFTER:
            ) : (
              <>
                {detail.context_chain && detail.context_chain.length > 0 && (
                  <div className="text-muted-foreground">
                    {t("copilot.chip.within")}{" "}
                    {detail.context_chain.map((a, i) => (
                      <span key={`${a.type}:${a.id}:${i}`}>
                        {i > 0 && " / "}
                        <span className="text-foreground">{a.type}</span>
                        <span className="opacity-70">:{a.id}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.value_label")}</div>
                  <pre className="bg-background/60 p-1.5 rounded text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                    {detail.data !== undefined ? JSON.stringify(detail.data, null, 2) : "(empty)"}
                  </pre>
                </div>
                {(() => {
                  const expId = (ctx.extra as { experiment_id?: string } | undefined)?.experiment_id
                  const urls = extractImageUrlsFromDetail(detail.data, expId)
                  if (urls.length === 0) return null
                  return (
                    <div>
                      <div className="text-muted-foreground mb-0.5">{t("copilot.chip.image_preview_label")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {urls.map((u, i) => (
                          <ChipImageThumb key={`${u}-${i}`} src={u} alt={`ctx_${ctx.tag}_img_${i}`} />
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div>
                  <div className="text-muted-foreground mb-0.5">{t("copilot.chip.metadata_label")}</div>
  ```

- [ ] **Step 4: Run typecheck**

  Run: `npx tsc --noEmit`

  Expected: clean exit. The new helpers are pure TS; `useImageLightbox()` returns a typed context value.

- [ ] **Step 5: Manual verification in dev server**

  Run: `npm run dev`

  Sub-steps:
  1. Open `image_gen_v1` experiment detail page; press `⌘K`
  2. Inspector → click an image-bearing task_result card → chip appears in rail
  3. Click chip to expand → underneath the JSON `<pre>` you should now see a row of 120×120 thumbnails matching the result's image fields
  4. Click a thumbnail → ImageLightbox dialog opens with the full image
  5. Repeat with a `task_field` chip (cell-level) on an image-typed field — should show 1 thumbnail
  6. Test with a non-image context (e.g. circle a text experiment's task_result): no thumbnail block should render at all
  7. Test on second experiment with multiple `image_url_list` images: all images render, wrap to multiple rows

  Expected: thumbnails appear when and only when the resolved detail contains image-shaped URLs; clicks open lightbox; no hydration / console errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/copilot/context-chip-rail.tsx
  git commit -m "$(cat <<'EOF'
  feat(copilot): render image thumbnails in expanded chip detail

  When a chip's resolved detail.data contains URLs that look like images
  (data:image/, /api/results/.../images/, .png|jpg|webp|gif on http(s), or
  the legacy 'images/' prefix), surface a row of 120×120 thumbnails below the
  JSON pre-block. Click → ImageLightbox (already mounted at root). Local
  ChipImageThumb component avoids importing the non-exported ClickableImage
  from view-helpers.tsx; useImageLightbox is the public surface.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 19: i18n keys (zh + en pair)

**Files:**
- Modify: `src/lib/i18n/zh.ts` (add 3 new keys; the 2 `settings.llm.vision_capable_*` keys are already added by Task 1)
- Modify: `src/lib/i18n/en.ts` (mirror the same 3 keys)

**Keys (added in this task — 3 only):**
- `copilot.model_picker_vision_required` — zh: "含图 context 需要支持视觉的模型" / en: "Vision-capable model required for image contexts"
- `copilot.image_dropped_warn` — zh: "{n} 张图未附（每轮上限 {cap}）" / en: "{n} image(s) not attached (per-turn cap is {cap})"
- `copilot.chip.image_preview_label` — zh: "图像预览" / en: "Image preview"

**Verified at start of this task (already in plan):**
- `settings.llm.vision_capable_label` and `settings.llm.vision_capable_desc` are added by Task 1's edit block (zh.ts inserted after `copilot_enabled_hint` line 1111 → 2 new lines; en.ts mirror after line 1112). If Task 1 has not yet been run when reaching Task 19, this task's typecheck step will fail — instruct the developer to run Task 1 first OR add those 2 keys here as well.

**Constraints:**
- `en.ts` has `Record<keyof typeof zh, string>` enforcement → `npx tsc --noEmit` fails with "Property '...' is missing in type" if asymmetric. This IS the test for Task 19.
- Use `{var}` interpolation syntax (matches existing `t("k", { n, cap })`)
- Insert in zh.ts after the existing `copilot.chip.anchor_full_value_hint` block (line 1022) for the chip key; the two flat `copilot.*` keys go after `copilot.go_settings_llm` (line 989). Mirror placement in en.ts.

**Tests:** No new vitest cases. The `tsc --noEmit` test in Step 4 is the symmetry guarantor.

**Steps:**

- [ ] **Step 1: Verify zh.ts current state shows where to insert**

  Run: `grep -n "copilot.go_settings_llm\|copilot.chip.anchor_full_value_hint" /Users/lijiakun/Documents/evalyst/src/lib/i18n/zh.ts`

  Expected output:
  ```
  989:  "copilot.go_settings_llm": "去 LLM 设置",
  1022:  "copilot.chip.anchor_full_value_hint": "完整字段值走 read_context(ctx_{tag}, scope='parent')",
  ```

  These two lines define the insertion points for the 3 new keys (2 flat copilot keys after line 989, 1 chip key after line 1022). Same offsets +2 for en.ts (line 991 / 1024).

- [ ] **Step 2: Modify `src/lib/i18n/zh.ts` — add 3 keys**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/i18n/zh.ts`

  ```ts
  // BEFORE (around line 988-989):
    "copilot.no_model_hint": "还没有模型被允许给 Copilot 使用。",
    "copilot.go_settings_llm": "去 LLM 设置",

  // AFTER:
    "copilot.no_model_hint": "还没有模型被允许给 Copilot 使用。",
    "copilot.go_settings_llm": "去 LLM 设置",
    "copilot.model_picker_vision_required": "含图 context 需要支持视觉的模型",
    "copilot.image_dropped_warn": "{n} 张图未附（每轮上限 {cap}）",
  ```

  Then add the chip key after `copilot.chip.anchor_full_value_hint`:

  ```ts
  // BEFORE (around line 1022):
    "copilot.chip.anchor_full_value_hint": "完整字段值走 read_context(ctx_{tag}, scope='parent')",

  // AFTER:
    "copilot.chip.anchor_full_value_hint": "完整字段值走 read_context(ctx_{tag}, scope='parent')",
    "copilot.chip.image_preview_label": "图像预览",
  ```

- [ ] **Step 3: Modify `src/lib/i18n/en.ts` — mirror same 3 keys**

  File: `/Users/lijiakun/Documents/evalyst/src/lib/i18n/en.ts`

  ```ts
  // BEFORE (around line 990-991):
    "copilot.no_model_hint": "No model is enabled for Copilot yet.",
    "copilot.go_settings_llm": "Go to LLM settings",

  // AFTER:
    "copilot.no_model_hint": "No model is enabled for Copilot yet.",
    "copilot.go_settings_llm": "Go to LLM settings",
    "copilot.model_picker_vision_required": "Vision-capable model required for image contexts",
    "copilot.image_dropped_warn": "{n} image(s) not attached (per-turn cap is {cap})",
  ```

  Then add the chip key after `copilot.chip.anchor_full_value_hint`:

  ```ts
  // BEFORE (around line 1024):
    "copilot.chip.anchor_full_value_hint": "full field value via read_context(ctx_{tag}, scope='parent')",

  // AFTER:
    "copilot.chip.anchor_full_value_hint": "full field value via read_context(ctx_{tag}, scope='parent')",
    "copilot.chip.image_preview_label": "Image preview",
  ```

- [ ] **Step 4: Run typecheck (this IS the test)**

  Run: `npx tsc --noEmit`

  Expected: clean exit. If asymmetric (zh has key but en doesn't, or vice versa), tsc errors with:
  ```
  Property 'copilot.chip.image_preview_label' is missing in type ...
  ```

  Also implicitly validates that all consumer call sites — `t("copilot.model_picker_vision_required")` (Task 17), `t("copilot.chip.image_preview_label")` (Task 18) — are spelled correctly.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
  git commit -m "$(cat <<'EOF'
  feat(i18n): add copilot vision keys (model_picker_vision_required, image_dropped_warn, chip.image_preview_label)

  Three new keys consumed by ModelPicker (Task 17) and context-chip-rail
  (Task 18). en.ts Record<keyof typeof zh, string> enforces symmetry —
  tsc --noEmit is the test. (settings.llm.vision_capable_label/_desc are
  already added by Task 1.)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6: (Optional) Re-run unit suite to confirm no regressions**

  Run: `npm test`

  Expected: existing 221+ tests still green. (No new tests added in this task; symmetry is enforced at typecheck time.)

---

### Task 20: Final integration smoke + CHANGELOG entry + PR

**Files:**
- Modify: `CHANGELOG.md` (append a new sub-entry under existing `[Unreleased]` block)
- Branch: push `feat/copilot-image-vision` and open PR via `gh`

**Constraints:**
- `npm run test:e2e` may need `npx playwright install chromium` first time on this machine
- PR title: `feat(copilot): image vision — let Copilot see circled task_result images`
- PR body: 4 sections — 改了什么 / 为什么 / 怎么验证 / 向后兼容风险
- Don't tag yet — CLAUDE.md "实测一两天再 tag" rule. Polish belongs to `[Unreleased]` until stable.
- `gh pr create` doesn't inherit git proxy config; per memory `reference_git_proxy`, run with `HTTPS_PROXY=127.0.0.1:7890` env prefix (ClashX)
- The existing `[Unreleased]` block already has a "生图（Image Generation）评测 v1 完备支持" entry from v0.10.0; the Copilot × Image Vision entry is a SEPARATE bullet under a new `### Copilot × Image Vision` sub-header (or just a new top-level body bullet — match style of existing entry)

**Steps:**

- [ ] **Step 1: Run all 4 verification gates**

  Run (sequentially; stop on first failure):

  ```bash
  npx tsc --noEmit && npm test && npm run build && npm run test:e2e
  ```

  Expected:
  - `tsc`: clean exit
  - `npm test`: 221+ existing + ~40 new tests (collectImageRefs / readImageBytes / build-llm-messages.image / hooks.attachments-lift / read-context.image / read-experiment-results.image / llm-stream.anthropic-data-url / llm-client.anthropic-data-url / llm-config.migrate vision_capable cases) — all green, ~250ms total
  - `npm run build`: Next.js build succeeds, no warnings about missing exports
  - `npm run test:e2e`: 9 existing Playwright cases green (sidebar / routes / `/api/skills`)

  If `test:e2e` errors with "browser not installed", run once:
  ```bash
  npx playwright install chromium
  ```
  then re-run.

- [ ] **Step 2: Manual checklist (spec §5.3 — 11 items)**

  Walk through each item in the dev server. Check off as you go:

  - [ ] `/settings/llm` 加一个 `vision_capable=true` 的模型（如 sankuai 网关的 Claude-Sonnet）
  - [ ] 跑一发 `image_gen_v1` 实验，确认 v0.10.0 链路仍 ok
  - [ ] 实验详情页：圈选 1 张图 result → 打开 Copilot → 模型选择器只显示 vision_capable 模型 → 提问"为什么这张图主体偏左？" → LLM 回答应基于图像内容（非"我看不到图"套话）
  - [ ] 圈 2 张图 → "对比 #1 和 #2 哪张更清晰" → LLM 应对应 ctx_1/ctx_2 给出图像级别评论
  - [ ] 圈实验整体 → "这一批图整体偏暗吗？" → LLM 调 `read_experiment_results` → 应收到 _attachments 含 5 张图（cap）→ 给出整体评估
  - [ ] 圈 6 张图 result → 应见 chip 警告"1 image not attached (cap 5)"（来自 `copilot.image_dropped_warn` Task 19 key）
  - [ ] 选非 vision 模型 + 试圈图 → 模型选择器应剔除该模型；强行 contexts 注入（dev tools 模拟）→ build-llm-messages 兜底 strip + system note
  - [ ] 删图后再问 → "Image unavailable: ... — ENOENT" 占位文本可见
  - [ ] Anthropic provider（claude-sonnet）+ data URL → 序列化为 source.type=base64；HTTP URL（远程）若有 → source.type=url
  - [ ] OpenAI provider + image_url block → 透传 work
  - [ ] Chip rail 展开 → 含图 detail 渲染 120px 缩略图；点击 → ImageLightbox

  If any item fails, file a fix as a NEW commit on this branch — don't proceed to PR.

- [ ] **Step 3: Write CHANGELOG entry**

  File: `/Users/lijiakun/Documents/evalyst/CHANGELOG.md`

  Append the following block at the end of the existing `## [Unreleased]` section (after the last `- Plan:` line of the v0.10.0 image-gen entry, around line 32, BEFORE the next `## [0.9.4]` header):

  ```md
  ### Copilot × Image Vision

  - **Copilot 现在能看见生图实验的图片** —— 圈选含 image_url / image_url_list
    字段的 task_result 或单独 task_field cell，最多 5 张图（dedupe by URL）以
    base64 内联到该轮 LLM 请求里；`read_experiment_results` / `read_context` /
    `read_resource` 等读工具的输出附带 `_attachments` ImageRef[]，
    payloadGuardHook 提到 wrapper 级 `attachments`，build-llm-messages 在
    user 与 tool_result message 上同步重写为 multimodal 块。SystemHeader 保持
    ref-only 不变（v2 progressive disclosure 不破坏）。

  ### 架构

  - 单点改造：`build-llm-messages.ts` 一处 await + 一处 multimodal rewrite，
    其余链路（stream-response / tool-runtime / system-header）只跟着 await
    一下，无新概念
  - 新文件：`src/lib/copilot/image-attach.ts` —— `collectImageRefs`（schema-aware
    + heuristic + dedup + cap=5）+ `readImageBytes`（fs.readFile + base64 + path
    traversal 防御）+ `extractImageRefsFromOutput`（tool 复用助手）
  - Anthropic 序列化器修复：`source.type='url'` 不接 `data:` URL；新
    `imageBlockForAnthropic` helper 检测 data URL → `source.type='base64'`
    + parsed media_type，HTTP URL 走 `source.type='url'`。`llm-client.ts`
    与 `llm-stream.ts` 两条路径均覆盖
  - 3 层 vision 防御：(1) `model-picker.requireVision` 隐藏非 vision 模型；
    (2) chat route 校验 selected model；(3) `build-llm-messages` 兜底 strip
    images + system note —— 任何一层失守不会让非 vision 模型收到图块
  - `ModelConfig.vision_capable?: boolean` 加到 LLM 配置；UI 一行 checkbox；
    旧 config 默认 undefined（≈ false）
  - 写工具默认不参与 micro-compact（保留完整执行痕迹），读工具 `_attachments`
    跟着 ref 落盘 + read_tool_result 回捞均正确

  ### 测试

  - 新增 ~6 组 vitest（image-attach × 2、build-llm-messages.image、
    llm-stream.anthropic-data-url、hooks.attachments-lift、read-context.image
    / read-experiment-results.image），约 40 case
  - 现有 221 case 全绿；`tsc --noEmit` / `build` / e2e smoke 均通过
  - 手动跑通 spec §5.3 的 11 项 checklist（含 sankuai claude-sonnet 实跑、
    OpenAI image_url 透传、删图占位、6 张图溢出告警）

  - Spec: `docs/superpowers/specs/2026-05-09-copilot-image-vision-design.md`
  - Plan: `docs/superpowers/plans/2026-05-09-copilot-image-vision.md`
  ```

- [ ] **Step 4: Commit CHANGELOG**

  ```bash
  git add CHANGELOG.md
  git commit -m "$(cat <<'EOF'
  docs(changelog): copilot image vision entry under [Unreleased]

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 5: Push branch + open PR**

  ```bash
  git push -u origin feat/copilot-image-vision
  ```

  Then (proxy needed because `gh` does not inherit git proxy config):

  ```bash
  HTTPS_PROXY=127.0.0.1:7890 gh pr create --title "feat(copilot): image vision — let Copilot see circled task_result images" --body "$(cat <<'EOF'
  ## 改了什么

  让 Evalyst Copilot 在用户圈选含图 task_result / task_field 时，把图片以
  base64 内联到 LLM 请求里，开启视觉驱动的 prompt 迭代闭环（"为什么这张图主
  体偏左"、"对比 #1 和 #2 哪张更清晰"、"这批图整体偏暗吗"）。

  - 新文件 `src/lib/copilot/image-attach.ts`：collectImageRefs / readImageBytes
    / extractImageRefsFromOutput（schema-aware + heuristic + dedup + cap N=5）
  - `build-llm-messages.ts` 多模态改造：scan last user + in-window tool_result
    `_attachments` → fs.readFile → base64 → 拼 multimodal 块
  - Anthropic 序列化器修复：`imageBlockForAnthropic` 检测 data URL → source.
    type=base64 + parsed media_type；HTTP URL 走 source.type=url。`llm-client.
    ts` + `llm-stream.ts` 两条路径都覆盖
  - 3 层 vision 防御：model-picker.requireVision 过滤 → chat route 校验 →
    build-llm-messages 兜底 strip + system note
  - 工具改造：read_experiment_results / read_context / read_resource 输出
    `_attachments`；payloadGuardHook 提升至 wrapper 级 `attachments` 并从内层
    value strip；ref-kind tool_result 落盘后图能在重放里继续被 build-llm-
    messages 重新内联（global URL dedup 抑制双计）
  - `ModelConfig.vision_capable?: boolean` + `/settings/llm` checkbox + 4 个新
    i18n key + chip rail 含图缩略图（120px）+ ImageLightbox 接管点击

  ## 为什么

  v0.10.0 让 Evalyst 能跑生图评测，但 Copilot 不能"看到"那批图 —— 用户问
  "为什么这张图主体偏左"会被 LLM "我没看到图片"挡回，被迫复制图链接到 Claude
  Code 网页另开窗口。这条 PR 把视觉评测闭环接上：圈 → Copilot 立刻看到 →
  自然语言反馈 → 编辑 prompt template / 重跑实验。

  ## 怎么验证

  本地跑 `npx tsc --noEmit && npm test && npm run build && npm run test:e2e`
  全绿。手动走 spec §5.3 的 11 项 checklist：

  - [ ] sankuai claude-sonnet (vision_capable=true) 实跑 image_gen_v1：圈 1
    张图 + 提问 "主体偏左原因" → LLM 给出图像级别回答
  - [ ] 圈 2 张图 → 对比回答按 ctx_1/ctx_2 锚定
  - [ ] 圈实验整体 → tool 调用 → _attachments 5 张 → 整体评估
  - [ ] 圈 6 张图 → chip 警告 "1 image not attached (cap 5)"
  - [ ] 选非 vision 模型 + 试圈图 → 模型选择器剔除 + warning + 兜底 strip
  - [ ] 删图后再问 → "Image unavailable: ENOENT" 占位文本
  - [ ] Anthropic data URL → source.type=base64 / OpenAI image_url 透传
  - [ ] Chip 展开 → 120px 缩略图 + 点击 ImageLightbox

  ## 向后兼容风险

  - **数据**：`ModelConfig.vision_capable` 默认 undefined（≈ false），旧配置
    round-trip 不写入新字段；`ToolResultContent.attachments` 为 optional，旧
    会话的 jsonl 不会被破坏
  - **API**：`build-llm-messages` 由 sync 转 async，stream-response 已跟着
    await；外部无 import 该函数
  - **UI**：ModelPicker 多了 `requireVision?` optional prop；现有调用点不传
    时行为不变。Chat-view 的 imageContextCount 是新增计算，不影响发送链路
  - **性能**：非含图实验跑 chat 走 collectImageRefs 短路（modelVisionCapable
    false 或 contexts 都不是图）→ 零 fs.readFile 调用，无回归
  - **不打 tag**：依 CLAUDE.md "实测一两天再 tag"，等 PR merge 后观察 1-2 天
    没需要调的，再打 v0.10.x 或 v0.11.0

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

  Expected: PR URL printed; the URL is what to share back to the user.

- [ ] **Step 6: Post-PR — wait for CI, monitor**

  Run:
  ```bash
  HTTPS_PROXY=127.0.0.1:7890 gh pr checks --watch
  ```

  Both CI jobs should go green:
  - `verify` (tsc → lint continue-on-error → test → build)
  - `e2e` (Playwright smoke)

  If a check fails, read the log via `gh run view <id> --log-failed`, fix on this branch, push, and the watch will rerun.

  Do NOT auto-merge. Do NOT tag yet — handoff to user for merge decision per CLAUDE.md "实测一两天再 tag" rule.

---

## Self-review checklist (final pass)

- [x] All 5 open questions in spec §9 are resolved at a specific task — Q1 (Task 0), Q2 (Task 5), Q3 (Task 12 wrapper-attach), Q4 (Task 17), Q5 (Task 1)
- [x] Each task has ≥3 TDD steps with actual code blocks (test → impl → verify → commit). UI-only tasks 16-18 substitute manual-verification steps for failing-test/run-fail (consistent with project "only test pure functions" rule).
- [x] No "TBD"/"TODO"/"add appropriate error handling" placeholders — verified by `grep -c "SUBAGENT FILLS\|TBD\|TODO\|implement later"` returning 0.
- [x] All file paths absolute and correct (verified during subagent runs by Read tool before each edit)
- [x] Each commit message follows conventional commit format with `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer in HEREDOC
- [x] Type names consistent across tasks: `ImageRef` (not `ImageReference`), `MAX_IMAGES_PER_TURN` (not `IMAGE_CAP`), `attachments` (wrapper-level, no underscore) vs `_attachments` (value-level, underscore — emit-only at tool boundary)
- [x] Layer ordering supports green-bar TDD: Layer 1 (Tasks 0-4) self-contained; Layer 2 (5-7) depends on Task 2 type only; Layer 3 (8-11) depends on Layer 2; Layer 4 (12-15) depends on Layer 2 + Task 2 type; Layer 5 (16-20) only Task 1 (vision_capable) is a hard cross-layer dep, otherwise UI is independent.
- [x] Spec §5.3 verification checklist mapped to Task 20 manual steps (all 11 items pasted verbatim with checkbox)

---

## Estimated scope

- 21 tasks (incl. Task 0 probe)
- ~6 new test files (~150 LOC test code)
- ~13 modified files (mechanical changes mostly)
- ~4 new files (image-attach.ts + 3 new tests + 0 components)
- Per-task: 5-15 min implementation, 2-5 min review = ~6-8 hours total focused time
- Manual validation (Task 20): ~1 hour
