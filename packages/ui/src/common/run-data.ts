// Shared definitions for the "运行数据" tables, used by both the renderer and the db worker.
import { PageReq } from './types/pagination'

export type RunDataDatasetKey =
  | 'chatStartupLog'
  | 'markAsNotSuitLog'
  | 'jobLibrary'
  | 'bossLibrary'
  | 'companyLibrary'
  | 'favoriteJobs'

export type RunDataFieldType = 'string' | 'number' | 'date' | 'enum'

export interface RunDataEnumOption {
  value: number | null
  label: string
}

export interface RunDataField {
  key: string
  label: string
  type: RunDataFieldType
  // included in keyword search
  searchable?: boolean
  enumOptions?: RunDataEnumOption[]
}

export interface RunDataDatasetDef {
  key: RunDataDatasetKey
  label: string
  // field that uniquely identifies a row
  rowKey: string
  // omitted = the worker's insertion order (newest first)
  defaultSort?: RunDataSort
  // whether rows link to a job on zhipin.com via encryptJobId
  hasJob: boolean
  // false hides import (rows that only make sense created from the app)
  importable?: boolean
  fields: RunDataField[]
}

export type RunDataFilterOp =
  | 'contains'
  | 'notContains'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'isEmpty'
  | 'isNotEmpty'

export interface RunDataFilter {
  field: string
  op: RunDataFilterOp
  // `between` takes [from, to]; `in` takes an array; date values are UTC db strings
  value?: unknown
}

export interface RunDataSort {
  field: string
  order: 'asc' | 'desc'
}

export interface RunDataQuery {
  dataset: RunDataDatasetKey
  keyword?: string
  filters?: RunDataFilter[]
  sort?: RunDataSort | null
}

export type RunDataPageQuery = RunDataQuery & PageReq

export interface RunDataDistinctReq extends RunDataQuery {
  field: string
  limit?: number
}

export interface RunDataDistinctItem {
  value: string | number | null
  count: number
}

export type RunDataStatsBucket = 'day' | 'week' | 'month' | 'hour' | 'weekday' | 'numberRange'

export interface RunDataStatsGroup {
  id: string
  field: string
  bucket?: RunDataStatsBucket
  // boundaries for `numberRange`, e.g. [0, 10, 20] -> <0, 0-10, 10-20, 20+
  ranges?: number[]
  limit?: number
}

export interface RunDataStatsReq extends RunDataQuery {
  groups: RunDataStatsGroup[]
  numericFields?: string[]
  distinctFields?: string[]
}

export interface RunDataStatsRes {
  total: number
  groups: Record<string, { name: string; value: number }[]>
  numeric: Record<
    string,
    { avg: number | null; min: number | null; max: number | null; count: number }
  >
  distinct: Record<string, number>
}

export interface RunDataDeleteReq {
  dataset: RunDataDatasetKey
  keys: (string | number)[]
}

export interface RunDataImportReq {
  dataset: RunDataDatasetKey
  // keyed by field key, values already normalised (enum -> number, date -> UTC db string)
  rows: Record<string, unknown>[]
}

