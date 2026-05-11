# Phase 1 Plan · 域核心 4 个 0% 模块单测

> **Source**: [`docs/superpowers/specs/2026-05-10-audit-r2-design.md`](../specs/2026-05-10-audit-r2-design.md) §2 Phase 1 / round 2 报告 #D
> **Scope**: 仅补测，**实现签名零变更**

## 0. 硬约束（写之前读一遍）

- **不改 implementation**：测试不引发 source 改动。`createDatasetFromJson` 用 spread 处理 `description: undefined` 写起来丑也保持丑——"为了好测就改实现" 是 Plan-外偏离（AGENTS.md §5）
- **不改 export 签名**；不补 plan 外的（store.ts 47% / engine.ts 47% / user-schema-store.ts 12%）
- **每模块独立 PR**：branch `test/r2-{module}-coverage` → push → 等 review → merge → 下一模块
- **中间 checkpoint**：模块 1+2 后跑一次 coverage，外推不到 70%+ 即时调 spec 验收（详 §6），不拖到 Phase 1 末

## 1. Fixture 复用策略

3 个有 fs 的模块沿用 `llm-config.migrate.test.ts` 的 chdir + tmpdir 模板：`beforeEach` mkdtempSync + chdir / `afterEach` chdir 回 + rmSync。**inline 不抽 helper**——保持现状。

`ensureSeeds()` 在 chdir tmp 下 `src/lib/seeds` 不存在 → 三个 seed 函数 `fs.existsSync` false 跳过 + 最外层 try/catch 兜底 = silent noop，无需 mock。`result-parser.ts` 纯函数无需 fixture。

## 2. 模块 1 · rubric-store.ts（5 cases · 最简单）

| # | case | API | 边界 |
|---|---|---|---|
| 1 | empty dir → [] | `listRubrics` | sorted, ensureSeeds noop |
| 2 | 多 .json + 1 broken → 2 条 sorted, 不抛 | `listRubrics` | console.error 不验证 |
| 3 | 不存在 → null / corrupted JSON → null | `getRubric` | catch 兜底 |
| 4 | 创建 + 自动 `source: 'user'`；覆盖已有 | `saveRubric` | writeAtomic 行为 |
| 5 | 存在 → true 文件消失；不存在 → false | `deleteRubric` | |

**目标**：stmts ≥ 80%（56 LOC，5 个函数全覆盖即可）

## 3. 模块 2 · result-parser.ts（9 cases · 纯函数）

`parseResponse(raw, schema)` 单一 export。fixture 用 `makeSchema()` factory 构造 minimal `TaskSchema`（output_schema 必填 string property）。

| # | case | 路径 |
|---|---|---|
| 1 | 直接 JSON 成功 | extractJson #1 |
| 2 | ` ```json ` 围栏 + ` ``` ` 无 lang 围栏（合一 it） | extractJson #2 |
| 3 | 首尾花括号 fallback（前后有杂文 + 多对花括号） | extractJson #3 |
| 4 | `<think>...</think>` 剥离 + fenced 混合 | stripThinkingTags |
| 5 | extractJson 全失败 → `"Failed to extract JSON from response"` | extractJson null |
| 6 | schema mismatch → `"Schema mismatch: ..."` | validateJson 路径 |
| 7 | `raw_text_output: true` happy path（剥 think + 整段当 required[0]） | parseAsRawText 主 |
| 8 | `raw_text_output: true` empty → `"Empty response"` | parseAsRawText empty guard |
| 9 | `raw_text_output: true` 无 required + 无 properties → 错 | parseAsRawText property guard |

**目标**：stmts ≥ 80%（71 LOC，CCN 23 主要在 extractJson + parseAsRawText 分支）

## 4. 模块 3 · displays.ts（8 cases）

