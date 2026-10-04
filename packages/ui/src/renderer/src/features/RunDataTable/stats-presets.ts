import type { RunDataDatasetKey } from '../../../../common/run-data'
import type { RunDataChart, RunDataStatsPreset } from './types'

const salaryRanges = [5, 10, 15, 20, 25, 30, 40, 50]

const jobCharts = (prefix: string): RunDataChart[] => [
  {
    id: `${prefix}Company`,
    title: '公司 Top 15',
    type: 'hbar',
    group: { field: 'companyName', limit: 15 }
  },
  {
    id: `${prefix}Position`,
    title: '职位分类分布',
    type: 'pie',
    group: { field: 'positionName', limit: 10 }
  },
  {
    id: `${prefix}Salary`,
    title: '最低月薪分布',
    type: 'bar',
    group: { field: 'salaryLow', bucket: 'numberRange', ranges: salaryRanges }
  },
  {
    id: `${prefix}Experience`,
    title: '工作经验要求',
    type: 'pie',
    group: { field: 'experienceName', limit: 10 }
  },
  {
    id: `${prefix}Degree`,
    title: '学历要求',
    type: 'pie',
    group: { field: 'degreeName', limit: 10 }
  }
]

const salaryNumeric = [
  { field: 'salaryLow', label: '平均最低月薪', unit: 'k' },
  { field: 'salaryHigh', label: '平均最高月薪', unit: 'k' }
]

export const runDataStatsPresets: Record<RunDataDatasetKey, RunDataStatsPreset> = {
  chatStartupLog: {
    distinctFields: [
      { field: 'companyName', label: '涉及公司数' },
      { field: 'positionName', label: '涉及职位分类' }
    ],
    numericFields: salaryNumeric,
    charts: [
      {
        id: 'daily',
        title: '每日开聊数（最近 90 天有数据的日期）',
        type: 'line',
        group: { field: 'date', bucket: 'day', limit: 90 },
        wide: true
      },
      {
        id: 'hour',
        title: '开聊时段分布',
        type: 'bar',
        group: { field: 'date', bucket: 'hour', limit: 24 }
      },
      {
        id: 'weekday',
        title: '星期分布',
        type: 'bar',
        group: { field: 'date', bucket: 'weekday', limit: 7 }
      },
      ...jobCharts('job'),
      { id: 'jobSource', title: '职位来源', type: 'pie', group: { field: 'jobSource' } },
      {
        id: 'bossTitle',
        title: 'BOSS身份 Top 15',
        type: 'hbar',
        group: { field: 'bossTitle', limit: 15 }
      }
    ]
  },
  markAsNotSuitLog: {
    distinctFields: [
      { field: 'companyName', label: '涉及公司数' },
      { field: 'positionName', label: '涉及职位分类' }
    ],
    numericFields: salaryNumeric,
    charts: [
      {
        id: 'daily',
        title: '每日标记数（最近 90 天有数据的日期）',
        type: 'line',
        group: { field: 'date', bucket: 'day', limit: 90 },
        wide: true
      },
      { id: 'reason', title: '标记原因', type: 'pie', group: { field: 'markReason' } },
      { id: 'op', title: '标记操作', type: 'pie', group: { field: 'markOp' } },
      ...jobCharts('job'),
      { id: 'jobSource', title: '职位来源', type: 'pie', group: { field: 'jobSource' } }
    ]
  },
  jobLibrary: {
    distinctFields: [
      { field: 'companyName', label: '公司数' },
      { field: 'positionName', label: '职位分类数' }
    ],
    numericFields: salaryNumeric,
    charts: [
      ...jobCharts('job'),
      {
        id: 'bossTitle',
        title: 'BOSS身份 Top 15',
        type: 'hbar',
        group: { field: 'bossTitle', limit: 15 }
      }
    ]
  },
  favoriteJobs: {
    distinctFields: [
      { field: 'companyName', label: '公司数' },
      { field: 'folderName', label: '收藏夹数' }
    ],
    numericFields: salaryNumeric,
    charts: [
      { id: 'hireStatus', title: '招聘状态', type: 'pie', group: { field: 'hireStatus' } },
      { id: 'folder', title: '收藏夹', type: 'pie', group: { field: 'folderName', limit: 12 } },
      ...jobCharts('job')
    ]
  },
  bossLibrary: {
    distinctFields: [{ field: 'companyName', label: '公司数' }],
    charts: [
      {
        id: 'daily',
        title: '每日收录 BOSS 数',
        type: 'line',
        group: { field: 'date', bucket: 'day', limit: 90 },
        wide: true
      },
      {
        id: 'company',
        title: 'BOSS 数最多的公司 Top 15',
        type: 'hbar',
        group: { field: 'companyName', limit: 15 }
      },
      { id: 'title', title: 'BOSS身份 Top 15', type: 'hbar', group: { field: 'title', limit: 15 } }
    ]
  },
  companyLibrary: {
    distinctFields: [
      { field: 'industryName', label: '行业数' },
      { field: 'brandName', label: '品牌数' }
    ],
    charts: [
      {
        id: 'industry',
        title: '所在行业 Top 15',
        type: 'hbar',
        group: { field: 'industryName', limit: 15 }
      },
      { id: 'stage', title: '融资情况', type: 'pie', group: { field: 'stageName', limit: 12 } },
      {
        id: 'scale',
        title: '公司规模（最小人数）',
        type: 'bar',
        group: { field: 'scaleLow', bucket: 'numberRange', ranges: [20, 100, 500, 1000, 10000] },
        wide: true
      }
    ]
  }
}
