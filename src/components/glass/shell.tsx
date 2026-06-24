"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCopilotOpen } from "./copilot-context"

type GlassVariant =
  | "thin"
  | "regular"
  | "thick"
  | "tinted"
  | "success"
  | "warning"
  | "danger"

const baseTransition =
  "background-color 320ms ease, backdrop-filter 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

// ---- Track A「premium edge」光学配方片段（纯 box-shadow / background-image，零 filter 成本，跨浏览器一致）----
//
// blur / saturate / bg-color 一律不动（filter buffer 不变 = 不引入新 paint 成本，详情页 N 行列表安全）。
// 升级只发生在「边缘光学」：方向性 rim 全档共享；色散 fringe + 内折光 + 镜面扫光仅 thick（few-hero，
// 数据密集的 thin/regular/tinted/semantic 不挂色散，避免亮底列表把色边读成 bug —— 用户钦定 fringe 仅 thick/hero）。
//
// 方向性 rim：左上提亮 / 右下压暗 = 玻璃斜切边吃光（光源默认左上，与 copilot-glow 四角光呼应）。按档加重 alpha。
// regular/thick 额外补一道极淡白底线 `inset 0 -1px 0`：暗模式 --card 近黑，右下黑切边隐形会让 bevel 塌成单边，
// 白底线（绝对白）在亮/暗两边都读得出，给（较大的）卡片稳定的「落地」下沿。
// thin 是数据密集档（results 列表一行一张，可达数百张），刻意只留 2 层 0-blur 内描、不加白底线 ——
// 每行少一层 box-shadow paint，下沿靠相邻行的顶高光读出，把数据密集场景的 per-row 成本压到最低。
const RIM_THIN = "inset 1px 1px 0 oklch(1 0 0 / 0.3), inset -1px -1px 0 oklch(0 0 0 / 0.05)"
const RIM_REGULAR =
  "inset 1px 1px 0 oklch(1 0 0 / 0.55), inset 0 -1px 0 oklch(1 0 0 / 0.08), inset -1px -1px 0 oklch(0 0 0 / 0.07), inset 0 0 0 1px oklch(1 0 0 / 0.08)"
const RIM_THICK =
  "inset 1.5px 1.5px 0 oklch(1 0 0 / 0.65), inset 0 -1px 0 oklch(1 0 0 / 0.1), inset -1.5px -1.5px 0 oklch(0 0 0 / 0.1), inset 0 0 0 1px oklch(1 0 0 / 0.12)"
// 色散边：左缘暖红 / 右缘冷蓝 1px 内描，模拟玻璃边缘色散（chromatic aberration 的廉价 box-shadow 近似）。
// 仅 thick：prototype 给 regular 也挂了 6% 弱 fringe，这里收紧为 thick-only 防数据密集列表 N 卡把彩色边读成渲染 bug。
const FRINGE =
  "inset 2px 0 2px -1px oklch(0.62 0.21 25 / 0.1), inset -2px 0 2px -1px oklch(0.66 0.17 255 / 0.1)"
// 内折光：顶部柔和内高光，制造「内部有厚度」的折射错觉。
const INNER_GLOW = "inset 0 8px 24px -14px oklch(1 0 0 / 0.18)"
// 镜面扫光：静态对角高光 backgroundImage（叠在 bg-color 之上，零动画）。a11y 媒介查询已统一 background-image:none 收敛。
const SWEEP = "linear-gradient(135deg, oklch(1 0 0 / 0.1) 0%, oklch(1 0 0 / 0) 34%, oklch(1 0 0 / 0) 66%, oklch(1 0 0 / 0.05) 100%)"

/**
 * Pure function to compute glass style for a given variant and open state.
 *
 * Copilot 玻璃梯度系统 7 档（4 primitive + 3 semantic）：
 *
 * Primitive:
 * - thin        — chrome / sticky / 数据单元格（blur 16, bg transparent）
 * - regular     — 页面主外壳 + 内容卡（blur 28, bg 35% card）
 * - thick       — 浮层 / copilot panel / dialog（blur 40, bg 55% card, 更重阴影 + 色散/扫光）
 * - tinted      — primary CTA / active tab（blur 28, bg 35% card + accent 染色）
 *
 * Semantic（Regular 材质 + 语义 border + 弱 ambient 色光）：
 * - success — 正向状态卡（emerald 边）
 * - warning — 提示 / 引导 banner（amber 边）
 * - danger  — 错误 / 警告卡（red 边）
 *
 * Track A premium-edge：全档加方向性 rim（左上亮/右下暗斜切高光）；thick 额外挂色散 fringe + 内折光 +
 * 镜面扫光。blur 半径全档保持 16/28/40 不变，升级只在 box-shadow / background-image。
 *
 * copilot 关闭时返回 transition-only style，让外部 className 的 bg-card/bg-background 原样工作。
 */
