# Audit Cleanup M1–M5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **When dispatching subagents, ALWAYS pass `model: "opus"` to the Agent tool** — audit cleanup requires careful judgment and race-fix preservation; the user has explicitly required opus 4.7 (1M).

**Goal:** 清掉 9 条 audit finding（必须 3 + 值得 6），不改业务行为，按 5 个 milestone 分 5 个 PR 合并。

**Architecture:** 每个 M 独立 feature branch + 独立 PR。commit 粒度"一个 finding 一个 commit"。每步 TDD：先测（能测的场景）→ 改代码 → 跑测试 → commit。M3 / M4 / M5 依赖"手动回归 checklist"替代 hook/route unit test。

**Tech Stack:** Next.js 16 App Router · TypeScript · vitest（单测）· Playwright（e2e smoke）· shadcn/ui v4 · 现有 i18n 自建 provider

**Spec:** `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md`

---

## 跨 Milestone 约定（每个 task 都走）

1. **从最新 main 切分支**：每个 M 独立分支；**不要**在上一个 M 的分支上接着跑
2. **subagent dispatch 必须传 `model: "opus"`**
3. **每个 task 做完立刻跑** `npx tsc --noEmit && npm test`
4. **不跨 scope**：每个 M 只做自己的 finding
5. **commit 格式** `<type>(<scope>): <subject>`，body 简短解释 why，尾部带 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
6. **PR description 必含 4 段**：改了什么 / 为什么 / 怎么验证 / 向后兼容风险
7. **PR 合并策略** merge commit（不 squash）；**不自动 merge**（等用户 review）；**不自动 tag**

---

# M1 · 约定对齐 + 用户坑修补（F1 + F2 + F3 + F7 + F9）

**Branch:** `refactor/audit-cleanup-convention`

### Task M1.0: 创建分支 + 验证起点

**Files:**
- None (git ops)

- [ ] **Step 1: Ensure on main, up to date, clean**

Run:
```bash
git checkout main && git pull origin main --ff-only && git status --short
```

Expected:
- `Your branch is up to date with 'origin/main'.`
- No uncommitted changes.

- [ ] **Step 2: Create branch**

```bash
git checkout -b refactor/audit-cleanup-convention
```

- [ ] **Step 3: Baseline check**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected:
- tsc: no output (no errors)
- vitest: `Test Files  N passed` with ~217 tests

Record the baseline test count for comparison after each commit.

---

### Task M1.1: F1 — 7 个 fs 模块改惰性 cwd

**Files:**
- Modify: `src/lib/store.ts:9` (3 consts → 3 functions)
- Modify: `src/lib/rubric-store.ts:9`
- Modify: `src/lib/seed.ts:9-12` (4 consts → 4 functions)
- Modify: `src/lib/displays.ts:13`
- Modify: `src/lib/schema/user-schema-store.ts:8`
- Modify: `src/lib/datasets.ts:11`

- [ ] **Step 1: grep all 引用点 before 动手**

```bash
grep -rn "DATA_DIR\|EXPERIMENTS_DIR\|RESULTS_DIR\|RUBRICS_DIR\|SEEDS_DIR\|DATASETS_DIR\|SCHEMAS_DIR\|DISPLAYS_DIR" src/ --include="*.ts" --include="*.tsx"
```

Expected: 列表大致显示每个 const 只在自己的文件内用（没有跨文件 import）—— 因为这些是私有 const，不 export。记下结果备用。

- [ ] **Step 2: 改 `src/lib/store.ts`**

Read 现有 L9-11:
```ts
const DATA_DIR = path.join(process.cwd(), 'data')
const EXPERIMENTS_DIR = path.join(DATA_DIR, 'experiments')
const RESULTS_DIR = path.join(DATA_DIR, 'results')
```

Replace with:
```ts
// 惰性解析：每次调用都按当前 process.cwd() 重新计算，便于测试 chdir。
// 生产 cwd 固定，无副作用。对齐 llm-config.ts / annotation-store.ts 约定。
function dataDir() { return path.join(process.cwd(), 'data') }
function experimentsDir() { return path.join(dataDir(), 'experiments') }
function resultsDir() { return path.join(dataDir(), 'results') }
```

然后在文件内所有 `DATA_DIR` → `dataDir()`，`EXPERIMENTS_DIR` → `experimentsDir()`，`RESULTS_DIR` → `resultsDir()`。

- [ ] **Step 3: 改 `src/lib/rubric-store.ts`**

`const RUBRICS_DIR = path.join(process.cwd(), 'data', 'rubrics')` →
```ts
function rubricsDir() { return path.join(process.cwd(), 'data', 'rubrics') }
```

全文件 `RUBRICS_DIR` → `rubricsDir()`.

- [ ] **Step 4: 改 `src/lib/seed.ts`**

4 个 const 改成 4 个 function。调用点同步更新。不抽 shared helper。

- [ ] **Step 5: 改 `src/lib/displays.ts`**

`const DISPLAYS_DIR = path.join(process.cwd(), 'data', 'displays')` →
```ts
function displaysDir() { return path.join(process.cwd(), 'data', 'displays') }
```

- [ ] **Step 6: 改 `src/lib/schema/user-schema-store.ts`**

`const SCHEMAS_DIR = path.join(process.cwd(), 'data', 'schemas')` →
```ts
function schemasDir() { return path.join(process.cwd(), 'data', 'schemas') }
```

- [ ] **Step 7: 改 `src/lib/datasets.ts`**

`const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets')` →
```ts
function datasetsDir() { return path.join(process.cwd(), 'data', 'datasets') }
```

- [ ] **Step 8: 验证 tsc + test**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected:
- tsc: no errors
- vitest: same baseline count (should still be ~217), all green

- [ ] **Step 9: 二次 grep 确认 0 残留顶层 const**

```bash
grep -rn "^const\s\+[A-Z_]\+\s*=\s*path\.join(process\.cwd" src/
```

Expected: empty output.

- [ ] **Step 10: Commit**

