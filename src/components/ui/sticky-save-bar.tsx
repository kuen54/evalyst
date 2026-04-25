"use client"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"

/** 统一的底部操作条：保存 / 取消 / 右侧 dirty 提示 */
export function StickySaveBar({
  onSave,
  onCancel,
  submitting,
  dirty,
  saveLabel,
  disabled,
}: {
  onSave: () => void
  onCancel?: () => void
  submitting?: boolean
  dirty?: boolean
  saveLabel?: string
  disabled?: boolean
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 sticky bottom-0 bg-background pt-2 pb-4 -mx-6 px-6 border-t">
      {onCancel && (
        <Button variant="outline" onClick={onCancel} disabled={submitting}>{t("common.cancel")}</Button>
      )}
      <Button onClick={onSave} disabled={submitting || disabled}>
        {submitting ? t("common.saving") : (saveLabel ?? t("common.save"))}
      </Button>
      {dirty && !submitting && (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">{t("common.unsaved")}</span>
      )}
    </div>
  )
}
