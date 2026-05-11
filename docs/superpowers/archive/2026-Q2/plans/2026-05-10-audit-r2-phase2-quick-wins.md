# Phase 2 Plan · Quick-Win 批（#C → #B → T3）

> **Source**: [`docs/superpowers/specs/2026-05-10-audit-r2-design.md`](../specs/2026-05-10-audit-r2-design.md) §2 Phase 2 · round-2 报告 #B/#C/T3
> **Scope**: 3 PR 各 0.5d，互不依赖；**严格顺序**：上一个 merge 才开下一个分支
> **不在 scope**：#A Glass primitive 切边（Phase 3）、域核心其他低覆盖模块、deps 跨 major

## 0. 硬约束

- **顺序硬**：#C → #B → T3。同 branch 塞多项是 R1 复盘点过的反模式。每 PR merge 后再 `git checkout main && git pull` 开下一个
- **不自合 PR**（AGENTS.md §6 AI 协议）。push 后等用户 review + merge
- **不带 `--no-verify` / 不跳 hooks / 不动 git config**
- **每 PR 4 段 description**：改了什么 / 为什么 / 怎么验证 / 向后兼容风险
- **CHANGELOG `[Unreleased]` 加一行 / PR**；3 PR 全 merge 后由用户统一打 tag
- **状态偏差**：T3 子项「Dockerfile `USER node` + chown」**已在 R1 commit `98be5f1` 完成**（v0.13.0 baseline 即有），spec/round-2 §S7 是 stale 判断 → 本 plan 在 T3 块 omit 该子项

## 1. PR #C · file-lock O_EXCL + race test（refactor/r2-file-lock-oexcl）

**修法**（`src/lib/batch-runner-lock.ts` `acquireLock` L105-124）：

```ts
export function acquireLock(experimentId: string): boolean {
  ensureDir(lockDir(experimentId))
  const p = lockPath(experimentId)
  let fd: number
  try {
    fd = fs.openSync(p, 'wx')             // O_EXCL → EEXIST if exists
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    const existing = readLock(experimentId)
    if (existing && isPidAlive(existing.pid) && !isStaleHeartbeat(existing.last_heartbeat)) return false
    // Stale: overwrite. writeAtomic does tmp+rename, OK to clobber.
    const now = new Date().toISOString()
    writeAtomic(p, JSON.stringify({ pid: process.pid, started_at: now, last_heartbeat: now, node_version: process.version }))
    return true
  }
  const now = new Date().toISOString()
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, started_at: now, last_heartbeat: now, node_version: process.version }))
  fs.closeSync(fd)
  return true
}
```

**新增 race test**（`src/lib/__tests__/batch-runner-lock.test.ts` 加第 7 个 case）：

```ts
it("Promise.all([acquireLock, acquireLock]) yields exactly one true", async () => {
  for (let i = 0; i < 5; i++) {
    const id = `exp_race_${i}`
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => acquireLock(id)),
      Promise.resolve().then(() => acquireLock(id)),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    releaseLock(id)
  }
})
```

**验收**：`npx vitest run src/lib/__tests__/batch-runner-lock.test.ts` 7/7 pass · 5 次循环零 flake · `npx tsc --noEmit` 0 错 · `npm run knip` 干净 · lizard `acquireLock` CCN ≤ 17（当前 ~10，+EEXIST 分支应 ≤ 14）

**受影响文件**：`src/lib/batch-runner-lock.ts`（仅 `acquireLock`） · `src/lib/__tests__/batch-runner-lock.test.ts`（+1 case）

## 2. PR #B · middleware 真名化 + docker loopback + README caveat（docs/r2-csrf-rename）

**修法**：

- `src/middleware.ts` L3 顶头 doc：`Auth gate for /api/*` → `CSRF gate (NOT auth) for /api/*`；删 L8-12 "could exfiltrate keys / run arbitrary server-side JS / trigger writes" 那段（误导性 RCE 措辞，R1 已域代码层修了），保留 L13-22 关于 `Sec-Fetch-Site` 实现说明
- `docker-compose.yml` L6 `"3000:3000"` → `"127.0.0.1:3000:3000"`
- `README.md` 在「快速开始」/「Docker 启动」之间或之后插一段 `## 部署须知（Deployment caveat）`：明示 evalyst 不支持 LAN/公网暴露 · 推荐 ssh tunnel / VPN-only / 反代 + auth 前置 · 关键句："`docker compose` 默认绑 `127.0.0.1`，宿主机外不可见"

