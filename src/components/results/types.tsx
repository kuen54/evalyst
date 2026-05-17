"use client"

import React from "react"
import type { Annotation, GenericResultRecord, Rubric, TaskSchema } from "@/lib/schema/types"

export interface ResultViewProps {
  results: GenericResultRecord[]
  schema: TaskSchema
  /** 当实验挂了 rubric 时由 detail 页注入，单条结果就地渲染 RubricAnnotator。 */
  experimentId?: string
  rubric?: Rubric | null
  annotationByTask?: Map<string, Annotation>
  onAnnotationSaved?: () => void
}

export type CellViewProps = { result: GenericResultRecord; schema: TaskSchema }

export interface ResultViewSpec {
  component: React.ComponentType<ResultViewProps>
  /** compare 页使用的单元格渲染器 */
  Cell: React.ComponentType<CellViewProps>
}
