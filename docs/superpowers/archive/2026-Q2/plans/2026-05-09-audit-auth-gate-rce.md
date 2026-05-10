# Plan · #1 Auth Gate + RCE 修复（Phase A）

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase A · #1
> Branch: `fix/auth-gate-rce` · 工作量 1d · 单 PR

## Goal

把"任何能访问 API 的人 → RCE / 偷 API key / 跑任何写接口"三条攻击路径一次性关掉，让 evalyst 从"localhost-only 玩具"升到"内网工具机可装"，同时不破坏 `.claude/skills/evalyst` 教 agent 直调 API 的产品定位。

## 当前代码定位

| 攻击面 | 文件:行 | 现状 |
|---|---|---|
| RCE | `src/lib/schema/transform.ts:70-78` | `case 'js': new Function('v','ctx',step.fn)` 服务端代码执行 |
| RCE 类型 | `src/lib/schema/types.ts:31` | `TransformStep` 联合含 `{ op: 'js'; fn: string }` |
| RCE UI 入口 | `src/components/template-builder/transform-chain-editor.tsx:28,184-196,214` | Op 下拉含 `js` 选项 + `<Textarea>` 直接录入函数体 + `defaultStep("js")` |
| RCE i18n | `src/lib/i18n/{zh,en}.ts:733-736` (zh) / `:735-738` (en) | `transform.op_js` / `transform.op_js_hint` / `transform.param_js_body` |
| Key 明文 | `src/app/api/llm-config/route.ts:4-6` | GET `getLlmConfig()` 裸返；每条 `ModelConfig.api_key` 全文明文 |
| No-auth | （无 `src/middleware.ts`） | 27 个 API route 无任何 origin / auth 校验 |

数据现状（已 grep 确认）：
- `grep '"op"\s*:\s*"js"' data/schemas/ src/lib/seeds/` → 0 命中
- 即**删 `js` op 不需要数据迁移**，直接删；只需 schema validate 在加载老用户 schema 时报 `INVALID_TRANSFORM_OP` 给出可读错误

## 改动列表

### A · 删 `js` op（攻击面 1）

1. `src/lib/schema/types.ts:31` — 从 `TransformStep` 联合删 `{ op: 'js'; fn: string }` 行
2. `src/lib/schema/transform.ts:70-78` — 删 `case 'js'` 分支；TS 严格模式下 switch 需要 exhaustive，删后自动校验
3. `src/components/template-builder/transform-chain-editor.tsx`
   - `:28` 删 `{ op: "js", ... }` opMeta
   - `:184-196` 删 `case "js"` StepParams 分支
   - `:214` 删 `case "js"` defaultStep
4. `src/lib/i18n/zh.ts` / `en.ts` 删 4 个 key：`transform.op_js`、`transform.op_js_hint`、`transform.param_js_body`（注意 en.ts 的 `Record<keyof typeof zh, string>` 强制对齐）
5. `src/lib/schema/validate.ts` — 加载用户 schema 时若遇到 `step.op === 'js'`（runtime 检查，TS 类型已删但 JSON 文件可能还有），抛 `INVALID_TRANSFORM_OP: js op was removed in v0.11 for security reasons`

### B · mask api_key（攻击面 2）

6. `src/app/api/llm-config/route.ts` — `GET` 返回前 map 每条 model `api_key` → `maskKey(api_key)`（末 4 位保留，前缀 `sk-***`，空字符串返空）；`PUT` 不动（写入仍接明文）。前端编辑表单首次 load 看到的是 mask，要修改某条 key 必须显式重输（UI 已有"测试连接"按钮，重输不增成本）
7. 新增 `src/lib/llm-config.ts` 末尾 `export function maskKey(k: string): string` + `src/lib/__tests__/mask-key.test.ts`（4 case：long / short / empty / null-ish）

### C · auth gate middleware（攻击面 3）

8. 新增 `src/middleware.ts`（Next.js 16 root middleware）：函数体首检 `if (req.nextUrl.pathname.startsWith('/api/skills/')) return`（agent-driven 设计需要 cross-origin 拉 SKILL.md）；之后读 `Sec-Fetch-Site`，`same-origin` / `same-site` / `none` 放行；`cross-site` 检查 `EVALYST_ALLOW_ORIGIN` 逗号分隔白名单，命中放行，否则 403。`config.matcher: ['/api/:path*']`
9. `README.md` 加一段"部署到内网工具机时设 `EVALYST_ALLOW_ORIGIN=https://your-tool.example.com` 让跨源请求通过"

