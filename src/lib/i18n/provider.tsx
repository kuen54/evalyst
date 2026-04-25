"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { en } from "./en"
import { zh } from "./zh"
import type { Locale } from "./types"
import { LOCALE_BCP47 } from "./types"

type Dict = Record<string, string>

const DICTIONARIES: Record<Locale, Dict> = { zh, en }

const STORAGE_KEY = "locale"

export type TFn = (key: string, vars?: Record<string, string | number>) => string

interface LocaleCtxValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: TFn
  mounted: boolean
}

const LocaleCtx = createContext<LocaleCtxValue | null>(null)

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str
  let out = str
  for (const key in vars) {
    out = out.replaceAll(`{${key}}`, String(vars[key]))
  }
  return out
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === "zh" || saved === "en") {
        setLocaleState(saved)
        document.documentElement.lang = LOCALE_BCP47[saved]
      }
    } catch {}
    setMounted(true)
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
      document.documentElement.lang = LOCALE_BCP47[l]
    } catch {}
  }, [])

  const t = useCallback<TFn>(
    (key, vars) => {
      const dict = DICTIONARIES[locale]
      const raw = dict[key] ?? zh[key as keyof typeof zh] ?? key
      return interpolate(raw, vars)
    },
    [locale],
  )

  const value = useMemo<LocaleCtxValue>(
    () => ({ locale, setLocale, t, mounted }),
    [locale, setLocale, t, mounted],
  )

  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleCtx)
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider")
  return ctx
}

export function useT(): TFn {
  return useLocale().t
}
