"use client"

import type { Display } from "@/lib/schema/types"
import type { ResultViewProps, CellViewProps } from "./types"
import { DisplayTable, DisplayTableCell } from "./display-table"
import { DisplayGroupedGrid, DisplayGroupedGridCell } from "./display-grouped-grid"
import { DisplayJsx, DisplayJsxCell } from "./display-jsx"
import { JsonDefaultResults, JsonDefaultCell } from "./json-default-results"

/** 按 display.mode 分发的通用展示器 */
export function ConfigurableDisplay({ results, schema, display }: ResultViewProps & { display: Display }) {
  switch (display.mode) {
    case "table":
      return <DisplayTable results={results} schema={schema} display={display} />
    case "grouped_grid":
      return <DisplayGroupedGrid results={results} schema={schema} display={display} />
    case "jsx":
      return <DisplayJsx results={results} schema={schema} display={display} />
    default:
      return <JsonDefaultResults results={results} schema={schema} />
  }
}

export function ConfigurableCell({ result, schema, display }: CellViewProps & { display: Display }) {
  switch (display.mode) {
    case "table":
      return <DisplayTableCell result={result} schema={schema} display={display} />
    case "grouped_grid":
      return <DisplayGroupedGridCell result={result} schema={schema} display={display} />
    case "jsx":
      return <DisplayJsxCell result={result} schema={schema} display={display} />
    default:
      return <JsonDefaultCell result={result} schema={schema} />
  }
}
