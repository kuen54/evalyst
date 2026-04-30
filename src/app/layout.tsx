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
      <body className="min-h-full flex" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <LocaleProvider>
            <ConfirmProvider>
              <CopilotStoreProvider>
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
              </CopilotStoreProvider>
            </ConfirmProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
