// ---------- 从结果列表聚合成本 / token ----------
// 用于 UI 层在 run_stats 缺失聚合字段（老实验）时兜底计算。

import type { GenericResultRecord } from './schema/types'

export interface ResultsAggregate {
  total_input_tokens: number
  total_output_tokens: number
  total_cost_by_currency: Record<string, number>
  /** 至少有一条结果带了 usage 数据 */
  has_token_data: boolean
  /** 至少有一条结果带了 cost 数据 */
  has_cost_data: boolean
}

export function aggregateResults(results: GenericResultRecord[]): ResultsAggregate {
  let total_input_tokens = 0
  let total_output_tokens = 0
  const total_cost_by_currency: Record<string, number> = {}
  let has_token_data = false
  let has_cost_data = false

  for (const r of results) {
    if (typeof r.input_tokens === 'number') {
      total_input_tokens += r.input_tokens
      has_token_data = true
    }
    if (typeof r.output_tokens === 'number') {
      total_output_tokens += r.output_tokens
      has_token_data = true
    }
    if (typeof r.cost_value === 'number') {
      const ccy = r.cost_currency || 'USD'
      total_cost_by_currency[ccy] = (total_cost_by_currency[ccy] ?? 0) + r.cost_value
      has_cost_data = true
    }
  }

  return { total_input_tokens, total_output_tokens, total_cost_by_currency, has_token_data, has_cost_data }
}