```bash
git add src/lib/store.ts src/lib/rubric-store.ts src/lib/seed.ts \
        src/lib/displays.ts src/lib/schema/user-schema-store.ts src/lib/datasets.ts
git commit -m "$(cat <<'EOF'
refactor(fs): lazy-resolve cwd in 7 storage modules

AGENTS.md §测试约定明确写了 "涉及 fs 的模块要惰性解析 process.cwd()"，
llm-config.ts / annotation-store.ts / copilot/session-store.ts 都正确惰性化
了，这 7 个文件当初漏掉。生产 cwd 不变无功能影响，但给这些模块加 migrate
test / integration test 时 chdir 会失效。

对齐现有正确范例的写法（function xDir() { return path.join(process.cwd(), ...) }）
而不是 lazy getter / defineProperty，最小惊讶。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M1.2: F2 — `context-mask.tsx` 硬编 "移除" 走 i18n

**Files:**
- Modify: `src/lib/i18n/zh.ts` (加 key)
- Modify: `src/lib/i18n/en.ts` (加 key)
- Modify: `src/components/copilot/context-mask.tsx:149-150`

- [ ] **Step 1: Read `src/lib/i18n/zh.ts`，找到 copilot 命名空间**

```bash
grep -n "^\s*\"copilot\\.context" src/lib/i18n/zh.ts | head -20
```

- [ ] **Step 2: 加 key 到 `zh.ts`**

在 `copilot.context_*` 附近（字母序附近或功能相近处）加：
```ts
"copilot.context_remove_title": "移除",
```

- [ ] **Step 3: 加对应 key 到 `en.ts`**

```ts
"copilot.context_remove_title": "Remove",
```

- [ ] **Step 4: Read `src/components/copilot/context-mask.tsx`**

找到 L149-150（或接近，可能是 Remove button 的 title / aria-label）。当前形如：
```tsx
title="移除"
aria-label="移除"
```

改成：
```tsx
title={t("copilot.context_remove_title")}
aria-label={t("copilot.context_remove_title")}
```

若组件还没引 `useT`，在顶部加：
```ts
import { useT } from "@/lib/i18n/provider"
// ...
export function ContextMask() {
  const t = useT()
  // ...
```

（若已引则跳过）

- [ ] **Step 5: 验证 tsc**

```bash
npx tsc --noEmit
```

Expected: no errors. 若 `en.ts` 漏加 key 会报 `Record<keyof typeof zh, string>` missing property 错误。

- [ ] **Step 6: 验证 vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: 同 baseline，绿。

- [ ] **Step 7: Commit**

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts src/components/copilot/context-mask.tsx
git commit -m "$(cat <<'EOF'
i18n(copilot): localize context-mask remove button

硬编中文 "移除" 在 title / aria-label 里，英语用户看到中文；违反
AGENTS.md "所有新加的 UI 可见文案必须走 useT()" 约定。加
copilot.context_remove_title key 到 zh + en。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M1.3: F3 — 测试数字 doc drift

**Files:**
- Modify: `CLAUDE.md:13, 236` (两处)
- Modify: `README.md:410`

- [ ] **Step 1: 记录实际 test count**

```bash
npm test 2>&1 | grep -E "Test Files|Tests" | tail -3
```

Expected: 形如 `Test Files  XX passed (XX)` 和 `Tests       217 passed (217)`。记下数字 N。

- [ ] **Step 2: 改 `CLAUDE.md` L13**

```
- 测试：`vitest`（纯函数单测，110 case）+ `playwright`（E2E smoke，9 case）
```
→
```
- 测试：`vitest`（纯函数单测，N case）+ `playwright`（E2E smoke，9 case）
```

- [ ] **Step 3: 改 `CLAUDE.md` L236**

```
110 个 test case，~180ms 跑完。
```
→
```
N 个 test case，~180ms 跑完。
```

- [ ] **Step 4: 改 `README.md` L410**

```
有。`npm test` 跑一轮（vitest，110 case ~180ms），覆盖...
```
→
```
有。`npm test` 跑一轮（vitest，N case ~180ms），覆盖...
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "$(cat <<'EOF'
docs: update test count from 110 to <N>

CHANGELOG 0.5.7 已经 217 tests，CLAUDE.md 和 README 还停在 0.1.0 时的
110。外部读者看到数字对不上会怀疑项目是否持续维护。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

（把 `<N>` 替换成实际数字）

---

### Task M1.4: F7 — OpenAI Authorization 自动加 Bearer 前缀 + 单测

**Files:**
- Modify: `src/lib/llm-client.ts:118`
- Create: `src/lib/__tests__/llm-client.test.ts`
- Modify: `README.md` Q&A 关于 Authorization 的那一句

- [ ] **Step 1: Write the failing test first**

Create `src/lib/__tests__/llm-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApiRequest } from '@/lib/llm-client'

describe('buildApiRequest · Authorization Bearer 前缀', () => {
  it('OpenAI format: 裸 api_key 自动加 Bearer 前缀', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'sk-abc123' },
      { model: 'gpt-4o-mini' },
    )
    expect(req.headers.Authorization).toBe('Bearer sk-abc123')
  })

  it('OpenAI format: 已有 Bearer 前缀不重复加', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'Bearer sk-abc123' },
      { model: 'gpt-4o-mini' },
    )
    expect(req.headers.Authorization).toBe('Bearer sk-abc123')
  })

  it('Anthropic format: x-api-key 不走 Bearer 分支', () => {
    const req = buildApiRequest(
      { api_format: 'anthropic', base_url: 'https://api.anthropic.com/v1', api_key: 'sk-ant-abc' },
      { model: 'claude-haiku' },
    )
    expect(req.headers['x-api-key']).toBe('sk-ant-abc')
    expect(req.headers.Authorization).toBeUndefined()
  })

  it('OpenAI format: base_url 末尾 / 被剥掉', () => {
    const req = buildApiRequest(
      { api_format: 'openai', base_url: 'https://api.openai.com/v1/', api_key: 'sk-k' },
      { model: 'x' },
    )
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run llm-client.test 2>&1 | tail -10
```

Expected: 第一条 "裸 api_key 自动加 Bearer" FAIL（现状不加前缀）；第二条可能 PASS（startsWith 逻辑已隐含）；第 4 条 PASS；第 3 条 PASS。

- [ ] **Step 3: Fix `src/lib/llm-client.ts` L118**

Change:
```ts
'Authorization': config.api_key,
```
to:
```ts
// OpenAI 兼容 API 标准要求 "Authorization: Bearer <key>"。
// 用户如果填纯 "sk-..."，自动加前缀；已经带 "Bearer " 的原样保留（向后兼容
// 旧用户的 workaround 值）。对不要 Bearer 的 gateway 是破坏性变更 —— 见
// CHANGELOG 0.5.8 / 0.6.0 节；有需求再加 ModelConfig.auth_no_bearer_prefix。
'Authorization': config.api_key.startsWith('Bearer ') ? config.api_key : `Bearer ${config.api_key}`,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run llm-client.test 2>&1 | tail -10
```

Expected: 全部 PASS。

- [ ] **Step 5: Run full vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: total 从 N → N + 4（新增 4 case），全绿。

- [ ] **Step 6: 更新 `README.md` Q&A 关于 Authorization 的描述**

找到类似：
```
② OpenAI 兼容格式 Authorization 头直接是 key（不带 Bearer 的系统在 extra_body 自行处理）；
```

改成：
```
② OpenAI 兼容 API 会自动给 api_key 加 "Bearer " 前缀（你填裸 key 即可）。如果你的 gateway 明确要求不带 Bearer，在 issue 里反馈我们会补 ModelConfig 选项；
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm-client.ts src/lib/__tests__/llm-client.test.ts README.md
git commit -m "$(cat <<'EOF'
feat(llm-client): auto-prefix Bearer for openai Authorization header

标准 OpenAI API 要求 "Authorization: Bearer sk-..."，之前的代码直接把
api_key 塞 Authorization → 新用户填裸 sk-... 第一次 test 连接就 401。README
Q&A 的小字说明不容易看到，是外部用户首配置坑。

startsWith("Bearer ") 检测保留已有 workaround 值；Anthropic 的 x-api-key
分支不动。不要 Bearer 的 gateway 是破坏性候选——先观察，有需求再加
ModelConfig.auth_no_bearer_prefix。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M1.5: F9 — README 鉴权 footnote 刷新

**Files:**
- Modify: `README.md:314`

- [ ] **Step 1: Read + edit L314**

原文：
```
> **注意**：当前 API 无鉴权，适合本地开发。开源前会补 token 机制。
```

改成：
```
> **注意**：当前 API 无鉴权（适合本地 / 单机自用）。跨网暴露请自己在前面加反向代理 + basic auth / OAuth。原生鉴权不在路线图里，需求请开 issue 讨论。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): remove stale auth promise

项目已开源（badge 显示 public repo + CI + License），"开源前会补 token
机制" 的 footnote 是过期承诺。改成当前现状的准确描述。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M1.6: M1 全量验证 + push + PR

- [ ] **Step 1: 跑全部 checks**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build 2>&1 | tail -20
```

Expected: 全 pass（lint continue-on-error，允许 warning）。

- [ ] **Step 2: 跑 e2e smoke**（本地若已 install）

```bash
npm run test:e2e 2>&1 | tail -10
```

Expected: 9/9 pass。若 playwright 未装，跳过且在 PR description 注明"e2e 未本地跑，依赖 CI"。

- [ ] **Step 3: Push + 建 PR**

```bash
git push -u origin refactor/audit-cleanup-convention
gh pr create --title "refactor: audit cleanup M1 — convention alignment + user onboarding fixes" --body "$(cat <<'EOF'
## 改了什么

一个 PR 清掉 audit 报告中的 5 条 finding（3 必须 + 2 值得）：

- **F1** `refactor(fs)`: `src/lib/store.ts / rubric-store.ts / seed.ts / displays.ts / datasets.ts / schema/user-schema-store.ts` 的顶层 `const XXX_DIR = path.join(process.cwd(), ...)` → 惰性函数 `xxxDir()`。对齐 AGENTS.md §测试约定。
- **F2** `i18n(copilot)`: `context-mask.tsx` 硬编中文 "移除" → 走 `t("copilot.context_remove_title")`。
- **F3** `docs`: CLAUDE.md + README 测试数字 110 → 实际 N（vitest 实跑数）。
- **F7** `feat(llm-client)`: OpenAI `Authorization` 头自动加 `Bearer ` 前缀（保留已有 `Bearer ` 不重复）+ 新增 4 条 `buildApiRequest` 单测。
- **F9** `docs(readme)`: 删 "开源前会补 token 机制" 过期 footnote。

## 为什么

Audit 报告（2026-05-01）找到 19 条 finding，其中 5 条属于 "违反自家约定 / 外部用户第一次撞墙" 的快速价值点。一个 PR 清掉。

详细理由 spec：`docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md` §M1

## 怎么验证

```bash
git fetch && git checkout refactor/audit-cleanup-convention
npx tsc --noEmit          # clean
npm test                  # N+4 个 case 全绿（新增 4 条 llm-client）
npm run test:e2e          # 9 case 全绿
npm run build             # 通过
```

手动：
- `/settings/llm` 页面建一张 OpenAI 模型卡，api_key 填纯 `sk-xxx`（不加 Bearer），"测试连接" 应当通（标准 OpenAI 或兼容 gateway）
- 切换语言到 English，打开 copilot 圈选一个元素，mask 上的 × 按钮 `title` 应显示 "Remove" 而非 "移除"

## 向后兼容风险

- **F7 破坏性候选**：如果你的 OpenAI-compat gateway 明确**不要** Bearer 前缀，这个 PR 会让它失败。已有 `Bearer sk-...` 作为 workaround 塞 api_key 的用户不受影响（`startsWith` 保留原值）。如遇此场景请开 issue，会补 `ModelConfig.auth_no_bearer_prefix` 选项。
- F1 / F2 / F3 / F9：无用户可见行为变化。
- `data/` 文件 shape 完全不动。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 记录 PR URL，等用户 review + merge**

不自动 merge。

---

# M2 · form-state 测试补完（F8）

**Branch:** `test/form-state-roundtrip`（从 main 切；假设 M1 已 merge 或还没 merge 都 OK，M2 不依赖 M1）

