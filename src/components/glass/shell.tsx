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

// backdrop-filter is DELIBERATELY excluded from this transition: backdrop-filter does NOT
// interpolate none→blur(), so when copilot opens it snaps in late, AFTER background-color has
// already faded — light mode shows a two-stage 「先透亮、后结霜」转折. Excluding it makes the blur
// apply instantly (present from t=0 but invisible over the still-opaque card, revealed smoothly as
// the fill fades) → frost + transparency arrive together. Closed state still returns { transition }
// only with NO backdrop-filter → zero backdrop cost on the data-dense 300-row page.
const baseTransition =
  "background-color 320ms ease, border-color 320ms ease, box-shadow 320ms ease, background-image 320ms ease"

// ---- Track A「premium edge」光学配方片段（纯 box-shadow / background-image，零 filter 成本，跨浏览器一致）----
//
// MODE-AWARE FILLS（light-dark()）：每档 fill 是 `light-dark(<亮模式 fill>, <暗模式 fill>)`，next-themes 在
// <html> 上设 color-scheme（enableColorScheme 默认开），light-dark() 按当前主题解析。
//  · LIGHT = clean white frost，restrained —— var(--card)：thin 6% / regular 系 20% / thick 30% / tinted(accent) 13% /
//    sticky 26% / hero 27% / semantic 20%。
//  · DARK = 更透 —— var(--card)：thin 3% / regular 系 11% / thick 19% / tinted(accent) 9% / sticky 17% / hero 23%。
//  WHY：近白 LIGHT 底上，透明白 fill 要么读成奶白（太高）要么消失（太低），所以亮模式用 clean restrained 白霜；
//  DARK 底 + ambient glow 下更透让 glow 透出来。曾试过「中性灰 tint」与「multiply-glow 染色衬底」，两者都已回退
//  （灰把 glow 搅浊、multiply 过饱和伤可读性）；glow/背景维持 baseline calm pastel，globals.css 不动。
//  · blur 半径：thin 14 / regular 20 / thick 28 / hero 36（mode-agnostic；blur=paint 成本只降不升，再降会杀掉玻璃质感；
//    数据密集 thin 一页数百张更要守）。luminance 旋钮 compositor-only 色矩阵、airier fill 下撑可读性。
//
// 边缘 → HAIRLINE：rim 是「barely-there 但仍描出面板」的最小 feathered 细线。
//  (a) bevel 用 1px（thick 2px）BLURRED inset，modest α；
//  (b) regular / thick / tinted / semantic / sticky 不挂右下暗切边层 —— 这些档只剩「左上高光 + 白顶线 + 一道
//      极淡白底落地线」（tinted 另有 accent 环闭合 4 角），边是 barely-there 的软细描。只有 thin（数据密集、无白底
//      落地线，需第三条 offset 闭合 corner）保留它自己的右下暗 inset。
// 是 1-2px feather 模糊内描，**不**回 0-blur 锐利（避免生硬「贴纸轮廓」）。
//
// CRITICAL TENSION（背景是 CALM 近白 baseline glow，fill 薄 + 边薄、卡片有溶进底的风险）：distinctness
// 几乎全靠 (1) 左上高光细线 + (2) 1px border（border-color color-mix，几何实边：regular 50% / thin 45% /
// thick 60% / sticky 50%）+ (3) 外 drop-shadow（regular `0 20px 50px -20px /0.22`、thick `0 30px 60px -15px`，
// 投影是近白底上卡片「浮起」的主载体）。左上高光 + 底缘白落地线（`inset 0 -1px 1px`）在亮/暗双向都读得出。
// thick INNER_GLOW 给薄 fill 补「内部有厚度」线索（内部柔光、不是边描，不参与 hairline 收薄）。
// 暗模式 legibility 钳制：regular/semantic brightness 收在 1.08（不到 recipe 的 1.10）—— brightness 会把
// 已近白的渐变核进一步推白、压扁浅灰 muted text 的 ΔL，改让 contrast(1.04) 担可读性主力。升级仍只发生在
// 「边缘光学 + fill/blur」：方向性 rim 全档共享；色散 fringe + 内折光 + 镜面扫光仅 thick（few-hero，数据密集的
// thin/regular/tinted/semantic 不挂色散，避免亮底列表把色边读成 bug —— 本轮仍明确 NOT 给 regular 加
// SWEEP_SOFT/FRINGE_SOFT）。
const RIM_THIN =
  "inset 1px 1px 1px oklch(1 0 0 / 0.4), inset 0 1px 1px oklch(1 0 0 / 0.16), inset -1px -1px 1px oklch(0 0 0 / 0.05)"