export interface RunDataImportRes {
  total: number
  inserted: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

export const markAsNotSuitReasonOptions: RunDataEnumOption[] = [
  { value: 0, label: '未知原因' },
  { value: 1, label: 'BOSS不活跃' },
  { value: 2, label: '手动标记不合适' },
  { value: 3, label: '职位不合适' },
  { value: 4, label: '工作地不合适' },
  { value: 5, label: '工作经验不合适' },
  { value: 6, label: '薪资不合适' },
  { value: 7, label: '公司名称不匹配' },
  { value: 8, label: '发布者身份不匹配' }
]

export const markAsNotSuitOpOptions: RunDataEnumOption[] = [
  { value: 1, label: '在BOSS上标记' },
  { value: 2, label: '仅本地标记' },
  { value: 3, label: '无操作' }
]

export const jobSourceOptions: RunDataEnumOption[] = [
  { value: 1, label: '期望职位' },
  { value: 2, label: '推荐职位' },
  { value: 3, label: '搜索' }
]

// job_hire_status_record.hireStatus; NULL = never checked
export const hireStatusOptions: RunDataEnumOption[] = [
  { value: 1, label: '招聘中' },
  { value: 2, label: '已关闭' },
  { value: 3, label: '已删除' },
  { value: null, label: '未检查' }
]

export const startupFromOptions: RunDataEnumOption[] = [
  { value: null, label: '自动' },
  { value: 1, label: '手动' }
]

const jobFields: RunDataField[] = [
  { key: 'companyName', label: '公司', type: 'string', searchable: true },
  { key: 'jobName', label: '职位名称', type: 'string', searchable: true },
  { key: 'positionName', label: '职位分类', type: 'string', searchable: true },
  { key: 'experienceName', label: '工作经验', type: 'string' },
  { key: 'degreeName', label: '学历', type: 'string' },
  { key: 'salaryLow', label: '最低月薪(k)', type: 'number' },
  { key: 'salaryHigh', label: '最高月薪(k)', type: 'number' },
  { key: 'salaryMonth', label: '薪数', type: 'number' },
  { key: 'address', label: '工作地址', type: 'string', searchable: true },
  { key: 'publishDate', label: '发布时间', type: 'date' },
  { key: 'description', label: '职位描述', type: 'string', searchable: true }
]

const hireStatusFields: RunDataField[] = [
  { key: 'hireStatus', label: '职位状态', type: 'enum', enumOptions: hireStatusOptions },
  // updated whenever the job page is viewed by a task or checked by the status poll
  { key: 'hireStatusCheckedAt', label: '最近查看时间', type: 'date' }
]

const jobIdFields: RunDataField[] = [
  { key: 'encryptJobId', label: '职位ID', type: 'string', searchable: true },
  { key: 'encryptBossId', label: 'BOSS ID', type: 'string' },
  { key: 'encryptCompanyId', label: '公司ID', type: 'string' }
]

export const runDataDatasets: Record<RunDataDatasetKey, RunDataDatasetDef> = {
  chatStartupLog: {
    key: 'chatStartupLog',
    label: '开聊记录',
    rowKey: 'id',
    defaultSort: { field: 'date', order: 'desc' },
    hasJob: true,
    fields: [
      { key: 'date', label: '开聊时间', type: 'date' },
      ...jobFields,
      { key: 'bossName', label: 'BOSS', type: 'string', searchable: true },
      { key: 'bossTitle', label: 'BOSS身份', type: 'string', searchable: true },
      { key: 'jobSource', label: '职位来源', type: 'enum', enumOptions: jobSourceOptions },
      { key: 'chatStartupFrom', label: '开聊方式', type: 'enum', enumOptions: startupFromOptions },
      { key: 'userName', label: '用户', type: 'string' },
      { key: 'id', label: '记录ID', type: 'number' },
      ...jobIdFields,
      { key: 'encryptCurrentUserId', label: '用户ID', type: 'string' }
    ]
  },
  markAsNotSuitLog: {
    key: 'markAsNotSuitLog',
    label: '标记不合适记录',
    rowKey: 'id',
    defaultSort: { field: 'date', order: 'desc' },
    hasJob: true,
    fields: [
      { key: 'date', label: '标记时间', type: 'date' },
      ...jobFields,
      { key: 'bossName', label: 'BOSS', type: 'string', searchable: true },
      {
        key: 'markReason',
        label: '标记原因',
        type: 'enum',
        enumOptions: markAsNotSuitReasonOptions
      },
      { key: 'markOp', label: '标记操作', type: 'enum', enumOptions: markAsNotSuitOpOptions },
      { key: 'markFrom', label: '标记方式', type: 'enum', enumOptions: startupFromOptions },
      { key: 'extInfo', label: '附加信息', type: 'string', searchable: true },
      { key: 'jobSource', label: '职位来源', type: 'enum', enumOptions: jobSourceOptions },
      { key: 'userName', label: '用户', type: 'string' },
      { key: 'id', label: '记录ID', type: 'number' },
      ...jobIdFields,
      { key: 'encryptCurrentUserId', label: '用户ID', type: 'string' }
    ]
  },
  jobLibrary: {
    key: 'jobLibrary',
    label: '职位库',
    rowKey: 'encryptJobId',
    hasJob: true,
    fields: [
      ...jobFields,
      { key: 'bossName', label: 'BOSS', type: 'string', searchable: true },
      { key: 'bossTitle', label: 'BOSS身份', type: 'string', searchable: true },
      ...hireStatusFields,
      ...jobIdFields
    ]
  },
  favoriteJobs: {
    key: 'favoriteJobs',
    label: '收藏的职位',
    rowKey: 'id',
    defaultSort: { field: 'favoritedAt', order: 'desc' },
    hasJob: true,
    importable: false,
    fields: [
      { key: 'folderName', label: '收藏夹', type: 'string', searchable: true },
      ...hireStatusFields,
      { key: 'closedAt', label: '关闭时间', type: 'date' },
      ...jobFields,
      { key: 'bossName', label: 'BOSS', type: 'string', searchable: true },
      { key: 'bossTitle', label: 'BOSS身份', type: 'string', searchable: true },
      { key: 'favoritedAt', label: '收藏时间', type: 'date' },
      { key: 'id', label: '收藏ID', type: 'number' },
      { key: 'folderId', label: '收藏夹ID', type: 'number' },
      { key: 'encryptJobId', label: '职位ID', type: 'string', searchable: true }
    ]
  },
  bossLibrary: {
    key: 'bossLibrary',
    label: 'BOSS库',
    rowKey: 'encryptBossId',
    defaultSort: { field: 'date', order: 'desc' },
    hasJob: false,
    fields: [
      { key: 'companyName', label: '公司', type: 'string', searchable: true },
      { key: 'name', label: 'BOSS', type: 'string', searchable: true },
      { key: 'title', label: 'BOSS身份', type: 'string', searchable: true },
      { key: 'date', label: '收录时间', type: 'date' },
      { key: 'encryptBossId', label: 'BOSS ID', type: 'string', searchable: true },
      { key: 'encryptCompanyId', label: '公司ID', type: 'string' }
    ]
  },
  companyLibrary: {
    key: 'companyLibrary',
    label: '公司库',
    rowKey: 'encryptCompanyId',
    defaultSort: { field: 'name', order: 'asc' },
    hasJob: false,
    fields: [
      { key: 'name', label: '公司', type: 'string', searchable: true },
      { key: 'brandName', label: '品牌名', type: 'string', searchable: true },
      { key: 'scaleLow', label: '最小规模(人)', type: 'number' },
      { key: 'scaleHigh', label: '最大规模(人)', type: 'number' },
      { key: 'industryName', label: '所在行业', type: 'string', searchable: true },
      { key: 'stageName', label: '融资情况', type: 'string', searchable: true },
      { key: 'encryptCompanyId', label: '公司ID', type: 'string', searchable: true }
    ]
  }
}

export function getRunDataField(dataset: RunDataDatasetKey, fieldKey: string) {
  return runDataDatasets[dataset]?.fields.find((it) => it.key === fieldKey)
}
