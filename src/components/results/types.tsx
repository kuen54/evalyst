"use client"

import React from "react"
import type { GenericResultRecord, TaskSchema } from "@/lib/schema/types"

export interface ResultViewProps {
  results: GenericResultRecord[]
  schema: TaskSchema
}

export type CellViewProps = { result: GenericResultRecord; schema: TaskSchema }

export interface ResultViewSpec {
  component: React.ComponentType<ResultViewProps>
  /** compare 页使用的单元格渲染器 */
  Cell: React.ComponentType<CellViewProps>
}