### D · 文档 + e2e

10. 新增 `e2e/auth-gate.spec.ts`：4 case
    - 无 Origin → 200（same-origin / none）
    - `Origin: https://evil.com` → 403
    - `/api/skills/evalyst-dataset` 跨源 → 200（公开放行）
    - `EVALYST_ALLOW_ORIGIN=https://x.com` 下 `Origin: https://x.com` → 200（Playwright `webServer.env` 注入；若并行污染则降级——本地手测最后一条）
11. `CHANGELOG.md` `[Unreleased]` 段加 Security 子段草稿条目

## 测试策略

- **单测**：`maskKey`（4 case）+ `validateSchema` 老 `js` op 报错（1 case）
- **E2E**：4 case 在新 `e2e/auth-gate.spec.ts`；smoke.spec.ts **不动**（既有路由测试本身是 same-origin Playwright，新 middleware 不影响）
- **本地手测**（写在 PR description）：
  - `npm run dev` → `http://localhost:3000` 浏览器打开 → `/settings/llm` 能正常 load + 看到 mask 后的 key
  - `curl localhost:3000/api/datasets`（200）+ `curl -H 'Origin: https://evil.com' localhost:3000/api/datasets`（403）
  - 删除一条 model 测试 PUT 用明文 key 仍能写入
  - `data/schemas/` 里手动塞一个含 `"op":"js"` 的 schema 文件，访问 `/settings/templates/{id}` → 见到可读错误而非 crash

## 验收 Checklist

- [ ] `grep -r '"op":"js"' src/ data/ --include='*.ts' --include='*.tsx' --include='*.json'` 0 命中（除新增的 validate.ts 错误消息字符串）
- [ ] `curl http://localhost:3000/api/llm-config | jq '.models[0].api_key'` 形如 `"sk-***xxxx"` 末 4 位
- [ ] `curl -H 'Origin: https://evil.com' http://localhost:3000/api/datasets` 返 403
- [ ] `curl http://localhost:3000/api/datasets`（无 Origin / same-origin）返 200
- [ ] `curl -H 'Origin: https://anything.com' http://localhost:3000/api/skills/evalyst-dataset` 返 200
- [ ] `npx tsc --noEmit && npm test && npm run build` 全绿
- [ ] `npm run test:e2e` 全绿（含新 auth-gate.spec）
- [ ] 浏览器手测 `/settings/templates/new` 不再有 "js" op 选项

## 风险 / 应对

| ID | 风险 | 应对 |
|---|---|---|
| R1 | 用户从 LAN IP 访问 `http://192.168.x.x:3000`，浏览器报 cross-site | Sec-Fetch-Site 由浏览器决定；浏览器对同主机不同 IP 仍 same-origin（端口 + scheme 相同）；LAN IP 直访也是 same-origin。**不影响** |
| R2 | middleware 破坏 SSE 流（`/api/copilot/sessions/*/chat`） | middleware 仅 `return`（next）或 `403`，从不触动 response。SSE 由 route handler 写。**不影响** |
| R3 | 现存 `data/schemas/{id}.json` 文件含 `js` op（用户改过） | validate.ts 加 friendly error；UI 详情页捕获显示"该 schema 含已废弃的 js transform，请编辑后再用"。不静默 |
| R4 | Playwright `webServer.env` 注入 `EVALYST_ALLOW_ORIGIN` 在并行测试间互相污染 | `playwright.config.ts` 已 `reuseExistingServer: true`；本地 dev server 没设此环境变量。CI 上单独 spec 用 `process.env` 改成 `test.use({ ... })` 隔离；若复杂则降级——只保留 4 个 case 的前 3 条，第 4 条放本地手测 |

## 不在本 PR

rate-limit / token auth（未来 PR）；其它 op 的 try/catch swallow（spec §Non-Goals）；manifest 早抽象删除（Tier 3 batch）；笛卡尔积 cap（Phase C #3）。