const RIM_REGULAR =
  "inset 1px 1px 1px oklch(1 0 0 / 0.42), inset 0 1px 1px oklch(1 0 0 / 0.22), inset 0 -1px 1px oklch(1 0 0 / 0.1)"
const RIM_THICK =
  "inset 1px 1px 2px oklch(1 0 0 / 0.5), inset 0 1px 1px oklch(1 0 0 / 0.26), inset 0 -1px 1px oklch(1 0 0 / 0.11)"
// 色散边：左缘暖红 / 右缘冷蓝 1px 内描，模拟玻璃边缘色散（chromatic aberration 的廉价 box-shadow 近似）。
// 仅 thick：收紧为 thick-only 防数据密集列表 N 卡把彩色边读成渲染 bug，色边在薄 fill 上读成「刻意光学」而非渲染瑕疵。
const FRINGE =
  "inset 2px 0 2px -1px oklch(0.62 0.21 25 / 0.16), inset -2px 0 2px -1px oklch(0.66 0.17 255 / 0.16)"
// 内折光：顶部柔和内高光，制造「内部有厚度」的折射错觉（thick-only）。补回薄 fill 的「玻璃有厚度」线索 ——
// 它是内部柔光不是边描，不参与 hairline 收薄。
const INNER_GLOW = "inset 0 10px 28px -14px oklch(1 0 0 / 0.34)"
// 镜面扫光：静态对角高光 backgroundImage（叠在 bg-color 之上，零动画）。a11y 媒介查询已统一 background-image:none 收敛。
const SWEEP = "linear-gradient(135deg, oklch(1 0 0 / 0.12) 0%, oklch(1 0 0 / 0) 34%, oklch(1 0 0 / 0) 66%, oklch(1 0 0 / 0.06) 100%)"

