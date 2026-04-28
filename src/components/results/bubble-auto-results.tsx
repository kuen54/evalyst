"use client"

import { useMemo, useState } from "react"
import { CardContent, CardHeader } from "@/components/ui/card"
import { GlassThin } from "@/components/copilot/shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/provider"
import type { GenericResultRecord } from "@/lib/schema/types"
import type { ResultViewProps, CellViewProps } from "./types"
import { dimensionsOf, readDimensionValue, labelFor } from "./dimension-helpers"
import { readField } from "./view-helpers"
import { findBubbleArrayField, findCoordinateFieldName, findBubbleTextField, getOutputFields } from "./output-structure"

interface BubbleItem {
  [key: string]: unknown
}

/**
 * 通用 bubble 展示：每条 result 一张卡片，图片 + 坐标标签。
 * 自动从 output_schema 找 array-of-object-with-coord 字段作为气泡列表。
 * 从 inputs 里找 *.image_url / *url* 字段作为图片源。
 */
export function BubbleAutoResults({ results, schema }: ResultViewProps) {
  const t = useT()
  const bubbleFieldInfo = useMemo(() => {
    const bubbleField = findBubbleArrayField(schema.output_schema)
    if (!bubbleField) return null
    const coordName = findCoordinateFieldName(bubbleField)
    const { text: textName, emoji: emojiName } = findBubbleTextField(bubbleField)
    return { bubbleFieldName: bubbleField.name, coordName, textName, emojiName }
  }, [schema.output_schema])

  const imageFieldPath = useMemo(() => findImageFieldPath(schema), [schema])

  const [search, setSearch] = useState("")
  const [overlayResult, setOverlayResult] = useState<GenericResultRecord | null>(null)

  const dims = dimensionsOf(schema)

  const filtered = useMemo(() => {
    return results.filter(r => {
      if (search) {
        // 搜索第一个 dimension 的值
        if (dims.length > 0) {
          const v = String(readDimensionValue(r, dims[0]) ?? "")
          const label = labelFor(dims[0], readDimensionValue(r, dims[0]))
          if (!v.includes(search) && !label.includes(search)) return false
        }
      }
      return true
    })
  }, [results, search, dims])

  if (!bubbleFieldInfo) {
    return <div className="text-xs text-muted-foreground py-4">{t("results.no_coord_field")}</div>
  }

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <Input placeholder={t("results.search_placeholder")} value={search} onChange={e => setSearch(e.target.value)} className="w-36 h-8 text-xs" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(r => (
          <BubbleCard
            key={r.task_id}
            result={r}
            bubbleFieldName={bubbleFieldInfo.bubbleFieldName}
            coordName={bubbleFieldInfo.coordName}
            textName={bubbleFieldInfo.textName}
            emojiName={bubbleFieldInfo.emojiName}
            imageFieldPath={imageFieldPath}
            dims={dims}
            onViewOverlay={() => setOverlayResult(r)}
          />
        ))}
      </div>

      <Dialog open={!!overlayResult} onOpenChange={() => setOverlayResult(null)}>
        <DialogContent className="max-w-2xl">
          {overlayResult && (
            <BubbleOverlay
              result={overlayResult}
              bubbleFieldName={bubbleFieldInfo.bubbleFieldName}
              coordName={bubbleFieldInfo.coordName}
              textName={bubbleFieldInfo.textName}
              emojiName={bubbleFieldInfo.emojiName}
              imageFieldPath={imageFieldPath}
              dims={dims}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BubbleCard({ result, bubbleFieldName, coordName, textName, emojiName, imageFieldPath, dims, onViewOverlay }: {
  result: GenericResultRecord
  bubbleFieldName: string
  coordName: string | null
  textName: string | undefined
  emojiName: string | undefined
  imageFieldPath: string | null
  dims: ReturnType<typeof dimensionsOf>
  onViewOverlay: () => void
}) {
  const t = useT()
  const bubbles = (result.output?.[bubbleFieldName] as BubbleItem[] | undefined) ?? []

  return (
    <GlassThin className={`flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 ${result.status !== "success" ? "border-red-200" : ""}`}>
      <CardHeader className="pb-2 px-4 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          {dims.map((dim, i) => {
            const v = readDimensionValue(result, dim)
            return (
              <Badge key={i} variant={i === 0 ? "secondary" : "outline"} className="text-xs">
                {labelFor(dim, v)}
              </Badge>
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {result.status === "success" && result.output ? (
          <>
            <div className="space-y-1 mb-2">
              {bubbles.map((b, i) => {
                const text = textName ? String(b[textName] ?? "") : ""
                const emoji = emojiName ? b[emojiName] as string | null | undefined : null
                const coord = coordName ? b[coordName] as [number, number] | undefined : undefined
                return (
                  <div key={i} className="flex items-center gap-1.5 text-sm">
                    {emoji && <span>{emoji}</span>}
                    <span>{text}</span>
                    {coord && (
                      <span className="text-xs text-muted-foreground">
                        ({coord[0].toFixed(2)}, {coord[1].toFixed(2)})
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {/* 其它非 bubble 字段（如 rationale） */}
            {Object.entries(result.output).filter(([k]) => k !== bubbleFieldName).map(([k, v]) => (
              <p key={k} className="text-xs text-muted-foreground">{String(v).slice(0, 200)}</p>
            ))}
            {imageFieldPath && bubbles.some(b => coordName && b[coordName]) && (
              <Button variant="outline" size="sm" className="mt-2" onClick={onViewOverlay}>{t("results.view_overlay")}</Button>
            )}
          </>
        ) : (
          <p className="text-xs text-red-500">{result.status}: {result.error?.slice(0, 100)}</p>
        )}
      </CardContent>
    </GlassThin>
  )
}

function BubbleOverlay({ result, bubbleFieldName, coordName, textName, emojiName, imageFieldPath, dims }: {
  result: GenericResultRecord
  bubbleFieldName: string
  coordName: string | null
  textName: string | undefined
  emojiName: string | undefined
  imageFieldPath: string | null
  dims: ReturnType<typeof dimensionsOf>
}) {
  const t = useT()
  const bubbles = (result.output?.[bubbleFieldName] as BubbleItem[] | undefined) ?? []
  const positioned = bubbles.filter(b => coordName && b[coordName])
  const unpositioned = bubbles.filter(b => !coordName || !b[coordName])  // 无坐标 → 作为固定位置展示
  const imageUrl = imageFieldPath ? readField(result, imageFieldPath) as string | null | undefined : null
  const titleDim = dims[0]

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titleDim ? labelFor(titleDim, readDimensionValue(result, titleDim)) : result.task_id}</DialogTitle>
      </DialogHeader>
      <div className="relative w-full aspect-square bg-muted rounded-md overflow-hidden">
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={imageUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">{t("results.image_placeholder_none")}</div>
        )}
        {positioned.map((b, i) => {
          const coord = b[coordName!] as [number, number]
          const text = textName ? String(b[textName] ?? "") : ""
          const emoji = emojiName ? b[emojiName] as string | null | undefined : null
          return (
            <div
              key={i}
              className="absolute"
              style={{ left: `${coord[0] * 100}%`, top: `${coord[1] * 100}%`, transform: "translate(-50%, -50%)" }}
            >
              <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow" />
              <div className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/90 backdrop-blur px-2 py-0.5 rounded text-xs shadow border text-gray-900">
                {emoji && <span className="mr-1">{emoji}</span>}
                {text}
              </div>
            </div>
          )
        })}
        {/* 无坐标气泡固定右下（如「系列气泡」） */}
        {unpositioned.length > 0 && unpositioned[0] && (
          <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-sm shadow border text-gray-900">
            {emojiName && unpositioned[0][emojiName] ? <span className="mr-1">{String(unpositioned[0][emojiName])}</span> : null}
            {textName && <span>{String(unpositioned[0][textName] ?? "")}</span>}
          </div>
        )}
      </div>
      {Object.entries(result.output ?? {}).filter(([k]) => k !== bubbleFieldName).map(([k, v]) => (
        <div key={k} className="mt-3">
          <p className="text-sm font-medium mb-1">{k}</p>
          <p className="text-sm text-muted-foreground">{String(v)}</p>
        </div>
      ))}
    </>
  )
}

function findImageFieldPath(schema: import("@/lib/schema/types").TaskSchema): string | null {
  // message_builder.image.field（形如 'item.image_url'）→ 'input_preview.item.image_url'
  if (schema.message_builder?.image?.field) {
    const p = schema.message_builder.image.field
    return p.startsWith("input_preview.") ? p : `input_preview.${p}`
  }
  return null
}

export function BubbleAutoCell({ result, schema }: CellViewProps) {
  const t = useT()
  const bubbleField = findBubbleArrayField(schema.output_schema)
  const coordName = bubbleField ? findCoordinateFieldName(bubbleField) : null
  const { text: textName, emoji: emojiName } = bubbleField ? findBubbleTextField(bubbleField) : { text: undefined, emoji: undefined }
  const imageFieldPath = findImageFieldPath(schema)

  if (result.status !== "success" || !result.output) return null

  const bubbles = (bubbleField ? (result.output[bubbleField.name] as BubbleItem[] | undefined) : undefined) ?? []
  const positioned = bubbles.filter(b => coordName && b[coordName])
  const unpositioned = bubbles.filter(b => !coordName || !b[coordName])
  const imageUrl = imageFieldPath ? readField(result, imageFieldPath) as string | null | undefined : null

  return (
    <div className="space-y-2">
      {/* 图片 + 坐标叠加 */}
      {bubbleField && (
        <div className="relative w-full aspect-square bg-muted rounded overflow-hidden">
          {imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={imageUrl} alt="" className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px]">{t("results.image_placeholder_tiny")}</div>
          )}
          {positioned.map((b, i) => {
            const coord = b[coordName!] as [number, number]
            const text = textName ? String(b[textName] ?? "") : ""
            const emoji = emojiName ? (b[emojiName] as string | null | undefined) : null
            return (
              <div
                key={i}
                className="absolute"
                style={{ left: `${coord[0] * 100}%`, top: `${coord[1] * 100}%`, transform: "translate(-50%, -50%)" }}
              >
                <div className="w-2 h-2 rounded-full bg-blue-500 border-2 border-white shadow" />
                <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/90 backdrop-blur px-1.5 py-0.5 rounded text-[10px] shadow border text-gray-900 leading-tight">
                  {emoji && <span className="mr-0.5">{emoji}</span>}
                  {text}
                </div>
              </div>
            )
          })}
          {/* 无坐标气泡固定右下 */}
          {unpositioned.length > 0 && unpositioned[0] && (
            <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur px-2 py-0.5 rounded-full text-[10px] shadow border text-gray-900">
              {emojiName && unpositioned[0][emojiName] ? <span className="mr-0.5">{String(unpositioned[0][emojiName])}</span> : null}
              {textName && <span>{String(unpositioned[0][textName] ?? "")}</span>}
            </div>
          )}
        </div>
      )}

      {/* 气泡文字列表（含坐标 tip） */}
      {bubbleField && bubbles.length > 0 && (
        <div className="space-y-0.5">
          {bubbles.map((b, i) => {
            const text = textName ? String(b[textName] ?? "") : ""
            const emoji = emojiName ? (b[emojiName] as string | null | undefined) : null
            const coord = coordName ? (b[coordName] as [number, number] | undefined) : undefined
            return (
              <div key={i} className="text-xs">
                {emoji && <span className="mr-1">{emoji}</span>}
                {text}
                {coord && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({coord[0].toFixed(2)}, {coord[1].toFixed(2)})
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 其他字段（rationale 等） */}
      {Object.entries(result.output).filter(([k]) => k !== bubbleField?.name).map(([k, v]) => (
        <p key={k} className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium">{k}: </span>{String(v).slice(0, 200)}
        </p>
      ))}
    </div>
  )
}
