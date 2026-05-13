# Sample Data Redesign — Failed Attempt 1, Lessons Learned

- **Date**: 2026-05-13
- **Failed branch**: `feat/sample-data-redesign` (24 commits, ~6 hours impl + ~¥100 真钱跑实验)
- **Status**: 用户 reject + 全部回滚到 main，未开 PR
- **Audience**: 下一轮 sample data 设计的 planner session
- **✅ Follow-up STATUS**: V2 已 ship v0.16.0（[`spec`](../specs/2026-05-13-sample-pcw-copywriting-design.md) + [PR #98](https://github.com/kuen54/evalyst/pull/98) + [release](https://github.com/kuen54/evalyst/releases/tag/v0.16.0)）。本 doc §6.1 4 个 product 问题已答（业务评测员 / 跨 prompt 对比 / 探索期 / 动手建第一个 evaluation）+ §6.4 全部硬约束闭环 + §6.3 选了"商品文案改写"场景。**§7 backlog 待做：生图 sample（PR #2 of stream）+ 多 display 形态（PR #3 of stream）**。

> 这不是技术失败——5 件套全绿、7 个 display 浏览器实测全过、4 套 experiment 跑出 580/616 success records。**是产品判断 + 设计判断失败。** 用户拒绝得对。

## 1 · TL;DR — 失败 4 个根因

用户最终评价（一字未改）：

1. 大量任务没跑完或者失败
2. 没有控制变量的感觉，很多实验只有一组，在对比页面都看不出来
3. 很多实验在展示的时候看不到题目是啥，只有结果
4. 测试集都挺扯的，大部分用户都看不太懂

每条都对，且每条都不是写更多代码能解决的——是 sample data 该怎么设计本身的方向问题。

## 2 · 4 条用户批评 — 解剖

### 批评 1：大量任务没跑完/失败

**事实**：4 套 experiment 共 616 records / 580 success（94.2%）：
- GSM8K: 180 / 173（7 条 kimi timeout）
- BELLE: 240 / 219（21 条 kimi abort）
- PartiPrompts T2I: 136 / 128（8 条 image-gen timeout）
- VQA pointing: 60 / 60 ✓

UI 详情页 banner 直观显示"已完成 109/120 失败 11"——**对开箱体验是粗糙的**。

**根因**：sankuai gateway capacity（kimi-k2.6 RPM ~5，每条调用要 ~5-10s，超 60s timeout 就算 fail；image-gen 240s 仍偶发挂）。我打 60s 硬超时硬加快失败速度，但这换来的是表面上的"挂"。

**真正的教训**：sample data 是**橱窗**，不是**真实评测**。橱窗 100% 完美，真实评测才该有失败案例。下一轮：要么把所有失败 record 从 ship 数据里 strip 掉做成"全绿"；要么干脆不跑真 LLM，**手工编 perfect 输入输出对**做成种子。

### 批评 2：没有控制变量 / 对比页看不出来

**事实**：spec 设计是"compare_group=gsm8k_v1 三个 schema 横向对比 CoT vs Direct vs Few-shot"，但：

- evalyst experiment 详情页 `/experiments/{id}` 只渲染**一个 schema**的 results（`experiment.schema_id` 固定）
- 跨 schema 对比走独立的 `/compare` 页面，需用户主动 pick 2 schemas
- 我 ship 的 `gsm8k_compare_v1` 名字带"compare"但实际只挂 `gsm8k_cot_v1`，看不到"vs Direct vs Few-shot"
- 后期我"补救"切了 3 个 demo 子实验（`gsm8k_direct_demo` / `gsm8k_fewshot_demo` / `belle_persona_demo`）——但每个仍是单 schema 单角度，没解决"对比"语义

**根因 1**：我把 "compare_group" 字段当成了 UI 自动展开的"对比组"，**它实际只是 schema 的 metadata tag**——运行时没有任何组件用它来自动聚合。需要人去 `/compare` 手动选两个 schema。

**根因 2**：spec 写"sample experiment 名称 = CoT vs Direct vs Few-shot"，我盲信了 spec 名字+ 数据，没验证"用户从详情页能看到对比"的体验闭环。

**真正的教训**：
- "对比"不是数据组织问题，是**展示形态问题**。三象限 7-display 矩阵里没一个原生支持"同 record × N 模型 × M prompt 排成一行"
- 下一轮 planner 必须先在 evalyst 现有 UI / 组件里**找出真正能呈现对比的入口**（要么 `/compare` 页，要么需要新的 cross-schema/cross-model 组件），再据此倒推 sample 数据怎么组织
- 如果 evalyst 当前没合适的对比组件，**先做组件 / `/compare` 入口体验，再做 sample 数据**

### 批评 3：看不到题目，只有结果

**事实**：默认 builtin display（single_list / dual_list / triple_grid）渲染 result 时**只列 output 字段**（steps / final_answer / confidence / answer / image_url），question / prompt / referring_expression 这些 input 都在 `input_preview.q.question` 但默认不展示。要展示题目必须显式配 `display_dimensions` 加 `header_fields` 引用 input_preview 字段。

我配的 7 个 schema 里：
- 配对了的：gsm8k_compact_table（自定义 table）/ gsm8k_step_card（自定义 jsx）/ vqa_pointing_overlay（自定义 jsx）/ belle_persona_grid（自定义 grouped_grid）—— 都是 user display
- **没配的**：gsm8k_cot_v1（builtin_single_list）/ belle_plain_v1（builtin_dual_list）/ parti_t2i_v1（builtin_triple_grid）—— 都是默认 builtin

builtin display 对 input_preview 的展示**取决于 schema.display_dimensions[].header_fields**。我的 schema 大部分只配了 `display_dimensions: [{field: "input_preview.q.difficulty"}]`——一个分组键，没 header_fields，所以列表里只有"easy/medium/hard"档位标签 + output 内容。题目不见。

**根因**：display_dimensions 的 header_fields 对体验至关重要，但 spec / plan 里都没强调。我按 spec 的 minimum config 跑，没补足。

**真正的教训**：
- **每个 sample schema 必须在 display_dimensions 里显式配 header_fields 把 input 文本带进展示**——否则用户进详情页看到一堆没 context 的 output，体验等于 0
- 下一轮 planner 要把"input 在 UI 上能不能看到"作为每个 schema 的硬约束写进 plan

### 批评 4：测试集挺扯，大部分用户看不懂

**事实**：我选了 4 套 dataset：

| Dataset | 内容 | 用户共鸣度 |
|---|---|---|
| GSM8K | 小学数学应用题 | 极低 — 评测员关心，普通用户"why am I solving math?" |
| BELLE-eval | 中文 alignment 任务 | 中 — 但 10 类太杂，无统一场景 |
| PartiPrompts | T2I prompt（学术 benchmark） | 极低 — "Salvador Dalí"这种 prompt 普通人不懂 |
| RefCOCO | CV 视觉指代任务 | 极低 — 学术 benchmark |

**根因**：我选的全是 ML 研究员的 benchmark dataset。评测平台的目标用户**不是 ML researcher**，是想用 LLM 做活的产品/运营/工程师，他们想看的是：
- "总结一段客服工单" → 看摘要质量 / 抽 SLA
- "给这个商品写小红书标题" → 看吸睛度 / 主流程
- "邮件改写 / 翻译" → 看忠实度 + 流畅度
- "从发票文本抽 5 个字段" → 看字段命中率
- "客户反馈情感分类" → 看准确度 + 边界

**真正的教训**：sample data 是 **demo 场景**而不是 **research benchmark**。下一轮 planner 必须从用户角度选场景：
- **痛点驱动**：评测员实际想测什么场景？（写作 / 总结 / 抽取 / 分类 / 翻译 / Q&A）
- **任意 LLM 通用**：不要选只能某些模型做的（生图 / 多模态视觉），选纯文本任务（任何 LLM 都能跑）
- **数据可读**：input 一眼看懂，output 一眼能判断好坏
- **无版权问题**：手工编 30-60 条 input 比从 GitHub 抽 benchmark 更省事

## 3 · 设计层失败 — 跨批评的共同根因

### 共同根因 A：spec 写得太"技术先行"，没从用户视角验证体验闭环

原 spec 围绕 "三象限 × 7 display 形态全覆盖" 来设计。我 100% 按 spec 实现了——但实现完之后发现：

- 三象限里 **C1 多模态生图 / C2 视觉理解** 占 50% 篇幅，对纯文本评测平台用户基本无感
- 7 display 全覆盖是**功能矩阵思维**，不是**体验优先思维**——用户不在乎"display 形态够不够多"，在乎"打开页面能不能直接看出 LLM 表现"
- spec 的"CoT vs Direct vs Few-shot"对比叙事没在 UI 上**实际验证过**就当成数据组织依据

**教训**：plan 验收**不能止步于"7 display 都能渲染"**，必须包含"打开任一 sample experiment，外行 30 秒能看懂这是干嘛 + LLM 跑得怎么样"的视觉验收。

### 共同根因 B：选的数据集与产品定位错位

evalyst 是给"团队给自己产品做 LLM 调优"用的工具。它的甜点用户是**有具体产品场景**的人。研究员有自己的 benchmark suite（lm-eval-harness 之类），不需要 evalyst 这一层。

我做 sample 时一头扎进开源 benchmark（GSM8K / BELLE / PartiPrompts / RefCOCO），但这些**只对 ML 研究员有意义**。产品评测员看到这些会觉得"这是给学者用的，不是给我用的"。

**教训**：sample data 第一句话应该回答"演示给谁看"，再倒推选场景。

### 共同根因 C：evalyst UI 当前不擅长"对比" → 我硬塞"对比"故事

`/experiments/{id}` 只展示**一个 schema** 的结果。`/compare` 是另一条路径，体验偏隐藏。我的 sample data spec 卖点是"CoT vs Direct vs Few-shot"——但 UI 上根本没有 "vs" 的展示。

**教训**：**先确认 UI 能讲什么故事，再选 sample 故事**。如果 evalyst UI 当前讲不了"prompt A vs prompt B"，sample 就别讲这个故事，讲它擅长的（"看 LLM 在 60 条不同输入上的表现 + 多维评分分布"）。

### 共同根因 D：display_dimensions 的 header_fields 不是可选 nice-to-have

只有 header_fields 把 input 字段（题目 / 文本）带进 builtin display 的标题区，用户才能看到上下文。我 schema 都没配，也没在 plan 里把它列为硬约束。

**教训**：**header_fields 是 sample schema 的必填字段**——任何 sample schema 在 plan 阶段都要明确 display_dimensions[].header_fields 列哪些 input。

## 4 · 技术陷阱 — sankuai gateway + evalyst 组件的具体限制

下一轮 planner 跑数据前要知道这些（避免重蹈覆辙）：

### Sankuai gateway 状态（2026-05-12 实测）

| Model name | 状态 | 备注 |
|---|---|---|
| `gemini-3.1-pro-preview` | ✅ chat OK | 主力文本模型 |
| `aws.claude-opus-4.6` | ✅ chat OK | api_format=anthropic + Bearer prefix |
| `kimi-k2.6` | ⚠ chat OK 但 RPM ~5 + ~30% timeout 率 | **temperature=1 only**，其他值 400 |
| `gpt-4o-mini` | ✅ chat OK | 文本 judge 用 |
| `gpt-4o-2024-11-20` | ✅ chat OK | vision judge 用，**`gpt-4o` 不支持** |
| `gpt-image-1` | ✅ images_generations OK | gpt-image-2 长期 429 EngineOverloaded |
| `gemini-2.5-flash-image` | ⚠ 必须走 `/v1/google/models/{model}:imageGenerate` 异步 submit+poll | **chat/completions 上有 "bound must be positive" gateway bug**，所有 Gemini image 系列都中招 |

下一轮如果只跑文本任务，stick to opus + gpt-4o-mini，最稳。

### evalyst 组件限制

1. **`builtin_bubble_overlay` 期望 array-of-object output shape**——`{ bubbles: [{point, label}] }` 而不是顶层 `{ point, label }`。要 demo 单点定位，要么改 schema 包成数组，要么写自定义 jsx display
2. **`builtin_triple_grid` cellMap last-wins**——同 (rv, cv) cell 多 result 时只保留最后一个。所以 "1 schema × 2 model × N record" 会被压成 1 result/cell（只看到一个模型）
3. **JSX display 在 SVG 上必须用 camelCase 属性**（strokeWidth / strokeDasharray），不是 kebab-case
4. **图 URL 必须考虑 sandbox**：网关从 server 端 fetch 不到 `localhost:3000` 也 fetch 不到 sankuai 内网 S3——多模态 image 输入要 base64 inline data URL（不是 https URL）
5. **gpt-image-1 返回 base64 inline**（不是 URL），需要 runner 自己提取 + 落盘 + resize（sips 或 imagemagick）
6. **Phase 2 PR 96 的潜在 bug**（已修）：seed.ts 默认把 `results/*.jsonl` flat copy，但 readResults 期望 `data/results/{exp_id}/results.jsonl` 嵌套结构。本次修复方案：seeds/results/{exp_id}/{results,annotations}.jsonl 镜像 runtime + seed.ts `seedResultsTree()` 递归 copy。**这部分修复随回滚一起没了，下一轮要重做**

### 跑实验的工程教训

1. **kimi 必须 temperature=1**，runner 要 special-case
2. **per-call 60s timeout**（用 AbortController）比 llm-client 默认 120s × 3 retry 快 6 倍 fail
3. **image-gen 走 240s timeout**（gpt-image-1 富 prompt 单次 30-90s 正常）
4. **runner skip-if-exists**（`data/results/{exp_id}/results.jsonl` 已存在跳过）让中断恢复友好——不重跑就不烧钱
5. **data 写路径必须按运行时约定**：`data/results/{exp_id}/{results,annotations}.jsonl`（嵌套），不是 flat `data/results/{exp_id}.jsonl`
6. **image inline + judge inline 的两个隐藏陷阱**：(a) input image base64 inline 进 user message；(b) judge 调用时 https URL（gemini S3）也要主动 fetch + base64 inline，不能直接 pass URL（vertex/anthropic gateway 都 fetch 不到内网 S3）
7. **image-store 已有 `saveImagesForTask()`** 可以复用 base64→落盘+resize 的逻辑——下次 runner 别绕过它自己手写

## 5 · 已经留在 main 的可复用脚手架

以下东西回滚后**仍在 main**，下一轮可以接着用：

- ✅ **PR #95 (`feat/llm-client-images-generations`)**：`ApiConfig.endpoint_kind = 'images_generations'`，OpenAI Images API 端点支持。已合 main
- ✅ **PR #96 (`refactor/seed-scan-subdirs`)**：seed.ts 扫子目录机制 + 单测。已合 main，但**有 results/annotations 嵌套 vs flat 的 bug**——下次要修

回滚抹掉的（如果下次重做要重写）：

- ❌ `scripts/build-sample-data.ts` —— GSM8K / BELLE / PartiPrompts / RefCOCO 拉取脚本（zero-dep fetch + 抽样）
- ❌ `scripts/run-sample-experiments.ts` —— batchRun + judges + base64 inline + abort + skip-if-exists
- ❌ Google native imageGenerate submit+poll helper
- ❌ seed.ts `seedResultsTree()` 修复

下次如果选纯文本场景，build-sample-data + run-sample-experiments 大半都不用——真正要的可能是个 30-100 行的"读 csv → batchRun → 写嵌套 jsonl"的小脚本，比这次少 80% 复杂度。

## 6 · 给下一轮 planner 的具体建议

### 6.1 重新定 brief

planner 第一步**不**是写新 spec，是回答 4 个 product 问题：

1. **演示给谁看**？（普通产品评测员 vs ML researcher vs 内部老板）
2. **演示主信息是什么**？（"evalyst 能跑批 + 多维评分" vs "evalyst 能跨 prompt 对比" vs "evalyst 支持多模态"）
3. **演示前用户带着什么问题**？（"这工具值得我接入吗" vs "我已经决定用了，怎么开始"）
4. **演示后用户带走什么动作**？（"开始建自己第一个 schema" vs "找文档看怎么对比")

