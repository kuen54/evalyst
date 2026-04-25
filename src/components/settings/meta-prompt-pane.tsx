"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"

export function MetaPromptPane({ promptText, title }: { promptText: string; title: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button size="sm" variant="outline" onClick={handleCopy}>
          {copied ? t("meta_prompt.copied") : t("meta_prompt.copy_all")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-2 shrink-0">
        {t("meta_prompt.intro_text")}
      </p>
      <div className="flex-1 min-h-0 border rounded-md bg-muted/30 overflow-auto">
        <pre className="p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed">{promptText}</pre>
      </div>
    </div>
  )
}
