"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/provider"

interface Props {
  /** 说明 JSON 格式的标题 */
  title: string
  /** 客户端校验函数（可选）：返回 ok + errors */
  validate?: (parsed: unknown) => { ok: boolean; errors: Array<{ field: string; message: string }> }
  /** 提交到后端的 API path */
  submitEndpoint: string
  /** 成功后跳转的 URL 函数（接受 API 返回的对象） */
  onSuccessRedirect: (data: Record<string, unknown>) => string
}

export function JsonPastePane({ title, validate, submitEndpoint, onSuccessRedirect }: Props) {
  const t = useT()
  const [text, setText] = useState("")
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null)
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleParse = () => {
    setParsed(null)
    setErrors([])
    setParseError(null)
    if (!text.trim()) {
      setParseError(t("json_paste.paste_empty"))
      return
    }
    let obj: unknown
    try {
      obj = JSON.parse(text)
    } catch (e) {
      setParseError(t("json_paste.parse_failed", { message: (e as Error).message }))
      return
    }
    if (validate) {
      const v = validate(obj)
      if (!v.ok) {
        setErrors(v.errors)
        return
      }
    }
    setParsed(obj as Record<string, unknown>)
  }

  const handleSave = async () => {
    if (!parsed) return
    setSubmitting(true)
    try {
      const res = await fetch(submitEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors(data.errors ?? [{ field: "$", message: data.error ?? t("json_paste.save_fail_default") }])
        setSubmitting(false)
        return
      }
      window.location.href = onSuccessRedirect(data)
    } catch (e) {
      setErrors([{ field: "$", message: (e as Error).message }])
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleParse}>
            {t("json_paste.parse_btn")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!parsed || submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t("json_paste.placeholder")}
        className="flex-1 min-h-[300px] font-mono text-xs"
      />

      {parseError && (
        <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {parseError}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-sm">
          <div className="font-medium text-red-700 mb-1">{t("json_paste.validation_failed")}</div>
          <ul className="text-xs space-y-0.5 text-red-600">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono">{e.field}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed && errors.length === 0 && (
        <div className="mt-3 p-3 rounded bg-emerald-50 border border-emerald-200 text-sm">
          <div className="flex items-center gap-2 text-emerald-700 mb-2">
            <Badge variant="outline" className="border-emerald-400 text-emerald-700">{t("json_paste.validation_ok")}</Badge>
            <span className="text-xs">{t("json_paste.can_save")}</span>
          </div>
          <div className="text-xs text-emerald-700 space-y-0.5">
            {Object.entries(parsed).slice(0, 5).map(([k, v]) => (
              <div key={k}>
                <span className="font-mono">{k}</span>: {
                  typeof v === "object" && v !== null
                    ? (Array.isArray(v) ? `[${v.length} items]` : `{${Object.keys(v).length} keys}`)
                    : String(v).slice(0, 80)
                }
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