### Task M2.0: 分支切换

- [ ] **Step 1:** `git checkout main && git pull origin main --ff-only`
- [ ] **Step 2:** `git checkout -b test/form-state-roundtrip`
- [ ] **Step 3:** baseline `npx tsc --noEmit && npm test 2>&1 | tail -3`

---

### Task M2.1: 加 form-state round-trip 测试

**Files:**
- Create: `src/components/template-builder/__tests__/form-state.test.ts`

- [ ] **Step 1: Read the module under test**

Read `src/components/template-builder/form-state.ts` fully to understand:
- `TemplateFormState / FormInput / FormVariable / FormDimension / FormOutputField` shape
- `emptyFormState() / emptyInput() / emptyVariable() / emptyDimension()`
- `buildSchemaFromForm(form)` 所有校验分支：id / label / inputs / alias / dataset_id / variable.name / variable.source / output_fields.name / raw_text_output 约束
- `parseEqualsValue(raw)` 的 5 种输入
- `formFromSchema(schema)` 反序列化

- [ ] **Step 2: Write test file**

Create `src/components/template-builder/__tests__/form-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  emptyFormState,
  emptyInput,
  emptyVariable,
  emptyDimension,
  buildSchemaFromForm,
  formFromSchema,
  type TemplateFormState,
} from '../form-state'

describe('form-state · empty helpers', () => {
  it('emptyFormState 带一个 empty input，output_fields / variables / dimensions 为空', () => {
    const f = emptyFormState()
    expect(f.id).toBe('')
    expect(f.inputs).toHaveLength(1)
    expect(f.variables).toHaveLength(0)
    expect(f.output_fields).toHaveLength(0)
    expect(f.display_dimensions).toHaveLength(0)
    expect(f.raw_text_output).toBe(false)
  })

  it('emptyInput alias 默认 "input"', () => {
    expect(emptyInput().alias).toBe('input')
  })

  it('emptyVariable / emptyDimension 字段齐全', () => {
    expect(emptyVariable()).toMatchObject({ name: '', source: '', transform: [], fallback: '' })
    expect(emptyDimension()).toMatchObject({ field: '', label: '', value_labels: {}, order: [], header_fields: [] })
  })
})

describe('buildSchemaFromForm · happy path', () => {
  it('完整 valid form 产出 TaskSchema', () => {
    const f: TemplateFormState = {
      id: 'qa_v1',
      label: 'QA v1',
      description: 'desc',
      compare_group: 'qa',
      inputs: [{ alias: 'qa', dataset_id: 'qa_pairs', dedupe_by: [], hard_filter_field: '', hard_filter_equals_raw: '', filters: [] }],
      variables: [{ name: 'question', source: 'qa.question', transform: [], fallback: '' }],
      default_prompt: 'answer {{question}}',
      user_template: 'Q: {{question}}',
      image_field: '',
      output_fields: [{ name: 'answer', type: 'string', required: true, enum_values: [] }],
      display_dimensions: [{ field: 'output.answer', label: 'Answer', value_labels: {}, order: [], header_fields: [] }],
      display_id_override: '',
      raw_text_output: false,
    }
    const { schema, errors } = buildSchemaFromForm(f)
    expect(errors).toEqual([])
    expect(schema).toBeDefined()
    expect(schema!.id).toBe('qa_v1')
    expect(schema!.inputs[0].alias).toBe('qa')
    expect(schema!.variables[0].name).toBe('question')
    expect(schema!.output_schema.required).toEqual(['answer'])
    expect(schema!.display_dimensions?.[0].field).toBe('output.answer')
  })

  it('enum_values for number type 转为数字数组', () => {
    const f = emptyFormState()
    f.id = 'x'
    f.label = 'X'
    f.output_fields = [{ name: 'score', type: 'number', required: true, enum_values: ['1', '2', '3'] }]
    const { schema } = buildSchemaFromForm(f)
    expect(schema!.output_schema.properties.score.enum).toEqual([1, 2, 3])
  })

  it('hard_filter_field 非空时产 hard_filter，parseEqualsValue 做类型推断', () => {
    const f = emptyFormState()
    f.id = 'x'
    f.label = 'X'
    f.inputs[0].dataset_id = 'qa_pairs'
    f.inputs[0].hard_filter_field = 'active'
    f.inputs[0].hard_filter_equals_raw = 'true'
    f.output_fields = [{ name: 'a', type: 'string', required: true, enum_values: [] }]
    const { schema } = buildSchemaFromForm(f)
    expect(schema!.inputs[0].hard_filter).toEqual({ field: 'active', equals: true })
  })
})

describe('buildSchemaFromForm · validation errors', () => {
  function mkValid(): TemplateFormState {
    const f = emptyFormState()
    f.id = 'x'
    f.label = 'X'
    f.inputs[0].dataset_id = 'qa_pairs'
    f.output_fields = [{ name: 'a', type: 'string', required: true, enum_values: [] }]
    return f
  }

  it('空 id', () => {
    const f = mkValid(); f.id = ''
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'id')).toBe(true)
    expect(r.schema).toBeUndefined()
  })

  it('非法 id（数字开头）', () => {
    const f = mkValid(); f.id = '1abc'
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'id')).toBe(true)
  })

  it('空 label', () => {
    const f = mkValid(); f.label = ''
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'label')).toBe(true)
  })

  it('重复 alias', () => {
    const f = mkValid()
    f.inputs.push({ alias: f.inputs[0].alias, dataset_id: 'x', dedupe_by: [], hard_filter_field: '', hard_filter_equals_raw: '', filters: [] })
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field.startsWith('inputs[1].alias'))).toBe(true)
  })

  it('重复 variable name', () => {
    const f = mkValid()
    f.variables = [
      { name: 'v', source: 'qa.a', transform: [], fallback: '' },
      { name: 'v', source: 'qa.b', transform: [], fallback: '' },
    ]
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'variables[1].name')).toBe(true)
  })

  it('重复 output field name', () => {
    const f = mkValid()
    f.output_fields = [
      { name: 'a', type: 'string', required: true, enum_values: [] },
      { name: 'a', type: 'number', required: false, enum_values: [] },
    ]
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'output_fields[1].name')).toBe(true)
  })

  it('raw_text_output + 多个 output field 报错', () => {
    const f = mkValid()
    f.raw_text_output = true
    f.output_fields = [
      { name: 'a', type: 'string', required: true, enum_values: [] },
      { name: 'b', type: 'string', required: false, enum_values: [] },
    ]
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'raw_text_output')).toBe(true)
  })

  it('raw_text_output + 非 string 类型报错', () => {
    const f = mkValid()
    f.raw_text_output = true
    f.output_fields = [{ name: 'a', type: 'number', required: true, enum_values: [] }]
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'raw_text_output')).toBe(true)
  })

  it('缺 dataset_id', () => {
    const f = mkValid(); f.inputs[0].dataset_id = ''
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field.includes('dataset_id'))).toBe(true)
  })

  it('output_fields 为空', () => {
    const f = mkValid(); f.output_fields = []
    const r = buildSchemaFromForm(f)
    expect(r.errors.some(e => e.field === 'output_fields')).toBe(true)
  })
})

describe('form-state · round-trip 幂等', () => {
  function mkFull(): TemplateFormState {
    return {
      id: 'rt',
      label: 'Round Trip',
      description: 'desc',
      compare_group: 'grp',
      inputs: [{
        alias: 'qa',
        dataset_id: 'qa_pairs',
        dedupe_by: ['qa_id'],
        hard_filter_field: 'topic',
        hard_filter_equals_raw: 'history',
        filters: [],
      }],
      variables: [{ name: 'q', source: 'qa.question', transform: [], fallback: 'N/A' }],
      default_prompt: 'prompt',
      user_template: '{{q}}',
      image_field: '',
      output_fields: [{ name: 'answer', type: 'string', required: true, enum_values: [] }],
      display_dimensions: [{ field: 'output.answer', label: 'A', value_labels: { k: 'v' }, order: ['k'], header_fields: [{ field: 'qa.topic', label: 'Topic' }] }],
      display_id_override: '',
      raw_text_output: false,
    }
  }

  it('formFromSchema(buildSchemaFromForm(f).schema!) 与 f 深度 equal', () => {
    const f = mkFull()
    const { schema, errors } = buildSchemaFromForm(f)
    expect(errors).toEqual([])
    expect(schema).toBeDefined()
    const back = formFromSchema(schema!)
    expect(back).toEqual(f)
  })
})
```

- [ ] **Step 3: Run tests to verify they all pass**

```bash
npm test -- --run form-state.test 2>&1 | tail -15
```

Expected: 所有 ~20 case PASS。

**如果有 FAIL**：不要改 form-state.ts 来让测试过 —— 这说明测试对现有行为的断言不准。重读 form-state.ts 的实现，校准测试断言（例如 valid 路径少了必填字段、校验顺序不对）。

- [ ] **Step 4: Run full vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: total 从 baseline → baseline + 20，全绿。

- [ ] **Step 5: Commit**

