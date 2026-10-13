// One contract for the settings UI and execution. Codes are persisted; BOSS returns text.
export const EXPERIENCE_OPTIONS = Object.freeze({
  101: '经验不限', 102: '应届生', 103: '1年以内', 104: '1-3年',
  105: '3-5年', 106: '5-10年', 107: '10年以上', 108: '在校生'
})
const clean = value => String(value ?? '').trim().replace(/[–—－~～至]/g, '-').replace(/\s+/g, '')
export function experienceSelectionLabels(values = []) {
  if (!Array.isArray(values)) throw new Error('工作经验配置无效，请重新选择')
  if (values.some(value => value === 0 || value === '0' || value === '不限')) return []
  return [...new Set(values.flatMap(value => {
    const label = EXPERIENCE_OPTIONS[value] || clean(value)
    if (label === '在校/应届' || label === '在校生/应届生') return ['在校生', '应届生']
    if (!Object.values(EXPERIENCE_OPTIONS).includes(label))
      throw new Error('无法识别工作经验选项：' + String(value) + '，请重新选择')
    return [label]
  }))]
}
export function experienceSelectionCodes(values = []) {
  return experienceSelectionLabels(values).map(label => Number(Object.keys(EXPERIENCE_OPTIONS).find(code => EXPERIENCE_OPTIONS[code] === label)))
}
export function normalizeExperience(value) {
  const label = EXPERIENCE_OPTIONS[value] || clean(value)
  return ['应届生', '在校生', '在校/应届', '在校生/应届生'].includes(label) ? '在校/应届' : label
}
export function normalizeExperienceSelections(values = []) {
  return [...new Set(experienceSelectionLabels(values).map(normalizeExperience))]
}
export function matchesExperience(values, actual) {
  const allowed = normalizeExperienceSelections(values)
  return !allowed.length || (!!clean(actual) && allowed.includes(normalizeExperience(actual)))
}
export const escapeKeyword = value => String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const keywordPattern = values => values.map(escapeKeyword).filter(Boolean).join('|')
export const allKeywordPattern = values => values.map(escapeKeyword).filter(Boolean).map(value => `(?=[\\s\\S]*${value})`).join('')
const detailFields = [
  ['expectJobNameRegExpStr', 'jobName', '岗位名称'],
  ['expectJobTypeRegExpStr', 'positionName', '职位分类'],
  ['expectJobDescRegExpStr', 'postDescription', '岗位描述']
]
export function createJobDetailMatcher(config = {}, matchLogic = config.jobDetailRegExpMatchLogic) {
  const checks = detailFields.flatMap(([key, field, label]) => {
    const pattern = String(config[key] ?? '').trim()
    if (!pattern) return []
    let expression
    try { expression = new RegExp(pattern, 'im') }
    catch { throw new Error(label + '匹配规则无效，请修改后再开始任务') }
    return [job => expression.test(String(job?.[field] ?? '').replace(/\n/g, ''))]
  })
  // Unset conditions are not required, including under the ANY rule.
  return job => !checks.length || (matchLogic === 2 ? checks.some(check => check(job)) : checks.every(check => check(job)))
}
export function validateJobFilterConfig(config = {}) {
  normalizeExperienceSelections(config.expectWorkExpList ?? [])
  createJobDetailMatcher(config)
  for (const [key, label] of [['expectJobRegExpStr', '旧岗位条件'], ['blockCompanyNameRegExpStr', '排除公司'], ['posterHrTitleRegExpStr', '招聘者身份']]) {
    if (!String(config[key] ?? '').trim()) continue
    try { new RegExp(config[key], 'im') }
    catch { throw new Error(label + '匹配规则无效，请修改后再保存') }
  }
}
export function companySelections(value) {
  if (Array.isArray(value)) return value.map(word => String(word).trim()).filter(Boolean)
  // Backward compatibility for the legacy comma-separated settings window.
  return String(value ?? '').split(',').map(word => word.trim()).filter(Boolean)
}
export function mergeJobFilterConfig(previous, patch) {
  const next = { ...previous, ...patch }
  if (detailFields.some(([key]) => Object.hasOwn(patch, key))) delete next.expectJobRegExpStr
  validateJobFilterConfig(next)
  return next
}
// Salary is stored in K/month or 万/year. Match overlapping intervals, not containment.
export function matchesSalary(salary, { low = null, high = null, unit = 1 } = {}) {
  if (low == null && high == null) return true
  if (salary.low == null || salary.high == null || !Number.isFinite(salary.low) || !Number.isFinite(salary.high)) return false
  const factor = unit === 2 ? (salary.month || 12) / 10 : 1
  return Math.max(salary.low * factor, low ?? -Infinity) <= Math.min(salary.high * factor, high ?? Infinity)
}
