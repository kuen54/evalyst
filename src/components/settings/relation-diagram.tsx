"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/provider"
import { useGlassStyle } from "@/components/copilot/shell"
import { useCopilotStore } from "@/components/copilot/store"
import { segmentedItem } from "@/lib/segmented"

export type SettingsTabKey = "llm" | "datasets" | "templates" | "displays" | "rubrics"

interface Item {
  key: SettingsTabKey
  href: string
  labelKey: string
  hintKey: string
  emoji: string
}

const ITEMS: Item[] = [
  { key: "llm", href: "/settings/llm", labelKey: "relation.llm", hintKey: "relation.llm_hint", emoji: "📡" },
  { key: "datasets", href: "/settings/datasets", labelKey: "relation.datasets", hintKey: "relation.datasets_hint", emoji: "📦" },
  { key: "templates", href: "/settings/templates", labelKey: "relation.templates", hintKey: "relation.templates_hint", emoji: "📐" },
  { key: "displays", href: "/settings/displays", labelKey: "relation.displays", hintKey: "relation.displays_hint", emoji: "🎨" },
  { key: "rubrics", href: "/settings/rubrics", labelKey: "relation.rubrics", hintKey: "relation.rubrics_hint", emoji: "✅" },
]

function resolveActive(pathname: string | null): SettingsTabKey | undefined {
  if (!pathname) return undefined
  if (pathname.includes("/settings/llm")) return "llm"
  if (pathname.includes("/settings/datasets")) return "datasets"
  if (pathname.includes("/settings/templates")) return "templates"
  if (pathname.includes("/settings/displays")) return "displays"
  if (pathname.includes("/settings/rubrics")) return "rubrics"
  return undefined
}

export function RelationDiagram() {
  const t = useT()
  const pathname = usePathname()
  const active = resolveActive(pathname)
  const { open: copilotOpen } = useCopilotStore()
  const tintedStyle = useGlassStyle("tinted")
  const thinStyle = useGlassStyle("thin")

  return (
    <div className="py-2">
      <div className="flex items-stretch gap-2">
        {ITEMS.map((it, i) => {
          const isActive = active === it.key
          return (
          <div key={it.key} className="contents">
            <Link
              href={it.href}
              className={`flex-1 basis-0 min-w-0 p-4 rounded-md border text-center transition-colors cursor-pointer ${segmentedItem(isActive, copilotOpen)}`}
              style={copilotOpen ? (isActive ? tintedStyle : thinStyle) : undefined}
              data-glass-variant={copilotOpen ? (isActive ? "tinted" : "thin") : undefined}
            >
              <div className="text-sm font-medium whitespace-nowrap">{it.emoji} {t(it.labelKey)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{t(it.hintKey)}</div>
            </Link>
            {i < ITEMS.length - 1 && (
              <div className="flex items-center justify-center text-muted-foreground shrink-0 w-4 text-base leading-none">
                →
              </div>
            )}
          </div>
          )
        })}
      </div>
      <div className="text-[10px] text-muted-foreground text-center mt-1">
        {t("relation.arrow_experiment")}
      </div>
    </div>
  )
}
