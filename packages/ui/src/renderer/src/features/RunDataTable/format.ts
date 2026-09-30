import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { transformUtcDateToLocalDate } from '@geekgeekrun/utils/date.mjs'
import type { RunDataField } from '../../../../common/run-data'

dayjs.extend(utc)

export const DISPLAY_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss'
// milliseconds keep (encryptJobId, date) de-duplication exact across export -> import
export const EXPORT_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS'
const DB_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS'

// reactive proxies can't be structured-cloned by ipcRenderer.invoke
export const toPlain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export const isBlank = (v: unknown) => v === null || v === undefined || v === ''

export function formatDbDate(v: unknown, format = DISPLAY_DATE_FORMAT) {
  if (isBlank(v)) return ''
  const d = transformUtcDateToLocalDate(v)
  return d.isValid() ? d.format(format) : String(v)
}

// local Date / local date string -> UTC string as stored by TypeORM
export function toDbDate(v: unknown): string | null {
  if (isBlank(v)) return null
  const d = v instanceof Date ? dayjs(v) : dayjs(String(v).trim())
  return d.isValid() ? d.utc().format(DB_DATE_FORMAT) : null
}

export function enumLabel(field: RunDataField, v: unknown) {
  const option = field.enumOptions?.find(
    (it) => it.value === v || (it.value === null && isBlank(v)) || String(it.value) === String(v)
  )
  return option?.label ?? (isBlank(v) ? '' : String(v))
}

export function formatFieldValue(field: RunDataField | undefined, v: unknown) {
  if (!field) return isBlank(v) ? '' : String(v)
  switch (field.type) {
    case 'date':
      return formatDbDate(v)
    case 'enum':
      return enumLabel(field, v)
    default:
      return isBlank(v) ? '' : String(v)
  }
}

export const formatSalary = (row: Record<string, unknown>) =>
  isBlank(row.salaryLow) && isBlank(row.salaryHigh)
    ? ''
    : `${row.salaryLow}-${row.salaryHigh}k` + (row.salaryMonth ? ` * ${row.salaryMonth}薪` : '')
