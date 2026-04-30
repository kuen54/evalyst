import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { LocaleProvider } from "@/lib/i18n/provider"
import { Sidebar } from "@/components/sidebar"
import { CopilotStoreProvider } from "@/components/copilot/store"
import { CopilotPanel } from "@/components/copilot/panel"
import { InspectorOverlay } from "@/components/copilot/inspector-overlay"
import { ContextMask } from "@/components/copilot/context-mask"
import { GlowOverlay } from "@/components/copilot/glow-overlay"
import { MaterialRevealOverlay } from "@/components/copilot/material-reveal-overlay"
import { TextSelector } from "@/components/copilot/text-selector"
import { TextSelectionMask } from "@/components/copilot/text-selection-mask"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Evalyst · 批量评测",
  description: "Evalyst — agent-driven LLM evaluation platform · 本地跑的 LLM prompt 评测平台",
}

/**
 * View Transitions CSS 直接注入 <head>——绕开 Tailwind v4 / LightningCSS 1.32 的
 * 处理管线（后者不识别 `::view-transition-*` 伪元素和 `view-transition-name` 属性，
 * 写在 globals.css 里会被整段静默 drop）。
 *
 * 规则说明：
 * - old 统一保持 opacity: 1 不动，给 new 叠上来做"覆盖式"入场
 * - copilot 关：root 径向扩散（从主题按钮位置），main 快照跟随 root 被覆盖
 * - copilot 开：main R→L wipe 700ms，root 200ms 快速淡入
 */
const THEME_CASCADE_CSS = `
html[data-copilot-open="true"] main {
  view-transition-name: main-content;
}
::view-transition-old(root),
::view-transition-old(main-content) {
  animation: none !important;
  opacity: 1;
}
html:not([data-copilot-open="true"])::view-transition-new(root) {
  animation: theme-radial-expand 700ms cubic-bezier(0.4, 0, 0.2, 1) both;
}
html[data-copilot-open="true"]::view-transition-new(main-content) {
  animation: theme-wipe-rl 700ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
html[data-copilot-open="true"]::view-transition-new(root) {
  animation: theme-fade-in 200ms ease-out both;
}
@keyframes theme-radial-expand {
  from { clip-path: circle(0 at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%)); }
  to   { clip-path: circle(150vmax at var(--theme-origin-x, 50%) var(--theme-origin-y, 50%)); }
}
@keyframes theme-wipe-rl {
  from { clip-path: inset(0 0 0 100%); }
  to   { clip-path: inset(0 0 0 0); }
}
@keyframes theme-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-new(root),
  ::view-transition-new(main-content) {
    animation: none !important;
  }
}
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME_CASCADE_CSS }} />
      </head>
      <body className="min-h-full flex" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <LocaleProvider>
            <ConfirmProvider>
              <CopilotStoreProvider>
                <Sidebar />
                <main
                  className="flex-1 h-screen flex flex-col overflow-hidden relative"
                >
                  <GlowOverlay />
                  <MaterialRevealOverlay />
                  <div className="flex-1 overflow-auto relative z-[1]">{children}</div>
                </main>
                <CopilotPanel />
                <InspectorOverlay />
                <ContextMask />
                <TextSelector />
                <TextSelectionMask />
                <Toaster />
              </CopilotStoreProvider>
            </ConfirmProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
