"use client"

import { useLocale } from "@/lib/i18n/provider"

export function LanguageToggle({ collapsed }: { collapsed?: boolean }) {
  const { locale, setLocale, mounted } = useLocale()
  if (!mounted) return null

  const next = locale === "zh" ? "en" : "zh"
  const label = locale === "zh" ? "English" : "中文"
  const chip = locale === "zh" ? "EN" : "中"
  const title = locale === "zh" ? "Switch to English" : "切换到中文"

  return (
    <button
      onClick={() => setLocale(next)}
      title={collapsed ? title : undefined}
      className={`flex items-center gap-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors ${
        collapsed ? "justify-center px-2 py-2 w-full" : "px-2.5 py-1.5 w-full"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6.25" />
        <path d="M2 8h12" />
        <path d="M8 2a9 9 0 0 1 0 12" />
        <path d="M8 2a9 9 0 0 0 0 12" />
      </svg>
      {!collapsed && (
        <span className="flex items-baseline gap-1.5">
          <span>{label}</span>
          <span className="text-[10px] font-mono text-muted-foreground/70">{chip}</span>
        </span>
      )}
      {collapsed && <span className="sr-only">{label}</span>}
    </button>
  )
}