```bash
git add src/components/template-builder/__tests__/form-state.test.ts
git commit -m "$(cat <<'EOF'
test(template-builder): add form-state round-trip + validation tests

form-state.ts 270 行的纯函数 buildSchemaFromForm / formFromSchema /
parseEqualsValue 本该配 __tests__（AGENTS.md §测试约定），之前归类成
"UI 下一层" 漏掉了。

覆盖：empty helpers 形态 · buildSchema happy path (含 enum number 强转 /
hard_filter 类型推断) · 10 条 validation error 分支 · round-trip 幂等
(formFromSchema ∘ buildSchemaFromForm = id)。round-trip 测试是关键保证
—— 未来改字段时会第一时间发现 asymmetry。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M2.2: M2 push + PR

- [ ] **Step 1: 跑 verify**

```bash
npx tsc --noEmit && npm test && npm run build 2>&1 | tail -5
```

- [ ] **Step 2: push + PR**

```bash
git push -u origin test/form-state-roundtrip
gh pr create --title "test(template-builder): add form-state round-trip + validation coverage" --body "$(cat <<'EOF'
## 改了什么

给 `src/components/template-builder/form-state.ts` 的 3 个纯函数（`buildSchemaFromForm` / `formFromSchema` / `parseEqualsValue`）加 vitest 测试文件，覆盖 empty helpers / happy path / 10 条 validation error 分支 / round-trip 幂等。约 20 cases。

## 为什么

Audit 报告 F8：form-state.ts 是 (TemplateFormState) ↔ TaskSchema 的双向映射 + 14 条校验规则，完全是 AGENTS.md "新的纯函数必须配套 __tests__" 的对象；之前被归类成 "UI 下一层" 漏测。round-trip 幂等测试给未来改字段提供第一时间的 regression 保证。

Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md` §M2

## 怎么验证

```bash
git fetch && git checkout test/form-state-roundtrip
npx tsc --noEmit     # clean
npm test             # baseline + 20，全绿
npm run build        # 通过
```

## 向后兼容风险

无。只加测试文件，不改 form-state.ts / 不改 UI 表单 / 不改 `data/` shape。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# M3 · copilot stream response 抽 helper（F4）

**Branch:** `refactor/copilot-stream-response`（从 main 切）

### Task M3.0: 分支切换 + 阅读两个 route 的当前实现

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b refactor/copilot-stream-response`
- [ ] **Step 2:** Read 完：
  - `src/app/api/copilot/sessions/[id]/chat/route.ts`（207 行）
  - `src/app/api/copilot/sessions/[id]/tool-result/route.ts`（275 行）
  - `src/lib/copilot/build-llm-messages.ts`
  - `src/lib/copilot/llm-stream.ts`（为了理解 StreamEvent 类型）
  - `src/lib/copilot/tool-adapters.ts`（toOpenaiTools / toAnthropicTools）
  - `src/lib/copilot/session-store.ts` 的 `appendMessage`
  - CHANGELOG.md `[0.4.0]` 节（race fix 清单）**必读**
- [ ] **Step 3:** baseline `npx tsc --noEmit && npm test`

---

### Task M3.1: 新建 `src/lib/copilot/stream-response.ts` helper

**Files:**
- Create: `src/lib/copilot/stream-response.ts`

- [ ] **Step 1: 写 helper 框架**

```ts
// ---------- Copilot · /chat 与 /tool-result 共享的 streaming helper ----------
// 把两个 route 的 "调 LLM stream → 累 text/tool_use → 流结束后 append 到 jsonl
// → emit done 事件" 的公共段抽出来。前提：caller 已经校验 body / 处理鉴权 /
// 构造好 branch + model + parent_id。
//
// 关键 race fix（CHANGELOG 0.4.0，保留不动）：
//   1. appendFileSync 原子 append（session-store.appendMessage 内）
//   2. controller.enqueue 在流关后抛 —— write helper 里 try/catch 吞
//   3. tool_use 落盘必须先于 emit done —— post-stream 落盘按顺序做完再
//      返回 result 给 caller（caller 拿 result 再写 done）
//   4. abort signal 透传给 callLlmStreaming

import { callLlmStreaming } from './llm-stream'
import { appendMessage } from './session-store'
import { buildLlmMessages } from './build-llm-messages'
import { toOpenaiTools, toAnthropicTools } from './tool-adapters'
import type { Tool } from './tools'
import type { CopilotMessage, PageContext, StreamEvent } from './types'
import type { ModelConfig } from '../llm-config'

export interface RunStreamParams {
  sessionId: string
  branch: CopilotMessage[]
  model: ModelConfig
  tools: Tool[]
  pageContext: PageContext | null
  startParentId: string | undefined
  signal: AbortSignal
  write: (payload: unknown) => void
}

export interface RunStreamResult {
  assistantMessageId?: string
  toolUseMessageIds: string[]
  usage?: { input_tokens: number; output_tokens: number }
  stopReason?: string
}

export async function runToolAwareLlmStream(p: RunStreamParams): Promise<RunStreamResult> {
  const llmMessages = buildLlmMessages(p.branch, p.pageContext)
  const toolsFormatted =
    p.model.api_format === 'openai' ? toOpenaiTools(p.tools) : toAnthropicTools(p.tools)

  let assistantText = ''
  let assistantUsage: { input_tokens: number; output_tokens: number } | undefined
  let stopReason: string | undefined
  const pendingToolUses: Array<{
    call_id: string
    tool_name: string
    input: Record<string, unknown>
    thought_signature?: string
  }> = []

  await callLlmStreaming(
    {
      messages: llmMessages,
      config: {
        api_format: p.model.api_format,
        base_url: p.model.base_url,
        api_key: p.model.api_key,
      },
      model: p.model.model,
      temperature: p.model.default_temperature ?? 1,
      max_tokens: p.model.default_max_tokens ?? 4096,
      tools: toolsFormatted,
      signal: p.signal,
    },
    (ev: StreamEvent) => {
      if (ev.type === 'text') {
        assistantText += ev.delta
        p.write({ kind: 'text', delta: ev.delta })
      } else if (ev.type === 'tool_use_start') {
        p.write({ kind: 'tool_use_start', call_id: ev.call_id, tool_name: ev.tool_name })
      } else if (ev.type === 'tool_use_delta') {
        p.write({ kind: 'tool_use_delta', call_id: ev.call_id, input_json_delta: ev.input_json_delta })
      } else if (ev.type === 'tool_use_end') {
        // 不 mid-stream append（避免 jsonl 写句柄竞争）；先 buffer，关流后统一落盘
        pendingToolUses.push({
          call_id: ev.call_id,
          tool_name: ev.tool_name,
          input: ev.input,
          thought_signature: ev.thought_signature,
        })
        p.write({ kind: 'tool_use_end', call_id: ev.call_id, tool_name: ev.tool_name, input: ev.input })
      } else if (ev.type === 'done') {
        assistantUsage = ev.usage
        stopReason = ev.stop_reason
      } else if (ev.type === 'error') {
        p.write({ kind: 'error', message: ev.message })
      }
    },
  )

  // 流结束后，按顺序落盘：assistant 文本（若有）→ 每条 tool_use
  let parentId: string | undefined = p.startParentId
  let assistantMessageId: string | undefined
  if (assistantText.trim().length > 0) {
    const asst = appendMessage({
      session_id: p.sessionId,
      role: 'assistant',
      content: assistantText,
      parent_id: parentId,
      usage: assistantUsage,
      model_id: p.model.id,
    })
    assistantMessageId = asst.id
    parentId = asst.id
  }

  const toolUseMessageIds: string[] = []
  for (const tu of pendingToolUses) {
    const msg = appendMessage({
      session_id: p.sessionId,
      role: 'tool_use',
      content: JSON.stringify(tu.input),
      parent_id: parentId,
      call_id: tu.call_id,
      tool_name: tu.tool_name,
      tool_input: tu.input,
      thought_signature: tu.thought_signature,
      model_id: p.model.id,
    })
    toolUseMessageIds.push(msg.id)
    parentId = msg.id
  }

  return {
    assistantMessageId,
    toolUseMessageIds,
    usage: assistantUsage,
    stopReason,
  }
}
```

- [ ] **Step 2: tsc + vitest baseline**

```bash
npx tsc --noEmit
```

Expected: no errors（helper 还没 caller，但类型完整）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/copilot/stream-response.ts
git commit -m "$(cat <<'EOF'
refactor(copilot): extract runToolAwareLlmStream helper (F4 prep)

/chat 和 /tool-result route 里约 100 行 × 2 的流式段完全相同——调
callLlmStreaming + 累 text/tool_use + 后置按顺序 appendMessage + 返回
result 给 caller。抽 helper 放 lib/copilot/stream-response.ts。

保留所有 PR-3 race fix:
- appendFileSync 原子 append（继承 appendMessage）
- controller.enqueue 流关后抛 —— 留给 caller 的 write 做 try/catch
- tool_use 落盘先于 emit done（helper 先 append 再 return，caller 再写 done）
- abort signal 透传

本 commit 只加 helper，下个 commit 起替换 caller。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M3.2: 用 helper 改写 `/chat` route

**Files:**
- Modify: `src/app/api/copilot/sessions/[id]/chat/route.ts`

