import { createHash } from 'node:crypto'
import { normalizeJobSources } from './search-source.mjs'
import { readRunSettings } from './run-settings.mjs'

const selectionFields = new Set(['expectCityList', 'expectWorkExpList', 'positionCodes', 'companies',
  'cityList', 'salaryList', 'experienceList', 'degreeList', 'scaleList', 'industryList',
  'jobNatures', 'degrees', 'industries', 'financingStages', 'excludedWords'])
function canonical(value, field = '') {
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item))
    // Multi-select values are sets. Keep compound source/combination order,
    // which may affect which jobs a bounded run actually gets to observe.
    return selectionFields.has(field) && items.every(item => item === null || typeof item !== 'object')
      ? items.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0) : items
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key], key)]))
  return value
}

/** Conservative identity of the frozen query/filter configuration, never credentials. */
export function jobComparisonScope(config) {
  const boss = { ...config['boss.json'] }
  const settings = readRunSettings(boss)
  for (const key of ['autoReminder', 'autoChatRunBudget', 'autoChatRunInBackground',
    'jobListLoadWaitSeconds', 'jobDetailViewWaitSeconds', 'isSageTimeEnabled', 'sageTimeOpTimes', 'sageTimePauseMinute'])
    delete boss[key]
  boss.jobSourceList = normalizeJobSources(boss.jobSourceList)
  // Recommendation/expectation sources also depend on mutable platform-side
  // preferences. The local config cannot prove their complete query identity.
  if (!boss.jobSourceList.length || boss.jobSourceList.some(source => source.type !== 'search')) return null
  boss.autoChatRunMode = settings.runMode
  boss.collectOnlyMatchingJobs = settings.collectOnlyMatchingJobs
  const scope = canonical({ boss, common: config['common-job-condition-config.json'],
    companies: config['target-company-list.json'] })
  return 'v1:' + createHash('sha256').update(JSON.stringify(scope)).digest('hex')
}
