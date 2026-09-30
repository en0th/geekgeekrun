import type { RunDataStatsGroup } from '../../../../common/run-data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunDataRow = Record<string, any>

export interface RunDataColumn {
  // unique column id; also the dataset field when `field` is omitted
  key: string
  label?: string
  // dataset field used for sorting and the header value filter
  field?: string
  width?: number
  minWidth?: number
  sortable?: boolean
  // column value filter (筛选) in the header; defaults to on for string / enum fields
  headerFilter?: boolean
  defaultHidden?: boolean
  formatter?: (row: RunDataRow) => string
}

export interface RunDataChart {
  id: string
  title: string
  type: 'line' | 'bar' | 'hbar' | 'pie'
  group: Omit<RunDataStatsGroup, 'id'>
  // spans both grid columns
  wide?: boolean
}

export interface RunDataStatsPreset {
  charts: RunDataChart[]
  numericFields?: { field: string; label: string; unit?: string }[]
  distinctFields?: { field: string; label: string }[]
}
