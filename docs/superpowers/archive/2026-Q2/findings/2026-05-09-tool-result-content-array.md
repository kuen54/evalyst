# Finding: sankuai gateway tool-result content array compatibility

Date: 2026-05-09
Probe script: `/tmp/probe-tool-result-array.sh` (see plan Task 0 Step 1; not committed)
Endpoint tested: `https://aigc.sankuai.com/v1/openai/native/chat/completions`
Note: plan's example URL contained an extra `/v1` segment; the correct path appended after the project's `base_url` is just `/chat/completions`. Confirmed against `src/lib/llm-client.ts:124`.

## Observed responses

Multiple model attempts on the same OpenAI-compat endpoint (single sankuai token, App 2037, originally provisioned for `gemini-3.1-pro-preview`):

### 1. Primary probe (image_url in tool content) — `gemini-3.1-pro-preview`

- HTTP status: **400 Bad Request**
- Body excerpt:
  ```json
  [{
    "error": {
      "code": 400,
      "message": "An 'image_url' 'content' object element is unsupported for a(n) 'tool' message.",
      "status": "INVALID_ARGUMENT"
    }
  }]
  ```

### 2. Control probe (text-only array in tool content) — `gemini-3.1-pro-preview`

Same payload shape but with the tool message content set to `[{"type":"text","text":"..."}]` (no `image_url` element).

- HTTP status: **400 Bad Request**
- Body excerpt:
  ```json
  [{
    "error": {
      "code": 400,
      "message": "Unable to submit request because function call `default_api:fetch_image` in the 2. content block is missing a `thought_signature`. ...",
      "status": "INVALID_ARGUMENT"
    }
  }]
  ```
- Interpretation: control got past content-shape validation and failed on a Google-specific `thought_signature` requirement for synthetic tool_calls — i.e. the gateway accepts a content array of text parts in the `tool` role; it specifically rejects the `image_url` part type there.

### 3. Claude attempts — could not exercise

- `anthropic.claude-sonnet-4` → **400** `{"error":{"message":"配置不存在","type":"invalid_request_error"}}` (model id not provisioned for App 2037)
- `aws.claude-sonnet-4.5` → **429** `App:**2037在模型:aws.claude-sonnet-4.5每分钟请求次数超过限制` (rate limited; persistent across multiple cooldowns up to 3 min — the App has effectively zero Claude quota)
- `aws.claude-opus-4.6` → **429** same pattern
- The opus token from the project's anthropic-format model (`Bearer 2031627947983`) returned **401** `无效的AppId: 2031627947983` against the OpenAI-compat endpoint — that token is bound to the Anthropic-native gateway only.

We were therefore unable to reach a real Claude model through sankuai's OpenAI-compat path with the credentials available in `data/llm-config.json`. Decision below is based on the Gemini result, which **is** the relevant test for the OpenAI-format code path in `llm-client.ts` — the same serializer is used regardless of the underlying provider.

## Verdict

**Branch B**: sankuai's OpenAI-compat `/chat/completions` endpoint rejects `image_url` content parts in messages with `role: "tool"`. The error message ("An 'image_url' 'content' object element is unsupported for a(n) 'tool' message") is the exact family the plan's decision tree maps to Branch B. The control probe confirms the gateway *does* accept content arrays in the tool role for text-only parts, so the rejection is specifically about multimodal-on-tool, not about array-vs-string.

We treat this as a hard signal for the OpenAI-format path. Even if some Claude variant would accept it, defaulting to the conservative shape is safe (Branch B works everywhere); attempting Branch A blind would break Gemini fan-out on this gateway.

## Decision impact on plan

- **Task 4** — OpenAI-format serializer (`llm-client.ts` and `llm-stream.ts`): keep `LlmMessage.tool_result.content` as a string in the OpenAI-format wire payload. Concatenate any text parts; do NOT emit `image_url` items in the `tool` message. Internal `LlmMessage` type may still hold a content union for downstream rewriting, but the OpenAI serializer collapses to string at wire time.
- **Task 10** — Multimodal rewrite for tool_result: emit a text-only `tool` message (e.g. "Tool returned image attachments — see next user turn") followed by an additional synthesized `user` message that carries the actual `image_url` blocks (and a brief textual lead-in like "Here are the images from the previous tool result:"). This satisfies vision models without violating gateway validation.
- **Anthropic serializer (Task 4)**: unaffected by branch. Anthropic protocol always supports `tool_result` content arrays with `image` blocks per its public docs, so the Anthropic path can deliver images directly inside the `tool_result` content as designed.
- Follow-up (out of scope for this finding): if/when sankuai (or our chosen Claude OpenAI-compat provider) starts accepting `image_url` in tool messages, we can add an opt-in flag on `ModelConfig` to switch the OpenAI-format path back to Branch A; the inline structure is still represented internally and only collapsed at serialize time, so the upgrade path is small.
