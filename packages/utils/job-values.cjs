// Currency amounts are yuan per stated period. Daily/hourly pay is never annualized.
function parseSalaryDetails(value) {
  const raw = String(value ?? '').trim()
  const result = { raw, low: null, high: null, unit: null, month: null, status: 'unknown' }
  if (/面议|保密/.test(raw)) return { ...result, status: 'negotiable' }
  const text = raw.replace(/\s/g, '').replace(/[–—－~～至]/g, '-').replace(/^[¥￥]/, '')
  const match = text.match(/^(\d+(?:\.\d+)?)(万元?|千元?|k|元)?(?:-(\d+(?:\.\d+)?)(万元?|千元?|k|元)?)?/i)
  if (!match) return result
  const rest = text.slice(match[0].length)
  const period = rest.match(/^(?:\/|每)?(小时|时|天|日|月|年)/)
  const units = { 小时: 'hour', 时: 'hour', 天: 'day', 日: 'day', 月: 'month', 年: 'year' }
  const unit = period ? units[period[1]] : /k|千/i.test(match[2] || match[4] || '') ? 'month' : null
  const suffix = period ? rest.slice(period[0].length) : rest
  if (!unit || (suffix && !/^[·*x×]?(\d{1,2})薪$/i.test(suffix))) return result
  const scale = word => /万/.test(word) ? 10000 : /k|千/i.test(word) ? 1000 : 1
  const low = Number(match[1]) * scale(match[2] || match[4] || '')
  const high = match[3] ? Number(match[3]) * scale(match[4] || match[2] || '') : low
  const month = suffix.match(/(\d{1,2})薪/)
  if (![low, high].every(Number.isFinite) || low > high || (month && (+month[1] < 1 || +month[1] > 36))) return result
  return { raw, low, high, unit, month: month ? +month[1] : null, status: 'parsed' }
}

function matchesSalaryDetails(actual, { low = null, high = null, unit = 1 } = {}) {
  if (low == null && high == null) return true
  if (actual?.status !== 'parsed' || !Number.isFinite(actual.low) || !Number.isFinite(actual.high)) return false
  unit = Number(unit)
  const expectedUnit = { 1: 'month', 2: 'year', 3: 'day', 4: 'hour' }[unit]
  if (!expectedUnit) return false
  let factor = 1
  if (actual.unit !== expectedUnit) {
    if (actual.unit === 'month' && expectedUnit === 'year') factor = actual.month || 12
    else if (actual.unit === 'year' && expectedUnit === 'month') factor = 1 / (actual.month || 12)
    else return false
  }
  const scale = unit === 1 ? 1000 : unit === 2 ? 10000 : 1
  return Math.max(actual.low * factor, low == null ? -Infinity : low * scale) <=
    Math.min(actual.high * factor, high == null ? Infinity : high * scale)
}

function parseCompanySize(value) {
  const text = String(value ?? '').replace(/\s/g, '').replace(/[–—－~～至]/g, '-')
  let match = text.match(/^(\d+)-(\d+)人$/)
  if (match && +match[1] <= +match[2]) return [+match[1], +match[2]]
  match = text.match(/^(\d+)人以上$/)
  if (match) return [+match[1], null]
  match = text.match(/^(\d+)人以下$/)
  if (match) return [0, +match[1]]
  return [null, null]
}

// Detail response codes differ from the search filter's 190x option codes.
// Verified against live detail responses and the site's internship/part-time UI.
const DETAIL_JOB_NATURES = Object.freeze({ 0: '全职', 4: '实习', 6: '兼职' })
function explicitJobNature(job = {}) {
  const textOrLegacy = [job.jobTypeName, job.jobNatureName, job.jobNature, job.jobType]
    .map(value => ['全职', '兼职', '实习'].includes(value) ? value :
      value === 1901 || value === '1901' ? '全职' : value === 1903 || value === '1903' ? '兼职' :
      value === 1902 || value === '1902' ? '实习' : null)
    .find(Boolean) || null
  if (textOrLegacy) return textOrLegacy
  if (typeof job.jobType !== 'number' && typeof job.jobType !== 'string') return null
  return Object.hasOwn(DETAIL_JOB_NATURES, job.jobType) ? DETAIL_JOB_NATURES[job.jobType] : null
}

exports.parseSalaryDetails = parseSalaryDetails
exports.matchesSalaryDetails = matchesSalaryDetails
exports.parseCompanySize = parseCompanySize
exports.explicitJobNature = explicitJobNature
exports.DETAIL_JOB_NATURES = DETAIL_JOB_NATURES