**验收**：`grep -E "CSRF gate \(NOT" src/middleware.ts` 命中 1 行 · `grep -E "RCE|exfiltrate keys|run arbitrary" src/middleware.ts` 0 命中 · `grep "127.0.0.1:3000" docker-compose.yml` 命中 · `grep -E "部署须知|Deployment caveat" README.md` 命中 · `npm test` 全绿 · 不动 middleware 实现行为，e2e 仍绿

**受影响文件**：`src/middleware.ts`（仅 doc 注释） · `docker-compose.yml`（1 字段） · `README.md`（+1 段，约 8-12 行）

## 3. PR T3 · cleanup batch（chore/r2-tier3-cleanup）· 3 子项

**子项 a · `npm audit fix`（不带 `--force`）**：当前 6 项（5 mod + 1 high，hono / ip-address / express-rate-limit / postcss）。跑 `npm audit fix` 解能解的 → 跑 `npm test && npx tsc --noEmit && npm run build` 验证；剩余项（postcss 需 next major）在 PR description 列原因
**子项 b · chrome-up/chrome-down inline + 删 variant**：`grep` 验证只在 `src/copilot/components/sticky-chrome.tsx:19,40` 各 1 个 `useGlassStyle("chrome-up"/"chrome-down")` → 把 `shell.tsx` L86-117（chrome-up + chrome-down 两个 if 块的 CSS）inline 到 `sticky-chrome.tsx` 两个组件的 useMemo / 内联 style 里 → 删 `shell.tsx` `GlassVariant` union 里 L11-12 + L30-31 注释 + L86-117 实现分支
**子项 c · `npm outdated` patch-only 升级**：仅升 `lucide-react 1.8 → 1.14` / `@babel/standalone 7.29.2 → 7.29.4` / `nanoid 5.1.9 → 5.1.11` / `jsdom 29.1.0 → 29.1.1` / `@types/node 20.19.39 → 20.19.40` / `@base-ui/react 1.4.0 → 1.4.1` / `tailwind-merge 3.5.0 → 3.6.0` / `@tailwindcss/postcss + tailwindcss 4.2.2 → 4.3.0` / `knip 6.7.0 → 6.12.2` / `shadcn 4.3.0 → 4.7.0`（minor 但 dev tool）/ `eslint-config-next 16.2.4 → 16.2.6` / `next 16.2.4 → 16.2.6`（patch）。**跨 major 不动**：typescript 6 / eslint 10 / @types/node 25。逐组（lockfile-only / docker stack）跑 `npm test && npm run build && npm run knip`

**验收**：`grep -rEn 'chrome-(up|down)' src` 命中 0 · `npm audit` 高/中危项数严格下降 · `npm test` 全绿 · `npm run build` 0 警告新增 · `docker build .` 通过（验证依赖升级未破 alpine 链）· lizard / knip 干净 · **本 PR omit Dockerfile USER 子项**（已 done）

**受影响文件**：`src/copilot/components/shell.tsx`（删 chrome-up/down union + 实现 + JSDoc 行） · `src/copilot/components/sticky-chrome.tsx`（inline CSS） · `package.json` / `package-lock.json` · 可能需更新 `docs/conventions/glass-ui.md` 9 档表（如提及 chrome-up/down 移除）

## 4. CHANGELOG（每 PR 加 1 行到 `[Unreleased]`）

- #C → `### Fixed (#R2-C)` · "batch-runner lock: O_EXCL atomic acquire to close TOCTOU race"
- #B → `### Security (#R2-B)` · "middleware truthful naming + docker-compose loopback + README deployment caveat"
- T3 → `### Cleanup (#R2-T3)` · "npm audit fix · chrome-up/down variant inline · npm outdated patch upgrades"

3 PR 全 merge 后**由用户决定**是否 tag v0.13.2 或 v0.14.0（按 AGENTS.md §4，merge 后观察一两天稳定再打）。