/**
 * Pure function to compute glass style for a given variant and open state.
 *
 * Copilot 玻璃梯度系统 7 档（4 primitive + 3 semantic）：
 *
 * Primitive（bg fill 为 light-dark(亮模式 clean white frost, 暗模式更透)）:
 * - thin        — chrome / sticky / 数据单元格（blur 14, bg light 6% / dark 3% card）
 * - regular     — 页面主外壳 + 内容卡（blur 20, bg light 20% / dark 11% card）
 * - thick       — 浮层 / copilot panel / dialog（blur 28, bg light 30% / dark 19% card, 更重阴影 + 色散/扫光）
 * - tinted      — primary CTA / active tab（blur 20, bg accent light 13% / dark 9% + accent 染色）
 *
 * Semantic（Regular 材质 + 语义 border + 弱 ambient 色光）：
 * - success — 正向状态卡（emerald 边）
 * - warning — 提示 / 引导 banner（amber 边）
 * - danger  — 错误 / 警告卡（red 边）
 *
 * Track A premium-edge：全档加方向性 rim（左上亮/右下暗斜切细光线）；thick 额外挂色散 fringe +
 * 内折光 + 镜面扫光。MODE-AWARE FILLS：每档 fill 包成 light-dark(亮模式 clean white frost, 暗模式更透)；blur 半径
 * 14/20/28（hero 36）mode-agnostic。亮模式 fill（var(--card)）：thin 6 / regular 系 20 / thick 30 / tinted accent 13 /
 * sticky 26 / hero 27；暗模式 fill：thin 3 / regular 系 11 / thick 19 / tinted accent 9 / sticky 17 / hero 23。
 * rim 收成 hairline 软光（regular/thick/semantic/sticky 不挂右下暗层，SPREAD 守 1px feather 不回 0-blur 锐利）。
 * 卡片 distinctness 在近白底上由「左上高光 + 白底落地线 + border + drop-shadow」兜底，rim 只 feather 这条几何边。
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
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--card) 6%, transparent), color-mix(in oklab, var(--card) 3%, transparent))",
      backdropFilter: "blur(14px) saturate(1.25) brightness(1.07)",
      WebkitBackdropFilter: "blur(14px) saturate(1.25) brightness(1.07)",
      borderColor: "color-mix(in oklab, var(--border) 45%, transparent)",
      boxShadow: RIM_THIN,
      transition: baseTransition,
    }
  }

  if (variant === "thick") {
    return {
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--card) 30%, transparent), color-mix(in oklab, var(--card) 19%, transparent))",
      backgroundImage: SWEEP,
      backdropFilter: "blur(28px) saturate(1.35) brightness(1.12) contrast(1.05)",
      WebkitBackdropFilter: "blur(28px) saturate(1.35) brightness(1.12) contrast(1.05)",
      borderColor: "color-mix(in oklab, var(--border) 60%, transparent)",
      boxShadow:
        `${RIM_THICK}, ${FRINGE}, ${INNER_GLOW}, 0 30px 60px -15px oklch(0 0 0 / 0.32), 0 6px 16px -8px oklch(0 0 0 / 0.12)`,
      transition: baseTransition,
    }
  }

  if (variant === "tinted") {
    // 对齐 GlassSegmentedItem active 的"发光带"视觉：单层 accent 透底（light-dark：亮 13% / 暗 9%）+
    // accent 55% 边 + accent ambient 外光 + 方向性 rim 高光。文字色由调用方
    // 走 `text-foreground`（Button 通过 data-[copilot-tinted=on]:text-foreground
    // 覆盖默认的 text-primary-foreground 实现自适应）。fringe 仅 thick/hero，tinted 不挂。
    // hairline：tinted 不挂右下黑 bevel —— accent 发光带自带的 inset accent 环（`inset 0 0 0 1px accent`）
    // 已闭合 4 角，黑右下层多余且把边读重。rim 收成「左上高光 + 顶/底白线 + accent 环」hairline 软光，blur 20。
    return {
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--copilot-accent) 13%, transparent), color-mix(in oklab, var(--copilot-accent) 9%, transparent))",
      backdropFilter: "blur(20px) saturate(1.3) brightness(1.08)",
      WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.08)",
      borderColor: "color-mix(in oklab, var(--copilot-accent) 55%, transparent)",
      boxShadow:
        "inset 1px 1px 1px oklch(1 0 0 / 0.38), inset 0 1px 1px oklch(1 0 0 / 0.18), inset 0 -1px 1px oklch(1 0 0 / 0.07), inset 0 0 0 1px color-mix(in oklab, var(--copilot-accent) 28%, transparent), 0 3px 10px -2px color-mix(in oklab, var(--copilot-accent) 42%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.22)",
      transition: baseTransition,
    }
  }

  if (variant === "success") {
    // Regular 材质 + emerald-500 border + 弱 emerald ambient shadow + 方向性 rim
    return {
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--card) 20%, transparent), color-mix(in oklab, var(--card) 11%, transparent))",
      backdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      borderColor: "color-mix(in oklab, oklch(0.696 0.17 162.48) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.696 0.17 162.48) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  if (variant === "warning") {
    // Regular 材质 + amber-500 border + 弱 amber ambient shadow + 方向性 rim
    return {
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--card) 20%, transparent), color-mix(in oklab, var(--card) 11%, transparent))",
      backdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      borderColor: "color-mix(in oklab, oklch(0.769 0.188 70.08) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.769 0.188 70.08) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  if (variant === "danger") {
    // Regular 材质 + red-500 border + 弱 red ambient shadow + 方向性 rim
    return {
      backgroundColor:
        "light-dark(color-mix(in oklab, var(--card) 20%, transparent), color-mix(in oklab, var(--card) 11%, transparent))",
      backdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
      borderColor: "color-mix(in oklab, oklch(0.637 0.237 25.33) 55%, transparent)",
      boxShadow:
        `${RIM_REGULAR}, 0 4px 14px -4px color-mix(in oklab, oklch(0.637 0.237 25.33) 22%, transparent), 0 20px 50px -20px oklch(0 0 0 / 0.2)`,
      transition: baseTransition,
    }
  }

  // regular (default)
  return {
    backgroundColor:
      "light-dark(color-mix(in oklab, var(--card) 20%, transparent), color-mix(in oklab, var(--card) 11%, transparent))",
    backdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
    WebkitBackdropFilter: "blur(20px) saturate(1.3) brightness(1.08) contrast(1.04)",
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
// filter-buffer-lock 测试干净。它是 thick 档的「加重 blur」材质（blur 36 + 方向性 rim），
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
    // hero fill 是 light-dark(亮 27%, 暗 23%)：亮分支 clean white frost、比 regular light 20% 实一档；
    // 暗分支 23% 比 regular dark 11% 实一档，给一页一个的加重外壳留可读底。
    // +brightness(1.10)/contrast(1.03) 是 hero 的 luminance 杠杆，补回薄 fill 下 hero children 文字的对比。
    // blur 36 mode-agnostic（只降不升，与全档 blur-lock 一致）。
    backgroundColor:
      "light-dark(color-mix(in oklab, var(--card) 27%, transparent), color-mix(in oklab, var(--card) 23%, transparent))",
    backdropFilter: "blur(36px) saturate(1.3) brightness(1.10) contrast(1.03)",
    WebkitBackdropFilter: "blur(36px) saturate(1.3) brightness(1.10) contrast(1.03)",
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
