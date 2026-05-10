"use client"

import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import { useCopilotStore, type CapturedContext } from "./store"
import { customAlphabet } from "nanoid"
import { collectAncestorChain } from "@/lib/copilot/context-registry"

// 划线选中文本 → 贴选区底部浮按钮 → 点击加入 Copilot 作为 text_selection 类型 context。
//
// 捕获信息：
//   - text：选中文本
//   - hostType/hostId：承载这段文字的最近 data-copilot-context 元素
//   - textOffset：选区 start 在 host.textContent 里的字符偏移量（用于后续在 DOM 不变时重建 Range 常驻高亮）
//   - ancestors：host 及其所有 data-copilot-context 祖先（内到外），供 LLM 理解层级

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8)

interface PendingSelection {
  text: string
  rect: DOMRect
  hostType?: string | undefined
  hostId?: string | undefined
  hostExtra?: Record<string, unknown> | undefined
  textOffset?: number | undefined
  ancestors: Array<{ type: string; id: string; extra?: Record<string, unknown> }>
}

export function TextSelector() {
  const t = useT()
  const { open, inspectorActive, addContext } = useCopilotStore()
  // 与 Inspector 互斥：Inspector 模式开启时禁用划线浮按钮（spec §3.7.1）
  const enabled = open && !inspectorActive
  const [selection, setSelection] = useState<PendingSelection | null>(null)

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dep change; see docs/conventions/react19-hydration.md
      setSelection(null)
      return
    }

    const isInCopilotUI = (el: Element | null): boolean => {
      if (!el) return false
      return !!el.closest("[data-copilot-panel], [data-copilot-overlay], aside")
    }

    const check = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelection(null)
        return
      }
      const text = sel.toString().trim()
      if (text.length < 2) {
        setSelection(null)
        return
      }
      const anchorNode = sel.anchorNode
      const anchor = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
      if (isInCopilotUI(anchor)) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null)
        return
      }

      // 找 host = 最近 data-copilot-context 元素
      const host = anchor?.closest("[data-copilot-context]") as HTMLElement | null
      let hostType: string | undefined
      let hostId: string | undefined
      let hostExtra: Record<string, unknown> | undefined
      let textOffset: number | undefined
      if (host) {
        hostType = host.dataset.copilotContext
        hostId = host.dataset.copilotContextId
        const rawExtra = host.dataset.copilotContextExtra
        if (rawExtra) {
          try {
            const parsed = JSON.parse(rawExtra)
            if (parsed && typeof parsed === "object") hostExtra = parsed as Record<string, unknown>
          } catch { /* ignore */ }
        }
        // 测量 selection.start 相对 host.textContent 的字符偏移
        try {
          const pre = document.createRange()
          pre.selectNodeContents(host)
          pre.setEnd(range.startContainer, range.startOffset)
          textOffset = pre.toString().length
        } catch { /* ignore */ }
      }
      const ancestors = host ? collectAncestorChain(host) : []

      setSelection({ text, rect, hostType, hostId, hostExtra, textOffset, ancestors })
    }

    document.addEventListener("selectionchange", check)
    return () => {
      document.removeEventListener("selectionchange", check)
    }
  }, [enabled])

  if (!selection) return null

  const onAdd = () => {
    const id = `sel-${nanoid()}`
    const ctx: Omit<CapturedContext, "tag"> = {
      type: "text_selection",
      id,
      elementKey: `text_selection:${id}`,
      extra: {
        text: selection.text,
        hostType: selection.hostType,
        hostId: selection.hostId,
        hostExtra: selection.hostExtra,
        textOffset: selection.textOffset,
        ancestors: selection.ancestors,
      },
      summary: selection.text.length > 40 ? selection.text.slice(0, 40) + "…" : selection.text,
    }
    addContext(ctx)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const btnLeft = Math.max(
    8,
    Math.min(
      window.innerWidth - 180,
      selection.rect.left + selection.rect.width / 2 - 70,
    ),
  )
  const btnTop = selection.rect.bottom + 6

  return (
    <div
      data-copilot-overlay
      className="fixed z-[9998]"
      style={{ top: btnTop, left: btnLeft }}
    >
      <button
        onMouseDown={e => { e.preventDefault() }}
        onClick={onAdd}
        className="bg-primary text-primary-foreground text-xs px-2.5 py-1 rounded-full shadow-md hover:bg-primary/90 cursor-pointer flex items-center gap-1 whitespace-nowrap"
      >
        <span className="text-[13px] leading-none">+</span>
        <span>{t("copilot.text_select_add")}</span>
      </button>
    </div>
  )
}