- [ ] **Step 1: 重写 route**

完整替换成（保持 imports / 校验 / SSE 响应 headers / setSnapshot 逻辑不动；把流式段换成 helper 调用）：

```ts
import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
  autoTitleSessionIfNeeded,
  updateSession,
} from '@/lib/copilot/session-store'
import { tools } from '@/lib/copilot/tools'
import type { CopilotContextRef, ClientSnapshot } from '@/lib/copilot/types'
import { getLlmConfig } from '@/lib/llm-config'
import { setSnapshot } from '@/lib/copilot/snapshot-cache'
import { runToolAwareLlmStream } from '@/lib/copilot/stream-response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) return jsonError(404, 'session not found')

  const body = await req.json().catch(() => ({})) as {
    user_message?: string
    parent_id?: string
    model_id?: string
    contexts?: CopilotContextRef[]
    client_snapshot?: ClientSnapshot
  }
  if (!body.user_message || typeof body.user_message !== 'string') return jsonError(400, 'user_message required')

  const cfg = getLlmConfig()
  const modelId = body.model_id ?? session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) return jsonError(400, 'copilot model not configured or not enabled')
  if (!model.base_url || !model.api_key) return jsonError(400, 'model missing base_url or api_key')

  if (body.model_id && body.model_id !== session.model_id) {
    updateSession(sessionId, { model_id: body.model_id })
  }

  const parent_id = body.parent_id ?? session.head_message_id

  if (body.client_snapshot) setSnapshot(sessionId, body.client_snapshot)

  const userMsg = appendMessage({
    session_id: sessionId,
    role: 'user',
    content: body.user_message,
    parent_id,
    contexts: body.contexts,
  })
  autoTitleSessionIfNeeded(sessionId, body.user_message)

  const branch = getActiveBranch(sessionId, userMsg.id)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch { /* stream closed */ }
      }
      write({ kind: 'user_message', id: userMsg.id })

      try {
        const result = await runToolAwareLlmStream({
          sessionId,
          branch,
          model,
          tools,
          pageContext: body.client_snapshot?.page_context ?? null,
          startParentId: userMsg.id,
          signal: req.signal,
          write,
        })
        write({
          kind: 'done',
          assistant_message_id: result.assistantMessageId,
          tool_use_message_ids: result.toolUseMessageIds,
          usage: result.usage,
          stop_reason: result.stopReason,
        })
      } catch (e) {
        write({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: tsc + vitest**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: clean + baseline unchanged.

- [ ] **Step 3: 手动回归 /chat**

跑 `npm run dev`，在 copilot 里发一条普通对话（无 tool）：
- 看 SSE 正常
- assistant 消息出现
- 会话保存（刷新页面消息还在）

- [ ] **Step 4: Commit**

```bash
git add src/app/api/copilot/sessions/[id]/chat/route.ts
git commit -m "$(cat <<'EOF'
refactor(copilot): rewrite /chat route to use runToolAwareLlmStream helper

约 110 行流式段变成 helper 的一次调用，route 只剩 body 校验 / 鉴权 /
SSE 响应骨架 / write user_message + done。行为不变：同样的 user_message
→ text/tool_use_* → done 事件序列；同样的落盘顺序（assistant → tool_use）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M3.3: 用 helper 改写 `/tool-result` route

**Files:**
- Modify: `src/app/api/copilot/sessions/[id]/tool-result/route.ts`

- [ ] **Step 1: 重写 route**

保持 chain-cap 检查 / tool 执行 / tool_result 落盘 / write `tool_result_message` 逻辑不动；替换流式段：

```ts
import { NextRequest } from 'next/server'
import {
  getSession,
  appendMessage,
  getActiveBranch,
} from '@/lib/copilot/session-store'
import { tools } from '@/lib/copilot/tools'
import { findTool } from '@/lib/copilot/tool-registry'
import { getLlmConfig } from '@/lib/llm-config'
import type { ClientSnapshot } from '@/lib/copilot/types'
import { setSnapshot } from '@/lib/copilot/snapshot-cache'
import { runToolAwareLlmStream } from '@/lib/copilot/stream-response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const session = getSession(sessionId)
  if (!session) return jsonError(404, 'session not found')

  const body = (await req.json().catch(() => ({}))) as {
    call_id?: string
    tool_name?: string
    input?: Record<string, unknown>
    denied?: boolean
    reason?: string
    client_snapshot?: ClientSnapshot
  }
  if (!body.call_id || typeof body.call_id !== 'string') return jsonError(400, 'call_id required')
  if (!body.tool_name || typeof body.tool_name !== 'string') return jsonError(400, 'tool_name required')
  if (!body.input || typeof body.input !== 'object') return jsonError(400, 'input required')

  if (body.client_snapshot) setSnapshot(sessionId, body.client_snapshot)

  const branchBefore = getActiveBranch(sessionId)
  const completedPairs = countTrailingToolUsePairs(branchBefore)
  if (completedPairs >= 5) return jsonError(429, 'chain call limit reached')

  const cfg = getLlmConfig()
  const modelId = session.model_id
  const model = modelId ? cfg.models.find(m => m.id === modelId && m.copilot_enabled) : undefined
  if (!model) return jsonError(400, 'copilot model not configured or not enabled')
  if (!model.base_url || !model.api_key) return jsonError(400, 'model missing base_url or api_key')

  const tailId = branchBefore[branchBefore.length - 1]?.id

  let resultContent: unknown
  if (body.denied === true) {
    resultContent = { denied: true, reason: body.reason ?? '' }
  } else {
    const tool = findTool(tools, body.tool_name)
    if (!tool) return jsonError(400, `unknown tool: ${body.tool_name}`)
    try {
      resultContent = await tool.run(body.input, { sessionId })
    } catch (e) {
      resultContent = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  const toolResultMsg = appendMessage({
    session_id: sessionId,
    role: 'tool_result',
    content: JSON.stringify(resultContent),
    call_id: body.call_id,
    tool_name: body.tool_name,
    denied: body.denied,
    reason: body.reason,
    parent_id: tailId,
  })

  const branch = getActiveBranch(sessionId, toolResultMsg.id)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch { /* stream closed */ }
      }
      write({
        kind: 'tool_result_message',
        id: toolResultMsg.id,
        content: JSON.stringify(resultContent),
        denied: body.denied,
        reason: body.reason,
      })

      try {
        const result = await runToolAwareLlmStream({
          sessionId,
          branch,
          model,
          tools,
          pageContext: body.client_snapshot?.page_context ?? null,
          startParentId: toolResultMsg.id,
          signal: req.signal,
          write,
        })
        write({
          kind: 'done',
          assistant_message_id: result.assistantMessageId,
          tool_use_message_ids: result.toolUseMessageIds,
          usage: result.usage,
          stop_reason: result.stopReason,
        })
      } catch (e) {
        write({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function countTrailingToolUsePairs(messages: { role: string }[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (role === 'tool_use' || role === 'tool_result') count++
    else break
  }
  return Math.floor(count / 2)
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: tsc + vitest**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

- [ ] **Step 3: 手动回归完整 tool 流（dev server）**

跑 `npm run dev`。copilot 里测 5 个场景：
1. 普通对话 → OK
2. 触发 `list_experiments` → read 工具 auto-run → 卡片展开 "N 个实验"
3. 触发 `restart_experiment` → 看 Confirm/Deny 按钮出现
4. Confirm → 实验开始跑 → "开始重跑 task_ids: [...]"
5. Deny with reason → LLM 在下一条回复里"承认了你的拒绝，换个思路"
6. 连续触发 5+ 次 tool_use 看 429 toast（chain cap）

每条验证通过打勾。如果任一失败**停下**并 debug，不要继续 commit。

- [ ] **Step 4: 跑 e2e smoke（防 chat/tool-result route 不崩）**

```bash
npm run test:e2e 2>&1 | tail -10
```

Expected: 9/9 pass。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/copilot/sessions/[id]/tool-result/route.ts
git commit -m "$(cat <<'EOF'
refactor(copilot): rewrite /tool-result route to use runToolAwareLlmStream helper

约 120 行流式段换成 helper 调用。保留所有 /tool-result 独有逻辑：
chain-cap 5 检查、tool 执行、tool_result 落盘（parent_id = tail）、emit
tool_result_message 事件。行为不变：同样的 Confirm/Deny → tool 执行 →
tool_result 持久化 → 重新流 LLM → text/tool_use_* → done 序列。

PR 完整覆盖了 5 个 tool scenario 手动回归（chat / list_experiments auto-run /
restart_experiment confirm / deny with reason / chain cap 429）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M3.4: M3 push + PR

- [ ] **Step 1: Verify**

```bash
npx tsc --noEmit && npm test && npm run build 2>&1 | tail -5
```

- [ ] **Step 2: Push + PR**

```bash
git push -u origin refactor/copilot-stream-response
gh pr create --title "refactor(copilot): extract shared stream helper from /chat + /tool-result routes" --body "$(cat <<'EOF'
## 改了什么

