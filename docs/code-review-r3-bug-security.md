# Evalyst 严重 bug + 安全风险专项检查

> baseline **v0.14.5** (HEAD `d229981`)
> 视角：单 reviewer · 静态审查（不起 server / 不跑 vitest / 不跑 e2e）
> 范围：类 A 严重 bug / 类 B 安全风险 / 类 C 静默失败模式
> 上轮：[code-review-2026-05-09.md](./code-review-2026-05-09.md) (R1) · [code-review-round-2.md](./code-review-round-2.md) (R2) · [code-review-round-3.md](./code-review-round-3.md) (R3, **0 finding**)

---

## 总判断

**1 项严重 bug · 1 项静默失败模式 · 0 项独立安全风险**

PATCH `/api/experiments/[id]` 缺 `id-mismatch` 校验，`body.id` 可逃出 `data/experiments/`，写到任意 `*.json`（含项目根 `package.json`）——同时构成「类 A 数据丢」+「类 B 写入逃逸」，并因此一并归入第 1 条。第 2 条是 `readResults` 单条 JSONL 坏行就抛——session-store 早已防过，store.ts 漏了。

---

## findings

### 1. 类 A + B · `PATCH /api/experiments/[id]` 写入逃逸 — **major**

**位置**：`src/app/api/experiments/[id]/route.ts:11-21` + `src/lib/store.ts:98-104,117-120`

**触发条件**：

1. PATCH 处理仅做 `getExperiment(id)` 存在性检查，**没有** `body.id !== id` 校验（其余 4 个 `[id]` PATCH 路由都有：`schemas:24` / `displays:23` / `rubrics:41` / `datasets:29`）。
2. `updateExperiment(id, body)` 把 body 整个 spread 进 config：`{ ...config, ...updates, updated_at }`——`body.id` 覆盖 `config.id`。
3. `writeExperiment` 用 `${updated.id}.json` 拼路径：`path.join('data/experiments', '../llm-config.json')` → `data/llm-config.json`。

可触达样例（LAN curl，符合"已 documented 不防"威胁模型，但**写效应**超出 documented surface）：

```
curl -X PATCH http://localhost:3000/api/experiments/<existing>   \
     -H "Content-Type: application/json"                         \
     -d '{"id":"../llm-config","status":"draft"}'
```

写到 `data/llm-config.json`（一坨 experiment-shape JSON 顶掉真正的 llm-config）。或 `body.id="../../package"` → 顶掉项目根 `package.json`。

**后果**：

- `data/llm-config.json` 被覆盖 → `getLlmConfig()` 下次读出来不是合法 shape，`/settings/llm` 列表清空，**所有模型 api_key 丢失**（用户得重新输全部 key）。同样可顶掉 `data/datasets/{x}.meta.json` / `data/displays/{x}.json` / `data/rubrics/{x}.json`。
- 逃出 `data/` 即可顶掉项目根 `package.json` / `tsconfig.json` 等 → 项目崩。
- 即便不被攻击：UI 若哪天误塞了 `id` 字段进 PATCH body，也会同样炸。

**修法**（约 10 分钟）：

```diff
 export async function PATCH(req, { params }) {
   const { id } = await params
   const body = await req.json()
   const config = getExperiment(id)
   if (!config) return 404
   if (config.status === 'running') return 409
+  if (body && typeof body === 'object' && body.id != null && body.id !== id) {
+    return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
+  }
   const updated = updateExperiment(id, body)
```

跟其余 4 路由对齐。如愿做防御纵深，可在 `store.ts:writeExperiment` 顶部加 `if (config.id !== sanitize(config.id)) throw` 守底——非必需。

---

### 2. 类 C · `readResults` 单条坏行整篇崩 — **minor**

**位置**：`src/lib/store.ts:131-144`

**触发条件**：

1. Node 进程在 `appendResult`（`fs.appendFileSync`）中途崩溃 / 系统断电 / 磁盘满 → `results.jsonl` 末尾留半行。
2. 下次 `readResults(experimentId)` 在 `lines.map(line => migrateResultInMemory(JSON.parse(line)))` 上对那一行 `JSON.parse` 抛异常。
3. 异常未被 try/catch 包，整个 `readResults` 直接抛——所有调用方崩：详情页加载失败、resume 反推 `failedIds` 失败、compare 视图打不开。

参照：`src/copilot/lib/session-store.ts:127-132` 已经针对完全同样的 append-only JSONL 模式做了 per-line `try/catch` + `// 跳过坏行` 注释——result store 漏了同款防御。

**后果**：

- 单条坏行 → **整个 experiment 不可读**，所有结果像消失一样（除非用户手动编辑 `results.jsonl` 删那行）。
- 触发概率低（要求进程级或 OS 级中断），但本项目专门跑长时间 LLM 评测，跑完 1k task 之后 last-line 损坏 = **一整轮跑废**，单次 LLM 成本可能上百块。
- 静默：UI 报错堆栈，用户不会想到 "去删 jsonl 最后一行"。

