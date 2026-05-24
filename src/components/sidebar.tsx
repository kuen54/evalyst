"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useT } from "@/lib/i18n/provider"
import { LanguageToggle } from "@/components/language-toggle"
import { useCopilotOpen, useCopilotPanelWidth } from "@/components/glass/copilot-context"
import { segmentedItem } from "@/lib/segmented"
import { applyThemeClass, type ResolvableTheme } from "@/lib/theme/apply"
import { applyThemeCascade, clearThemeCascade } from "@/lib/theme/cascade"

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const t = useT()
  const copilotOpen = useCopilotOpen()
  const copilotWidth = useCopilotPanelWidth()
  // 记住 copilot 打开前的 collapsed 状态；关闭后还原
  const prevCollapsedBeforeCopilot = useRef<boolean | null>(null)
  // cycle 过程中的 cleanup timeout；连点时抢旧 timeout 避免残留 delay
  const cascadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount flag; see docs/conventions/react19-hydration.md
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (copilotOpen) {
      if (prevCollapsedBeforeCopilot.current === null) {
        prevCollapsedBeforeCopilot.current = collapsed
        setCollapsed(true)
      }
    } else {
      if (prevCollapsedBeforeCopilot.current !== null) {
        setCollapsed(prevCollapsedBeforeCopilot.current)
        prevCollapsedBeforeCopilot.current = null
      }
    }
    // 只依赖 copilotOpen 的变更；collapsed 在 open 时被强制改写，不追踪进依赖避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotOpen])

  const cycleTheme = () => {
    let next: ResolvableTheme
    if (theme === "light") next = "dark"
    else if (theme === "dark") next = "system"
    else next = "light"

    // 抢前次 cycle 未跑完的 cleanup；新 cycle 写新 delay + flag，旧的由新 timeout 一起清
    if (cascadeTimeoutRef.current) {
      clearTimeout(cascadeTimeoutRef.current)
      cascadeTimeoutRef.current = null
    }

    // 必须先 cascade apply（写 CSS var + 激活 flag），再 applyThemeClass（触发 transition）
    applyThemeCascade(copilotOpen, copilotOpen ? copilotWidth : 0)
    applyThemeClass(next)  // sync DOM class toggle，触发 transition（各元素按 --theme-cascade-delay 错峰）
    setTheme(next)         // next-themes state + localStorage；其 useEffect 看到 class 已对，no-op

    // 2300ms = offset 300 + max stagger 1400 + duration 320 + 280 余量
    cascadeTimeoutRef.current = setTimeout(() => {
      clearThemeCascade()
      cascadeTimeoutRef.current = null
    }, 2300)
  }

  // cycle 过程中 unmount（切页、热重载）时清 timeout + DOM flag，避免残留
  useEffect(() => {
    return () => {
      if (cascadeTimeoutRef.current) {
        clearTimeout(cascadeTimeoutRef.current)
        cascadeTimeoutRef.current = null
      }
      clearThemeCascade()
    }
  }, [])

  const themeIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {theme === "dark" ? (
        <path d="M13.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z" />
      ) : theme === "light" ? (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v1M8 13v1M3 8H2M14 8h-1M4.2 4.2l-.7-.7M12.5 12.5l-.7-.7M11.8 4.2l.7-.7M3.5 12.5l.7-.7" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="3.5" />
          <path d="M8 4.5V8l2 2" />
        </>
      )}
    </svg>
  )

  const themeLabel = theme === "dark" ? t("sidebar.theme_dark") : theme === "light" ? t("sidebar.theme_light") : t("sidebar.theme_system")

  const links = [
    {
      href: "/", label: t("sidebar.overview"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      ),
    },
    {
      href: "/experiments/new", label: t("sidebar.new_experiment"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" /><path d="M8 5.5v5M5.5 8h5" />
        </svg>
      ),
    },
    {
      href: "/compare", label: t("sidebar.compare"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="4.5" height="12" rx="1" /><rect x="9.5" y="2" width="4.5" height="12" rx="1" />
        </svg>
      ),
    },
    {
      href: "/settings", label: t("sidebar.settings"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="1.5" />
          <path d="M12.5 8c0 .35-.04.69-.12 1l1.5 1.15-1.5 2.6-1.8-.7c-.5.4-1.1.72-1.74.92l-.3 1.88h-3l-.3-1.88c-.65-.2-1.24-.52-1.75-.92l-1.8.7-1.5-2.6 1.5-1.15A5 5 0 0 1 3.5 8c0-.35.04-.69.12-1L2.12 5.85l1.5-2.6 1.8.7c.5-.4 1.1-.72 1.74-.92l.3-1.88h3l.3 1.88c.65.2 1.24.52 1.75.92l1.8-.7 1.5 2.6-1.5 1.15c.08.31.12.65.12 1z" />
        </svg>
      ),
    },
  ]

  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 border-r border-border/60 bg-muted/20 flex flex-col ${collapsed ? "w-12" : "w-52"}`}
    >
      <div className={`flex items-center ${collapsed ? "justify-center py-4" : "justify-between px-3 py-5"}`}>
        {!collapsed && (
          <h1 className="flex items-center gap-2.5 px-2.5 leading-none text-primary">
            <svg viewBox="0 0 160 160" width="28" height="28" role="img" aria-label={t("sidebar.title")} className="shrink-0">
              <rect x="32" y="38" width="76" height="22" rx="3" fill="currentColor" />
              <rect x="32" y="69" width="48" height="22" rx="3" fill="currentColor" />
              <rect x="32" y="100" width="92" height="22" rx="3" fill="currentColor" />
            </svg>
            <span style={{
              fontFamily: "var(--font-fraunces), serif",
              fontVariationSettings: '"opsz" 36, "SOFT" 30',
              fontWeight: 420,
              letterSpacing: "-0.02em",
              fontSize: "22px",
            }}>
              eval<em style={{
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 36, "SOFT" 100',
                fontWeight: 380,
                color: "var(--copilot-accent)",
              }}>yst</em>
            </span>
          </h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`text-muted-foreground hover:text-foreground transition-colors ${collapsed ? "" : "p-1 rounded hover:bg-accent/60"}`}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <nav className={`flex flex-col gap-0.5 ${collapsed ? "px-1.5" : "px-3"}`}>
        {links.map(link => {
          const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              title={collapsed ? link.label : undefined}
              className={`flex items-center gap-2 rounded-md transition-colors text-[13px] ${
                collapsed ? "justify-center px-2 py-2" : "px-2.5 py-1.5"
              } ${segmentedItem(isActive)}`}
            >
              {link.icon}
              {!collapsed && link.label}
            </Link>
          )
        })}
      </nav>

      <div className={`mt-auto pb-4 space-y-0.5 ${collapsed ? "px-1.5" : "px-3"}`}>
        {mounted && (
          <button
            onClick={cycleTheme}
            title={collapsed ? themeLabel : undefined}
            className={`flex items-center gap-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors ${
              collapsed ? "justify-center px-2 py-2 w-full" : "px-2.5 py-1.5 w-full"
            }`}
          >
            {themeIcon}
            {!collapsed && themeLabel}
          </button>
        )}
        <LanguageToggle collapsed={collapsed} />
      </div>
    </aside>
  )
}
