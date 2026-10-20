import { parseSalaryDetails, parseCompanySize } from '@geekgeekrun/utils/job-values.cjs'
export { parseSalaryDetails }

export const parseCompanyScale = (str: string): [number | null, number | null] => parseCompanySize(str)

export function formatCompanyScale(low, high) {
  if (low === null && high === null) return ''
  if (low === null && high !== null) return `${high}人以下`
  if (low !== null && high === null) return `${low}人以上`
  return `${low}-${high}人`
}

// Legacy monthly columns and charts remain K/month; other periods stay out of them.
export const parseSalary = (str: string): { low: number | null, high: number | null, month: number | null } => {
  const salary = parseSalaryDetails(str)
  return salary.status === 'parsed' && salary.unit === 'month' && salary.low !== null && salary.high !== null
    ? { low: salary.low / 1000, high: salary.high / 1000, month: salary.month }
    : { low: null, high: null, month: null }
}