- `src/lib/copilot/stream-response.ts` (新文件): 抽出 `runToolAwareLlmStream({ sessionId, branch, model, tools, pageContext, startParentId, signal, write })` helper，封装 "调 callLlmStreaming + 累 text/tool_use + 后置按顺序 appendMessage"。
- `/api/copilot/sessions/[id]/chat/route.ts` 重写：约 110 行流式段变成一次 helper 调用。
- `/api/copilot/sessions/[id]/tool-result/route.ts` 重写：约 120 行流式段变成一次 helper 调用，chain-cap / tool 执行 / tool_result 落盘保留。

## 为什么

Audit 报告 F4：两个 route 的流式段近乎 100% 相同（CHANGELOG 0.4.0 多次 pipeline race fix 每次要在两边各改一次）。抽 helper 后未来 SSE 时序修复只需改一处。

保留所有 PR-3 race fix：
- appendFileSync 原子 append
- controller.enqueue 流关后抛 —— write 里 try/catch 吞
- tool_use 落盘先于 emit done
- abort signal 透传

Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md` §M3

## 怎么验证

自动：
```bash
git fetch && git checkout refactor/copilot-stream-response
npx tsc --noEmit     # clean
npm test             # baseline 全绿
npm run test:e2e     # 9/9 pass
npm run build        # 通过
```

手动（5 个 tool scenario 必过）：
1. 普通对话
2. `list_experiments` → read auto-run → 卡片显示 N 个实验
3. `restart_experiment` → Confirm → 实验开始
4. `restart_experiment` → Deny with reason → LLM 回复
5. 连续触发 5+ tool_use → 429 chain cap toast

## 向后兼容风险

- SSE 事件序列完全不变（`user_message / text / tool_use_start/delta/end / done / error` + `/tool-result` 的 `tool_result_message`）
- `data/copilot/<session>.jsonl` 消息 shape 不变
- chain cap 5 不变
- 客户端 chat-view.tsx 无需改动

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# M4 · chat-view.tsx 拆分（F5）

**Branch:** `refactor/copilot-chat-view-split`（从 main 切，和 M3 独立）

### Task M4.0: 分支切换 + 阅读 chat-view 全文

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b refactor/copilot-chat-view-split`
- [ ] **Step 2:** Read 完 `src/components/copilot/chat-view.tsx`（812 行全部）+ `chat-view-parts.tsx`（182 行）+ `store.tsx` 相关部分 + `material-reveal-overlay.tsx`
- [ ] **Step 3:** baseline

---

### Task M4.1: 抽 `useChatStream` hook

**Files:**
- Create: `src/components/copilot/use-chat-stream.ts`

**Goal:** 把 `chat-view.tsx` 的 SSE event 解析 + messages state + streaming send + tool result post + abort ref + pendingCallIds + streamToolUseOrderRef + pendingAutoRunRef + currentSessionRef + toUiMessage 映射 全部搬进 hook。

- [ ] **Step 1: 创建 hook 文件**

签名见 Spec §M4。关键：**race fix 注释必须逐字抄过来**。ToDo for subagent:
- `abortRef.current?.abort()` 在 doStreamSend 和 postToolResult 覆写前调
- `pendingAutoRunRef` 延后到 done 事件才 fire
- `currentSessionRef` session 切换时 stale SSE 忽略
- toast 通过 `onError` prop 注入，不 `import { toast } from "sonner"`

完整骨架（subagent 按此扩展）：

```ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CopilotMessage, CopilotContextRef, PageContext } from "@/lib/copilot/types"
import { findToolMetadata } from "@/lib/copilot/tool-metadata"
import { collectClientSnapshot } from "@/lib/copilot/collect-snapshot"
import { useCopilotStore } from "./store"
import type { UiMessage } from "./chat-view-parts"

// SSE 事件类型（和 /chat + /tool-result 对齐，原 chat-view.tsx 的 ChatSseEvent）
type ChatSseEvent =
  | { kind: "user_message"; id: string }
  | { kind: "tool_result_message"; id: string; content?: string; denied?: boolean; reason?: string }
  | { kind: "text"; delta: string }
  | { kind: "tool_use_start"; call_id: string; tool_name: string }
  | { kind: "tool_use_delta"; call_id: string; input_json_delta: string }
  | { kind: "tool_use_end"; call_id: string; tool_name: string; input: Record<string, unknown> }
  | { kind: "done"; assistant_message_id?: string; tool_use_message_ids?: string[]; usage?: { input_tokens: number; output_tokens: number }; stop_reason?: string }
  | { kind: "error"; message: string }

async function consumeSseStream(
  resp: Response,
  onEvent: (ev: ChatSseEvent) => void,
): Promise<void> {
  // 原样搬 chat-view.tsx L47-74
  // ...
}

export function toUiMessage(m: CopilotMessage): UiMessage {
  // 原样搬 chat-view.tsx L786-812
  // ...
}

export interface UseChatStreamParams {
  sessionId?: string
  modelId?: string
  pageContext: PageContext | null
  onError: (message: string) => void
  tI18nReplyFailed: string        // t("copilot.reply_failed")
  tI18nChainLimit: string         // t("copilot.tool.chain_limit")
  tI18nSendFailed: string         // t("copilot.send_failed")
  tI18nDeleteFailed: string       // t("copilot.delete_failed")
  tI18nDeleteConfirm: string      // t("copilot.delete_message_confirm")
}

export interface UseChatStreamResult {
  messages: UiMessage[]
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>
  sending: boolean
  loadingSession: boolean
  pendingCallIds: Set<string>
  send: (text: string, contexts?: CopilotContextRef[]) => Promise<void>
  confirmTool: (call_id: string, tool_name: string, input: Record<string, unknown>) => void
  denyTool: (call_id: string, tool_name: string, input: Record<string, unknown>, reason: string) => void
  deleteMessage: (msg: UiMessage) => Promise<void>
  editUserMessage: (msg: UiMessage, newText: string) => Promise<void>
}

export function useChatStream(p: UseChatStreamParams): UseChatStreamResult {
  const { setBusy } = useCopilotStore()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [pendingCallIds, setPendingCallIds] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const streamToolUseOrderRef = useRef<string[]>([])
  const pendingAutoRunRef = useRef<Array<{ call_id: string; tool_name: string; input: Record<string, unknown> }>>([])
  const currentSessionRef = useRef<string | undefined>(undefined)

  // loadSession useEffect 搬过来（chat-view.tsx L134-145）
  useEffect(() => {
    currentSessionRef.current = p.sessionId
    if (!p.sessionId) { setMessages([]); return }
    setLoadingSession(true)
    fetch(`/api/copilot/sessions/${p.sessionId}`)
      .then(r => r.json())
      .then((d: { messages?: CopilotMessage[] }) => {
        setMessages((d.messages ?? []).map(toUiMessage))
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingSession(false))
  }, [p.sessionId])

  // unmount abort
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // makeSseHandler / doStreamSend / postToolResult / confirmTool / denyTool /
  // deleteMessage / editUserMessage 原样搬 chat-view.tsx L164-544
  //
  // 三个关键改动:
  //   - toast.error(...) → p.onError(...)
  //   - t("copilot.xxx") → p.tI18nXxx
  //   - sessionId / modelId → p.sessionId / p.modelId
  //   - pageContext → p.pageContext

  // ... 省略完整实现，subagent 按上面签名补全

  return {
    messages,
    setMessages,
    sending,
    loadingSession,
    pendingCallIds,
    send: /* ... */,
    confirmTool: /* ... */,
    denyTool: /* ... */,
    deleteMessage: /* ... */,
    editUserMessage: /* ... */,
  }
}
```

**注意**：完整实现见 step 2 的参考；subagent 必须把 chat-view.tsx 原有的所有 race fix 注释**逐字**搬到新 hook 里。

- [ ] **Step 2: 验证 tsc**

```bash
npx tsc --noEmit
```

Expected: 无错（hook 独立，不被 import 还不会影响其它文件）。

- [ ] **Step 3: Commit**

```bash
git add src/components/copilot/use-chat-stream.ts
git commit -m "$(cat <<'EOF'
refactor(copilot): extract useChatStream hook (F5 prep)

把 chat-view.tsx 里的 SSE state + streaming send + tool confirm/deny +
message edit/delete 全部搬到 hook。保留 PR-3 的所有 race fix 注释和
逻辑:
- abortRef 覆写前先 abort 旧的
- pendingAutoRunRef 延到 done 事件再 fire
- currentSessionRef stale event 忽略
- ToolCallCard persistedOnServer 靠 done 事件回填 id

toast 通过 onError prop 注入（而非 hook 内 import sonner），方便未来
加测试 + 解耦。i18n 字符串也以 prop 传入（避免 hook 内 useT）。

本 commit 新加文件不替换 chat-view，下个 commit 做。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M4.2: 抽 `ContextChipRail` 组件

**Files:**
- Create: `src/components/copilot/context-chip-rail.tsx`

- [ ] **Step 1: 创建组件文件**

完整代码（subagent 可微调 prop 名字但结构一致）：

```tsx
"use client"

import { useState } from "react"
import { useT } from "@/lib/i18n/provider"
import type { CapturedContext } from "./store"
import { colorForTag } from "./context-mask"
import { MarkdownBody } from "./chat-view-parts"

