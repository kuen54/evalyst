/**
 * Shared form-state types for the Display settings page.
 *
 * Extracted to break the circular import between display-form-page.tsx
 * (which renders the page + holds <FormState>) and display-form-modes.tsx
 * (which renders sub-form panels and reads/writes the same shape).
 */

import type { DisplayColumn, DisplayMode } from "@/lib/schema/types"

export interface GroupConfig {
  field: string
  label: string
}

export interface FormState {
  id: string
  name: string
  description: string
  mode: Exclude<DisplayMode, "builtin">
  // table
  table_columns: DisplayColumn[]
  // grouped_grid
  primary_group: GroupConfig
  secondary_group: GroupConfig
  cell_columns: DisplayColumn[]
  // jsx
  jsx_source: string
}
