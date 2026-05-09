"use client"

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/provider"

interface LightboxContextValue {
  openLightbox: (src: string, alt?: string) => void
  closeLightbox: () => void
}

const LightboxContext = createContext<LightboxContextValue | null>(null)

export function useImageLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext)
  if (!ctx) {
    return {
      openLightbox: () => {},
      closeLightbox: () => {},
    }
  }
  return ctx
}

export function ImageLightboxProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [alt, setAlt] = useState<string>("")

  const openLightbox = useCallback((nextSrc: string, nextAlt = "") => {
    setSrc(nextSrc)
    setAlt(nextAlt)
    setOpen(true)
  }, [])

  const closeLightbox = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => setSrc(null), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  return (
    <LightboxContext.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[min(95vw,1280px)] max-h-[95vh] p-2 overflow-hidden"
          aria-label={t("results.image_lightbox.title")}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              className="w-full h-auto max-h-[88vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </LightboxContext.Provider>
  )
}