| # | case | API |
|---|---|---|
| 1 | empty user dir → 5 builtin / user JSON 1 好 1 坏 → builtin 5 + user 1 | `listDisplays` |
| 2 | builtin 命中 / user 命中 / 不存在 / corrupted → null（合一 it 多 expect） | `getDisplay` |
| 3 | id 正则违例 throw + builtin id throw + 成功写 + `source: 'user'` 覆写 | `createUserDisplay` |
| 4 | builtin → false / 不存在 → false / 存在 → true 删 | `deleteUserDisplay` |
| 5 | 非 object / 缺 id / 缺 name / 非法 mode（合一 it 4 expect） | `validateDisplay` 顶层 |
| 6 | mode=table 缺/空 columns / 合法 | `validateDisplay` table |
| 7 | mode=grouped_grid 缺 primary/secondary/cell_columns / 合法 | `validateDisplay` grid |
| 8 | mode=jsx 缺 source / 空 source / 合法 | `validateDisplay` jsx |

**目标**：stmts ≥ 80%（156 LOC，validateDisplay CCN 22 各 mode 分支独立）

## 5. 模块 4 · datasets.ts（8 cases · 最复杂）

| # | case | API |
|---|---|---|
| 1 | 6 类错误（非 object / 缺 id / name / id_field / 空 fields / records）合一 it | `validateDatasetJson` |
| 2 | 成功写双文件 + id 正则违例 + dup id + id_field 不在 fields（4 expect） | `createDatasetFromJson` |
| 3 | 空 → [] / 多文件 + record_count 行数 | `listDatasets` |
| 4 | success + sample.length=5 / not found throw / jsonl missing throw | `getDataset` + `getDatasetSummary` |
| 5 | happy path: 改 name+records 持久化 + `it.each` 平铺 4 个 error（NOT_FOUND / 空 fields / dup keys / id_field 不在 keys） | `updateCustomDataset` |
| 6 | 双文件存在 → true / 只 meta → true / 都没 → false | `deleteCustomDataset` |
| 7 | 各 type 推断（string/number/boolean/array/object/url 6 类）合一 it | `inferFieldsFromJsonl` |
| 8 | parse error 含行号 / empty input / sampleSize 截顶 + total_lines 全量 | `inferFieldsFromJsonl` 边界 |

**目标**：stmts ≥ 80%（200 LOC，10 个 export 函数 / 多分支错误密度最高）

## 6. 中间 Checkpoint（写完模块 1 + 2 后必跑）

```bash
npx vitest run --coverage 2>&1 | grep -E "All files|^\s*lib\s|datasets|displays|result-parser|rubric-store"
```

读出 4 模块当前实测覆盖 + lib/ 整体 stmts。

**判定**：
- 模块 1 + 2 实测 ≥ 80% **且** 用线性外推 4 模块全到 80% 时 lib/ 整体 ≥ 75% → 继续按 spec 跑
- 外推 lib/ 整体 70%~75% → 通报用户，spec §2 验收 75% 调 70%（plan 里改 + commit doc fix）
- 外推 < 70% → 停下找 root cause（可能 4 模块的 LOC 占 lib/ 比 spec 估的低，或 store.ts 拖累超预期）

**为什么这条 checkpoint 重要**：spec 里 56.86% → 75% 的 ~272 stmts 增量是按"4 模块 LOC ≈ stmts"外推出来的，statements 不等于 LOC。Phase 1 末尾才发现数字不达标 = 做完 4 模块面对 "降级 spec 还是再补一个" 的脏选择。提前调比尾盘救火干净。

## 7. PR 流程（每模块独立）

按 AGENTS.md §2 走，针对本 Phase 的特化：
- branch `test/r2-{module}-coverage`，顺序锁死：rubric-store → result-parser → displays → datasets
- 测试文件 `src/lib/__tests__/{module}.test.ts`；本地验证 `npx tsc --noEmit && npm test && npm run knip && npx vitest run --coverage 2>&1 | grep "{module}"` 确认 ≥ 80%
- CHANGELOG `[Unreleased]` 加 `### 测试 (#R2-D)` 一条草稿
- PR description 4 段必含；向后兼容风险栏 = "纯增量、零行为变更"
- **不自合**——等用户 review；merge 后 `git branch -D` 进下一模块
- 模块 2 PR merge 后**先跑 §6 中间 checkpoint**再写模块 3

## 8. 不在本 plan 的事项

- e2e / Copilot lib 测试补丁 / store.ts engine.ts user-schema-store 提覆盖：本 Phase 不做
- 公共 fixture 抽 `__tests__/_fixtures.ts`：单测 inline 即可
- 性能 / 时间断言：不引入
