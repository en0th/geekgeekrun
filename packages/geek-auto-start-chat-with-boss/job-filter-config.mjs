import { matchesSalaryDetails, parseCompanySize, explicitJobNature } from '@geekgeekrun/utils/job-values.cjs'
import { normalizeJobSources } from './search-source.mjs'
import { normalizeRunBudget } from './run-settings.mjs'
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
  normalizeRunBudget(config.autoChatRunBudget)
  normalizeJobSources(config.jobSourceList)
  normalizeExperienceSelections(config.expectWorkExpList ?? [])
  normalizeRequiredJobConditions(config.requiredJobConditions)
  for (const key of ['expectSalaryLow', 'expectSalaryHigh']) {
    if (config[key] != null && config[key] !== '' &&
      (!['number', 'string'].includes(typeof config[key]) || !String(config[key]).trim() || !Number.isFinite(Number(config[key])) || Number(config[key]) < 0))
      throw new Error('薪资金额须为非负数')
  }
  if ([config.expectSalaryLow, config.expectSalaryHigh].some(value => value != null && value !== '') &&
    (!['number', 'string'].includes(typeof (config.expectSalaryCalculateWay ?? 1)) || ![1, 2, 3, 4].includes(Number(config.expectSalaryCalculateWay ?? 1))))
    throw new Error('薪资单位无效，请重新选择')
  if (config.expectSalaryLow != null && config.expectSalaryLow !== '' && config.expectSalaryHigh != null && config.expectSalaryHigh !== '' && Number(config.expectSalaryLow) > Number(config.expectSalaryHigh))
    throw new Error('薪资上限不能低于下限')
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
  return matchesSalaryDetails(salary.unit ? salary : {
    low: salary.low == null ? null : salary.low * 1000,
    high: salary.high == null ? null : salary.high * 1000,
    month: salary.month, unit: 'month', status: 'parsed'
  }, { low, high, unit })
}

export const JOB_NATURE_OPTIONS = ['全职', '兼职', '实习']
export const DEGREE_OPTIONS = ['学历不限', '初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士']
export function normalizeRequiredJobConditions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('投递必需条件配置无效')
  const result = {}
  for (const key of ['jobNatures', 'degrees', 'industries', 'financingStages', 'excludedWords']) {
    const list = value[key] ?? []
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string')) throw new Error('投递必需条件选项无效')
    result[key] = [...new Set(list.map(item => item.trim()).filter(Boolean))]
  }
  if (result.jobNatures.some(item => !JOB_NATURE_OPTIONS.includes(item))) throw new Error('求职类型配置无效，请重新选择')
  if (result.degrees.some(item => !DEGREE_OPTIONS.includes(item))) throw new Error('学历配置无效，请重新选择')
  for (const key of ['companyScaleMin', 'companyScaleMax']) {
    if (value[key] != null && value[key] !== '' && (!['number', 'string'].includes(typeof value[key]) || !String(value[key]).trim()))
      throw new Error('公司人数须为非负整数')
    result[key] = value[key] == null || value[key] === '' ? null : Number(value[key])
    if (result[key] != null && (!Number.isSafeInteger(result[key]) || result[key] < 0)) throw new Error('公司人数须为非负整数')
  }
  if (result.companyScaleMin != null && result.companyScaleMax != null && result.companyScaleMin > result.companyScaleMax)
    throw new Error('公司人数上限不能低于下限')
  return result
}

export function requiredJobConditionReasons(detail = {}, conditions = {}) {
  const rules = normalizeRequiredJobConditions(conditions)
  const job = detail.jobInfo || {}, company = detail.brandComInfo || {}
  const reasons = []
  if (rules.excludedWords.length) {
    const fields = [job.jobName, job.postDescription]
    const text = fields.filter(value => typeof value === 'string').join('\n').normalize('NFKC').toLowerCase()
    const hits = rules.excludedWords.filter(word => text.includes(word.normalize('NFKC').toLowerCase()))
    if (hits.length) reasons.push('岗位包含屏蔽词：' + hits.join('、'))
    else if (fields.some(value => typeof value !== 'string' || !value.trim())) reasons.push('岗位名称或描述信息不足，无法核对屏蔽词')
  }
  if (rules.jobNatures.length) {
    // Explicit type evidence only: a title or a daily salary is not proof of internship.
    const value = explicitJobNature(job)
    if (!value) reasons.push('求职类型信息不足')
    else if (!rules.jobNatures.includes(value)) reasons.push('求职类型不符合')
  }
  if (rules.companyScaleMin != null || rules.companyScaleMax != null) {
    const [low, high] = parseCompanySize(company.scaleName)
    if (low == null && high == null) reasons.push('公司规模信息不足')
    else if ((rules.companyScaleMin != null && (low == null || low < rules.companyScaleMin)) ||
      (rules.companyScaleMax != null && (high == null || high > rules.companyScaleMax))) reasons.push('公司人数范围不符合')
  }
  const checks = [
    [rules.degrees, job.degreeName, '学历', false],
    [rules.industries, company.industryName, '公司行业', true],
    [rules.financingStages, company.stageName, '融资阶段', false]
  ]
  for (const [selected, value, label, contains] of checks) {
    if (!selected.length) continue
    if (typeof value !== 'string' || !value.trim()) reasons.push(label + '信息不足')
    else if (!selected.some(word => contains ? value.toLowerCase().includes(word.toLowerCase()) : value.trim() === word)) reasons.push(label + '不符合')
  }
  return reasons
}
