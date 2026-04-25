"use client"

import { useState, useCallback, createContext, useContext, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/provider"

type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
}

type Ctx = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<Ctx | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const t = useT()

  const confirm = useCallback<Ctx>(o => {
    setOpts(o)
    setOpen(true)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  const handle = (v: boolean) => {
    setOpen(false)
    if (resolver.current) { resolver.current(v); resolver.current = null }
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={o => { if (!o) handle(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => handle(false)}>
              {opts?.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant={opts?.variant === "destructive" ? "destructive" : "default"}
              onClick={() => handle(true)}
            >
              {opts?.confirmLabel ?? t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): Ctx {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider")
  return ctx
}