export function getGlassStyleForVariant(
  variant: GlassVariant = "regular",
  open: boolean
): CSSProperties {
  if (!open) {
    return { transition: baseTransition }
  }

  if (variant === "thin") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 8%, transparent)",
      backdropFilter: "blur(16px) saturate(1.2)",
      WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      borderColor: "color-mix(in oklab, var(--border) 45%, transparent)",
      boxShadow: RIM_THIN,
      transition: baseTransition,
    }
  }

  if (variant === "thick") {
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 55%, transparent)",
      backgroundImage: SWEEP,
      backdropFilter: "blur(40px) saturate(1.3)",
      WebkitBackdropFilter: "blur(40px) saturate(1.3)",
      borderColor: "color-mix(in oklab, var(--border) 60%, transparent)",
      boxShadow:
        `${RIM_THICK}, ${FRINGE}, ${INNER_GLOW}, 0 30px 60px -15px oklch(0 0 0 / 0.32), 0 6px 16px -8px oklch(0 0 0 / 0.12)`,
      transition: baseTransition,
    }
  }

  if (variant === "tinted") {
    // 对齐 GlassSegmentedItem active 的"发光带"视觉：单层 accent 14% 透底 +
    // accent 55% 边 + accent ambient 外光 + 方向性 rim 高光。文字色由调用方
    // 走 `text-foreground`（Button 通过 data-[copilot-tinted=on]:text-foreground
    // 覆盖默认的 text-primary-foreground 实现自适应）。fringe 仅 thick/hero，tinted 不挂。
    return {
      backgroundColor: "color-mix(in oklab, var(--copilot-accent) 14%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, var(--copilot-accent) 55%, transparent)",
      boxShadow:
        "inset 1px 1px 0 oklch(1 0 0 / 0.55), inset 0 -1px 0 oklch(1 0 0 / 0.08), inset -1px -1px 0 oklch(0 0 0 / 0.07), inset 0 0 0 1px color-mix(in oklab, var(--copilot-accent) 25%, transparent), 0 3px 10px -2px color-mix(in oklab, var(--copilot-accent) 40%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.22)",
      transition: baseTransition,
    }
  }

  if (variant === "success") {
    // Regular 材质 + emerald-500 border + 弱 emerald ambient shadow + 方向性 rim
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.696 0.17 162.48) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.696 0.17 162.48) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  if (variant === "warning") {
    // Regular 材质 + amber-500 border + 弱 amber ambient shadow + 方向性 rim
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.769 0.188 70.08) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.769 0.188 70.08) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  if (variant === "danger") {
    // Regular 材质 + red-500 border + 弱 red ambient shadow + 方向性 rim
    return {
      backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
      backdropFilter: "blur(28px) saturate(1.25)",
      WebkitBackdropFilter: "blur(28px) saturate(1.25)",
      borderColor: "color-mix(in oklab, oklch(0.637 0.237 25.33) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.637 0.237 25.33) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  // regular (default)
  return {
    backgroundColor: "color-mix(in oklab, var(--card) 35%, transparent)",
    backdropFilter: "blur(28px) saturate(1.25)",
    WebkitBackdropFilter: "blur(28px) saturate(1.25)",
    borderColor: "color-mix(in oklab, var(--border) 50%, transparent)",
    boxShadow:
      `${RIM_REGULAR}, 0 20px 50px -20px oklch(0 0 0 / 0.22), 0 4px 12px -6px oklch(0 0 0 / 0.08)`,
    transition: baseTransition,
  }
}

/**
 * Copilot 玻璃梯度系统 7 档（4 primitive + 3 semantic）。详见 getGlassStyleForVariant 顶注释。
 *
 * copilot 关闭时返回 transition-only style，让外部 className 的 bg-card/bg-background 原样工作。
 */
export function useGlassStyle(variant: GlassVariant = "regular"): CSSProperties {
  const open = useCopilotOpen()
  return getGlassStyleForVariant(variant, open)
}

type GlassProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "section" | "main" | "header" | "article" | "aside" | "nav"
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "style" | "children">

function makeGlass(variant: GlassVariant, defaultClass: string) {
  return function Glass({ children, className = "", style, as: Tag = "div", ...rest }: GlassProps) {
    const glass = useGlassStyle(variant)
    return (
      <Tag
        data-glass-variant={variant}
        className={`${defaultClass} ${className}`}
        style={{ ...glass, ...style }}
        {...rest}
      >
        {children}
      </Tag>
    )
  }
}

export const GlassThin = makeGlass("thin", "")
export const GlassRegular = makeGlass("regular", "rounded-xl border bg-card")

/**
 * Card-style glass：shadcn `<Card>` 的默认样式 + Regular 玻璃。
 * 等价于 shadcn Card 在 copilot 关闭态。给 "单卡 / 列表卡 / 详情内嵌卡 / 表单段落卡" 用。
 * 页面级主外壳（experiments/new、settings layout 等）仍用 `<GlassRegular>` 免得被 py-4 / gap-4 带偏。
 */
const SHADCN_CARD_DEFAULTS =
  "rounded-xl border bg-card flex flex-col gap-4 py-4 text-sm text-card-foreground overflow-hidden"

export const GlassCard = makeGlass("regular", SHADCN_CARD_DEFAULTS)
/** Card-style glass 的 Thin 档。给数据密集场景（results 行级卡、表格单元格）用 —— blur 小 / bg opacity 低，数字稳定不漂移。 */
export const GlassCardThin = makeGlass("thin", SHADCN_CARD_DEFAULTS)

/**
 * Semantic card-style glass：Regular 材质 + 语义 border + 弱语义 ambient shadow。
 * 覆盖"状态/情绪"类场景。copilot 关闭态继续走 bg-card 实色（className 里带 border-<color>-200 可选）。
 */
export const GlassSuccess = makeGlass("success", SHADCN_CARD_DEFAULTS)
export const GlassWarning = makeGlass("warning", SHADCN_CARD_DEFAULTS)
export const GlassDanger = makeGlass("danger", SHADCN_CARD_DEFAULTS)

// ---- 「hero」变体：旗舰页一页一个的加重玻璃外壳（heavier blur，NO refraction）----
//
// GlassHero 不进 GlassVariant union、不走 getGlassStyleForVariant —— 保持 7 档配额 +
// filter-buffer-lock 测试干净。它是 thick 档的「加重 blur」材质（blur 40 + 方向性 rim），
// 给 /experiments/[id] 与 /compare 的一页一个外壳用。data-glass-variant="hero" 让四条 a11y
// selector + inspector strip 都能匹配到它。
//
// 刻意不挂 feDisplacementMap 折射：实测全页 backdrop-filter: url() 折射 Chromium 无法缓存，
// 每个合成帧重栅整屏，idle 都掉到 ~15fps（见 e2e/glass-track-b-copilot-perf）。折射只留给
// 小而静的 portal（Dialog/Select/compare popover，走 useLensFilter）——那里既便宜又显眼。
// 也不挂 thick 的 fringe/内折光/扫光：全页尺度上这些边缘装饰读起来过载。
/**
 * Pure hero-shell style (unit-tested directly; the hook below just feeds it copilot-open state).
 */
export function getGlassHeroStyle(open: boolean): CSSProperties {
  if (!open) return { transition: baseTransition }
  return {
    // 比 regular 略实一点（40% vs 35%），给大外壳的内容可读性
    backgroundColor: "color-mix(in oklab, var(--card) 40%, transparent)",
    backdropFilter: "blur(40px) saturate(1.3)",
    WebkitBackdropFilter: "blur(40px) saturate(1.3)",
    borderColor: "color-mix(in oklab, var(--border) 55%, transparent)",
    boxShadow:
      `${RIM_THICK}, 0 30px 60px -15px oklch(0 0 0 / 0.32), 0 6px 16px -8px oklch(0 0 0 / 0.12)`,
    transition: baseTransition,
  }
}

function useGlassHeroStyle(): CSSProperties {
  return getGlassHeroStyle(useCopilotOpen())
}

function makeGlassHero(defaultClass: string) {
  return function GlassHero({ children, className = "", style, as: Tag = "div", ...rest }: GlassProps) {
    const heroStyle = useGlassHeroStyle()
    return (
      <Tag
        data-glass-variant="hero"
        className={`${defaultClass} ${className}`}
        style={{ ...heroStyle, ...style }}
        {...rest}
      >
        {children}
      </Tag>
    )
  }
}

/** Track B page-shell：一页一个外壳走 real refraction lens（Chromium-only，fallback 到今天的 blur 玻璃）。 */
export const GlassHero = makeGlassHero("rounded-xl border bg-card")
