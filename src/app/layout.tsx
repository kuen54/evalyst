import type { Metadata } from "next"
import { Geist, Geist_Mono, Fraunces } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { LocaleProvider } from "@/lib/i18n/provider"
import { Sidebar } from "@/components/sidebar"
import { CopilotStoreProvider } from "@/copilot/components/store"
import { CopilotPanel } from "@/copilot/components/panel"
import { InspectorOverlay } from "@/copilot/components/inspector-overlay"
import { ContextMask } from "@/copilot/components/context-mask"
import { GlowOverlay } from "@/copilot/components/glow-overlay"
import { MaterialRevealOverlay } from "@/copilot/components/material-reveal-overlay"
import { TextSelector } from "@/copilot/components/text-selector"
import { TextSelectionMask } from "@/copilot/components/text-selection-mask"
import { ImageLightboxProvider } from "@/components/ui/image-lightbox"

// Theme switch cascade rules. Injected as inline <style> instead of via globals.css
// because Turbopack/LightningCSS silently drops these rules from the compiled CSS bundle
// (same failure mode that v0.5.4 v1 hit with view-transition pseudos). The inline <style>
// escape hatch bypasses the CSS pipeline entirely.
const THEME_CASCADE_CSS = `
html[data-theme-cascading="true"] [data-glass-variant] {
  transition:
    background-color 320ms ease-out var(--theme-cascade-delay, 0ms),
    backdrop-filter  320ms ease-out var(--theme-cascade-delay, 0ms),
    border-color     320ms ease-out var(--theme-cascade-delay, 0ms),
    box-shadow       320ms ease-out var(--theme-cascade-delay, 0ms),
    background-image 320ms ease-out var(--theme-cascade-delay, 0ms)
    !important;
}
html[data-theme-cascading="true"] body,
html[data-theme-cascading="true"] aside,
html[data-theme-cascading="true"] main {
  transition: background-color 320ms ease-out, border-color 320ms ease-out !important;
}
@media (prefers-reduced-motion: reduce) {
  html[data-theme-cascading="true"] [data-glass-variant],
  html[data-theme-cascading="true"] body,
  html[data-theme-cascading="true"] aside,
  html[data-theme-cascading="true"] main {
    transition: none !important;
  }
}
`

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// Brand wordmark face. Sidebar lockup uses opsz 36 + SOFT 30 (roman) / SOFT 100 (italic "yst").
// next/font/google API: `axes` for extra variable axes beyond wght; italic loaded via `style`.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "opsz"],
})

export const metadata: Metadata = {
  title: "Evalyst · 批量评测",
  description: "Evalyst — agent-driven LLM evaluation platform · 本地跑的 LLM prompt 评测平台",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME_CASCADE_CSS }} />
      </head>
      <body className="min-h-full flex" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <LocaleProvider>
            <CopilotStoreProvider>
              <ConfirmProvider>
                <ImageLightboxProvider>
                  <Sidebar />
                  <main className="flex-1 h-screen flex flex-col overflow-hidden relative">
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
                </ImageLightboxProvider>
              </ConfirmProvider>
            </CopilotStoreProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
