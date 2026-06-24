// Perf fixture: a copilot session with a LONG message history, so we can measure
// rendering cost of the (un-virtualized) chat list while the copilot panel is open
// (glass UI on the main content area + Track B hero refraction on /experiments/[id]).
//
// Mirrors scripts/perf-fixture.ts: plain `fs`, process.cwd()/data, no @-alias imports,
// runnable via `npx tsx scripts/gen-copilot-fixture.ts [count]` (default 200 messages).
// Writes data/copilot/sessions/<id>.jsonl (append-only shape, full body at once) and
// upserts the entry into data/copilot/index.json with head_message_id = last message.

import fs from "node:fs"
import path from "node:path"

const SESSION_ID = "perf_copilot_fixture"
const MODEL_ID = "opus-46-anthropic"
const COUNT = Math.max(20, Number(process.argv[2] ?? process.env.COPILOT_MSGS ?? 200))

const dataDir = path.join(process.cwd(), "data")
const copilotDir = path.join(dataDir, "copilot")
const sessionsDir = path.join(copilotDir, "sessions")
fs.mkdirSync(sessionsDir, { recursive: true })

// A realistically heavy assistant markdown body: heading + paragraph + list + fenced
// code + GFM table — all of which exercise react-markdown + remark-gfm on every row.
function heavyMarkdown(i: number): string {
  return [
    `## 分析步骤 ${i}`,
    ``,
    `我查看了实验配置和结果，下面是这一轮的判断。这里有一段较长的说明文字，用来模拟真实助手回复的体量，` +
      `让 markdown 解析与布局产生可观测的成本（react-markdown 会在每一条变更的助手行重新解析）。`,
    ``,
    `- 第一点：输入预览字段齐全，schema 推断到 single_list`,
    `- 第二点：${i % 3 === 0 ? "存在少量 error 行，需要重试" : "成功率正常"}`,
    `- 第三点：延迟分布在可接受区间`,
    ``,
    "```ts",
    `const score${i} = results.filter(r => r.status === "success").length / results.length`,
    `console.log("pass rate", score${i})`,
    "```",
    ``,
    `| 指标 | 值 | 备注 |`,
    `| --- | --- | --- |`,
    `| 通过率 | ${(80 + (i % 20))}% | 第 ${i} 轮 |`,
    `| 平均延迟 | ${(900 + i * 7)}ms | 滚动样本 |`,
    `| 成本 | $${(0.01 * i).toFixed(2)} | 累计 |`,
    ``,
    `综合来看，这一轮的表现${i % 2 === 0 ? "稳定" : "略有波动"}，建议继续观察后续批次。`,
  ].join("\n")
}

const TOOLS = [
  "read_page",
  "read_experiment_results",
  "list_experiments",
  "read_context",
  "read_resource",
  "read_dataset_records",
] as const

type Msg = Record<string, unknown>

const lines: Msg[] = []
let prevId: string | null = null
const now = Date.now()
let n = 0

function push(partial: Msg): string {
  const id = `m${n.toString(36)}` // lowercase [a-z0-9]
  const msg: Msg = {
    id,
    session_id: SESSION_ID,
    ...(prevId ? { parent_id: prevId } : {}),
    timestamp: new Date(now - (COUNT - n) * 1000).toISOString(),
    ...partial,
  }
  lines.push(msg)
  prevId = id
  n++
  return id
}

// Blocks of [user -> assistant(markdown) -> tool_use -> tool_result -> assistant(markdown)]
let block = 0
while (n < COUNT) {
  push({ role: "user", content: `第 ${block} 轮：帮我看一下这批结果怎么样？`, ...(block % 4 === 0 ? { contexts: [{ tag: 1, type: "task_result", id: `box:${block}` }] } : {}) })
  if (n >= COUNT) break
  push({ role: "assistant", content: heavyMarkdown(block * 2), usage: { input_tokens: 1200 + block, output_tokens: 180 + block }, model_id: MODEL_ID })
  if (n >= COUNT) break
  const tool = TOOLS[block % TOOLS.length]!
  const callId = `call_${block}`
  const toolInput = { query: `round ${block} inspection`, experiment_id: `exp_demo_${block}` }
  push({ role: "tool_use", content: JSON.stringify(toolInput), model_id: MODEL_ID, call_id: callId, tool_name: tool, tool_input: toolInput })
  if (n >= COUNT) break
  const resultValue = {
    summary: `tool ${tool} round ${block} ok`,
    rows: Array.from({ length: 8 }, (_, k) => ({ id: k, status: k % 5 === 0 ? "error" : "success", score: (k * 11) % 100 })),
    note: "这是一段较长的工具结果文本，折叠时只 JSON.parse 不 stringify，展开才 stringify。".repeat(2),
  }
  push({ role: "tool_result", content: JSON.stringify({ kind: "inline", value: resultValue }), call_id: callId, tool_name: tool, denied: false })
  if (n >= COUNT) break
  push({ role: "assistant", content: heavyMarkdown(block * 2 + 1), usage: { input_tokens: 1300 + block, output_tokens: 200 + block }, model_id: MODEL_ID })
  block++
}

const headId = prevId!

// Write the session jsonl
const sessionFile = path.join(sessionsDir, `${SESSION_ID}.jsonl`)
fs.writeFileSync(sessionFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")

// Upsert index.json (newest updated_at so it sorts first / is the default-loaded session)
const indexFile = path.join(copilotDir, "index.json")
let index: { sessions: Record<string, unknown>[] } = { sessions: [] }
try {
  const raw = fs.readFileSync(indexFile, "utf-8")
  const parsed = JSON.parse(raw)
  if (parsed && Array.isArray(parsed.sessions)) index = parsed
} catch {
  /* missing/corrupt → fresh */
}
index.sessions = index.sessions.filter((s) => s.id !== SESSION_ID)
const iso = new Date(now).toISOString()
index.sessions.push({ id: SESSION_ID, title: `Perf fixture · ${COUNT} 条历史`, created_at: new Date(now - COUNT * 1000).toISOString(), updated_at: iso, head_message_id: headId, model_id: MODEL_ID })
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2))

console.log(`[copilot-fixture] wrote ${lines.length} messages (head ${headId}) → session "${SESSION_ID}"`)
