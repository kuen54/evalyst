import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { LocaleProvider } from "@/lib/i18n/provider"
import { Sidebar } from "@/components/sidebar"

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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <LocaleProvider>
            <ConfirmProvider>
              <Sidebar />
              <main className="flex-1 overflow-auto">{children}</main>
              <Toaster />
            </ConfirmProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