带着这 4 个答案再去看现有 spec / 这份 lessons。**1-2 答案变了，整个 sample 数据组织方式都变。**

### 6.2 选场景的硬约束（建议）

任何下一轮 sample 场景必须同时满足：

- 纯文本任务（不需要图 / 不需要多模态）
- input 一句话 / 一段话能讲清楚（< 200 字）
- output schema 简单（< 5 字段，类型 string / number / enum 为主）
- 评分维度 ≤ 5（pass_fail + 1-2 个 likert + 0-1 个 score）
- 跨场景内聚（同一类业务任务的 5-10 条变体，不要 10 个 BELLE 类的混杂）
- 数据 30-60 条够 demo（不需要凑 60 / 80 / 240 这种"benchmark size"）
- **可手工编**——打消"必须从开源 benchmark 拉"的执念

### 6.3 推荐场景方向（任选 2-3 套）

| 场景 | 任务 | 评分维度 |
|---|---|---|
| 客服工单总结 | 给一段客服对话 → 输出 3 句话摘要 + 客户情绪 + 升级建议 | 准确度 / 简洁度 / 情感命中 |
| 商品文案改写 | 给商品参数 → 输出小红书标题 / 抖音脚本 / 朋友圈文案 | 吸引力 / 关键词命中 / 风格 |
| 中英邮件互译 | 中文邮件 → 英文 / 英文 → 中文 | 忠实度 / 流畅度 / 礼貌等级 |
| 发票字段抽取 | 一段发票 OCR 文本 → JSON 抽 6 字段 | 字段命中 / 类型正确 / 边界鲁棒 |
| 用户反馈分类 | 一句反馈 → label + 紧急度 + 主题标签 | 分类准确 / 紧急度合理 |

