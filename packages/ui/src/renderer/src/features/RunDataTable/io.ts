// Export rows to xlsx / csv / json and parse import files back into db-shaped rows.
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataField
} from '../../../../common/run-data'
import { EXPORT_DATE_FORMAT, enumLabel, formatDbDate, isBlank, toDbDate } from './format'
import type { RunDataRow } from './types'

export type ExportFormat = 'xlsx' | 'csv' | 'json'

export const exportFormatOptions: { value: ExportFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' }
]

// tabular exports use readable values: local time and enum labels
function toTabular(dataset: RunDataDatasetKey, rows: RunDataRow[]) {
  const fields = runDataDatasets[dataset].fields
  const headers = fields.map((f) => f.label)
  const body = rows.map((row) =>
    fields.map((f) => {
      const v = row[f.key]
      // enums can label NULL (e.g. 开聊方式 NULL = 自动)
      if (f.type === 'enum') return enumLabel(f, v)
      if (isBlank(v)) return ''
      if (f.type === 'date') return formatDbDate(v, EXPORT_DATE_FORMAT)
      return v
    })
  )
  return [headers, ...body]
}

export async function exportRows(
  dataset: RunDataDatasetKey,
  rows: RunDataRow[],
  format: ExportFormat,
  nameSuffix = ''
) {
  const def = runDataDatasets[dataset]
  const fileName = `${def.label}${nameSuffix}-${dayjs().format('YYYYMMDD-HHmmss')}.${format}`
  let content: string | Uint8Array
  if (format === 'json') {
    // json keeps raw db values so it re-imports losslessly
    content = JSON.stringify(
      {
        dataset,
        exportedAt: new Date().toISOString(),
        rows: rows.map((row) =>
          Object.fromEntries(def.fields.map((f) => [f.key, row[f.key] ?? null]))
        )
      },
      null,
      2
    )
  } else {
    const sheet = XLSX.utils.aoa_to_sheet(toTabular(dataset, rows))
    if (format === 'csv') {
      // BOM so Excel detects UTF-8
      content = '﻿' + XLSX.utils.sheet_to_csv(sheet)
    } else {
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, def.label)
      content = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
    }
  }
  const filterName = exportFormatOptions.find((it) => it.value === format)!.label
  return (await electron.ipcRenderer.invoke('save-file-with-dialog', {
    defaultPath: fileName,
    filters: [{ name: filterName, extensions: [format] }],
    content
  })) as { canceled: boolean; filePath?: string }
}

// tab separated text of what the table shows, for pasting into a spreadsheet
export function rowsToTsv(headers: string[], lines: string[][]) {
  const clean = (s: string) => String(s ?? '').replace(/[\t\r\n]+/g, ' ')
  return [headers, ...lines].map((line) => line.map(clean).join('\t')).join('\n')
}

export interface ParsedImport {
  fileName: string
  rows: Record<string, unknown>[]
  mappedFields: RunDataField[]
  unknownHeaders: string[]
}

function normalizeValue(field: RunDataField, v: unknown, rawDb: boolean): unknown {
  if (v instanceof Date) {
    return field.type === 'date' ? toDbDate(v) : dayjs(v).format(EXPORT_DATE_FORMAT)
  }
  if (isBlank(v) || (typeof v === 'string' && !v.trim())) return null
  switch (field.type) {
    case 'date':
      // raw json exports already hold UTC db strings; tabular files hold local time
      return rawDb ? String(v) : toDbDate(v)
    case 'number': {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    case 'enum': {
      const byLabel = field.enumOptions?.find((it) => it.label === String(v).trim())
      if (byLabel) return byLabel.value
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    default:
      return String(v)
  }
}

export async function parseImportFile(
  dataset: RunDataDatasetKey,
  file: File
): Promise<ParsedImport> {
  const fields = runDataDatasets[dataset].fields
  const byHeader = new Map<string, RunDataField>()
  for (const f of fields) {
    byHeader.set(f.key, f)
    byHeader.set(f.label, f)
  }

  let records: Record<string, unknown>[]
  let rawDb = false
  if (/\.json$/i.test(file.name)) {
    const parsed = JSON.parse(await file.text())
    if (Array.isArray(parsed)) {
      records = parsed
    } else if (Array.isArray(parsed?.rows)) {
      if (parsed.dataset && parsed.dataset !== dataset) {
        throw new Error(
          `该文件导出自「${runDataDatasets[parsed.dataset as RunDataDatasetKey]?.label ?? parsed.dataset}」，与当前表格不匹配`
        )
      }
      records = parsed.rows
      rawDb = true
    } else {
      throw new Error('无法识别的 JSON 结构，需要数组或包含 rows 数组的对象')
    }
  } else {
    const isCsv = /\.csv$/i.test(file.name)
    // csv: keep cells as text so ids like "00123" aren't turned into numbers
    const book = XLSX.read(await file.arrayBuffer(), {
      type: 'array',
      cellDates: true,
      raw: isCsv
    })
    const sheet = book.Sheets[book.SheetNames[0]]
    if (!sheet) throw new Error('文件中没有工作表')
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
  }

  const headers = new Set<string>()
  records.forEach((r) => r && Object.keys(r).forEach((k) => headers.add(k)))
  const mapping = [...headers]
    .map((h) => [h, byHeader.get(h.trim())] as const)
    .filter((it): it is readonly [string, RunDataField] => !!it[1])
  const unknownHeaders = [...headers].filter((h) => !byHeader.has(h.trim()))

  const rows = records.map((record) => {
    const row: Record<string, unknown> = {}
    for (const [header, field] of mapping) {
      row[field.key] = normalizeValue(field, record?.[header], rawDb)
    }
    return row
  })
  const mappedFields = fields.filter((f) => mapping.some(([, mf]) => mf.key === f.key))
  return { fileName: file.name, rows, mappedFields, unknownHeaders }
}
