// UI-level filter rows for the advanced filter builder, and their conversion to server filters.
import type {
  RunDataField,
  RunDataFieldType,
  RunDataFilter,
  RunDataFilterOp
} from '../../../../common/run-data'
import { DISPLAY_DATE_FORMAT, enumLabel, formatDbDate, isBlank, toDbDate } from './format'
import { transformUtcDateToLocalDate } from '@geekgeekrun/utils/date.mjs'
import dayjs from 'dayjs'

export interface FilterRow {
  field: string
  op: RunDataFilterOp
  // dates are local Date objects; enum `in` values are option keys (see enumKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any
}

export const opLabels: Record<RunDataFilterOp, string> = {
  contains: '包含',
  notContains: '不包含',
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  between: '介于',
  in: '属于',
  isEmpty: '为空',
  isNotEmpty: '不为空'
}

const dateOpLabels: Partial<Record<RunDataFilterOp, string>> = {
  gte: '晚于',
  lte: '早于'
}

export const opsForType: Record<RunDataFieldType, RunDataFilterOp[]> = {
  string: ['contains', 'notContains', 'eq', 'neq', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  date: ['between', 'gte', 'lte', 'isEmpty', 'isNotEmpty'],
  enum: ['in']
}

export const opLabel = (type: RunDataFieldType, op: RunDataFilterOp) =>
  (type === 'date' && dateOpLabels[op]) || opLabels[op]

export const needsValue = (op: RunDataFilterOp) => op !== 'isEmpty' && op !== 'isNotEmpty'

// el-select / el-checkbox can't hold null, so enum values travel as string keys
export const enumKey = (v: unknown) => (v === null || v === undefined ? 'null' : String(v))
export const enumFromKey = (k: string) => (k === 'null' ? null : Number(k))

export function isFilterRowComplete(row: FilterRow) {
  if (!row.field || !row.op) return false
  if (!needsValue(row.op)) return true
  if (Array.isArray(row.value)) {
    return row.op === 'between' ? row.value.some((v) => !isBlank(v)) : row.value.length > 0
  }
  return !isBlank(row.value)
}

export function toServerFilter(row: FilterRow, field: RunDataField): RunDataFilter {
  let value = row.value
  if (field.type === 'date') {
    value = Array.isArray(value) ? value.map((v) => toDbDate(v)) : toDbDate(value)
  } else if (field.type === 'enum' && Array.isArray(value)) {
    value = value.map((k) => enumFromKey(String(k)))
  } else if (field.type === 'number') {
    value = Array.isArray(value) ? value.map((v) => (isBlank(v) ? null : Number(v))) : Number(value)
  }
  return { field: row.field, op: row.op, value }
}

export function describeFilterRow(row: FilterRow, field: RunDataField) {
  const op = opLabel(field.type, row.op)
  if (!needsValue(row.op)) return `${field.label} ${op}`
  const fmt = (v: unknown) =>
    field.type === 'date'
      ? isBlank(v)
        ? '…'
        : dayjs(v as Date).format(DISPLAY_DATE_FORMAT)
      : field.type === 'enum'
        ? enumLabel(field, enumFromKey(String(v))) || '(空)'
        : isBlank(v)
          ? '…'
          : String(v)
  if (Array.isArray(row.value)) {
    return row.op === 'between'
      ? `${field.label} ${op} ${fmt(row.value[0])} ~ ${fmt(row.value[1])}`
      : `${field.label} ${op} ${row.value.map(fmt).join('、')}`
  }
  return `${field.label} ${op} ${fmt(row.value)}`
}

// a clicked stats item or table cell always becomes 过滤条件 (rows); header value filters are
// only ever set from the column header
export type DrillFilter = { kind: 'rows'; rows: FilterRow[] } | { kind: 'unsupported' }

/** "this value only" as a filter row, for any field type */
export function valueFilterRow(field: Pick<RunDataField, 'key' | 'type'>, raw: unknown): FilterRow {
  if (field.type === 'enum') return { field: field.key, op: 'in', value: [enumKey(raw)] }
  if (isBlank(raw)) return { field: field.key, op: 'isEmpty' }
  if (field.type === 'number') return { field: field.key, op: 'eq', value: Number(raw) }
  return { field: field.key, op: 'eq', value: String(raw) }
}

// local [start, end] of a strftime bucket: day YYYY-MM-DD, month YYYY-MM, week YYYY-Www
// (SQLite %W: weeks start on Monday, week 00 is the days before the first Monday)
export function bucketRange(bucket: string, name: string): [Date, Date] | null {
  if (bucket === 'day' || bucket === 'month') {
    const unit = bucket
    const d = dayjs(name)
    return d.isValid() ? [d.startOf(unit).toDate(), d.endOf(unit).toDate()] : null
  }
  if (bucket === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(name)
    if (!m) return null
    const jan1 = dayjs(`${m[1]}-01-01`)
    const firstMonday = jan1.add((8 - jan1.day()) % 7, 'day')
    const week = Number(m[2])
    const start = week === 0 ? jan1 : firstMonday.add(week - 1, 'week')
    const end = (week === 0 ? firstMonday : start.add(1, 'week')).subtract(1, 'millisecond')
    return [start.toDate(), end.toDate()]
  }
  return null
}

/** Turn a clicked stats item into 过滤条件. fieldType: the grouped field's type (default string). */
export function drillToFilter(
  group: { field: string; bucket?: string },
  raw: unknown,
  fieldType: RunDataField['type'] = 'string'
): DrillFilter {
  const { field, bucket } = group
  if (!bucket) return { kind: 'rows', rows: [valueFilterRow({ key: field, type: fieldType }, raw)] }
  if (['day', 'week', 'month'].includes(bucket)) {
    const range = bucketRange(bucket, String(raw))
    return range
      ? { kind: 'rows', rows: [{ field, op: 'between', value: range }] }
      : { kind: 'unsupported' }
  }
  if (bucket === 'numberRange') {
    // labels from the stats query: "<a", "a-b" (a <= v < b) or "a+"
    const text = String(raw)
    let m
    if ((m = /^<(-?[\d.]+)$/.exec(text)))
      return { kind: 'rows', rows: [{ field, op: 'lt', value: Number(m[1]) }] }
    if ((m = /^(-?[\d.]+)\+$/.exec(text)))
      return { kind: 'rows', rows: [{ field, op: 'gte', value: Number(m[1]) }] }
    if ((m = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(text)))
      return {
        kind: 'rows',
        rows: [
          { field, op: 'gte', value: Number(m[1]) },
          { field, op: 'lt', value: Number(m[2]) }
        ]
      }
  }
  // hour of day / weekday have no matching filter
  return { kind: 'unsupported' }
}

export type CellFilterAction = { kind: 'row'; row: FilterRow }

export interface CellFilterOption {
  label: string
  action: CellFilterAction
}

const short = (text: string, max = 24) => (text.length > max ? text.slice(0, max) + '…' : text)

/** Filters offered when a table cell is clicked: its raw value under the field's type. */
export function cellFilterOptions(field: RunDataField, raw: unknown): CellFilterOption[] {
  const key = field.key
  if (field.type === 'enum') {
    const value = (isBlank(raw) ? null : raw) as string | number | null
    const text = enumLabel(field, value) || '(空)'
    const others = (field.enumOptions ?? [])
      .map((o) => enumKey(o.value))
      .filter((k) => k !== enumKey(value))
    return [
      { label: `只看「${text}」`, action: { kind: 'row', row: valueFilterRow(field, value) } },
      ...(others.length
        ? [
            {
              label: `排除「${text}」`,
              action: {
                kind: 'row' as const,
                row: { field: key, op: 'in' as const, value: others }
              }
            }
          ]
        : [])
    ]
  }
  if (isBlank(raw)) {
    return [
      { label: `${field.label}为空`, action: { kind: 'row', row: { field: key, op: 'isEmpty' } } },
      {
        label: `${field.label}不为空`,
        action: { kind: 'row', row: { field: key, op: 'isNotEmpty' } }
      }
    ]
  }
  if (field.type === 'date') {
    const d = transformUtcDateToLocalDate(raw)
    if (!d.isValid()) return []
    const day = d.format('YYYY-MM-DD')
    const time = formatDbDate(raw, DISPLAY_DATE_FORMAT)
    return [
      {
        label: `同一天（${day}）`,
        action: {
          kind: 'row',
          row: {
            field: key,
            op: 'between',
            value: [d.startOf('day').toDate(), d.endOf('day').toDate()]
          }
        }
      },
      {
        label: `晚于 ${time}`,
        action: { kind: 'row', row: { field: key, op: 'gte', value: d.toDate() } }
      },
      {
        label: `早于 ${time}`,
        action: { kind: 'row', row: { field: key, op: 'lte', value: d.toDate() } }
      }
    ]
  }
  if (field.type === 'number') {
    const n = Number(raw)
    return [
      { label: `等于 ${n}`, action: { kind: 'row', row: { field: key, op: 'eq', value: n } } },
      { label: `大于等于 ${n}`, action: { kind: 'row', row: { field: key, op: 'gte', value: n } } },
      { label: `小于等于 ${n}`, action: { kind: 'row', row: { field: key, op: 'lte', value: n } } }
    ]
  }
  const text = String(raw)
  const options: CellFilterOption[] = [
    {
      label: `只看「${short(text)}」`,
      action: { kind: 'row', row: { field: key, op: 'eq', value: text } }
    },
    {
      label: `排除「${short(text)}」`,
      action: { kind: 'row', row: { field: key, op: 'neq', value: text } }
    }
  ]
  // long text: offer the first words as a "contains" filter
  if (text.length > 24) {
    options.push({
      label: `包含「${short(text, 12)}」`,
      action: { kind: 'row', row: { field: key, op: 'contains', value: text.slice(0, 12) } }
    })
  }
  return options
}