每个上面 30-50 条手工编输入，pre-curate 完美 outputs（或跑一次 GPT-4 拿 reference），ship。

### 6.4 plan 验收硬约束

下次 plan 必须包含：

- [ ] 每个 sample schema 的 display_dimensions[].header_fields 必须在 plan 里写明（不能"按 spec minimum config 跑"）
- [ ] 至少 1 个验收条目要求"打开任一 sample experiment 详情页，30 秒外行能看懂任务 + LLM 表现"
- [ ] 跑数据前先**验证 UI 可视化路径**：每个 schema 的 display 在浏览器打开渲染，input + output 都可见，再批量跑
- [ ] sample 实验的 results.jsonl **不能含 status=error 记录**——失败的全 strip 掉再 ship（demo 是橱窗）
- [ ] 选模型时**避开 kimi**（除非有非用不可的理由）—— RPM 太低，timeout 率高
- [ ] 不要碰多模态（图 / vision judge）——用纯文本完成 demo

### 6.5 工程建议

- 不要再尝试用 evalyst 现有的 `compare_group` 字段做"对比" demo——这字段当前没 UI 自动展开行为
- 真要做对比 demo，先让 evalyst 加一个"在详情页同 record 横向看 N 个 model 输出"的组件（这个本身可能是单独 PR）
- 重写一个轻量 `scripts/run-samples.ts`：读 csv → callLlm → 写嵌套 jsonl。不要复用我那个 ~700 行的版本（耦合 sankuai gateway 太多）

## 7 · 附录 — 这次实测留下的资源数据（供决策参考）

回滚之前跑出来的真数据汇总（已删，但记录下次决策参考）：

- GSM8K mini 80 records / 3 schema × 2 model × 30 records = 180 results / 173 success
- BELLE-eval mini 60 records / 2 schema × 2 model × 60 = 240 / 219
- PartiPrompts mini 68 records / 1 schema × 2 model × 68 = 136 / 128
- RefCOCO mini 30 records (25 unique images) / 1 schema × 2 model × 30 = 60 / 60
- Total cost: ~¥80-100（含 4 套 judge 标注）
- Total wall time（含调试 + 撞墙 + 重跑）: ~6 小时
- 最终用户判断：**全部不要**

下次如果选 30 条 × 2-3 schema × 1-2 model = 60-180 records 纯文本任务，预算 ~¥5-15 / wall time < 30 分钟。**比这次便宜 5-10 倍，质量上限更高**。

---

*written by failing claude session, 2026-05-13. read it cold.*
