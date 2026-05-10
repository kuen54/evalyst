# Plan · Phase E · #10 metadata mirror 拆掉

> Spec: `docs/superpowers/specs/2026-05-09-audit-cleanup-design.md` §Phase E #10
> **execution gate**：必须等 #2（`refactor/copilot-boundary`）合 main 才开工——本 plan 全用 #2 后的新路径 `src/copilot/lib/tools/`。基于 #2-rebase 的 main 起新 branch。
> Branch: `refactor/copilot-tool-metadata-split` · 估 1d

## 1. 当前状态（plan-write 时刻：2026-05-10）

8 工具登记位置（**重复 6 处**才能加新工具）：
1. `tools/{name}.ts`（descriptor + call + metadata）
2. `tools/registry.ts` `TOOLS` 数组
3. `tools/metadata-client.ts` `CLIENT_TOOL_METADATA` 镜像
4. `__tests__/metadata-client-sync.test.ts` 强制对齐
5. `tool-call-card.tsx` 的 `VARIANT_BY_TOOL`（写工具）
6. `tool-call-card.tsx` import `findClientToolMetadata` / `needsConfirm`

8 工具：list_experiments / read_experiment_results / restart_experiment / read_page / read_tool_result / read_context / read_resource / read_dataset_records / edit_template（实际 9，最新 spec 还在写「8」是 v2 时刻数）。

`metadata-client.ts` 现有信息：name + isReadOnly + isDestructive + requiresConfirm（不含 inputSchema / description / maxResultSizeChars）。

## 2. 目标结构

每工具拆 2 文件：

```
tools/{name}.metadata.ts   ← client-safe：name + description + inputSchema + metadata（isReadOnly / isDestructive / maxResultSizeChars / requiresConfirm）。**禁 import fs / path / store / 任何 server-only 模块**
tools/{name}.server.ts     ← call 函数 + fs/db/store 调用；import 自家 .metadata.ts 拼回完整 ToolDescriptor
```

Registry 拆 2 文件：

```
tools/server-registry.ts   ← server 用：合并 9 个 .server.ts 拿到完整 TOOLS + toolByName
tools/client-registry.ts   ← UI 用：合并 9 个 .metadata.ts 拿 CLIENT_TOOLS + toolMetadataByName + needsConfirm helper
```

删 `tools/metadata-client.ts` + `__tests__/metadata-client-sync.test.ts`（client-registry 自动从 .metadata.ts 拼，不会再 drift）。

## 3. ToolMetadata type 共享层

`tools/types.ts` 已有 `ToolMetadata` 接口（plan-write 时确认）。client-side 共用此 type；若发现某 tool 的 `inputSchema` 引了 server-side 类型（如 `ExperimentConfig`），把这些 type 提到 `tools/types.ts` 共享层（同 PR 内做，但**不引入新抽象**）。

## 4. Commit 节奏

按工具一 commit 拆，9 工具 → 9 commit；最后 2 commit 收尾：
- commit 1–9（每工具）：拆 `{name}.metadata.ts` + `{name}.server.ts`，老 `{name}.ts` 改为 re-export from `.server.ts`（保持 import 路径不变；最后清）
- commit 10：写 `client-registry.ts` + `server-registry.ts`，更新 `registry.ts` 改 re-export server-registry；`tool-call-card.tsx` import 切到 `client-registry`
- commit 11：删 `metadata-client.ts` + `metadata-client-sync.test.ts` + 9 个 `{name}.ts` re-export shim；旧 `registry.ts` 也合并进 `server-registry.ts` 或保留 thin re-export

每 commit message 形如 `refactor(copilot/tools): split <name> into metadata + server (#10)`。

## 5. 验收

- `npx tsc --noEmit && npm test && npm run build` 全绿
- `npm run test:e2e` smoke + copilot-v2 + copilot-v25 全绿
- `grep -rn "from ['\"]node:\\?fs\\|from ['\"]fs" src/copilot/lib/tools/*.metadata.ts` 返 0 行（metadata 不带 fs）
- `grep -rn "from ['\"]@/lib/store" src/copilot/lib/tools/*.metadata.ts` 返 0 行（metadata 不带 store）
- Client bundle 不含 fs polyfill：`npm run build && grep -rl "fs/promises\|node:fs" .next/static/chunks/ 2>/dev/null` 返 0 行（若 grep 不可行，跑 `npx @next/bundle-analyzer` 目检 client chunks 不含 store / fs 路径）
- `tool-call-card.tsx` import 来源**仅** `@/copilot/lib/tools/client-registry`（不再 import `metadata-client`）
- 加新 tool 步骤减为 3 处：`{name}.metadata.ts` + `{name}.server.ts` + 两 registry 各 import 一行（spec §#10 验收）
- CHANGELOG `[Unreleased]` 加 `refactor(copilot): drop metadata mirror, split tools to .metadata + .server (#10)`

## 6. 风险

- **R1（中）· 行为漂移**：拆 metadata 后某工具运行时 metadata 与 server-registry 拼出的 metadata 不一致——`server-registry.ts` 直接 `import { xxxMetadata } from "./xxx.metadata"` 复用同一对象，**不允许重复定义**；测试加一条 `metadata-identity.test.ts` 检查 server descriptor.metadata 与 client metadata 同 reference
- **R2（中）· client bundle fs 漏入**：某 .metadata.ts 不小心 import 了 server-only module（typeof import 链）。Mitigation：每 commit 跑 `grep -rn "from ['\"]@/lib/store\\|from ['\"]node:fs\\|from ['\"]fs" src/copilot/lib/tools/*.metadata.ts`，应返 0；commit 10 后跑 build 看 chunk
- **R3（低）· tool-call-card.tsx VARIANT_BY_TOOL**：保留原状（依然写在 component），只把 metadata 来源换成 `client-registry`。**不重构 VARIANT_BY_TOOL 抽象**——YAGNI
- **R4（低）· 测试 mock 路径**：现有测试 `mock('@/copilot/lib/tools/registry')` 等需改 `'@/copilot/lib/tools/server-registry'`。每 commit grep 验

## 7. 边界 / 禁区

- 不引入新 tool / 不改任何 tool 行为（call 函数体一字不动）
- 不改 metadata 字段语义（isReadOnly / isDestructive / requiresConfirm / maxResultSizeChars 含义不变）
- 不改 hooks / preToolCall / postToolCall / payloadGuard 链路
- 不改 `tool-call-card.tsx` 的 `VARIANT_BY_TOOL`（除 import 来源切换）
- 不动 `system-header.ts` / `build-llm-messages.ts` / `tool-runtime.ts`
- 不动 i18n / Glass UI / api routes
- 实施中发现拆某工具需要改其 call 行为（例如 inputSchema 字段的 type 含 server-only 引用），**停下问用户**——不强行重构 type
- 不自合 PR；push 后等用户 review