interface Props {
  contexts: CapturedContext[]
  ctxStatus: Record<string, "ok" | "missing" | "error">
  ctxPreview: string
  inspectorActive: boolean
  onInspectorToggle: () => void
  onRemoveContext: (elementKey: string) => void
  onClearContexts: () => void
}

export function ContextChipRail(p: Props) {
  const t = useT()
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      {/* 圈选入口 + 当前 context chips */}
      {/* 原 chat-view.tsx L660-723 整块搬过来 */}
      <div data-copilot-chip-rail className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={p.onInspectorToggle}
          title={t("copilot.inspector_hint")}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-all duration-150 active:scale-95 ${
            p.inspectorActive
              ? "bg-primary text-primary-foreground border-primary shadow-[0_0_0_3px_oklch(0.7_0.17_280_/_0.25)] animate-[copilot-inspector-pulse_1.6s_ease-in-out_infinite]"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
          }`}
        >
          {p.inspectorActive ? t("copilot.inspector_exit") : t("copilot.inspector_start")}
        </button>
        {p.contexts.length > 0 && (
          <>
            {p.contexts.map(c => {
              const isText = c.type === "text_selection"
              const label = isText
                ? `"${(c.summary ?? "").replace(/…$/, "")}"`
                : c.type
              const status = p.ctxStatus[`${c.type}:${c.id}`]
              const stale = status === "missing" || status === "error"
              return (
                <span
                  key={c.elementKey}
                  className={`inline-flex items-center gap-1 text-[10px] rounded border px-1.5 py-0.5 bg-card ${stale ? "opacity-50" : ""}`}
                  style={{ borderColor: colorForTag(c.tag) + "99" }}
                  title={stale ? `${c.type}#${c.id} · ${t("copilot.context_stale_title")}` : c.summary ? `${c.type}#${c.id} · ${c.summary}` : `${c.type}#${c.id}`}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full text-[9px] font-bold text-white text-center leading-3"
                    style={{ backgroundColor: colorForTag(c.tag) }}
                  >{c.tag}</span>
                  <span className={`truncate text-muted-foreground ${isText ? "max-w-[140px] italic" : "max-w-[80px]"} ${stale ? "line-through" : ""}`}>{label}</span>
                  {stale && <span className="text-destructive text-[10px]" aria-hidden>!</span>}
                  <button
                    onClick={() => p.onRemoveContext(c.elementKey)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive leading-none"
                    title={t("copilot.context_tag_remove")}
                  >×</button>
                </span>
              )
            })}
            {p.contexts.length > 1 && (
              <button
                onClick={p.onClearContexts}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >{t("copilot.context_clear_all")}</button>
            )}
            {p.ctxPreview && (
              <button
                onClick={() => setPreviewOpen(v => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-auto"
              >
                {previewOpen ? "▾" : "▸"} {t("copilot.preview_system_message")}
              </button>
            )}
          </>
        )}
      </div>

      {previewOpen && p.ctxPreview && (
        <div className="rounded border border-border bg-muted/30 max-h-80 overflow-auto px-3 py-2">
          <div className="copilot-preview-md text-[11px] leading-relaxed">
            <MarkdownBody text={p.ctxPreview} />
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/copilot/context-chip-rail.tsx
git commit -m "$(cat <<'EOF'
refactor(copilot): extract ContextChipRail component (F5 prep)

从 chat-view.tsx 拆出圈选按钮 + chip 行 + preview 面板的 UI，让
chat-view 只管 orchestration + 输入框。组件只管 render，previewOpen
本地状态；context 数据通过 props 传入。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M4.3: 精简 chat-view.tsx 用 hook + chip rail

**Files:**
- Modify: `src/components/copilot/chat-view.tsx` (812 → ≤ 300 行)

- [ ] **Step 1: 重写 chat-view.tsx**

目标结构：
- Imports（去掉 `findToolMetadata / collectClientSnapshot / consumeSseStream` 已搬到 hook；保留 `toast` / `useT` / `Textarea` / `Button` / `ModelPicker` / `MessageRow` / `ToolCallCard` / `ThinkingDots` / `RouteChangeBanner` / `ContextChipRail`）
- `export function ChatView({ sessionId, selectedModelId, onPickModel })`:
  - `const t = useT()`
  - `const { contexts, clearContexts, removeContext, setInspectorActive, inspectorActive, pageContext, bumpTypingSignal, setActiveSessionId } = useCopilotStore()`
  - `const stream = useChatStream({ sessionId, modelId: selectedModelId, pageContext, onError: msg => toast.error(msg), tI18nReplyFailed: t("copilot.reply_failed"), tI18nChainLimit: t("copilot.tool.chain_limit"), tI18nSendFailed: t("copilot.send_failed"), tI18nDeleteFailed: t("copilot.delete_failed"), tI18nDeleteConfirm: t("copilot.delete_message_confirm") })`
  - `const [input, setInput] = useState(""); const [editingId, setEditingId] = useState(undefined); const [editDraft, setEditDraft] = useState(""); const [ctxStatus, setCtxStatus] = useState({}); const [ctxPreview, setCtxPreview] = useState(""); const [inputExpanded, setInputExpanded] = useState(false)`
  - `const bottomRef = useRef(null)`
  - contexts resolve useEffect（原样搬 L109-132）
  - scrollToBottom useEffect
  - `canSend` / `handleSend`（调 stream.send）/ `handleForkSession` / `onKeyDown` / `handleCopy` / `handleDelete`（调 stream.deleteMessage）/ `startEdit / cancelEdit / commitEdit`（调 stream.editUserMessage）
  - Return JSX：`<RouteChangeBanner />` + messages list 渲染（原 L571-636 ToolCallCard / MessageRow 分支保留）+ thinking dots block + `<ContextChipRail />` + textarea + expand button + model picker + send button

**注意**：
- `setActiveSessionId` 通过 `store.setActiveSessionId`，不走 hook
- `commitEdit` 的双步操作（删后重发）在 hook 的 `editUserMessage` 里
- Tool use pairing logic（"往后找配对 tool_result"）保留在 chat-view 渲染阶段（不搬 hook）

完整实现长度应当在 200-300 行之间。

- [ ] **Step 2: 验证 tsc**

```bash
npx tsc --noEmit
```

Expected: clean。

- [ ] **Step 3: 跑 vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: baseline 全绿。

- [ ] **Step 4: 跑 e2e smoke**

```bash
npm run test:e2e 2>&1 | tail -10
```

Expected: 9/9 pass。

- [ ] **Step 5: 手动回归 9 场景（必过）**

跑 `npm run dev`，copilot 里依次测：
1. 发消息 / 发空消息（按钮 disabled）/ ⌘+Enter 发送
2. Edit 用户消息 → 自动重发 → 旧 assistant 消失
3. Delete 消息 → 后代一起消失
4. 切 session → messages 正确切换
5. Fork session（RouteChangeBanner "开启新对话"）→ 新 session 空
6. Tool use：auto-run read / confirm write / deny / chain cap 429
7. Input expand / collapse
8. Context chip：圈选 → chip 出现 → 发消息带 context → stale chip 视觉
9. Preview LLM 将看到的 context 按钮展开

每条过打勾；任一失败**停下**回滚。

- [ ] **Step 6: Commit**

```bash
git add src/components/copilot/chat-view.tsx
git commit -m "$(cat <<'EOF'
refactor(copilot): slim chat-view.tsx to orchestration (F5)

812 → ~280 行。SSE + streaming + tool result + edit/delete 搬去
useChatStream hook；圈选按钮 + chip + preview 搬去 ContextChipRail。
chat-view 只剩：messages list 渲染 + 输入框 + ⌘Enter + copy/edit/delete
action dispatch。

手动回归 9 场景全部通过：发消息 / edit / delete / 切 session / fork /
tool auto-run+confirm+deny+chain cap / input expand / chip stale /
preview 面板。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M4.4: M4 push + PR

- [ ] **Step 1: verify**

```bash
npx tsc --noEmit && npm test && npm run test:e2e && npm run build 2>&1 | tail -10
```

- [ ] **Step 2: push + PR**

```bash
git push -u origin refactor/copilot-chat-view-split
gh pr create --title "refactor(copilot): split chat-view into useChatStream hook + ContextChipRail" --body "$(cat <<'EOF'
## 改了什么

- `src/components/copilot/use-chat-stream.ts` (新): 封装 SSE 解析 + messages state + send/confirm/deny/edit/delete + 所有 PR-3 race fix（abortRef / pendingAutoRunRef / currentSessionRef / ToolCallCard persistedOnServer）
- `src/components/copilot/context-chip-rail.tsx` (新): 圈选按钮 + chip 行 + preview 面板
- `src/components/copilot/chat-view.tsx` 从 812 行 → ~280 行，只做 orchestration

toast / i18n 字符串通过 props 传入 hook（解耦 + 未来可测）。

## 为什么

Audit F5：chat-view.tsx 6 个不相关职责（SSE 协议 / streaming / tool result / context chip / message list / textarea）混在一个文件里。已经拆过一次（chat-view-parts），但主文件仍承载核心胶合逻辑。

Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md` §M4

## 怎么验证

自动：
```bash
npx tsc --noEmit && npm test && npm run test:e2e && npm run build
```

手动 9 场景全部通过（详见 commit message + spec §M4 checklist）。

## 向后兼容风险

- 用户可见行为完全不变（UI / 消息 shape / 快捷键 / 动效）
- `data/copilot/<session>.jsonl` 不动
- 所有 PR-3 race fix 注释逐字保留

合并后观察 1-2 天无 regression 再 tag `v0.5.8`。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# M5 · batch-runner Promise pool（F6）

**Branch:** `refactor/batch-runner-promise-pool`（从 main 切）

### Task M5.0: 分支切换

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b refactor/batch-runner-promise-pool`
- [ ] **Step 2:** baseline
- [ ] **Step 3:** Read `src/lib/batch-runner.ts` 全文 + `src/app/api/experiments/[id]/run/route.ts` + `src/app/api/experiments/[id]/stop/route.ts` + CHANGELOG `[0.1.0]` 节（理解最初的暂停/恢复语义）

---

### Task M5.1: 改 `BatchRunner.run` 用 Promise pool

**Files:**
- Modify: `src/lib/batch-runner.ts:139-235`

- [ ] **Step 1: 重写 run 的并发段**

把 L139-208 那段（从 `let running = 0` 到第二个 `while (running > 0)` 的 polling）换成：

```ts
const errors: Array<{ task_id: string; error: string; timestamp: string }> = []
const inFlight = new Set<Promise<void>>()

const runOne = (task: Task): Promise<void> =>
  this.executeTask(task)
    .then(result => {
      appendResult(this.config.id, result)
      completedIds.add(task.task_id)
      completedCount++
      if (result.status !== 'success') {
        failedCount++
        failedIds.add(task.task_id)
        errors.push({
          task_id: task.task_id,
          error: result.error || result.status,
          timestamp: new Date().toISOString(),
        })
      } else {
        failedIds.delete(task.task_id)
      }

      if (typeof result.input_tokens === 'number') totalInputTokens += result.input_tokens
      if (typeof result.output_tokens === 'number') totalOutputTokens += result.output_tokens
      if (typeof result.cost_value === 'number') {
        const ccy = result.cost_currency || 'USD'
        totalCostByCurrency[ccy] = (totalCostByCurrency[ccy] ?? 0) + result.cost_value
      }

      progress.completed_tasks = completedCount
      progress.failed_tasks = failedCount
      progress.completed_task_ids = Array.from(completedIds)
      progress.failed_task_ids = Array.from(failedIds)
      progress.updated_at = new Date().toISOString()
      progress.error_log = errors.slice(-20)
      progress.total_input_tokens = totalInputTokens
      progress.total_output_tokens = totalOutputTokens
      progress.total_cost_by_currency = { ...totalCostByCurrency }
      writeProgress(progress)

      updateExperiment(this.config.id, {
        run_stats: {
          total_tasks: total, completed_tasks: completedCount, failed_tasks: failedCount,
          started_at: progress.started_at,
          total_input_tokens: totalInputTokens,
          total_output_tokens: totalOutputTokens,
          total_cost_by_currency: { ...totalCostByCurrency },
        },
      })
    })
    .catch(() => { /* errors handled in executeTask */ })

  for (const task of pendingTasks) {
    if (this.stopped) break
    const p = runOne(task).finally(() => { inFlight.delete(p) })
    inFlight.add(p)
    if (inFlight.size >= this.concurrency) {
      await Promise.race(inFlight)
    }
  }
  await Promise.all(inFlight)
```

删除旧 `let running = 0; let taskIndex = 0;` + `runNext` 函数 + `workers` 数组 + 第二段 `while (running > 0)` polling。其余（final status 写 `progress.status = 'paused' | 'completed'` 那段）保留。

- [ ] **Step 2: 验证 tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 跑 vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: baseline 全绿（batch-runner 本身没 unit test，但 `store.migrate` 会读 `ProgressState` shape 间接验证）。

- [ ] **Step 4: 手动回归 3 场景（必过）**

起 `npm run dev`，用一个真实小实验（5-10 task）：

**场景 A：快乐路径 concurrency=3 全跑完**
- 点"保存并运行" → 进度条从 0 到 total → status 变 completed
- 检查 `data/results/<id>/progress.json`：status=completed, completed_tasks=N, failed_task_ids 对
- 检查 `data/results/<id>/results.jsonl`：N 行，每行一个 GenericResultRecord

**场景 B：跑到一半点暂停**
- 跑到 3/10 时点"暂停"
- 看 status 变 paused
- `data/results/<id>/progress.json`：status=paused, completed_tasks=3 左右，failed_task_ids=[]（或有 1-2 个因 abort 失败的）
- 继续运行 → 从 3/10 跳到 10/10

**场景 C：精准重试**
- 在一个有 failed task 的实验里点 ↻ 重试（单条）
- 看那条 task 被单独重跑 → success → FailedPanel 上消失
- completed_tasks 保持不变（但因为 readResults dedupe 所以实际计数准）

- [ ] **Step 5: 跑 e2e smoke**

```bash
npm run test:e2e 2>&1 | tail -10
```

Expected: 9/9 pass。

- [ ] **Step 6: Commit**

```bash
git add src/lib/batch-runner.ts
git commit -m "$(cat <<'EOF'
refactor(batch-runner): replace worker-polling with promise pool (F6)

原实现：concurrency 个 worker 各跑 while loop，共享 taskIndex++ / running
counter / setTimeout(100) polling；Promise.all(workers) resolve 不等
in-flight tasks（.then/.catch/.finally 都没 await），后面再一段
while (running > 0) polling 补救。能工作但绕 + 最终 progress 状态靠
时序保证。

新实现：标准 Promise pool —— inFlight Set，每次启动一个 task 加 Set，
满 concurrency 就 await Promise.race(inFlight) 等任一完成，循环结束
Promise.all(inFlight) 等所有完成。停止语义不变（this.stopped + abort
controller），精准 retry / resume 逻辑不变。

手动回归 3 场景: 快乐路径 / 中途暂停→继续 / 单条 retry。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task M5.2: M5 push + PR

- [ ] **Step 1: verify**

```bash
npx tsc --noEmit && npm test && npm run test:e2e && npm run build 2>&1 | tail -5
```

- [ ] **Step 2: push + PR**

```bash
git push -u origin refactor/batch-runner-promise-pool
gh pr create --title "refactor(batch-runner): replace worker-polling with promise pool" --body "$(cat <<'EOF'
## 改了什么

`BatchRunner.run` 的并发控制从 "N workers × while-loop × running counter × 100ms polling × 二段收尾" 换成标准 Promise pool（inFlight Set + Promise.race 等空位 + Promise.all 等收尾）。约 70 行 → 约 45 行。

保留：
- `this.stopped` + abort controller 语义
- resume 分支（从 progress.json 恢复 completedIds / failedIds / token/cost 累加）
- `taskIds` 精准 retry 过滤 pendingTasks
- progress 增量 writeProgress 节奏（每 task 完成写一次）
- final status `paused` / `completed` 写入

## 为什么

Audit F6：原 worker pattern 读起来绕（`running >= concurrency` 检查在 workers 数 == concurrency 时几乎永远 false；Promise.all(workers) 不等 in-flight；二段 polling 补救）。Promise pool 是地道的标准写法，逻辑清楚 + 收尾保证强。

Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md` §M5

## 怎么验证

自动：
```bash
npx tsc --noEmit && npm test && npm run test:e2e && npm run build
```

手动（必过 3 场景，详见 commit message）：
- 快乐路径 concurrency=3 全跑完 → status=completed / results.jsonl 正确
- 跑到一半点暂停 → status=paused → 继续运行从断点续跑
- 精准单条重试 → 只跑那条 → FailedPanel 更新

## 向后兼容风险

- `data/results/<id>/progress.json` 和 `results.jsonl` shape 不变
- `start / stop / run route` API 不变
- 语义上 batch-runner 核心机制替换 → 合适 tag `v0.6.0`（合并 + 实跑 1-2 天稳定后）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 全部 M 合完后

1. **等用户 review + merge 每个 PR**（AI 不自动 merge）
2. **M4 merge 后**观察 1-2 天 → 用户决定打 `v0.5.8`（或跳过）
3. **M5 merge 后**观察 1-2 天 → 用户决定打 `v0.6.0`（或跳过）
4. **CHANGELOG 条目**：用户 tag 时由用户或下一个会话把 `[Unreleased]` 转为 `[0.5.8] / [0.6.0]` 条目
5. **旧 feature branch 清理**：`feat/copilot-*` / `tune/copilot-*` 等已 merge 的本地分支 AI 不碰，用户自己按需清

## 执行约定（给 subagent）

每个 task 打开就先 read 当前 branch 末端 commit 和相关文件；不**假设** baseline。如果 tsc/vitest fail：
1. **不**改 spec/plan 里的期望值迁就现状
2. **不**跳过 step 继续下一个
3. 回报 controller，分析根因

关键 race fix / 行为保留点（各 M 对应段落已标注），subagent 改代码时**逐字保留相关注释**。
