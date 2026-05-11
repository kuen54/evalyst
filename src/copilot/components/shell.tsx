"use client"

/**
 * Re-export shim · Phase 3 #R2-A PR 1/3
 *
 * Glass primitive 已搬到 `src/components/glass/`（视觉 primitive 不属于 Copilot 业务）。
 * 本文件保留作为 backwards-compatible re-export 让 PR 1 不破 40+ 现有 import 站点；
 * PR 2 bulk migrate import 路径后，PR 3 会删除本 shim。
 *
 * 详见 `docs/superpowers/plans/2026-05-11-audit-r2-phase3-glass-extraction.md`。
 */

export {
  useGlassStyle,
  GlassThin,
  GlassRegular,
  GlassCard,
  GlassCardThin,
  GlassSuccess,
  GlassWarning,
  GlassDanger,
} from "@/components/glass/shell"

