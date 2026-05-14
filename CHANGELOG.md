# Changelog

按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 风格记录。版本号是松散里程碑，不是 semver —— 这是一个持续演化的工具，不是承诺 API 稳定的库。

Tag 打在特性**稳定且短期不再改**的点上（不是每次 PR merge 都打）。Polish 迭代应攒到 `[Unreleased]` 里，整合后再一起 tag。详细规范见 `AGENTS.md` §Tag + 版本号 / §CHANGELOG 规范。

每个版本对应的 git tag 见 [Releases](https://github.com/kuen54/evalyst/releases)；每个条目的 commit 范围可以在 `Compare <prev>...<this>` 里看到完整 diff。

---

## [Unreleased]

### Added

- **Sample suite "商品配图"（生图）** —— sample-data-redesign stream **PR #2 of 3**。镜像 v0.16.0 商品文案 demo 的「跨 prompt 对比」叙事到生图场景：
  - **3 Schemas（同 `compare_group="product_image_v1"`）**：`pcw_xhs_image_v1`（小红书插画 / 无字）、`pcw_douyin_image_v1`（抖音封面高对比 / 无字）、`pcw_friends_image_v1`（朋友圈生活感 / 无字）。**全部 1:1 方图统一比例**——sankuai gateway gemini imageGenerate 不接 aspect ratio param，所有图实际都是 1:1，display 与实际 output 显式对齐；3 prompt 全不带任何文字（gemini 中文字渲染不稳，v1 让 douyin 带中文钩子实测大部分错字 / 乱码已撤回）。**复用 v2 `product_copywriting_v1` dataset**（不重新写 dataset）—— 业务评测员看完文案 demo + 配图 demo → 理解 evalyst 「跨 prompt 对比」框架对任意 LLM 任务（文本 / 图像）通用。
  - **3 Sample experiments × `gemini-2.5-flash-image` × 20 records / experiment = 60 records**（每品类抽 3-4 条）。`pcw_xhs_image_baseline` 17 success / `pcw_douyin_image_baseline` 20 success / `pcw_friends_image_baseline` 20 success = **57 success / 60 = 95%**（3 fail 来自 sankuai gateway 拒生成 `no image url in response`，retry 仍 fail，已 strip per lessons §6.4 #4；选择性 retry 已修 2 张 mojibake xhs 图片）。
  - **不带 judge / 不带 annotations**（lessons §6.4 #6 红线 buffer）—— vision judge 是禁项；文本 judge "评 prompt 而非评图"叙事错位；**留给业务评测员进 evalyst annotation UI 自打分**最贴他们真实工作流，且凸显 evalyst 「人标注」能力。
  - **57 张 768×768 PNG ship 进 git**（~46 MB seeds 增量；sips resize 自 1024×1024 原图 ~2 MB 压到 ~800 KB / 张）。注意：商品本身带标签 (果汁瓶 / 咖啡袋 / 化妆品罐) 的 ~4 张图 gemini 会渲染商品的实际 label，prompt "不要文字" 在这种情况下让位"商品如实呈现"——这是模型限制，不是 demo 缺陷。
- **`scripts/run-pcw-image-samples.ts`** —— zero-dep ~280 行 standalone runner（**不走 evalyst llm-client**：sankuai gateway gemini google native imageGenerate 端点是异步 submit + poll，evalyst 现 `endpoint_kind=images_generations` 只支持 OpenAI Images API，未集成 google native）。含 RPM=5 sliding-window submit 限流 / 5s poll 间隔 / 240s/task timeout / sips resize 768px / skip-if-exists / 嵌套写 `data/results/<exp_id>/{results.jsonl, images/}` / 用 `buildInputPreview` 输出 canonical 扁平 input_preview shape。`SANKUAI_KEY=xxx npm run run:pcw-image-samples` 入口。
- **`scripts/run-pcw-image-samples.ts` 启动时 eagerly load 所有 schemas 到内存** —— 防御性设计，跑长时（RPM=5 → ~12-15 min wall）期间 user 切 branch（schemas 文件消失）不会让后续 experiments 崩 ENOENT。

### Fixed

- **`src/lib/seed.ts:seedResultsTree()` 改递归 copy `<exp_id>/` 子目录**（含 `images/` 嵌套）—— 之前只 copy `.jsonl` 扩展名，PNG / 任意嵌套文件全部 silent drop。修法：用新加的 `copyTreeIdempotent()` helper 递归 walk + 幂等跳过已存在文件。8 老 + 1 新单测覆盖。这是 PR #2 demo "fresh boot 后图能渲染"的前置依赖。

## [0.16.0] — 2026-05-13 · sample-pcw-copywriting + header_fields renderer fix (PR #98)

V1 sample data 全废 + lessons 沉淀（v0.15.0）后第一个**ship 成功**的 sample suite。1 PR / 6 commits / 4 角色（spec / fix / data / runner）/ 2 轮 opus QA 浏览器实测（第 1 轮发现 lessons §6.4 #3 红线复刻 → 修 → 第 2 轮全绿）。Lessons §6.4 全部硬约束闭环。

### Added

- **Sample suite "商品文案改写"**（PR #98）：
  - **Dataset** `product_copywriting_v1` — 60 条手编商品（6 品类 × 10 条平衡：美妆/数码/食品饮料/家居/服饰/母婴），input ≤ 200 字，业务评测员一眼能代入"自家产品也能用 evalyst 测"。**手编** vs v1 走开源 ML benchmark（lessons §1.4 批评 #4 闭环——业务评测员不是 ML researcher）。
  - **3 Schemas（同 `compare_group="product_copywriting_v1"`）**：`pcw_xhs_v1`（小红书风：emoji + "姐妹们" + 3-5 hashtags）、`pcw_douyin_v1`（抖音脚本风：钩子开头 + 分段 5-10s 口播 + CTA）、`pcw_friends_v1`（朋友圈风：≤ 80 字 + 口语 + 无 hashtag）。配合 [`/experiments/{id}` 详情页"对比"按钮（v0.15.0 PR #97）](https://github.com/kuen54/evalyst/pull/97)，user 一键看 3 列横排。
  - **Rubric** `pcw_quality` 5 维（pass_fail × 1 + likert × 3 + score 0-100）+ judge prompt `pcw_quality.judge.md`（含 `{{platform_style}}` 注入）。
  - **3 Sample experiments 预跑结果 ship 进 git**（claude-opus-4-6 主跑 + gemini-3.1-pro-preview 当 judge fallback）：pcw_xhs_baseline 59 records (1 prod_055 截断已 strip) / pcw_douyin_baseline 60 / pcw_friends_baseline 60。共 **179 records / 179 annotations 全 status=success**（lessons §6.4 #4 strip 闭环）。Overall_score avg 92-94（opus 太强 + gemini judge 偏宽，76% TIE on overall）→ demo 主信息是"voice 控制能力"而非分差排名。
- **`scripts/run-pcw-samples.ts`** — zero-dep ~290 行 sample runner，含 skip-if-exists / strip status=error / model candidate fallback（`claude-opus-4-6` → `aws.claude-opus-4.6`；`gpt-4o-mini` → `gemini-3.1-pro-preview`）/ 嵌套写 `data/results/<exp_id>/{results,annotations}.jsonl`。`npm run run:pcw-samples` 入口。
- **`src/lib/compare-helpers.ts` 新增 `rowLabel()`** — 优先读 `schema.display_dimensions[].header_fields` 显式声明（支持 `input_preview.p.name` / 裸 `p.name` 两种路径，array 字段用 `、` 拼接，长值截 60 字符 + …），fallback 时跳过值等于 ref id 的 pid/qid/vid 字段。8 个新单测覆盖各场景。

### Fixed

- **`src/components/results/single-list-results.tsx` 渲染 `display_dimensions[].header_fields`**（PR #98 / commit a045bac）：闭环 lessons §6.4 #3 红线"看不到题目，只有结果"——schema 配齐了 header_fields 但 `single_list` renderer 之前不读，每行只看到 `prod_001` + output。修后每条 row card 顶部显示"商品: 轻氧空气感蓬蓬粉 · 目标用户: 25-35 岁通勤女性 · 价: ¥158"，与 `dual_list` / `triple_grid` 对齐。多 dim 的 header_fields 自动去重合并。
- **`/compare` 页 `rowLabel` 从 first-non-id 改为读 schema header_fields**（PR #98 / commit a045bac）：之前 fallback 取 `p.pid` 当 label 显示成 `p#prod_001 · prod_001`（id-equal 退化）。现在优先 schema 显式声明，fallback 时也跳过值等于 ref id 的字段。新 rowLabel 抽到 `compare-helpers.ts` 便于单测。
- **`src/lib/seed.ts` `seedResultsTree()` 替换 flat `KINDS` 中 'results'/'annotations' 项**（PR #98 / commit 3873e0c）：闭环 lessons §4.6 已识别 PR #96 bug——KINDS flat 'results'/'annotations' 子目录与 evalyst runtime 期望嵌套结构 `data/results/<exp_id>/{results,annotations}.jsonl`（`src/lib/store.ts:132` + `src/lib/annotation-store.ts:14`）不一致。新 `seedResultsTree()` 递归镜像 `<exp_id>/` 子目录，顶层散文件不收（强制 sample 走嵌套约定）。3 个新单测。
- **`scripts/run-pcw-samples.ts` judge max_tokens 1024 → 4096**（commit 919c753）：跑数据时发现 gemini-3.1-pro 把 thinking 也算 tokens，1024 经常 `finish_reason=length` 截断 JSON → annotation.scores 写空 `{}`。第一轮跑出来 179 annotations 全 empty，bump 后清空重跑全 valid。

### Tests

新增 28 个单测（vitest 853 / 84 全绿）：
- compare-helpers: 12 旧 + 8 新（rowLabel header_fields 优先 / 数组拼 / 长值截 / 路径形态 / 空值跳 / fallback 跳 ref-id-equal / multi-alias）
- seed: 5 旧 + 3 新（seedResultsTree 嵌套镜像 / 顶层散文件跳过 / 嵌套幂等）

### Why

闭环 v0.15.0 lessons doc 立的 §6.4 全部硬约束 + §6.1 4 个 product 问题（业务评测员 / 跨 prompt 对比 / 探索期 / 动手建第一个 evaluation）：

| 维度 | v1 (failed v0.14.x stream) | v2 (this v0.16.0) |
|---|---|---|
| 数据源 | 4 套 ML benchmark | 1 套手编业务场景 |
| Records | 616（580 success / 36 fail） | 179（179 success） |
| 模型 | 7 个含 kimi（30% timeout 率） | opus + gemini judge |
| 多模态 | 是（生图 + VQA） | 否（纯文本） |
| 预算 | ~¥100 | ~¥14 |
| Wall time | ~6 小时 | ~60 分钟（含一次 judge bump 后重跑） |
| QA 实测 | 全绿但 user 仍 reject | 2 轮（第 1 轮发现 gap → 修 → 第 2 轮全绿） |
| 用户验收 | 4 条批评全废 | sample data 本 PR ship + lessons §6.4 #3 渲染 gap 一并修 |

### Backlog（不在 v0.16.0 scope）

- PR #2 of stream：生图场景 sample（独立 sample suite，待写新 spec）
- PR #3 of stream：多 display 形态覆盖（table / grouped_grid / jsx / triple_grid / bubble_overlay）
- 加 weaker baseline schema 拉开 score spread（如有需要 user 决定）

## [0.15.0] — 2026-05-13 · compare entry + sample-data-redesign post-mortem (PR #95 + #96 + #97)

3 PR ship + 1 大 PR 失败回滚的复合 stream。原计划是 4 PR 联动的 sample data redesign（GSM8K / BELLE / PartiPrompts / RefCOCO 三象限 + 7 display 全覆盖），前 2 PR 基建顺利合上，主体 PR 3 跑出 580/616 records ~¥100 真钱后被用户全数 reject + 全部回滚到 main。教训沉淀到 [`docs/superpowers/findings/2026-05-13-sample-data-redesign-lessons.md`](docs/superpowers/findings/2026-05-13-sample-data-redesign-lessons.md)（250 行，4 条批评解剖 + 共同根因 + sankuai gateway 实测表 + evalyst 组件限制清单 + 给下一轮 planner 的 §6.1 4 个 product 问题）。

转向修最 root 的痛点：lessons §3.C 揭示 evalyst UI 当前不擅长"对比"故事——用户从详情页找不到 `/compare` 入口。PR #97 加了详情页「对比 (vs N)」按钮闭环这条。Sample data 自身重做留待下一轮（要先答 §6.1 4 个 product 问题）。

### Added

- **llm-client OpenAI Images API 端点支持**（PR #95）：`ApiConfig` + `ModelConfig` 新增可选字段 `endpoint_kind: 'chat' | 'images_generations'`（默认 `'chat'`，向后兼容）。`callLlm` 入口按 endpoint_kind 分发；`callImagesGenerations()` helper 构造 OpenAI Images API body（model/prompt/size/quality），POST 到 `${base}/images/generations`，解析 `data[0].b64_json` → `LlmResponse.images[0]`（与 chat 端点 image 输出 shape 对齐，下游 image-store / display 完全复用）。`/settings/llm` UI 加"端点类型"下拉。i18n key（zh/en 成对加 4 个）。5 个新单测覆盖请求 body shape / b64_json 解析 / bare url 解析 / HTTP 4xx / 429 retry。副产物 fix：`callImagesGenerations` 取最后一条 user 消息时 `LlmMessage` discriminated union 需要 narrow 才能读 content。
- **`/experiments/{id}` 详情页「对比」按钮**（PR #97）：toolbar 加按钮，文案动态 `对比 (vs N)`（N = 同 compare_group 但 ≠ current 的 completed/paused experiments 数量），N=0 时 disabled + tooltip。点击跳 `/compare?ids=<currentId>,<other1>,<other2>...` 默认全部预选。`/compare` 页用 `useSearchParams` 接 `?ids=...` 自动初始化 `selectedIds`（首次 experiments 拉到后一次性 hydration，autoSelectedFromQuery flag 防重复触发）；Suspense wrap 满足 Next.js 16 prerender 要求。新增 `src/lib/compare-helpers.ts` 提供 3 个 pure helper（`compareGroupOf` / `findComparableExperiments` / `buildCompareHref`），12 个新单测覆盖各场景（自身排除 / 显式 group / fallback 到 schema id / 跨 schema 同 group / unknown schema）。i18n 加 3 个 key（zh/en 成对）。Opus subagent Playwright 实测 4 路径 3 Pass + 1 skip（数据无 running/draft fixture），console 0 error。

### Changed

- **`src/lib/seed.ts` 从硬编 id 列表改为扫子目录**（PR #96）：8 个老 seed 文件 git mv 到 `src/lib/seeds/{datasets,schemas,rubrics}/` 子目录（schema/rubric 文件名同时去掉 `.schema`/`.rubric` 中缀，统一为 `<id>.json`）。`ensureSeeds()` 用新 `seedFromDir(srcSubdir, dstDir, allowedExts)` helper 扫 7 个 kind 子目录（datasets/schemas/rubrics/displays/experiments/results/annotations）+ 新增 `seedSampleImages()` 拷 `src/lib/seeds/images/` 到 `public/sample-images/`。幂等性保留（existsSync 跳过 / 用户删除后下次访问恢复）。5 个新单测覆盖：empty-tree seed / existing-file skip / deleted-file restore / .gitkeep filter / public/sample-images copy。**老 sample 数据语义不变**——文件物理位置变了但内容 / id / 数据 shape 完全不动。

### Reverted

- **Sample data redesign 主体 PR（branch `feat/sample-data-redesign`）全部回滚**：原计划 ship 4 套 dataset (GSM8K / BELLE / PartiPrompts / RefCOCO) + 7 schema + 4 rubric + 3 user display + 4 sample experiment（含 580 records 预跑结果 + 580 LLM-judge annotations，~¥100 真钱跑完）。**用户 reject** 4 条原因（lessons §1）：(1) 大量任务没跑完/失败；(2) 没有控制变量的感觉，对比页面看不出来；(3) 看不到题目，只有结果；(4) 测试集挺扯，大部分用户看不懂。本地 + origin branch 已删除，runtime data 清干净，llm-config 还原到原始 2 个模型。**PR #95 + #96 仍保留在 main**（用户对前置基建无意见）。

### Docs

- **失败教训沉淀**（`docs/superpowers/findings/2026-05-13-sample-data-redesign-lessons.md`，250 行）：4 条批评的细节解剖 + 设计层共同根因（spec 太技术先行 / 选错数据集 / UI 不擅长讲"对比" / header_fields 没列硬约束）+ sankuai gateway 实测状态表（哪些 model 能用、kimi 30% timeout、Gemini image 网关 bug 等）+ evalyst 组件限制清单（bubble_overlay shape / triple_grid cellMap last-wins / JSX SVG camelCase / 网关 fetch 不到 localhost+sankuai S3）+ 跑实验的工程教训（timeout / abort / skip-if-exists / image inline）+ §6.1 给下一轮 planner 的 4 个 product 问题（演示给谁看 / 主信息 / 进入问题 / 离开动作）+ §6.3 推荐 5 个非学术 benchmark 场景方向。
- **Sample data redesign spec + plan 历史保留**（`docs/superpowers/specs/2026-05-12-sample-data-redesign-design.md` 873 行 + `docs/superpowers/plans/2026-05-12-sample-data-redesign.md` 2742 行）：作为失败案例对照参考留 main。

### Why

这次 stream 的故事结构：(a) 前置基建（llm-client image 端点 + seed 子目录扫描）独立有价值，留下；(b) 主体 sample data redesign 暴露 evalyst 在"对比"叙事上的根本性弱点，回滚；(c) 转向修根因（详情页对比入口），让未来 sample data 重做时有自然的演示路径。

### Lessons stream forward

下一轮 sample data redesign **不要继续走老 spec**——上版"三象限 7 display 全覆盖"是功能矩阵思维，正好踩中用户 4 条批评。下一轮 planner 第一步是回答 lessons §6.1 的 4 个 product 问题，再据 §6.2 硬约束（纯文本 / input ≤ 200 字 / output schema ≤ 5 字段 / 评分 ≤ 5 维 / 跨场景内聚 / 数据 30-60 条 / 可手工编）+ §6.3 业务场景方向（客服总结 / 商品文案改写 / 邮件互译 / 发票抽取 / 反馈分类）选 2-3 套写新 spec。预算参考：纯文本 60-180 records ~¥5-15 / wall < 30 分钟，比上一轮便宜 5-10 倍且质量上限更高。

## [0.14.6] — 2026-05-12 · R3 bug-security audit closes (PR #94)

R3 audit Tier B 第 4 轮——专项扫严重 bug + 安全风险（不重做 R1/R2/R3 的"21 雷达 / 量化基线"角度），找到 **1 major + 1 minor finding** 并立即闭环。Playwright 浏览器回归全过（A 6 settings 页 + B 3 experiment 详情页 25/104/140 条 results + C 编辑保存往返 + D 恶意 PATCH 400 守住 llm-config）。审视报告：[`docs/code-review-r3-bug-security.md`](docs/code-review-r3-bug-security.md)。

### Fixed

- **`PATCH /api/experiments/[id]` 写入逃逸闭环**（R3 bug-security audit finding #1）：`src/app/api/experiments/[id]/route.ts` PATCH handler 加 `body.id !== id` 早返 400，对齐 `schemas/displays/rubrics/datasets` 4 路由的同款 gate。pre-fix 行为：`updateExperiment` `{...config, ...body}` 让 `body.id` 顶掉 `config.id`，`writeExperiment` 用 `${updated.id}.json` 拼 path → `body.id="../llm-config"` 即可顶掉 `data/llm-config.json`（所有模型 api_key 丢）；逃出 `data/` 还能顶项目根 `package.json` / `tsconfig.json`。新增 5 case 单测 `src/app/api/experiments/[id]/__tests__/patch-id-mismatch.test.ts` 守底（含核心回归断言：mismatch 后**没**有文件落到 `data/llm-config.json`、原始 experiment file 不动）。
- **`readResults` 单条坏行整篇崩闭环**（R3 bug-security audit finding #2）：`src/lib/store.ts:131` 把 `lines.map(line => migrateResultInMemory(JSON.parse(line)))` 改为 per-line `try/catch + console.warn` 跳过坏行，对齐 `src/copilot/lib/session-store.ts:127-132` 早就做过的同款 append-only JSONL 防御。pre-fix 行为：进程崩 / 断电 / 磁盘满让 `appendFileSync` 写半行，下次 `readResults` 在 `JSON.parse` 抛异常 → 整 experiment 不可读（详情页 / resume / compare 全崩，恢复需手编 jsonl）。新增 5 case 单测 `src/lib/__tests__/store.read-results.test.ts` 守底（含 missing file / valid / 中间坏行 / 全 garbage / 坏行 + dedup 互动）。

### Docs

- **R3 bug-security 专项审视报告 land**（`docs/code-review-r3-bug-security.md`）：v0.14.5 baseline 上做"严重 bug + 安全风险"专项扫，**1 major + 1 minor finding**，附两条 fix diff + 10 个干净 surface 的清单（abort/resume race / writeAtomic / LLM 注入 parser / Cartesian 边界 / image filename traversal / 4 资源 id 写正则 / JSX 沙箱 / api_key 日志 / abort 信号 / SSE 半路断）。

## [0.14.5] — 2026-05-12 · dep major bumps (partial) · @types/node 25 + typescript 6 (eslint 10 deferred)

R3 audit Tier B 维护层。3 PR / 2 ship + 1 defer（eslint 10 因 transitive plugin API 不兼容退到 baseline）。Plan: [`2026-05-11-dep-major-bumps.md`](docs/superpowers/plans/2026-05-11-dep-major-bumps.md)。

### Changed

- **`@types/node` major bump 20 → 25**（PR-1，PR #92）：type-only 升级，runtime 仍 Node 20 LTS。`npx tsc --noEmit` 0 错——证明项目 Node API 用法（`fs` / `path` / `process` / `Buffer`）全在 Node 18+ 已 stable 的子集，type-narrowing 无副作用。0 行 src 修改。`undici-types ~6.21.0 → ~7.19.0` 是 @types/node 自身 transitive cascade（plan §合理偏离 (b)）。五件套全绿 + e2e 46/46。
- **`typescript` major bump 5.9 → 6.0**（PR-2，PR #93）：`npx tsc --noEmit` 0 错——typescript 6.0.3 inference 引擎升级**未翻出任何新 strict / inference 风格警告**。0 行 src 修改、`tsconfig.json` 不动（三严格全开不变）。类型债务计数 baseline 不变：`as unknown as` 8 / `as any` 0 / `@ts-ignore` 0 / `@ts-expect-error` 0。Next.js 16 + ts 6 build 兼容性确认。typescript 是 leaf dep，0 transitive cascade。五件套全绿 + e2e 46/46。
- **`eslint 10` 升级 deferred**（PR-3 abort，plan §PR-3 fallback A 触发）：`eslint-config-next 16.2.6` transitive 拉的 `eslint-plugin-react ^7.37.0` / `eslint-plugin-jsx-a11y ^6.10.0` / `eslint-plugin-import ^2.32.0` 三个 plugin 的 peer dep 上限都到 `^9`，**ESLint 10 plugin context API 不兼容**——`npm install` 仅 ERESOLVE warn 不 throw，但 runtime 一跑 lint 立即抛 `TypeError: contextOrFilename.getFilename is not a function`。已退到 baseline (`eslint ^9.39.4`)。retry 条件：等 `eslint-config-next 18` / Next.js 17 ship（一并升 transitive plugin 到 eslint 10 兼容版本）。决策记录见 [plan §PR-3 outcome 记录](docs/superpowers/plans/2026-05-11-dep-major-bumps.md)。

## [0.14.4] — 2026-05-11 · r3 backlog 全 8 项闭环 — methodology + domain cleanup (PR #90 + #91)

R3 backlog 第二阶段（也是收尾阶段）。Phase 2 方法论沉淀 + Phase 3 域代码 cleanup 合计 6 个 sub，r3 backlog 至此 8/8 全部闭环（#1+#2 已在 v0.14.3）。

### Changed

- **AGENTS.md §6 +2 standing rules**（r3 backlog #3 + #7 闭环，PR #90）：(a) 标 pre-existing 测试 "已绿" 前必须 `--repeat-each` ≥ 5 stress-test——R2 follow-up `experiment-seed.spec.ts:106` 实例（30 次 CI 全绿但本机 retries=0 + `--repeat-each=3` 下 ~8 % flake）的元教训沉淀；(b) cleanup plan 写依赖升级 scope 时用 "patch + 兼容 minor" 而非 "patch-only"——npm `^x.y.z` resolution 在 minor 段也会动，"patch-only" 写死容易 `npm install` 后偷偷漂到 minor。两条都源自 R2 follow-up 实例。
- **`.npmrc save-exact=true` 评估完成**（r3 backlog #4 闭环，决策方向 B：不加，PR #90）：抽 4 个对照 TS 项目对照——`vercel/next.js` 用 save-exact，`shadcn-ui/ui` / `TanStack/query` / `vitejs/vite` 都不用。evalyst 跟工具/库级而非框架级，18 直接 dep + 单作者 review 通道足够拦截；caret 默认对 lucide-react / nanoid 等小 dep 的 patch 自动跟随有正向价值。决策记录见 [`docs/superpowers/plans/_index.md`](docs/superpowers/plans/_index.md) §r3 backlog candidates。
- **`parseResponse(raw, schema)` 签名收窄**（r3 backlog #5 闭环，PR #91）：`src/lib/result-parser.ts:10` 的公开 `parseResponse` 签名从完整 `TaskSchema` 收窄到 `Pick<TaskSchema, 'raw_text_output' | 'output_schema'>`（实际只读这俩字段）；`parseAsRawText` 同步收窄为本地 `ParserSchema` 类型别名（type-system 必然，subtype propagation）。pure refactor / 0 行为变更，9/9 result-parser 单测背书 + tsc 全绿；唯一调用点 `batch-runner.ts:299` 传完整 `TaskSchema`，subtyping 自动满足 supertype，0 调用点改动。
- **API/lib 错误消息一致性调查**（r3 backlog #6 闭环，调查结果**方向 A · i18n 边界 by-design**，0 行代码改动，PR #91）：grep 三类 source 后判定 (1) `"Must be a non-empty string"` 在 `i18n/{en,zh}.ts` 仅被**前端表单页**（`/settings/datasets/new/page.tsx` + `/settings/displays/new/page.tsx`）消费给**最终用户**看；(2) `"required string"` / `"required non-empty array"` 硬编在 `lib/datasets.ts:102-106` 的 `validateDatasetJson`，服务端校验经 `errors[]` 返回给**绕过 UI 直接调 API 的 dev**；(3) `/api/datasets/route.ts` catch 块只透传 `(e as Error).message`、不重写。两条消息服务两层不同受众，**i18n 翻译层 / lib 错误层 by-design 边界分离**——强行对齐反引入新分歧。决策详见 [`docs/superpowers/plans/_index.md`](docs/superpowers/plans/_index.md) §r3 backlog candidates。
- **`view-helpers.tsx` 独立 `GlassVariant` 4 变体副本** close-out（r3 backlog #8 闭环，0 行代码改动，PR #91）：`src/components/results/view-helpers.tsx:8` 的 4 档 primitive 副本（`"thin" | "regular" | "thick" | "tinted"`）刻意不与 `src/components/glass/*` 的 7 档 `GlassVariant`（含 3 档 semantic colors `success/warning/danger`）共享类型——by-design decoupling。JSX display 是用户自定义渲染层，应该只能选 primitive 玻璃档，不应被语义色耦合（`helpers.glassStyle('success')` 没有清晰语义——成功/警告/危险是页面壳子级语义判断，不是单卡片渲染层职责）。强行合并反引入认知摩擦。决策日志归档至 [`docs/superpowers/plans/_index.md`](docs/superpowers/plans/_index.md) §r3 backlog candidates。

## [0.14.3] — 2026-05-11 · r3 backlog #1+#2 · e2e cold-compile flake closure (PR #89)

R3 backlog 第一阶段收尾。本机 macOS retries=0 全 suite 跑时 4 spec ~8 % flake (`experiment-seed.spec.ts:106/126` + `audit-cleanup-coverage.spec.ts:41/160`) 闭环——3 root cause 联合修，**0 行 prod 代码改动**。

### Fixed

- **e2e cold-compile flake — 三 root cause 联合修**（r3 backlog #1 + #2，PR #89）。本机 macOS retries=0 全 suite 跑时 `experiment-seed.spec.ts:106/126` + `audit-cleanup-coverage.spec.ts:41/160` 4 spec 共 ~8% flake。诊断揭示问题不止 cold compile，三层叠加：
  - **(a) cold compile 边缘抖动**：`/experiments/[id]` / `/settings/displays/new` / `/settings/templates/new` 在 fullyParallel + multi-worker 并发下 server compile 4.999 s 贴 5 s spec timeout；新 `playwright.global-setup.ts` 用真浏览器 prewarm 4 个 cold 路由（`/experiments/__prewarm__` 触发 dynamic `[id]/page.tsx` 编译），suite 启动外一次性付 ~5 s 编译成本，subsequent spec 命中 <100 ms。
  - **(b) multi-worker browser context 资源竞争**：实测 `workers=2 + prewarm` 反而 33% flake、`workers=1 + prewarm` 100% 稳定——多 browser context 在 macOS 本机抢 CPU/IO 拖慢 navigation 处理。`playwright.config.ts` 把 `workers: 1` 从 CI-only 改为本机也常态生效（CI 早就是 workers=1，这条本质是「local 与 CI 行为对齐」）。
  - **(c) test mock fulfill 导致 navigation race（brief 没预期的第三 root cause）**：`/experiments/new` 表单的 `handleSubmit` 在 `schema` undefined 时**静默 return**、`selectedModel` undefined 时 `alert + return`——两条路径都**不发 navigation**。test 之前只 `expect(seed-placeholder).toBeVisible()` 不能保证 `/api/schemas`（real backend ~292 ms）和 `/api/llm-config`（mocked ~50 ms）都已 fulfill，click 落在中间窗口 → handleSubmit early-return → waitForURL 5 s 超时。trace 实证两条 spec 失败时 `/api/experiments` POST 根本没发。`experiment-seed.spec.ts:106/136` 在 `goto` 前 arm `page.waitForResponse('**/api/schemas')` + `page.waitForResponse('**/api/llm-config')`，goto 后 `Promise.all` 等两个 mock 都 fulfill 再 click。
- **验证**：4 spec `--repeat-each=10` 两次连跑 200/200 green（前 ~87/100）；`npm run test:e2e` 全 suite 一次过 46/46；五件套全绿（tsc / 810 vitest tests / lint / build / knip）；Opus subagent 真浏览器手动验收 5 prod 路径全绿。
- **Plan deviation 记录**（per AGENTS.md §5）：诊断揭示第三 root cause #c (test mock race) 超出 brief 假设的「纯 infrastructure 层」，按 §5 (b) "量化 plan 声明却未具象化的契约" 处理——brief 框定 `诊断 + 修方向`，未限定 fix 必须只在 infra；测试代码改动严格在 brief 声明的 4 spec scope 内（仅 `experiment-seed.spec.ts:106/136` 各加 4 行 wait）。

## [0.14.2] — 2026-05-11 · R2 follow-up Phase 2 + Phase 3 — ConfirmDialog Provider nesting + 8-item cleanup batch (PR #86 + #87)

R2 follow-up 三步走的 Phase 2 + Phase 3 合并收尾。Phase 2 单点修复 ConfirmDialog Provider 嵌套（Phase 3 切 Glass primitive 后才暴露的视觉 regression）；Phase 3 批量收 8 项零散 cleanup（dep pin 回滚 / dead code / doc drift / Copilot session probe）。R2 follow-up 至此全部 land——CI 严化（Phase 1）+ 视觉 regression 修复（Phase 2）+ cleanup batch（Phase 3）三步完成。

### 修复 (#R2-followup A2, PR #86)

- **ConfirmDialog Provider 嵌套换序**：`src/app/layout.tsx` `ConfirmProvider` 与 `CopilotStoreProvider` 嵌套顺序换——前者改成内层、后者改成外层。原嵌套下 `ConfirmProvider` 自渲染的 `<Dialog>` 处于 `CopilotStoreProvider` **外面**，`DialogContent.useCopilotOpen()` 读到 `createContext` 的默认 `{ open: false, width: 0 }`，copilot 开态下 ConfirmDialog 拿不到 `data-glass-variant="thick"`（视觉 regression，Phase 3 切 Glass primitive 后才暴露）。换序后 dialog 正确反映 copilot 开关。零行为变更——`{children}` 子树里 confirm caller 全是 ConfirmProvider 之孙，与嵌套顺序无关。详见 [`docs/superpowers/plans/2026-05-11-audit-r2-followup.md`](docs/superpowers/plans/2026-05-11-audit-r2-followup.md) §Plan-外原始反馈索引 "Phase 3 反馈"（ConfirmDialog Context scope 即该索引第 1 项）。
- 新 e2e `e2e/confirm-glass.spec.ts`：copilot 关态断言 dialog 无 `data-glass-variant` 属性；开态断言 `data-glass-variant="thick"`。retries=0 下 `--repeat-each=10` 全绿。

### Cleanup (#R2-followup PR-3 batch · 8 commits, PR #87)

8 项零散 follow-up 的批量收尾，commit 粒度独立可单点回滚。**唯一业务码改动**是 sub d (Copilot session probe)，其余是 dep pin / dead code / doc drift。

- **a · pin next + eslint-config-next**（`package.json`）：从 `^16.2.6` 改回 pinned `16.2.6`（lockfile 不动）。Phase 2 #1 npm install caret 副作用记录的回滚。npm 默认 save-prefix=^ 仍生效——未来显式 `npm install next` 会重新加 caret，记 r3 candidate "考虑 .npmrc save-exact=true"。
- **b · rubric-store dead code**（`src/lib/rubric-store.ts:15`）：`listRubrics` 删 1 行不可达 `if (!fs.existsSync(rubricsDir())) return []`——上一行 `ensureDir` 已建 dir，existsSync 永远 true。
- **c · test:coverage 双 reporter**（`package.json`）：新 `test:coverage` script 输出 `text-summary` (stdout 一行总览) + `json-summary` (`coverage/coverage-summary.json`)。默认 vitest text reporter 把 100% 文件折叠成 "All files ... 100" 一行，掩盖域核心 0% 模块拉低均值的真相。
- **d · Copilot session stale-id probe**（`src/copilot/components/{store.tsx,probe-session.ts,__tests__/probe-session.test.ts}`）：`store.tsx` localStorage hydrate 时不再无条件 `setActiveSessionId(savedActive)`；改为先 `probeSessionExists(id)` 三态判断 (`exists` / `not_found` / `unknown`)。404 才清 LS；5xx / network 错误（`unknown`）保持 LS 不动，下次 mount 重试。原行为下 stale id 会导致 `use-chat-stream.ts:151` GET `/api/copilot/sessions/{stale}` 404 噪音（panel 的 `/sessions` list 清理逻辑只在 panel open 后跑，赶不上 chat-view mount race）。新加 4 个单测覆盖 200/404/500/throw 全路径。
- **e + f + h · 三处 JSDoc**（`e2e/auth-gate.spec.ts` / `src/middleware.ts` / `src/components/glass/shell.tsx:137`）：删 "introduced in fix/auth-gate-rce" 旧 branch 引用；middleware doc 改准确（curl/agents 不发 `Sec-Fetch-Site` header，不是发 `'none'`——`'none'` 是浏览器直接地址栏导航才会发的值）；`useGlassStyle` JSDoc 9 档 → 7 档（v0.13.2 PR #82 inline 后 stale）。
- **g · README PaaS 部署一句**（`README.md` §部署须知）：远程访问列表加第 4 条 PaaS（K8s / Cloud Run / Fly.io / Render 等）"服务仍绑 localhost，让 PaaS router 做 auth 终结"。
- **i · "9 档" → "7 档" 当前 contract sweep**（`src/copilot/components/chat-view-parts.tsx:196` + `CLAUDE.md:17`）：剩余 2 处 current-tense contract 措辞。past-tense "之前作为 9 档..." 历史描述 + review reports / CHANGELOG 历史 entries 全部不动（不重写历史）。三层 grep 验收：layer 1 contract 0 hit / layer 2 archive 改前后一致 (3) / layer 3 history 改前后一致 (24)。
- **B10 · 修 PR-2 CHANGELOG cross-ref**（本 entry 上方 A2 段尾）：原引用 `docs/code-review-round-2.md §评审视角四人组裁决摘要 Phase 3 反馈 #1` 是 stale——`code-review-round-2.md` 全文无 "Phase 3 反馈" 段。"Phase 3 反馈" 实际在 [`docs/superpowers/plans/2026-05-11-audit-r2-followup.md`](docs/superpowers/plans/2026-05-11-audit-r2-followup.md) §Plan-外原始反馈索引。改指 plan 文件。

### Implementation notes (PR-3, PR #87)

- sub d 用三态 `SessionProbeResult = "exists" | "not_found" | "unknown"` 而非 boolean —— 404 = definitive evidence the session is gone → clear LS；5xx / network = ambiguous → leave LS alone, let next mount retry。Boolean 会把"definitively gone"和"transient blip"两个语义不同的失败混在一起，在 server 抖一下时误清 LS 把用户最近 session 指针抹掉。

## [0.14.1] — 2026-05-11 · R2 follow-up Phase 1 · Cmd+K e2e hydration race + retries=0 (PR #85)

R2 follow-up 三步走的第 1 步收尾。改动只 4 个文件 + 2 个文档（CHANGELOG / plan errata），**零 prod 代码变更**。Phase 2 (PR-2 ConfirmDialog Provider 嵌套) / Phase 3 (PR-3 cleanup batch 9 项) 留后续 session。

### 修复 (#R2-followup A1, PR #85)

- **Cmd+K e2e hydration race**：`audit-cleanup-coverage.spec.ts:298` / `copilot-v2.spec.ts:45,54` / `copilot-v25.spec.ts:134` 三处按 ⌘K 之前只等 `<aside data-copilot-panel>` attached（SSR HTML 立即满足），但 ⌘K window keydown listener 在 `CopilotStoreProvider` mount useEffect 里注册（hydration 后才跑）——慢机 race 触发（本机 macOS 1/3 fail，CI Ubuntu 一直绿）。三处 press 之前加 `expect(getByRole("button", { name: /打开 Copilot|Open Copilot/i })).toBeVisible({ timeout: 6_000 })` —— 该按钮只在 `mounted=true` 时渲染（同一个 useEffect 既 set mounted 又 register listener），可见即代表 hydration 完成 + listener 已注册。本机 10× repeat 60/60 过。
- **Playwright CI retries: 1 → 0**：retries=1 是给未诊断 flake 留逃生口，第二轮过了与一遍过结果不可分，CI 信号失真。Cmd+K race 修干净后立刻拆门——以后任何 flake 都会让 CI 红，逼真诊断而非 paper-over。

### 文档 (#R2-followup A1)

- `docs/superpowers/plans/2026-05-11-audit-r2-followup.md` §PR-1 加 Errata 段：plan 写时未实跑 / 未读 CI 日志，三个"长期红"e2e 中两条早已绿（`2c03636` + `f743810` 修过），CI workflow 已严无需改；只 Cmd+K 一条本机 flake。原文保留追溯（"plan 原写法"块），重新框定 PR-1 实际 scope。
- **Plan deviation 记录**（per AGENTS.md §5）：原 plan §PR-1 框定为"3 e2e 红 + CI 撒谎 + branch fix/r2-e2e-real-failures + commit 'close 3 pre-existing failures + tighten CI fail-on-error'"。诊断阶段实测推翻前提：2/3 specs 已绿、CI workflow 已严。重新框定为"修 1 真 flake（grep 后扩到 3 处同隐患）+ retries 0"，branch / commit / scope 同步更新。Errata 详见 plan §PR-1。

## [0.14.0] — 2026-05-11 · Round 2 audit Phase 3 · #R2-A 收官 (PR #83 + #84)

第二轮 audit 5 项全过——Phase 1 #D 域核心补测 (v0.13.1) + Phase 2 #B/#C/T3 速胜 (v0.13.2) + **Phase 3 #A Glass UI 切边 (本版)**。`src/copilot/` 子树物理边界与 conceptual 边界对齐：删 `src/copilot/components/{shell,sticky-chrome,glass-segmented}` 后 domain UI 仍编译通过（Linus rm -rf 测试），剩下的 `src/copilot/` 只剩真 Copilot 业务。

### Refactor (#R2-A · Phase 3 完成 · 2 PR 收官)

- **Round 2 #A 切边收口**：完成 round-2 audit 最后一项（Phase 3 #A）。Glass UI 视觉 primitive 完整搬出 `src/copilot/` 子树到 `src/components/glass/`，**导入方向真切边**——Linus `rm -rf src/copilot/{shell,sticky-chrome,glass-segmented}` 后 domain UI 编译仍通过；`src/copilot/` 子树只剩真 Copilot 业务（panel / chat-view / tool-call-card / inspector / context / use-chat-stream / use-page-context / store / overlay）。
- **PR 1 (#83) introduce-new**：新建 `src/components/glass/{copilot-context,shell,sticky-chrome,glass-segmented}.tsx`。引入 minimal context API `CopilotShellProvider` + 双 hook 分拆 `useCopilotOpen()` / `useCopilotPanelWidth()`——Glass 视觉 primitive 不再触碰 `CopilotStore` 完整 shape（contexts / inspector / busy / pageContext / 等），只读 `{ open, width }` 子集（Linus "no special cases"，sidebar theme cascade 走 `useCopilotPanelWidth()` 不是例外）。`src/copilot/components/store.tsx` `CopilotStoreProvider` 内层包 `<CopilotShellProvider value={{ open, width }}>`。`shell.test.ts` 跟搬到 `src/components/glass/__tests__/`。老 `src/copilot/components/{shell,sticky-chrome,glass-segmented}.tsx` 改成 backwards-compat re-export shim 让 PR 1 零 import 站点变更。
- **PR 2 (#__) migrate + delete**：31 个 import 路径 bulk migrate（4 shadcn ui + 18 `src/components/{results,settings,template-builder}/*` + 9 `src/app/{settings,page.tsx,layout.tsx,experiments,compare}/*`）从 `@/copilot/components/{shell,sticky-chrome,glass-segmented}` 切到 `@/components/glass/...`。6 处 `useCopilotStore` 切换到双 hook（5 处 `useCopilotOpen()`：`button.tsx` / `dialog.tsx` / `select.tsx` / `display-jsx.tsx` ×2 / `compare/page.tsx` ×2；1 处 `sidebar.tsx` 用 `useCopilotOpen() + useCopilotPanelWidth()`）。删 3 个 shim + 删 `useCopilotPanelWidth` 上的临时 `@public` JSDoc tag。
- **验收硬指标全过**：`useCopilotStore` in domain UI = 0；Glass primitive (shell / sticky-chrome / glass-segmented) 老路径 import in domain = 0；剩余 `@/copilot/components` import = 17 个文件全部为 `useRegisterPageContext` / `panel` / `store` / `inspector-overlay` 等真 Copilot 触点（`layout.tsx` mount 8 个 + 16 页 `useRegisterPageContext`）。tsc / 806 tests / knip / lint / build 五件套全绿；`vitest --coverage` 域 `lib/` stmts **84.72%**（≥ 75% Phase 1 baseline）。
- **Plan-外偏离记录**（per AGENTS.md §5）：原计划 3 PR (introduce / migrate / delete-shims) 改为 2 PR——PR 2 完成 migrate 后 shim 立刻变 dead code（knip red），删 shim 与 migrate 是同一 unit-of-work（共同 revert / 共同 load-bearing），分 PR 无 review 价值。3-step refactor pattern 保留在 commit 层级。详见 [`docs/superpowers/plans/2026-05-11-audit-r2-phase3-glass-extraction.md`](docs/superpowers/plans/2026-05-11-audit-r2-phase3-glass-extraction.md) §Plan-外偏离记录。

## [0.13.2] — 2026-05-10 · Round 2 audit Phase 2 · quick-wins 批 (PR #79–#82)

第二轮 audit Phase 2 全收完：4 个独立 PR 串行 merge，Errata + #C file-lock O_EXCL + #B middleware csrf-rename + T3 cleanup batch。**audit 增量调优、零功能改动**。

### Audit Errata (PR #79)

- `docs/code-review-round-2.md` 末追加 `## Errata` § + `### E7 (2026-05-10) · Dockerfile USER/chown 子项早已 ship`：round-2 §S7 写"没新加 USER"是 stale 判断（R1 commit `98be5f1` 实际已落 `chown -R node:node /app` + `USER node`）。`docs/superpowers/specs/2026-05-10-audit-r2-design.md` Phase 2 T3 末同步加 quote 引用。**append-only**，原文一字未改。
- 影响：Phase 2 T3 PR omit Dockerfile USER 子项；T3 实做剩 3 子项（npm audit fix / chrome-up,down 折叠 / npm outdated patch）。

### Cleanup (#R2-T3, PR #82)

- **deps audit**：`npm audit fix`（不带 `--force`）解 4/6 advisories（hono / ip-address / express-rate-limit / 1 个 postcss transitive）。剩 2 个 moderate 是 `next 16` 内嵌 postcss + next 自身——`--force` 会降到 `next 9`（破坏性 3 major），等 next 16.x point release 内含新版 postcss。
- **Glass UI 9 档 → 7 档**：`chrome-up` / `chrome-down` 两档 inline 进 `src/copilot/components/sticky-chrome.tsx`（各只 1 调用点，per round-2 DHH "证据说话——不是 9 档系统"）；`GlassVariant` union 从 9 → 7（4 primitive + 3 semantic）；同步更新 `docs/conventions/glass-ui.md` / `CLAUDE.md` FAQ + 索引 / `docs/copilot.md` 注释。视觉等价（CSS byte-for-byte 复制 + `data-glass-variant` rename `chrome-* → sticky-*` 在通用属性选择器下安全）。
- **deps patch upgrade**：`npm install` 12/13 plan 列出的 patch / minor 升级（`@babel/standalone` 7.29.4 / `@base-ui/react` 1.4.1 / `lucide-react` 1.14 / `nanoid` 5.1.11 / `jsdom` 29.1.1 / `@types/node` 20.19.40 / `tailwind-merge` 3.6.0 / `tailwindcss` + `@tailwindcss/postcss` 4.3.0 / `shadcn` 4.7.0 / `next` + `eslint-config-next` 16.2.6）。**knip 6.12.2 跳过**：upstream transitive `@oxc-project/types@^0.128.0` 还未 published（npm ETARGET）—— 留 6.7.0 跟。**跨 major 不动**：typescript 6 / eslint 10 / @types/node 25。

### Security (#R2-B, PR #81)

- `src/middleware.ts` 顶部 doc 真名化：`Auth gate` → **CSRF gate (NOT auth)**；删除误导性 "could exfiltrate keys / run arbitrary server-side JS / trigger writes" 措辞（这些 R1 已在域代码层修了），明示 LAN curl 绕过这条限制。**实现行为零变更**——middleware 仍用浏览器 attested `Sec-Fetch-Site` 拦 cross-site。
- `docker-compose.yml` `ports` 绑 loopback：`"3000:3000"` → `"127.0.0.1:3000:3000"`，容器外不可见。**user-visible 配置变化**：依赖 LAN 访问 :3000 的部署需切到 ssh tunnel / VPN / 反代 + auth 前置。
- `README.md` 新增 `## 部署须知（Deployment caveat）` 顶级 §（目录第 3 条同步加）：明示 evalyst 不支持 LAN/公网暴露；列 ssh tunnel / VPN / 反代 + auth 三种正确远程访问做法 + 显式列「不要做」反例。

### Fixed (#R2-C, PR #80)

- `src/lib/batch-runner-lock.ts` `acquireLock`: 用 `fs.openSync(p, 'wx')` (O_EXCL) 替换 read-check-write，关闭 round-2 §14 的 TOCTOU 窗口（两个 worker 同时见到 stale lock 双双 overwrite 都返 true 的真伤）。stale 检测路径行为等价；lock schema 不变。新增 race test (`Promise.all([acquireLock, acquireLock])` × 5 次循环，恰好 1 true / 1 false 作为回归 sentinel）。生产真跨进程并发 curl 实测 1 win / 1 reject。

## [0.13.1] — 2026-05-10 · Round 2 audit Phase 1 · domain coverage 补完 (PR #75–#78)

第二轮 audit ([`docs/code-review-round-2.md`](docs/code-review-round-2.md)) 锁定 5 项 fix；Phase 1 把"4 个 0% 模块"的债先还清——**纯增量、零行为变更**。

### 测试 (#R2-D)

Round 2 audit Phase 1 全收完。**域 `src/lib/` 4 个 0% 模块**单测落地，**实现签名零变更**。

- `src/lib/rubric-store.ts` 0% → 97.29% statements（5 个 export 函数全覆盖 + sorted/source-default 行为锁）。模块 1 (PR #75)。
- `src/lib/result-parser.ts` 0% → 97.5% statements（4 条 JSON 提取路径 + `<think>` 剥离 + `raw_text_output` 主+边界 3 case）。模块 2 (PR #76)；中间 checkpoint 通过。
- `src/lib/displays.ts` 4.47% → 100% statements（5 builtin + user CRUD + `validateDisplay` CCN-22 三 mode × 缺/空/合法 全分支）。模块 3 (PR #77)。
- `src/lib/datasets.ts` 0% → 98.47% statements（CRUD 5 函数 + `validateDatasetJson` 6 类错误 + `updateCustomDataset` 用 `it.each` 平铺 4 error path + `inferFieldsFromJsonl` 6 类型推断 + 边界）。模块 4 (PR #78)。

**整体覆盖**：lib/ 56.86% → **84.71%** (+27.85pp，远超 spec §2 75% 验收线 9.71pp)。All files 68.14% → 75.77%。Total tests 772 → 807（+35）。

### Audit r2 docs scaffolding (PR #75 同 PR 内一并落)

- [`docs/code-review-round-2.md`](docs/code-review-round-2.md) — 第二轮独立审视报告（基于 b26c6a9 / v0.13.0 baseline）
- [`docs/superpowers/specs/2026-05-10-audit-r2-design.md`](docs/superpowers/specs/2026-05-10-audit-r2-design.md) — master spec（123 行）：5 项 fix 拆 3 phase + **决策日志** 10 项不修
- [`docs/superpowers/plans/2026-05-10-audit-r2-domain-tests.md`](docs/superpowers/plans/2026-05-10-audit-r2-domain-tests.md) — Phase 1 plan（107 行）：fixture 复用 + 中间 checkpoint + 模块顺序

### 多角度验证（v0.13.1 ship 前）

- Source 零变更核验：`git diff` 在 src/ 排除 tests 后**空**
- Mutation testing 4/4：手工破坏 4 模块关键路径 → 对应测试**全部 fail**（证明 coverage 非 vacuous）
- 单测 807/807 pass / tsc 0 错 / knip 仅预存噪音
- CI：4 PR verify + e2e 全 pass
- Full e2e：42/45 pass，3 fail 与 main 同源（环境差异 / Copilot panel flaky / experiment-seed pre-existing），**零 Phase 1 引入回归**
- 浏览器实测：rubrics 创建落盘 `source: "user"` 自动注入 / datasets 列表 record_count 正确 / `validateDatasetJson` 拒绝逐字匹配单测断言

### 工程纪律亮点

- **决策日志** 把"看似该修但本轮不修"的 10 项理由写实——防下轮 audit 重新论证已结案问题
- **中间 checkpoint** 在 Phase 1 模块 2 之后量化外推（plan §6），避免末尾才发现数字不达标
- **mutation testing** 是测试质量的真实信号——比"行号被覆盖"严格一档

### 下一步（Round 2 剩余）

- Phase 2（1.5d，3 PR）：#B middleware 真名化 / #C file-lock O_EXCL / Tier 3 cleanup batch
- Phase 3（2d，最大风险）：#A Glass UI primitive 物理切边到 `src/components/glass/`

## [0.13.0] — 2026-05-10 · Audit Cleanup 收尾 + R1 robust pass (PR #73 + #74)

audit-cleanup 全套 (Phase A-F) 闭环。文档分裂 + R1 cold-start 兼容性硬验收。14-15 人天工程纪律落地为长期可维护的项目结构。

### Phase F · 文档分裂 + 收敛 (PR #73)

- CLAUDE.md 42KB → 4.5KB（索引 + 反直觉 3 强约束 + pinpoint）
- AGENTS.md 24KB → 4.9KB（开发流程 + AI 协议）
- 新建 `docs/architecture.md`（项目架构 / 资源 CRUD / 测试 / i18n / 目录结构）/ `docs/copilot.md`（v2 工具协议 / 关键文件 / context 抽取）/ `docs/conventions/glass-ui.md`（9 档梯度 + tinted 名额 + a11y 降级）
- 30+ 历史 plan/spec/findings 归档到 `docs/superpowers/archive/2026-Q2/`，按主题双维度索引 [`plans/_index.md`](docs/superpowers/plans/_index.md)
- README L18 删 "工具调用闭环规划中"（v0.4.0 PR-3 起 ship）
- Audit doc Errata E5（LOC 实测修订：核心 18k / Copilot 10k excl tests）+ E6（plan/spec 路径漂移标注）
- Plan: docs/superpowers/plans/2026-05-09-audit-doc-split.md

### R1 cold-start AI session 兼容性硬验收 (PR #74)

Phase F merge 后跑 R1 cold-start `claude -p` 验证：CLAUDE.md auto-load 正常 ✓、索引关键词正确 ✓，但 cold-start agent 仍跑 `Bash ls / Grep src/` 而不是 Read 文档。诊断揭根因：**agent perceived cost asymmetry**——`Read 26KB architecture.md` 感觉贵、`Bash ls src/lib/` 一行输出感觉便宜，即使索引描述精准（"数据流"→architecture.md），agent 仍走自 grep 捷径。

- CLAUDE.md 顶部加 14 行 FAQ literal-path 直答表（"找东西？快速跳转"），把高频问题压到 1-hop（Read CLAUDE.md → 直答）
- 7Q battery cold-start 验收 7/7 PASS（5/7 zero-tool-call），grep-first 行为完全消失
- Standing rule 入项目 memory：「AI-loaded docs · FAQ direct-answer rule」——FAQ literal-path 是攻破 perceived-cost asymmetry 的关键设计；新 FAQ 入口测试必须 cold-start `claude -p` 不用 Agent tool subagent（subagent inherits parent context，证伪验证）

### 工程纪律亮点（A-F 整套 14-15 人天）

- 7 份 lightweight plan ≤ 100 行，禁止 1000+ 行史诗 plan
- "Plan-外 scope 偏离规则" standing rule（4+ 次合理触发：cartesian-cap e2e / Errata E6 / R1 fix 边界等）
- 3 次预案 R 触发都按 plan 处理（lint > 50 拆 batch / tsconfig errors > 80 拆 PR / hooks-fix 提前融入 PR-2）
- subagent inheritance 验证陷阱发现 + 用 `claude -p` 真 cold-start 修正
- 无工程性事故，无紧急 hotfix，零运行时回归

### 意外发现 / Errata（reference）

- E1: `extractImageRefsFromOutput` 实测 5 params（lizard noise 报 9）
- E2: knip 从未真正配置（在 devDeps 但无 config / script）
- E3: ESLint scope bug — 62k+ warnings 来自 `.claude/worktrees/.next` 噪音
- E4: Lint baseline 实测后拆 chore/lint-fix-batch 为 2 个 PR
- E5: §1 LOC 数字 back-of-envelope，实测核心 18k / Copilot 10k（excl tests）
- E6: archive 后 audit doc 引用路径漂移，已标注

## [0.12.0] — 2026-05-10 · Phase E 结构性重构：Copilot 物理边界 + tool metadata 拆分 + batch-runner 文件锁 (PR #70 #71 #72)

收掉 audit-cleanup-2026-05-09 §Phase E。三个独立 PR 把仓库长期累积的物理 / 逻辑 / 协调层耦合一次性切清：Copilot 子树物理收敛、tool 注册去镜像化、批处理协调从 globalThis hack 换成文件锁。零运行时行为变化——这是 Phase F 文档收尾前最后一次大规模结构动作。minor 跳是因为 `src/copilot/` 子树落地是仓库导航语义的明显改变，不再是 patch 级 polish。

### Copilot 物理边界 (PR #70 `refactor/copilot-boundary` — Phase E #2)

`src/lib/copilot/` (91 文件) + `src/components/copilot/` (25 文件) 物理收敛到 `src/copilot/{lib,components}/`。`src/app/api/copilot/` 因 Next.js App Router 强制 api routes 在 `src/app/api/<route>/route.ts` 下，留原位（plan §2 锁明此例外）。

- **commit 1 pure git mv**：116 文件 100% 相似度 rename，0 ins/0 del；commit 1 后 tsc/test/build 故意全爆——commit message 标明
- **commit 2 import rewrite**：75 文件改 alias `@/lib/copilot/` → `@/copilot/lib/`、`@/components/copilot/` → `@/copilot/components/`；含 7 处 cross-edge 相对 import (`'../llm-client'` 等)→ `@/lib/*` (plan §7 R4 anticipated)；vi.mock factory 字符串一并改；`tsconfig.json` 加 `@/copilot/*` 显式路径
- **commit 3 doc 同步**：CLAUDE.md / AGENTS.md prose 路径同步改；README + AGENTS 顶部加 LOC 边界声明段；docs/superpowers/{specs,plans}/ 中纯 Copilot 文件的 `@/(lib\|components)/copilot/` 字面量同步替换
- **LOC 数字校正**：原 plan 写 "9k vs 18k" 是 eyeball 估算，实测 18k 评测核心 vs 11k Copilot (excl 测试) / 21k vs 18k (incl 测试)。README + AGENTS 顶部段写真实数字 + 透明注
- **§6 grep 验收**：`git grep -e "@/lib/copilot/" -e "@/components/copilot/"` 在 src/ + e2e/ + CLAUDE.md + AGENTS.md 返 0 行；docs/superpowers/plans/2026-05-09-audit-copilot-boundary.md 内 6 处自指匹配（描述 before→after 箭头）保留
- 验证：tsc/test (765) /lint/build/knip 全绿；e2e individual 12/12 PASS；Playwright manual UI 全 10 路由 + Copilot 面板 0 regression

### Tool metadata 镜像拆掉 (PR #71 `refactor/copilot-tool-metadata-split` — Phase E #10)

加新 tool 从 6 处登记 (tool 文件 + registry + metadata-client mirror + sync test + tool-call-card variant + tool-call-card import) 减到 3 处，metadata-client 手动镜像 + 强制 sync 测试整套去掉。

- 9 个工具每个拆 `{name}.metadata.ts` (client-safe — name + description + inputSchema + metadata, **禁 import fs/store**) + `{name}.server.ts` (call 函数 + 全 server deps)。`{name}.server.ts` import 自家 metadata + spread `{ ...xxxMetadata, call }` 拼回完整 ToolDescriptor，nested metadata 引用通过 shallow spread 保持不变
- 新增 `client-registry.ts` (UI 用 — `findClientToolMetadata` / `needsConfirm`) + `server-registry.ts` (runtime 用 — `TOOLS` / `toolByName` / `AnyToolDescriptor`)。老 `registry.ts` 改为 thin re-export shim (`export * from './server-registry'`) 保 14 处 consumer call sites 不动
- 删 `metadata-client.ts` + `metadata-client-sync.test.ts` (整套手动镜像消失)；加 `metadata-identity.test.ts` 用 `toBe` (reference equality) 检查 server descriptor.metadata 与 client metadata 同对象——shallow spread 链上任何未来 deep copy refactor 立即 fail
- `tool-call-card.tsx` + `use-chat-stream.ts` import 切到 `client-registry`；`pickVariant()` 现读 `meta.metadata.isDestructive` (nested — 之前 ClientToolMetadata 是 flat shape)
- 13 commit 拆分（1 prep + 9 per-tool + 2 wrap + 1 changelog），每 commit tsc/test 全绿
- 验证：tsc/test (766) /lint/build/knip 全绿；plan §6 client bundle fs check `grep "fs/promises\|node:fs" .next/static/chunks/` 0 行；plan §6 metadata server-only deps grep 0 行 (仅 `edit-template.metadata.ts` 走 `import type { TaskSchema }` type-erase)；e2e individual 12/12 PASS；Playwright manual UI 验 5 个 tool-call-card variant + needsConfirm gating 全部正常

### batch-runner 文件锁 (PR #72 `refactor/batch-runner-file-lock` — Phase E #9)

`globalThis.__activeRunners` 模块 hack 换成 `data/results/{exp_id}/.runner.lock` 文件锁。旧设计在 dev HMR 下能跨重载存活但跨多 worker (`next start -w 4`) 直接错乱、进程崩溃后留 silent stuck 实验；新设计在 prod 多 worker 正确，dev HMR 副作用换成可控的 boot-time cleanup。

- 新增 `src/lib/batch-runner-lock.ts`：`acquireLock` / `releaseLock` / `touchHeartbeat` / `clearStaleLocksOnBoot`。锁内容 `{ pid, started_at, last_heartbeat, node_version }`，写入走 `writeAtomic`
- `acquireLock` 双重判活：`process.kill(pid, 0)` 探活 (区分 ESRCH = 死 / EPERM = 活但无权限) + `last_heartbeat` 距今 > 1h 视作 stale 兜底 (防 hang 进程持锁)
- `BatchRunner.run` 主循环每 `writeProgress` 后调 `touchHeartbeat`(3 处：initial / per-task / final)——长跑实验持续刷锁，不被 1h stale 误判
- `clearStaleLocksOnBoot` dev 模式启动一次性扫 `data/results/*/.runner.lock` 全删（`bootCleanupDone` flag 防多次跑），prod 跳过此 hook
- `globalForRunners` / `globalThis.__activeRunners` 完全移除，内存 Map 改 module-local 仅做 same-process abort 派发；`stopBatch` 公开行为不变（不存在 → false；存在 → runner.stop）
- 公开 API 完全保持：`startBatch` / `stopBatch` 签名 + 返回值 + "Experiment is already running" 异常 message 一字不改；14 处 consumer 不动
- 6 case 单测覆盖 acquire/reject/stale-ESRCH/dev-boot/heartbeat-refresh/prod-no-op；用 `vi.stubEnv` 改 NODE_ENV (TS-strict-friendly) + `vi.spyOn(process, 'kill')` mock ESRCH
- **取舍**：dev HMR 重载期间正在跑的实验失去 abort 入口（旧的 globalThis 跨 HMR 存活在新设计里改成 `clearStaleLocksOnBoot` 重置）；prod 不受影响（无 HMR）；换得多 worker 正确性
- 验证：tsc/test (772) /lint/build/knip 全绿；`grep "globalThis\|__activeRunners\|globalForRunners" src/lib/batch-runner.ts` 0 行；Playwright manual UI 跑了完整 25/25 task 实验，端到端验证锁创建 → 心跳刷新 (22s 实测) → release → 0 orphan 跨 22 个 results 目录；并发 `curl POST .../run` 拒绝返 verbatim "Experiment is already running"

### 用户感知

零。三个 PR 都是 refactor，外部行为不变：
- API endpoints / data paths / i18n / Glass UI / hooks / tool 行为 全不变
- `startBatch` / `stopBatch` / `TOOLS` / `toolByName` / `AnyToolDescriptor` 公开 surface 完全保持
- `<GlassCard>` / `useGlassStyle` / Copilot panel 视觉 + 交互不变

### 验收

- main HEAD = `0c47c85` (PR #72 merge commit)
- `npx tsc --noEmit` 0 errors
- `npm test` 772 / 772 passing (Phase E 累计 +6 净增：+3 metadata-identity / -2 metadata-client-sync / +6 batch-runner-lock / -1 (其它合并))
- `npm run build` Compiled successfully
- `npm run lint` 0 problems
- `npm run knip` 0 unused exports
- e2e individual: 12/12 PASS
- 三个 PR 各做了 Playwright Opus subagent manual UI verification (Phase E #2 → 10 路由 + Copilot 面板；#10 → tool-call-card 5 variants + needsConfirm；#9 → 完整 25/25 task run 锁生命周期)

### 下一步

Phase F (#5 文档分裂 + 砍冗余) 需要 v0.12.0 tag 后启动。

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase E
- Plans:
  - docs/superpowers/plans/2026-05-09-audit-copilot-boundary.md (#2)
  - docs/superpowers/plans/2026-05-09-audit-tool-metadata-split.md (#10)
  - docs/superpowers/plans/2026-05-09-audit-batch-runner-file-lock.md (#9)

## [0.11.7] — 2026-05-10 · knip 配置上线 + dead-export cleanup (PR #66)

收掉 audit-cleanup-2026-05-09 §Errata §E2：`knip` 在 devDeps 里但从未配置过，默认调用扫 `.claude/worktrees/` + `.next/` 当源码，~2k 个 unused-files 假阳性把真信号埋了。本 tag 把 knip 真正配上 + 顺手清掉确认死掉的 export surface。零行为变化。

### Architecture / Tooling

- **chore(knip): configure + cleanup confirmed-dead exports** —— Errata §E2 follow-up. `knip` was a devDep but never wired up; default invocation scanned `.claude/worktrees/` + `.next/` as source, masking real signal under ~2k unused-files false positives. Adds `knip.jsonc` with explicit ignore patterns + `npm run knip` / `knip:fix` scripts. Then deletes only confirmed-dead surface:
  - 2 unused barrel re-exports dropped: `src/lib/schema/index.ts:17` (`export type { TaskSchema }` — every consumer goes through `@/lib/schema/types`) and `src/components/settings/display-form-page.tsx:22` (`export type { FormState }` — `display-form-modes.tsx` imports from `./display-form-types` directly).
  - 1 truly orphan type alias deleted: `KnownContextType` (context-registry.ts:24, no internal use either).
  - 67 unused exports across `src/{lib,components}/copilot`, `src/lib/schema`, `src/lib/{annotation-store, displays, image-store, llm-client, result-parser, results-aggregate, display-inference}`, `src/components/results`, `src/components/settings`, `src/components/template-builder` demoted to module-internal (drop `export` keyword; implementations stay — each is still used inside its own file by sibling functions / types / hook arrays).
  - `src/components/ui/**` (shadcn-vendored primitives — Card / Dialog\* / Select\* / Progress\* etc.) marked as a vendored library boundary in `knip.jsonc`. The full export surface stays verbatim regardless of current consumption; adding back is one keyword if a future caller needs it.
  - `formatValue` (results/view-helpers.tsx:44) verified safe before demotion: zero cross-file TS imports; the only outside reference is a literal string inside `meta-prompts/display.ts` (LLM prompt content, not a TS import). Still flows into JSX displays at runtime via the same-file `makeHelpers` spread.
  - Audit §17 reported "16 unused exports + 38 unused types"; with knip properly configured the actual baseline was 32 + 63 (audit numbers were unreliable without the config). After cleanup: knip clean, 0 unused.

### 验收

- `npx tsc --noEmit` 0 errors（main HEAD = `9f4fe85`）
- `npm test` 765 / 765 passing
- `npm run build` Compiled successfully
- `npm run lint` 0 problems
- `npm run knip` 0 unused exports / 0 unused types（仅 5 条 ignore-pattern 简化建议，无错误）
- Playwright MCP 7-checkpoint smoke（copilot panel / template / dataset / display / experiments / settings / network+console）全 PASS

### 用户感知

零。knip 是 dev-time 工具；export 降级是编译期 visibility 收缩，没改任何运行时分支 / API shape / UI 形态。

### CI 集成

刻意未挂在 verify job（避免突然 fail 历史 commit）。后续若想 0-unused 强制，单开一个 PR 把 `npm run knip` 加到 `.github/workflows/ci.yml` verify job 即可。

## [0.11.6] — 2026-05-10 · lint hygiene 零警告 + CI fail-on-warning + post-tag hooks fix 真合入 (PR #65 #67)

收掉 audit-cleanup-2026-05-09 §Phase C Tier 3 R1（lint warning 清零 + CI fail-fast）+ Tier 2 #11 后续（rules-of-hooks 修复通过 PR #67 真正合入 main —— v0.11.5 tag commit 实际不含此修复，详见 v0.11.5 errata note）。零行为变化：全 inline disable 注释 + CI workflow flag flip + 一份 convention doc + hooks 顺序结构调整。

### Lint cleanup (PR #65 `chore/lint-fix-batch`)

React 19 ESLint plugin v6 引入 27 处 noise（23 errors + 4 warnings）—— 多数是 React Team 推荐的合法 pattern（localStorage hydrate / mount flag / sync from prop / reset on dep change），rewrite 到 `useSyncExternalStore` 没价值。一次性 disable + 文档化 + CI 翻 fail-fast 防回归。

- **22 处 disable + 链 doc**：16 处 `react-hooks/set-state-in-effect`（13 文件，4 类 pattern 标签）；3 处 `exhaustive-deps`（intentional missing-dep，每处单行理由：interval 内部读不入 deps / load-once gate / 稳定 derived Set）；1 处 `react-hooks/immutability`（panel.tsx useCallback 在 useEffect 之后声明，闭包 stable）；1 处 `preserve-manual-memoization`（template-form-parts mock preview，cheap cache 非 correctness）；删 1 处 e2e 文件 stale `no-console` disable
- **`docs/conventions/react19-hydration.md`**：≤ 30 行，解释为何不迁 `useSyncExternalStore`（一次性 hydrate vs 持续订阅 model，rewrite 没价值），4 类 pattern 各举例 + revisit 触发条件（cross-tab sync 等真有 live 源时）
- **CI fail-fast**：`.github/workflows/ci.yml` verify job lint step 移除 `continue-on-error: true`；AGENTS.md + CLAUDE.md 同步从 "continue-on-error" 改成 "fail-on-warning"
- **未来**：`useSyncExternalStore` 迁移 16 callsites 留 backlog——现 suppress 文档充分，没阻塞优先级

### Rules-of-hooks 修复落地 (PR #67 `fix/react-hooks-rules-of-hooks`)

v0.11.5 release notes `### Tuning (rules-of-hooks 衍生修)` 子段声称包含 `ca5dfcb` / `60a833a`，但 tag commit `52f4217` 实际不含此修复——v0.11.6 是首个真正含修复的 tag（详见 v0.11.5 entry 顶部 errata note）。

- `triple-grid-results.tsx`：3 个 `useMemo`（groups / rowValues / colValues）hoist 到 `if (dims.length < 3) return` 之前；early-return 谓词改成 `!primaryDim || !rowDim || !colDim || !groups`——在 `noUncheckedIndexedAccess` 下天然 narrow，subsumes 原 length check，顺便删 3 个 `dims[N]!`
- `dual-list-results.tsx`：同形式，2 个 useMemo + 删 2 个 `dims[N]!`
- 行为零变化：empty-dims 仍返回 fallback `<div>`，full-dims 仍消费同样 memoized values

### 验收

- `npx tsc --noEmit` 0 errors（main HEAD = `a7f5576`）
- `npm test` 765 / 765 passing
- `npm run build` Compiled successfully
- `npm run lint` 0 problems ✓（pre-baseline 27 → 0）
- CI verify job 现在 fail-fast 跑 lint，未来违例 PR 立刻挂；e2e job 链路不受影响
- Playwright MCP smoke 17 user flow 全 PASS（lint suppressions 不破坏任何 effect 行为）

### 用户感知

零。

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase C Tier 3 + Tier 2 #11

## [0.11.5] — 2026-05-10 · tsconfig strict baseline + 顺手 hooks fix (Phase D, PR #62 #63)

> **Errata (2026-05-10)**：本段 `### Tuning (rules-of-hooks 衍生修)` 子段引用的 commits `ca5dfcb` / `60a833a` 位于 `fix/react-hooks-rules-of-hooks` branch，**未直接合入 main**——通过 PR #67 retrofit 到 main 时 commit hash 变为 `9e625ca` (triple-grid) / `413f1cf` (dual-list)。tag v0.11.5 指向的 merge commit `52f4217` 不含此修复；首个完整版本是 **v0.11.6**（post-PR #67）。下次衍生修复务必先 rebase / merge 再 promote CHANGELOG，避免 release notes 与实际 main 状态出现 commit hash gap。

收掉 audit-cleanup-2026-05-09 §Phase D：tsc 三档 strict 全开（`noUncheckedIndexedAccess` + `noImplicitReturns` + `exactOptionalPropertyTypes`），把项目 ~570 处隐式 undefined 全显式化。零用户可见行为变化——这是 internal-quality 提升 / Phase E（Copilot 物理切边）的前置防护网（spec §Phase D Stop condition：strict 必须先于 Copilot 重构合，否则切边后再开 strict 会让搬走的文件二次改类型）。patch 级版本号刻意——Phase D 是 zero-user-perceived 改动，留 v0.12.0 给 Phase E 真正的 minor bump。

### 类型严格化 (PR #62 `refactor/tsconfig-strict` — Phase D PR-1)

启用 `noUncheckedIndexedAccess` + `noImplicitReturns` 两条 flag，450 → 0 errors。13 commits / 51 文件。post-PR-1 baseline 路径选 plan §2 R5 兜底 2 PR 拆（450 >> 80 阈值），单文件 ≥50 errs 单 commit（use-chat-stream.ts 47），余下按文件分组。

- **§3.a guard + early continue**（默认手法）：reverse-scan 循环、forward 迭代里 `const m = arr[i]; if (!m) continue` 把 indexed access 的 `T | undefined` narrow 掉。8 处 use-chat-stream SSE handler、tool-loop-detector branch[i]/pairs[i]、image-store loop 等
- **§3.a invariant explicit `!`**：上游已证明非空的位置（regex group capture / length 断言后 / modulo 范围 lookup）用 `arr[i]!` + 一行注释说明。color pool / `parts[0]!` / `dims[0]!` after `length>=2` guard 等
- **§3.c noImplicitReturns**：唯一 baseline 触发点 `image-lightbox.tsx:39` `useEffect` 显式 `return undefined`；额外义务 `validate.ts` validateProp + `transform.ts` applyTransforms switch 末尾加防御性 exhaustive `default { const _: never = ... }` —— 防 union 扩展时漏 case 的网
- **§3.b Map.get throw 不触发**：plan 标 tool-loop-detector / registry 是"重灾区"，实际 25 errors 全是 §3.a 数组访问，项目 `Map.get` 调用 100% 已 `if (!x)` / `?.` 守。§3.b 留作未来新工具引入时的 defensive standard
- **测试 cast 策略**：prod 全 narrow / 测试允许 `as unknown as T` 跳 mock 摩擦但禁 `as any`；migrate test 实数据用 `!`（`cfg.models[0]!.field`）而非 mock cast，因为 cast 策略明确范围（plan §3）

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase D
- Plan: docs/superpowers/plans/2026-05-09-audit-tsconfig-strict.md

### exactOptionalPropertyTypes (PR #63 `refactor/tsconfig-strict-eopt` — Phase D PR-2)

eopt 单条 flag layered 在 PR-1 之上。post-PR-1 baseline 122 errors → 0。12 commits / 30 文件。

- **§3.d conditional spread**（默认手法）：`{ foo: maybeUndef }` 在 `{ foo?: T }` slot 下不合法（eopt 区分 absent vs present-with-undefined），改 `{ ...(maybeUndef !== undefined ? { foo: maybeUndef } : {}) }`。覆盖 llm-config migrate / use-chat-stream UI message builders / form-state buildSchemaFromForm / ParsedToolError 字段透传等
- **5 处 React props widening to `?: T | undefined`**：chat-view / model-picker / session-list 等通过 nullable state 流入的 props，每个 JSX call site 写 conditional spread 反而过度——惯例直接放宽接口签名
- **`signal: p.signal ?? null`**：`RequestInit.signal` 类型是 `AbortSignal | null` 不是 `| undefined`，nullish coalescing 一行修（llm-stream.ts:80）
- **`clearSessionHead()`** —— ⭐ semantic-care fix：`pruneMessageAndDescendants` 原本传 `{ head_message_id: target.parent_id }` 让 parent_id=undefined 来清 head；eopt 禁该字面量。拆 `clearSessionHead()` 走 destructure 删 key（不是赋 `null`、不是 `undefined`），保持 jsonl 序列化形态等价。Smoke 测验证：`data/copilot/index.json` 的新建 session 字段 `head_message_id` 是 absent（删 key），不是 `null`
- **`updateItem` patch-key-only invariant**（commit 3f6c877 docs）：表单层 `patch={min_length: undefined}` 用来清空可选字段。merge 后剥 undefined keys 的逻辑加 JSDoc 显式警告：iterate `patch` keys only（不是 `merged`），免得未来手滑改成 `Object.entries(merged)` 误删既有 undefined 字段
- **playwright.config.ts** `workers` slot 是 `string | number` 不含 undefined，`...(process.env.CI ? { workers: 1 } : {})` 修
- **R7 fallback 没触发**：`.next/dev/types/**` 0 errors，没需要往 `tsconfig.json` `exclude` 加 Next codegen 排除路径

### Tuning (rules-of-hooks 衍生修)

PR-2 review + e2e 跑过程中 surface 出 3 处 `useMemo` 在 React 组件 early-return 之后调用、违反 Rules of Hooks。**不是 Phase D 引入**——是 PR-1 把 array index 加 guard 后让 hook 顺序问题肉眼可见的副产品；属 audit-spec §Plan-外 scope 偏离规则判据 (a) 防一类回归，整合进本 release。

- `dual-list-results.tsx` (60a833a)：useMemo 提前到 `if (dims.length < 2)` 之前
- `triple-grid-results.tsx` (ca5dfcb)：useMemo 提前到 `if (dims.length < 3)` 之前

### 验收

- `npx tsc --noEmit` 0 errors（main HEAD = `52f4217`）
- `npm test` 765/765 passing
- `npm run build` Compiled successfully
- `npm run lint` 27 problems = pre-D baseline，0 新违例
- 手动 UI smoke through Playwright MCP（两次 dispatch，分别针对 PR-1 / PR-2+combined）：22 个 UI flow 全 PASS，0 console TypeError；含 `clearSessionHead` 生命周期端到端 + `updateItem` patch-clear round-trip + Triple-grid 25-cell 渲染 + JSX display 编译

### 用户感知

零。strict 是编译期纯 type 安全提升，没改任何运行时分支 / API shape / UI 形态。Phase E（Copilot 切边）开工后会感谢这个 tag——切边引入的所有 import 重构都会被 strict 立刻抓回归。

## [0.11.0] — 2026-05-10 · audit-cleanup-2026-05-09 完工：security blockers + cartesian cap + reproducibility seed + 物理切边整理 (PR #56–#61)

跨 6 个 PR 收掉 `docs/code-review-2026-05-09.md` 报出的 Phase A blocker（auth gate / SSRF）+ Phase B 测试地基（batch-runner.run 状态机覆盖）+ Phase C 速胜（cartesian hard cap、experiment seed、机械化 cleanup batch）。Phase D（tsconfig strict）+ Phase E（Copilot 物理切边 + tools 拆分 + 文件锁）+ Phase F（文档分裂）留作下一波。

### Security (PR fix/auth-gate-rce — Phase A of audit-cleanup-2026-05-09)

代码审视报告 `docs/code-review-2026-05-09.md` §8 把三条暴露面定为 blocker：服务端 RCE（`js` transform op = `new Function`）、API key 明文 GET、27 个 API route 无任何 origin / auth gate。本 PR 同一威胁模型一次性关掉。

- **删 `js` transform op**：`schema/transform.ts` 的 `case 'js'` 分支移除；`TransformStep` 联合不再含 `{ op: 'js'; fn: string }`；TransformChainEditor / i18n keys（zh + en 各 4 条）一并清。`data/schemas/*.json` 和 seeds grep 0 命中，删除无需迁移；如果用户旧 schema 仍含该 op，runtime guard 抛 `INVALID_TRANSFORM_OP` friendly error 而不是静默吞
- **mask api_key**：新增 `maskKey(k)` 保末 4 位返 `sk-***xxxx`；`GET /api/llm-config` 和 `PUT` 响应都 mask；`saveLlmConfig` 检测到 mask 占位符（`/^sk-\*\*\*.{4}$/`）自动从当前盘上配置恢复真 key —— UI round-trip 不破坏
- **auth gate middleware**：新增 `src/middleware.ts`，按 `Sec-Fetch-Site` 放行同源 / same-site / 直接打开（curl/agent）；`cross-site` 一律 403，除非 origin 出现在 `EVALYST_ALLOW_ORIGIN` 白名单。`/api/skills/[name]` 函数体内显式公开（agent-driven 设计）
- README "Docker 启动" 节加部署说明（`EVALYST_ALLOW_ORIGIN` 用法 + skills 公开规则）
- 测试：`maskKey` 5 case 单测（mask + unmask round-trip + 显式覆盖 + 显式清空）；新增 `e2e/auth-gate.spec.ts` 5 case；`schema/__tests__/transform.test.ts` 把老 `js` op 两条测改成 runtime guard 一条

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md
- Plan: docs/superpowers/plans/2026-05-09-audit-auth-gate-rce.md

### Security (PR fix/image-url-ssrf — Phase A of audit-cleanup-2026-05-09)

审视报告 §8 S4 + §16 单独点的 SSRF 缺口：`saveImagesForTask` 把 LLM 返回的图片 URL 直接 fetch 写盘，没有协议 / 私网段过滤。一个被劫持或恶意的 LLM 可让 evalyst 拉 `http://169.254.169.254/...`（云元数据）或 `http://10.x.x.x/...`（内网）。

- **新增 `assertSafeImageUrl()` 静态守门**：只放行 `data:image/*` 和 `https://` + 公网 host；拒绝所有非 https 远程 scheme（`http:` `file:` `ftp:` `gopher:` …）；拒绝 hostname 为私网/回环/链路本地/多播 IP literal（IPv4 RFC1918 + 0/8 + 127/8 + 169.254/16 cloud metadata + 224+；IPv6 ::1 / ::、fe80::/10、fc00::/7；以及 `::ffff:a.b.c.d` IPv4-mapped IPv6 含 dotted 和 hex-compacted 两种形式——Node URL 解析会把 `[::ffff:10.0.0.1]` 规范化成 `[::ffff:a00:1]`，两种都拦）
- **`saveImagesForTask` 在每次 URL 进 fetch 前调用守门**——`UnsafeImageUrlError` 通过 `batch-runner.ts:301` 既有 try/catch 自然落到 `task.error`，UI 看到可读错误而不是默默写入或挂死。data: URLs 走 base64 解码路径不变
- 测试：`image-store-ssrf.test.ts` 32 case（19 pure helper + 2 集成）。集成测验证拒绝时盘上没残留文件（短路在 fetch 之前）。这是 spec §"#6 验收标准"承诺的"8 边界单测"的超集

### Tests (PR test/batch-runner-unit — Phase B of audit-cleanup-2026-05-09)

审视报告 §"#7 batch-runner.run 单测"：`BatchRunner.run` 是 evalyst 的核心状态机（resume / taskIds 子集 / stop / cost / concurrency），CCN 21、行 200+，此前完全没有覆盖。Phase E 的 `#9` 文件锁重构会动 `globalThis.__activeRunners` + 启动路径，必须先有兜底网。

- 新增 `src/lib/__tests__/batch-runner.test.ts`（6 case，~280 行）：resume + 部分 failed / taskIds 子集 / 中途 stop / progress 三路径累加（input_tokens · output_tokens · total_cost_by_currency.USD）/ concurrency 上限（peak == 2 over 6 tasks）/ cost per-currency（USD + CNY 分桶）。全 mock，跑 ~8ms
- **Approved source exception**：`src/lib/batch-runner.ts:44` `class BatchRunner` → `export class BatchRunner`（type-only 可见性变更，无运行时影响）。绕开 `startBatch` 单例直接 `new BatchRunner(...).run(...)` 测状态机，避免与 `globalThis.__activeRunners` race；plan 已批
- Mock 策略：`callLlm` 接口形态保真返完整 `LlmResponse`；`@/lib/store` 用内存 Map last-wins dedupe，对齐 `store.ts:140-142` 真实 `readResults` 语义（否则 case 1 resume 会双拿 t9 fail+success）；`generateTasks` / `buildMessages` 实调；`@vitest/coverage-v8` 加进 devDeps
- 覆盖率：`batch-runner.ts` 81.1% lines / 56.57% branches / 79.28% statements（target ≥70% line，达标）。未覆盖 294-303 image-save catch + 326-327 outer error catch（image 路径已被 `image-store-ssrf.test.ts` 覆盖；outer catch 留 #9 文件锁 PR 一并补）

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase B · #7
- Plan: docs/superpowers/plans/2026-05-09-audit-batch-runner-unit-tests.md

- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase A · #6
- 不写独立 plan（< 1d 项，spec 直接 scope）

### Cartesian cap (PR fix/cartesian-cap — Phase C #3)

审视报告 §Phase C #3：3 alias × 1k records 的 schema 配置（1B 任务）会 OOM 服务器；`/api/estimate` 之前调 `generateTasks().length`，把整个 array 物化只为数 length，本身就是 OOM 触发器。本 PR 把 estimate 改成纯计数 + 给 generate 加上限。

- 新增纯函数 `estimateTaskCount(schema, fv, bindings)` —— O(inputs) 时间，不物化 cartesian。`/api/estimate` 切过去用它，response shape 不变（仍是 `{ task_count: number }`）
- `generateTasks(..., opts: { maxTasks })`：默认 100_000 上限；超了在 cartesian 物化前抛 `TooManyTasksError`（带 `taskCount` + `maxTasks` props 给 caller surface）
- UI `/experiments/new`：estimate > 5_000 弹 `confirm()`「本次将生成 N 个任务...」，> 100_000 直接 `alert()` 阻断提交。i18n 加 zh + en 各 2 条
- 单测 `schema/__tests__/cartesian-cap.test.ts`（9 case，5ms）：3 alias × 1000 records perf < 50ms / `0` records / 默认 cap throw / 自定义 maxTasks / boundary
- E2E `e2e/cartesian-cap.spec.ts`（5 case）：mock estimate 5_001 cancel→不提交、accept→提交；mock 100_001 alert 阻断；< 5_000 golden path；`/api/estimate` shape lock-in
- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase C #3
- Plan: docs/superpowers/plans/2026-05-09-audit-phase-c-coordination.md（覆盖 Phase C 三件套）

### Cleanup batch (PR chore/audit-cleanup — Phase C Tier 3，scope-reduced per R1)

审视报告 §Tier 3 的 10 项 cleanup batch。开工时 `npm run lint` 报 62k+ warning，绝大多数来自 `.claude/worktrees/agent-*/.next/` 自动生成 build chunks——eslint config `.next/**` ignore 只在 top-level 命中。修了 ignore pattern 之后真实 src/ 还有 64 problems，其中 23 是新版 react-hooks 规则（`set-state-in-effect` / `rules-of-hooks` / `no-use-before-define`）的 NEW errors，每个都需 per-occurrence review，不是机械活——按 R1 协议停下问用户，scope 缩到下面这一组。

- ESLint scope 修：`globalIgnores` 改 `**/.next/**` 任意深度 + 加 `.claude/**` + `coverage/**`；`@typescript-eslint/no-unused-vars` 加 `argsIgnorePattern: ^_` / `varsIgnorePattern: ^_` 让 `_ev` / `_r` / `_ctx` 这种 "intentionally unused" 约定真生效
- `.gitignore` 加 `/.claude/worktrees/`
- Dockerfile：`npm prune --omit=dev`（runner 阶段瘦身）+ `chown -R node:node /app` + `USER node`（不要 root 跑 next start）
- README 加「`.next/` Turbopack stale-cache 偶尔卡坏中间状态 → `rm -rf .next && npm run dev`」一句
- `src/lib/types.ts` 删 11 条 dead export（1 重复 type、9 schema re-export 0 importer、1 `RunRequest` interface 0 ref）
- `src/lib/copilot/manifest.ts` 11 个 internal interface 去掉 `export`（0 external importer 已 verify）
- `display-form` 循环依赖：`FormState` + `GroupConfig` 抽到新 `display-form-types.ts`，两边都从那里 import
- ~14 处 unused import / unused var 清理；session-store.test.ts 5 个故意保留的 setup vars 重命名为 `_m1b` / `_m2` 等
- E2E `e2e/audit-cleanup-coverage.spec.ts`（6 case，361 LOC）走 `pageerror` 监听 + 模拟用户点击：display form mode 切换 / submit shape / templates new render / 实验 results 页 / Cmd+K Copilot / dashboard tinted button
- **显式 defer 见本 release 末尾「Deferred (follow-up PRs)」节**：`chore/lint-fix-batch`（清 26 lint 问题 + 翻 CI gate）/ `chore/knip-config-and-cleanup`（knip 接入 + 清长尾 unused）
- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Tier 3
- Plan: 走 coordination plan，本 PR 不写独立 plan

### Reproducibility (PR feat/experiment-seed — Phase C #8)

审视报告 §Phase C #8：之前没法在 OpenAI 系 provider 上 pin sampling 确定性，跑一次和下一次结果常变，给 LLM eval 「同条件复现」体验差。

- 表单 `/experiments/new` 加可选 `Seed` Input（type=number，placeholder「留空 = 随机」），下面带 hint：「整数；OpenAI 系网关透传，Anthropic 不支持会自动忽略并在服务端日志告警」
- `ExperimentConfig.seed?: number` + `CreateExperimentRequest.seed?: number` 端到端串通，`createExperiment` persist 到 disk，`batch-runner` 通过 param-object 形式的 `callLlm({ ..., seed })` 传下去
- `buildRequestBody`：OpenAI `if (typeof p.seed === 'number') base.seed = p.seed`（**严格不让 `seed: undefined` 进 body**——某些 gateway 对 `null/undefined` payload 会 400）；Anthropic `console.warn` + drop（Messages API 当前没 seed 参数）
- 单测 `lib/__tests__/llm-client-seed.test.ts`（9 case）：OpenAI seed=42 / 0 / undefined / 不传；Anthropic seed=42/0 警告 + drop / undefined 静默；其余 body 字段不被 seed 干扰
- E2E `e2e/experiment-seed.spec.ts`（4 case）+ `e2e/experiment-seed-extra.spec.ts`（6 supplementary case，覆盖负数 / 零 / 小数 / int32-max / state stability / Anthropic flow）
- 后续：detail page 当前不展示 seed（`/experiments/[id]/page.tsx`），是 follow-up enhancement，本 PR 不在 scope
- Spec: docs/superpowers/specs/2026-05-09-audit-cleanup-design.md §Phase C #8
- 不写独立 plan（< 1d 项）

### Deferred (follow-up PRs)

跟踪从 audit-cleanup-2026-05-09 里被显式 defer 出去的工作。每条对应一个独立 branch / PR，避免散落在贴脸的 chore/* 里。

- **`chore/lint-fix-batch`** —— 清 `chore/audit-cleanup` (PR #60) 留下的 26 个真实 lint 问题：23 errors（80% `react-hooks/set-state-in-effect`，其余 `rules-of-hooks` + `no-use-before-define`，每条需 per-occurrence review，不是机械修）+ 3 `react-hooks/exhaustive-deps` warnings；最后一步把 CI lint `continue-on-error: true → false`，让 lint 真正成为 gate
- **`chore/knip-config-and-cleanup`** —— audit spec §Tier 3 的 "16 unused exports + 38 unused types" 长尾。当前 knip 在 `package.json` deps 里但缺 `knip.json` 配置 + 缺 `npm run knip` script。先把 knip 跑起来（含 `**/.next/**` / `.claude/**` / `coverage/**` ignore）再清剩余 unused 导出 / 类型；PR #60 已先手清了 22 条最高确信度的（`src/lib/types.ts` × 11 + `src/lib/copilot/manifest.ts` × 11）

## [0.10.1] — 2026-05-09 · 测试硬编码审计 + P0/P1 hygiene fix (PR #55)

PR #54 在 CI 上挂了 e2e —— 根因是测试 hardcode 了开发机本地才有的 model id (`gemini-31-pro` / `opus-46-anthropic`)。fix-forward 走 self-provision fixture pattern 修了，但担心同类 hardcode 散落在别的 spec 里等着撞。这个版本扫了一遍全仓库的测试套，把"真撞过 / 真会撞 CI"的两条修了，剩下的 P2 留作 design smell 记录。

### 体验

零。运行时代码未触碰，仅测试文件 + 一篇 audit doc。

### 测试

- **审计**：扫了 `e2e/*.spec.ts` (5 文件) + `src/**/__tests__/*.test.ts` (~68 文件) + `playwright.config.ts`，分类 P0/P1/P2 + 标注 9 处 intentional / out-of-scope。结论：除下面两条外，e2e + vitest 套都已经按 PR #54 的 vision-gate 模式走 self-provision fixture / `path.join(process.cwd(), …)` / 相对路径靠 `playwright.config.ts` `baseURL`。没有第二个"在本地配置才能跑"的 spec 等着撞 CI。
  - `docs/superpowers/findings/2026-05-09-hardcode-audit.md`
- **P0-1**：`src/lib/__tests__/annotation-aggregate.test.ts` 从模块级 `process.chdir` + `afterAll` 改成 `beforeEach`/`afterEach` 配对，对齐 `llm-config.migrate.test.ts` 等 12+ 文件的标准模式。今天默认 vitest forks pool 一文件一 worker 不外泄，但只要别人手痒翻成 `pool: 'threads'` 或 `fileParallelism: false` 就会污染 sibling test (`real-session-smoke.test.ts:18` 直接读 `process.cwd()`)。改完之后这个 coiled spring 拆了。
- **P1-1**：`cache-stats-store.test.ts` + `cache-stats-prune.test.ts` 把 `path.join(tmp, 'data/copilot/cache-stats.jsonl')` 拆成分段。纯一致性，darwin-only 项目本来 windows 兼容不是动机，但项目其它地方都用分段，这俩文件之前是异类。

### 显式跳过的 finding（rationale）

- **P1-2** (`e2e/copilot-v25.spec.ts` 写 live `data/copilot/cache-stats.jsonl`)：cleanup 走 filter-based 已正确，`describe.configure({ mode: 'serial' })` 已就位；audit 的 UUID-suffix 替代方案有 tradeoff（crash 后 stranded line 更难诊断）。"P0/P1 真撞过 / 真会撞 CI 才修" 原则下不动。
- **P2-1** (`real-session-smoke.test.ts` 依赖 cwd)：作者已在代码注释 acknowledge；`if (!fs.existsSync(...)) return` 兜底使其在 CI 干净环境下 no-op。修了 P0-1 之后这个 test 的传递性风险也自然降低。
- **P2-2** (`experiments/[id]/page.tsx` 的 3000ms busy timeout)：UI 体感 tweak，不是 CI/正确性问题。

## [0.10.0] — 2026-05-09 · 评测平台进入多模态：生图评测 v1 + Copilot × Image Vision (PR #52–54)

evalyst 此前是 text-in / text-out 的 LLM 评测平台。v0.10.0 把多模态纳入一等公民，分两个互补子系统打通端到端：

- **生图评测 v1（PR #52）** — 让平台能跑 text-in / image-out 模型。LLM client 提取 `message.images[]`，batch-runner 落盘到 `data/results/{exp}/images/`，`image_url` schema 类型 + `<ImageLightbox>` UI + HEIM 5 题 seed rubric + 三件套 seed（数据集 / schema / rubric）。参考 gateway：sankuai `aigc.sankuai.com/v1/openai/native` + `gemini-3.1-flash-image-preview`。
- **Copilot × Image Vision（PR #53 + 修复 PR #54）** — 让 Copilot 能"看见"那批生成的图。圈选含图 task_result / task_field → 至多 5 张图（按 URL dedupe）以 base64 内联进 user message multimodal content；3 层 vision 防御（model picker + chat route 入口校验 + build-llm-messages 兜底 strip）；Anthropic 序列化器修复 data URL → `source.type='base64'`。

设计目标：manual 评测全链路（auto-eval VLM-as-judge / pairwise ranking / 专用 reward model 留 v2）。OSS 调研借鉴 Stanford HEIM `ImageCritiqueMetric` 5 题（alignment / subject_clarity / aesthetic / originality / safety）。图像存盘走 HEIM / T2I-CompBench filesystem-path 风格，JSONL 永远只存 `/api/results/.../images/...` 绝对 URL。

### 体验

- **生图（Image Generation）评测 v1 完备支持** — text-in / image-out 评测端到端。
  - LLM client：扩 `LlmResponse.images?`，`parseResponse` OpenAI 分支提取
    `choices[0].message.images[]`（OpenRouter / sankuai 等 gateway 约定的
    非标字段）。请求侧零改动（沿用 `api_format='openai'`）
  - 图像存储：data URL 解码 → `data/results/{exp_id}/images/{task_id}_{idx}.{ext}`，
    JSONL 里只存绝对 API URL `/api/results/{exp_id}/images/...`
  - Schema：`JsonFieldType` 加 `image_url` / `image_url_list`，validate 跟上
  - UI：全局 `ImageLightboxProvider` 挂 RootLayout；`renderField` image case
    走 `<ClickableImage>` → 点击进 Lightbox；RubricAnnotator 弹窗 image 类
    schema 自动展示双栏 preview
  - 三件套 seed：`image_prompts_v1` 数据集（20 prompt × 5 类别）+
    `image_gen_v1` schema + `image_quality_v1` rubric（HEIM 5 题改编）
  - Skill 文档：`evalyst` + `evalyst-task` 加生图章节
  - 验证：sankuai `gemini-3.1-flash-image-preview` 实跑通，5 单测组 +
    1 e2e smoke

- Spec: `docs/superpowers/specs/2026-05-08-image-generation-eval-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-image-generation-eval.md`

### Copilot × Image Vision

让 Evalyst Copilot 在用户圈选含图 task_result / task_field 时真正"看见"图像。视觉评测闭环（"为什么这张图主体偏左"、"对比 #1 和 #2 哪张更清晰"）从被迫复制图链接到另开 Claude Code 网页，变成圈选 → 自然语言反馈 → 编辑 prompt template → 重跑实验。

#### 体验

- **圈选驱动的视觉对话**：含图 task_result（声明 `image_url` / `image_url_list` 字段）或单独的 image task_field 被圈选时，最多 5 张图（按 URL dedupe）以 base64 内联进 user message multimodal content array
- **3 层 vision 防御**：(1) ModelPicker 隐藏非 `vision_capable` 模型并显示 amber warning；(2) chat route 入口校验；(3) `build-llm-messages` 兜底 strip 图块 + 注入 system note `[Image attachments dropped: model not vision_capable]`
- **`vision_capable` 模型标记**：`/settings/llm` 一行 checkbox；旧 config 默认 undefined（≈ false），无需迁移
- **Chip 缩略图**：context-chip-rail 展开时识别图像 URL（`/api/results/`、`data:image/`、http(s) 图片扩展名）→ 渲染 120×120 缩略图，点击进 `ImageLightbox`
- **超额提示**：圈超 5 张图时 system note `{n} image(s) not attached (per-turn cap is 5)`

#### 架构

- **新模块** `src/lib/copilot/image-attach.ts`：`collectImageRefs`（schema-aware + heuristic + dedup + cap=5，用户优先 vs 工具优先）+ `readImageBytes`（fs.readFile + base64 + path traversal 防御 + mime-by-ext）+ `extractImageRefsFromOutput`（tool 复用助手）
- **单点改造** `build-llm-messages.ts`：sync → async；新 `materializeImagePlan` 把圈选 refs → multimodal blocks；user message 重写为 `[(text,image)*N, text(原内容)]` 数组；其余链路（stream-response）只跟 await 一下
- **Anthropic 序列化器修复**：`source.type='url'` 不接 data URL；新 `imageBlockForAnthropic` helper 检测 data URL → `source.type='base64'` + parsed media_type；HTTP URL 走 `source.type='url'`。`llm-client.ts`（非流式）+ `llm-stream.ts`（流式）两条路径都覆盖
- **工具 forward-compat**：`read_experiment_results` / `read_context` / `read_resource` 的 output 在含图 schema 下挂 `_attachments: ImageRef[]`；`payloadGuardHook` 把 `_attachments`（值层带下划线）提到 `ToolResultContent.attachments`（wrapper 层无下划线）；落盘自动 round-trip
- **结果组件 task_field 注入** `field_type`：`single-list-results` / `dual-list-results` / `triple-grid-results` 6 处 callsite，让 chat-view 能算 `imageContextCount` 决定 ModelPicker 是否 require vision

#### v1 选项 A 限制

工具返回的 `_attachments` 在 v1 **不进入 LLM 多模态消息**（`build-llm-messages` 不消费 `tool_blocks_by_call_id`）。原因：
- Task 0 探针发现 sankuai OpenAI-compat 拒绝 `image_url` in `tool` role 消息（"An 'image_url' 'content' object element is unsupported for a(n) 'tool' message."）
- Anthropic 协议 user/assistant 严格交替，无法在 `tool_result` 后追加 `user` 消息携带图

LLM 只在用户**主动圈选**时看到图——这是用户主诉求的核心场景。"让 LLM 自驱看一批图整体评估"这种用例延后到 v2，等 sankuai 解禁或做 provider-specific 分支（Anthropic 内嵌 / OpenAI 用户消息追加）。Tools 仍发 `_attachments`、payloadGuardHook 仍 lift——翻一个 `if` 即可启用，零下游改动。

#### 测试

- 新增 ~7 组 vitest（image-attach × 2、build-llm-messages.image、llm-stream.anthropic-data-url、llm-client.anthropic-data-url、hooks.attachments-lift、read-context.image / read-experiment-results.image / read-resource.image），约 35+ case
- 既有测试全绿；`tsc --noEmit` / `build` / `e2e smoke` 均通过
- 手动 checklist 留给 PR merge 前/后真机跑（含 sankuai claude-sonnet vision_capable=true 实跑）

- Spec: `docs/superpowers/specs/2026-05-09-copilot-image-vision-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-copilot-image-vision.md`
- Branch A→B finding: `docs/superpowers/plans/findings/2026-05-09-tool-result-content-array.md`


## [0.9.4] — 2026-05-09 · Copilot 架构 polish + loop detector 回归防御 (PR #50–51)

v0.9.3 ship 后做了一轮**子系统级 code audit**（架构 / 模块边界 / 循环依赖 / 大文件拆分 / 重复代码 / 死代码 / 注释 drift / 类型一致性 8 维度并行 review），发现 1 个 audit 误报 + 7 条结构性 polish 候选。本版没有功能变更，只是把 v0.9.3 ship 后捞到的"架构小债"清掉，让 v0.9.x 后续如果再加 feature（parallel tool dispatch / streaming partial recovery / token cap 遥测）时基础更稳。

### 回归防御 (PR #50)

- **`tool-loop-detector.isFailure()` 对 v2.5 P2 ToolError shape 加 2 条回归测**：audit 报告该函数不识别 `{ ok: false, error: { code, message } }` 形态。实测发现因为 `"error" in obj` 仍命中（key 名相同），audit 是 false alarm —— **生产代码无需改**。但加 2 条测当未来防御：万一某轮重构收紧了 `isFailure` 的 shape 检测，连续 5 次 INVALID_INPUT/NOT_FOUND 不被识别为失败这条 regression 会立刻被捞到。`tool-loop-detector.test.ts` 17 → 19 cases。

### 架构 polish (PR #51)

7 个独立 commit，每个 1 task：

- **B1 切循环依赖** `material-reveal-overlay ↔ store`：抽 `applyRevealCascade` / `clearRevealCascade` 到 `material-reveal-cascade.ts`（无 React 依赖纯 DOM 模块），overlay 文件只 import store 读 `lastOpenedAt`，store 只 import cascade 函数。`madge --circular src/components/copilot/` 从 1 cycle → 0 cycle。
- **B2 修层级违规**：`src/lib/copilot/use-page-context.ts` 是 lib/ 唯一 `"use client"` + import `@/components/copilot/store` —— 违反"lib 不应反向依赖 components"约定。`git mv` 到 `src/components/copilot/use-page-context.ts`，16 处 caller import path 同步更新。零行为变化。
- **B3 拆 cache-stats-store.ts 三件套**（348 行 → 3 个文件，单向依赖链）：
  - `cache-stats-store.ts` 留 jsonl io + appendCacheStat / readCacheStats / pruneCacheStats + `CacheUsageStat` type
  - 新建 `cache-aggregate.ts`：aggregateCacheHitRate / countRecentBreaks
  - 新建 `cache-break-detect.ts`：detectCacheBreak / detectCacheBreakWithReasons / collectRecentBreakReasons / findLatestBreakPair / 6 个 digest+preview helpers + extractSystemPromptString + 全部 BreakReason / BreakInfo / BreakPair types
  - 收益：未来加 per-session token cap 遥测时新 reducer 进 `cache-aggregate.ts` 不再撑大 store；break detection 模块独立后扩 reason 维度（如未来加 model digest）也不影响 io 层
- **B4 修 stale tools 测试断言**：`tools.test.ts:67` 和 `registry.test.ts:30` 都断言 "the 4 migrated tools" 但实际 9 个工具。合并到 `registry.test.ts` 一处 `expect(names.sort()).toEqual([...9 tool names].sort())`，删 `tools.test.ts` 冗余 4-tool 段。
- **B5 收敛 RunToolResult 'denied' kind 进 'error'**：4 kind union 实际是 3 kind 语义（`'denied'` 仅来自 `confirmGateHook` deny，唯一 caller 立即包成 `USER_DENIED` ToolError）。`confirmGateHook` 改成直接返 `{ kind: "error", error: { code: "USER_DENIED", retry_safe: false, ... } }`，删除 `RunToolResult.kind = 'denied'`。3 kind 收尾更干净，新 caller 写 dispatch 不容易漏分支。
- **B6 抽 streamSseResponse helper**：`/chat` 和 `/tool-result` route 各 ~50 行 SSE 脚手架（`ReadableStream` + `write` 吞 controller-closed + done emit + error catch + headers）完全重复。新建 `src/lib/copilot/sse-response.ts` 统一封装，两 route 只写各自的"前置校验 + initialEvents + startParentId 选择"。race-fix 注释（"客户端已 abort / 流已关时 controller.enqueue 会抛 ... 吞掉"）挪到 helper 内同一处。
- **B7 删 `truncateJsonSemantic` 死代码**：17 行函数 + 6 个测试 case，源注释承诺"防止 LLM 产出过长参数把 provider 拒掉"但 `runTool` 全链路无 caller。git 历史保留可恢复，未来若要接入 pre-hook（按 `truncateInputFieldChars` metadata 配额）可从 commit 5d4b3cd 反向 cherry-pick。

### 测试 / 验证

- 全套 614/614 pass（基线 621 − 6 [B7 删 truncate 测] − 1 [B4 合并 stale 断言] + 0 [PR #50 也是 +2 但同一基线] = 614）
- `npx tsc --noEmit` 0 error / `npm run lint` 0 新 warning / `npm run build` success
- `madge --circular --extensions ts,tsx src/components/copilot/` reports **0 cycles**

### 不动（充分理由）

audit 还点了 4 处大文件 / 5 处对称重复 / 3 处独立 path.join 但都判定**不动**：`llm-stream.ts` (671 行) 两 provider parser 共享 `ToolUseState.index` 状态机拆开反增 import 边界；`use-chat-stream.ts` (573 行) 5 个 ref 都是 race-fix 关键路径（PR-3 调试轮次专门修过）；`resolve-context.ts` (467 行) per-type case 已委托 manifest shaper 复杂度被 cap；`store.tsx` (344 行) 多 context 引入 N×N 订阅协调反不如单 context + memo。

### 关于 v0.9.4 这个版本号

v0.9.4 是顺序递增的版本号，不代表"v0.9.4 feature work"已经做。gap 分析推荐的三件 P1 feature（parallel tool dispatch / streaming partial recovery / per-session token cap 遥测）**当前判定不必做**——v0.9.3 已把"看得见的体验缺陷"清干净，三条 P1 没有"现在卡住用户"的痛点。等真撞到痛点再回来开 v0.9.5 / v0.10.0。

## [0.9.3] — 2026-05-09 · Copilot v2.5 P1b/P2 · cache 观测进阶 + tool error recovery + per-route gating (PR #44–48)

v0.9.2 (P1a) 之后两批改动合一起打 0.9.3：前一批 P1b 完成 cache 观测层 + 存储卫生收尾；后一批 P2 三件事基于 v0.9.x 三 PR 后的 code review，把"二轮采纳"系列里漏掉的几条体验 gap 补齐 —— 用户看 cache break 不止知道哪类变了还能看到末尾 diff、LLM 看 tool error 按 enum 而非文案做决策、不同 route 暴露不同工具集减少 LLM 误调。

### Copilot (v2.5 P1b · cache 观测层 + 存储卫生 — PR #44)

基于 openclaw `prompt-cache-observability.ts:51` 6 break reason 设计调研，挑最实际 2 个落地：

- **systemPrompt + tools digest 检测 cache break 原因**：`CacheUsageStat` 扩 `system_prompt_digest` / `tool_digest` 两个 sha256 前 16 字符 digest 字段（每条 jsonl 多 ~70 字节，10K 条 ~700KB —— 半压 jsonl 自然碰撞）。`detectCacheBreakWithReasons` 在 PR1 P0 noise floor 基础上对比 digest，给出 `['system_prompt']` / `['tools']` / `['unknown']` reason 列表；旧 jsonl 行没 digest 时走 `'unknown'` 兼容分支。`/api/copilot/cache-stats` 的 `weekly` 段新增 `recent_break_reasons`；chip tooltip 在 `recent_breaks > 0` 时按 reason 分类展示，让用户一眼看出"上次 break 是改 system 还是动了 tools"。openclaw 另外 4 个 reason（model / retention / transport / streamStrategy）对单 provider 单 session 用不上，故意不抄。
- **`cache-stats.jsonl` startup retention**（30d + N=10000 双阈值）：`pruneCacheStats` 删 ts > 30 天的行（含 malformed JSON）+ 行数 > 10K 时额外从头 trim 到 5K（保最近暖数据）；走项目 `writeAtomic` helper 原子 tmp+rename 写。Next.js `instrumentation.ts` 启动钩子调用一次（`NEXT_RUNTIME === 'nodejs'` 守卫，try/catch warn-swallow，启动失败不挂服务）。避免评测平台跑久了 jsonl 积几十万行拖慢 chip fetch。

新增 25 测试 case：`cache-stats-store.test.ts` 18（digest helpers 8 + detectCacheBreakWithReasons 6 + collectRecentBreakReasons 3 + appendCacheStat round-trip 1）+ `cache-stats-prune.test.ts` 7 新文件。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p1b-cache-break-detection-retention-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p1b-cache-break-detection-retention.md

### Copilot (v2.5 P2 · cache break diff 工具 — PR #46)

P1b 已经能识别"system_prompt 变了"或"tools 变了"，但 tooltip 只能告诉用户"哪一类变了"，定位不到"具体哪几个字符"。本 PR 在 `CacheUsageStat` 加 200 char preview 字段，break 时 tooltip 直接展示 prev/curr 末尾片段对比。

- **`CacheUsageStat` 扩 preview 字段**（`system_prompt_preview` / `tool_preview`，optional，旧 jsonl 行 graceful undefined）+ `computeSystemPromptPreview` / `computeToolPreview` helper（末尾 200 char）+ `findLatestBreakPair` 反向扫最近一对 break。
- **`appendCacheStat` 调用点同步写 preview**（`stream-response.ts` 与 digest 一对落盘）+ `/api/copilot/cache-stats` 的 weekly 段加 `latest_break_pair` 字段。
- **chip tooltip diff 展示**：命中 `system_prompt` / `tools` reason 时追加 before/after 两行（前缀 `...` 标记是末尾片段），4 个新 i18n key（zh + en 成对）。

新增 16 测试 case；`tool_preview` 极端长（>200 char）也走 200 char 截尾保上限，避免某 tool 名特别长 + 工具数多时 tooltip 行炸。

### Copilot (v2.5 P2 · per-route tool gating — PR #47)

把"每次请求塞全部 9 个 tool schema"改成按 `route_type` 动态 gating：

- **按 route_type 暴露工具子集**（新文件 `src/lib/copilot/tools/route-gating.ts`）：5 个 always 工具（`read_context` / `read_resource` / `read_page` / `read_tool_result` / `list_experiments`）+ 按 route 增量。`experiment_detail` / `compare` 加实验工具；`settings/templates` 加 `edit_template`；`settings/datasets` 加 `read_dataset_records`；其余 route 仅 always 集。pageContext 缺失或未识别 route_type 时 fallback always 集，不破。
- **stream-response.ts 调用点 wire**：chat + tool-result 两处 `runToolAwareLlmStream` 传 `visibleToolsForRoute(TOOLS, route_type)` 替代全量 TOOLS；`pageContext` 参数本身不变（gating 只过滤 advertise 的工具数组，不影响 SystemHeader 渲染）。
- **预期行为变化**：（1）LLM 在 dashboard 看不到 `edit_template`，避免误调；（2）跨 route 切换会自然破 cache（tool_digest 变 → P1b chip tooltip 显示 reason='tools'）—— 这是预期，spec §6 说明；同 route 内多轮对话 cache 持续 hit（P1a 4-breakpoint cache 主要受益场景）。

新增 18 测试 case：`route-gating.test.ts` 14 unit + `route-gating.integration.test.ts` 4 integration（dashboard / experiment_detail / template_detail / unknown route 在 Anthropic + OpenAI 两 provider 下 outgoing body.tools shape）。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p2-per-route-tool-gating-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p2-per-route-tool-gating.md

### Copilot (v2.5 P2 · tool error recovery — PR #48)

基于 v0.9.x 三 PR 后的 code review，修正"LLM 看 tool error 全靠 message 文案 prompt"的脆弱性，把 ad-hoc error 路径升级成结构化 contract：

- **结构化 ToolResult contract**（新文件 `src/lib/copilot/tools/tool-result.ts`）：tool 推荐返 `{ ok: true, value } | { ok: false, error: { code, message, hint?, retry_safe? } }`。9 种 ToolErrorCode 标准化（`INVALID_INPUT / NOT_FOUND / UNAUTHORIZED / CONFLICT / RATE_LIMIT / NETWORK / USER_DENIED / AWAITING_CONFIRM / INTERNAL`）。LLM 行为按 enum 而非文案 prompt，更稳定。
- **runTool 兼容封装**：旧 tool（直接返 raw / throw Error）继续 work；throw 兜底成 `INTERNAL` 错误。新 tool 鼓励显式 `ok()/err()` helpers。`RunToolResult` 加 `kind: 'error'`。`isToolResultShape` 收紧到 `ok===true && 'value' in obj` 或 `ok===false && error 是 object`，避免 legacy fixture `{ ok: 1 }` 误判。
- **Anthropic `is_error: true` 协议透传**：`LlmMessage.tool_result` 加 optional `is_error?: boolean`；`build-llm-messages` 用 `isToolErrorShape` 在 inline kind 检测时设字段；`serializeAnthropicNonAssistant` 在 tool_result content block 透传。让 Claude/Sonnet 一眼分清 success vs failure。OpenAI 路径不动（协议无该字段）。
- **7 个 tool 的 input validation 改 explicit err()**：`restart_experiment / read_resource / edit_template / read_dataset_records / read_tool_result / read_experiment_results / read_context` 入口 throw 改 `err('INVALID_INPUT' | 'NOT_FOUND', msg, { hint })`。成功路径 `ok()` 包装。业务 throw（fs read 失败 / loadPersistedToolResult 找不到 ref 等）保留兜底成 INTERNAL。
- **`/tool-result` route handler 简化**：去 try/catch 和字符串拼接（`'tool denied by server hook:'`），按 `RunToolResult.kind` dispatch；error 路径统一 `{ ok: false, error: { code, message, hint?, retry_safe? } }` 形态。`USER_DENIED` / `AWAITING_CONFIRM` 用 `as const` 窄化保留 ToolErrorCode 联合类型。P0 tool-loop-detector 逻辑（warn/block + loop_warn SSE）零变动。
- **ToolCallCard error 渲染**：red alpha tinted 表面（`bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300`，遵循 AGENTS.md 轻量 tinted 表面约定）+ `[CODE] · 中文标签` + 可选 Hint + 可选 retry_safe 小标签（amber alpha）+ `role="alert"` for screen readers。`parseToolError` helper 兼容 3 种 jsonl 形态（new ok/false / 旧 deny / 旧 ad-hoc），ErrorRender 在 5 个 variant（Default / Context / Resource / Retrieval / Write）的 toolResult 分支早返回。

新增 ~38 测试 case；全套 583 → 621/621 pass（rebase 后基线含 PR #47 per-route gating 测试）。

向后兼容：ToolDescriptor.call 返回类型扩 union，旧 tool 不改也 work；jsonl 旧形态（`{ error: msg }` / `{ denied: true }`）由 `isToolErrorShape` 全 cover，UI 由 `parseToolError` 解析后走 INTERNAL / USER_DENIED 显示；`LlmMessage.is_error` optional，OpenAI 序列化按 falsy 不带，Anthropic 网关 `is_error: true` 是 GA 字段。

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p2-tool-error-recovery-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p2-tool-error-recovery.md

### Cleanup (PR #45)

v0.9.2 ship 后 code review 捞到的 4 条小瑕疵：删 `detectCacheBreakWithReasons` 内 `if (!prev)` 死代码、`extractSystemPromptString` 加 4 个 edge case 单测、`llm-stream.ts` 内联 `AnthropicBody` cast 换成 import type、`tool-result-store.ts` preview budget 注释统一标注（19 sep + 100 tail = 519 worst-case）。无功能变更。


## [0.9.2] — 2026-05-08 · Copilot v2.5 P1a · Anthropic 4-breakpoint cache_control + head+tail preview (PR #43)

基于 v0.9.0 ship 后对 hermes `prompt_caching.py` 和 `context_compressor.py` 的深入调研，把"cache 播放流核心"两条改动合进 v2.5。

### 体验

- **Anthropic 4-breakpoint cache_control**（hermes `prompt_caching.py:41-72` system_and_3 策略）：在 `buildStreamingRequestBody` 的 anthropic 分支后置 mutate 请求 body，给 `system` 尾 + 最后 3 条 `messages` 尾 content block 注入 `cache_control: { type: 'ephemeral' }` 5m TTL。native Claude / Bedrock / Sankuai Anthropic gateway 三个 provider 共享 api_format='anthropic' 分支。**Sankuai/Bedrock 实测验证**（aws.claude-opus-4.6 via `/v1/anthropic/v1` Bearer）：3 轮真实对话从 0% 涨到 **本 session 25% · 近 7 天 7%**，cache_creation/cache_read 在 message_start 都按预期落非 0；网关接受字段不返 4xx。OpenAI 分支零影响（integration test + server-side probe 双重验证 body JSON 不含 `cache_control` / `ephemeral` 字符串）。
- **Tool result preview head+tail 双端夹**（hermes `context_compressor.py:692`）：`maybePersistToolResult` 的 preview 从 `slice(0,500)` 改成 head(400) + `\n...[truncated]...\n` + tail(100)，总 budget 不变（≤519 字符）。**用户感知**：错误 stack 的 root cause（常在末尾）保留，LLM 多数场景不再需要回捞 `read_tool_result` 看 error 字段，少一轮调用。

### 测试

- 新增 20 测试 case：`anthropic-cache-control.test.ts` 13（system 各形态 / 最后 3 条 / 4-breakpoint 上限 / 幂等 / 各 content shape / 空 content 防御）+ `tool-result-store.test.ts` 5 新（含 error stack tail 关键 regression）+ `llm-stream-serialize.test.ts` 2 integration（Anthropic body 含 cache_control / OpenAI body 完全无）；全套从 500 涨到 520 case
- Playwright 实机 E2E 三组：Anthropic 3 轮 cache hit rate（25%）/ OpenAI 防回归（双分支 console.log probe 计数 0 vs 2）/ head+tail preview 在 ToolCallCard pre 渲染长度 602（519 双端夹 + 83 ref footer）

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p1a-anthropic-cache-control-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p1a-anthropic-cache-control.md

## [0.9.1] — 2026-05-08 · Copilot v2.5 P0 二轮采纳（CCB / hermes / openclaw）+ loop detector hotfix (PR #41–42)

基于 v0.9.0 ship 后对 CCB / hermes / openclaw 三 repo 原代码的深入调研，对 v2.5 参数和机制做 4 处修正；外加 manual regression 时捞出的 loop detector 与 v2.5 M2 compact_boundary 联动 bug。

### 修正

- **approxTokens 分三层分岔 + image 补偿**（CCB `tokenEstimation.ts:227` + hermes `context_compressor.py:65`）：JSON content `÷2`、中文 heavy(>30% CJK) `÷1.5`、其他 `÷4`；每张图片 url 补偿 1600 tokens。修复 `microCompact maxTotalReplayableTokens=4000` 在 JSON tool_result 上被低估 2 倍的漏洞。
- **aggregateCacheHitRate noise floor**（openclaw `prompt-cache-observability.ts:51`）：drop ≥ 1000 tokens 且 ratio < 0.95 才算 break。chip 新增 `· N breaks` 段（仅 >0 时显示），hover tooltip 解释 noise floor。
- **session_deny_list 对称到 alwaysAllow**（CCB `alwaysDenyRules` + openclaw allow-once/always/deny UI）：Deny 卡新增 "Always deny in this session" checkbox。confirmGate 优先级 deny > allow > 默认 confirm；客户端 `use-chat-stream` 镜像 alwaysAllow 的 line 242 auto-run，加 `pendingAutoDenyRef` 自动 deny 队列，让 UI label 真正生效。
- **chain cap 机制从硬数步 5 换成 hermes 三档重复检测**（`tool_guardrails.py:71`）：原硬 cap 移除，替换为 exact-failure 2/5、same-tool 3/8、no-progress 2/5 的 `analyzeToolLoop`。新增 `SystemNoticeBubble` UI（panel 扁平 + 轻量 alpha tinted amber/red）渲染 warn / block 提示。**用户感知**：以前 4 次 read_context + 1 次 edit 撞 429 的情况现在 proceed；新增"重复失败 / 无进展" block 场景。

### Hotfix

- **loop detector 跨 v2.5 M2 compact_boundary**（PR #42）：上面的 `analyzeToolLoop` 在产线上实际**不会触发**——`/tool-result` POST 时 `branchBefore` 末端是 hanging tool_use（result 还在算），且 v2.5 M2 microCompact 在每个 tool_result 后插一条 `system_compact_boundary`，原 `collectTrailingPairs` 见到这两种结构都会 break。修：先跳过末尾 hanging tool_use / system，找到第一个 tool_result 再扫；扫描中间 hop over system 消息。assistant / user text 仍然打断扫描（intentional：策略变更）。手动 Playwright 回归（同参数 read_resource 连失 5 次 → 3 条 amber SystemNoticeBubble 顺序渲染）证明 hotfix 后端到端 ok。

### 测试

- 新增 30+ 单测 case + 1 integration test + 4 真实 branch 形态 case；全套从 462 涨到 500 case，1.5s 跑完
- Manual regression 6 项全过：deny UI / allow UI / loop warn / loop block 结构 / cache chip / approxTokens 间接

- Spec: docs/superpowers/specs/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption-design.md
- Plan: docs/superpowers/plans/2026-05-08-copilot-v25-p0-ccb-hermes-openclaw-adoption.md

## [0.9.0] — 2026-05-08 · Copilot v2.5 · context 收敛 + compact_boundary + cache 遥测 + alwaysAllow (PR #37–40)

Copilot v2 合进来之后第一个大的演进：三条独立 minor 子系统（context 默认收敛 / transcript 硬边界 + cache 遥测 / 会话级 alwaysAllow）合一起打 0.9.0，加一个 soak 测试捞出来的 Sankuai/Bedrock cache 字段 fix。整体目标是把 copilot 从 v2 的"能用"推向"好用"——上下文默认不泄漏、长对话不无限增长、重复确认有跳过开关。

### 架构

- **Copilot v2.5 M1：默认 context 收敛 + read_dataset_records 工具 + microCompact token 阈值**

  v2 的 context 处理是"默认全 dump"——圈选 / `read_page` / `read_context` 三条路径直接把 `GenericResultRecord` / `TaskSchema` / `Display` / JSX 源码原样塞给 LLM；导致 chip preview 一展开就是 5KB JSON，激进会把上下文窗口压满。v2.5 M1 把默认形态从"全 dump"换成"≤300 chars manifest"，按需取详细数据走专用工具。
  - **manifest 化**：抽 `src/lib/copilot/manifest.ts` 公共纯函数（7 个 shaper：experiment / task_result / task_field / dataset / template / display / rubric），`resolveContextSelf` / `resolveContextById` / `read_page` 三条路径共用调用。`input_preview` / `default_prompt` / JSX 源码 / `notes` / `prompt_template` / `api_config` 默认不再泄漏
  - **新工具 `read_dataset_records(dataset_id, task_id?, limit≤20, offset)`**：read-only，`maxResultSizeChars=8000`。`task_id` 走 `dataset.id_field` 单条快路径；`limit/offset` 分页；`limit` 默认 5 max 20
  - **`microCompact` 加 `maxTotalReplayableTokens`**（build-llm-messages 默认 4000 tokens）：双阈值——最近 N 条 + 累计 token 反向遍历 break。防御 3 条 read_resource 各 5KB inline 的累加场景。`undefined` 时回退老行为（数量阈值 only），向后兼容
  - **划线降权**：Inspector 模式下 TextSelector 关闭（`enabled = open && !inspectorActive`），删 inspector-overlay 的 drag-select 让位 4 行——互斥后无需让位。`text_selection` chip 主语换成 `text in {hostType}#{hostId}`，文本变副语；展开面板拆三段（context chain / selected text / context anchor）+ 指向 `read_context(ctx_N, scope='parent')` 拉完整字段值

- **Copilot v2.5 M2：CompactBoundaryMessage + cache 遥测**

  v2 是"transcript 永远向前组装"——每轮 LLM 调用都把整条 active branch 喂回去，相当于线性增长。M2 加了硬边界（boundary 之前的消息默认不参与组装）+ provider 级 prompt-cache 命中率观测。
  - **Transcript 加 `role: 'system', kind: 'compact_boundary'` 消息**（`src/lib/copilot/boundary.ts`）：`microCompact` 完成且真有消息被压时，在当前 head 之后追加一条 boundary；`buildLlmMessages` 组装前先 `sliceAfterBoundary`，只看 boundary 之后的历史。老 session 无 boundary 时行为等价 v2 现状（`sliceAfterBoundary` 无匹配返原 branch 引用）
  - **`microCompact` 返 `{messages, didCompact}`**：仅 1 个生产 caller（`build-llm-messages.ts`），breaking 但测试调整成本可控；`didCompact` 是判定是否落 boundary 的唯一信号
  - **方案 A**（boundary 接 parent 链 + head 跟）：复用 `appendMessage` 的 `fs.appendFileSync` 原子 append + `updateSession` 原子写；多分支语义自然继承（不同分支各自的 boundary 链互不干扰）
  - **Cache 遥测**（`src/lib/copilot/cache-stats-store.ts`）：每次 LLM 调用抽 `cache_creation_input_tokens` / `cache_read_input_tokens`（Anthropic）+ `prompt_tokens_details.cached_tokens`（OpenAI / 兼容层），落 `data/copilot/cache-stats.jsonl`（append-only，独立于 `message.usage`，session jsonl 形态不变）；hit rate **按 provider 分桶**——Anthropic 分母 = `input + cache_read + cache_creation`，OpenAI 分母 = `input_tokens`（已含 cached）
  - **Chat-view 顶部新增 `CacheStatsChip`**：`本 session X% · 近 7 天 Y%`，10s 自动刷新，hover 原生 tooltip 看最近调用的 model + input + cache_read + cache_create 数字。0 calls 时不渲染。GET `/api/copilot/cache-stats?session_id=` 聚合返 `{session, weekly}`

- **Copilot v2.5 M3：会话级 alwaysAllow**

  v2 的写工具（`edit_template` / `restart_experiment`）每次调用都弹 Confirm 卡，节奏被打断。M3 给 Confirm 卡加一个"本次会话信任此工具"的 checkbox，勾选后该工具下次自动跑——只针对当前 tab + 当前会话，关闭 tab 即清，零持久化。
  - **新 `session-allow.ts`**：sessionStorage helper（client）+ 纯函数 `isSessionAllowed(allowList, toolName)`（client + server 共用）。key `evalyst-copilot-allow-${sid}` 存 `string[]` 工具名数组，per-tab + per-session
  - **Confirm 卡加 Checkbox**（`tool-call-card.tsx` WriteVariant）：`Props.onConfirm` 签名改 `(alwaysAllow: boolean) => void`；勾选 + 点确认 → `useChatStream.confirmTool` 先 `addSessionAllow(sid, tool_name)` 再发 `/tool-result`
  - **双层短路**：
    - **客户端（实际生效层）**：`use-chat-stream.ts` 的 SSE `tool_use_end` handler 在 `needsConfirm()` 处加 `|| isSessionAllowed(getSessionAllowList(sid), tool_name)`，命中直接 push 到 auto-run 队列，跳过 ToolCallCard 渲染
    - **服务端（防御层）**：`PreToolCallCtx` 扩 `session_allow_list?: string[]`；`confirmGateHook` 命中 allow list 直接 proceed；`/chat` 和 `/tool-result` body 都加字段透传
  - **spec §8.5 澄清**：spec 原文写"短路位置在 confirmGateHook"是理论描述；evalyst 当前架构 `/tool-result` `skipConfirm: true` 下 hook 是死代码，实际生效层在客户端。服务端层留好钩子给未来 `/chat` 内执行工具的架构升级（plan 偏差 #10）
  - **隐私默认**：sessionStorage（不是 localStorage / 不写 jsonl）→ 不跨 tab、不持久化、F12 可见可清；spec §8.6 明确不做 alwaysDeny / alwaysAsk / pattern 匹配
  - **e2e 自动化**：`e2e/copilot-v25.spec.ts` 覆盖 spec §10.3 两条断言——chip 展开看到 manifest 形态（`input_preview` / `input_refs` 不出现）+ cache hit rate chip 渲染（seed `data/copilot/cache-stats.jsonl` 后 chip 文字含 `%`）。另两条（active_contexts 不含 input_preview / alwaysAllow 勾选后不弹）需 mock LLM SSE，工程量过大留作手动回归

### Tuning / 修复

- **Sankuai/Bedrock Anthropic SSE cache 字段**（PR #40，打 tag 前 soak 测试捞出来）：Sankuai 走 AWS Bedrock 代理的 Anthropic SSE 和 native Anthropic 有两处差异——`input_tokens` / `output_tokens` 集中在 `message_delta.usage`（native 在 message_start），`cache_creation` 是嵌套对象 `{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}`（native 是扁平 `cache_creation_input_tokens`）。没这个 fix 之前 `claude-opus-4.6` 用户的 cache stats 永远全 0，chip 永远显示 `本 session —`。parseAnthropicEvent 两个分支都加了 nested cache_creation 的 sum；llm-stream-cache 测 4 → 6 cases 锁定

- Spec: docs/superpowers/specs/2026-05-07-copilot-v25-context-followups-design.md（§3 / §4 / §5 / §6 / §8）
- Plan: docs/superpowers/plans/2026-05-07-copilot-v25-m1-context-collapse.md（Task 1-22）

## [0.8.2] — 2026-05-08 · v0.8.1 "alpha 配方"规范尾扫 (PR #36)

v0.8.1 把 `bg-{color}-50` 一刀切成 alpha 配方后，尾扫剩下的幸存者。范围：两类位置——一是 AgentHintBanner 内部的 chip + download 按钮（v0.8.1 没看 banner 内部），二是 4 个 result 组件的失败格 border（v0.8.1 grep 只捞 `bg-X-50` 共现的，裸 border 漏掉）。零架构变更，纯 className 替换。

### 体验

- **暗色模式 polish 续集**：v0.8.1 收口的"alpha 配方"规范向其余幸存者扫尾。
  - `AgentHintBanner` 的 `<code>/evalyst</code>` chip 原用 `bg-background`，dark mode 下黄色玻璃卡里嵌一颗黑底深米粒；改 `bg-foreground/5` 既不抢色又能看清。同 banner 的「Download SKILL.md」按钮原 `border-amber-300 bg-background hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/30` 双轨写法收成 `border-amber-500/40 bg-card hover:bg-amber-500/15` 单轨
  - 4 处 result 组件失败格还留着裸 `border-red-200`（无 bg，不在 v0.8.1 扫描范围）：`single-list-results` / `json-default-results` / `bubble-auto-results` / `display-jsx` 的 fallback 卡。统一翻成 `border-red-500/40` 与新规范对齐 —— dark mode 下浅粉描边在暗玻璃卡上识别度低的小 bug 修了

## [0.8.1] — 2026-05-07 · v0.8.0 后五波 polish (PR #31–35)

v0.8.0 把 copilot 玻璃 UI 系统从 4 档重做成 9 档之后的一轮 polish —— 都是用户实测发现的"差一口气"的 visual bug，不改任何架构。内容涵盖：tinted CTA 可读性、Inspector hint 文案/居中/层级、sticky chrome 关态 fallback 扁平化、compare 两列贯穿布局 + sticky bleed 修复、暗色模式下轻量 tinted 表面统一规范。期间也收口了 2 条设计规范（"一页一个 tinted 名额"的续写 + 轻量 tinted 表面的 alpha 配方），防止后续位置再重踩同样的坑。

### 体验

- **暗色模式下 tinted 表面修复（badge / 错误格 / 软提示）**：Schema 徽章（dashboard 卡片右上角色标）+ compare 错误格（`error: fetch failed` 那种）+ JSON paste / template 表单里的红绿小提示框，过去一律用 `bg-{color}-50 border-{color}-200 text-{color}-700`，亮色模式下是柔和淡彩，**暗色模式下直接变成一块块刺眼的亮色贴纸**（底色 `*-50` 是近白 hex 常量，`dark:` 没兜底）。现在统一换成 alpha 配方 `bg-{color}-500/10 border-{color}-500/30–40 text-{color}-700 dark:text-{color}-300` —— alpha 叠在 `bg-card` 之上，两边模式下都柔和。顺手修掉 compare 错误格"关 copilot 更刺眼"的症状（原先 copilot 开时 GlassThin inline bg 覆盖了 className，关时 `bg-red-50` 接管）。CLAUDE.md / AGENTS.md 的 Glass UI 章节加小节「轻量 tinted 表面」明确规范，禁止后续新位置再写 `bg-{color}-50`
- **Compare 页两列贯穿 + 标题进左列**：`/compare` 原本顶部 "实验对比" 标题独占一行，左右两列从下面才开始切，左/右上角各空一大块。现在标题和左列折叠按钮并排放进**左列顶部**（折叠时一起隐藏），右列从大卡片最顶端开始（输入/V4-fortune-2/V4-fortune-1 sticky header 直接顶到顶），两列之间的竖向 border 一通到底。`GlassRegular` 去掉 `p-6`，padding 内移到两列各自，分割线贯穿整张大卡。信息密度 ↑、视觉重量 ↓
- **Compare 右列 sticky header bleed 修复**：PR34 把 padding 从外层 GlassRegular 挪到右列 `overflow-auto p-6` 后，sticky header 上方留了 24px 顶 padding 属于滚动区，滚动时内容从这 24px 缝冒到表头上方。copilot 开态被 chrome-up 的 blur + 投影糊成虚影还算正常；copilot 关态 fallback 到扁平 `bg-card`，header 只覆盖自身 box，缝透明，内容硬生生露出。现在右列 padding-top 跟 `useCopilotStore().open` 联动：关 → pt-0 顶到大卡顶无缝；开 → pt-6 让 chrome 浮在 24px 留白里，bleed 被 blur 接管成玻璃层级表现。transition-[padding] 300ms 同步 baseTransition
- **Sticky chrome 关 copilot 时回归 shadcn 扁平**：`GlassStickyHeader` / `GlassStickyFooter` 在 copilot 关闭态原本仍带 `rounded-xl`，配合 `bg-background border-t/b` 出现"半截药丸"——四角圆角但只有单边 border。现在 `rounded-xl` 收敛进 copilot 开态分支；关闭态变成 `bg-card border-{t,b}` 的直角扁平条（暗色下 `--background` 比 `--card` 深一档，与外层卡面错色，所以挑 card 与卡面齐平、只靠 border 划分）。影响：`/compare` 顶栏 + `/settings/**` 表单底部 StickySaveBar
- **Inspector hint banner 文案简化 + 中间内容区居中**：
  - 文案：「点击页面任意带下划线的区块把它加入 Copilot 视野；Esc 退出」→「点击页面任意区域和 Copilot 展开聊聊」
  - 位置：从相对 viewport 居中（`left-1/2`）→ 相对 `<main>` 居中（ResizeObserver 跟踪 main bbox 动态更新）。sidebar 折叠 / copilot panel resize / 窗口 resize 都会自动重算。不再因 copilot panel 占 420px 让 banner 往左偏
- **Compare prompt preview popover 层级上浮到 inspector 之上**：`PreviewCard.Positioner` z-index `50 → 10000`，在 context-mask (9996) / inspector hover 框 (9997) / inspector hint (9998) 之上。原来用户截图里"Prompt 模板"弹窗被已圈选的 task_field mask 盖住，现在修复
- **Tinted CTA 可读性修复**：`Button variant="tinted"` 在 copilot 开态下白天模式出现"白底白字"（`text-primary-foreground` 近白色 + 旧 tinted 配方 `card 30% + accent 22% gradient` 偏浅）。现在文字 fallthrough 到 `text-foreground`（自适应深/浅色），配方简化为单层 `accent 14% bg + accent 55% border + accent ambient shadow`，视觉和 `GlassSegmentedItem` active tab 完全对齐 —— 全局"主 CTA / active tab 都是同一种发光带"

### 架构

- `useGlassStyle("tinted")` 配方调整：去掉 `card 30%` 双层 + `accent 22% gradient`，改成单层 `accent 14% bg`；border `50% → 55%`；boxShadow accent ambient `30% → 40%`，inset 环 `20% → 25%`。和 `GlassSegmentedItem` active 视觉一致
- `Button` tinted class 加 `data-[copilot-tinted=on]:text-foreground` 让 copilot 开态文字自适应；`data-[copilot-tinted=on]:hover:bg-transparent` 防止 hover 时 `bg-primary/80` 破坏玻璃透明感
- `InspectorOverlay` 加 `hintCenterPx` state + ResizeObserver 跟踪 `<main>` 位置动态更新 hint banner 水平位置

## [0.8.0] — 2026-05-07 · Copilot glass system v2 (4 档 → 9 档 + 4 个 pattern 组件 + 主 CTA 规则)

PR #28 / #29 / #30 三轮把 copilot 玻璃 UI 系统从"4 档 + 一堆每处手搓的 inline style 三件套"重做成"9 档 + 4 个一等 pattern 组件 + 一条页面级视觉规则"。起因是用户发现 compare 表头和 StickySaveBar 的玻璃质感差（"边缘直角 / 字贴边 / 材质浑浊 / 缺 elevation / 缺边缘高光"），定位是档位选错 + 缺方向性投影 + mask fade 语义反，进而引出"还有哪些角色应该是 variant 但没有"的系统性扫描，最终拢合三波 PR 一次定型。

### 体验

- **Compare 页 prompt preview popup 修复被遮**：表头 hover info icon 的 prompt 弹窗从 `absolute z-50` 手写换成 `base-ui` 的 `PreviewCard`（portal 到 body + Floating UI flip/shift），逃出 sticky header 的 stacking context（Chromium 对 sticky + backdrop-filter 绘制顺序的 quirk）
- **Compare 表头 + StickySaveBar 升玻璃悬浮条**：原 `GlassThin + pb-3 / -mx-6 px-6 border-t bg-background + copilot-scroll-edge-*` 拼凑档位错；改用专用 sticky chrome 档（rounded / padding / 方向性阴影 / 切边高光 / 材质厚度）
- **Scoring / FailedPanel / AgentHintBanner 统一成"玻璃 + 语义"**：原"semantic 色 > 装饰 → 不玻璃"约定废除。三个语义卡都升玻璃档（`GlassSuccess` / `GlassDanger` / `GlassWarning`），配方 = Regular 材质 + 语义 border + 弱语义 ambient shadow。copilot 关态 fallback 到 shadcn 扁平
- **Segmented 控件 3 处视觉统一**：RelationDiagram / display mode picker / experiments/new task picker 原本各处手写 `useGlassStyle("thin/tinted") + segmentedItem(active, copilotOpen)` 三件套；现在都走 `<GlassSegmentedItem active render={...}>` 一行组件
- **评测任务表单吸底栏升玻璃**：`template-form-page.tsx` 原手写 `<div sticky bottom-0 bg-background>`（PR #28 漏扫），现迁移到 `StickySaveBar` 与 4 个其它表单一致
- **数据集表单内容不再溢出容器**：`grid-cols-[1fr_380px]` 在 copilot 开 main 变窄时把内容推出容器（`1fr` = `minmax(auto, 1fr)`，auto 下限 = 输入框 min-width）。改成 `minmax(0, 1fr)` 允许左列收缩
- **主 CTA 视觉分配规则**：约定"**一页一个 tinted 名额**"，`GlassSegmentedItem` active 项占名额，sidebar 硬编不占，互斥按钮共享名额。落地：dashboard 顶栏新建 tinted、空态 outline；experiment detail Run / Resume tinted；`/settings/**` 全部按钮保持 default（RelationDiagram tab 已吃名额）

### 架构

- **Copilot 玻璃梯度系统 4 档 → 9 档（6 primitive + 3 semantic）**：
  - 新 primitive 2 档：`chrome-up` / `chrome-down`（Regular 材质 + 方向性投影 + 方向切边高光）
  - 新 semantic 3 档：`success` / `warning` / `danger`（Regular 材质 + tailwind-500 oklch border + 弱语义 ambient shadow）
- **新 pattern 组件 4 个**：
  - `GlassStickyHeader` / `GlassStickyFooter`（`src/components/copilot/sticky-chrome.tsx`）：sticky 定位 + rounded + padding + copilot 开/关 fallback
  - `GlassSegmentedItem`（`src/components/copilot/glass-segmented.tsx`）：render prop 支持 button / Link / a，自动 thin ↔ tinted 切换
- **新 Card-style 组件 3 个**：`GlassSuccess` / `GlassWarning` / `GlassDanger`，由 `makeGlass(variant, SHADCN_CARD_DEFAULTS)` 工厂导出，和 `GlassCard` 同构
- **删 `copilot-scroll-edge-*` CSS 死代码**：mask 渐变方向相反于"悬浮"语义，被 sticky chrome 的 drop shadow 替代。两条 CSS + `prefers-reduced-motion` 降级 selector 一起清
- **`src/lib/segmented.ts` 瘦身**：copilot 开态分支搬进 `GlassSegmentedItem`，签名 `segmentedItem(active, copilotOpen)` → `segmentedItem(active)`。仅给 sidebar / session-list 这种"永远不走玻璃"的位置用

### 测试

- `getGlassStyleForVariant` unit test 从 5 个补到 10 个（chrome-up/down 切边高光 + 投影方向 + 3 档 semantic 的 border 色和 ambient shadow assert）
- 8 处调用点迁移：compare 表头、StickySaveBar、template-form 吸底、display-form / relation-diagram / experiments-new 三处 segmented、Scoring Collapsible / FailedPanel / AgentHintBanner 三处 semantic
- Playwright 两态实测：copilot 开态各 variant 配方正确；关态 fallback 到 shadcn 扁平
- vitest 376 → 381，e2e 9/10（既有 flaky `copilot-v2.spec.ts:12` 单跑通过）

### 文档 / 记忆

- CLAUDE.md §Copilot Glass UI 系统：4 档 → 9 档对照表 + 玻璃作用域规则更新（"semantic 可玻璃"例外）+ Segmented 选中态从 helper 描述改成 `GlassSegmentedItem` 用法
- AGENTS.md §玻璃档位选择：重写档位表覆盖 sticky chrome / segmented / semantic 三类组件化入口；新增 §主 CTA 约定（规则 + 占名额表 + 决策流）
- feedback memory `feedback_copilot_glass_scope.md`：原"amber banner 不玻璃"规则改成"semantic 可玻璃"；新增"sticky chrome / segmented / semantic 不手写三件套，用专用组件"规则；同步 `segmentedItem(active)` 新签名

- Spec: `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md`
- 关联 PR: #28 (sticky chrome) / #29 (semantic + segmented) / #30 (polish-1)


## [0.7.1] — 2026-05-04 · 实验详情页性能清扫 + Anthropic Bearer gateway

Playwright 驱动的两轮实验详情页优化（PR #26 + #27），把重实验下 config Collapsible 的 click-to-paint 从 169ms（含 151ms long task）砍到 14ms（0 long task），-92%。守住 copilot 玻璃一致性 —— round 1 曾把 `GlassCard` → `Card` 拿来省 backdrop-filter 成本，round 2 被用户纠正后全部回退，改用 `startTransition` + `useMemo` 等纯 React 手段达到更好效果。顺手加一条 LLM client 的 Bearer gateway 适配（PR #25）。

### 体验（最终态）

- **config / scoring / FailedPanel Collapsible**：三处 `onOpenChange` 包 `startTransition` → Collapsible 状态切换变 non-urgent transition，click-to-paint 关键路径只剩 state 提交；`contain: layout paint` 在 CollapsibleContent 和 Collapsible 外层保底切反流传播
- **ViewComp 不再每次 toggle 都 diff 104 项**：`viewBundle`（schema/display/view/ViewComp 派生链）+ `resultsNode`（`<ViewComp />` 节点）抽 `useMemo`，父组件因 `configOpen` 状态变更重渲染时 React element 引用稳定，跳过 ~2K 虚拟 DOM diff
- **Running polling 增量化**：原来每秒盲拉 `experiment + progress + results`，results 单次 547KB；改为每秒只拉 `experiment + progress`，仅在 `completed_tasks / failed_tasks` 变化时增量拉 results。空转秒从 547KB 降到 ~10KB
- **其他 memoization 清扫**：`statsAgg`（原在 early return 之后每次 render 跑 `aggregateResults`）上移 `useMemo`；`FailedPanel` 外层 `React.memo` + 内部 `failed` `useMemo`；`handleRun / handleRetryTask / handleStop` 改 `useCallback`
- **prompt 源码 `<pre>`**：抽 `ExperimentPromptPreview` `React.memo` 子组件，不随父 state 重渲染

### 架构

- **LLM client**：`buildApiRequest` 的 Anthropic 分支支持 `Authorization: Bearer` 网关场景 —— `api_key` 以 `"Bearer "` 开头时切到 `Authorization` header 不再发 `x-api-key`；官方 Anthropic API `sk-ant-...` key 行为不变。美团 `aigc.sankuai.com/v1/anthropic/v1` 这类 gateway 可直接用。PR #25
- **`/api/experiments/[id]/results`**：加 `?exclude=field,field` 顶层字段裁剪参数，默认不改向后兼容。当前 polling 改动暂未用，留给前端后续按需瘦身

### 验证

- Playwright 实测：config Collapsible toggle 5 次稳定 **12-21ms / 0 long task**（vs baseline 169ms / 151ms long task）
- 6 维深度 debug（D1 代码 re-review / D2 重实验完整回归 / D3 Rubric scoring / D4 状态边界 / D5 跨页面 smoke / D6 copilot context）全过，0 runtime error
- 全套回归：tsc + vitest 376/376 + build + e2e smoke 10/10（copilot-v2.spec 冷编首次偶发 flake，retry 稳）

### 注意事项（教训）

- **禁止拿 `GlassCard → Card` swap 换微性能**。round 1 里那处 swap 破坏了跨 Collapsible 的玻璃视觉一致性，被用户纠正后在 round 2 全部回退。perf 优化必须用 containment / memo / transition / lazy mount 等非视觉手段。细节见记忆 `feedback_glass_over_perf.md`

- Report: `docs/perf-report-2026-05-03.md`

## [0.7.0] — 2026-05-03 · Copilot v2：上下文 + 工具系统重构

从"一次性 context 注入 + 硬编码 4 工具"重构为"progressive disclosure：system prompt 恒定小 + LLM 按需 tool 拉详情"。三个参考 repo（claude-code-best / hermes-agent / openclaw）综合借鉴，但不做 subagent / 跨 session 记忆 / MCP / 可插拔 ContextEngine（主动划边界避免过度设计）。

- **Tool system**：`ToolDescriptor` + metadata + manual array registry（`src/lib/copilot/tools/`）。每工具一文件；`isDestructive` / `requiresConfirm` / `maxResultSizeChars` / `isReadOnly` 四字段元数据驱动 Confirm gate / 落盘护栏 / micro-compact
- **Hooks**：`preToolCall`（confirmGate + auditLog）+ `postToolCall`（payloadGuard + telemetry）。Confirm 完全从 UI 搬到 metadata，runTool 主入口串链
- **Tool result 护栏**：超 `maxResultSizeChars` 的 output 自动落盘到 `data/copilot/tool-results/{sid}/{tr_xxx}.json`，transcript 只留 500 字 preview + `ref://tool-result/tr_xxx`。`ToolResultContent` = inline | ref | compacted 三态 union；`normalizeToolResult` 读时兼容老 jsonl（裸 JSON string 包装成 inline），`data/copilot/sessions/` 不需要迁移
- **Context 分层**：`SystemHeader` 只放 `route_type + path + active_contexts[{id, type, ref, summary, within}]`，LLM 看到 `ctx_N` 后按需调工具拉详情。原 `formatContextsForLlm` 的 markdown context 墙 + page snapshot 全部退出 system prompt，snapshot 留服务端 `snapshot-cache`
- **3 个新 read 工具**：
  - `read_context(id, scope?)` — 查用户圈选过的 ctx_N，`scope=self|parent|full` 按需升级（task_field parent 带整条 task）
  - `read_resource(type, id, fields?)` — 顺藤摸瓜查用户没圈但需要的资源（experiment/template/dataset/display/rubric），支持字段子集裁剪
  - `read_tool_result(ref)` — 按 ref 回捞落盘的大 tool output
- **Aggregation**：`read_experiment_results` 加 `group_by` (`error_type` / `score_bucket` / `task_id`) + `aggregate` (`count` / `pass_rate` / `avg_score` / `sample_ids`) + `filter` (`score_lt` / `score_gte` / `error_contains`)，让工具内置聚合代替主 LLM 遍历原始数据
- **Micro-compact**：`build-llm-messages` 组装前跑一次，老的可重放（read-only）tool_result 压成 `{kind:'compacted', summary, ref?}`，保最近 3 条；cache 前缀稳定，10 轮对话不再因老 tool_result 撑爆上下文
- **第一个写工具 `edit_template`**：`isDestructive: true` 自动走 Confirm；shallow-merge patch 到 schema，version 自动 +1。验证 metadata → Confirm → hook → 落盘全链路
- **UI 规格调整**：
  - 删除 "预览 LLM 将看到的 context" 折叠面板（v2 LLM 不再看这段 markdown，保留会误导）
  - Chip 本身可展开看详情（懒调 `/api/copilot/contexts/resolve`，component state 缓存），`×` 保持独立 remove 按钮
  - `tool-call-card` 按 tool name 路由 variant：`context` / `resource` / `retrieval` / `write` / `default`，写操作带 amber 边框 + "写操作" badge，`read_resource` 的 type/id 可点击跳详情页
- **JSON 语义截断**：`truncateJsonSemantic`（搬自 hermes `_truncate_tool_call_args_json`），预留给 tool args / preview 防 provider reject
- **破坏性 / 迁移**：**无**。既有 `data/copilot/sessions/*.jsonl` 的 `tool_result.content`（裸 JSON string）被 `normalizeToolResult` 读时包装为 `{kind:'inline', value:...}`；`role: 'tool_use' | 'tool_result'` 保留不动。老会话零改动继续可用

### 测试 / 验证

- 新增约 100 test case（vitest 265 → 364）：types / truncate / registry / hooks / runTool / tool-result-store / read-tool-result / system-header / resolve-context-by-id / read-context / read-resource / read-experiment-results aggregation / micro-compact / build-llm-messages（v2 三 kind + header + compact）/ edit-template / metadata-client-sync
- E2E smoke `e2e/copilot-v2.spec.ts`：root HTTP 200 + 无 pageerror + `/api/copilot/sessions` 正常 + 预览面板不存在
- 全量：`tsc --noEmit` + 364 vitest + 27 路由 build + 1 playwright chromium，全绿

### 参考来源对照

- 借鉴：claude-code-best `buildTool` + `toolResultStorage` + `microCompact` + `useCanUseTool`；hermes-agent `_truncate_tool_call_args_json` + `session_search` 聚合精神；openclaw `before/after-tool-call` 钩子位
- 不做：subagent / AgentTool、跨 session 记忆（四类 taxonomy）、MCP 生态、ContextEngine 可插拔、`autoCompact` 全量 summary、四源权限矩阵、FTS5 session 搜索、Active Memory + LanceDB

- Spec: `docs/superpowers/specs/2026-05-03-copilot-context-tool-v2-design.md`
- Plan: `docs/superpowers/plans/2026-05-03-copilot-context-tool-v2.md`

## [0.6.0] — 2026-05-02 · audit cleanup M1-M5：核心重构 + 约定对齐 + race fix

2026-05-01 的系统性代码审计定位到 19 条 finding（必须改 3 / 值得改 6 / 可以不改 / 不要改）。本版本把"一周全面"路径的 9 条 + 一条 regression 过程中捞到的 chained tool UX race 全部清掉，分 6 个 PR（#18-#23）落地。

### 约定对齐 / 用户侧（M1 · PR #18）

- **F1** `refactor(fs)`：6 个 fs 存储模块（`store / rubric-store / seed / displays / datasets / schema/user-schema-store`）的顶层 `const XXX_DIR = path.join(process.cwd(), ...)` → 惰性函数 `xxxDir()`。对齐 AGENTS.md §测试约定 + 已有正确范例 `llm-config.ts` / `annotation-store.ts` / `copilot/session-store.ts`
- **F2** `i18n(copilot)`：`context-mask.tsx` 硬编中文 "移除" 走 `t("copilot.context_remove_title")`。zh + en 成对加 key
- **F3** `docs`：CLAUDE.md（3 处）+ README Q&A 测试数字 110 → 221（反映实际 vitest count）
- **F7** `feat(llm-client)`：OpenAI `Authorization` header 自动加 `Bearer ` 前缀（`startsWith("Bearer ")` 保留已有 workaround 值），新增 4 条 `buildApiRequest` 单测
  > **破坏性候选**：明确不要 Bearer 的 OpenAI-compat gateway 会开始失败。实测 Sankuai AIGC 网关接受 Bearer 前缀（既有用户配置 + M5 批量跑 + copilot 工具调用全链路通）。如有需求开 issue 加 `ModelConfig.auth_no_bearer_prefix`
- **F9** `docs(readme)`：删 "开源前会补 token 机制" 过期 footnote，改成当前现状（跨网暴露自己加反代）

### 纯函数测试补完（M2 · PR #19）

- **F8** `test(template-builder)`：给 `form-state.ts` 270 行纯函数加 `__tests__`，30 cases 覆盖 empty helpers + `parseEqualsValue` 5 种输入（间接）+ `buildSchemaFromForm` happy path + 10 条 validation 分支 + `formFromSchema` + **round-trip 幂等**（`formFromSchema(buildSchemaFromForm(f).schema!) === f`）。217 → 247（+30）

### Copilot 架构重构（M3-M4 · PR #20-21）

- **F4** `refactor(copilot)` · 抽 `runToolAwareLlmStream` helper：新 `src/lib/copilot/stream-response.ts`（158 行）封装 "调 callLlmStreaming + 累 text/tool_use + 后置按顺序 appendMessage"。`/chat/route.ts` 207 → 131（−76），`/tool-result/route.ts` 275 → 186（−89）。逐字保留 [0.4.0] 的 5 条 PR-3 race fix（appendFileSync 原子 append · controller.enqueue 流关后抛 try/catch · tool_use 落盘先于 emit done · abort signal 透传 · serializeMessagesForProvider alternation 合并）
- **F5** `refactor(copilot)` · `chat-view.tsx` 拆分：812 → **300** 行。新 `use-chat-stream.ts`（497 行）= SSE 解析 + messages state + send/confirmTool/denyTool/deleteMessage/editUserMessage；新 `context-chip-rail.tsx`（113 行）= 圈选按钮 + chip 行 + preview 面板。toast / i18n 通过 props 注入 hook（`onError` + `tI18nXxx`），hook 内不 import sonner / useT —— 解耦 + 未来可测

### Batch-runner 机制替换（M5 · PR #22）

- **F6** `refactor(batch-runner)`：`BatchRunner.run` 从 "N workers × while-loop × running counter × 100ms polling × 二段收尾" 换成标准 Promise pool（`inFlight Set + Promise.race + Promise.all`）。314 → 306 行。保留 100% byte-identical：`stop()` + resume 分支 + 精准 retry (`taskIds` filter) + 每 task 完成 `writeProgress` 节奏 + 最终 `paused`/`completed` status + `executeTask` + `globalThis.__activeRunners` 单例/HMR

### UX race fix（PR #23）

- **observed during M3 regression**：实时流 Copilot tool use 的 Confirm/Deny 按钮会 stale disabled，直到刷新页面才恢复
- **根因**：`useChatStream` 的 `done` handler 在 `setMessages` 的 functional updater 里读 `streamToolUseOrderRef.current`，updater 外紧跟着清 ref。React 19 concurrent 下 updater 可能在 commit 阶段异步运行 —— 此时 ref 已 = `[]` → for-loop 零迭代 → tool_use 的 `m.id` 永远不回填 → `persistedOnServer: false` → 按钮 disabled。Page reload 从服务端拉真 id 才恢复
- **Fix**（14 行）：capture-before-mutate —— 先同步把 ref 值捕获到 local snapshot 再清 ref；updater 用 snapshot

### 验证

- vitest：217 → 251（+34，F7 +4、F8 +30）
- tsc：clean · build：全 27 路由产出正常 · e2e smoke：9/9
- lint：45 问题全部 pre-existing（CI `continue-on-error`，本轮未引入新问题）
- 手动回归：M3 tool chain 3/3（normal chat / auto-run read / confirm-or-deny）· M4 chat-view UI 5/5（session load / input expand / send / edit user msg / chip rail）· M5 单条 retry + pause→resume 3/3 · UX race fix 实测修复前 `confirmDisabled:true` / 修复后 `confirmEnabled:true,denyEnabled:true` 立即可用

### 文档

- Spec: `docs/superpowers/specs/2026-05-01-audit-cleanup-m1-m5-design.md`
- Plan: `docs/superpowers/plans/2026-05-01-audit-cleanup-m1-m5.md`

### Pre-existing 观察（非本版本引入，留记录）

- `completed_tasks` 可能超 `total_tasks`：experiment schema 版本变更导致 task_id 格式改变时（如 `X_user_pref` ↔ `box:X|user:Y`），resume 后老 `completedIds` 不匹配新 tasks → 新 task 全 pending → counter 超 total。batch-runner 初始化段 M5 完全没动，这是 PR-3 时代数据迁移缺陷
- Lint 45 问题：`react-hooks/set-state-in-effect`（i18n provider / 多数 pages 的 loadData effect / material-reveal-overlay 等）+ `transform.ts:72` `Unused eslint-disable directive`。ESLint 9 升级后更严格的 hooks 规则命中，CI 目前 `continue-on-error`

## [0.5.7] — 2026-05-01 · audit cleanup：reduced-motion uniform snap + dead code

v0.5.6 ship 后做的一轮系统性 debug 捡到的四个 finding。

### Reduced-motion 行为修正（a11y）

`applyThemeCascade` 之前在 `prefers-reduced-motion: reduce` 下 early-return 不设 `data-theme-cascading` flag。后果：
- Glass card 仍走 inline 320ms transition（useGlassStyle 提供的 baseline）
- Chrome（body / aside / main）没有 transition → snap
- 两者节奏不同，违反 spec 决策 15"uniform snap for reduced-motion"

**Fix**：reduced-motion 下依然设 flag，只跳过 delay 计算。`@media (prefers-reduced-motion: reduce)` 规则此时匹配，`transition: none !important` 覆盖 glass inline transition 和 chrome crossfade → 两者都 snap，一致。

test case 同步更新："prefers-reduced-motion: sets flag but writes no delay (uniform snap via reduced-motion media rule)"。

### 代码清理

- **Dead CSS variable** `--copilot-wave-core-light`：v0.5.3 引入给浅色 wave peak 用，v0.5.6 浅色 wave 整体 `display:none` 后 declaration 成了唯一引用点。删除
- **Stale comment block** 在 `globals.css` 498 行附近描述已删除的浅色 9-stop wave gradient 结构。删除
- **`applyThemeClass` doc** 提"给 View Transition callback 用"是 v0.5.4 v1 遗留（View Transitions API 当时被放弃）。改为描述 theme cascade 的 pre-transition class toggle 用途

### 验证

- vitest 217/217 green
- tsc clean, build ok
- Playwright 实测 panel animation `animationDuration: 0.68s`、light/dark 模式 wave display:none/block 正确、cascade delay 21 张卡全部写对
- Dev console: 0 errors / 0 warnings

## [0.5.6] — 2026-05-01 · Copilot 打开 + 主题切换的时序打磨（panel 弹性更明显 / 白天去扫光 / 主题 cascade 对齐 reveal）

v0.5.5 hotfix cascade 后用户三条打磨反馈：

### 1. Panel 弹出更明显：450ms → 680ms

`.copilot-panel-enter` 动画时长从 450ms 拉到 680ms，仍走 easeOutExpo 无 overshoot。更"有实体感"的弹出 —— panel 内容不再"一闪就位"，用户能读到弹入轨迹。

其它配套动画（wave 起步 200ms、reveal cascade 首元素 750ms、glow 8s）全部保持不变 —— 它们相对 click 原点的绝对时序仍然合理：wave 在 panel 移动中段出现、reveal cascade 首元素紧跟 panel 落位（delta ~70ms）。

### 2. 白天模式关扫光

浅底扫光多轮 tuning（accent → off-white → wave-core-light 砍 chroma）仍然读作"饱和"或"幽灵"。接受浅底 screen-blend 扫光天然不适合，**彻底在 `:root:not(.dark)` 下 `display: none` `.copilot-reveal-wave` + `.copilot-reveal-tail`**。Dark 模式扫光不动。

Reveal Cascade 的 glass card R→L ripple **不依赖** wave overlay（是独立 CSS transition），所以浅底 panel 打开仍有"每张卡翻面"的感知，只是没有上面那条扫光。

### 3. 主题 cascade 起步加 offset（短停顿后起 ripple）

Copilot 开态切主题时，glass card stagger 全部加 **300ms offset**，让"点击 → cascade 启动"有一个可感知的小停顿：

- 旧公式：`stagger = clamp([0, 1400], (startVw - cx) / 100 * 1400)` → 最右卡 0ms 起跑
- 新公式：`delay = 300 + clamp([0, 1400], (startVw - cx) / 100 * 1400)` → 最右卡 300ms 起跑
- 最左卡最晚到 1700ms 起跑
- cleanup timeout 2000ms → **2300ms**（offset 300 + max stagger 1400 + duration 320 + 280 buffer）

（首轮 tune 给过 750ms 对齐 reveal cascade 首元素，实测读作"等太久"，降到 300ms）

节奏感：点击主题 → 300ms 短停顿 → R→L ripple 从最右起，约 2s 内完成。

### 测试

- vitest：`cascade.test.ts` "copilot open" case 更新 — rightmost 从 0ms 改 750ms、leftmost 从 1050ms 改 1800ms；217/217 tests green
- Playwright 实测：computed `transitionDelay` 按位置落在 [0.925s, 1.528s] 的 observed range，offset 生效

## [0.5.5] — 2026-05-01 · hotfix：theme cascade CSS 从 globals.css 挪到 inline `<style>` 绕过 Turbopack 吞规则

v0.5.4 ship 后用户报"copilot 开态中间区域没有 R→L cascade"。排查发现：

**Turbopack/LightningCSS 静默吞了 globals.css 文末追加的 Theme cascade section**——compiled `.next/dev/static/chunks/...css` 里 0 条匹配 `theme-cascading` 的规则，尽管上面 reveal cascade（结构几乎完全一致）正常。JS 层 `applyThemeCascade` 写 `--theme-cascade-delay` 和 flag 都对，但 CSS override 规则根本不存在，所以 computed `transition-delay` 全是 `0s`。

同一失效模式 v0.5.4 v1（View Transitions API）踩过：LightningCSS 1.32 遇到某些它不完全理解的规则会直接 drop 整块，无 warning。

**Fix**：把 3 条 cascade CSS 规则（glass shorthand override + chrome 320ms + reduced-motion）搬到 `src/app/layout.tsx` 里 `<head>` 的 `<style dangerouslySetInnerHTML>`，绕开整条 CSS pipeline。规则内容零改动，只换注入路径。

- `src/app/layout.tsx` 新增 `THEME_CASCADE_CSS` 常量 + `<style>` 标签挂 `<head>`
- `src/app/globals.css` 原 Theme switch cascade section 替换为引导注释指向 layout.tsx

### 验证

- vitest 217/217 green（helper 逻辑未变）
- Playwright 实测：点主题按钮后 `--theme-cascade-delay` 正确写到每张 glass card，computed `transitionDelay` 读出 `0.646s / 0.235s` 等 stagger 值，`transitionTimingFunction: ease-out` 确认 CSS override 规则匹配并赢得优先级
- 目视 R→L ripple 在 copilot 开态可见

## [0.5.4] — 2026-04-30 · 主题切换 cascade（glass 镜像 reveal + chrome breathing）

> **Note (2026-05-01)**：该版本 ship 时 cascade 在运行时实际不工作（Turbopack/LightningCSS 静默吞了 globals.css 里的 cascade 规则）。**git tag `v0.5.4` 已删除**；首个实际可用的 cascade build 是 v0.5.5。条目保留作为设计/实现的历史记录。

v0.5.3 deferred、v0.5.4 v1（View Transitions API）被放弃（视觉是"扫描线"不是"每元素自己变"）后的第三次尝试。回到 element-level CSS transition 路线——但这次**镜像已经在产稳定的 reveal cascade 机制**做 glass 卡片，同时给非 glass 大块背景（body / aside / main）加一条无 stagger 的 breathing crossfade，整体有呼吸感。

### 体验

- **copilot 关**：所有 glass card 以 0 delay 同步 320ms transition；body / sidebar / panel bg 同步 320ms crossfade —— 一次全屏统一 crossfade，glass 和 chrome 同节奏
- **copilot 开**：glass card R→L 错峰 stagger 0-1400ms（复用 reveal cascade 公式）；body / sidebar / panel bg 同时走 320ms 无 stagger crossfade —— 前景 card 依次翻面 + 背景同时快速到位

### 架构

- `src/lib/theme/cascade.ts` 新增 `applyThemeCascade(copilotOpen, panelPx)` + `clearThemeCascade()`
  - 关态：只设 `html.dataset.themeCascading="true"` flag；不写 delay（全 0）
  - 开态：遍历 `[data-glass-variant]`，按 x 位置 + `panelPx` 换算 `(startVw - cx) / 100 * 1400` clamp [0, 1400] 写 `--theme-cascade-delay`
  - `prefers-reduced-motion: reduce`：不写 delay、不设 flag → 调用方仍 class swap 但无动画 scope
- `src/components/sidebar.tsx` `cycleTheme` 重构：`applyThemeCascade` → `applyThemeClass` → `setTheme` → `setTimeout(clearThemeCascade, 2000)`；`cascadeTimeoutRef` 防连点残留；unmount useEffect 清 timeout + DOM flag
- `src/app/layout.tsx` **移除 `disableTransitionOnChange`** from `<ThemeProvider>`——它注入 `<style>* { transition: none !important }</style>` 吞所有 transition；初次加载 flash 由 next-themes inline script（正交机制）保护，无影响
- `src/app/globals.css` 新增两段：
  - Glass rule：镜像 reveal cascade 结构（完整 shorthand + delay var + 5 个 property + !important）
  - Chrome rule：body / aside / main 320ms crossfade，无 stagger（和 glass baseline 同节奏）

### Tuning

首轮 smoke 后根据反馈调整：
- 关态：chrome 500ms → **320ms**，和 glass 同步。原设计有意"breathing"差节奏，用户反馈感到刺眼；统一更干净
- 开态：glass stagger 上限 1000ms → **1400ms**，R→L 节奏更缓，陈列感更明显
- cleanup timeout 1500ms → **2000ms**（max delay 1400 + duration 320 + 280 buffer）

### 相对 v0.5.3 + v0.5.4 v1 的定位

| 尝试 | 方案 | 结果 |
|---|---|---|
| v0.5.3 | Element-level + stagger + shorthand override + **`*` 全选** + 遇 `disableTransitionOnChange` 吞 | 失败：cleanup flicker + paint 风暴 |
| v0.5.4 v1 | View Transitions API + clip-path wipe/radial | 被放弃：视觉是"扫描线" |
| v0.5.4 v2.1 | Glass 镜像 reveal cascade + chrome breathing crossfade + 删 disableTransitionOnChange | 当前方案 |

**关键修正**：
1. Scope 从 `*` → `[data-glass-variant]`（glass）+ 手写 4 个 chrome selector；不再扫全页
2. 删 `disableTransitionOnChange`——v0.5.3 的第二个根因
3. Chrome 独立 crossfade，避免"card stagger / 背景 snap"割裂感

### 测试

- vitest: `applyThemeCascade` + `clearThemeCascade` 4 case（关态 / 开态 / reduced-motion / 幂等 cleanup）；`applyThemeClass` 4 case 继承
- 全量 217/217 tests green；tsc + build 通过
- 手动 checklist：Chrome 关态 / 开态 × 3 cycle + reduced-motion bypass

### 归档

- v0.5.4 v1（View Transitions API）完整代码 + spec 保存在 `archive/theme-view-transitions` 分支；PR #12 closed 不合并

- Spec: `docs/superpowers/specs/2026-04-30-theme-cascade-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-theme-cascade.md`

## [0.5.3] — 2026-04-30 · Copilot 打开体验三件套（扫光降饱和 + panel 弹性 + 扫光从 panel 边缘起）

围绕 Material Reveal 的打开动效做三项互相独立但衔接到位的改进。主题切换 cascade 仍在调试中，不在本版本。

### 浅色扫光降饱和

- 新增 `--copilot-wave-core-light: oklch(0.82 0.08 230)`——比 `--copilot-accent`（oklch 0.7 0.15 230）亮度 +0.12 / chroma 砍半，专门给浅色 reveal wave 的中心 peak 用
- 浅色 wave 所有 stop 用 `var(--copilot-wave-core-light)` 取代 `var(--copilot-accent)`，中心 peak alpha 95% → 80%，halo 35/60% → 30/50%
- 视觉上从"饱和天蓝"变成"柔和浅蓝"，不再有"饱和刺眼"观感；暗色主题完全不动

### Panel 弹性弹出

- 新增 `@keyframes copilot-panel-enter`（translateX `100%` → `0` + opacity `0` → `1`）+ `.copilot-panel-enter` 类，450ms `cubic-bezier(0.16, 1, 0.3, 1)`（easeOutExpo）
- `panel.tsx` 把 panel 内容 wrapper 加该类，每次 `effectiveOpen` rising edge 重新 mount，CSS animation 自动重播
- 刻意**无 overshoot**：早先 easeOutBack 12% overshoot 叠加 aside `overflow-hidden` 裁切，内容尾部被切会读作"弹来弹去"。easeOutExpo 单向滑入，内部元素不晃
- 关闭无动画保持不变（content 直接 unmount + width 瞬间归零）
- `prefers-reduced-motion: reduce` 关掉动画

### 扫光从 panel 左边缘起 + 三动画节奏错开

- `.copilot-reveal-wave` / `.copilot-reveal-tail` 加 `right: var(--copilot-panel-width, 0px)` — wave overlay 不再覆盖 panel 本体
- Gradient 中心从 `circle at 150vw 50%` 改成 `circle at calc(150vw - var(--copilot-panel-width, 0px)) 50%` — 亮峰 `center - 50vw` 在 t=0 恰好落在 panel 左边缘（= overlay 右沿 = `100vw - panelWidth`）。Panel 关时 var 默认 0 视觉等同原版
- Wave + tail animations 加 `200ms` / `340ms` `animation-delay` —— 让三个动画错开：panel spring 先走 0-450ms，wave 200ms 起步，cascade 紧跟。消除"衔接太挤"
- Wave / tail 默认 `opacity: 0`，fade keyframe 改成 `0%→10% opacity 0→1`——否则 200ms animation-delay 期间 wave 会静止在 panel 边缘 200ms 读作"起点卡一下"
- `computeRevealDelay(centerXvw, startVw=100)` 新增 `startVw` 参数，delay 公式按 panel 宽度调整；`waitForWaveOffsetMs` 350 → 750（含 wave 自己的 200ms delay + 550ms wait-for-wave gap）；clamp 上限 1600 → 2000；overlay cleanup 2000 → 2400ms
- `store.setOpen` / `toggleOpen` rising edge 同步把 panel 宽度写到 `html.style.--copilot-panel-width`，确保 `applyRevealCascade` 读到一致的值；`open/width` effect 进一步同步 resize 期间的变化

### 架构落地

- `src/app/globals.css`：新增 `--copilot-wave-core-light` 变量 + `@keyframes copilot-panel-enter` + `.copilot-panel-enter` 类；改写浅色 wave 配色；wave/tail 基础 rule 加 `right` 和 `opacity: 0` 默认
- `src/components/copilot/material-reveal-overlay.tsx`：`computeRevealDelay` 签名扩展接受 `startVw`；`applyRevealCascade` 读 `--copilot-panel-width` 算 panelVw
- `src/components/copilot/store.tsx`：新增 `widthRef` 同步追踪 panel 宽度；`setOpen` / `toggleOpen` 在 `applyRevealCascade` 之前同步写 `--copilot-panel-width`；`open/width` effect 把 resize 同步到 CSS var
- `src/components/copilot/panel.tsx`：panel 内容 wrapper 加 `.copilot-panel-enter` 类

### 测试

- vitest `computeRevealDelay` 5 case 更新期望值（新 offset 750 + clamp 2000）
- 其它测试不受影响；TS `tsc --noEmit` clean

### 已知限制

- 主题切换仍走 next-themes 原生的 `disableTransitionOnChange`（所有元素 snap）；R→L cascade 的主题切换仍在调试，下版本解决

## [0.5.2] — 2026-04-30 · Light Theme Reveal Wave Tuning

Iteration pass on the `0.5.1` Material Reveal light theme wave after user feedback that the cyan band read as "塑料布罩 UI"（saturated plastic sheet over UI）and didn't match dark theme's 高级 aesthetic.

### 光色重构 —— Symmetric mirror of dark

- 浅色 `.copilot-reveal-wave` 从 `0.5.1` 的"accent-soft 侧翼 + accent 中心 @ multiply blend + saturate(2) contrast(1.3)"重构为**严格镜像 dark 主题的 9-stop symmetric 结构**：
  | r | Dark | Light |
  |---|---|---|
  | 38-62vw | transparent edges | transparent edges（同） |
  | 42/58vw | accent 25% alpha | **off-white rgba(218, 225, 242) 35% alpha** |
  | 46/54vw | accent 50% | **off-white 60%** |
  | 48/52vw | white 70% | **accent 70%** |
  | **50vw PEAK** | **white 95%** | **accent 95%** |
- `mix-blend-mode: screen` → **`normal`**（在近白底上和 multiply 数学等价，语义更清楚为"纯 alpha 叠加不和底色做物理 blend"）
- 所有其他实现（`position/inset/z-index/pointer-events/filter: blur(16px)/contain: layout style paint/animation`）**继承 base rule，完全对齐 dark**
- 尾浪 `.copilot-reveal-tail` 同步简化：砍掉 `saturate(2) contrast(1.3)` filter，blend mode `multiply → normal`，band 30-70vw → **40-60vw**（收紧 20vw 让 radial arc 曲率读得出来，不被宽度稀释成垂直条）
- 删除 `0.5.1` 浅色主题 override 里的 `mix-blend-mode: multiply` + 额外 filter saturate/contrast
- **Off-white 选 `rgba(218, 225, 242)` cool-tinted light gray**：用户反馈 transparent 不行、必须"一点点灰但要有颜色"；在 page bg oklch(0.995) 上 normal blend @ 0.35/0.60 alpha 输出可见冷调浅灰

### 探索过程中被 drop 的方案（全部在 git log 里）

17 轮 tuning commits，尝试过但最终 revert 的方向：
- 双 pseudo-element layered blends（`::before` multiply 蓝 body + `::after` plus-lighter / screen 白核）—— spindle 形状、harsh edges、层间 blend 隔离问题多
- `mask-image` + `backdrop-filter: blur(3px) brightness(1.05)` 做 Contrast Gleam + Iridescent Sheer lens effect —— 结构复杂且辅助层时序和主波对不齐
- Asymmetric 单层 peak 偏外/内半径 —— 无法同时达到"白有色"和"蓝显形"
- Flat-top 4-6vw peak 抗 blur 稀释 —— peak 值守住了但和 ::before 宽度接近时产生纺锤感

最终收敛到"**严格对齐 dark 结构 + 颜色互换 + 浅冷灰白 rgba**"是最干净的答案。

### 架构落地

- `src/app/globals.css`：只改 `:root:not(.dark) .copilot-reveal-wave` + `:root:not(.dark) .copilot-reveal-tail` 两个 override block。完全不动 dark 主题 base rule、pseudo-element 结构（其实没用）、animation、parent 继承链
- **没有新文件**，**没有新测试**，**没有 JS 改动**——纯 CSS tuning 迭代

### 测试

- vitest 209 case 全绿（`material-reveal-overlay` `computeRevealDelay` 5 case 不受 CSS 改动影响）
- e2e smoke 9 case 不受影响（no-crash routing + sidebar render）
- TS `tsc --noEmit` clean

- 相关 commits: `cf8b27d` → `5b484cb`（17 轮迭代，PR #10）

## [0.5.1] — 2026-04-30 · Copilot Material Reveal

### Copilot Material Reveal（一次性唤起动效，替代已 DROP 的 edge glow）

- **触发**：copilot 面板 `open: false → true` rising-edge。⌘K / toggle 按钮均触发。关闭不播；刷新恢复 open=true 不播（首次 mount 屏蔽）
- **视觉**：`radial-gradient` 圆弧扫光从屏外右侧（`circle at 150vw 50%`，band 半径 ~50vw）扫入 viewport；动画 1250ms，`transform: translateX(0 → -100vw)` 单段 `cubic-bezier` + 独立 `opacity` 在末段 50→100% linear 淡出（避免末尾 `radial center` 进 viewport 的"幽灵双弧"）；尾浪 140ms 延后 + 同轨迹。`filter: blur(16px)` 让 wave 读作光晕
- **两套主题色**：
  - **暗色**：accent 侧翼 + 白色 hot core (95% alpha)，`mix-blend-mode: screen`（永远变亮）
  - **浅色**：白色侧翼 + `--copilot-accent-soft` (sky blue L=0.88) halos + `--copilot-accent` 中心 (50% alpha)，`mix-blend-mode: multiply`（反向变成浅蓝光束扫过）
- **Cascade**：`store.setOpen/toggleOpen` 检测 rising edge **同步**调 `applyRevealCascade`，先写 `--reveal-delay` CSS var + `data-copilot-revealing="true"` flag **再**让 React commit shell.tsx 新 inline style——否则浏览器会用 shell 的 inline 320ms 先起跑，后写的 delay 不作用于 in-flight transition。每卡 delay = 300ms offset + `((100 - cardX) / 100) * 1250`，clamp `[0, 1550]`。`html[data-copilot-revealing="true"]` override 用 `!important` 覆盖 shell 的 inline transition
- **清理**：`MaterialRevealOverlay` useLayoutEffect 挂 1950ms setTimeout，setTimeout 或 store.setOpen(false) 时调 `clearRevealCascade` 清所有 `--reveal-delay` + `data-copilot-revealing`。effect return fn 只 `clearTimeout` 不调 cleanup（否则下次 rising-edge React 跑旧 cleanup 会擦掉新写的 delay）
- **A11y**：`prefers-reduced-motion: reduce` 关 overlay、cascade 均匀 200ms；`prefers-reduced-transparency: reduce` 关 overlay（玻璃自身走既有降级）

**架构落地**：
- `src/components/copilot/material-reveal-overlay.tsx` 新增：`computeRevealDelay` 纯函数 + `applyRevealCascade` / `clearRevealCascade` 同步 DOM 助手 + `MaterialRevealOverlay` React 组件（渲染 `.copilot-reveal-wave` + `.copilot-reveal-tail` 两层 overlay）
- `src/components/copilot/store.tsx` 扩展：新字段 `lastOpenedAt: number` rising-edge 时间戳 + `openRef` 同步读当前 open（state 异步）；`setOpen` / `toggleOpen` 在 `setOpenState` 之前同步调 `applyRevealCascade`（rising）或 `clearRevealCascade`（falling）
- `src/app/globals.css` 追加：双 `@keyframes`（`copilot-reveal-wave-translate` + `copilot-reveal-wave-fade` + `copilot-reveal-tail-fade`）+ `.copilot-reveal-wave` / `.copilot-reveal-tail` radial-gradient + `:root:not(.dark)` 亮色主题 override + `html[data-copilot-revealing]` 高优先级 `!important` transition override + a11y 降级
- `src/app/layout.tsx` 挂 `<MaterialRevealOverlay />` 于 `CopilotStoreProvider` 子树内，与 `<GlowOverlay />` 同级

**测试**：
- vitest：204 → 209（新增 computeRevealDelay 5 case，覆盖右边缘 / 中线 / 左边缘 / 负坐标钳位 / 超屏钳位）
- e2e smoke：9 case（未增）

- Spec: `docs/superpowers/specs/2026-04-29-copilot-material-reveal-design.md`
- Plan: `docs/superpowers/plans/2026-04-29-copilot-material-reveal.md`

## [0.5.0] — 2026-04-29 · Copilot page context + UI polish

### Page Context + Viewport Tool（PR-4；P2 Ambient Border Glow DEFERRED）

- **自动 page context**：开 copilot 即向 LLM 注入当前页面摘要（15 种 `route_type` × 每页自定义 summary 字段，e.g. experiment_detail 含 id / name / status / progress / cost_by_currency / rubric_id）。不走 chip rail，仅在系统消息顶部渲染，"预览 LLM 将看到的 context"面板里对用户可见
- **`read_page(query)` 工具**：LLM 可按自然语言 query 查找当前页面可见数据，服务端对 `viewport_index` 做 token 子串打分、top-5 命中复用既有 `resolveContexts()` hydrate 成 tree 返回；`requiresConfirm: false` auto-run；空 token fallback 到整句匹配，resolveContexts 异常时返回部分结果
- **~~Apple Intelligence 风 ambient border glow（screen edges glow · 路线 A CSS 近似）~~ DEFERRED（2026-04-29）**：3 轮 CSS 尝试（inset bloom / conic-gradient mask-composite ring / 5-blob pastel inset）都无法达到用户期望的 Apple Intelligence screen edges glow 观感。真实实现需要 SDF + Simplex noise fragment shader，CSS 做不到。代码 revert，`.copilot-glow` 背景 radial drift 保持 PR-4 前原状。留给未来路线 B（WebGL `<canvas>` + shader）单独立 PR。详见 spec §5.3
- **~~路线 B WebGL edge glow（SDF + Simplex noise + 5 状态机）~~ DROPPED（2026-04-29 晚）**：同日完整实现了路线 B（19 commits，5 states + Inigo Quilez rounded box SDF + Ashima simplex + neon 调色板 + critically-damped spring + premultiplied alpha），但用户体感"太眼花缭乱"整体 drop，不是再 defer。代码 + spec + plan 完整保存在 `archive/edge-glow-webgl` 分支，不合 main，仅作技术参考
- **切页清空 + banner**：`RouteChangeObserver` 监听 `usePathname`+`useSearchParams`，路由变化即清空 manual contexts（inspector / text_selection），session 有 messages 时顶部弹 amber `RouteChangeBanner` 提示"开启新对话"/"继续当前对话"（不阻断切换）
- **统一 client→server snapshot 机制**：`/chat` + `/tool-result` POST body 新增 `client_snapshot = { page_context, viewport_index, ... }`；server 缓存到 per-session Map（`snapshot-cache.ts`），`read_page` 工具按 `sessionId` 取 snapshot；DELETE session 同步清 cache

**架构落地**：
- `src/lib/copilot/` 新增: `use-page-context.ts` hook / `collect-snapshot.ts`（DOM 扫描 + truncate 200 chars + ancestors chain）/ `snapshot-cache.ts`（in-memory Map）
- `src/lib/copilot/tools.ts` 扩展：`CopilotToolContext { sessionId }` 接口 + `read_page` 工具
- `src/lib/copilot/resolve-context.ts` `formatContextsForLlm` 支持 `pageContext` 参数，输出顶部 `# 当前页面` markdown 块
- `src/components/copilot/` 新增: `route-change-banner.tsx` / `route-change-observer.tsx`（Suspense wrapper）
- `src/components/copilot/store.tsx` 扩展：`pageContext` / `typingSignal`（debounced 250ms）/ `routeChangeBanner` / `clearManualContexts`
- 13 个 page 文件补 `useRegisterPageContext()`（dashboard、experiment new/detail、compare、settings list ×5、settings detail ×4、settings new ×4）
- `src/app/globals.css` + `src/app/layout.tsx`：**未动**（P2 border glow DEFERRED；`.copilot-glow` 保持原状）

**测试**：
- vitest：179 → 204（新增 snapshot-cache 5 + read-page-tool 9 + collect-snapshot 7 + resolve-context 扩展 4）
- e2e smoke：9 case（未增；border glow e2e 随 P2 一并 deferred）
- jsdom 加入 devDependencies（collect-snapshot 测试需要 DOM）

**决策记录**（spec §11）：
| # | 决策 | 最终 |
|---|---|---|
| 1 | page_context 粒度 | 每页自定义 getter |
| 2 | page_context UI 展示 | 只在 preview panel，不走 chip |
| 3 | read_page 返回 | 结构化 tree (JSON), preview markdown 渲染 |
| 4 | ~~Border vs 背景光~~ | **DEFERRED**（P2 整体 defer） |
| 5 | 切页 context 行为 | 清所有 + banner（不阻断） |
| 6 | 切页 session 行为 | 保留（A），banner 提供"开启新对话" |
| 7 | read_page 签名 | `query: string` 自然语言 |
| 8 | Snapshot 持久化 | in-memory Map，进程重启丢失 |
| 10 | ~~边框光技术~~ | **DROPPED**（2026-04-29 晚：路线 B WebGL 实现完成后用户体感"太眼花缭乱"整体放弃，代码保存在 `archive/edge-glow-webgl`） |

**Defer / Open Questions**（spec §13）：
- **整个 P2 ambient border glow → 最终 DROPPED**：2026-04-29 先 defer CSS（路线 A），同日晚实现 WebGL（路线 B）后用户体感"太眼花缭乱"整体放弃；代码 + spec + plan 完整保存在 `archive/edge-glow-webgl` 分支（19 commits），未来若重做请另起新 spec
- read_page 对 `task_result:exp_id/task_id` 形 elementKey 的 experiment_id 提取：v1 简化处理，实际命中率待观察
- Firefox < 128 降级 SVG stroke：v1 不做
- 移动端 layout：v1 不做

- Spec: `docs/superpowers/specs/2026-04-28-copilot-page-context-ambient-border-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-copilot-page-context-ambient-border.md`

### UI polish（PR #5 + #6）

- **卡片线条统一 1px**：`GlassCard` / `GlassCardThin` 的 `SHADCN_CARD_DEFAULTS` 去掉 `ring-1 ring-foreground/10`（原来 border 1px + ring 1px 视觉 2px）；清掉 6 处 `GlassRegular` 手工叠加的 ring-1（experiments/[id] 进度卡、settings/datasets/[id] ×2、settings/templates/[id]、display/dataset form preview）。失败任务卡自然只剩红 border
- **Copilot 背景光节奏**：`.copilot-glow::before` + `.copilot-glow-flow` 都 8s（active/streaming 态 4s）；昼/夜共用 keyframes，轨迹完全一样，只调速度
- **点击 spawn 光点整个删除**：不再在点击位置生成柔光，背景光始终保持漂移本色 —— 用户明确要求"不要有点击后变色的效果，统一浅色"。相关清理：`glow-overlay.tsx` 的 SpawnLayer / SPAWN_COLORS / click listener / throttle / state 全部删；`globals.css` 的 `.copilot-glow-spawn` + `@keyframes copilot-glow-spawn` + 对应 reduced-motion 分支删

## [0.4.0] — 2026-04-28 · Copilot 工具调用闭环

Copilot 装上"手"，能调 3 个工具直接读实验数据 + 触发重跑：
- `list_experiments(filter?)` — 发现相关实验（read，no-confirm）
- `read_experiment_results(experiment_id, task_ids?, status?)` — 读结果 / 扫失败（read，no-confirm）
- `restart_experiment(experiment_id, task_ids?)` — 重跑（write，**必 confirm**）

两阶段 streaming 对话（LLM tool_use → 前端暂停渲染卡片 → read 工具无感执行 / write 工具 Confirm/Deny → 前端 POST 结果 → 服务端 append + 再调 LLM），链式上限 5 次。

**架构落地**：
- `src/lib/copilot/tools.ts` + `tool-metadata.ts`（server/client 分层）+ `tool-registry.ts` + `tool-adapters.ts`
- `src/lib/copilot/llm-stream.ts` 扩展：`callLlmStreaming` 接受 `tools` 参数；解析 OpenAI `tool_calls[]` + Anthropic `content_block_start/delta/stop` 流式，归一化 `tool_use_start/delta/end` 事件；`serializeMessagesForProvider` 处理 tool_use / tool_result 消息 + 合并相邻 assistant+tool_use 保证 Anthropic alternation
- `src/lib/copilot/build-llm-messages.ts` 从 chat/route 抽出，复用给 /tool-result
- `src/app/api/copilot/sessions/[id]/tool-result/route.ts` 新端点 —— confirm/deny → run tool → append result → 再流 LLM，chain cap 5 (429)
- `src/components/copilot/tool-call-card.tsx` 3 态卡（loading / confirm / result-collapsed）
- `src/components/copilot/chat-view.tsx` UiMessage 扩为 4 变体 discriminated union；抽 `consumeSseStream`；auto-run read 工具

**测试**：172 → 177 vitest（新增工具 impl + 格式适配 + 消息序列化 + 合并 assistant turn）；e2e smoke 9/9。

`edit_template` **defer**（决策记录见 spec §9）—— 现阶段改 prompt 仍需用户手动到 template 编辑页改。等 3 工具跑稳一轮再加回来。

- Spec: `docs/superpowers/specs/2026-04-28-copilot-pr3-tool-calling-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-copilot-pr3-tool-calling.md`
- PRs: #3（功能落地）+ #4（pipeline 时序 debug race fixes）

### 后续调试轮次修复（已并入本版本）

- **appendMessage 并发写丢消息**：read-modify-writeAtomic 改成 `fs.appendFileSync`（OS 层原子 append）
- **Auto-run 读工具并行风暴**：一轮 N 个 read tool_use_end 改成 async IIFE 串行 await
- **abortRef 覆写不 abort 旧的**：`doStreamSend` 和 `postToolResult` 覆写前先 `abortRef.current?.abort()`
- **SSE `controller.enqueue` 在流关后抛**：`write` helper 包 try/catch 吞掉
- **手动 Confirm/Deny race**：ToolCallCard 按钮在 `tool_use.id`（服务端 `done` 事件回填）到之前 disabled
- **Auto-run read 工具 race**：pendingAutoRunRef 延后到 `done` 事件再 fire，避免 server append tool_use 之前 `/tool-result` 抢跑导致 parent_id 错链
- **`/tool-result` 孤儿 tool_result**：model 校验移到 `appendMessage` 之前
- **tool_result 内容通过 SSE 回传**：`tool_result_message` 事件带 `content` + `denied` + `reason`，摘要能渲 "找到 21 个实验" / "共 3 条结果"
- **client bundle 炸 fs**：split tool metadata 到独立文件，UI 不再透过 `tools.ts` 把 `@/lib/store` 拖进浏览器

### 决策记录（spec §9）

| # | 决策 | 最终 |
|---|---|---|
| 1 | Read 工具是否 confirm | 无感执行 |
| 2 | `edit_template` 粒度 | **整体 defer**（改 prompt 仍走 template 编辑页，3 工具跑稳一轮再加回来） |
| 3 | 链式调用上限 | 5 |
| 4 | tool_use + tool_result 是否持久化 | 持久化 jsonl |
| 5 | Deny 行为 | 继续对话 |
| 6 | Fork 时 pending tool call | 作废 |

### 未验证 / 等配额

- Anthropic-compat（Claude-on-Vertex）live 路径没跑过
- Spec §8 四个人工端到端场景（A 查失败并重跑 / B 发现新实验 / C Deny / D 链式上限）待 Vertex 配额恢复后人工跑一遍

## [0.3.0] — 2026-04-28 · Copilot Glass System

把 copilot 模式的 UI 统一成 4 档玻璃设计系统（Thin / Regular / Thick / Tinted）。目标：打开 copilot 是一种"模式切换"，不是局部改色 —— 中间内容区整体切到玻璃语言，左右 chrome 保持 shadcn 扁平。

### 新增

- `src/components/copilot/shell.tsx` — 4 档玻璃（`GlassThin` / `GlassRegular` / `GlassThick` / `GlassTinted`）+ `useGlassStyle(variant)` hook
- `src/lib/segmented.ts` — 统一选中/激活态 design token `segmentedItem(active, copilotOpen)`，支持 copilot 开/关两套样式
- `--copilot-accent` CSS 变量（sky blue `oklch(0.76 0.16 225)`）—— 专用"发光"信号色，避开项目 `--primary` 的暗褐色
- 可访问性降级（`prefers-reduced-transparency` / `prefers-contrast: more` / `prefers-reduced-motion`）
- `copilot-scroll-edge-top/bottom` 软边 mask 工具类
- JSX display helpers：`helpers.glassStyle(variant)` + `helpers.glassAttr(variant)`，让用户自建 display 兼容 copilot 态
- Button `variant="tinted"` —— 会感知 copilot 态的 primary CTA

### 变更

- Dashboard / experiments / compare / settings / detail 页的所有内容卡 + 外壳迁到 Glass 组件
- Copilot glow 合并 idle/busy 色度（打开就一直"活的"，busy 只是动画更快）
- 浮层（Dialog / Select / 自建 popover）在 copilot 开时自动玻璃
- Compare sticky 表头 + StickySaveBar 加 scroll-edge mask

### 明确不玻璃（故意）

- Sidebar（左 chrome）—— 永远扁平
- Copilot panel 自身（右 chrome）—— 永远扁平
- Panel 内控件（session list / chat button / textarea）—— 永远扁平
- Toast / agent-hint 通知 banner —— semantic 色码信号优先

### 文档

- `docs/superpowers/specs/2026-04-28-copilot-glass-system-design.md` —— 完整设计 spec，含 Apple HIG + MD3 权衡
- `docs/superpowers/plans/2026-04-28-copilot-glass-system.md` —— 12-task 实施计划 + 首轮验证后 5 处调整

## [0.2.0] — 2026-04-27 · Copilot（sidebar AI 助手）

内嵌右侧对话面板，能看到用户屏幕上的东西，准备后续直接代用户改模板 + 触发重跑。

### 新增

**Panel + 会话 + 流式**
- Slide-in 面板（360–720px 可 resize），pin 在右侧
- 会话 CRUD + fork 分支（基于 jsonl append-only + prune-descendants）
- 流式对话（OpenAI + Anthropic SSE 归一化）
- `copilot_enabled` 模型白名单 flag
- ⌘K 开关 / ⌘Enter 发送 / Esc 关闭 / sidebar 自动折叠

**Share Context + Inspector**
- Chrome DevTools 风格元素圈选（Inspector mode）
- 彩色蒙层 + 数字徽章 + 右上角 × 移除（ContextMask）
- 9 种已知 context 类型（experiment / task_result / task_field / text_selection / template / dataset / display / rubric / rubric_stats）
- 划线选中文本 → "+加入 Copilot" 胶囊；常驻高亮重建（TextSelectionMask）
- Context 祖先链（ancestor chain）：`within: task_field:X → task_result:Y → experiment:Z`
- `/api/copilot/contexts/resolve` 批量 resolver + LLM-facing markdown system message
- Stale context 视觉：fade + strikethrough + `!` 警告
- "预览 LLM 将看到的 context" 按钮（markdown 渲染）

**液态玻璃 + UI 打磨（首代 shell）**
- `<CopilotShell>` / `<GlassSurface>` 包装器（0.3 用 4 档系统替代）
- 光晕（`.copilot-glow`）—— 双层 radial gradient 漂移，点击 spawn 光点融入
- Chat 底部重排：model picker + send 按钮同行，kbd 内联
- 可展开 textarea（右上角 expand 按钮，3 → 18 行）
- Fortune v4 display 全面挂 `task_field` 颗粒度
- Compare 对比页 cross-card context 消歧（elementKey 带 `experiment_id` 前缀）

**测试**
- 151 vitest 单测全绿（含 shell / session-store / context-registry / resolve-context）
- 9 e2e smoke 全绿

## [0.1.0] — 2026-04-26 · Evalyst 核心平台

通用 LLM prompt 批量评测平台。四件套（Model / Dataset / TaskSchema / Display）+ Rubric / Annotation，全文件存储，无数据库。

### 平台能力

- LLM 模型列表（OpenAI / Anthropic 双协议归一化 `llm-client.ts`，每模型独立 `pricing` 设置）
- 数据集（JSONL / JSON / CSV 三种上传，`papaparse` 带字段类型推断）
- 评测任务（TaskSchema）：结构化 form + 10 种 transform op + 5 种 filter kind；`{{var}}` 占位 + 条件块 `{{#cond}}...{{/cond}}`
- 实验：批量执行 + 断点续跑 + 单条 retry + per-currency cost 聚合
- 展示模板：自动推断（`single-list` / `dual-list` / `triple-grid` / `bubble-overlay` / `json-default`）+ 用户 JSON 自建（`table` / `grouped_grid` / `jsx`）
- 评分系统：Rubric 定义（pass_fail / likert_1_5 / score_0_100 三种 criterion）+ Annotation append-only + 聚合
- 实验对比页（跨实验按 input_refs 对齐）
- Claude Code skill 集成（平台级 `evalyst` + 资源级 `evalyst-dataset` / `evalyst-task`），下载入口 + 页面引导

### 技术栈

Next.js 16 App Router (Turbopack) · React 19 · TypeScript · shadcn/ui v4 · Tailwind CSS v4 · next-themes · 自建轻量 i18n · `@babel/standalone` 浏览器 JSX 编译 · vitest · Playwright

### 测试 + CI

- 110 vitest 单测（纯函数）
- Playwright E2E smoke（9 case，覆盖每条路由 + skills 下载端点）
- GitHub Actions 两 job：`verify`（tsc → lint → test → build）+ `e2e`（Playwright + 失败上传 HTML report）

---

## 约定

- **功能开发走 feature branch + PR**（见 `CONTRIBUTING.md` §提交流程）
- Commit 前缀：`feat(x):` / `fix(x):` / `refactor(x):` / `docs:` / `chore:` / `test:`
- 每个 version 对应一个 git tag；细节见 Releases 页