**修法**（约 15 分钟）：

```diff
   const all = content
     .split('\n')
     .filter(Boolean)
-    .map(line => migrateResultInMemory(JSON.parse(line)))
+    .map(line => {
+      try { return migrateResultInMemory(JSON.parse(line)) } catch { return null }
+    })
+    .filter((r): r is GenericResultRecord => r !== null)
```

（如需更稳健可同时 `console.warn` 一句被丢的 line index 给排查用。）

---

## 没找到的事

扫了下面 surface，按本次"严重 + 安全风险"标准都干净：

- **abort/resume race**（batch-runner.ts + batch-runner-lock.ts）：`acquireLock` 已走 `O_EXCL`（R2 #C 闭环），`releaseLock.unlinkSync` 失败被 stale heartbeat 1h 兜底，单进程内 sync `appendFileSync` 自然串行（JS 单线程），跨进程被 file lock 拦死。R1 #9 + R2 #C 已经覆盖。
- **`writeAtomic` 半文件**：`fs-utils.ts:10-14` 是经典 tmp + rename，POSIX 保证 rename 原子。append-mode 的 `appendResult` / `appendMessage` 不走 writeAtomic（不能：append 不能"先写 tmp"），但 session-store 那一侧用 per-line try/catch 兜了，store.ts 那侧就是 finding #2。
- **LLM response 注入 parser**：`result-parser.ts` 三段提取（直接 parse / code block / 首尾大括号）每一步独立 try/catch；schema validate 失败明确返回 `parse_error`，不抛；`raw_response` 字段经 `JSON.stringify(record)` 序列化后落 jsonl，无 `+` 拼接，注 newline 在 `JSON.stringify` 阶段被转义成 `\n`——干净。
- **Cartesian 边界**：`generateTasks` 在 `combos[]` 物化前先纯计数 (line 82-89)，超 100k 抛 `TooManyTasksError`，无 OOM 风险；`estimateTaskCount` 同算法纯计数。
- **path traversal in image filename**：`saveImagesForTask` 里 `taskId = "${alias}:${idVal}"`，alias 前缀 + `:` 字面量打断了 `..` 解释（`path.normalize('images/qa:../../bad_0.png')` = `images/bad_0.png`，停在 imagesDir 内）；image 直出路由 `/api/results/[exp_id]/images/[filename]` 双护：`EXP_ID_PATTERN`/`FILENAME_PATTERN` regex + `path.resolve.startsWith` defense-in-depth。
- **path traversal in dataset/schema/display/rubric write**：`createDataset/Schema/Display` 都有 `/^[a-z][a-z0-9_]*$/` 守 id 正则；rubrics PATCH 在 route 层做正则；`getDataset/getRubric/getDisplay/getUserSchema` 走 `existsSync` 守底，攻击者无法借 `..` 读项目里其他 `.json`（即便 Next.js 16 解 `%2F`，也得 `existsSync` 命中具体后缀文件）。
- **JSX display 沙箱**：`new Function("React", ...)` 运行用户编译产物——R1 标 high by-design，threat model 是用户自己写自己的 source。`makeHelpers` 暴露的是 `readField`/`renderField`/`Badge`/`glassStyle`/`copilotOpen`，全是渲染/读 result 的纯客户端 API，没透传任何 server-side 能力，没新加可滥用面。
- **api_key 日志泄露**：跑了一轮 grep `console.error` × `api_key|Authorization` 全无命中；`callLlm` 在 fetch 阶段把 api_key 装进 headers，HTTP error 只把 status code + body text 回写，不带 headers。R1 #4 已收。
- **abort 信号传播**：`callLlm.executeWithRetry` 在 backoff sleep 后、fetch 前都 check `externalSignal?.aborted` 并抛 `'Aborted'`，外部 abort vs 内部 timeout 用 signal 区分（line 317-319），fetch 自身收 signal 走 AbortError——闭合。`fs.appendFileSync` 是同步，不响应 abort 但也不会被 abort 打断中途。
- **SSE 半路断**：`sse-response.ts` write 走 try/catch 吞 'Controller is already closed'，runner exception 走 catch 写 `kind:'error'` 后 finally close——v0.4.0 race-fix 闭环。

---

## 建议下一步

**finding #1 直接开 PR 修**：单行加一个 `body.id !== id` 早返；同步在 `__tests__/store.test.ts` 加 1 个 case 守底（其他 4 路由都有同款测试）。
**finding #2 视心情**：1h 工夫合一起、或攒到下次 robust 类 PR。一个人地端跑评测，触发概率低；触发 1 次损失 = 一轮 LLM 钱，做了不亏。

两条都不需要新 plan，PR description 顶上写一段说明 + spec link 即可。
