import type { Locale } from "./types"
import { LOCALE_BCP47 } from "./types"

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value)
  return d.toLocaleString(LOCALE_BCP47[locale], options)
}
