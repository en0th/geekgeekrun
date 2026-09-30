// UI-level filter rows for the advanced filter builder, and their conversion to server filters.
import type {
  RunDataField,
  RunDataFieldType,
  RunDataFilter,
  RunDataFilterOp
} from '../../../../common/run-data'
import { DISPLAY_DATE_FORMAT, enumLabel, isBlank, toDbDate } from './format'
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
