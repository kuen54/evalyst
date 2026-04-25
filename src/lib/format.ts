// ---------- Cost / token 展示格式化 ----------

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
}

function symbolFor(currency: string): { prefix: string; codeSuffix: boolean } {
  const sym = CURRENCY_SYMBOLS[currency.toUpperCase()]
  if (sym) return { prefix: sym, codeSuffix: false }
  // 未命中的货币：用 ISO code + 空格前缀，保证可读
  return { prefix: `${currency} `, codeSuffix: false }
}

function formatAmount(value: number): string {
  if (value === 0) return "0"
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.01) return value.toFixed(3)
  return value.toFixed(5)
}

/**
 * 单条成本格式：按 currency 加前缀符号（default USD）。
 * - null / undefined → "—"
 * - 0               → "{symbol}0"
 * - 否则按数量级 2/3/5 位小数
 */
export function formatCost(value: number | undefined | null, currency?: string): string {
  if (value == null) return "—"
  const { prefix } = symbolFor(currency || "USD")
  return `${prefix}${formatAmount(value)}`
}

/**
 * 聚合成本格式：`{ USD: 0.12, CNY: 3.45 }` → "$0.12 + ¥3.45"。
 * - 空 map / 全 0 → "—"
 * - 单 key       → 等同 formatCost
 * - 多 key       → " + " 拼接
 */
export function formatCostMap(map: Record<string, number> | undefined | null): string {
  if (!map) return "—"
  const entries = Object.entries(map).filter(([, v]) => typeof v === "number" && v > 0)
  if (entries.length === 0) return "—"
  return entries.map(([ccy, v]) => formatCost(v, ccy)).join(" + ")
}

/**
 * Token 计数格式：
 * - ≥ 1,000,000 → `1.2M`
 * - ≥ 1,000     → `3.4k`
 * - 其它         → 原数字
 * - undefined   → "—"
 */
export function formatTokens(n: number | undefined | null): string {
  if (n == null) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
